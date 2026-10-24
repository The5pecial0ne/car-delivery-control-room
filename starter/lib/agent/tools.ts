// The tools the agent can use. They come in three kinds:
//
//   lookup  reads the order's records. Free, and always the first thing to try.
//   ask     talks to someone the agent is allowed to contact (the driver, the pickup desk).
//   findings writes down what the investigation found, before any recovery plan.
//   act     does one of the few things policy.ts lets the agent do without a person.
//   finish  hands the case to a person with one decision, or closes it.
//
// Every record that comes back carries its table and id, so the agent can cite
// where each fact came from and the control room can link to it.

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { addresses, alerts, conversations, customers, drivers, messages, orderItems, orders, relatedRecords, vehicles } from "@/lib/schema"
import { db } from "./conn"
import { simulateDriverReply } from "./driver"
import { patternsForOrder, sitePatterns } from "./patterns"
import { pickupContactFor, simulateSiteReply } from "./site"
import { backupDrivers, delayImpact, ferryOptions, hotelOptions, localTime, planSailings, roadsideHelp, towQuote } from "./services"
import type { ChatMessage, CompleteFn, ToolSpec } from "./model"
import { ACTION_KINDS, ACTIONS, AUTO_ACTIONS, isActionKind } from "./policy"
import { addStep, type CaseRow, type CaseStatus } from "./store"

// The transcript so far, so finishing tools can check what the agent has actually seen.
export type ToolContext = { caseRow: CaseRow; complete: CompleteFn; transcript: ChatMessage[] }
export type ToolOutcome = {
  content: unknown
  // One plain line for the trace, written for an operations person.
  summary: string
  // Set when the tool ends the agent's turn.
  finish?: { status: CaseStatus; headline: string; pendingDecision: Record<string, unknown> | null }
}
type Tool = {
  name: string
  kind: "lookup" | "ask" | "findings" | "act" | "finish"
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>
}

const str = (value: unknown) => typeof value === "string" ? value : ""
const orderArg = { order_id: { type: "string", description: "Order id such as ord-00322. Leave out to use this case's order." } }
const orderOf = (args: Record<string, unknown>, ctx: ToolContext) => str(args.order_id) || ctx.caseRow.orderId

// A source is only good if a tool actually returned it on this case. The model
// is good at producing ids that look right, so we check rather than trust.
function unseenSources(sources: string[], ctx: ToolContext): string[] {
  const seen = ctx.transcript.map((message) => message.role === "tool" ? message.content : "").join("\n")
  return sources.filter((source) => {
    const id = source.slice(source.indexOf("/") + 1)
    return !source.includes("/") || !id || !seen.includes(id)
  })
}

const HEADLINE_MAX = 140

// Where in the transcript a tool last ran successfully, so the finishing tools
// can check the order of work: findings must come after the last answer.
function lastSuccess(transcript: ChatMessage[], names: string[]): number {
  let found = -1
  transcript.forEach((message, index) => {
    if (message.role !== "assistant" || !message.tool_calls) return
    for (const call of message.tool_calls) {
      if (!names.includes(call.function.name)) continue
      const result = transcript.slice(index + 1).find((later) => later.role === "tool" && later.tool_call_id === call.id)
      if (result && result.role === "tool" && !result.content.startsWith('{"error"')) found = index
    }
  })
  return found
}

function needsFreshFindings(ctx: ToolContext): string | false {
  const findings = lastSuccess(ctx.transcript, ["record_findings"])
  if (findings === -1) return "record_findings first: stage one (what is true, what is unknown, the key question) comes before any recovery plan"
  if (lastSuccess(ctx.transcript, ["message_driver", "ask_pickup_contact"]) > findings) return "you learned something new since your last record_findings; update the findings first"
  return false
}

const FACT_STATUS = ["confirmed", "reported", "planned", "unknown"]
const TIMELINE_STATUS = ["planned", "reported", "confirmed", "projected", "missed"]

// How each option scores, so the desk can rank them by what the person cares
// about most right now: speed, cost or certainty.
const OPTION_SCORES = {
  arrives_at: { type: "string", description: "When the car would reach the buyer with this option (UTC, ISO 8601), if you can tell." },
  cost_eur: { type: "number", description: "Extra cost to Bahn, as far as known." },
  certainty: { type: "string", enum: ["confirmed", "quoted", "uncertain"], description: "confirmed: already booked or agreed. quoted: we have a quote or a firm answer. uncertain: depends on something nobody has confirmed." },
}
const CERTAINTY = ["confirmed", "quoted", "uncertain"]
const isTime = (value: unknown) => typeof value === "string" && !Number.isNaN(new Date(value).getTime())
// Ids belong in the sources, not in what a person reads first.
const HAS_ID = /\b(ord|cd)-\d{5,}\b|\b[a-z]+-x?[0-9a-f]{8,}\b|agent_steps|simulated\//i

// Collections the agent may read through get_records. The big shared tables stay out.
const READABLE = [
  "time_windows", "tracking_observations", "work_assignments", "assignment_steps", "transport_plans", "transport_points",
  "transport_segments", "travel_options", "travel_reservations", "travel_confirmations", "incidents", "agent_proposals",
  "order_endpoint_details", "endpoint_claims", "documents", "expenses", "proofs", "work_items", "order_notes",
  "custody_assets", "custody_reports", "site_visits", "ferry_terminal_events", "terminal_road_estimates",
]

async function relatedFor(orderId: string, collections: string[]) {
  const rows = await db.select().from(relatedRecords)
    .where(and(eq(relatedRecords.orderId, orderId), inArray(relatedRecords.collection, collections)))
  return rows.map((row): Record<string, unknown> & { table: string; id: string } => ({ table: row.collection, id: row.id, ...row.details }))
}

const tools: Tool[] = [
  {
    name: "get_order",
    kind: "lookup",
    description: "The order at a glance: reference, status, the customer who pays, the car, pickup and delivery addresses, time windows (pickup slot and delivery target) and the booked driver work.",
    parameters: { type: "object", properties: orderArg },
    async run(args, ctx) {
      const id = orderOf(args, ctx)
      const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1)
      if (!order) return { content: { error: `No order ${id}` }, summary: `Could not find order ${id}` }
      const [[customer], items, places, windows, assignments, patterns] = await Promise.all([
        db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1),
        db.select({ item: orderItems, vehicle: vehicles }).from(orderItems).innerJoin(vehicles, eq(orderItems.vehicleId, vehicles.id)).where(eq(orderItems.orderId, id)),
        db.select().from(addresses).where(inArray(addresses.id, [order.pickupAddressId, order.deliveryAddressId])),
        relatedFor(id, ["time_windows"]),
        relatedFor(id, ["work_assignments"]),
        patternsForOrder(id),
      ])
      const driverIds = assignments.map((row) => str(row.driver_id)).filter(Boolean)
      const driverRows = driverIds.length ? await db.select().from(drivers).where(inArray(drivers.id, driverIds)) : []
      const place = (addressId: string) => {
        const row = places.find((candidate) => candidate.id === addressId)
        return row ? { table: "addresses", id: row.id, name: row.name, city: row.city, country: row.country, ...row.details } : null
      }
      const car = items[0]?.vehicle
      return {
        summary: `Read order ${order.reference}${car ? `: ${car.make} ${car.model}` : ""} for ${customer?.name ?? "an unknown customer"}`,
        content: {
          order: { table: "orders", id: order.id, reference: order.reference, status: order.status, lane: order.displayLane, route_kind: order.routeKind, ...order.details },
          customer: customer && { table: "customers", id: customer.id, name: customer.name, country: customer.country, tier: customer.accountTier, note: "Customers pay us. The agent never contacts them directly." },
          vehicles: items.map(({ item, vehicle }) => ({ table: "vehicles", id: vehicle.id, role: item.role, make: vehicle.make, model: vehicle.model, year: vehicle.modelYear, fuel: vehicle.fuel, registration: vehicle.registration })),
          pickup: place(order.pickupAddressId),
          delivery: place(order.deliveryAddressId),
          // Local times next to the UTC ones, so nobody has to convert in their head.
          time_windows: windows.map((row) => ({ ...row, local: `${localTime(str(row.start_at), row.timezone)} to ${localTime(str(row.end_at), row.timezone)}` })),
          driver_work: assignments.map((row) => ({ ...row, driver: driverRows.find((driver) => driver.id === row.driver_id)?.displayName ?? null })),
          // Places on this order where the same trouble keeps coming back. Worth a line in a hand-over.
          site_patterns: patterns.map((pattern) => ({
            site: pattern.siteName, troubled_orders: pattern.troubledOrders, of_orders: pattern.orders,
            themes: pattern.themes.map((theme) => theme.label), advice: pattern.themes[0]?.advice,
            sources: pattern.signals.map((signal) => signal.source),
          })),
        },
      }
    },
  },
  {
    name: "get_messages",
    kind: "lookup",
    description: "Every message on the order's conversations, oldest first: driver chat, customer email and internal notes, with who wrote them and when.",
    parameters: { type: "object", properties: orderArg },
    async run(args, ctx) {
      const id = orderOf(args, ctx)
      const threads = await db.select().from(conversations).where(eq(conversations.orderId, id))
      const rows = threads.length
        ? await db.select().from(messages).where(inArray(messages.conversationId, threads.map((thread) => thread.id))).orderBy(messages.authoredAt)
        : []
      return {
        summary: `Read ${rows.length} message${rows.length === 1 ? "" : "s"} on the order`,
        content: rows.map((row) => ({
          table: "messages", id: row.id, at: row.authoredAt.toISOString(), author_type: row.authorType, author_id: row.details.author_id,
          channel: row.details.channel, visibility: row.details.visibility, body: row.body,
        })),
      }
    },
  },
  {
    name: "get_alerts_and_incidents",
    kind: "lookup",
    description: "Open and past alerts, incidents and earlier agent proposals on the order. An alert is a reason to look, not a diagnosis.",
    parameters: { type: "object", properties: orderArg },
    async run(args, ctx) {
      const id = orderOf(args, ctx)
      const [alertRows, rest] = await Promise.all([
        db.select().from(alerts).where(eq(alerts.orderId, id)).orderBy(desc(alerts.triggeredAt)),
        relatedFor(id, ["incidents", "agent_proposals"]),
      ])
      return {
        summary: `Checked ${alertRows.length} alert${alertRows.length === 1 ? "" : "s"} and ${rest.length} incident or proposal record${rest.length === 1 ? "" : "s"}`,
        content: {
          alerts: alertRows.map((row) => ({ table: "alerts", id: row.id, severity: row.severity, signal: row.signal, status: row.status, summary: row.summary, triggered_at: row.triggeredAt.toISOString(), ...row.details })),
          incidents_and_proposals: rest,
        },
      }
    },
  },
  {
    name: "get_records",
    kind: "lookup",
    description: `Raw records of one kind linked to the order. Use for anything the other lookups do not cover. Kinds: ${READABLE.join(", ")}.`,
    parameters: { type: "object", properties: { ...orderArg, collection: { type: "string", enum: READABLE } }, required: ["collection"] },
    async run(args, ctx) {
      const collection = str(args.collection)
      if (!READABLE.includes(collection)) return { content: { error: `Unknown collection ${collection}` }, summary: `Tried to read unknown records "${collection}"` }
      const rows = await relatedFor(orderOf(args, ctx), [collection])
      return { summary: `Looked up ${collection.replaceAll("_", " ")} (${rows.length})`, content: rows }
    },
  },
  {
    name: "get_driver",
    kind: "lookup",
    description: "A driver's profile and every job they have booked, so you can see what else depends on them.",
    parameters: { type: "object", properties: { driver_id: { type: "string" } }, required: ["driver_id"] },
    async run(args) {
      const id = str(args.driver_id)
      const [driver] = await db.select().from(drivers).where(eq(drivers.id, id)).limit(1)
      if (!driver) return { content: { error: `No driver ${id}` }, summary: `Could not find driver ${id}` }
      const jobs = await db.select().from(relatedRecords).where(and(
        eq(relatedRecords.collection, "work_assignments"),
        sql`${relatedRecords.details} ->> 'driver_id' = ${id}`,
      ))
      const theirs = jobs.map((row) => ({ table: "work_assignments", id: row.id, ...row.details }))
      return {
        summary: `Looked up driver ${driver.displayName} and their ${theirs.length} booked job${theirs.length === 1 ? "" : "s"}`,
        content: { driver: { table: "drivers", id: driver.id, name: driver.displayName, home: `${driver.homeCity}, ${driver.homeCountry}`, ...driver.details }, jobs: theirs },
      }
    },
  },
  {
    name: "find_roadside_help",
    kind: "lookup",
    description: "Quotes from roadside assistance near a location. Quotes only: nothing gets booked. Use the most exact location you have.",
    parameters: { type: "object", required: ["location"], properties: { location: { type: "string" }, make: { type: "string", description: "Car make, for brand assistance advice." } } },
    async run(args) {
      const result = roadsideHelp({ location: str(args.location), make: str(args.make) || undefined })
      return { summary: `Got ${result.options.length} roadside help quotes near ${str(args.location)}`, content: result }
    },
  },
  {
    name: "get_tow_quote",
    kind: "lookup",
    description: "A quote for towing or collecting the car from one place to another. Quote only: nothing gets booked.",
    parameters: { type: "object", required: ["from", "to"], properties: { from: { type: "string" }, to: { type: "string" } } },
    async run(args) {
      const result = towQuote({ from: str(args.from), to: str(args.to) })
      return { summary: `Got a tow quote from ${result.from} to ${result.to}: ${result.price_eur} EUR`, content: result }
    },
  },
  {
    name: "search_ferries",
    kind: "lookup",
    description: "Ferry sailings for the order's crossing, with status (sold out, quoted, booked), times, check-in cutoffs and prices. A quote is not a booking.",
    parameters: { type: "object", properties: orderArg },
    async run(args, ctx) {
      const result = await ferryOptions(orderOf(args, ctx))
      return { summary: `Checked ${result.sailings.length} ferry sailing${result.sailings.length === 1 ? "" : "s"}`, content: result }
    },
  },
  {
    name: "plan_sailings",
    kind: "lookup",
    description: "For every sailing that is not sold out: when the driver reaches the terminal, whether they make check-in, which nights need a hotel, and when the car reaches the buyer against the promise. Use this instead of working out dates yourself.",
    parameters: {
      type: "object",
      properties: {
        ...orderArg,
        onward_drive_hours: { type: "number", description: "Hours from the arrival terminal to the buyer, if you know them. Default 2." },
        ready_at: { type: "string", description: "When the driver can leave for the terminal (UTC, ISO 8601), if not the end of the pickup slot." },
      },
    },
    async run(args, ctx) {
      const hours = typeof args.onward_drive_hours === "number" ? args.onward_drive_hours : undefined
      const result = await planSailings({ orderId: orderOf(args, ctx), onwardDriveHours: hours, readyAt: str(args.ready_at) || undefined })
      const fits = result.plans.filter((plan) => plan.makes_check_in && plan.inside_promise !== false).length
      return { summary: `Planned ${result.plans.length} sailing${result.plans.length === 1 ? "" : "s"}: ${fits} make${fits === 1 ? "s" : ""} check-in and the promise`, content: result }
    },
  },
  {
    name: "find_backup_drivers",
    kind: "lookup",
    description: "Drivers in our network who live near a place and are not on another job right now, nearest first, for a plan B. You cannot contact them; offering them the job is a person's call.",
    parameters: { type: "object", required: ["near"], properties: { near: { type: "string", description: "A city or place, for example 'Rasthof Göttingen, A7'." } } },
    async run(args, ctx) {
      const result = await backupDrivers({ near: str(args.near), excludeOrderId: ctx.caseRow.orderId })
      return { summary: `Found ${result.drivers.length} possible backup driver${result.drivers.length === 1 ? "" : "s"} near ${str(args.near)}`, content: result }
    },
  },
  {
    name: "search_hotels",
    kind: "lookup",
    description: "Hotels for the driver near a place, for one night. Quotes only: nothing gets booked.",
    parameters: { type: "object", required: ["near", "night"], properties: { near: { type: "string" }, night: { type: "string", description: "Date of the night, YYYY-MM-DD" } } },
    async run(args) {
      const result = hotelOptions({ near: str(args.near), night: str(args.night) })
      return { summary: `Got ${result.options.length} hotel quotes near ${str(args.near)}`, content: result }
    },
  },
  {
    name: "estimate_delay_impact",
    kind: "lookup",
    description: "Checks a plan against the customer's delivery promise. Best: give new_arrival_at, the arrival you worked out for the plan (UTC, ISO 8601). Otherwise give delay_hours to add to the last ETA from the driver app (only exists once the car is moving).",
    parameters: { type: "object", properties: { ...orderArg, new_arrival_at: { type: "string" }, delay_hours: { type: "number" } } },
    async run(args, ctx) {
      const hours = Number(args.delay_hours) || 0
      const arrival = str(args.new_arrival_at) || undefined
      const result = await delayImpact({ orderId: orderOf(args, ctx), delayHours: hours, newArrivalAt: arrival })
      const verdict = result.misses_promise == null ? "nothing to compare" : result.misses_promise ? `misses the promise by about ${result.hours_late} h` : `inside the promise with ${result.hours_spare} h to spare`
      const what = arrival ? `an arrival of ${result.new_eta_local ?? arrival}` : `a ${hours} h delay`
      return { summary: `Checked ${what} against the delivery promise: ${verdict}`, content: result }
    },
  },
  {
    name: "message_driver",
    kind: "ask",
    description: "Send the booked driver a chat message and wait for their reply. Allowed without approval. Keep it short and kind, ask one or two things at a time, and put safety first. You cannot use this to reach the customer.",
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    async run(args, ctx) {
      const text = str(args.message).trim()
      if (!text) return { content: { error: "Empty message" }, summary: "Tried to send an empty message" }
      const sent = await addStep(ctx.caseRow.id, { actor: "agent", kind: "message", body: text, data: { to: "driver", channel: "driver_chat" } })
      const reply = await simulateDriverReply(ctx.caseRow, ctx.complete)
      const received = await addStep(ctx.caseRow.id, { actor: "driver", kind: "message", body: reply, data: { from: "driver", channel: "driver_chat", in_reply_to: sent.id } })
      return {
        summary: "",
        content: { driver_reply: reply, source: `agent_steps/${received.id}` },
      }
    },
  },
  {
    name: "ask_pickup_contact",
    kind: "ask",
    description: "Call or message the desk at the pickup site (the contact on the order's pickup details) and wait for their answer. Allowed without approval. Use it for what only the site can know: where the car physically is, who holds the keys, what release paperwork they need, opening hours. Ask one or two things at a time. This is not the customer.",
    parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
    async run(args, ctx) {
      const text = str(args.message).trim()
      if (!text) return { content: { error: "Empty message" }, summary: "" }
      const contact = await pickupContactFor(ctx.caseRow.orderId)
      if (!contact) return { content: { error: "This order has no pickup contact on file." }, summary: "Tried to reach the pickup site, but no contact is on file" }
      const sent = await addStep(ctx.caseRow.id, { actor: "agent", kind: "message", body: text, data: { to: "site", channel: "site_call", contact: contact.name } })
      const reply = await simulateSiteReply(ctx.caseRow, ctx.complete)
      const received = await addStep(ctx.caseRow.id, { actor: "site", kind: "message", body: reply, data: { from: "site", channel: "site_call", contact: contact.name, in_reply_to: sent.id } })
      return { summary: "", content: { contact: contact.name, role: contact.role, reply, source: `agent_steps/${received.id}` } }
    },
  },
  {
    name: "get_site_history",
    kind: "lookup",
    description: "Recurring problems at the pickup and delivery places of an order (or at one site): which earlier orders had trouble there and of what kind, such as keys, release papers, gate access or a car that was not there.",
    parameters: { type: "object", properties: { ...orderArg, site_id: { type: "string" } } },
    async run(args, ctx) {
      const siteId = str(args.site_id)
      const patterns = siteId ? await sitePatterns({ siteIds: [siteId] }) : await patternsForOrder(orderOf(args, ctx))
      return {
        summary: patterns.length ? `Found a repeating problem at ${patterns.map((pattern) => pattern.siteName).join(" and ")}` : "Checked the site history: nothing repeating",
        content: patterns.length ? patterns : { note: "No repeating problem at these places in the records." },
      }
    },
  },
  {
    name: "record_findings",
    kind: "findings",
    description: "Stage one of every case: write down what the investigation found before you plan anything. Call it once you have looked, again after each answer from the driver or the site, and always before ask_person or close_case. Separate what is confirmed from what is only reported, planned or unknown, list where records disagree, name the one question that would unlock the case, and lay out the timeline as planned against what is really happening.",
    parameters: {
      type: "object",
      required: ["problem", "facts", "key_question", "timeline"],
      properties: {
        problem: { type: "string", description: "The main problem in one plain sentence." },
        facts: {
          type: "array",
          items: {
            type: "object", required: ["text", "status"],
            properties: {
              text: { type: "string" },
              status: { type: "string", enum: FACT_STATUS, description: "confirmed: checked by someone who knows (the driver on the spot, the site, a booking). reported: someone said so but nobody checked. planned: what the plan says should happen. unknown: we do not know yet." },
              sources: { type: "array", items: { type: "string" }, description: "Required unless the status is unknown." },
            },
          },
        },
        conflicts: {
          type: "array", description: "Where two sources disagree.",
          items: {
            type: "object", required: ["about", "sides"],
            properties: {
              about: { type: "string" },
              sides: { type: "array", items: { type: "object", required: ["says", "source"], properties: { says: { type: "string" }, source: { type: "string" } } } },
              resolved: { type: "string", description: "Which side turned out right and how we know, if settled." },
            },
          },
        },
        key_question: {
          type: "object", required: ["question", "ask", "why"],
          properties: {
            question: { type: "string", description: "The one question whose answer changes what we do." },
            ask: { type: "string", enum: ["driver", "pickup_contact", "customer", "nobody"], description: "Who can answer it. 'nobody' once it is answered." },
            why: { type: "string" },
            answer: { type: "string", description: "The answer, once you have it." },
            answer_source: { type: "string" },
          },
        },
        timeline: {
          type: "array", description: "The delivery as planned and as it really stands, in time order.",
          items: {
            type: "object", required: ["at", "what", "status"],
            properties: {
              at: { type: "string", description: "UTC, ISO 8601" },
              what: { type: "string" },
              status: { type: "string", enum: TIMELINE_STATUS },
              sources: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
    async run(args, ctx) {
      const listOf = (value: unknown) => Array.isArray(value) ? value.map(String) : []
      const facts = Array.isArray(args.facts) ? args.facts as Record<string, unknown>[] : []
      const conflicts = Array.isArray(args.conflicts) ? args.conflicts as { sides?: { source?: unknown }[] }[] : []
      const timeline = Array.isArray(args.timeline) ? args.timeline as Record<string, unknown>[] : []
      const question = (args.key_question ?? {}) as Record<string, unknown>
      const cited = [
        ...facts.flatMap((fact) => listOf(fact.sources)),
        ...conflicts.flatMap((conflict) => (conflict.sides ?? []).map((side) => String(side.source ?? ""))),
        ...timeline.flatMap((event) => listOf(event.sources)),
        ...(question.answer_source ? [String(question.answer_source)] : []),
      ].filter(Boolean)
      const unseen = unseenSources(cited, ctx)
      const problems = [
        !str(args.problem) && "problem is missing",
        !facts.length && "facts is empty",
        facts.some((fact) => !FACT_STATUS.includes(str(fact.status))) && `each fact needs a status: ${FACT_STATUS.join(", ")}`,
        facts.some((fact) => fact.status !== "unknown" && !listOf(fact.sources).length) && "only unknown facts may go without a source",
        !str(question.question) && "key_question.question is missing",
        timeline.some((event) => !isTime(event.at) || !TIMELINE_STATUS.includes(str(event.status))) && `every timeline entry needs an ISO time and a status: ${TIMELINE_STATUS.join(", ")}`,
        unseen.length > 0 && `these sources were not returned by any tool on this case: ${unseen.join(", ")}`,
      ].filter(Boolean)
      if (problems.length) return { content: { error: `Findings not recorded: ${problems.join("; ")}. Fix and try again.` }, summary: `Findings sent back by the checker: ${problems.join("; ")}` }
      const count = (status: string) => facts.filter((fact) => fact.status === status).length
      return {
        content: { ok: true, note: "Recorded. If the key question is still open, ask it. Otherwise move on to recovery." },
        summary: `Findings: ${count("confirmed")} confirmed, ${count("reported")} reported, ${count("unknown")} unknown${conflicts.length ? `, ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}` : ""}`,
      }
    },
  },
  {
    name: "take_action",
    kind: "act",
    description: `Do something yourself, without asking a person. Only works for the actions switched to automatic in policy: ${AUTO_ACTIONS.join(", ")}. Anything else is refused; hand it over with ask_person instead.`,
    parameters: {
      type: "object", required: ["action", "reason", "sources"],
      properties: {
        action: { type: "string", enum: AUTO_ACTIONS },
        reason: { type: "string", description: "One plain sentence on why, for the record." },
        sources: { type: "array", items: { type: "string" }, description: "What shows it is safe, as table/id." },
      },
    },
    async run(args, ctx) {
      const action = args.action
      if (!isActionKind(action) || ACTIONS[action].autonomy !== "auto") {
        return { content: { error: `${String(action)} needs a person's yes. Use ask_person.` }, summary: `Tried to ${isActionKind(action) ? ACTIONS[action].label.toLowerCase() : String(action)} on its own and was stopped: that needs a person` }
      }
      const sources = Array.isArray(args.sources) ? args.sources.map(String) : []
      const unseen = unseenSources(sources, ctx)
      if (!sources.length || unseen.length) return { content: { error: `Not done: cite the records that show it is safe${unseen.length ? `; not seen on this case: ${unseen.join(", ")}` : ""}.` }, summary: "" }
      // Nothing real is connected, so doing it means writing it down.
      return {
        content: { ok: true, simulated: true, note: "Done and recorded. People can see it on the case." },
        summary: `Did on its own (simulated): ${ACTIONS[action].label.toLowerCase()}. ${str(args.reason)}`,
      }
    },
  },
  {
    name: "ask_person",
    kind: "finish",
    description: "Hand the case to an operations person with exactly one decision to make. Use this when the next step changes something (a booking, a date, a cost, a message to the customer) or needs a call to the customer. Do the cheap work first so the person has everything they need. Every fact must cite at least one source as table/id.",
    parameters: {
      type: "object",
      required: ["headline", "situation", "facts", "recommendation"],
      properties: {
        headline: { type: "string", description: "One line a person reads first, for example: 'Bentley stopped near Göttingen, driver safe. Call the dealer: their roadside help or a tow?'" },
        situation: { type: "string", description: "Two or three plain sentences: what happened and where things stand." },
        facts: {
          type: "array",
          items: {
            type: "object", required: ["text", "sources"],
            properties: { text: { type: "string" }, sources: { type: "array", items: { type: "string", description: "table/id, for example messages/msg-x123 or agent_steps/step-abc" } } },
          },
        },
        unknowns: { type: "array", items: { type: "string" }, description: "What is still not known, so nobody assumes it." },
        recommendation: {
          type: "object", required: ["action", "summary"],
          properties: {
            action: { type: "string", enum: ACTION_KINDS },
            summary: { type: "string", description: "What should happen, in one or two sentences." },
            customer_message_draft: { type: "string", description: "If a customer should hear from us, a draft for the person to send or edit." },
            ...OPTION_SCORES,
          },
        },
        alternatives: { type: "array", items: { type: "object", required: ["action", "summary", "certainty"], properties: { action: { type: "string", enum: ACTION_KINDS }, summary: { type: "string" }, ...OPTION_SCORES } } },
        deadlines: {
          type: "array",
          description: "What must happen before when, earliest first. The desk shows these as a countdown instead of a risk badge. Include the last safe moment for the plan you recommend, hard cutoffs (check-in, the driver's limit, a site closing) and the delivery promise.",
          items: {
            type: "object", required: ["at", "what", "sources"],
            properties: {
              at: { type: "string", description: "UTC, ISO 8601" },
              what: { type: "string", description: "Short, for example 'Last safe time to redirect the driver' or 'Ferry check-in closes'." },
              miss: { type: "string", description: "What happens if it passes, in a few words." },
              zone: { type: "string", description: "IANA time zone of the place it happens, for example Europe/Berlin or Europe/Helsinki." },
              sources: { type: "array", items: { type: "string" } },
            },
          },
        },
        plan_b: {
          type: "object",
          description: "The fallback you prepared while waiting, so nobody starts from zero if plan A fails. Do the lookups for it before handing over.",
          required: ["trigger", "summary", "sources"],
          properties: {
            trigger: { type: "string", description: "When to switch, for example 'If the dealer has not answered by 12:00 Göttingen time'." },
            summary: { type: "string", description: "What we would do instead, in one or two sentences." },
            steps: { type: "array", items: { type: "string" } },
            action: { type: "string", enum: ACTION_KINDS },
            ...OPTION_SCORES,
            sources: { type: "array", items: { type: "string" } },
          },
        },
        impact: { type: "string", description: "What this means for the delivery promise, if anything." },
        urgency: { type: "string", enum: ["now", "today", "can_wait"] },
      },
    },
    async run(args, ctx) {
      const recommendation = (args.recommendation ?? {}) as Record<string, unknown>
      const facts = Array.isArray(args.facts) ? args.facts as { text?: unknown; sources?: unknown }[] : null
      const deadlines = Array.isArray(args.deadlines) ? args.deadlines as { at?: unknown; what?: unknown; sources?: unknown }[] : []
      const planB = (args.plan_b ?? null) as { trigger?: unknown; summary?: unknown; sources?: unknown } | null
      const listOf = (value: unknown) => Array.isArray(value) ? value.map(String) : []
      const alternatives = Array.isArray(args.alternatives) ? args.alternatives as Record<string, unknown>[] : []
      const cited = [
        ...(facts ?? []).flatMap((fact) => listOf(fact.sources)),
        ...deadlines.flatMap((deadline) => listOf(deadline.sources)),
        ...listOf(planB?.sources),
      ]
      const unseen = unseenSources(cited, ctx)
      const problems = [
        needsFreshFindings(ctx),
        !str(args.headline) && "headline is missing",
        str(args.headline).length > HEADLINE_MAX && `headline is ${str(args.headline).length} characters, keep it under ${HEADLINE_MAX}`,
        HAS_ID.test(str(args.headline)) && "the headline has an id or order number in it; name the car and the place instead",
        !facts?.length && "facts must be a non-empty list",
        facts?.some((fact) => !Array.isArray(fact.sources) || !fact.sources.length) && "every fact needs at least one source; if you have none, move it to unknowns",
        unseen.length > 0 && `these sources were not returned by any tool on this case: ${unseen.join(", ")}. Cite only ids you have seen, or drop the fact`,
        !isActionKind(recommendation.action) && `recommendation.action must be one of ${ACTION_KINDS.join(", ")}`,
        !CERTAINTY.includes(str(recommendation.certainty)) && `recommendation.certainty must be one of ${CERTAINTY.join(", ")}`,
        alternatives.some((option) => option.certainty !== undefined && !CERTAINTY.includes(str(option.certainty))) && `each alternative's certainty must be one of ${CERTAINTY.join(", ")}`,
        [recommendation, ...alternatives].some((option) => option.arrives_at !== undefined && !isTime(option.arrives_at)) && "arrives_at must be an ISO 8601 time",
        args.urgency !== "can_wait" && !deadlines.length && "deadlines is empty; say what must happen before when (at least the delivery promise and the last safe moment for your plan)",
        deadlines.some((deadline) => !isTime(deadline.at) || !str(deadline.what) || !listOf(deadline.sources).length) && "every deadline needs an ISO time in at, a what, and a source",
        args.urgency !== "can_wait" && (!planB || !str(planB.trigger) || !str(planB.summary)) && "plan_b is missing; prepare the fallback (look it up) and say when we would switch to it",
      ].filter(Boolean)
      if (problems.length) return { content: { error: `Not handed over: ${problems.join("; ")}. Fix and try again.` }, summary: `Hand-over sent back by the checker: ${problems.join("; ")}` }
      const action = recommendation.action as keyof typeof ACTIONS
      return {
        content: { ok: true, note: "Handed to a person. Wait for their decision." },
        summary: `Asked a person to decide: ${ACTIONS[action].label.toLowerCase()}`,
        // Earliest deadline first, so the desk can count down to the next one.
        finish: { status: "needs_person", headline: str(args.headline), pendingDecision: { ...args, deadlines: [...deadlines].sort((a, b) => String(a.at).localeCompare(String(b.at))) } },
      }
    },
  },
  {
    name: "close_case",
    kind: "finish",
    description: "Close the case when nothing more is needed from anyone: the problem is solved or was never a problem, and nothing needs changing.",
    parameters: {
      type: "object", required: ["summary"],
      properties: {
        summary: { type: "string", description: `One plain line for the desk, under ${HEADLINE_MAX} characters, no ids. For example: 'Queue cleared, driver checked in for the booked ferry. Nothing to change.'` },
        sources: { type: "array", items: { type: "string" }, description: "What shows it is solved, as table/id." },
      },
    },
    async run(args, ctx) {
      const summary = str(args.summary)
      const unseen = unseenSources(Array.isArray(args.sources) ? args.sources.map(String) : [], ctx)
      const problems = [
        needsFreshFindings(ctx),
        !summary && "summary is missing",
        summary.length > HEADLINE_MAX && `summary is ${summary.length} characters, keep it under ${HEADLINE_MAX}`,
        HAS_ID.test(summary) && "the summary has an id or order number in it; say it in plain words",
        unseen.length > 0 && `these sources were not returned by any tool on this case: ${unseen.join(", ")}`,
      ].filter(Boolean)
      if (problems.length) return { content: { error: `Not closed: ${problems.join("; ")}. Fix and try again.` }, summary: `Closing sent back by the checker: ${problems.join("; ")}` }
      return {
        content: { ok: true },
        summary: `Closed the case: ${str(args.summary)}`,
        finish: { status: "resolved", headline: str(args.summary), pendingDecision: null },
      }
    },
  },
]

export const toolSpecs: ToolSpec[] = tools.map((tool) => ({
  type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}))

export const findTool = (name: string) => tools.find((tool) => tool.name === name)
