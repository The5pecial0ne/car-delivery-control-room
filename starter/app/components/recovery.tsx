"use client"

// Recovery, worked out before anyone asks: what matters most today (speed,
// cost or certainty), the options ranked and explained by it, and the Plan B
// the agent's lookup tools prepared. Nothing here books or sends anything.
// Choosing an option either answers the agent's hand-over or hands the order
// to the agent with that priority.

import { useCallback, useEffect, useMemo, useState } from "react"
import { cityOfZone, clockIn } from "@/lib/agent/clock"
import { actionLabel, CERTAINTY_LABEL, type Certainty, type Decision, type Option } from "@/lib/agent/labels"
import type { RankedPlanB } from "@/lib/agent/plan-b"
import { needsApproval, PRIORITIES, rankOptions, whyFor, type Priority } from "@/lib/agent/priority"
import { Disclosure } from "./disclosure"
import { Icon } from "./icons"

const STORE = "desk-priority-v2"
const PRIORITY_EVENT = "desk-priority"

/** The operator's priority, remembered in this browser and shared by every panel on the page. */
export function usePriority(): [Priority, (value: Priority) => void] {
  const [priority, setPriority] = useState<Priority>("speed")
  useEffect(() => {
    try { const saved = localStorage.getItem(STORE); if (saved === "speed" || saved === "cost" || saved === "certainty") setPriority(saved) } catch { /* private window */ }
    const follow = (event: Event) => setPriority((event as CustomEvent<Priority>).detail)
    window.addEventListener(PRIORITY_EVENT, follow)
    return () => window.removeEventListener(PRIORITY_EVENT, follow)
  }, [])
  const choose = useCallback((value: Priority) => {
    setPriority(value)
    try { localStorage.setItem(STORE, value) } catch { /* private window */ }
    window.dispatchEvent(new CustomEvent(PRIORITY_EVENT, { detail: value }))
  }, [])
  return [priority, choose]
}

export type PlanState = { state: "loading" | "ready" | "insufficient" | "error"; plan: RankedPlanB | null; error?: string }

/** Plan B for an order, prepared when the order is opened and re-ranked when the priority changes. */
export function usePlanB(orderId: string, priority: Priority, onPlan?: (plan: RankedPlanB | null) => void): PlanState & { refresh: () => void } {
  const [result, setResult] = useState<PlanState>({ state: "loading", plan: null })
  const [round, setRound] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setResult((old) => ({ ...old, state: "loading" }))
    fetch(`/api/orders/${encodeURIComponent(orderId)}/plan-b?priority=${priority}${round ? "&refresh=1" : ""}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "The lookups failed")
        return response.json() as Promise<RankedPlanB>
      })
      .then((plan) => { setResult({ state: plan.status, plan }); onPlan?.(plan) })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setResult({ state: "error", plan: null, error: cause instanceof Error ? cause.message : "The lookups failed" })
        onPlan?.(null)
      })
    return () => controller.abort()
    // onPlan is a notification, not an input, so it is left out on purpose.
  }, [orderId, priority, round])
  return { ...result, refresh: () => setRound((value) => value + 1) }
}

export function PrioritySwitch({ priority, onChange }: { priority: Priority; onChange: (value: Priority) => void }) {
  const current = PRIORITIES.find((item) => item.key === priority)
  return <div className="priority">
    <div className="priority-row">
      <span className="priority-label" id="priority-label">What should we optimise for?</span>
      <div className="priority-switch" role="radiogroup" aria-labelledby="priority-label">
        {PRIORITIES.map((item) => <button key={item.key} type="button" role="radio" aria-checked={priority === item.key} className={priority === item.key ? "on" : undefined} onClick={() => onChange(item.key)}>
          {priority === item.key && <Icon name="check" size={12} />}{item.label}
        </button>)}
      </div>
    </div>
    {current && <p className="priority-trade"><b>{current.label}:</b> {current.tradeOff}</p>}
  </div>
}

const euro = (value: number) => value.toLocaleString("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
const CERTAINTY_NOTE: Record<Certainty, string> = { confirmed: "rests on confirmed facts", quoted: "quoted, not booked", uncertain: "not confirmed by anyone" }
export const priorityLabel = (priority: Priority) => PRIORITIES.find((item) => item.key === priority)?.label ?? priority

export type Row = {
  key: string
  tag: string | null
  title: string
  summary: string | null
  why: string
  arrives: string | null
  cost: string | null
  costBasis: string | null
  certainty: Certainty | null
  risk: string | null
  approval: boolean
  option?: Option
}

/** Delivery, cost, certainty and approval for one option, in one compact row. */
export function OptionImpact({ row }: { row: Row }) {
  return <dl className="option-impact">
    <div><dt>Delivery</dt><dd>{row.arrives ?? "No new arrival time"}</dd></div>
    <div><dt>Cost</dt><dd>{row.cost ?? "No estimate"}{row.costBasis && <small>{row.costBasis}</small>}</dd></div>
    <div><dt>Certainty</dt><dd>{row.certainty ? <>{CERTAINTY_LABEL[row.certainty]}<small>{CERTAINTY_NOTE[row.certainty]}{row.risk ? `. ${row.risk}` : ""}</small></> : "Not stated"}</dd></div>
    <div><dt>Approval</dt><dd>{row.approval ? "Needs your approval" : "The agent may do this alone"}</dd></div>
  </dl>
}

/** Delivery, cost, certainty and approval in one line, for the recommendation card. */
export function ImpactLine({ row }: { row: Row }) {
  const cost = row.cost == null ? "No cost estimate" : row.cost === "No extra cost" ? "No extra cost" : `Estimated extra cost: ${row.cost.replace(/^About /, "")}`
  const parts = [
    // The agent gives a bare time ("Wed 17:00 Helsinki time"); prepared options already say "Arrives about…".
    row.arrives ? /^(arrives|delivers|delivery|no |on |late|stays)/i.test(row.arrives) ? row.arrives : `Delivery ${row.arrives}` : "No new arrival time",
    cost,
    row.certainty ? CERTAINTY_LABEL[row.certainty] : null,
    row.approval ? "Human approval required" : "The agent may do this alone",
  ].filter(Boolean)
  return <p className="impact-line">{parts.map((part, index) => <span key={index}>{part}</span>)}</p>
}

/** First sentence of a longer text, so a card can lead with the concrete step. */
export const firstSentence = (text: string, length = 170) => {
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text
  return sentence.length > length ? `${sentence.slice(0, length - 1).trimEnd()}…` : sentence
}

/** The recommended option for the chosen priority: one concrete step, one impact line, the actions. */
export function BestOption({ row, children, note }: { row: Row; children: React.ReactNode; note?: React.ReactNode }) {
  return <div className="best-option">
    <p className="best-kicker"><Icon name="flag" size={13} />Recommended action{row.tag ? <span> · {row.tag}</span> : null}</p>
    <h3 className="best-title">{row.summary ? firstSentence(row.summary) : row.title}</h3>
    <ImpactLine row={row} />
    {note}
    <div className="best-actions">{children}</div>
  </div>
}

/**
 * Every option, ranked for the priority, folded under one line that counts the
 * others. The recommended one is listed first with its full reasoning, so
 * nothing the card leaves out is more than a click away.
 */
export function CompareOptions({ rows, priority, action, extra }: {
  rows: Row[]; priority: Priority; action: (row: Row) => React.ReactNode; extra?: (row: Row) => React.ReactNode
}) {
  const others = rows.length - 1
  if (others < 1) return null
  return <details className="fold other-options">
    <summary>
      <span className="fold-summary">{others} other option{others === 1 ? "" : "s"}, ranked for {priorityLabel(priority).toLowerCase()}</span>
      <span className="fold-action"><span className="fold-show">Compare options</span><span className="fold-hide">Hide</span><Icon name="chevron" size={12} /></span>
    </summary>
    <ol className="options">{rows.map((row, at) => <li key={row.key} className={`option${at === 0 ? " is-best" : ""}`}>
      <div className="option-head">
        <span className="option-rank num" aria-label={`Rank ${at + 1}`}>{at + 1}</span>
        <div className="option-title">
          <span className="option-kicker">{[at === 0 ? "Recommended" : null, row.tag].filter(Boolean).join(" · ")}</span>
          <b>{row.title}</b>
        </div>
        <div className="option-act">{at === 0 ? <span className="option-wait">Shown above</span> : action(row)}</div>
      </div>
      <p className="option-why">{row.why}</p>
      {row.summary && row.summary !== row.title && <p className="option-summary">{row.summary}</p>}
      <OptionImpact row={row} />
      {at > 0 && extra?.(row)}
    </li>)}</ol>
  </details>
}

/** The agent's own hand-over options (its pick, the alternatives and its Plan B), ranked by the operator's priority. */
export function agentRows(decision: Decision, priority: Priority, zone: string): Row[] {
  const options: { option: Option; tag: string }[] = []
  if (decision.recommendation) options.push({ option: decision.recommendation, tag: "Agent's pick" })
  decision.alternatives?.forEach((option, index) => options.push({ option, tag: `Alternative ${index + 1}` }))
  if (decision.plan_b) options.push({ option: decision.plan_b, tag: "Plan B" })
  const all = options.map((item) => item.option)
  // "Something else" says nothing, so an option without a known action is named by its own first sentence.
  // The first option with an action keeps its short name; later ones with the same action are told apart by their summary.
  const titleOf = (option: Option) => option.action && option.action !== "other" && all.find((item) => item.action === option.action) === option
    ? actionLabel(option.action) : (option.summary?.split(/(?<=[.!?])\s/)[0] ?? actionLabel(option.action))
  return rankOptions(options, priority).map(({ option, tag }, rank) => ({
    key: tag, tag, option,
    title: titleOf(option),
    summary: option.summary ?? null, why: whyFor(option, all, priority, rank === 0),
    arrives: option.arrives_at ? `${clockIn(option.arrives_at, zone)} ${cityOfZone(zone)} time` : null,
    cost: option.cost_eur != null ? euro(option.cost_eur) : null, costBasis: null, certainty: option.certainty ?? null, risk: null,
    approval: needsApproval(option.action),
  }))
}

/** Options from the prepared Plan B, for an order the agent has no hand-over on yet. */
export function PreparedOptions({ plan, priority, busy, onHandOver }: {
  plan: RankedPlanB; priority: Priority; busy: boolean | string; onHandOver: ((title: string) => void) | null
}) {
  const rows: Row[] = useMemo(() => plan.options.map((option) => ({
    key: option.id, tag: null, title: option.title, summary: option.summary, why: option.why,
    arrives: option.delivery, cost: option.cost_eur != null ? option.cost_eur === 0 ? "No extra cost" : `About ${euro(option.cost_eur)}` : null,
    costBasis: option.cost_basis, certainty: option.certainty, risk: option.risk, approval: option.needs_approval,
  })), [plan])
  if (!rows.length) return null
  const act = (row: Row, primary: boolean) => onHandOver
    ? <button type="button" className={`btn${primary ? " primary" : " small"}`} disabled={!!busy} onClick={() => onHandOver(row.title)}>{primary && <Icon name="bot" size={14} />}Hand to the agent</button>
    : typeof busy === "string" ? <span className="option-wait">{busy}</span> : null
  return <section className="recovery-options" aria-label="Recommended recovery">
    <BestOption row={rows[0]}
      note={onHandOver && <p className="recovery-note"><Icon name="note" size={13} />The agent investigates first and comes back with one decision. Nothing is booked, cancelled or sent without your yes.</p>}>
      {act(rows[0], true)}
    </BestOption>
    <CompareOptions rows={rows} priority={priority} action={(row) => act(row, false)} />
  </section>
}

const CHECK_ICON: Record<string, string> = { ferry: "ferry", driver: "driver", hotel: "hotel", promise: "flag", next: "check" }
const CHECK_STATE: Record<string, string> = { found: "Found", none: "Nothing found", not_needed: "Not needed", unknown: "Unknown" }

/** Plan B in one line, with the agent's own Plan B and everything its lookup tools checked one click away. */
export function PlanBPanel({ state, onRefresh, agentPlan, onSwitch, busy, zone }: {
  state: PlanState; onRefresh: () => void; agentPlan?: Decision["plan_b"]; onSwitch?: () => void; busy?: boolean; zone: string
}) {
  const plan = state.plan
  const title = state.state === "loading" ? "Preparing Plan B…" : state.state === "error" ? "Plan B could not be prepared"
    : state.state === "insufficient" ? "No safe Plan B yet" : "Plan B is ready"
  const found = plan?.checks.filter((check) => check.status === "found" && check.key !== "next" && check.key !== "promise").map((check) => check.label.toLowerCase()) ?? []
  const alternatives = plan ? plan.options.filter((option) => option.action !== "hold_and_wait").length : 0
  const line = state.state === "loading" ? "Looking up later sailings, backup drivers, hotels and the delivery promise."
    : state.state === "error" ? `${state.error}. Try again, or open the full record.`
    : plan?.reason ?? (found.length ? `Found ${found.join(", ")}: ${alternatives} alternative${alternatives === 1 ? "" : "s"} to the current plan.` : "Nothing usable turned up.")
  // The agent's own Plan B counts as ready even while the lookups run again.
  const ready = state.state === "ready" || !!agentPlan?.summary
  return <Disclosure id="plan-b" tone={ready ? "agent" : undefined} action="View Plan B"
    summary={<span className="planb-line" aria-busy={state.state === "loading"}>
      {state.state === "loading" && <span className="pulse" aria-hidden="true" />}
      <b>{agentPlan?.summary ? "Plan B is ready" : title.replace(/…$/, "")}.</b>{" "}
      {agentPlan?.summary ? firstSentence(agentPlan.summary, 120) : state.state === "loading" ? null : firstSentence(line, 120)}
    </span>}>
    <section className={`planb planb-${state.state}`} aria-label="Plan B">
      <header className="planb-head">
        <h3><Icon name={state.state === "ready" ? "flag" : state.state === "loading" ? "waiting" : "alert"} size={14} />{title}</h3>
        <button type="button" className="btn quiet small" onClick={onRefresh} disabled={state.state === "loading"}>Check again</button>
      </header>
      <p className="planb-status">{line} <b className="planb-safe">Nothing booked or sent.</b></p>
      {agentPlan?.summary && <div className="planb-agent">
        <p><span className="planb-agent-label">The agent's Plan B:</span> {agentPlan.summary}</p>
        {agentPlan.trigger && <p className="planb-trigger">Switch when: {agentPlan.trigger}</p>}
        {!!agentPlan.steps?.length && <ol className="planb-steps">{agentPlan.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
        {agentPlan.arrives_at && <p className="planb-meta">The agent's Plan B arrives {clockIn(agentPlan.arrives_at, zone)} {cityOfZone(zone)} time{agentPlan.cost_eur != null ? ` · ${euro(agentPlan.cost_eur)}` : ""}{agentPlan.certainty ? ` · ${CERTAINTY_LABEL[agentPlan.certainty]}` : ""}</p>}
        {onSwitch && <button type="button" className="btn small" disabled={busy} onClick={onSwitch}>Switch to Plan B now</button>}
      </div>}
      {plan && plan.checks.length > 0 && <>
        <h4 className="planb-sub">What the lookup tools checked</h4>
        <ul className="planb-checks">{plan.checks.map((check) => <li key={check.key} className={`planb-check is-${check.status}`}>
          <Icon name={CHECK_ICON[check.key] ?? "dot"} size={14} />
          <span className="planb-check-label">{check.label}</span>
          <span className="planb-check-state">{CHECK_STATE[check.status]}</span>
          <span className="planb-check-text">{check.text}</span>
        </li>)}</ul>
        <p className="planb-boundary"><Icon name="check" size={13} />{plan.boundary}</p>
        <p className="planb-meta">Prepared {new Date(plan.preparedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} by the agent's lookup tools, from the order as recorded at the snapshot. Quotes are simulated for this demo and marked as estimates where they are not on the order. No AI model was needed for this step.</p>
      </>}
    </section>
  </Disclosure>
}

/** Starts an agent case on the order with the chosen option and priority, the same way a demo case starts. */
export async function handOver(orderId: string, problem: string, option: string, priority: Priority): Promise<void> {
  const trigger = `Operations asked for a recovery plan. Open point: ${problem}. What matters most today: ${priority}. The option they lean towards: ${option}. Investigate first, then bring one decision.`
  const response = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, trigger }) })
  if (!response.ok) throw new Error("Could not start the agent on this order")
}
