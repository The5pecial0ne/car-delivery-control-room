// Small checks on the rules the control room leans on: which orders reach a
// person, which deadline a card leads with, and how long text is shortened.
// No database or model needed.
//
//   npm run test

import assert from "node:assert/strict"
import { cardDeadline } from "@/app/components/queue-cards"
import { nextDeadline } from "@/app/components/decision-extras"
import { firstSentence } from "@/app/components/recovery"
import { followUp, needsAttention, needsPerson, splitQueue, watchStatus, type QueueCase } from "@/lib/present/queue"
import type { AttentionItem, BoardCard, KeyDate, Tone } from "@/lib/present/types"

const SNAPSHOT = "2026-10-21T09:00:00.000Z"

const item = (tone: Tone, title = "Open conversation: pickup and release", owner: string | null = "Readiness desk"): AttentionItem => ({
  kind: tone === "accent" ? "proposal" : "conversation", tone, title, short: title, detail: null, owner, at: null, atLabel: null, section: "conversations", recordId: `r-${title}`,
})

const date = (key: KeyDate["key"], start: string): KeyDate => ({ key, label: key, start, end: null, zone: "Europe/Berlin", source: null, tone: "neutral", note: null })

function card(id: string, attention: AttentionItem[], extra: Partial<BoardCard> = {}): BoardCard {
  const order: Tone[] = ["danger", "warn", "accent", "neutral"]
  const tone = order.find((tone) => attention.some((entry) => entry.tone === tone)) ?? "ok"
  return {
    id, reference: id, displayLane: "booked", status: "BOOKED", statusLabel: "Booked", routeKind: "ROAD", routeKindLabel: "Road",
    customer: "Dealer", customerTier: null, vehicle: "Car", vehicleMake: null, plate: null, origin: "A", destination: "B",
    from: { city: "Hamburg", country: "DE" }, to: { city: "Helsinki", country: "FI" }, openAlerts: [], acknowledgedAlerts: [],
    attention, attentionTone: tone, decisive: null, work: [], checks: [], updatedAt: SNAPSHOT, ...extra,
  }
}

let passed = 0
function check(name: string, run: () => void) {
  run()
  passed++
  console.log(`  ok  ${name}`)
}

check("an order with only routine follow-ups does not need a person", () => {
  const routine = card("routine", [item("neutral")])
  assert.equal(needsPerson(routine), false)
  assert.equal(needsAttention(routine), false)
  assert.equal(followUp(routine)?.title, "Open conversation: pickup and release")
  assert.equal(watchStatus(routine).label, "Followed up")
})

check("at risk, critical and proposals to review do need a person", () => {
  for (const tone of ["danger", "warn", "accent"] as Tone[]) {
    const problem = card(tone, [item(tone), item("neutral")])
    assert.equal(needsPerson(problem), true, tone)
    assert.equal(followUp(problem), null, tone)
  }
})

check("an order with nothing open is on track and has no follow-up", () => {
  const quiet = card("quiet", [])
  assert.equal(needsAttention(quiet), false)
  assert.equal(followUp(quiet), null)
  assert.equal(watchStatus(quiet).label, "On track")
})

check("an agent case waiting for a person or stopped always reaches the desk", () => {
  const quiet = card("quiet", [item("neutral")])
  const waiting: QueueCase = { id: "c1", orderId: "quiet", status: "needs_person", updatedAt: SNAPSHOT }
  assert.equal(needsAttention(quiet, waiting), true)
  assert.equal(needsAttention(quiet, { ...waiting, status: "failed" }), true)
  assert.equal(needsAttention(quiet, { ...waiting, status: "resolved" }), false)
})

check("an order whose agent case is closed leaves the desk, even with the old alert still in the snapshot", () => {
  const risky = card("risky", [item("warn", "Open alert: Ferry connection risk")])
  assert.equal(needsAttention(risky), true)
  assert.equal(needsAttention(risky, { id: "c2", orderId: "risky", status: "resolved", updatedAt: SNAPSHOT }), false)
  assert.equal(needsAttention(risky, { id: "c2", orderId: "risky", status: "working", updatedAt: SNAPSHOT }), true)
})

check("splitQueue puts waiting cases first and routine orders on the watch list", () => {
  const cards = [card("routine", [item("neutral")]), card("risk", [item("warn")]), card("critical", [item("danger")]), card("case", [])]
  const cases = new Map<string, QueueCase>([["case", { id: "c", orderId: "case", status: "needs_person", updatedAt: SNAPSHOT }]])
  const { attention, monitored } = splitQueue(cards, cases)
  assert.deepEqual(attention.map((entry) => entry.id), ["case", "critical", "risk"])
  assert.deepEqual(monitored.map((entry) => entry.id), ["routine"])
})

check("a card never leads with a date that has passed, or with the order's creation", () => {
  assert.equal(cardDeadline(card("old", [], { decisive: date("created", "2026-10-08T13:45:00.000Z") }), null, SNAPSHOT, Date.now()), null)
  assert.equal(cardDeadline(card("past", [], { decisive: date("pickup_slot", "2026-10-20T08:00:00.000Z") }), null, SNAPSHOT, Date.now()), null)
  assert.ok(cardDeadline(card("ahead", [], { decisive: date("pickup_slot", "2026-10-22T08:00:00.000Z") }), null, SNAPSHOT, Date.now()))
})

check("the next deadline is the soonest one still ahead, whatever order they come in", () => {
  const now = new Date(SNAPSHOT).getTime()
  const deadlines = [
    { at: "2026-10-23T12:00:00.000Z", what: "Promise ends" },
    { at: "2026-10-21T08:00:00.000Z", what: "Already passed" },
    { at: "2026-10-21T09:40:00.000Z", what: "Driver leaves" },
  ]
  assert.equal(nextDeadline(deadlines as never, now)?.what, "Driver leaves")
  assert.equal(nextDeadline([], now), null)
})

check("long text is cut at a word, never through one", () => {
  const text = "Site now reports a seller-imposed commercial hold in addition to the missing signed release; vehicle presence is not pickup authority."
  const short = firstSentence(text, 100)
  assert.ok(short.endsWith("…"))
  assert.ok(short.length <= 100)
  assert.ok(text.startsWith(short.slice(0, -1)), short)
  assert.ok(text.charAt(short.length - 1) === " " || /[;,]/.test(text.charAt(short.length - 1)), `cut mid-word: ${short}`)
  assert.equal(firstSentence("Short one. Second sentence."), "Short one.")
})

console.log(`${passed} checks passed.`)
