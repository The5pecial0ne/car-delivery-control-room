"use client"

// The reading pane of the control room: the order's timeline first, then the
// agent's case when there is one (investigation, recovery, approvals), or the
// order's own record when there is not.

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { caseNow } from "@/lib/agent/clock"
import { CaseView, type CaseData, type CaseSummary } from "./case-view"
import { Icon } from "./icons"
import { OrderPane, type Detail } from "./order-detail"
import { OrderTimeline } from "./order-timeline"
import { SitePatternNotice } from "./site-pattern"

export function OrderFocus({ orderId, agentCase, snapshotAt, onBack, onChange }: {
  orderId: string; agentCase: CaseSummary | null; snapshotAt: string | null; onBack: () => void; onChange: () => void
}) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [error, setError] = useState("")
  const [caseData, setCaseData] = useState<CaseData | null>(null)
  // The case clock ticks, so the "Now" line and the deadlines move on their own.
  const [wall, setWall] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setWall(Date.now()), 20_000); return () => clearInterval(timer) }, [])

  useEffect(() => {
    const controller = new AbortController()
    setDetail(null)
    setCaseData(null)
    fetch(`/api/orders/${encodeURIComponent(orderId)}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(response.status === 404 ? "Order not found" : "Could not load the order"); return response.json() as Promise<Detail> })
      .then((data) => { setDetail(data); setError("") })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the order") })
    return () => controller.abort()
  }, [orderId])

  const onLoaded = useCallback((data: CaseData) => setCaseData(data), [])
  const liveCase = caseData?.case.id === agentCase?.id ? caseData?.case ?? agentCase : agentCase
  const now = liveCase ? caseNow(snapshotAt, liveCase.createdAt, wall) : undefined

  return <div className="focus">
    <div className="focus-top">
      <div className="focus-nav">
        <button type="button" className="mail-back" onClick={onBack}><Icon name="chevron" size={13} style={{ transform: "rotate(180deg)" }} /> All orders</button>
        <Link className="focus-record-link" href={`/orders/${orderId}`}>Open the full record<Icon name="arrow" size={12} /></Link>
      </div>
      {error && <p className="board-error focus-error" role="alert">{error}</p>}
      {!detail && !error && <div className="skeleton focus-skeleton" aria-busy="true" />}
      {detail && <OrderTimeline view={detail.view} agentCase={liveCase} steps={caseData?.case.id === agentCase?.id ? caseData?.steps : null} now={now} />}
    </div>
    {agentCase
      ? <CaseView key={agentCase.id} summary={agentCase} snapshotAt={snapshotAt} onBack={onBack} onChange={onChange} onLoaded={onLoaded} />
      : detail && <div className="focus-record">
          <SitePatternNotice orderId={orderId} />
          <OrderPane detail={detail} />
        </div>}
  </div>
}
