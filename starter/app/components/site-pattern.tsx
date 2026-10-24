"use client"

// "Site pattern detected": shown on an order and on its case when the pickup
// or delivery place keeps causing the same kind of trouble. One line by
// default; the advice and the other orders open underneath.

import Link from "next/link"
import { useEffect, useState } from "react"
import type { SitePattern } from "@/lib/agent/patterns"
import { Disclosure } from "./disclosure"

export function SitePatternNotice({ orderId }: { orderId: string }) {
  const [patterns, setPatterns] = useState<SitePattern[]>([])
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/patterns?order=${encodeURIComponent(orderId)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() as Promise<{ patterns: SitePattern[] }> : { patterns: [] })
      .then((data) => setPatterns(data.patterns))
      .catch(() => { /* a missing notice is fine */ })
    return () => controller.abort()
  }, [orderId])
  if (!patterns.length) return null
  return <>{patterns.map((pattern) => {
    const others = new Set(pattern.signals.filter((signal) => signal.orderId !== orderId).map((signal) => signal.orderId))
    const themes = pattern.themes.slice(0, 3).map((theme) => theme.label.toLowerCase()).join(", ")
    return <Disclosure key={pattern.siteId} tone="agent" action="View pattern"
      summary={<><b>Site pattern:</b> {pattern.troubledOrders} of {pattern.orders} recent orders at {pattern.siteName} needed a manual check{themes ? ` (${themes})` : ""}.</>}>
      <aside className="site-pattern" aria-label="Site pattern">
        <p className="site-pattern-head">
          <b>{pattern.troubledOrders} of {pattern.orders} recent orders</b> at <Link href={`/sites/${pattern.siteId}`}>{pattern.siteName}</Link> needed a manual check
          {themes && <>: {themes}</>}.
        </p>
        <p className="site-pattern-advice">Recommendation: {pattern.themes[0]?.advice}{pattern.themes[1] && pattern.themes[1].theme !== "contact" ? ` ${pattern.themes[1].advice}` : ""}</p>
        {others.size > 0 && <p className="site-pattern-orders">Seen on {[...others].map((id, index) => <span key={id}>{index ? ", " : ""}<Link className="ref-link" href={`/orders/${id}`}>{id}</Link></span>)}</p>}
      </aside>
    </Disclosure>
  })}</>
}
