"use client"

// The workspace for one order: who and what it is, its timeline, then the work.
// With an agent case that is the case itself (investigation, recovery,
// approvals). Without one, an order that needs a person still gets its
// recovery options and a prepared Plan B. Then the order's own record.

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { caseNow, zoneForCity } from "@/lib/agent/clock"
import type { RankedPlanB } from "@/lib/agent/plan-b"
import type { Tone } from "@/lib/present/types"
import { CaseView, type CaseData, type CaseSummary } from "./case-view"
import { Icon } from "./icons"
import { OrderPane, type Detail } from "./order-detail"
import { OrderTimeline } from "./order-timeline"
import { handOver, PlanBPanel, PreparedOptions, PrioritySwitch, usePlanB, usePriority } from "./recovery"
import { SitePatternNotice } from "./site-pattern"

export function OrderFocus({ orderId, agentCase, problem, snapshotAt, onBack, onChange }: {
  orderId: string; agentCase: CaseSummary | null; problem: { title: string; tone: Tone } | null; snapshotAt: string | null; onBack: () => void; onChange: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [caseData, setCaseData] = useState<CaseData | null>(null)
  const [plan, setPlan] = useState<RankedPlanB | null>(null)
  // The case clock ticks, so the "Now" line and the deadlines move on their own.
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

  return <div className="focus">
    <header className="focus-head">
      <div className="focus-nav">
        <button type="button" className="mail-back" onClick={onBack}><Icon name="chevron" size={13} style={{ transform: "rotate(180deg)" }} /> All orders</button>
        <span className="focus-ref mono">{header?.reference ?? orderId}</span>
        {header && <span className="focus-customer">{header.customer.name}</span>}
        <Link className="focus-record-link" href={`/orders/${orderId}`}>Full record<Icon name="arrow" size={12} /></Link>
      </div>
      {header && <h1 className="focus-title">{header.vehicle?.title ?? "Vehicle"}<span className="focus-route">{header.from.city}<Icon name="arrow" size={14} />{header.to.city}</span></h1>}
      {detail && <p className={`focus-status${problem ? " is-problem" : " is-calm"}`}>
        <Icon name={problem ? "alert" : "check"} size={14} />
        <b>{problem ? "Needs attention" : "On track"}</b>
        <span>{problem ? problem.title : detail.view.story.headline}</span>
      </p>}
    </header>
    {error && <p className="board-error focus-error" role="alert">{error}</p>}
    {!detail && !error && <div className="skeleton focus-skeleton" aria-busy="true" />}
    {detail && <OrderTimeline view={detail.view} agentCase={liveCase} steps={caseData?.case.id === agentCase?.id ? caseData?.steps : null} now={now} planB={plan} />}

    {agentCase
      ? <CaseView key={agentCase.id} summary={agentCase} snapshotAt={snapshotAt} onBack={onBack} onChange={onChange} onLoaded={onLoaded} onPlan={setPlan} />
      : <>
          {problem && detail && <Recovery orderId={orderId} problem={problem.title} zone={zoneForCity(header?.to.city)} onPlan={setPlan} onChange={onChange} />}
          {detail && <section className="focus-record" aria-label="Order record">
            <h2 className="ws-title">Order record</h2>
            <SitePatternNotice orderId={orderId} />
            <OrderPane detail={detail} />
          </section>}
        </>}
  </div>
}

/** Recovery for an order the agent has no case on yet: priority, ranked options and Plan B. */
function Recovery({ orderId, problem, zone, onPlan, onChange }: { orderId: string; problem: string; zone: string; onPlan: (plan: RankedPlanB | null) => void; onChange: () => void }) {
  const [priority, setPriority] = usePriority()
  const planB = usePlanB(orderId, priority, onPlan)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return <section className="stage stage-two recovery" id="decide" aria-label="Recovery">
    <p className="stage-label">Recovery <small>The agent has not opened a case here yet. Its lookup tools have already prepared the options.</small></p>
    <PrioritySwitch priority={priority} onChange={setPriority} />
    {planB.plan && <PreparedOptions plan={planB.plan} priority={priority} busy={busy} onHandOver={async (title) => {
      setBusy(true)
      try { await handOver(orderId, problem, title, priority); onChange() } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the agent") } finally { setBusy(false) }
    }} />}
    {error && <p className="board-error" role="alert">{error}</p>}
    <PlanBPanel state={planB} onRefresh={planB.refresh} zone={zone} />
  </section>
}
