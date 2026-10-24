"use client"

// One line that says what is behind it, and a clear way to open it. Used for
// everything the operator might want but does not need to decide: evidence,
// the agent's trace, the full history, the order record. The content stays
// in the page, so nothing is lost by folding it away.

import type { ReactNode } from "react"
import { Icon } from "./icons"

export function Disclosure({ id, summary, action, tone, children }: {
  id?: string; summary: ReactNode; action: string; tone?: "agent" | "alert" | "calm"; children: ReactNode
}) {
  return <details className={`fold${tone ? ` fold-${tone}` : ""}`} id={id}>
    <summary>
      <span className="fold-summary">{summary}</span>
      <span className="fold-action"><span className="fold-show">{action}</span><span className="fold-hide">Hide</span><Icon name="chevron" size={12} /></span>
    </summary>
    <div className="fold-body">{children}</div>
  </details>
}

/** Opens a folded section and brings it into view, for links like "Show evidence". */
export function openFold(id: string) {
  const element = document.getElementById(id)
  if (element instanceof HTMLDetailsElement) element.open = true
  element?.scrollIntoView({ behavior: "smooth", block: "start" })
}
