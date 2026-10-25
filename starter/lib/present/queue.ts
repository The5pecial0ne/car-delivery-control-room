import type { BoardCard, Tone } from "./types"

export type QueueCase = { id: string; orderId: string; status: "working" | "needs_person" | "resolved" | "failed"; updatedAt: string }

const TONE_RANK: Record<Tone, number> = { danger: 0, warn: 1, accent: 2, neutral: 3, ok: 4 }
const CASE_RANK: Record<QueueCase["status"], number> = { needs_person: 0, failed: 0, working: 1, resolved: 3 }

export const SEVERITY: Record<Tone, string> = { danger: "Critical", warn: "At risk", accent: "Owned", neutral: "Check", ok: "On track" }

export const CASE_STATUS: Record<QueueCase["status"], { label: string; tone: Tone }> = {
  needs_person: { label: "Decision needed", tone: "warn" },
  failed: { label: "Agent stopped", tone: "danger" },
  working: { label: "Agent working", tone: "accent" },
  resolved: { label: "Agent handled", tone: "ok" },
}

const WATCH_ORDER = ["moving", "booked", "market", "ready", "intake", "delivered", "cancelled"]

export function latestCases<T extends QueueCase>(cases: T[]): Map<string, T> {
  const byOrder = new Map<string, T>()
  for (const item of cases) {
    const known = byOrder.get(item.orderId)
    if (!known || item.updatedAt > known.updatedAt) byOrder.set(item.orderId, item)
  }
  return byOrder
}

export const needsPerson = (card: Pick<BoardCard, "attentionTone">) =>
  card.attentionTone === "danger" || card.attentionTone === "warn" || card.attentionTone === "accent"

export const needsAttention = (card: BoardCard, agentCase?: QueueCase | null) =>
  agentCase?.status === "needs_person" || agentCase?.status === "failed" ? true
    : agentCase?.status === "resolved" ? false
    : needsPerson(card)

export const followUp = (card: BoardCard) => needsPerson(card) ? null : card.attention[0] ?? null

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

export function watchStatus(card: BoardCard): { label: string; tone: Tone } {
  if (followUp(card)) return { label: "Followed up", tone: "neutral" }
  if (card.displayLane === "delivered") return { label: "Delivered", tone: "ok" }
  if (card.displayLane === "cancelled") return { label: "Cancelled", tone: "neutral" }
  return { label: "On track", tone: "ok" }
}
