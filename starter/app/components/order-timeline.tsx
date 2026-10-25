"use client"

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { buildTimeline, type AgentCaseLike, type AgentStepLike, type PlanBLike, type TimelineEntry, type TimelineState } from "@/lib/present/timeline"
import { fmtClock, fmtWeekday, zoneName } from "@/lib/present/time"
import type { RecordView } from "@/lib/present/types"
import { Icon } from "./icons"

const ICON: Record<TimelineState, string> = { done: "check", issue: "alert", agent: "bot", decision: "proposal", update: "message", upcoming: "waiting" }
const STATE_WORD: Record<TimelineState, string> = { done: "Confirmed", issue: "Problem", agent: "Agent", decision: "Decision needed", update: "Update", upcoming: "Upcoming" }
const LEGEND: { state: TimelineState; label: string }[] = [
  { state: "done", label: "Confirmed" },
  { state: "issue", label: "Problem or decision" },
  { state: "agent", label: "Agent" },
  { state: "upcoming", label: "Upcoming" },
]
const SOURCE: Record<string, string> = {
  operational_events: "Order event log", alerts: "Alert record", incidents: "Incident record", work_items: "Work item",
  agent_proposals: "Proposal from another agent", "agent case": "Agent case", "plan-b": "Plan B lookups (simulated quotes)",
  time_windows: "Order dates", travel_reservations: "Travel booking", tracking: "Driver app tracking",
}
const MAX_ISSUES = 4

const isProblem = (entry: TimelineEntry) => entry.state === "issue" || entry.state === "decision"

function keyPoints(entries: TimelineEntry[], nowIndex: number): Set<number> {
  const keep = new Set<number>()
  if (!entries.length) return keep
  keep.add(0)
  const issues = entries.map((entry, index) => ({ entry, index })).filter((item) => isProblem(item.entry))
  issues.filter((item) => item.entry.state === "decision").forEach((item) => keep.add(item.index))
  issues.filter((item) => item.entry.state === "issue").slice(-MAX_ISSUES).forEach((item) => keep.add(item.index))
  const firstProblem = issues[0]?.index ?? nowIndex
  const lastGood = entries.slice(0, firstProblem).map((entry) => entry.state).lastIndexOf("done")
  if (lastGood >= 0) keep.add(lastGood)
  const lastDone = entries.slice(0, nowIndex).map((entry) => entry.state).lastIndexOf("done")
  if (lastDone >= 0) keep.add(lastDone)
  entries.forEach((entry, index) => { if (entry.source === "plan-b" || entry.id === "case-opened") keep.add(index) })
  const lastAgent = entries.map((entry) => entry.state).lastIndexOf("agent")
  if (lastAgent >= 0) keep.add(lastAgent)
  if (nowIndex < entries.length) keep.add(nowIndex)
  if (entries.length - 1 > nowIndex) keep.add(entries.length - 1)
  return keep
}

type Slot = { type: "point"; entry: TimelineEntry; index: number } | { type: "more"; count: number; at: number } | { type: "now" }

export function OrderTimeline({ view, agentCase, steps, now, planB }: { view: RecordView; agentCase?: AgentCaseLike | null; steps?: AgentStepLike[] | null; now?: number; planB?: PlanBLike | null }) {
  const timeline = useMemo(() => buildTimeline(view, { agentCase, steps, now, planB }), [view, agentCase, steps, now, planB])
  const [all, setAll] = useState(false)
  const [pinned, setPinned] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const zone = view.header.to.zone ?? view.header.from.zone
  const { entries, nowIndex, issues } = timeline
  const track = useRef<HTMLOListElement>(null)
  const nodes = useRef(new Map<string, HTMLElement>())
  const [arrow, setArrow] = useState(0)

  const keep = useMemo(() => keyPoints(entries, nowIndex), [entries, nowIndex])
  const hiddenCount = entries.length - keep.size
  const focusId = [...entries].reverse().find((entry) => entry.state === "decision")?.id ?? [...entries].reverse().find((entry) => entry.state === "issue")?.id ?? null

  const slots = useMemo(() => {
    const result: Slot[] = []
    entries.forEach((entry, index) => {
      if (index === nowIndex) result.push({ type: "now" })
      if (all || keep.has(index)) { result.push({ type: "point", entry, index }); return }
      const last = result.at(-1)
      if (last?.type === "more") last.count += 1
      else result.push({ type: "more", count: 1, at: index })
    })
    if (nowIndex === entries.length) result.push({ type: "now" })
    return result
  }, [entries, nowIndex, keep, all])

  const activeId = hovered ?? pinned
  const active = entries.find((entry) => entry.id === activeId) ?? null

  const placeArrow = useCallback(() => {
    const node = activeId ? nodes.current.get(activeId) : null
    if (!node || !track.current) return
    setArrow(node.offsetLeft - track.current.scrollLeft + node.offsetWidth / 2)
  }, [activeId])
  useLayoutEffect(placeArrow, [placeArrow, slots])

  useEffect(() => {
    const line = track.current
    const marker = line?.querySelector<HTMLElement>(".hj-now")
    if (line && marker && line.scrollWidth > line.clientWidth) line.scrollLeft = Math.max(0, marker.offsetLeft - line.clientWidth * 0.6)
  }, [entries.length])

  useEffect(() => {
    if (!pinned) return
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPinned(null) }
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [pinned])

  const allCalm = issues === 0
  return <section className="hj" aria-label="Order timeline">
    <header className="hj-head">
      <h2>Journey</h2>
      <p className={allCalm ? "tone-ok" : "tone-danger"}>
        <Icon name={allCalm ? "check" : "alert"} size={13} />
        {allCalm ? "Everything so far is confirmed" : `${issues} open point${issues === 1 ? "" : "s"}`}
      </p>
      <ul className="hj-legend" aria-label="What the colours mean">
        {LEGEND.map((item) => <li key={item.state} className={`hj-${item.state}`}><span className="hj-dot" aria-hidden="true" />{item.label}</li>)}
      </ul>
      {(hiddenCount > 0 || all) && <button type="button" className="hj-toggle" onClick={() => setAll((value) => !value)} aria-expanded={all}>
        {all ? "Key points only" : `+ ${hiddenCount} more update${hiddenCount === 1 ? "" : "s"}`}
      </button>}
    </header>
    <ol className="hj-track" ref={track} onMouseLeave={() => setHovered(null)} onScroll={placeArrow}>
      {slots.map((slot, at) => {
        if (slot.type === "now") return <li key="now" className="hj-now" aria-label={`Now, ${fmtWeekday(timeline.now, zone)} ${fmtClock(timeline.now, zone)}`}><span>Now</span></li>
        if (slot.type === "more") return <li key={`more-${slot.at}`} className="hj-more">
          <button type="button" onClick={() => setAll(true)} title={`Show ${slot.count} more update${slot.count === 1 ? "" : "s"}`}>+{slot.count}</button>
        </li>
        const { entry } = slot
        const open = entry.id === activeId
        const pastNow = slot.index >= nowIndex
        return <li key={entry.id} className={`hj-point hj-${entry.state}${entry.id === focusId ? " is-focus" : ""}${open ? " is-open" : ""}${pastNow ? " is-future" : ""}${slots[at + 1] ? "" : " is-last"}`}
          ref={(element) => { if (element) nodes.current.set(entry.id, element); else nodes.current.delete(entry.id) }}>
          <button type="button" aria-expanded={open} aria-controls="hj-card"
            aria-label={`${STATE_WORD[entry.state]}: ${entry.title}, ${entry.openNow ? "open now" : `${fmtWeekday(entry.at, zone)} ${fmtClock(entry.at, zone)}`}`}
            onMouseEnter={() => setHovered(entry.id)} onFocus={() => setHovered(entry.id)} onBlur={() => setHovered(null)}
            onClick={() => { const closing = pinned === entry.id; setPinned(closing ? null : entry.id); if (closing) setHovered(null) }}>
            <span className="hj-mark" aria-hidden="true"><Icon name={ICON[entry.state]} size={entry.id === focusId ? 12 : 10} /></span>
            <span className="hj-title">{entry.title}</span>
            <span className="hj-time num">{entry.openNow ? "Open now" : <>{fmtWeekday(entry.at, zone)} {fmtClock(entry.at, zone)}</>}</span>
          </button>
        </li>
      })}
    </ol>
    {active && <PointCard entry={active} zone={zone} arrow={arrow} pinned={pinned === active.id} onClose={() => { setPinned(null); setHovered(null) }} />}
    {!active && <p className="hj-hint">Point at, tab to or tap any step to see when it happened and where it comes from.</p>}
  </section>
}

function PointCard({ entry, zone, arrow, pinned, onClose }: { entry: TimelineEntry; zone: string | null; arrow: number; pinned: boolean; onClose: () => void }) {
  const source = SOURCE[entry.source] ?? entry.source.charAt(0).toUpperCase() + entry.source.slice(1).replace(/_/g, " ")
  return <div className={`hj-card hj-${entry.state}`} id="hj-card" role="region" aria-live="polite" aria-label="Timeline step details" style={{ "--hj-arrow": `${Math.max(14, arrow)}px` } as React.CSSProperties}>
    <p className="hj-card-meta">
      <b>{STATE_WORD[entry.state]}</b>
      <span>{entry.openNow ? "Open now, no time recorded" : <time dateTime={entry.at}>{fmtWeekday(entry.at, zone)} {fmtClock(entry.at, zone)} {zone ? zoneName(new Date(entry.at), zone) : "UTC"}</time>}</span>
      {pinned && <button type="button" className="hj-card-close" onClick={onClose} aria-label="Close">×</button>}
    </p>
    <p className="hj-card-title">{entry.title}</p>
    {entry.detail && <p className="hj-card-detail">{entry.detail}</p>}
    <p className="hj-card-source">Source: {source}{entry.label !== STATE_WORD[entry.state] ? ` · ${entry.label}` : ""}</p>
  </div>
}

type CaseData = { case: AgentCaseLike & { id: string; orderId: string }; steps: AgentStepLike[] }

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
      }
      if (!stopped && caseId) timer = setTimeout(tick, status === "working" ? 2000 : 8000)
    }
    tick()
    return () => { stopped = true; clearTimeout(timer) }
  }, [orderId])
  return data
}
