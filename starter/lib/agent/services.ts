// Pretend outside services: roadside help, towing, ferries, hotels. Nothing
// here is real. Prices and times are made up but stable, so the same question
// gets the same answer every time and a demo can be rehearsed.
//
// Where the dataset already has a real-looking record (a ferry quote on the
// order, say) we return that with its id, and fill in the rest as simulated.

import { and, eq } from "drizzle-orm"
import { drivers, relatedRecords } from "@/lib/schema"
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

// Rough coordinates for the places the dataset uses, so distances look like
// the real map instead of a random number. Matching is by name inside the text
// the agent passes, so "Rasthof Holledau, A9" and "Hamburg, Germany" both work.
const PLACES: Record<string, [number, number]> = {
  helsinki: [60.17, 24.94], espoo: [60.21, 24.66], vantaa: [60.29, 25.04], turku: [60.45, 22.27], tampere: [61.5, 23.76],
  lahti: [60.98, 25.66], oulu: [65.01, 25.47], seinäjoki: [62.79, 22.84], pori: [61.48, 21.8],
  hamburg: [53.55, 9.99], munich: [48.14, 11.58], münchen: [48.14, 11.58], holledau: [48.6, 11.62], frankfurt: [50.11, 8.68],
  cologne: [50.94, 6.96], köln: [50.94, 6.96], düsseldorf: [51.23, 6.77], leipzig: [51.34, 12.37], berlin: [52.52, 13.4],
  stuttgart: [48.78, 9.18], göttingen: [51.54, 9.93], kassel: [51.31, 9.48], hannover: [52.37, 9.73], hanover: [52.37, 9.73], jyväskylä: [62.24, 25.75], ghent: [51.05, 3.72], uppsala: [59.86, 17.64], nuremberg: [49.45, 11.08], nürnberg: [49.45, 11.08], ingolstadt: [48.77, 11.43],
  copenhagen: [55.68, 12.57], odense: [55.4, 10.39], aarhus: [56.16, 10.2], aalborg: [57.05, 9.92],
  stockholm: [59.33, 18.07], gothenburg: [57.71, 11.97], malmö: [55.6, 13.0],
  lyon: [45.76, 4.84], lille: [50.63, 3.06], paris: [48.86, 2.35], marseille: [43.3, 5.37], bordeaux: [44.84, -0.58],
  antwerp: [51.22, 4.4], rotterdam: [51.92, 4.48], vienna: [48.21, 16.37], graz: [47.07, 15.44],
}

function locate(text: string): [number, number] | null {
  const lower = text.toLowerCase()
  const hit = Object.keys(PLACES).filter((name) => lower.includes(name)).sort((a, b) => b.length - a.length)[0]
  return hit ? PLACES[hit] : null
}

/** Road distance in km between two places, or null if we do not know one of them. */
export function roadKm(from: string, to: string): number | null {
  const a = locate(from), b = locate(to)
  if (!a || !b) return null
  const rad = Math.PI / 180
  const h = Math.sin((b[0] - a[0]) * rad / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin((b[1] - a[1]) * rad / 2) ** 2
  // Straight line times a usual detour factor for roads.
  return Math.max(5, Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 1.25))
}

/**
 * Drivers who live near a place and have no job in progress or accepted,
 * nearest first. Whether they would take the job is not known: nobody has
 * asked them, and the agent cannot.
 */
export async function backupDrivers(input: { near: string; excludeOrderId?: string }) {
  const [all, jobs] = await Promise.all([
    db.select().from(drivers),
    db.select().from(relatedRecords).where(eq(relatedRecords.collection, "work_assignments")),
  ])
  const busy = new Set(jobs.filter((job) => ["IN_PROGRESS", "ACCEPTED", "ASSIGNED"].includes(String(job.details.status))).map((job) => String(job.details.driver_id)))
  const bookedHere = new Set(jobs.filter((job) => job.orderId === input.excludeOrderId).map((job) => String(job.details.driver_id)))
  const found = all
    .filter((driver) => driver.details.active !== false && !bookedHere.has(driver.id))
    .map((driver) => ({ driver, km: roadKm(input.near, driver.homeCity) }))
    .filter((row): row is { driver: typeof row.driver; km: number } => row.km != null && row.km <= 400)
    .sort((a, b) => a.km - b.km)
  return {
    note: "Availability is not confirmed. These drivers have no job in progress, but nobody has asked them. Offering the job is a person's decision.",
    known_place: locate(input.near) != null,
    drivers: found.slice(0, 5).map(({ driver, km }) => ({
      table: "drivers", id: driver.id, name: driver.displayName, home: `${driver.homeCity}, ${driver.homeCountry}`,
      road_km_from_home: km, could_be_there_in_hours: Math.round((km / 80 + 0.75) * 10) / 10,
      on_another_job: busy.has(driver.id),
    })),
  }
}

export function towQuote(input: { from: string; to: string }) {
  const pick = seeded(`${input.from}->${input.to}`)
  const known = roadKm(input.from, input.to)
  const km = known ?? pick(20, 600)
  return {
    note: "Quote only. Nothing is booked.",
    source: simId("tow", `${input.from}->${input.to}`, 1),
    from: input.from, to: input.to, distance_km: km,
    distance_note: known ? "Road distance estimated from the map." : "One of the places was not recognised, so the distance is a guess. Name a city to get a better quote.",
    price_eur: 180 + Math.round(km * 2.4), earliest_pickup_minutes: pick(60, 180, 3), enclosed_transport: km > 150,
    // A truck averages about 65 km/h over a long run, plus loading.
    transit_hours: Math.round((km / 65 + 1) * 10) / 10,
  }
}

const localTime = (iso: string | null | undefined, timezone: unknown) => {
  if (!iso) return null
  const zone = typeof timezone === "string" ? timezone : "UTC"
  return `${new Date(iso).toLocaleString("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} (${zone})`
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
  const sailings = ([...known, ...extra] as Record<string, unknown>[]).map((sailing): Record<string, unknown> => ({
    ...sailing,
    departure_local: localTime(sailing.departure_at as string, "Europe/Berlin"),
    check_in_cutoff_local: localTime(sailing.check_in_cutoff_at as string, "Europe/Berlin"),
    arrival_local: localTime(sailing.arrival_at as string, "Europe/Helsinki"),
  }))
  return { note: "A quote is not a booking. Nothing has been bought. Use plan_sailings to see what each one means for the driver and the delivery.", sailings }
}

const hoursBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 360_000) / 10
// Nights in a hotel between reaching the terminal and sailing, counted as the
// local dates you go to bed on. Under six hours of waiting needs no hotel.
function hotelNights(atTerminal: Date, departure: Date, zone: string): string[] {
  if (hoursBetween(atTerminal, departure) < 6) return []
  const day = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: zone })
  const nights: string[] = []
  for (let night = new Date(atTerminal); day(night) < day(departure); night = new Date(night.getTime() + 24 * 3600_000)) nights.push(day(night))
  return nights
}

/**
 * Works out, for every sailing on the order, the whole day plan: when the
 * driver can be at the terminal, whether they make check-in, how many hotel
 * nights it takes, and when the car reaches the buyer against the promise.
 * Plain arithmetic, so the agent does not have to do dates in its head.
 */
export async function planSailings(input: { orderId: string; onwardDriveHours?: number; readyAt?: string }) {
  const [{ sailings }, rows] = await Promise.all([
    ferryOptions(input.orderId),
    db.select().from(relatedRecords).where(eq(relatedRecords.orderId, input.orderId)),
  ])
  const windows = rows.filter((row) => row.collection === "time_windows")
  const pickup = windows.find((row) => row.details.purpose === "SELECTED_PICKUP_SLOT")
  const promise = windows.find((row) => row.details.purpose === "CUSTOMER_DELIVERY_PROMISE") ?? windows.find((row) => row.details.purpose === "SELECTED_DELIVERY_SLOT")
  const promiseEnd = promise ? new Date(String(promise.details.end_at)) : null
  const promiseZone = String(promise?.details.timezone ?? "UTC")
  const ready = input.readyAt ? new Date(input.readyAt) : pickup ? new Date(String(pickup.details.end_at)) : null
  // We do not know the road from the far terminal to the buyer, so the agent can say; two hours is a cautious default.
  const onward = input.onwardDriveHours ?? 2

  const plans = sailings.filter((sailing) => sailing.status !== "SOLD_OUT").map((sailing) => {
    const roadHours = Number(sailing.road_time_to_terminal_hours ?? 7)
    const departure = new Date(String(sailing.departure_at))
    const cutoff = new Date(String(sailing.check_in_cutoff_at))
    const arrival = new Date(String(sailing.arrival_at))
    const atTerminal = ready ? new Date(ready.getTime() + roadHours * 3600_000) : null
    const delivered = new Date(arrival.getTime() + onward * 3600_000)
    const nights = atTerminal ? hotelNights(atTerminal, departure, "Europe/Berlin") : []
    return {
      sailing_source: sailing.source,
      status: sailing.status,
      departure_local: sailing.departure_local,
      check_in_cutoff_local: sailing.check_in_cutoff_local,
      ferry_eur: typeof sailing.quote_cents === "number" ? sailing.quote_cents / 100 : null,
      at_terminal_local: atTerminal ? localTime(atTerminal.toISOString(), "Europe/Berlin") : null,
      makes_check_in: atTerminal ? atTerminal <= cutoff : null,
      spare_before_check_in_hours: atTerminal ? hoursBetween(atTerminal, cutoff) : null,
      hotel_nights_near_terminal: nights,
      delivered_at: delivered.toISOString(),
      delivered_local: localTime(delivered.toISOString(), promiseZone),
      inside_promise: promiseEnd ? delivered <= promiseEnd : null,
      hours_spare_before_promise_ends: promiseEnd ? hoursBetween(delivered, promiseEnd) : null,
    }
  })
  return {
    note: "Arithmetic on the quotes and the order's own times. Hotel nights are local dates. Times marked local carry their zone.",
    driver_ready_from: ready ? { at_local: localTime(ready.toISOString(), "Europe/Berlin"), basis: input.readyAt ? "the time you gave" : "end of the selected pickup slot", source: pickup && !input.readyAt ? `time_windows/${pickup.id}` : null } : null,
    onward_drive_hours: onward,
    onward_drive_basis: input.onwardDriveHours != null ? "the hours you gave" : "a cautious default; ask the driver or give onward_drive_hours if you know better",
    promise: promise ? { local: `${localTime(String(promise.details.start_at), promiseZone)} to ${localTime(String(promise.details.end_at), promiseZone)}`, source: `time_windows/${promise.id}` } : null,
    plans,
  }
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


/**
 * How a delay, or a new arrival time, would land against the customer's
 * delivery promise. With new_arrival_at the agent can check a plan directly,
 * which works before pickup too, when there is no ETA from the driver app yet.
 */
export async function delayImpact(input: { orderId: string; delayHours?: number; newArrivalAt?: string }) {
  const rows = await db.select().from(relatedRecords).where(eq(relatedRecords.orderId, input.orderId))
  const windows = rows.filter((row) => row.collection === "time_windows")
  const promise = windows.find((row) => row.details.purpose === "CUSTOMER_DELIVERY_PROMISE")
    ?? windows.find((row) => row.details.purpose === "SELECTED_DELIVERY_SLOT")
  const tracking = rows.filter((row) => row.collection === "tracking_observations" && row.details.estimated_delivery_at)
    .sort((a, b) => String(b.details.observed_at).localeCompare(String(a.details.observed_at)))[0]
  const eta = tracking ? new Date(String(tracking.details.estimated_delivery_at)) : null
  const given = input.newArrivalAt ? new Date(input.newArrivalAt) : null
  const newEta = given && !Number.isNaN(given.getTime()) ? given : eta ? new Date(eta.getTime() + (input.delayHours ?? 0) * 3600_000) : null
  const promiseEnd = promise ? new Date(String(promise.details.end_at)) : null
  const zone = promise?.details.timezone
  return {
    last_known_eta: eta?.toISOString() ?? null,
    eta_source: tracking ? `tracking_observations/${tracking.id}` : null,
    eta_observed_at: tracking?.details.observed_at ?? null,
    new_eta: newEta?.toISOString() ?? null,
    new_eta_local: localTime(newEta?.toISOString(), zone),
    new_eta_basis: given ? "the arrival time you gave" : eta ? "last known ETA plus the delay" : "nothing to go on: give new_arrival_at",
    promise_window: promise ? {
      start: promise.details.start_at, end: promise.details.end_at, timezone: zone,
      local: `${localTime(String(promise.details.start_at), zone)} to ${localTime(String(promise.details.end_at), zone)}`,
      source: `time_windows/${promise.id}`, set_by: promise.details.source,
    } : null,
    misses_promise: newEta && promiseEnd ? newEta > promiseEnd : null,
    hours_late: newEta && promiseEnd ? Math.max(0, Math.round((newEta.getTime() - promiseEnd.getTime()) / 360_000) / 10) : null,
    hours_spare: newEta && promiseEnd ? Math.max(0, Math.round((promiseEnd.getTime() - newEta.getTime()) / 360_000) / 10) : null,
    note: "Times are UTC unless marked local. An ETA from an old driver-app position is only a rough guide.",
  }
}

export { localTime }
