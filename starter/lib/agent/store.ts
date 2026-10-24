// Reading and writing agent cases and their steps.

import { randomBytes } from "node:crypto"
import { asc, desc, eq, sql } from "drizzle-orm"
import { agentCases, agentSteps } from "@/lib/schema"
import { db } from "./conn"
import type { ChatMessage } from "./model"

export type CaseRow = typeof agentCases.$inferSelect
export type StepRow = typeof agentSteps.$inferSelect
export type CaseStatus = "working" | "needs_person" | "resolved" | "failed"
export type Actor = "agent" | "driver" | "person" | "system"
export type StepKind = "lookup" | "message" | "proposal" | "decision" | "action" | "note" | "error"

const newId = (prefix: string) => `${prefix}-${randomBytes(6).toString("hex")}`

export async function createCase(input: { orderId: string; agentId: string; trigger: string; scenario?: string | null }): Promise<CaseRow> {
  const now = new Date()
  const [row] = await db.insert(agentCases).values({
    id: newId("case"), orderId: input.orderId, agentId: input.agentId, status: "working", trigger: input.trigger,
    headline: null, pendingDecision: null, scenario: input.scenario ?? null, transcript: [], createdAt: now, updatedAt: now,
  }).returning()
  return row
}

export async function getCase(id: string): Promise<CaseRow | null> {
  const [row] = await db.select().from(agentCases).where(eq(agentCases.id, id)).limit(1)
  return row ?? null
}

export async function listCases(): Promise<CaseRow[]> {
  return db.select().from(agentCases).orderBy(desc(agentCases.updatedAt))
}

export async function updateCase(id: string, patch: Partial<{
  status: CaseStatus; headline: string | null; pendingDecision: Record<string, unknown> | null; transcript: ChatMessage[]
}>): Promise<void> {
  await db.update(agentCases).set({ ...patch, updatedAt: new Date() }).where(eq(agentCases.id, id))
}

export async function addStep(caseId: string, step: { actor: Actor; kind: StepKind; body: string; data?: Record<string, unknown> }): Promise<StepRow> {
  // Steps for one case are written one at a time by its own run, so taking the next number this way is safe enough.
  const [{ next }] = await db.select({ next: sql<number>`coalesce(max(${agentSteps.seq}), 0) + 1` })
    .from(agentSteps).where(eq(agentSteps.caseId, caseId))
  const [row] = await db.insert(agentSteps).values({
    id: newId("step"), caseId, seq: Number(next), actor: step.actor, kind: step.kind, body: step.body, data: step.data ?? {}, createdAt: new Date(),
  }).returning()
  await db.update(agentCases).set({ updatedAt: row.createdAt }).where(eq(agentCases.id, caseId))
  return row
}

export async function listSteps(caseId: string): Promise<StepRow[]> {
  return db.select().from(agentSteps).where(eq(agentSteps.caseId, caseId)).orderBy(asc(agentSteps.seq))
}

export async function deleteCase(id: string): Promise<void> {
  await db.delete(agentSteps).where(eq(agentSteps.caseId, id))
  await db.delete(agentCases).where(eq(agentCases.id, id))
}
