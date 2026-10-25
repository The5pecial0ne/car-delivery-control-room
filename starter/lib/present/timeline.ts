import { fmtRange } from "./time"
import type { HistoryEvent, RecordView } from "./types"

export type TimelineState = "done" | "issue" | "agent" | "decision" | "update" | "upcoming"

export type TimelineEntry = {
  id: string
  at: string
  state: TimelineState
  label: string
  title: string
  detail: string | null
  source: string
  openNow?: boolean
}

export const STATE_LABEL: Record<TimelineState, string> = {
  done: "Confirmed",
  issue: "Conflict",
  agent: "Agent checked",
  decision: "Decision needed",
  update: "Update",
  upcoming: "Upcoming",
}

export type AgentCaseLike = {
  status: "working" | "needs_person" | "resolved" | "failed"
  trigger: string
  headline: string | null
  createdAt: string
  updatedAt: string
  pendingDecision: { deadlines?: { at: string; what: string }[] } | null
}

export type AgentStepLike = { id: string; actor: string; kind: string; body: string; data: Record<string, unknown>; createdAt: string }

const EVENTS: Record<string, { state: TimelineState; label?: string; title?: string }> = {
  "order.created": { state: "done" },
  "availability.confirmed": { state: "done" },
  "plan.activated": { state: "done" },
  "pickup_window.selected": { state: "done", title: "Pickup slot confirmed" },
  "delivery_window.selected": { state: "done", title: "Delivery slot confirmed" },
  "delivery.promise_recorded": { state: "done" },
  "endpoint.contact_confirmed": { state: "done" },
  "endpoint.access_confirmed": { state: "done" },
  "endpoint.instruction_verified": { state: "done" },
  "endpoint.claim_resolved": { state: "done", label: "Resolved" },
  "assignment.booked": { state: "done", title: "Driver assigned" },
  "travel.booked": { state: "done" },
  "travel.rebooked": { state: "done" },
  "travel.check_in_confirmed": { state: "done" },
  "travel.arrival_reported": { state: "done" },
  "assignment.started": { state: "done" },
  "vehicle.picked_up": { state: "done" },
  "vehicle.custody_reported": { state: "done" },
  "document.verified": { state: "done" },
  "vehicle.delivered": { state: "done" },
  "assignment.completed": { state: "done" },
  "plan.completed": { state: "done" },
  "pickup.attempted": { state: "issue" },
  "pickup.vehicle_not_found": { state: "issue" },
  "endpoint.claim_recorded": { state: "issue" },
  "endpoint.access_reopened": { state: "issue", label: "Needs attention" },
  "travel.check_in_rejected": { state: "issue" },
  "travel.gate_exception_recorded": { state: "issue" },
  "delivery.delay_reported": { state: "issue" },
  "offer.booking_cutoff_passed": { state: "issue", label: "Needs attention" },
  "assignment.cancelled": { state: "issue" },
  "alert.acknowledged": { state: "update" },
  "alert.owner_assigned": { state: "update" },
  "alert.followup_scheduled": { state: "update" },
  "plan.replaced": { state: "update" },
  "pickup.window_revised": { state: "update" },
  "delivery.window_revised": { state: "update" },
  "delivery.promise_revised": { state: "update" },
  "travel.amendment_requested": { state: "update" },
  "endpoint.verification_pending": { state: "update" },
  "order.cancelled": { state: "update" },
}

const CLOSED = new Set(["RESOLVED", "DISMISSED", "CLOSED", "DONE", "CANCELLED"])
const COVERED = new Set(["alert", "owned_alert", "incident", "work", "proposal"])
const MAX_OPEN_ITEMS = 4

const time = (at: string | null | undefined) => (at ? new Date(at).getTime() : NaN)
const clip = (text: string, length = 120) => {
  if (text.length <= length) return text
  const cut = text.slice(0, length - 1)
  const space = cut.lastIndexOf(" ")
  return `${(space > length / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:·–-]+$/, "")}…`
}
const firstSentence = (text: string) => clip(text.split(/(?<=[.?!])\s/)[0] ?? text)

function mergeBookings(events: HistoryEvent[]): HistoryEvent[] {
  const result: HistoryEvent[] = []
  for (const event of events) {
    const last = result.at(-1)
    if (last && event.command === "travel.booked" && last.command === "travel.booked" && last.at === event.at) {
      const kinds = [...new Set([...last.text.replace(/ booked$/, "").split(/, | and /), event.text.replace(/ booked$/, "")])]
      const joined = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)!.toLowerCase()}` : kinds[0]
      result[result.length - 1] = { ...last, text: `${joined.charAt(0).toUpperCase()}${joined.slice(1).toLowerCase()} booked` }
    } else result.push(event)
  }
  return result
}

function orderEntries(view: RecordView): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const events = view.history.flatMap((day) => day.events).filter((event) => !event.shared && EVENTS[event.command])
    .sort((a, b) => a.at.localeCompare(b.at))
  for (const event of mergeBookings(events)) {
    const rule = EVENTS[event.command]
    entries.push({
      id: event.id, at: event.at, state: rule.state, label: rule.label ?? STATE_LABEL[rule.state],
      title: rule.title ?? event.text,
      detail: [rule.title ? event.text : null, event.detail, event.actor].filter(Boolean).join(" · ") || null,
      source: "operational_events",
    })
  }

  for (const alert of view.alerts) {
    entries.push({
      id: alert.id, at: alert.triggeredAt, state: "issue", label: "Conflict", title: alert.signalLabel,
      detail: [alert.summary, alert.owner && !CLOSED.has(alert.status) ? `Owner: ${alert.owner}` : null].filter(Boolean).join(" · "),
      source: "alerts",
    })
    if (alert.resolvedAt) entries.push({ id: `${alert.id}-resolved`, at: alert.resolvedAt, state: "done", label: "Resolved", title: `${alert.signalLabel} resolved`, detail: alert.resolutionReason, source: "alerts" })
  }
  for (const incident of view.incidents) {
    if (!incident.openedAt) continue
    entries.push({ id: incident.id, at: incident.openedAt, state: "issue", label: "Conflict", title: `Incident: ${incident.kindLabel}`, detail: [incident.statusLabel, incident.owner ? `Owner: ${incident.owner}` : null].filter(Boolean).join(" · "), source: "incidents" })
    if (incident.resolvedAt) entries.push({ id: `${incident.id}-resolved`, at: incident.resolvedAt, state: "done", label: "Resolved", title: `Incident resolved: ${incident.kindLabel}`, detail: null, source: "incidents" })
  }
  for (const item of view.workItems) {
    if (!item.openedAt) continue
    entries.push({ id: item.id, at: item.openedAt, state: "issue", label: "Needs attention", title: item.kindLabel, detail: [item.summary, item.owner ? `Owner: ${item.owner}` : null].filter(Boolean).join(" · "), source: "work_items" })
    if (item.closedAt) entries.push({ id: `${item.id}-closed`, at: item.closedAt, state: "done", label: "Resolved", title: `${item.kindLabel} closed`, detail: item.outcome, source: "work_items" })
  }
  for (const proposal of view.proposals) {
    const state: TimelineState = proposal.status === "PENDING_REVIEW" ? "decision"
      : proposal.status === "EXECUTED" ? "agent"
      : proposal.status === "FAILED" || proposal.status === "APPROVED_AWAITING_EXECUTION" ? "issue" : "update"
    const label = { decision: "Decision needed", agent: "Agent acted", issue: "Needs attention", update: "Update", done: "Confirmed", upcoming: "Upcoming" }[state]
    entries.push({ id: proposal.id, at: proposal.createdAt, state, label, title: `${proposal.agent.name}: ${proposal.commandLabel}`, detail: [proposal.summary, proposal.statusLabel].join(" · "), source: "agent_proposals" })
  }
  return entries
}

function openItems(view: RecordView, now: string): TimelineEntry[] {
  const open = view.attention.filter((item) => !COVERED.has(item.kind))
  const shown = open.slice(0, MAX_OPEN_ITEMS).map((item, index): TimelineEntry => ({
    id: `open-${item.recordId}-${index}`, at: item.at ?? now, state: "issue", label: "Needs attention",
    title: item.title, detail: item.detail, source: item.section, openNow: !item.at,
  }))
  const hidden = open.length - shown.length
  if (hidden > 0 && shown.length) shown[shown.length - 1].detail = `${shown[shown.length - 1].detail ?? ""}${shown[shown.length - 1].detail ? " · " : ""}${hidden} more open item${hidden === 1 ? "" : "s"} in the record`
  return shown
}

function upcomingEntries(view: RecordView, now: number, deadlines: { at: string; what: string }[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const steps = view.journey.groups.flatMap((group) => group.steps)
  const pickedUp = steps.some((step) => step.role === "PICKUP" && step.recorded)
  const delivered = steps.some((step) => step.role === "DELIVERY" && step.recorded)
  const date = (key: string) => view.header.keyDates.find((item) => item.key === key)
  if (view.header.status === "CANCELLED" || view.header.cancelledAt) return entries

  const slot = date("pickup_slot")
  if (slot && !pickedUp && time(slot.start) > now) {
    entries.push({ id: "next-pickup", at: slot.start, state: "upcoming", label: "Upcoming", title: "Pickup slot", detail: slot.end ? fmtRange(slot.start, slot.end, slot.zone) : null, source: "time_windows" })
  }
  for (const booking of view.reservations) {
    if (booking.kind !== "FERRY" || CLOSED.has(booking.status) || booking.replacedBy) continue
    if (booking.checkInCutoffAt && time(booking.checkInCutoffAt) > now) entries.push({ id: `${booking.id}-cutoff`, at: booking.checkInCutoffAt, state: "upcoming", label: "Upcoming", title: "Ferry check-in closes", detail: booking.route, source: "travel_reservations" })
    if (booking.departureAt && time(booking.departureAt) > now) entries.push({ id: `${booking.id}-sails`, at: booking.departureAt, state: "upcoming", label: "Upcoming", title: "Ferry departs", detail: booking.route, source: "travel_reservations" })
  }
  const tracking = view.journey.groups.flatMap((group) => group.legs).map((leg) => leg.tracking).find((item) => item?.eta)
  if (tracking?.eta && !delivered && time(tracking.eta) > now) {
    entries.push({ id: "next-eta", at: tracking.eta, state: "upcoming", label: "Upcoming", title: "Expected arrival, from the driver app", detail: `Signal ${tracking.qualityLabel.toLowerCase()}${tracking.note ? ` · ${tracking.note}` : ""}`, source: "tracking" })
  }
  const promise = date("promise")
  if (promise && !delivered) {
    const ends = promise.end ?? promise.start
    const missed = time(ends) < now
    const open = !missed && time(promise.start) <= now
    entries.push({
      id: "next-promise", at: missed || open ? ends : promise.start, state: missed ? "issue" : "upcoming", label: missed ? "Conflict" : "Upcoming",
      title: missed ? "Delivery promise missed" : open ? "Delivery promise window closes" : "Delivery promised",
      detail: promise.end ? fmtRange(promise.start, promise.end, promise.zone) : null, source: "time_windows",
    })
  }
  deadlines.forEach((deadline, index) => {
    const passed = time(deadline.at) <= now
    entries.push({ id: `deadline-${index}`, at: deadline.at, state: passed ? "issue" : "upcoming", label: passed ? "Deadline passed" : "Deadline", title: deadline.what, detail: "From the agent's hand-over", source: "agent case" })
  })
  return entries
}

function agentEntries(agentCase: AgentCaseLike, steps: AgentStepLike[], snapshotAt: string | null): TimelineEntry[] {
  const opened = time(agentCase.createdAt)
  const onClock = (at: string) => (snapshotAt ? new Date(time(snapshotAt) + Math.max(0, time(at) - opened)).toISOString() : at)
  const lastProposal = [...steps].reverse().find((step) => step.kind === "proposal")
  const entries: TimelineEntry[] = [{
    id: "case-opened", at: onClock(agentCase.createdAt), state: "agent", label: "Agent checked", title: "Agent opened a case", detail: clip(agentCase.trigger), source: "agent case",
  }]
  let lookups = 0
  for (const step of steps) {
    const at = onClock(step.createdAt)
    const add = (state: TimelineState, label: string, title: string, detail: string | null = null) => entries.push({ id: step.id, at, state, label, title, detail, source: "agent case" })
    if (step.kind === "lookup") { lookups += 1; continue }
    if (step.kind === "findings") {
      const problem = (step.data.args as { problem?: string } | undefined)?.problem
      add("agent", "Agent checked", step.body.replace(/^Findings:/, "Checked what is true:"), [lookups ? `After ${lookups} lookup${lookups === 1 ? "" : "s"}` : null, problem ? clip(problem, 160) : null].filter(Boolean).join(" · ") || null)
      lookups = 0
    } else if (step.kind === "message" && step.actor === "agent" && (step.data.to === "driver" || step.data.to === "site")) {
      add("agent", "Agent asked", step.data.to === "driver" ? "Agent messaged the driver" : "Agent called the pickup site", firstSentence(step.body))
    } else if (step.kind === "message" && (step.actor === "driver" || step.actor === "site")) {
      add("update", "Reply", step.actor === "driver" ? "Driver replied" : "Pickup site replied", firstSentence(step.body))
    } else if (step.kind === "action") {
      add("agent", "Agent acted", clip(step.body))
    } else if (step.kind === "proposal") {
      const waiting = step === lastProposal && agentCase.status === "needs_person"
      add(waiting ? "decision" : "agent", waiting ? "Decision needed" : "Agent handed over", waiting ? agentCase.headline ?? step.body : clip(step.body))
    } else if (step.kind === "decision") {
      add("done", "Your decision", clip(step.body.replace(/^Operations/, "You")))
    } else if (step.kind === "error") {
      add("issue", "Conflict", "The agent stopped", clip(step.body))
    }
  }
  if (agentCase.status === "resolved") {
    entries.push({ id: "case-closed", at: onClock(agentCase.updatedAt), state: "done", label: "Handled", title: agentCase.headline ?? "Agent closed the case", detail: "Closed by the agent", source: "agent case" })
  }
  return entries
}

export type Timeline = { entries: TimelineEntry[]; now: string; nowIndex: number; issues: number }

export type PlanBLike = { status: "ready" | "insufficient"; preparedAt: string; checks: { label: string; status: string }[]; options: { title: string }[] }

function planEntries(plan: PlanBLike, at: string, agentCase: AgentCaseLike | null | undefined): TimelineEntry[] {
  const found = plan.checks.filter((check) => check.status === "found").map((check) => check.label.toLowerCase())
  const entries: TimelineEntry[] = [{
    id: "plan-b", at, state: "agent", label: plan.status === "ready" ? "Plan B ready" : "Plan B not possible",
    title: plan.status === "ready" ? "Agent prepared Plan B" : "Agent looked for a Plan B and found no safe one",
    detail: found.length ? `Checked: ${found.join(", ")}. Nothing booked or sent.` : "Nothing booked or sent.", source: "plan-b",
  }]
  if (plan.status === "ready" && plan.options[0] && agentCase?.status !== "needs_person" && agentCase?.status !== "working") {
    entries.push({ id: "plan-b-decide", at, state: "decision", label: "Decision needed", title: `Choose a recovery option: best now is "${plan.options[0].title.toLowerCase()}"`, detail: "Or hand it to the agent with your priority.", source: "plan-b" })
  }
  return entries
}

export function buildTimeline(view: RecordView, options: { agentCase?: AgentCaseLike | null; steps?: AgentStepLike[] | null; now?: number; planB?: PlanBLike | null } = {}): Timeline {
  const { agentCase, steps, planB } = options
  const nowMs = options.now ?? time(view.snapshotAt ?? new Date().toISOString())
  const now = new Date(nowMs).toISOString()
  const deadlines = agentCase?.status === "needs_person" ? agentCase.pendingDecision?.deadlines ?? [] : []
  const planAt = planB ? agentCase && view.snapshotAt
    ? new Date(time(view.snapshotAt) + Math.max(0, time(planB.preparedAt) - time(agentCase.createdAt))).toISOString()
    : now : null
  const entries = [
    ...orderEntries(view),
    ...openItems(view, view.snapshotAt ?? now),
    ...(agentCase ? agentEntries(agentCase, steps ?? [], view.snapshotAt) : []),
    ...(planB && planAt ? planEntries(planB, planAt > now ? now : planAt, agentCase) : []),
    ...upcomingEntries(view, nowMs, deadlines),
  ].filter((entry) => !Number.isNaN(time(entry.at)))
    .sort((a, b) => time(a.at) - time(b.at) || Number(a.state === "upcoming") - Number(b.state === "upcoming"))
  const nowIndex = entries.findIndex((entry) => entry.state === "upcoming" || time(entry.at) > nowMs)
  return { entries, now, nowIndex: nowIndex === -1 ? entries.length : nowIndex, issues: entries.filter((entry) => entry.state === "issue" || entry.state === "decision").length }
}
