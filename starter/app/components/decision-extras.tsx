"use client"

// The parts of a hand-over that help a person act in time: what must happen
// before when (a countdown, not a risk score), the plan B the agent prepared
// while waiting, and the options ranked by what matters most right now.

import { useEffect, useMemo, useState } from "react"
import { caseNow, cityOfZone, clockIn, countdown } from "@/lib/agent/clock"
import { actionLabel, CERTAINTY_LABEL, type Certainty, type Deadline, type Option, type PlanB } from "@/lib/agent/labels"
import { Icon } from "./icons"

/** The case clock, ticking every 20 seconds. */
export function useCaseNow(snapshotAt: string | null | undefined, createdAt: string): number {
  const [now, setNow] = useState(() => caseNow(snapshotAt, createdAt))
  useEffect(() => {
    setNow(caseNow(snapshotAt, createdAt))
    const timer = setInterval(() => setNow(caseNow(snapshotAt, createdAt)), 20_000)
    return () => clearInterval(timer)
  }, [snapshotAt, createdAt])
  return now
}

export const nextDeadline = (deadlines: Deadline[] | undefined, now: number) =>
  (deadlines ?? []).find((deadline) => new Date(deadline.at).getTime() > now) ?? null

const euro = (value: number) => value.toLocaleString("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })

export function Deadlines({ deadlines, now, zone }: { deadlines: Deadline[]; now: number; zone: string }) {
  const next = nextDeadline(deadlines, now)
  const head = next ? countdown(next.at, now) : null
  return <section className="deadlines" aria-label="Before when">
    {next && head && <p className={`deadline-lead tone-${head.tone}`}>
      <b className="num">{head.left}</b> until {next.what.charAt(0).toLowerCase() + next.what.slice(1)}
    </p>}
    {!next && <p className="deadline-lead tone-danger">Every deadline on this case has passed.</p>}
    <ol className="deadline-list">{deadlines.map((deadline, index) => {
      const left = countdown(deadline.at, now)
      const where = deadline.zone ?? zone
      return <li key={index} className={left.passed ? "passed" : deadline === next ? "next" : undefined}>
        <span className="deadline-time num">{clockIn(deadline.at, where)}<small>{cityOfZone(where)}</small></span>
        <span className="deadline-what">{deadline.what}{deadline.miss && <small>If missed: {deadline.miss}</small>}</span>
        <span className={`deadline-left num tone-${left.passed ? "subtle" : left.tone}`}>{left.passed ? `passed ${left.left} ago` : `in ${left.left}`}</span>
      </li>
    })}</ol>
  </section>
}

export function PlanBPanel({ plan, zone, busy, onSwitch }: { plan: PlanB; zone: string; busy: boolean; onSwitch: () => void }) {
  return <section className="plan-b" aria-label="Plan B">
    <p className="decision-label"><Icon name="flag" size={14} /> Plan B, ready if needed</p>
    {plan.trigger && <p className="plan-b-trigger">{plan.trigger}</p>}
    {plan.summary && <p className="decision-summary">{plan.summary}</p>}
    {!!plan.steps?.length && <ol className="plan-b-steps">{plan.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>}
    <Scores option={plan} zone={zone} />
    <div className="decision-buttons"><button type="button" className="btn" disabled={busy} onClick={onSwitch}>Switch to plan B now</button></div>
  </section>
}

function Scores({ option, zone }: { option: Option; zone: string }) {
  if (!option.arrives_at && option.cost_eur == null && !option.certainty) return null
  return <p className="option-scores">
    {option.arrives_at && <span>Arrives {clockIn(option.arrives_at, zone)}</span>}
    {option.cost_eur != null && <span className="num">{euro(option.cost_eur)}</span>}
    {option.certainty && <span className={`certainty certainty-${option.certainty}`}>{CERTAINTY_LABEL[option.certainty]}</span>}
  </p>
}

export type Priority = "balanced" | "speed" | "cost" | "certainty"
const PRIORITIES: { key: Priority; label: string }[] = [
  { key: "balanced", label: "Balanced" }, { key: "speed", label: "Speed" }, { key: "cost", label: "Cost" }, { key: "certainty", label: "Certainty" },
]
const SURE: Record<Certainty, number> = { confirmed: 0, quoted: 1, uncertain: 2 }

// Lower is better. Missing numbers sort last, so an option without a price never "wins" on cost.
function score(option: Option, priority: Priority): number[] {
  const time = option.arrives_at ? new Date(option.arrives_at).getTime() : Infinity
  const cost = option.cost_eur ?? Infinity
  const sure = option.certainty ? SURE[option.certainty] : 3
  if (priority === "speed") return [time, sure, cost]
  if (priority === "cost") return [cost, sure, time]
  return [sure, time, cost]
}
function compare(a: number[], b: number[]): number {
  const index = a.findIndex((value, at) => value !== b[at])
  return index === -1 ? 0 : a[index] < b[index] ? -1 : 1
}

function usePriority(): [Priority, (value: Priority) => void] {
  const [priority, setPriority] = useState<Priority>("balanced")
  useEffect(() => {
    try { const saved = localStorage.getItem("desk-priority") as Priority | null; if (saved) setPriority(saved) } catch { /* private window */ }
  }, [])
  const choose = (value: Priority) => {
    setPriority(value)
    try { localStorage.setItem("desk-priority", value) } catch { /* private window */ }
  }
  return [priority, choose]
}

/**
 * Every option the agent offered, ranked by what the person cares about most
 * today. "Balanced" keeps the agent's own order. Choosing another option tells
 * the agent which priority made the difference.
 */
export function OptionCompare({ options, zone, busy, onChoose }: {
  options: { option: Option; tag: string }[]; zone: string; busy: boolean
  onChoose: (option: Option, priority: Priority, tag: string) => void
}) {
  const [priority, setPriority] = usePriority()
  const ranked = useMemo(() => priority === "balanced" ? options : [...options].sort((a, b) => compare(score(a.option, priority), score(b.option, priority))), [options, priority])
  if (options.length < 2) return null
  return <section className="compare" aria-label="Compare options">
    <div className="compare-head">
      <h3 className="case-sec-title">Compare options</h3>
      <div className="segmented" role="radiogroup" aria-label="What matters most today">
        {PRIORITIES.map((item) => <button key={item.key} type="button" role="radio" aria-checked={priority === item.key} className={priority === item.key ? "on" : undefined} onClick={() => setPriority(item.key)}>{item.label}</button>)}
      </div>
    </div>
    <ol className="compare-list">{ranked.map(({ option, tag }, index) => <li key={tag} className={index === 0 ? "best" : undefined}>
      <div className="compare-main">
        <span className="compare-tag">{index === 0 ? priority === "balanced" ? "Agent's pick" : `Best for ${priority}` : tag}</span>
        <b>{actionLabel(option.action)}</b>
        <span className="compare-summary">{option.summary}</span>
        <Scores option={option} zone={zone} />
      </div>
      {tag !== "Recommended" && <button type="button" className="btn quiet" disabled={busy} onClick={() => onChoose(option, priority, tag)}>Choose<Icon name="arrow" size={13} /></button>}
    </li>)}</ol>
  </section>
}
