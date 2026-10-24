// Pretend outside services: roadside help, towing, ferries, hotels. Nothing
// here is real. Prices and times are made up but stable, so the same question
// gets the same answer every time and a demo can be rehearsed.
//
// Where the dataset already has a real-looking record (a ferry quote on the
// order, say) we return that with its id, and fill in the rest as simulated.

import { and, eq } from "drizzle-orm"
import { relatedRecords } from "@/lib/schema"
import { db } from "./conn"

// A small, stable hash so made-up numbers do not change between runs.
function seeded(text: string) {
  let hash = 2166136261
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return (min: number, max: number, salt = 0) => {
    const value = Math.abs(Math.imul(hash + salt * 7919, 2654435761)) % 1000 / 1000
    return Math.round(min + value * (max - min))
  }
}

const simId = (kind: string, text: string, n: number) => `simulated/${kind}-${Math.abs(seeded(text)(0, 99999, n)).toString(36)}${n}`

const PREMIUM = ["bentley", "porsche", "maserati", "ferrari", "lamborghini", "rolls", "aston", "mclaren", "tesla"]

export function roadsideHelp(input: { location: string; make?: string }) {
  const pick = seeded(input.location)
  const premium = PREMIUM.some((name) => input.make?.toLowerCase().includes(name))
  return {
    note: "Quotes only. Nothing is booked. The owner (customer) may have their own assistance contract and may want to choose.",
    premium_brand: premium,
    brand_note: premium ? `${input.make} owners often have manufacturer roadside assistance, and dealers may insist on it for warranty reasons. Ask the customer before booking anyone.` : null,
    options: [
      { source: simId("roadside", input.location, 1), provider: "Autobahn Pannenhilfe (fictional)", eta_minutes: pick(35, 80, 1), price_eur: pick(140, 220, 1), can_do: ["on-site check", "jump start", "read fault codes"], flatbed: false },
      { source: simId("roadside", input.location, 2), provider: "Kranwerk Abschlepp (fictional)", eta_minutes: pick(60, 120, 2), price_eur: pick(380, 640, 2), can_do: ["flatbed tow to nearest workshop"], flatbed: true },
    ],
  }
}

export function towQuote(input: { from: string; to: string }) {
  const pick = seeded(`${input.from}->${input.to}`)
  const km = pick(20, 600)
  return {
    note: "Quote only. Nothing is booked.",
    source: simId("tow", `${input.from}->${input.to}`, 1),
    from: input.from, to: input.to, distance_km: km,
    price_eur: 180 + Math.round(km * 2.4), earliest_pickup_minutes: pick(60, 180, 3), enclosed_transport: km > 150,
  }
}

export async function ferryOptions(orderId: string) {
  const rows = await db.select().from(relatedRecords).where(and(eq(relatedRecords.collection, "travel_options"), eq(relatedRecords.orderId, orderId)))
  const known = rows.filter((row) => row.details.kind === "FERRY").map((row): Record<string, unknown> => ({ source: `travel_options/${row.id}`, ...row.details }))
  // One more sailing a day after the latest known one, so there is always something to compare against.
  const latest = known.map((row) => String(row.departure_at ?? "")).sort().at(-1)
  const extra = latest ? (() => {
    const departure = new Date(new Date(latest).getTime() + 24 * 3600_000)
    const pick = seeded(`${orderId}-ferry`)
    return [{
      source: simId("ferry", orderId, 1), simulated: true, kind: "FERRY", provider: known[0]?.provider ?? "Vela Coast Lines",
      from_city: known[0]?.from_city, to_city: known[0]?.to_city, status: "AVAILABLE_QUOTE", capacity_note: "Vehicle slot quoted, not booked",
      departure_at: departure.toISOString(), arrival_at: new Date(departure.getTime() + 28 * 3600_000).toISOString(),
      check_in_cutoff_at: new Date(departure.getTime() - 2 * 3600_000).toISOString(), currency: "EUR", quote_cents: pick(30000, 42000),
    }]
  })() : []
  return { note: "A quote is not a booking. Nothing has been bought.", sailings: [...known, ...extra] }
}

export function hotelOptions(input: { near: string; night: string }) {
  const pick = seeded(`${input.near}-${input.night}`)
  return {
    note: "Quotes only. Nothing is booked.",
    options: [
      { source: simId("hotel", input.near, 1), name: `Hafenblick Inn, ${input.near} (fictional)`, price_eur: pick(70, 110, 1), walk_minutes_to_terminal: pick(5, 20, 1), free_cancellation_until: `${input.night}T18:00:00` },
      { source: simId("hotel", input.near, 2), name: `Terminal Lodge, ${input.near} (fictional)`, price_eur: pick(95, 150, 2), walk_minutes_to_terminal: pick(1, 8, 2), free_cancellation_until: `${input.night}T12:00:00` },
    ],
  }
}

/** How a delay would land against the customer's delivery promise. */
export async function delayImpact(input: { orderId: string; delayHours: number }) {
  const rows = await db.select().from(relatedRecords).where(eq(relatedRecords.orderId, input.orderId))
  const windows = rows.filter((row) => row.collection === "time_windows")
  const promise = windows.find((row) => row.details.purpose === "CUSTOMER_DELIVERY_PROMISE")
    ?? windows.find((row) => row.details.purpose === "SELECTED_DELIVERY_SLOT")
  const tracking = rows.filter((row) => row.collection === "tracking_observations" && row.details.estimated_delivery_at)
    .sort((a, b) => String(b.details.observed_at).localeCompare(String(a.details.observed_at)))[0]
  const eta = tracking ? new Date(String(tracking.details.estimated_delivery_at)) : null
  const newEta = eta ? new Date(eta.getTime() + input.delayHours * 3600_000) : null
  const promiseEnd = promise ? new Date(String(promise.details.end_at)) : null
  return {
    last_known_eta: eta?.toISOString() ?? null,
    eta_source: tracking ? `tracking_observations/${tracking.id}` : null,
    eta_observed_at: tracking?.details.observed_at ?? null,
    new_eta_if_delayed: newEta?.toISOString() ?? null,
    promise_window: promise ? { start: promise.details.start_at, end: promise.details.end_at, timezone: promise.details.timezone, source: `time_windows/${promise.id}`, set_by: promise.details.source } : null,
    misses_promise: newEta && promiseEnd ? newEta > promiseEnd : null,
    hours_late: newEta && promiseEnd ? Math.max(0, Math.round((newEta.getTime() - promiseEnd.getTime()) / 360_000) / 10) : null,
    note: "The ETA comes from the last driver-app position. If that position is old, treat this as a rough guide.",
  }
}
