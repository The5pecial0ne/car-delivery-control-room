"use client"

// The two kinds of order card on the control room. A queue card is a compact
// row for an order that needs a person. A watch card is one glance at an order
// that is going to plan.

import { caseNow, countdown } from "@/lib/agent/clock"
import { followUp, watchStatus } from "@/lib/present/queue"
import { fmtDateTime, relativeTo } from "@/lib/present/time"
import type { BoardCard, Tone } from "@/lib/present/types"
import { dateText } from "./card"
import type { CaseSummary } from "./case-view"
import { nextDeadline } from "./decision-extras"
import { Icon } from "./icons"


/** The deadline a card leads with: the agent's next countdown when it waits on a decision, else the order's decisive date. */
export function cardDeadline(card: BoardCard, agentCase: CaseSummary | null | undefined, snapshotAt: string | null, wall: number): { text: string; tone: Tone; left?: string } | null {
  const decision = agentCase?.status === "needs_person" ? agentCase.pendingDecision : null
  const next = decision && agentCase ? nextDeadline(decision.deadlines, caseNow(snapshotAt, agentCase.createdAt, wall)) : null
  if (next && agentCase) {
    const left = countdown(next.at, caseNow(snapshotAt, agentCase.createdAt, wall))
    return { text: `${left.left} left`, tone: left.tone, left: left.left }
  }
  const date = card.decisive
  // Only a date still ahead is a deadline. "Order created" never is.
  if (!date || date.key === "created" || !snapshotAt || new Date(date.end ?? date.start).getTime() <= new Date(snapshotAt).getTime()) return null
  return { text: date.note && /^in /.test(date.note) ? `${date.label.toLowerCase()} ${date.note}` : `${date.label.toLowerCase()} ${dateText(date.start, date.end, date.zone)}`, tone: date.tone }
}

/**
 * One order that needs a person, kept to four short lines: what car and where,
 * how serious, how long is left, and whether someone has to decide. Everything
 * else waits in the workspace that opens on click.
 */
export function QueueCard({ card, agentCase, snapshotAt, wall, active, onSelect }: {
  card: BoardCard; agentCase?: CaseSummary; snapshotAt: string | null; wall: number; active: boolean; onSelect: (id: string) => void
}) {
  const critical = card.attentionTone === "danger" || agentCase?.status === "failed"
  const deadline = cardDeadline(card, agentCase, snapshotAt, wall)
  // A person decides when the agent's hand-over waits, the agent stopped, or another agent left a proposal to review.
  const decision = agentCase?.status === "needs_person" || agentCase?.status === "failed" || card.attention.some((item) => item.kind === "proposal")
  const when = deadline?.left ? `Time left: ${deadline.left}` : deadline ? `Next: ${deadline.text}` : "No deadline ahead"
  // Otherwise, say who has the next move, so "Critical" never sits next to "nothing to do".
  const owner = card.attention.find((item) => item.owner)?.owner
  const next = decision ? "Decision needed"
    : agentCase?.status === "working" ? "Agent is working on it"
    : owner ? `With ${owner}` : "Not picked up yet"

  return <button type="button" className={`queue-card sev-${critical ? "danger" : "warn"}${active ? " active" : ""}`} onClick={() => onSelect(card.id)} aria-current={active ? "true" : undefined}
    title={`${card.reference} · ${card.attention[0]?.title ?? ""}`}>
    <span className="queue-card-car"><b>{card.vehicle}</b><span aria-hidden="true">·</span><small>{card.from.city}<Icon name="arrow" size={11} />{card.to.city}</small></span>
    <span className="queue-card-facts">
      <span className={`queue-card-sev${critical ? " is-critical" : ""}`}><Icon name={critical ? "alert" : "dot"} size={12} />{critical ? "Critical" : "Not critical"}</span>
      <span className={`queue-card-when tone-${deadline?.tone ?? "subtle"}`}><Icon name="waiting" size={12} />{when}</span>
      <span className={`queue-card-decide${decision ? " is-needed" : ""}`}><Icon name={decision ? "proposal" : "people"} size={12} />{next}</span>
    </span>
  </button>
}

export function WatchCard({ card, agentCase, snapshotAt, active, onSelect }: { card: BoardCard; agentCase?: CaseSummary; snapshotAt: string | null; active: boolean; onSelect: (id: string) => void }) {
  const handled = agentCase?.status === "resolved"
  const status = handled ? { label: "Agent handled", tone: "ok" as Tone } : watchStatus(card)
  const follow = handled ? null : followUp(card)
  const driver = card.work.find((line) => line.icon === "driver" || line.icon === "offer")
  const date = card.decisive
  const milestone = driver?.text ?? (date ? `${date.label} ${dateText(date.start, date.end, date.zone)}` : null)
  const updated = relativeTo(card.updatedAt, snapshotAt)
  return <button type="button" className={`watch-card${active ? " active" : ""}`} onClick={() => onSelect(card.id)} aria-current={active ? "true" : undefined}>
    <span className="watch-card-top"><span className="watch-card-car">{card.vehicle}</span><span className="mono">{card.reference}</span></span>
    <span className="watch-card-route">{card.from.city}<Icon name="arrow" size={11} />{card.to.city}<span className={`watch-card-status tone-${status.tone}`}><Icon name={status.tone === "ok" ? "check" : "dot"} size={11} />{status.label}</span></span>
    {milestone && <span className="watch-card-next">{milestone}</span>}
    {handled
      ? <span className="watch-card-checked">Agent: {agentCase?.headline ?? "closed the case"}</span>
      : follow
      ? <span className="watch-card-checked">Followed up: {follow.short}</span>
      : card.checks.length > 0 && <span className="watch-card-checked">Checked: {card.checks.join(" · ")}</span>}
    <span className="watch-card-when">Updated <time dateTime={card.updatedAt}>{fmtDateTime(card.updatedAt, date?.zone ?? null)}</time>{updated ? ` · ${updated.text}` : ""}</span>
  </button>
}
