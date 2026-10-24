"use client"

// One line that says what is behind it, and a clear way to open it. Used for
// everything the operator might want but does not need to decide: evidence,
// the agent's trace, the full history, the order record. The content stays
// in the page, so nothing is lost by folding it away.

import { useState, type ReactNode } from "react"
import { Icon } from "./icons"

export function Disclosure({ id, summary, action, tone, lazy, children }: {
  id?: string; summary: ReactNode; action: string; tone?: "agent" | "alert" | "calm"
  /** Render the content only once it is opened, for parts that measure themselves on mount (the journey line). */
  lazy?: boolean
  children: ReactNode
}) {
  const [opened, setOpened] = useState(false)
  return <details className={`fold${tone ? ` fold-${tone}` : ""}`} id={id} onToggle={(event) => { if (event.currentTarget.open) setOpened(true) }}>
    <summary>
      <span className="fold-summary">{summary}</span>
      <span className="fold-action"><span className="fold-show">{action}</span><span className="fold-hide">Hide</span><Icon name="chevron" size={12} /></span>
    </summary>
    <div className="fold-body">{!lazy || opened ? children : null}</div>
  </details>
}

/** Opens a folded section and brings it into view, for links like "View evidence". */
export function openFold(id: string) {
  const element = document.getElementById(id)
  if (element instanceof HTMLDetailsElement) element.open = true
  element?.scrollIntoView({ behavior: "smooth", block: "start" })
}
