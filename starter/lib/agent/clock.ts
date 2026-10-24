// The case clock and the countdowns on the desk. Safe to import from the browser.
//
// The data is a frozen snapshot, so a case starts at the snapshot time and
// then runs on with the real clock. A demo that has been open for twenty
// minutes is twenty minutes closer to its deadlines, which is the point.

const FINNISH = ["helsinki", "espoo", "vantaa", "turku", "tampere", "lahti", "oulu", "seinäjoki", "pori", "jyväskylä"]

/** The time zone people at a delivery city read clocks in. The dataset only spans Finland and Central Europe. */
export const zoneForCity = (city: string | null | undefined) => FINNISH.includes((city ?? "").toLowerCase()) ? "Europe/Helsinki" : "Europe/Berlin"

/** "Now" inside a case, in milliseconds. */
export function caseNow(snapshotAt: string | null | undefined, createdAt: string, wallNow = Date.now()): number {
  if (!snapshotAt) return wallNow
  return new Date(snapshotAt).getTime() + Math.max(0, wallNow - new Date(createdAt).getTime())
}

/** "42 min", "3 h 10 min", "2 days 4 h". */
export function span(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  if (hours < 24) return rest ? `${hours} h ${rest} min` : `${hours} h`
  const days = Math.floor(hours / 24), hoursLeft = hours % 24
  return `${days} day${days === 1 ? "" : "s"}${hoursLeft ? ` ${hoursLeft} h` : ""}`
}

export type Countdown = { left: string; passed: boolean; ms: number; tone: "danger" | "warn" | "neutral" }

export function countdown(at: string, now: number): Countdown {
  const ms = new Date(at).getTime() - now
  // Under an hour is "act now"; under four is "today, soon".
  const tone = ms <= 60 * 60_000 ? "danger" : ms <= 4 * 60 * 60_000 ? "warn" : "neutral"
  return { left: span(ms), passed: ms < 0, ms, tone }
}

export function clockIn(at: string, zone: string): string {
  return new Date(at).toLocaleString("en-GB", { timeZone: zone, weekday: "short", hour: "2-digit", minute: "2-digit" })
}

export const cityOfZone = (zone: string) => zone.split("/").pop()?.replaceAll("_", " ") ?? zone
