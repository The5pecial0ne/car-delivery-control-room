// The agent loop. A case runs until the agent hands it to a person, closes it,
// or stops talking. Every lookup, message and proposal is written to the case's
// steps as it happens, so the control room can show the work live.

import { datasetMetadata } from "@/lib/schema"
import { db } from "./conn"
import { AGENT_MODEL, openRouterComplete, type ChatMessage, type CompleteFn } from "./model"
import { ACTIONS, isActionKind } from "./policy"
import { AGENT_ID, SYSTEM_PROMPT } from "./prompt"
import { addStep, createCase, getCase, updateCase, type CaseRow, type CaseStatus } from "./store"
import { findTool, toolSpecs } from "./tools"

export type Deps = { complete: CompleteFn; model?: string }
const defaults: Deps = { complete: openRouterComplete }

// Enough room to look things up and have a short chat with the driver, but not
// enough to wander off. Hitting it is treated as "needs a person".
const MAX_TURNS = 16

// One run per case at a time, so two clicks never interleave two conversations.
const running = new Set<string>()

export async function openCase(input: { orderId: string; trigger: string; scenario?: string | null }): Promise<CaseRow> {
  const caseRow = await createCase({ ...input, agentId: AGENT_ID })
  await addStep(caseRow.id, { actor: "system", kind: "note", body: `Case opened: ${input.trigger}` })
  // The dataset is a frozen snapshot, so "now" for the agent is the snapshot time, not the wall clock.
  const [meta] = await db.select().from(datasetMetadata).limit(1)
  const now = meta?.snapshotAt.toISOString() ?? new Date().toISOString()
  await updateCase(caseRow.id, {
    transcript: [{ role: "user", content: `New case on order ${input.orderId}.\nIt is now ${now}.\nWhat started it: ${input.trigger}\nWork the case.` }],
  })
  return caseRow
}

export async function runCase(caseId: string, deps: Deps = defaults): Promise<void> {
  if (running.has(caseId)) return
  running.add(caseId)
  try {
    await loop(caseId, deps)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await addStep(caseId, { actor: "system", kind: "error", body: `The agent stopped because of an error: ${message}` })
    await updateCase(caseId, { status: "failed", headline: "The agent stopped with an error. A person needs to take this over." })
  } finally {
    running.delete(caseId)
  }
}

export const isRunning = (caseId: string) => running.has(caseId)

async function loop(caseId: string, deps: Deps): Promise<void> {
  const caseRow = await getCase(caseId)
  if (!caseRow) throw new Error(`No case ${caseId}`)
  const transcript = [...(caseRow.transcript as ChatMessage[])]
  await updateCase(caseId, { status: "working" })

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const reply = await deps.complete({
      model: deps.model ?? AGENT_MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...transcript],
      tools: toolSpecs,
    })
    transcript.push(reply)
    const text = reply.content?.trim()

    if (!reply.tool_calls?.length) {
      // The agent answered in words without handing over. That is fine as a
      // reply to a person; otherwise a person should look at what it said.
      await addStep(caseId, { actor: "agent", kind: "message", body: text || "(no reply)", data: { to: "person" } })
      if (caseRow.pendingDecision) await updateCase(caseId, { transcript, status: "needs_person" })
      else if (caseRow.status === "resolved") await updateCase(caseId, { transcript, status: "resolved" })
      else await updateCase(caseId, { transcript, status: "needs_person", headline: firstLine(text) ?? "The agent needs a person to look at this." })
      return
    }

    if (text) await addStep(caseId, { actor: "agent", kind: "note", body: text })

    let finish: { status: CaseStatus; headline: string; pendingDecision: Record<string, unknown> | null } | undefined
    for (const call of reply.tool_calls) {
      const tool = findTool(call.function.name)
      let args: Record<string, unknown> = {}
      let content: unknown
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {}
      } catch {
        content = { error: "Arguments were not valid JSON." }
      }
      if (!tool) content = { error: `There is no tool called ${call.function.name}.` }
      if (tool && content === undefined) {
        const outcome = await tool.run(args, { caseRow, complete: deps.complete })
        content = outcome.content
        if (outcome.summary) {
          await addStep(caseId, {
            actor: "agent", kind: tool.kind === "finish" ? (outcome.finish?.status === "resolved" ? "note" : "proposal") : "lookup",
            body: outcome.summary, data: { tool: tool.name, args, ...(outcome.finish?.pendingDecision ? { decision: outcome.finish.pendingDecision } : {}) },
          })
        }
        finish ??= outcome.finish
      }
      transcript.push({ role: "tool", tool_call_id: call.id, content: clip(JSON.stringify(content)) })
    }
    await updateCase(caseId, { transcript })

    if (finish) {
      await updateCase(caseId, { status: finish.status, headline: finish.headline, pendingDecision: finish.pendingDecision })
      return
    }
  }

  await addStep(caseId, { actor: "system", kind: "note", body: "The agent used all its steps without finishing. Handing to a person." })
  await updateCase(caseId, { transcript, status: "needs_person", headline: "The agent could not finish this case on its own." })
}

export type Choice = "approve" | "change" | "reject"

/** A person's answer to the pending decision. The agent picks the case up again afterwards. */
export async function decide(caseId: string, input: { choice: Choice; note?: string; by?: string }, deps: Deps = defaults): Promise<void> {
  const caseRow = await getCase(caseId)
  if (!caseRow?.pendingDecision) throw new Error("There is no decision waiting on this case.")
  const decision = caseRow.pendingDecision as { recommendation?: { action?: string; summary?: string } }
  const action = decision.recommendation?.action
  const label = isActionKind(action) ? ACTIONS[action].label : "the recommendation"
  const by = input.by ?? "Operations"
  const note = input.note?.trim()

  const said = {
    approve: `${by} approved: ${label.toLowerCase()}.`,
    change: `${by} wants something different${note ? `: ${note}` : "."}`,
    reject: `${by} said no to ${label.toLowerCase()}.`,
  }[input.choice]
  await addStep(caseId, { actor: "person", kind: "decision", body: note && input.choice !== "change" ? `${said} ${note}` : said, data: { choice: input.choice, action, note: note ?? null } })

  let instruction: string
  if (input.choice === "approve") {
    // Nothing real is connected, so carrying out an approved action means writing down that it happened.
    await addStep(caseId, { actor: "system", kind: "action", body: `Done (simulated): ${decision.recommendation?.summary ?? label}`, data: { action, simulated: true } })
    instruction = `The person approved your recommendation (${action}).${note ? ` Their note: ${note}` : ""} It has been carried out. Follow up within your permissions, then close the case or hand over the next decision.`
  } else if (input.choice === "change") {
    instruction = `The person did not take your recommendation as it was. What they want instead: ${note || "(no note)"}. Work out what that means, then hand over a revised decision or close the case.`
  } else {
    instruction = `The person rejected your recommendation.${note ? ` Their reason: ${note}` : ""} Nothing was done. Reconsider, then hand over a different decision or close the case.`
  }
  await updateCase(caseId, {
    status: "working", pendingDecision: null,
    transcript: [...(caseRow.transcript as ChatMessage[]), { role: "user", content: instruction }],
  })
  await runCase(caseId, deps)
}

/** A person writing to the agent on a case, outside a decision. */
export async function tellAgent(caseId: string, input: { text: string; by?: string }, deps: Deps = defaults): Promise<void> {
  const caseRow = await getCase(caseId)
  if (!caseRow) throw new Error(`No case ${caseId}`)
  const by = input.by ?? "Operations"
  await addStep(caseId, { actor: "person", kind: "message", body: input.text, data: { by } })
  await updateCase(caseId, {
    transcript: [...(caseRow.transcript as ChatMessage[]), { role: "user", content: `${by} writes to you: ${input.text}` }],
  })
  await runCase(caseId, deps)
}

function firstLine(text: string | undefined): string | null {
  const line = text?.split("\n").find((candidate) => candidate.trim())?.trim()
  return line ? line.slice(0, 200) : null
}

const clip = (text: string, limit = 12000) => text.length > limit ? `${text.slice(0, limit)}... (cut, ask for less)` : text
