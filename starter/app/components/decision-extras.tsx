"use client"

// The parts of a hand-over that help a person act in time: what must happen
// before when, as a countdown rather than a risk score. Plan B and the options
// ranked by what matters most today live in recovery.tsx.

import { useEffect, useState } from "react"
import { caseNow, cityOfZone, clockIn, countdown } from "@/lib/agent/clock"
import type { Deadline } from "@/lib/agent/labels"

/** The case clock, ticking every 20 seconds. */
export function useCaseNow(snapshotAt: string | null | undefined, createdAt: string): number {
  const [now, setNow] = useState(() => caseNow(snapshotAt, createdAt))
  useEffect(() => {
    setNow(caseNow(snapshotAt, createdAt))
    const timer = setInterval(() => setNow(caseNow(snapshotAt, createdAt)), 20_000)
    return () => clearInterval(timer)
  }, [snapshotAt, createdAt])
  return now
}

export const nextDeadline = (deadlines: Deadline[] | undefined, now: number) =>
  (deadlines ?? []).find((deadline) => new Date(deadline.at).getTime() > now) ?? null

export function Deadlines({ deadlines, now, zone }: { deadlines: Deadline[]; now: number; zone: string }) {
  const next = nextDeadline(deadlines, now)
  const head = next ? countdown(next.at, now) : null
  return <section className="deadlines" aria-label="Before when">
    {next && head && <p className={`deadline-lead tone-${head.tone}`}>
      <b className="num">{head.left}</b> until {next.what.charAt(0).toLowerCase() + next.what.slice(1)}
    </p>}
    {!next && <p className="deadline-lead tone-danger">Every deadline on this case has passed.</p>}
    <ol className="deadline-list">{deadlines.map((deadline, index) => {
      const left = countdown(deadline.at, now)
      const where = deadline.zone ?? zone
      return <li key={index} className={left.passed ? "passed" : deadline === next ? "next" : undefined}>
        <span className="deadline-time num">{clockIn(deadline.at, where)}<small>{cityOfZone(where)}</small></span>
        <span className="deadline-what">{deadline.what}{deadline.miss && <small>If missed: {deadline.miss}</small>}</span>
        <span className={`deadline-left num tone-${left.passed ? "subtle" : left.tone}`}>{left.passed ? `passed ${left.left} ago` : `in ${left.left}`}</span>
      </li>
    })}</ol>
  </section>
}
