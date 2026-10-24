"use client"

// The order's journey at a glance, at the top of every order. Green is what is
// confirmed, red is where it went wrong, teal is what the agent did about it,
// and grey is still to come. Every row also says so in words, so nobody has to
// read the colours.

import { useEffect, useMemo, useState } from "react"
import { buildTimeline, type AgentCaseLike, type AgentStepLike, type TimelineEntry, type TimelineState } from "@/lib/present/timeline"
import { fmtClock, fmtLong, fmtWeekday, zoneName } from "@/lib/present/time"
import type { RecordView } from "@/lib/present/types"
import { Icon } from "./icons"

const ICON: Record<TimelineState, string> = { done: "check", issue: "alert", agent: "bot", decision: "proposal", update: "message", upcoming: "waiting" }
const LEGEND: { state: TimelineState; label: string }[] = [
  { state: "done", label: "Confirmed" },
  { state: "issue", label: "Conflict or needs attention" },
  { state: "agent", label: "Agent checked or acted" },
  { state: "decision", label: "Decision needed" },
  { state: "upcoming", label: "Upcoming" },
]
// Long, calm stretches fold away so the problem stays near the top.
const FOLD_OVER = 12
const KEEP_BEFORE_PROBLEM = 2

export function OrderTimeline({ view, agentCase, steps, now }: { view: RecordView; agentCase?: AgentCaseLike | null; steps?: AgentStepLike[] | null; now?: number }) {
  const timeline = useMemo(() => buildTimeline(view, { agentCase, steps, now }), [view, agentCase, steps, now])
  const [open, setOpen] = useState(false)
  const zone = view.header.to.zone ?? view.header.from.zone
  const { entries, nowIndex, issues } = timeline

  const firstProblem = entries.findIndex((entry) => entry.state !== "done")
  const foldable = entries.length > FOLD_OVER && firstProblem > KEEP_BEFORE_PROBLEM ? firstProblem - KEEP_BEFORE_PROBLEM : 0
  const hidden = open ? 0 : foldable
  const allCalm = issues === 0

  return <section className="journey-tl" aria-label="Order timeline">
    <header className="journey-tl-head">
      <h2>Timeline</h2>
      <p className={allCalm ? "tone-ok" : "tone-danger"}>
        <Icon name={allCalm ? "check" : "alert"} size={14} />
        {allCalm ? "Everything so far is confirmed. Nothing is open." : `${issues} open point${issues === 1 ? "" : "s"} on this order`}
      </p>
    </header>
    <ul className="journey-tl-legend" aria-label="What the colours mean">
      {LEGEND.map((item) => <li key={item.state} className={`jt-${item.state}`}><span className="jt-mark" aria-hidden="true"><Icon name={ICON[item.state]} size={10} /></span>{item.label}</li>)}
    </ul>
    <ol className="journey-tl-list">
      {hidden > 0 && <li className="jt-fold">
        <button type="button" onClick={() => setOpen(true)}><Icon name="check" size={13} />Show {hidden} earlier confirmed step{hidden === 1 ? "" : "s"}</button>
      </li>}
      {entries.map((entry, index) => index < hidden ? null : <Row entry={entry} zone={zone} key={entry.id} now={index === nowIndex ? timeline.now : null} />)}
      {nowIndex === entries.length && <NowLine at={timeline.now} zone={zone} />}
    </ol>
    {open && foldable > 0 && <button type="button" className="jt-less" onClick={() => setOpen(false)}>Fold the early steps again</button>}
  </section>
}

function Row({ entry, zone, now }: { entry: TimelineEntry; zone: string | null; now: string | null }) {
  return <>
    {now && <NowLine at={now} zone={zone} />}
    <li className={`jt jt-${entry.state}`}>
      <span className="jt-time">{entry.openNow
        ? <>Open now<small>no time recorded</small></>
        : <time dateTime={entry.at} title={fmtLong(entry.at)}>{fmtWeekday(entry.at, zone)}<small className="num">{fmtClock(entry.at, zone)} {zone ? zoneName(new Date(entry.at), zone) : "UTC"}</small></time>}
      </span>
      <span className="jt-mark" aria-hidden="true"><Icon name={ICON[entry.state]} size={11} /></span>
      <span className="jt-body">
        <span className="jt-label">{entry.label}</span>
        <span className="jt-title">{entry.title}</span>
        {entry.detail && <span className="jt-detail">{entry.detail}</span>}
      </span>
    </li>
  </>
}

function NowLine({ at, zone }: { at: string; zone: string | null }) {
  return <li className="jt-now" aria-label={`Now, ${fmtWeekday(at, zone)} ${fmtClock(at, zone)}`}>
    <span className="jt-time num">{fmtClock(at, zone)}</span><span className="jt-now-line" aria-hidden="true" /><span className="jt-now-text">Now</span>
  </li>
}

type CaseData = { case: AgentCaseLike & { id: string; orderId: string }; steps: AgentStepLike[] }

/**
 * The newest agent case on an order and its steps, kept fresh. Used where the
 * case view is not already loading them, such as the full order page.
 */
export function useOrderCase(orderId: string): CaseData | null {
  const [data, setData] = useState<CaseData | null>(null)
  useEffect(() => {
    let caseId: string | null = null
    let status: string | null = null
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      try {
        if (!caseId) {
          const listing = await fetch("/api/cases", { cache: "no-store" }).then((response) => response.json()) as { cases: { id: string; orderId: string; updatedAt: string }[] }
          caseId = listing.cases.filter((item) => item.orderId === orderId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ?? null
        }
        if (caseId) {
          const next = await fetch(`/api/cases/${caseId}`, { cache: "no-store" }).then((response) => response.json()) as CaseData
          status = next.case.status
          if (!stopped) setData(next)
        }
      } catch {
        // The timeline still shows the order's own records without the case.
      }
      if (!stopped && caseId) timer = setTimeout(tick, status === "working" ? 2000 : 8000)
    }
    tick()
    return () => { stopped = true; clearTimeout(timer) }
  }, [orderId])
  return data
}
