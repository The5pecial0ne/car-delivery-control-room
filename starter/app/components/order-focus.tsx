"use client"

// The workspace for one order, in the order a person decides: what is wrong,
// how long is left, what to optimise for, what to do, then the journey and
// Plan B. Evidence, the agent's trace and the order record are one line each
// and open on request. With an agent case the work is the case itself;
// without one, an order that needs a person still gets ranked options and a
// prepared Plan B.

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { caseNow, zoneForCity } from "@/lib/agent/clock"
import type { RankedPlanB } from "@/lib/agent/plan-b"
import { fmtClock, fmtWeekday } from "@/lib/present/time"
import type { Tone } from "@/lib/present/types"
import { CaseView, type CaseData, type CaseSummary } from "./case-view"
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

  const timeline = detail && <OrderTimeline view={detail.view} agentCase={liveCase} steps={caseData?.case.id === agentCase?.id ? caseData?.steps : null} now={now} planB={plan} />
  const record = detail && <RecordFold detail={detail} />

  return <div className="focus">
    <header className="focus-head">
      <div className="focus-nav">
        <button type="button" className="mail-back" onClick={onBack}><Icon name="chevron" size={13} style={{ transform: "rotate(180deg)" }} /> All orders</button>
        <span className="focus-ref mono">{header?.reference ?? orderId}</span>
        {header && <span className="focus-car">{header.vehicle?.title ?? "Vehicle"}</span>}
        {header && <span className="focus-route">{header.from.city}<Icon name="arrow" size={12} />{header.to.city}</span>}
        {header && <span className="focus-customer">{header.customer.name}</span>}
        <Link className="focus-record-link" href={`/orders/${orderId}`}>Full record<Icon name="arrow" size={12} /></Link>
      </div>
    </header>
    {error && <p className="board-error focus-error" role="alert">{error}</p>}
    {!detail && !error && <div className="skeleton focus-skeleton" aria-busy="true" />}

    {detail && agentCase && <CaseView key={agentCase.id} summary={agentCase} snapshotAt={snapshotAt} onChange={onChange} onLoaded={onLoaded} onPlan={setPlan} timeline={timeline} after={record} />}
    {detail && !agentCase && problem && <Recovery orderId={orderId} problem={problem} zone={zoneForCity(header?.to.city)} onPlan={setPlan} onChange={onChange} timeline={timeline} record={record} />}
    {detail && !agentCase && !problem && <>
      <div className="case-top">
        <p className="case-state"><span className="case-state-main tone-ok"><Icon name="check" size={13} />On track</span></p>
        <h2 className="case-headline">{detail.view.story.headline}</h2>
      </div>
      {timeline}
      <div className="folds">
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
      ? <>Latest update: {latest.text}{latest.actor ? `, ${latest.actor}` : ""}, {fmtWeekday(latest.at, zone)} {fmtClock(latest.at, zone)}. <span className="fold-count">{view.historyTotal} events in the record</span></>
      : <>Order record: dates, people, travel, documents and history.</>}>
    <section className="focus-record" aria-label="Order record">
      <OrderPane detail={detail} />
    </section>
  </Disclosure>
}

/** Recovery for an order the agent has no case on yet: priority, ranked options and Plan B. */
function Recovery({ orderId, problem, zone, onPlan, onChange, timeline, record }: {
  orderId: string; problem: Problem; zone: string; onPlan: (plan: RankedPlanB | null) => void; onChange: () => void
  timeline: React.ReactNode; record: React.ReactNode
}) {
  const [priority, setPriority] = usePriority()
  const planB = usePlanB(orderId, priority, onPlan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return <>
    <header className="case-top">
      <p className="case-state"><span className="case-state-main tone-danger"><Icon name="alert" size={13} />Needs attention</span><span>The agent has not opened a case yet</span></p>
      <h2 className="case-headline">{problem.title}</h2>
      {problem.detail && <p className="case-situation">{problem.detail}{problem.more ? ` (+${problem.more} more open point${problem.more === 1 ? "" : "s"} on the timeline)` : ""}</p>}
      {problem.deadline && <p className={`case-countdown tone-${problem.deadline.tone}`}><Icon name="waiting" size={14} /><b>{problem.deadline.text.charAt(0).toUpperCase() + problem.deadline.text.slice(1)}</b></p>}
    </header>
    <section className="case-decide" id="decide" aria-label="Recovery">
      <PrioritySwitch priority={priority} onChange={setPriority} />
      {planB.state === "loading" && !planB.plan && <p className="recovery-loading"><span className="pulse" aria-hidden="true" />Ranking the options…</p>}
      {planB.plan && <PreparedOptions plan={planB.plan} priority={priority} busy={busy} onHandOver={async (title) => {
        setBusy(true)
        try { await handOver(orderId, problem.title, title, priority); onChange() } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the agent") } finally { setBusy(false) }
      }} />}
      {error && <p className="board-error" role="alert">{error}</p>}
    </section>
    {timeline}
    <PlanBPanel state={planB} onRefresh={planB.refresh} zone={zone} />
    <div className="folds">
      <SitePatternNotice orderId={orderId} />
      {record}
    </div>
  </>
}
