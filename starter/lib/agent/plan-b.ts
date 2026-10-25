import { rows, type Bundle } from "@/lib/present/bundle"
import { loadOrder } from "@/lib/present/load"
import { buildRecordView } from "@/lib/present/record"
import type { RecordView } from "@/lib/present/types"
import type { Certainty } from "./labels"
import type { ActionKind } from "./policy"
import { needsApproval, rankOptions, whyFor, type Priority } from "./priority"
import { eq } from "drizzle-orm"
import { fmtDateTime } from "@/lib/present/time"
import { agentCases } from "@/lib/schema"
import { zoneForCity } from "./clock"
import { db } from "./conn"
import { scenarioFor } from "./scenarios"
import { backupDrivers, hotelOptions, planSailings, roadKm } from "./services"

export type CheckStatus = "found" | "none" | "not_needed" | "unknown"

export type PlanBCheck = { key: "ferry" | "driver" | "hotel" | "promise" | "next"; label: string; status: CheckStatus; text: string; sources: string[] }

export type RecoveryOption = {
  id: string
  action: ActionKind
  title: string
  summary: string
  arrives_at?: string
  cost_eur?: number
  cost_basis: string
  certainty: Certainty
  delivery: string
  risk: string
  needs_approval: boolean
  sources: string[]
}

export type RankedOption = RecoveryOption & { rank: number; why: string }

export type PlanB = {
  orderId: string
  status: "ready" | "insufficient"
  preparedAt: string
  asOf: string
  reason: string | null
  checks: PlanBCheck[]
  options: RecoveryOption[]
  boundary: string
}

export type RankedPlanB = Omit<PlanB, "options"> & { priority: Priority; options: RankedOption[] }

const BOUNDARY = "Nothing has been booked, cancelled or sent. These are quotes and estimates for a person to approve."
const DRIVER_EUR_PER_HOUR = 30
const CHECK_HOURS = 1.5

const euro = (value: number) => value.toLocaleString("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
const plusHours = (iso: string, hours: number) => new Date(new Date(iso).getTime() + hours * 3600_000).toISOString()

const JOURNEY = /driver|travel|ferry|sailing|crossing|terminal|train|flight|hotel|position|tracking|\beta\b|late|delay|promise|breakdown|warning|incident|tow|roadside|availability|start check|no.?show|queue|not at the pickup|cannot find/i

async function problemText(orderId: string, view: RecordView): Promise<string> {
  const cases = await db.select({ trigger: agentCases.trigger }).from(agentCases).where(eq(agentCases.orderId, orderId))
  return [
    ...view.attention.map((item) => `${item.title} ${item.detail ?? ""}`),
    ...cases.map((row) => row.trigger),
    scenarioFor(orderId)?.trigger ?? "",
  ].join(" ")
}

function promiseOf(view: RecordView) {
  const promise = view.header.keyDates.find((item) => item.key === "promise")
  return promise ? { start: promise.start, end: promise.end ?? promise.start, zone: promise.zone } : null
}

function againstPromise(arrives: string | undefined, view: RecordView): string {
  const promise = promiseOf(view)
  if (!arrives) return "No new arrival time could be worked out."
  const when = fmtDateTime(arrives, promise?.zone ?? zoneForCity(view.header.to.city))
  if (!promise) return `Arrives about ${when}. No delivery date has been promised yet.`
  const spare = (new Date(promise.end).getTime() - new Date(arrives).getTime()) / 3600_000
  return spare >= 0
    ? `Arrives about ${when}, ${Math.round(spare * 10) / 10} h inside the promise.`
    : `Arrives about ${when}, ${Math.round(-spare * 10) / 10} h after the promise ends. The customer would need to agree a new time.`
}

function currentEta(view: RecordView): string | null {
  return view.journey.groups.flatMap((group) => group.legs).map((leg) => leg.tracking?.eta).find(Boolean) ?? null
}

function feeEur(bundle: Bundle): number | null {
  const fees = rows(bundle, "work_assignments").map((row) => Number(row.details.fee_cents)).filter((value) => Number.isFinite(value) && value > 0)
  return fees.length ? Math.round(fees[0] / 100) : null
}

export async function preparePlanB(orderId: string): Promise<PlanB | null> {
  const loaded = await loadOrder(orderId)
  if (!loaded) return null
  const { bundle } = loaded
  const view = buildRecordView(bundle)
  const asOf = view.snapshotAt ?? new Date().toISOString()
  const base = { orderId, preparedAt: new Date().toISOString(), asOf, boundary: BOUNDARY }
  const steps = view.journey.groups.flatMap((group) => group.steps)
  const collected = steps.some((step) => step.role === "PICKUP" && step.recorded)
  const delivered = steps.some((step) => step.role === "DELIVERY" && step.recorded)

  if (delivered || view.header.status === "DELIVERED" || view.header.cancelledAt) {
    return {
      ...base, status: "insufficient", options: [], checks: [],
      reason: delivered || view.header.status === "DELIVERED"
        ? "This car has already been delivered, so there is no delivery left to protect. What is open here is paperwork or a claim, which a person handles from the record below."
        : "This order is cancelled, so there is no delivery to plan around.",
    }
  }

  const from = view.header.from.city
  const to = view.header.to.city
  const problem = view.attention[0]?.title ?? "the open point on this order"
  const checks: PlanBCheck[] = []
  const options: RecoveryOption[] = []
  const eta = currentEta(view)
  const promise = promiseOf(view)
  const journey = JOURNEY.test(await problemText(orderId, view))

  const holdArrives = eta ?? undefined
  const owner = view.attention[0]?.owner
  const openPoint = `“${problem.replace(/^(Open alert|Owned alert|Incident|Open conversation): /, "")}”`
  options.push({
    id: "hold", action: "hold_and_wait", title: journey ? "Keep the plan and confirm the facts first" : "Keep the plan and get the open point cleared",
    summary: journey
      ? `Ask the site or the driver to confirm ${problem.charAt(0).toLowerCase()}${problem.slice(1)} before changing anything.`
      : `Ask ${owner ?? "whoever holds it"} to resolve ${openPoint} before the driver travels.`,
    arrives_at: holdArrives, cost_eur: 0, cost_basis: "No extra cost.", certainty: "confirmed",
    delivery: holdArrives ? againstPromise(holdArrives, view) : "No change to today's plan. No driver-app arrival time yet.",
    risk: `If the problem turns out to be real, about ${CHECK_HOURS} h is lost before the next step starts.`,
    needs_approval: needsApproval("hold_and_wait"), sources: view.attention[0] ? [`${view.attention[0].section}/${view.attention[0].recordId}`] : [],
  })

  if (!journey) {
    checks.push(
      { key: "ferry", label: "Later ferry", status: "not_needed", text: "Not looked for. The open point is not about the journey, so a later sailing would not fix it.", sources: [] },
      { key: "driver", label: "Backup driver", status: "not_needed", text: "Not looked for. A different driver would face the same open point.", sources: [] },
      { key: "next", label: "Safe next step", status: "found", text: `Chase the open point with ${owner ?? "whoever holds it"} before the driver travels.`, sources: [] },
    )
    return {
      ...base, status: "insufficient", checks, options,
      reason: `This is about ${openPoint}, not the driver or the route. Another driver or a later sailing would not fix it, so there is no Plan B to prepare. The step is to get the open point cleared.`,
    }
  }

  const sailings = await planSailings({ orderId })
  const booked = view.reservations.find((item) => item.kind === "FERRY" && item.status !== "CANCELLED")
  const usable = sailings.plans.filter((plan) => plan.makes_check_in !== false && plan.status !== "SOLD_OUT")
    .filter((plan) => !booked?.departureAt || plan.delivered_at > (booked.arrivalAt ?? booked.departureAt))
    .sort((a, b) => a.delivered_at.localeCompare(b.delivered_at))
  if (!sailings.plans.length) {
    checks.push({ key: "ferry", label: "Later ferry", status: "not_needed", text: "No ferry on this route.", sources: [] })
  } else if (!usable.length) {
    checks.push({ key: "ferry", label: "Later ferry", status: "none", text: "No later sailing the driver can still make.", sources: sailings.plans.map((plan) => String(plan.sailing_source)) })
  } else {
    const plan = usable[0]
    const nights = plan.hotel_nights_near_terminal
    let hotelEur = 0
    let hotelSource: string | null = null
    if (nights.length) {
      const hotel = hotelOptions({ near: "the ferry terminal", night: nights[0] }).options[0]
      hotelEur = hotel.price_eur * nights.length
      hotelSource = hotel.source
    }
    const waitHours = Math.max(0, Number(plan.spare_before_check_in_hours ?? 0))
    const driverEur = Math.round(Math.min(waitHours, 24 * Math.max(1, nights.length)) * DRIVER_EUR_PER_HOUR / 10) * 10
    const ferryEur = plan.ferry_eur ?? 0
    checks.push({
      key: "ferry", label: "Later ferry", status: "found",
      text: `${usable.length} sailing${usable.length === 1 ? "" : "s"} still possible. Earliest: departs ${plan.departure_local}${plan.ferry_eur != null ? `, ${euro(plan.ferry_eur)} quoted` : ""}. Quotes can go stale, so refresh before booking.`,
      sources: [String(plan.sailing_source)],
    })
    if (hotelSource) checks.push({ key: "hotel", label: "Hotel fallback", status: "found", text: `${nights.length} night${nights.length === 1 ? "" : "s"} near the terminal, about ${euro(hotelEur)} (quote, not booked).`, sources: [hotelSource] })
    options.push({
      id: "ferry", action: "book_travel", title: nights.length ? "Move to the next sailing, with a hotel night" : "Move to the next sailing",
      summary: `Rebook the car on the sailing that departs ${plan.departure_local}.${nights.length ? ` The driver stays ${nights.length} night${nights.length === 1 ? "" : "s"} near the terminal.` : ""}`,
      arrives_at: plan.delivered_at, cost_eur: ferryEur + hotelEur + driverEur,
      cost_basis: [plan.ferry_eur != null ? `ferry ${euro(ferryEur)} quoted` : "ferry price not quoted", hotelEur ? `hotel about ${euro(hotelEur)}` : null, driverEur ? `driver waiting time about ${euro(driverEur)} (estimate at ${euro(DRIVER_EUR_PER_HOUR)}/h)` : null].filter(Boolean).join(", ") + ".",
      certainty: "quoted", delivery: againstPromise(plan.delivered_at, view),
      risk: "The quote is not a booking. The slot can sell out before a person approves it.",
      needs_approval: needsApproval("book_travel"), sources: [String(plan.sailing_source), ...(hotelSource ? [hotelSource] : [])],
    })
  }
  if (!checks.some((check) => check.key === "hotel")) {
    checks.push({ key: "hotel", label: "Hotel fallback", status: "not_needed", text: "None of the plans found needs a night away.", sources: [] })
  }

  const near = collected ? to : from
  const found = await backupDrivers({ near, excludeOrderId: orderId })
  const free = found.drivers.filter((driver) => !driver.on_another_job)
  if (!found.known_place) {
    checks.push({ key: "driver", label: "Backup driver", status: "unknown", text: `We do not know where ${near} is on the map, so nobody could be searched for.`, sources: [] })
  } else if (!free.length) {
    checks.push({ key: "driver", label: "Backup driver", status: "none", text: `No free driver lives within 400 km of ${near}.`, sources: [] })
  } else {
    const pick = free[0]
    checks.push({
      key: "driver", label: "Backup driver", status: "found",
      text: `${free.length} possible driver${free.length === 1 ? "" : "s"} near ${near}. Closest: ${pick.name}, ${pick.road_km_from_home} km away. Nobody has asked them yet.`,
      sources: [`${pick.table}/${pick.id}`],
    })
    const tripKm = roadKm(from, to)
    const reach = plusHours(asOf, pick.could_be_there_in_hours)
    const slot = view.header.keyDates.find((item) => item.key === "pickup_slot")
    const arrives = collected
      ? eta ? plusHours(eta, pick.could_be_there_in_hours) : undefined
      : sailings.plans.length
        ? usable[0]?.delivered_at
        : tripKm ? plusHours(slot && slot.start > reach ? slot.start : reach, tripKm / 75 + 0.5) : undefined
    const fee = feeEur(bundle) ?? (tripKm ? Math.round((tripKm * 0.6 + 80) / 10) * 10 : null)
    options.push({
      id: "driver", action: "other", title: "Offer the run to a backup driver",
      summary: `Ask ${pick.name} (${pick.road_km_from_home} km from ${near}) to take the car over if the current plan fails.`,
      arrives_at: arrives, cost_eur: fee ?? undefined,
      cost_basis: fee == null ? "No fee to compare with." : feeEur(bundle) ? `About the current driver fee, ${euro(fee)}, paid again.` : `Estimate from the route length, about ${euro(fee)}.`,
      certainty: "uncertain", delivery: againstPromise(arrives, view),
      risk: `Nobody has asked this driver. They may say no, and offering the job is a person's call.${collected ? " After pickup they would first have to reach the car, and nobody knows exactly where it is right now." : ""}`,
      needs_approval: true, sources: [`${pick.table}/${pick.id}`],
    })
  }

  checks.push({
    key: "promise", label: "Delivery impact", status: promise ? "found" : "unknown",
    text: promise ? (() => {
      const fastest = options.map((option) => option.arrives_at).filter((value): value is string => !!value).sort()[0]
      return fastest ? againstPromise(fastest, view).replace(/^Arrives/, "The fastest plan arrives") : "No plan has an arrival time yet."
    })() : "No delivery date has been promised yet.",
    sources: [],
  })
  checks.push({
    key: "next", label: "Safe next step", status: "found",
    text: options.length > 1 ? "Confirm the open point with the site or driver now, and keep the backup ready in case the answer is bad." : "Confirm the open point with the site or driver before anything changes.",
    sources: [],
  })

  const real = options.filter((option) => option.id !== "hold")
  return {
    ...base,
    status: real.length ? "ready" : "insufficient",
    reason: real.length ? null : "No later sailing or free backup driver turned up, so there is no safe alternative to prepare yet. Confirming the open point is the only step.",
    checks, options,
  }
}

export function rankPlanB(plan: PlanB, priority: Priority): RankedPlanB {
  const ranked = rankOptions(plan.options.map((option) => ({ option })), priority)
  return {
    ...plan, priority,
    options: ranked.map(({ option }, rank) => ({ ...option, rank, why: whyFor(option, plan.options, priority, rank === 0) })),
  }
}
