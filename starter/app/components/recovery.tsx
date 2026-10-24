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
      <span className="priority-label" id="priority-label">What matters most today</span>
      <div className="priority-switch" role="radiogroup" aria-labelledby="priority-label">
        {PRIORITIES.map((item) => <button key={item.key} type="button" role="radio" aria-checked={priority === item.key} className={priority === item.key ? "on" : undefined} onClick={() => onChange(item.key)}>
          {priority === item.key && <Icon name="check" size={12} />}{item.label}
        </button>)}
      </div>
    </div>
    {current && <p className="priority-trade">{current.tradeOff}</p>}
  </div>
}

const euro = (value: number) => value.toLocaleString("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
const CERTAINTY_NOTE: Record<Certainty, string> = { confirmed: "rests on confirmed facts", quoted: "quoted, not booked", uncertain: "not confirmed by anyone" }

type Row = {
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
}

function OptionRows({ rows, priority, action }: { rows: Row[]; priority: Priority; action: (row: Row, rank: number) => React.ReactNode }) {
  const label = PRIORITIES.find((item) => item.key === priority)?.label.toLowerCase()
  return <ol className="options">{rows.map((row, rank) => <li key={row.key} className={rank === 0 ? "option best" : "option"}>
    <div className="option-head">
      <span className="option-rank num" aria-label={`Rank ${rank + 1}`}>{rank + 1}</span>
      <div className="option-title">
        <span className="option-kicker">{rank === 0 ? `Best for ${label}` : `Option ${rank + 1}`}{row.tag ? ` · ${row.tag}` : ""}</span>
        <b>{row.title}</b>
      </div>
      <div className="option-act">{action(row, rank)}</div>
    </div>
    <p className="option-why">{row.why}</p>
    {row.summary && <p className="option-summary">{row.summary}</p>}
    <dl className="option-impact">
      <div><dt>Delivery</dt><dd>{row.arrives ?? "No new arrival time"}</dd></div>
      <div><dt>Cost</dt><dd>{row.cost ?? "No estimate"}{row.costBasis && <small>{row.costBasis}</small>}</dd></div>
      <div><dt>Certainty</dt><dd>{row.certainty ? <>{CERTAINTY_LABEL[row.certainty]}<small>{CERTAINTY_NOTE[row.certainty]}{row.risk ? `. ${row.risk}` : ""}</small></> : "Not stated"}</dd></div>
      <div><dt>Approval</dt><dd>{row.approval ? "Needs your approval" : "The agent may do this alone"}</dd></div>
    </dl>
  </li>)}</ol>
}

/** The agent's own hand-over options, ranked by the operator's priority. */
export function AgentOptions({ decision, zone, priority, busy, approveLabel, onApprove, onChoose }: {
  decision: Decision; zone: string; priority: Priority; busy: boolean; approveLabel: string
  onApprove: () => void; onChoose: (option: Option, tag: string) => void
}) {
  const options = useMemo(() => {
    const list: { option: Option; tag: string }[] = []
    if (decision.recommendation) list.push({ option: decision.recommendation, tag: "Agent's pick" })
    decision.alternatives?.forEach((option, index) => list.push({ option, tag: `Alternative ${index + 1}` }))
    if (decision.plan_b) list.push({ option: decision.plan_b, tag: "Plan B" })
    return list
  }, [decision])
  const ranked = useMemo(() => rankOptions(options, priority), [options, priority])
  if (options.length < 2) return null
  const all = options.map((item) => item.option)
  const rows: Row[] = ranked.map(({ option, tag }, rank) => ({
    // "Something else" says nothing, so an option without a known action is named by its own first sentence.
    key: tag, tag, title: option.action && option.action !== "other" ? actionLabel(option.action) : (option.summary?.split(/(?<=[.!?])\s/)[0] ?? actionLabel(option.action)), summary: option.summary ?? null, why: whyFor(option, all, priority, rank === 0),
    arrives: option.arrives_at ? `${clockIn(option.arrives_at, zone)} ${cityOfZone(zone)} time` : null,
    cost: option.cost_eur != null ? euro(option.cost_eur) : null, costBasis: null, certainty: option.certainty ?? null, risk: null,
    approval: needsApproval(option.action),
  }))
  return <section className="recovery-options" aria-label="Recovery options">
    <OptionRows rows={rows} priority={priority} action={(row) => row.tag === "Agent's pick"
      ? <button type="button" className="btn primary small" disabled={busy} onClick={onApprove}>{approveLabel}</button>
      : <button type="button" className="btn small" disabled={busy} onClick={() => { const found = options.find((item) => item.tag === row.tag); if (found) onChoose(found.option, found.tag) }}>Choose this</button>} />
  </section>
}

/** Options from the prepared Plan B, for an order the agent has no hand-over on yet. */
export function PreparedOptions({ plan, priority, busy, onHandOver }: {
  plan: RankedPlanB; priority: Priority; busy: boolean | string; onHandOver: ((title: string) => void) | null
}) {
  const rows: Row[] = plan.options.map((option) => ({
    key: option.id, tag: null, title: option.title, summary: option.summary, why: option.why,
    arrives: option.delivery, cost: option.cost_eur != null ? option.cost_eur === 0 ? "No extra cost" : `About ${euro(option.cost_eur)}` : null,
    costBasis: option.cost_basis, certainty: option.certainty, risk: option.risk, approval: option.needs_approval,
  }))
  if (!rows.length) return null
  return <section className="recovery-options" aria-label="Recovery options">
    <OptionRows rows={rows} priority={priority} action={(row) => onHandOver
      ? <button type="button" className={`btn small${row === rows[0] ? " primary" : ""}`} disabled={!!busy} onClick={() => onHandOver(row.title)}>Hand to the agent</button>
      : typeof busy === "string" ? <span className="option-wait">{busy}</span> : null} />
    {onHandOver && <p className="recovery-note"><Icon name="note" size={13} />Handing over starts an agent case with this option and your priority. The agent investigates first and comes back with one decision. Nothing is booked, cancelled or sent without your yes.</p>}
    <p className="recovery-note subtle">Times and costs come from the order's records and the agent's quote tools. Quotes are simulated for this demo and marked as estimates where they are not on the order.</p>
  </section>
}

const CHECK_ICON: Record<string, string> = { ferry: "ferry", driver: "driver", hotel: "hotel", promise: "flag", next: "check" }
const CHECK_STATE: Record<string, string> = { found: "Found", none: "Nothing found", not_needed: "Not needed", unknown: "Unknown" }

/** The shadow plan: what the agent's tools looked up, and the boundary it stays inside. */
export function PlanBPanel({ state, onRefresh, agentPlan, onSwitch, busy, zone }: {
  state: PlanState; onRefresh: () => void; agentPlan?: Decision["plan_b"]; onSwitch?: () => void; busy?: boolean; zone: string
}) {
  const plan = state.plan
  const title = state.state === "loading" ? "Preparing Plan B…" : state.state === "error" ? "Plan B could not be prepared"
    : state.state === "insufficient" ? "No safe Plan B yet" : "Plan B is ready"
  return <section className={`planb planb-${state.state}`} aria-label="Plan B" aria-busy={state.state === "loading"}>
    <header className="planb-head">
      <h3><Icon name={state.state === "ready" ? "flag" : state.state === "loading" ? "waiting" : "alert"} size={14} />{title}</h3>
      <button type="button" className="btn quiet small" onClick={onRefresh} disabled={state.state === "loading"}>Check again</button>
    </header>
    {state.state === "loading" && <p className="planb-status"><span className="pulse" aria-hidden="true" />Looking up later sailings, backup drivers, hotels and the delivery promise.</p>}
    {state.state === "error" && <p className="planb-status">{state.error}. Try again, or open the full record.</p>}
    {plan?.reason && state.state !== "loading" && <p className="planb-status">{plan.reason}</p>}
    {agentPlan?.summary && <div className="planb-agent">
      <span className="planb-agent-label">The agent's Plan B</span>
      <p>{agentPlan.summary}</p>
      {agentPlan.trigger && <p className="planb-trigger">Switch when: {agentPlan.trigger}</p>}
      {!!agentPlan.steps?.length && <ol>{agentPlan.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
      {agentPlan.arrives_at && <p className="planb-meta">Arrives {clockIn(agentPlan.arrives_at, zone)} {cityOfZone(zone)} time{agentPlan.cost_eur != null ? ` · ${euro(agentPlan.cost_eur)}` : ""}{agentPlan.certainty ? ` · ${CERTAINTY_LABEL[agentPlan.certainty]}` : ""}</p>}
      {onSwitch && <button type="button" className="btn small" disabled={busy} onClick={onSwitch}>Switch to Plan B now</button>}
    </div>}
    {plan && plan.checks.length > 0 && <ul className="planb-checks">{plan.checks.map((check) => <li key={check.key} className={`planb-check is-${check.status}`}>
      <Icon name={CHECK_ICON[check.key] ?? "dot"} size={14} />
      <span className="planb-check-label">{check.label}</span>
      <span className="planb-check-state">{CHECK_STATE[check.status]}</span>
      <span className="planb-check-text">{check.text}</span>
    </li>)}</ul>}
    <p className="planb-boundary"><Icon name="check" size={13} />{plan?.boundary ?? "Nothing has been booked, cancelled or sent."}</p>
    {plan && <p className="planb-meta">Prepared {new Date(plan.preparedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} by the agent's lookup tools, from the order as recorded at the snapshot. No AI model was needed for this step.</p>}
  </section>
}

/** Starts an agent case on the order with the chosen option and priority, the same way a demo case starts. */
export async function handOver(orderId: string, problem: string, option: string, priority: Priority): Promise<void> {
  const trigger = `Operations asked for a recovery plan. Open point: ${problem}. What matters most today: ${priority}. The option they lean towards: ${option}. Investigate first, then bring one decision.`
  const response = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, trigger }) })
  if (!response.ok) throw new Error("Could not start the agent on this order")
}
