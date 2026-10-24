"use client"

// One case, read top to bottom the way a person decides: what happened, what
// the agent suggests, what it found and where each fact came from, then the
// full story of how it got there. The decision sits above the history because
// that is what the person came for.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { actionLabel, isPersonLed, parseSource, URGENCY, type Decision } from "@/lib/agent/labels"
import { fmtClock } from "@/lib/present/time"
import { cityOfZone, clockIn, countdown, zoneForCity } from "@/lib/agent/clock"
import type { RankedPlanB } from "@/lib/agent/plan-b"
import type { Priority } from "@/lib/agent/priority"
import { Deadlines, nextDeadline, useCaseNow } from "./decision-extras"
import { agentRows, BestOption, handOver, OtherOptions, PlanBPanel, PreparedOptions, priorityLabel, PrioritySwitch, usePlanB, usePriority, type Row as OptionRow } from "./recovery"
import { SitePatternNotice } from "./site-pattern"
import { evidenceCount, findingsOf, Investigation } from "./investigation"
import { Disclosure, openFold } from "./disclosure"
import { Icon } from "./icons"

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

type Step = { id: string; seq: number; actor: "agent" | "driver" | "site" | "person" | "system"; kind: string; body: string; data: Record<string, unknown>; createdAt: string }

const clip = (text: string, length = 110) => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text)

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

export type CaseData = { case: CaseSummary; steps: Step[] }

export function CaseView({ summary, snapshotAt, onChange, onLoaded, onPlan, timeline, after }: {
  summary: CaseSummary; snapshotAt: string | null; onChange: () => void
  onLoaded?: (data: CaseData) => void; onPlan?: (plan: RankedPlanB | null) => void
  /** The order's timeline, placed under the decision. */
  timeline?: ReactNode
  /** More folded sections, such as the order record. */
  after?: ReactNode
}) {
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [detail, setDetail] = useState<CaseSummary>(summary)
  const [error, setError] = useState("")
  const loaded = useRef(onLoaded)
  useEffect(() => { loaded.current = onLoaded }, [onLoaded])

  const load = useCallback(async () => {
    const response = await fetch(`/api/cases/${summary.id}`, { cache: "no-store" })
    if (!response.ok) { setError("Could not load this case"); return }
    const data = await response.json() as CaseData
    setDetail((old) => ({ ...old, ...data.case }))
    setSteps(data.steps)
    setError("")
    // The order timeline above the case follows the same steps.
    loaded.current?.(data)
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
  const now = useCaseNow(snapshotAt, detail.createdAt)
  const zone = zoneForCity(order?.to)
  const history = useMemo(() => findingsOf(steps ?? []), [steps])
  const byId = useMemo(() => new Map((steps ?? []).map((step) => [step.id, step])), [steps])
  const [priority, setPriority] = usePriority()
  const planB = usePlanB(detail.orderId, priority, onPlan)
  // Each time the agent updates what it knows, Plan B is looked up again.
  const { refresh: refreshPlan } = planB
  const rounds = history.length
  useEffect(() => { if (rounds) refreshPlan() }, [rounds]) // eslint-disable-line react-hooks/exhaustive-deps
  const next = decision ? nextDeadline(decision.deadlines, now) : null
  const left = next ? countdown(next.at, now) : null
  const lastStep = steps?.at(-1)

  const found = evidenceCount(history.at(-1))
  const deadlines = decision?.deadlines ?? []

  return <article className="case">
    <header className="case-top">
      <p className="case-state">
        <span className={`case-state-main tone-${status.tone}`}>{live && <span className="pulse" aria-hidden="true" />}{status.label}</span>
        {decision?.urgency && URGENCY[decision.urgency] && <span>Urgency: {URGENCY[decision.urgency].label}</span>}
      </p>
      <h2 className={`case-headline${detail.status === "failed" ? " tone-danger" : ""}`}>{detail.headline ?? detail.trigger}</h2>
      {decision?.situation && <p className="case-situation">{decision.situation}</p>}
      {found && <p className="case-found">
        <Icon name="bot" size={13} />
        <span>Agent checked {found.sources} source{found.sources === 1 ? "" : "s"} and found {found.conflicts ? `${found.conflicts} conflict${found.conflicts === 1 ? "" : "s"}` : "no open conflict"}{found.unknown ? `, ${found.unknown} thing${found.unknown === 1 ? "" : "s"} still unknown` : ""}.</span>
        <button type="button" className="link-button" onClick={() => openFold("evidence")}>Show evidence<Icon name="arrow" size={12} /></button>
      </p>}
      {next && left && <p className={`case-countdown tone-${left.tone}`}>
        <Icon name="waiting" size={14} /><b className="num">{left.left}</b> until {next.what.charAt(0).toLowerCase() + next.what.slice(1)}
        {next.miss && <small>If missed: {next.miss}</small>}
      </p>}
      {decision && !next && !!deadlines.length && <p className="case-countdown tone-danger"><Icon name="alert" size={14} />Every deadline on this case has passed.</p>}
      {!decision && detail.status === "working" && <p className="case-working">The agent is looking into this. It will bring you a decision if it needs one.</p>}
    </header>
    {error && <p className="board-error case-error" role="alert">{error}</p>}

    <section className="case-decide" id="decide" aria-label="Decision">
      <PrioritySwitch priority={priority} onChange={setPriority} />
      {decision && <DecisionPanel decision={decision} zone={zone} priority={priority} onAct={(body) => act(`/api/cases/${detail.id}/decision`, body)} />}
      {!decision && planB.plan && <PreparedOptions plan={planB.plan} priority={priority}
        busy={live ? "The agent is still investigating" : false}
        onHandOver={live ? null : async (title) => {
          try { await handOver(detail.orderId, detail.headline ?? detail.trigger, title, priority); onChange() } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the agent") }
        }} />}
    </section>

    {timeline}

    <PlanBPanel state={planB} onRefresh={planB.refresh} agentPlan={decision?.plan_b} zone={zone} busy={live}
      onSwitch={decision?.plan_b ? () => act(`/api/cases/${detail.id}/decision`, { choice: "change", note: `Switch to plan B now (what matters most today: ${priority}): ${decision.plan_b?.summary ?? ""}` }) : undefined} />

    <div className="folds">
      {(found || decision?.facts?.length || decision?.unknowns?.length) ? <Disclosure id="evidence" tone="agent"
        summary={found
          ? <>Evidence: {found.facts} fact{found.facts === 1 ? "" : "s"} from {found.sources} source{found.sources === 1 ? "" : "s"}, {found.conflicts} open conflict{found.conflicts === 1 ? "" : "s"}. Key question {found.answered ? "answered" : "not answered yet"}.</>
          : <>Evidence behind the suggestion: {decision?.facts?.length ?? 0} facts, {decision?.unknowns?.length ?? 0} unknowns.</>}
        action="Show evidence">
        <Investigation history={history} byId={byId} now={now} zone={zone} />
        {decision && <Findings decision={decision} steps={steps ?? []} />}
      </Disclosure> : null}
      {deadlines.length > 1 && <Disclosure summary={<>{deadlines.length} deadlines on this case{next ? <>, next {clockIn(next.at, zone)} {cityOfZone(zone)} time</> : null}.</>} action="Show all deadlines">
        <Deadlines deadlines={deadlines} now={now} zone={zone} />
      </Disclosure>}
      <SitePatternNotice orderId={detail.orderId} />
      <Disclosure id="agent-trace" tone="agent" summary={<>Agent activity: {steps ? `${steps.length} step${steps.length === 1 ? "" : "s"}` : "loading"}{lastStep ? <>. Latest, {fmtClock(lastStep.createdAt)}: {clip(lastStep.body)}</> : null}</>} action="Show agent trace">
        {!steps && <p className="empty">Loading…</p>}
        {steps && <Timeline steps={steps} live={live} />}
      </Disclosure>
      {after}
    </div>

    <Composer disabled={live} onSend={(text) => act(`/api/cases/${detail.id}/message`, { text })} />
  </article>
}

function DecisionPanel({ decision, zone, priority, onAct }: { decision: Decision; zone: string; priority: Priority; onAct: (body: { choice: string; note?: string }) => Promise<void> }) {
  const recommendation = decision.recommendation ?? {}
  const [draft, setDraft] = useState(recommendation.customer_message_draft ?? "")
  const [mode, setMode] = useState<"idle" | "done" | "change" | "reject">("idle")
  const personLed = isPersonLed(recommendation.action)
  const [note, setNote] = useState("")
  const [busy, setBusy] = useState(false)
  const rows = useMemo(() => agentRows(decision, priority, zone), [decision, priority, zone])

  const run = async (body: { choice: string; note?: string }) => {
    setBusy(true)
    try { await onAct(body) } finally { setBusy(false) }
  }
  const approve = (outcome?: string) => {
    const edited = recommendation.customer_message_draft && draft.trim() !== recommendation.customer_message_draft.trim()
    const sent = recommendation.customer_message_draft ? `${edited ? "Edited customer message, as sent" : "Customer message sent as drafted"}: ${draft.trim()}` : ""
    run({ choice: "approve", note: [outcome?.trim() && `How it went: ${outcome.trim()}`, sent].filter(Boolean).join("\n\n") || undefined })
  }
  const approveLabel = personLed ? "I did this" : "Approve"
  const onApprove = () => personLed ? setMode("done") : approve()
  const choose = (row: OptionRow) => row.option && run({ choice: "change", note: `${row.tag === "Plan B" ? "Switch to plan B" : "Do this instead"} (what matters most today: ${priority}): ${row.option.summary ?? row.title}` })
  const best = rows[0] ?? { key: "pick", tag: "Agent's pick", title: actionLabel(recommendation.action), summary: recommendation.summary ?? null, why: "", arrives: null, cost: null, costBasis: null, certainty: null, risk: null, approval: true }
  const bestIsPick = best.tag === "Agent's pick"
  const pick = rows.find((row) => row.tag === "Agent's pick")
  const pickRank = pick ? rows.indexOf(pick) + 1 : 0

  return <section className="decision" aria-label="Decision">
    <BestOption row={best} priority={priority}
      note={<>
        {decision.impact && bestIsPick && <p className="decision-impact"><b>Effect on delivery:</b> {decision.impact}</p>}
        {!bestIsPick && pick && <p className="decision-pick">The agent's own pick, <b>{pick.title.toLowerCase()}</b>, ranks {pickRank} for {priorityLabel(priority).toLowerCase()}. You can still approve it.</p>}
        {recommendation.customer_message_draft != null && <label className="decision-draft">
          <span>Message to the customer, with the agent's pick <small>The agent never sends this. You do, when you approve.</small></span>
          <textarea value={draft} onChange={(event) => setDraft(event.target.value)} rows={3} />
        </label>}
      </>}>
      {mode === "idle" && <div className="decision-buttons">
        {bestIsPick
          ? <button type="button" className="btn primary" disabled={busy} onClick={onApprove}><Icon name="check" size={14} />{approveLabel}</button>
          : <>
              <button type="button" className="btn primary" disabled={busy} onClick={() => choose(best)}><Icon name="check" size={14} />Choose this</button>
              <button type="button" className="btn" disabled={busy} onClick={onApprove}>{personLed ? "I did the agent's pick" : "Approve the agent's pick"}</button>
            </>}
        <button type="button" className="btn quiet" disabled={busy} onClick={() => setMode("change")}>Do something else</button>
        <button type="button" className="btn quiet" disabled={busy} onClick={() => setMode("reject")}>Reject</button>
      </div>}
    </BestOption>

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

    {mode === "idle" && <OtherOptions rows={rows.slice(1)} priority={priority} action={(row) => row.tag === "Agent's pick"
      ? <button type="button" className="btn primary small" disabled={busy} onClick={onApprove}>{approveLabel}</button>
      : <button type="button" className="btn small" disabled={busy} onClick={() => choose(row)}>Choose this</button>} />}
  </section>
}

function Findings({ decision, steps }: { decision: Decision; steps: Step[] }) {
  const byId = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps])
  return <section className="findings" aria-label="What the agent found">
    {!!decision.facts?.length && <>
      <h3 className="case-sec-title">Behind the suggestion</h3>
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
    const who = step.actor === "driver" ? "Driver" : step.actor === "site" ? `Pickup site${step.data.contact ? ` (${String(step.data.contact)})` : ""}` : step.actor === "person" ? "You" : step.data.to === "driver" ? "Agent to driver" : step.data.to === "site" ? "Agent to pickup site" : "Agent to you"
    return <li className={`tl tl-msg from-${step.actor}${step.data.to === "person" ? " to-person" : ""}`} id={step.id}>
      <div className="bubble"><span className="bubble-who">{who}{time}</span><p>{step.body}</p></div>
    </li>
  }
  const icon = { proposal: "proposal", decision: "check", action: "check", error: "alert", findings: "note", note: step.actor === "agent" ? "bot" : "dot" }[step.kind] ?? "dot"
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
