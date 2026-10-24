"use client"

// The two kinds of order card on the control room. A queue card says what is
// wrong, why a person is needed, how long is left and what the agent already
// checked. A watch card is one glance at an order that is going to plan.

import { caseNow, countdown } from "@/lib/agent/clock"
import { actionLabel } from "@/lib/agent/labels"
import { CASE_STATUS, SEVERITY, watchStatus } from "@/lib/present/queue"
import { fmtDateTime, relativeTo } from "@/lib/present/time"
import type { BoardCard, Tone } from "@/lib/present/types"
import { dateText } from "./card"
import type { CaseSummary } from "./case-view"
import { nextDeadline } from "./decision-extras"
import { Icon } from "./icons"

const SEVERITY_ICON: Record<Tone, string> = { danger: "alert", warn: "alert", accent: "driver", neutral: "note", ok: "check" }
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

export function QueueCard({ card, agentCase, snapshotAt, wall, active, onSelect }: {
  card: BoardCard; agentCase?: CaseSummary; snapshotAt: string | null; wall: number; active: boolean; onSelect: (id: string) => void
}) {
  const first = card.attention[0]
  const status = agentCase ? CASE_STATUS[agentCase.status] : null
  const decision = agentCase?.status === "needs_person" ? agentCase.pendingDecision : null
  const caseLed = agentCase?.status === "needs_person" || agentCase?.status === "failed"
  const more = card.attention.length > 1 ? ` · +${card.attention.length - 1} more` : ""

  const wrong = caseLed ? agentCase?.headline ?? agentCase?.trigger : first?.title
  const why = decision ? `One decision is waiting: ${lower(actionLabel(decision.recommendation?.action))}.`
    : agentCase?.status === "failed" ? "The agent stopped before it finished. Someone needs to pick it up."
    : first ? `${first.detail ?? (first.owner ? `${first.owner} owns the next step.` : first.short)}${more}` : null

  let deadline: { text: string; tone: Tone } | null = null
  const next = decision && agentCase ? nextDeadline(decision.deadlines, caseNow(snapshotAt, agentCase.createdAt, wall)) : null
  if (next && agentCase) {
    const left = countdown(next.at, caseNow(snapshotAt, agentCase.createdAt, wall))
    deadline = { text: `${left.left} left`, tone: left.tone }
  } else if (card.decisive) {
    const date = card.decisive
    deadline = { text: date.note && /^in /.test(date.note) ? `${date.label.toLowerCase()} ${date.note}` : `${date.label.toLowerCase()} ${dateText(date.start, date.end, date.zone)}`, tone: date.tone }
  }

  const proposal = card.attention.find((item) => item.kind === "proposal")
  const checked = agentCase?.status === "needs_person" ? `${decision?.facts?.length ?? 0} facts with sources${decision?.unknowns?.length ? `, ${decision.unknowns.length} still unknown` : ""}`
    : agentCase?.status === "working" ? "Looking into it right now"
    : agentCase?.status === "resolved" ? `Handled: ${agentCase.headline ?? "case closed"}`
    : agentCase?.status === "failed" ? "Stopped part way, see the case"
    : proposal ? `Another agent left a proposal: ${lower(proposal.title)}`
    : "Not checked by the agent yet"

  return <button type="button" className={`queue-card sev-${card.attentionTone}${active ? " active" : ""}`} onClick={() => onSelect(card.id)} aria-current={active ? "true" : undefined}>
    <span className="queue-card-top">
      <span className={`sev-tag sev-${card.attentionTone}`}><Icon name={SEVERITY_ICON[card.attentionTone]} size={12} />{SEVERITY[card.attentionTone]}</span>
      <span className="queue-card-ref mono">{card.reference}</span>
      {deadline && <span className={`queue-card-when tone-${deadline.tone}`} title="Next deadline">{deadline.text}</span>}
    </span>
    <span className="queue-card-car">{card.vehicle}<small>{card.from.city}<Icon name="arrow" size={11} />{card.to.city}</small></span>
    {wrong && <span className="queue-card-wrong">{wrong}</span>}
    {why && <span className="queue-card-why">{why}</span>}
    <span className={`queue-card-agent${agentCase ? ` is-${agentCase.status}` : ""}`}>
      {agentCase?.status === "working" ? <span className="pulse" aria-hidden="true" /> : <Icon name="bot" size={12} />}
      {status ? <b>{status.label}.</b> : null} {checked}
    </span>
  </button>
}

export function WatchCard({ card, snapshotAt, active, onSelect }: { card: BoardCard; snapshotAt: string | null; active: boolean; onSelect: (id: string) => void }) {
  const status = watchStatus(card)
  const driver = card.work.find((line) => line.icon === "driver" || line.icon === "offer")
  const date = card.decisive
  const milestone = driver?.text ?? (date ? `${date.label} ${dateText(date.start, date.end, date.zone)}` : null)
  const updated = relativeTo(card.updatedAt, snapshotAt)
  return <button type="button" className={`watch-card${active ? " active" : ""}`} onClick={() => onSelect(card.id)} aria-current={active ? "true" : undefined}>
    <span className="watch-card-top"><span className="watch-card-car">{card.vehicle}</span><span className="mono">{card.reference}</span></span>
    <span className="watch-card-route">{card.from.city}<Icon name="arrow" size={11} />{card.to.city}<span className={`watch-card-status tone-${status.tone}`}><Icon name={status.tone === "ok" ? "check" : "dot"} size={11} />{status.label}</span></span>
    {milestone && <span className="watch-card-next">{milestone}</span>}
    <span className="watch-card-when">Updated <time dateTime={card.updatedAt}>{fmtDateTime(card.updatedAt, date?.zone ?? null)}</time>{updated ? ` · ${updated.text}` : ""}</span>
  </button>
}
