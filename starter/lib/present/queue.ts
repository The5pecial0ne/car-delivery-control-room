// Splits the board into the orders a person has to look at and the ones that
// are simply being watched. "Needs attention" is the board's own rule (an order
// with attention items, from deriveAttention) plus any order whose agent case
// is waiting for a person or has stopped. Nothing else counts. Safe to import
// from the browser.

import type { BoardCard, Tone } from "./types"

export type QueueCase = { id: string; orderId: string; status: "working" | "needs_person" | "resolved" | "failed"; updatedAt: string }

const TONE_RANK: Record<Tone, number> = { danger: 0, warn: 1, accent: 2, neutral: 3, ok: 4 }
const CASE_RANK: Record<QueueCase["status"], number> = { needs_person: 0, failed: 0, working: 1, resolved: 3 }

/** In plain words, how bad it is. Shown next to an icon, never as colour alone. */
export const SEVERITY: Record<Tone, string> = { danger: "Critical", warn: "At risk", accent: "Owned", neutral: "Check", ok: "On track" }

export const CASE_STATUS: Record<QueueCase["status"], { label: string; tone: Tone }> = {
  needs_person: { label: "Decision needed", tone: "warn" },
  failed: { label: "Agent stopped", tone: "danger" },
  working: { label: "Agent working", tone: "accent" },
  resolved: { label: "Agent handled", tone: "ok" },
}

/** The order the stages are watched in: the cars that are moving first. */
const WATCH_ORDER = ["moving", "booked", "market", "ready", "intake", "delivered", "cancelled"]

/** The newest case for each order. */
export function latestCases<T extends QueueCase>(cases: T[]): Map<string, T> {
  const byOrder = new Map<string, T>()
  for (const item of cases) {
    const known = byOrder.get(item.orderId)
    if (!known || item.updatedAt > known.updatedAt) byOrder.set(item.orderId, item)
  }
  return byOrder
}

export const needsAttention = (card: BoardCard, agentCase?: QueueCase | null) =>
  card.attention.length > 0 || agentCase?.status === "needs_person" || agentCase?.status === "failed"

export function splitQueue<T extends QueueCase>(cards: BoardCard[], cases: Map<string, T>): { attention: BoardCard[]; monitored: BoardCard[] } {
  const attention: BoardCard[] = []
  const monitored: BoardCard[] = []
  for (const card of cards) (needsAttention(card, cases.get(card.id)) ? attention : monitored).push(card)

  const caseRank = (card: BoardCard) => {
    const status = cases.get(card.id)?.status
    return status ? CASE_RANK[status] : 2
  }
  attention.sort((a, b) => caseRank(a) - caseRank(b)
    || TONE_RANK[a.attentionTone] - TONE_RANK[b.attentionTone]
    || (a.decisive?.start ?? "~").localeCompare(b.decisive?.start ?? "~")
    || b.updatedAt.localeCompare(a.updatedAt))
  monitored.sort((a, b) => WATCH_ORDER.indexOf(a.displayLane) - WATCH_ORDER.indexOf(b.displayLane)
    || (a.decisive?.start ?? "~").localeCompare(b.decisive?.start ?? "~"))
  return { attention, monitored }
}

/** How a watched order is doing, in two or three words. */
export function watchStatus(card: BoardCard): { label: string; tone: Tone } {
  if (card.displayLane === "delivered") return { label: "Delivered", tone: "ok" }
  if (card.displayLane === "cancelled") return { label: "Cancelled", tone: "neutral" }
  return { label: "On track", tone: "ok" }
}
