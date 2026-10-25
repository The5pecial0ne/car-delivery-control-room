"use client"

// The workspace for one order, in the order a person decides: what is wrong,
// how long is left, what to optimise for and what to do. Evidence, Plan B,
// the journey, the agent's trace and the order record are one line each and
// open on request. With an agent case the work is the case itself;
// without one, an order that needs a person still gets ranked options and a
// prepared Plan B.

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { caseNow, zoneForCity } from "@/lib/agent/clock"
import type { RankedPlanB } from "@/lib/agent/plan-b"
import { fmtClock, fmtWeekday } from "@/lib/present/time"
import type { Tone } from "@/lib/present/types"
import { CaseHead, CaseView, issueLine, type CaseData, type CaseSummary } from "./case-view"
import { Disclosure } from "./disclosure"
import { Icon } from "./icons"
import { OrderPane, type Detail } from "./order-detail"
import { OrderTimeline } from "./order-timeline"
import { handOver, PlanBPanel, PreparedOptions, PrioritySwitch, usePlanB, usePriority } from "./recovery"
import { SitePatternNotice } from "./site-pattern"

export type Problem = { title: string; detail: string | null; more: number; tone: Tone; deadline: { text: string; tone: Tone } | null }

export function OrderFocus({ orderId, agentCase, problem, snapshotAt, onBack, onChange }: {
  orderId: string; agentCase: CaseSummary | null; problem: Problem | null; snapshotAt: string | null; onBack: () => void; onChange: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [caseData, setCaseData] = useState<CaseData | null>(null)
  const [plan, setPlan] = useState<RankedPlanB | null>(null)
  // The case clock ticks, so the "Now" marker and the deadlines move on their own.
  const [wall, setWall] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setWall(Date.now()), 20_000); return () => clearInterval(timer) }, [])

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setCaseData(null)
    setPlan(null)
    fetch(`/api/orders/${encodeURIComponent(orderId)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(response.status === 404 ? "Order not found" : "Could not load the order"); return response.json() as Promise<Detail> })
      .then((data) => { setDetail(data); setError("") })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the order") })
    return () => controller.abort()
  }, [orderId])

  const onLoaded = useCallback((data: CaseData) => setCaseData(data), [])
  const liveCase = caseData?.case.id === agentCase?.id ? caseData?.case ?? agentCase : agentCase
  const now = liveCase ? caseNow(snapshotAt, liveCase.createdAt, wall) : undefined
  const header = detail?.view.header

  const title = header ? `${header.vehicle?.title ?? "Vehicle"} · ${header.from.city} → ${header.to.city}` : null
  // The journey measures itself when it first draws, so it mounts when opened.
  const timeline = detail && <Disclosure id="delivery-timeline" lazy action="View timeline"
    summary={<>Full delivery timeline, from order to handover.</>}>
    <OrderTimeline view={detail.view} agentCase={liveCase} steps={caseData?.case.id === agentCase?.id ? caseData?.steps : null} now={now} planB={plan} />
  </Disclosure>
  const record = detail && <RecordFold detail={detail} />

  return <div className="focus">
    <header className="focus-head">
      <div className="focus-nav">
        <button type="button" className="mail-back" onClick={onBack}><Icon name="chevron" size={13} style={{ transform: "rotate(180deg)" }} /> All orders</button>
        <span className="focus-ref mono">{header?.reference ?? orderId}</span>
        {header && <span className="focus-customer">{header.customer.name}</span>}
        <Link className="focus-record-link" href={`/orders/${orderId}`}>Full record<Icon name="arrow" size={12} /></Link>
      </div>
    </header>
    {error && <p className="board-error focus-error" role="alert">{error}</p>}
    {!detail && !error && <div className="skeleton focus-skeleton" aria-busy="true" />}

    {detail && agentCase && <CaseView key={agentCase.id} summary={agentCase} snapshotAt={snapshotAt} onChange={onChange} onLoaded={onLoaded} onPlan={setPlan} title={title} timeline={timeline} after={record} />}
    {detail && !agentCase && problem && <Recovery orderId={orderId} problem={problem} title={title ?? orderId} zone={zoneForCity(header?.to.city)} onPlan={setPlan} onChange={onChange} timeline={timeline} record={record} />}
    {detail && !agentCase && !problem && <>
      {/* A routine follow-up (an open thread, an owned alert) is named, so "On track" never hides it. */}
      {detail.view.attention[0]
        ? <CaseHead label="Followed up by the team" tone="accent" title={title ?? orderId}
            issue={`${detail.view.attention[0].title}${detail.view.attention[0].owner ? `, with ${detail.view.attention[0].owner}` : ""}. Nothing for you to decide. ${detail.view.story.headline}`} />
        : <CaseHead label="On track" tone="ok" title={title ?? orderId} issue={detail.view.story.headline} />}
      <div className="folds">
        {timeline}
        <SitePatternNotice orderId={orderId} />
        {record}
      </div>
    </>}
  </div>
}

/** The order's own record, folded behind its latest update. */
function RecordFold({ detail }: { detail: Detail }) {
  const { view } = detail
  const latest = view.history[0]?.events[0]
  const zone = view.header.to.zone ?? view.header.from.zone
  return <Disclosure id="order-record" action="View full history"
    summary={latest
      ? <>Past updates and documents. Latest: {latest.text}{latest.actor ? `, ${latest.actor}` : ""}, {fmtWeekday(latest.at, zone)} {fmtClock(latest.at, zone)}. <span className="fold-count">{view.historyTotal} events in the record</span></>
      : <>Order record: dates, people, travel, documents and history.</>}>
    <section className="focus-record" aria-label="Order record">
      <OrderPane detail={detail} />
    </section>
  </Disclosure>
}

/** Recovery for an order the agent has no case on yet: priority, ranked options and Plan B. */
function Recovery({ orderId, problem, title, zone, onPlan, onChange, timeline, record }: {
  orderId: string; problem: Problem; title: string; zone: string; onPlan: (plan: RankedPlanB | null) => void; onChange: () => void
  timeline: React.ReactNode; record: React.ReactNode
}) {
  const [priority, setPriority] = usePriority()
  const planB = usePlanB(orderId, priority, onPlan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return <>
    <CaseHead label="Needs attention" tone="danger" title={title}
      issue={issueLine(problem.title, problem.detail)}
      deadline={problem.deadline ? { left: null, what: problem.deadline.text.charAt(0).toUpperCase() + problem.deadline.text.slice(1), tone: problem.deadline.tone } : null} />
    <section className="case-decide" id="decide" aria-label="Recovery">
      <PrioritySwitch priority={priority} onChange={setPriority} />
      {planB.state === "loading" && !planB.plan && <p className="recovery-loading"><span className="pulse" aria-hidden="true" />Ranking the options…</p>}
      {planB.plan && <PreparedOptions plan={planB.plan} priority={priority} busy={busy} onHandOver={async (title) => {
        setBusy(true)
        try { await handOver(orderId, problem.title, title, priority); onChange() } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the agent") } finally { setBusy(false) }
      }} />}
      {error && <p className="board-error" role="alert">{error}</p>}
    </section>
    <div className="folds">
      <PlanBPanel state={planB} onRefresh={planB.refresh} zone={zone} />
      {timeline}
      <SitePatternNotice orderId={orderId} />
      {record}
    </div>
  </>
}
