"use client"

// Stage one of a case, the investigation: what happened, what is confirmed,
// what is still unknown, and what the agent asked. It reads the agent's latest
// findings, which it has to write down before it may plan anything.

import { Fragment } from "react"
import { cityOfZone, clockIn } from "@/lib/agent/clock"
import { parseSource } from "@/lib/agent/labels"
import { fmtClock } from "@/lib/present/time"
import { Icon } from "./icons"

export type StepLike = { id: string; actor: string; kind: string; body: string; data: Record<string, unknown>; createdAt: string }

type FactStatus = "confirmed" | "reported" | "planned" | "unknown"
type Fact = { text: string; status: FactStatus; sources?: string[] }
type Conflict = { about: string; sides: { says: string; source: string }[]; resolved?: string }
type Question = { question: string; ask: "driver" | "pickup_contact" | "customer" | "nobody"; why: string; answer?: string; answer_source?: string }
type Event = { at: string; what: string; status: "planned" | "reported" | "confirmed" | "projected" | "missed"; sources?: string[] }
export type FindingsData = { problem: string; facts: Fact[]; conflicts?: Conflict[]; key_question: Question; timeline: Event[] }

/** Every findings record on the case, oldest first. The last one is what the agent believes now. */
export function findingsOf(steps: StepLike[]): FindingsData[] {
  return steps.filter((step) => step.kind === "findings" && step.data.args).map((step) => step.data.args as FindingsData)
}

const WHO = { driver: "the driver", pickup_contact: "the pickup site", customer: "the customer (a person calls)", nobody: "" }
const STATUS: { key: FactStatus; label: string; note: string }[] = [
  { key: "confirmed", label: "Confirmed", note: "checked by someone who knows" },
  { key: "reported", label: "Reported", note: "said, not checked" },
  { key: "planned", label: "Planned", note: "what should happen" },
  { key: "unknown", label: "Unknown", note: "nobody knows yet" },
]
const EVENT_LABEL: Record<Event["status"], string> = { planned: "Planned", reported: "Reported", confirmed: "Confirmed", projected: "Projected", missed: "Missed" }

export function SourceChips({ sources, byId }: { sources?: string[]; byId: Map<string, StepLike> }) {
  if (!sources?.length) return null
  return <span className="fact-sources">{sources.map((ref) => {
    const source = parseSource(ref)
    const step = source.table === "agent_steps" ? byId.get(source.id) : undefined
    const who = step?.actor === "driver" ? "Driver said" : step?.actor === "site" ? "Site said" : "Asked"
    return step
      ? <a key={ref} className="source" href={`#${step.id}`} title={ref}>{who}, {fmtClock(step.createdAt)}</a>
      : <span key={ref} className={`source${source.table === "simulated" ? " simulated" : ""}`} title={ref}>{source.label}</span>
  })}</span>
}

export function Investigation({ history, byId, now, zone }: { history: FindingsData[]; byId: Map<string, StepLike>; now: number; zone: string }) {
  const findings = history.at(-1)
  if (!findings) return null
  const question = findings.key_question
  const answerStep = question.answer_source ? byId.get(parseSource(question.answer_source).id) : undefined
  const events = [...(findings.timeline ?? [])].sort((a, b) => a.at.localeCompare(b.at))
  const nowAt = events.findIndex((event) => new Date(event.at).getTime() > now)

  return <section className="stage stage-one" aria-label="Investigation">
    <p className="stage-label"><span className="stage-num">1</span>Investigation <small>What happened? What is confirmed? What is still unknown?</small></p>
    <p className="stage-problem">{findings.problem}</p>

    <div className={`key-question${question.answer ? " answered" : ""}`}>
      <p className="key-question-label"><Icon name="message" size={14} /> The one question that unlocks this case</p>
      <p className="key-question-text">{question.question}</p>
      <p className="key-question-why">{question.why}{question.ask !== "nobody" && WHO[question.ask] ? ` Who can answer: ${WHO[question.ask]}.` : ""}</p>
      {question.answer && <p className="key-question-answer"><b>Answer:</b> {question.answer} {answerStep && <a className="source" href={`#${answerStep.id}`}>{answerStep.actor === "site" ? "Site said" : "Driver said"}, {fmtClock(answerStep.createdAt)}</a>}</p>}
      {!question.answer && <p className="key-question-answer open">Not answered yet.</p>}
    </div>

    <h3 className="case-sec-title">What is true right now{history.length > 1 && <small> · updated {history.length - 1} time{history.length === 2 ? "" : "s"} as answers came in</small>}</h3>
    <div className="truth">{STATUS.map((group) => {
      const facts = findings.facts.filter((fact) => fact.status === group.key)
      if (!facts.length) return null
      return <div className={`truth-group truth-${group.key}`} key={group.key}>
        <p className="truth-head"><b>{group.label}</b><span>{group.note}</span><span className="num">{facts.length}</span></p>
        <ul>{facts.map((fact, index) => <li key={index}><span className="fact-text">{fact.text}</span><SourceChips sources={fact.sources} byId={byId} /></li>)}</ul>
      </div>
    })}</div>

    {!!findings.conflicts?.length && <>
      <h3 className="case-sec-title">Where the records disagree</h3>
      <ul className="conflicts">{findings.conflicts.map((conflict, index) => <li key={index} className={conflict.resolved ? "resolved" : undefined}>
        <p className="conflict-about"><Icon name={conflict.resolved ? "check" : "alert"} size={13} />{conflict.about}</p>
        <ul className="conflict-sides">{conflict.sides.map((side, at) => <li key={at}>{side.says} <SourceChips sources={[side.source]} byId={byId} /></li>)}</ul>
        {conflict.resolved && <p className="conflict-resolved">Settled: {conflict.resolved}</p>}
      </li>)}</ul>
    </>}

    {events.length > 0 && <>
      <h3 className="case-sec-title">Delivery reality timeline <small>planned against what is really happening</small></h3>
      <ol className="reality">{events.map((event, index) => <Fragment key={index}>
        {index === nowAt && <li className="reality-now"><span>Now</span></li>}
        <li className={`reality-${event.status}`}>
          <span className="reality-time num">{clockIn(event.at, zone)}<small>{cityOfZone(zone)}</small></span>
          <span className="reality-dot" aria-hidden="true" />
          <span className="reality-what">{event.what} <SourceChips sources={event.sources} byId={byId} /></span>
          <span className={`reality-status status-${event.status}`}>{EVENT_LABEL[event.status]}</span>
        </li>
      </Fragment>)}{nowAt === -1 && <li className="reality-now"><span>Now</span></li>}</ol>
    </>}
  </section>
}
