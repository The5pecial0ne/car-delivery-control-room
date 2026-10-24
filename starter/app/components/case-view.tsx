"use client"

// One case, read top to bottom the way a person decides: what happened, what
// the agent suggests, what it found and where each fact came from, then the
// full story of how it got there. The decision sits above the history because
// that is what the person came for.

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { actionLabel, isPersonLed, parseSource, URGENCY, type Decision } from "@/lib/agent/labels"
import { fmtClock } from "@/lib/present/time"
import { Icon } from "./icons"
import { Chip } from "./ui"

export type CaseSummary = {
  id: string
  orderId: string
  status: "working" | "needs_person" | "resolved" | "failed"
  trigger: string
  headline: string | null
  pendingDecision: Decision | null
  createdAt: string
  updatedAt: string
  running: boolean
  order: { reference: string; customer: string | null; car: string | null; from: string | null; to: string | null } | null
}

type Step = { id: string; seq: number; actor: "agent" | "driver" | "person" | "system"; kind: string; body: string; data: Record<string, unknown>; createdAt: string }

const STATUS: Record<CaseSummary["status"], { label: string; tone: "warn" | "accent" | "ok" | "danger" }> = {
  needs_person: { label: "Needs your decision", tone: "warn" },
  working: { label: "Agent is working", tone: "accent" },
  resolved: { label: "Handled", tone: "ok" },
  failed: { label: "Agent stopped", tone: "danger" },
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? "Something went wrong")
}

export function CaseView({ summary, onBack, onChange }: { summary: CaseSummary; onBack: () => void; onChange: () => void }) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [detail, setDetail] = useState<CaseSummary>(summary)
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const response = await fetch(`/api/cases/${summary.id}`, { cache: "no-store" })
    if (!response.ok) { setError("Could not load this case"); return }
    const data = await response.json() as { case: CaseSummary; steps: Step[] }
    setDetail((old) => ({ ...old, ...data.case }))
    setSteps(data.steps)
    setError("")
  }, [summary.id])

  const live = detail.status === "working" || detail.running
  useEffect(() => {
    load()
    const timer = setInterval(load, live ? 1500 : 6000)
    return () => clearInterval(timer)
  }, [load, live])

  // Something the person did changes the case: reload it here and in the list.
  const act = async (url: string, body: unknown) => {
    try {
      await post(url, body)
      setDetail((old) => ({ ...old, status: "working", pendingDecision: null }))
      setError("")
      setTimeout(() => { load(); onChange() }, 300)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong")
    }
  }

  const status = STATUS[detail.status]
  const decision = detail.status === "needs_person" ? detail.pendingDecision : null
  const order = detail.order

  return <article className="case">
    <button type="button" className="mail-back" onClick={onBack}><Icon name="chevron" size={13} style={{ transform: "rotate(180deg)" }} /> All cases</button>
    <div className="case-context">
      <Link className="ref-link" href={`/orders/${detail.orderId}`}>{order?.reference ?? detail.orderId}</Link>
      {order?.car && <span>{order.car}</span>}
      {order?.customer && <span>for {order.customer}</span>}
      {order?.from && order?.to && <span className="case-route">{order.from}<Icon name="arrow" size={12} />{order.to}</span>}
    </div>
    <div className="chips case-chips">
      <Chip tone={status.tone} dot>{live ? <><span className="pulse" aria-hidden="true" />{status.label}</> : status.label}</Chip>
      {decision?.urgency && URGENCY[decision.urgency] && <Chip tone={URGENCY[decision.urgency].tone}>Urgency: {URGENCY[decision.urgency].label}</Chip>}
    </div>
    <h2 className={`story-headline case-headline${detail.status === "failed" ? " tone-danger" : ""}`}>{detail.headline ?? detail.trigger}</h2>
    {decision?.situation && <p className="story-detail case-situation">{decision.situation}</p>}
    {!decision && detail.status === "working" && <p className="case-working">The agent is looking into this. It will bring you a decision if it needs one.</p>}
    {error && <p className="board-error case-error" role="alert">{error}</p>}

    {decision && <DecisionPanel decision={decision} onAct={(body) => act(`/api/cases/${detail.id}/decision`, body)} />}
    {decision && <Findings decision={decision} steps={steps ?? []} />}

    <section className="case-story" aria-label="What happened">
      <h3 className="case-sec-title">How it went</h3>
      {!steps && <p className="empty">Loading…</p>}
      {steps && <Timeline steps={steps} live={live} />}
    </section>

    <Composer disabled={live} onSend={(text) => act(`/api/cases/${detail.id}/message`, { text })} />
  </article>
}

function DecisionPanel({ decision, onAct }: { decision: Decision; onAct: (body: { choice: string; note?: string }) => Promise<void> }) {
  const recommendation = decision.recommendation ?? {}
  const [draft, setDraft] = useState(recommendation.customer_message_draft ?? "")
  const [mode, setMode] = useState<"idle" | "done" | "change" | "reject">("idle")
  const personLed = isPersonLed(recommendation.action)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)

  const run = async (body: { choice: string; note?: string }) => {
    setBusy(true)
    try { await onAct(body) } finally { setBusy(false) }
  }
  const approve = (outcome?: string) => {
    const edited = recommendation.customer_message_draft && draft.trim() !== recommendation.customer_message_draft.trim()
    const sent = recommendation.customer_message_draft ? `${edited ? "Edited customer message, as sent" : "Customer message sent as drafted"}: ${draft.trim()}` : ""
    run({ choice: "approve", note: [outcome?.trim() && `How it went: ${outcome.trim()}`, sent].filter(Boolean).join("\n\n") || undefined })
  }

  return <section className="decision" aria-label="Decision">
    <p className="decision-label"><Icon name="proposal" size={14} /> The agent suggests</p>
    <h3 className="decision-action">{actionLabel(recommendation.action)}</h3>
    {recommendation.summary && <p className="decision-summary">{recommendation.summary}</p>}
    {(decision.impact || recommendation.cost_eur != null) && <dl className="decision-facts">
      {decision.impact && <div><dt>Delivery</dt><dd>{decision.impact}</dd></div>}
      {recommendation.cost_eur != null && <div><dt>Cost</dt><dd className="num">{recommendation.cost_eur.toLocaleString("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}</dd></div>}
    </dl>}
    {recommendation.customer_message_draft != null && <label className="decision-draft">
      <span>Message to the customer <small>The agent never sends this. You do, when you approve.</small></span>
      <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} />
    </label>}

    {mode === "idle" && <div className="decision-buttons">
      <button type="button" className="btn primary" disabled={busy} onClick={() => personLed ? setMode("done") : approve()}><Icon name="check" size={14} />{personLed ? "I did this" : "Approve"}</button>
      <button type="button" className="btn" disabled={busy} onClick={() => setMode("change")}>Do something else</button>
      <button type="button" className="btn quiet" disabled={busy} onClick={() => setMode("reject")}>Reject</button>
    </div>}
    {mode !== "idle" && <form className="decision-note" onSubmit={(event) => { event.preventDefault(); if (mode === "done") approve(note); else run({ choice: mode, note }) }}>
      <label>
        <span>{{ done: "How did it go? The agent picks up from here.", change: "What should happen instead?", reject: "Why not? (optional)" }[mode]}</span>
        <textarea autoFocus value={note} onChange={(event) => setNote(event.target.value)} rows={3}
          placeholder={{
            done: "For example: the dealer will send their own Bentley assistance within two hours. Driver should wait with the car.",
            change: "For example: the dealer will send their own assistance, tell the driver to wait",
            reject: "For example: the dealer already called us",
          }[mode]} />
      </label>
      <div className="decision-buttons">
        <button type="submit" className="btn primary" disabled={busy || (mode !== "reject" && !note.trim())}>{mode === "reject" ? "Reject" : "Tell the agent"}</button>
        <button type="button" className="btn quiet" onClick={() => { setMode("idle"); setNote("") }}>Cancel</button>
      </div>
    </form>}

    {mode === "idle" && !!decision.alternatives?.length && <div className="decision-alts">
      <p>Or instead</p>
      <ul>{decision.alternatives.map((alternative, index) => <li key={index}>
        <button type="button" className="alt" disabled={busy} onClick={() => run({ choice: "change", note: `Do this instead: ${alternative.summary}` })}>
          <b>{actionLabel(alternative.action)}</b><span>{alternative.summary}</span><Icon name="arrow" size={13} />
        </button>
      </li>)}</ul>
    </div>}
  </section>
}

function Findings({ decision, steps }: { decision: Decision; steps: Step[] }) {
  const byId = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps])
  return <section className="findings" aria-label="What the agent found">
    {!!decision.facts?.length && <>
      <h3 className="case-sec-title">What the agent found</h3>
      <ul className="facts-found">{decision.facts.map((fact, index) => <li key={index}>
        <span className="fact-text">{fact.text}</span>
        <span className="fact-sources">{(fact.sources ?? []).map((ref) => {
          const source = parseSource(ref)
          const step = source.table === "agent_steps" ? byId.get(source.id) : undefined
          const label = step ? `${step.actor === "driver" ? "Driver said" : "Asked"}, ${fmtClock(step.createdAt)}` : source.label
          return step
            ? <a key={ref} className="source" href={`#${step.id}`} title={ref}>{label}</a>
            : <span key={ref} className={`source${source.table === "simulated" ? " simulated" : ""}`} title={ref}>{label}</span>
        })}{!fact.sources?.length && <span className="source missing">No source given</span>}</span>
      </li>)}</ul>
    </>}
    {!!decision.unknowns?.length && <>
      <h3 className="case-sec-title">Still not known</h3>
      <ul className="unknowns">{decision.unknowns.map((item, index) => <li key={index}>{item}</li>)}</ul>
    </>}
  </section>
}

// Lookups come in bursts. Folding each burst into one line keeps the story readable.
type Row = { type: "step"; step: Step } | { type: "lookups"; steps: Step[] }

function Timeline({ steps, live }: { steps: Step[]; live: boolean }) {
  const rows = useMemo(() => {
    const result: Row[] = []
    for (const step of steps) {
      const last = result.at(-1)
      if (step.kind === "lookup" && last?.type === "lookups") last.steps.push(step)
      else if (step.kind === "lookup") result.push({ type: "lookups", steps: [step] })
      else result.push({ type: "step", step })
    }
    return result
  }, [steps])

  return <ol className="timeline">
    {rows.map((row) => row.type === "lookups"
      ? <li className="tl tl-lookups" key={row.steps[0].id}>
          <details>
            <summary><Icon name="search" size={13} /><span>Looked up {row.steps.length} thing{row.steps.length === 1 ? "" : "s"}</span><time>{fmtClock(row.steps[0].createdAt)}</time></summary>
            <ul>{row.steps.map((step) => <li key={step.id} id={step.id}>{step.body}</li>)}</ul>
          </details>
        </li>
      : <StepRow step={row.step} key={row.step.id} />)}
    {live && <li className="tl tl-live"><span className="pulse" aria-hidden="true" />Working…</li>}
  </ol>
}

function StepRow({ step }: { step: Step }) {
  const time = <time dateTime={step.createdAt}>{fmtClock(step.createdAt)}</time>
  if (step.kind === "message") {
    const who = step.actor === "driver" ? "Driver" : step.actor === "person" ? "You" : step.data.to === "driver" ? "Agent to driver" : "Agent to you"
    return <li className={`tl tl-msg from-${step.actor}${step.data.to === "person" ? " to-person" : ""}`} id={step.id}>
      <div className="bubble"><span className="bubble-who">{who}{time}</span><p>{step.body}</p></div>
    </li>
  }
  const icon = { proposal: "proposal", decision: "check", action: "check", error: "alert", note: step.actor === "agent" ? "bot" : "dot" }[step.kind] ?? "dot"
  const kindClass = step.kind === "note" && step.actor === "agent" ? "thought" : step.kind
  return <li className={`tl tl-${kindClass}`} id={step.id}><Icon name={icon} size={13} /><span>{step.kind === "decision" ? step.body.replace(/^Operations/, "You") : step.body}</span>{time}</li>
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  return <form className="composer" onSubmit={async (event) => {
    event.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    try { await onSend(text.trim()); setText("") } finally { setBusy(false) }
  }}>
    <label className="sr-only" htmlFor="composer">Tell the agent</label>
    <input id="composer" value={text} onChange={(event) => setText(event.target.value)} disabled={busy || disabled}
      placeholder={disabled ? "The agent is working. You can write again when it is done." : "Ask the agent something, or tell it what to do"} />
    <button type="submit" className="btn" disabled={busy || disabled || !text.trim()}>Send</button>
  </form>
}
