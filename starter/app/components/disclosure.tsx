"use client"

import { useState, type ReactNode } from "react"
import { Icon } from "./icons"

export function Disclosure({ id, summary, action, tone, lazy, children }: {
  id?: string; summary: ReactNode; action: string; tone?: "agent" | "alert" | "calm"
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

export function openFold(id: string) {
  const element = document.getElementById(id)
  if (element instanceof HTMLDetailsElement) element.open = true
  element?.scrollIntoView({ behavior: "smooth", block: "start" })
}
