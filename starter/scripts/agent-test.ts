// Checks the agent's plumbing without calling a real model: a scripted stand-in
// plays the agent and the driver, and we check that the case moves through the
// states we expect and that every step lands in the trace.
//
//   npm run agent:test

import "dotenv/config"
import assert from "node:assert/strict"
import { decide, openCase, runCase, tellAgent } from "@/lib/agent/loop"
import { closeDb } from "@/lib/agent/conn"
import type { ChatMessage, CompleteFn, ToolCall } from "@/lib/agent/model"
import { DRIVER_MODEL } from "@/lib/agent/model"
import { deleteCase, getCase, listSteps } from "@/lib/agent/store"

let callNo = 0
const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({ id: `call-${++callNo}`, type: "function", function: { name, arguments: JSON.stringify(args) } })
const lastToolResult = (messages: ChatMessage[]) => {
  const tool = [...messages].reverse().find((message) => message.role === "tool")
  return tool ? JSON.parse(tool.content) : null
}

// Each agent turn looks at how far the conversation has got and plays the next move.
const scripted: CompleteFn = async ({ model, messages }) => {
  if (model === DRIVER_MODEL) return { role: "assistant", content: "Yes, I'm safe. Rasthof Göttingen car park, engine off. [photo: red engine warning]" }
  const turns = messages.filter((message) => message.role === "assistant").length
  const lastUser = [...messages].reverse().find((message) => message.role === "user")?.content ?? ""
  if (lastUser.includes("writes to you")) return { role: "assistant", content: "The driver is safe and waiting. I have asked you to decide on roadside help." }
  if (lastUser.includes("approved")) {
    if (!messages.slice(-3).some((message) => message.role === "tool")) return { role: "assistant", content: null, tool_calls: [call("message_driver", { message: "Help is on the way. Please wait with the car." })] }
    return { role: "assistant", content: null, tool_calls: [call("close_case", { summary: "Roadside help booked, driver informed." })] }
  }
  if (turns === 0) return { role: "assistant", content: "Let me look at the order first.", tool_calls: [call("get_order"), call("get_messages"), call("get_alerts_and_incidents"), call("get_records", { collection: "tracking_observations" })] }
  if (turns === 1) return { role: "assistant", content: null, tool_calls: [call("message_driver", { message: "Are you safe? Where exactly are you?" })] }
  if (turns === 2) {
    const source = lastToolResult(messages)?.source
    assert.match(source, /^agent_steps\/step-/)
    // First a malformed hand-over, which the tool should refuse.
    return { role: "assistant", content: null, tool_calls: [call("ask_person", { headline: "x", facts: [], recommendation: { action: "teleport", summary: "?" } })] }
  }
  assert.match(lastToolResult(messages)?.error ?? "", /Not handed over/)
  const source = messages.map((message) => message.role === "tool" ? message.content : "").join("").match(/agent_steps\/step-[0-9a-f]+/)?.[0]
  return {
    role: "assistant", content: null, tool_calls: [call("ask_person", {
      headline: "Bentley stopped near Göttingen, driver safe. Call the dealer: their roadside help or a tow?",
      situation: "The driver stopped at a service area with a red warning light.",
      facts: [{ text: "Driver is safe at Rasthof Göttingen", sources: [source] }],
      recommendation: { action: "book_roadside_assistance", summary: "Book roadside assistance to the service area." },
      urgency: "now",
    })],
  }
}

async function main(): Promise<void> {
  const deps = { complete: scripted }
  const caseRow = await openCase({ orderId: "ord-00322", trigger: "Test: driver reports a red warning light." })
  await runCase(caseRow.id, deps)

  let current = await getCase(caseRow.id)
  assert.equal(current?.status, "needs_person")
  assert.match(current?.headline ?? "", /Bentley stopped/)
  assert.ok(current?.pendingDecision)

  await tellAgent(caseRow.id, { text: "Is the driver ok?" }, deps)
  current = await getCase(caseRow.id)
  assert.equal(current?.status, "needs_person", "a chat reply keeps the decision open")
  assert.ok(current?.pendingDecision)

  await decide(caseRow.id, { choice: "approve", by: "Test operator" }, deps)
  current = await getCase(caseRow.id)
  assert.equal(current?.status, "resolved")
  assert.equal(current?.pendingDecision, null)

  const steps = await listSteps(caseRow.id)
  const kinds = steps.map((step) => `${step.actor}:${step.kind}`)
  for (const expected of ["system:note", "agent:lookup", "agent:message", "driver:message", "agent:proposal", "person:message", "person:decision", "system:action"]) {
    assert.ok(kinds.includes(expected), `trace has ${expected}`)
  }
  assert.deepEqual(steps.map((step) => step.seq), steps.map((_, index) => index + 1), "steps are numbered in order")
  assert.ok(steps.find((step) => step.kind === "action")?.body.startsWith("Done (simulated)"))

  // Approving twice must not be possible.
  await assert.rejects(decide(caseRow.id, { choice: "approve" }, deps), /no decision waiting/)

  console.log(`ok: ${steps.length} steps on ${caseRow.id}`)
  for (const step of steps) console.log(`${String(step.seq).padStart(3)}  ${step.actor.padEnd(6)} ${step.kind.padEnd(8)} ${step.body}`)
  // Leave the queue as we found it.
  await deleteCase(caseRow.id)
  await closeDb()
}

main().catch(async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})
