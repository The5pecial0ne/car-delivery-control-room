// The tools the agent can use. They come in three kinds:
//
//   lookup  reads the order's records. Free, and always the first thing to try.
//   ask     talks to someone the agent is allowed to contact (the driver).
//   finish  hands the case to a person with one decision, or closes it.
//
// Every record that comes back carries its table and id, so the agent can cite
// where each fact came from and the control room can link to it.

import { and, desc, eq, inArray, sql } from "drizzle-orm"
import { addresses, alerts, conversations, customers, drivers, messages, orderItems, orders, relatedRecords, vehicles } from "@/lib/schema"
import { db } from "./conn"
import { simulateDriverReply } from "./driver"
import { delayImpact, ferryOptions, hotelOptions, roadsideHelp, towQuote } from "./services"
import type { CompleteFn, ToolSpec } from "./model"
import { ACTION_KINDS, ACTIONS, isActionKind } from "./policy"
import { addStep, type CaseRow, type CaseStatus } from "./store"

export type ToolContext = { caseRow: CaseRow; complete: CompleteFn }
export type ToolOutcome = {
  content: unknown
  // One plain line for the trace, written for an operations person.
  summary: string
  // Set when the tool ends the agent's turn.
  finish?: { status: CaseStatus; headline: string; pendingDecision: Record<string, unknown> | null }
}
type Tool = {
  name: string
  kind: "lookup" | "ask" | "finish"
  description: string
  parameters: Record<string, unknown>
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>
}

const str = (value: unknown) => typeof value === "string" ? value : ""
const orderArg = { order_id: { type: "string", description: "Order id such as ord-00322. Leave out to use this case's order." } }
const orderOf = (args: Record<string, unknown>, ctx: ToolContext) => str(args.order_id) || ctx.caseRow.orderId

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
      const [[customer], items, places, windows, assignments] = await Promise.all([
        db.select().from(customers).where(eq(customers.id, order.customerId)).limit(1),
        db.select({ item: orderItems, vehicle: vehicles }).from(orderItems).innerJoin(vehicles, eq(orderItems.vehicleId, vehicles.id)).where(eq(orderItems.orderId, id)),
        db.select().from(addresses).where(inArray(addresses.id, [order.pickupAddressId, order.deliveryAddressId])),
        relatedFor(id, ["time_windows"]),
        relatedFor(id, ["work_assignments"]),
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
          time_windows: windows,
          driver_work: assignments.map((row) => ({ ...row, driver: driverRows.find((driver) => driver.id === row.driver_id)?.displayName ?? null })),
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
    description: "What a delay of N hours does to the customer's delivery promise, based on the last known ETA.",
    parameters: { type: "object", required: ["delay_hours"], properties: { ...orderArg, delay_hours: { type: "number" } } },
    async run(args, ctx) {
      const hours = Number(args.delay_hours) || 0
      const result = await delayImpact({ orderId: orderOf(args, ctx), delayHours: hours })
      const verdict = result.misses_promise == null ? "no promise on file to compare with" : result.misses_promise ? `would miss the promise by about ${result.hours_late} h` : "still inside the promise"
      return { summary: `Checked a ${hours} h delay against the delivery promise: ${verdict}`, content: result }
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
    name: "ask_person",
    kind: "finish",
    description: "Hand the case to an operations person with exactly one decision to make. Use this when the next step changes something (a booking, a date, a cost, a message to the customer) or needs a call to the customer. Do the cheap work first so the person has everything they need. Every fact must cite at least one source as table/id.",
    parameters: {
      type: "object",
      required: ["headline", "situation", "facts", "recommendation"],
      properties: {
        headline: { type: "string", description: "One line a person reads first, for example: 'Bentley stopped near Munich, driver safe. Call the dealer: their roadside help or a tow?'" },
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
            cost_eur: { type: "number" },
          },
        },
        alternatives: { type: "array", items: { type: "object", required: ["action", "summary"], properties: { action: { type: "string", enum: ACTION_KINDS }, summary: { type: "string" } } } },
        impact: { type: "string", description: "What this means for the delivery promise, if anything." },
        urgency: { type: "string", enum: ["now", "today", "can_wait"] },
      },
    },
    async run(args) {
      const recommendation = (args.recommendation ?? {}) as Record<string, unknown>
      const problems = [
        !str(args.headline) && "headline is missing",
        !Array.isArray(args.facts) && "facts must be a list",
        !isActionKind(recommendation.action) && `recommendation.action must be one of ${ACTION_KINDS.join(", ")}`,
      ].filter(Boolean)
      if (problems.length) return { content: { error: `Not handed over: ${problems.join("; ")}. Fix and try again.` }, summary: "" }
      const action = recommendation.action as keyof typeof ACTIONS
      return {
        content: { ok: true, note: "Handed to a person. Wait for their decision." },
        summary: `Asked a person to decide: ${ACTIONS[action].label.toLowerCase()}`,
        finish: { status: "needs_person", headline: str(args.headline), pendingDecision: args },
      }
    },
  },
  {
    name: "close_case",
    kind: "finish",
    description: "Close the case when nothing more is needed from anyone: the problem is solved or was never a problem, and nothing needs changing.",
    parameters: { type: "object", required: ["summary"], properties: { summary: { type: "string" }, sources: { type: "array", items: { type: "string" } } } },
    async run(args) {
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
