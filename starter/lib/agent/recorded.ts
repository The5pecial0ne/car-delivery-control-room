import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { asc, inArray } from "drizzle-orm"
import { agentCases, agentSteps, orders } from "@/lib/schema"
import { db } from "./conn"
import { deleteCase, listCases } from "./store"

export const RECORDED_FILE = path.join(process.cwd(), "demo", "recorded-cases.json")

type CaseRow = typeof agentCases.$inferSelect
type StepRow = typeof agentSteps.$inferSelect
type Recorded = { savedAt: string; note: string; cases: (Omit<CaseRow, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string; steps: (Omit<StepRow, "createdAt"> & { createdAt: string })[] })[] }

export async function saveRecorded(): Promise<number> {
  const cases = await listCases()
  const steps = cases.length ? await db.select().from(agentSteps).where(inArray(agentSteps.caseId, cases.map((row) => row.id))).orderBy(asc(agentSteps.seq)) : []
  const body: Recorded = {
    savedAt: new Date().toISOString(),
    note: "A real run of the demo scenarios (npm run agent:demo), saved with npm run demo:save. Loaded by npm run db:seed.",
    cases: cases.map((row) => ({
      ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      steps: steps.filter((step) => step.caseId === row.id).map((step) => ({ ...step, createdAt: step.createdAt.toISOString() })),
    })),
  }
  await writeFile(RECORDED_FILE, `${JSON.stringify(body, null, 2)}\n`)
  return cases.length
}

export async function loadRecorded(now = Date.now()): Promise<number> {
  const recorded = JSON.parse(await readFile(RECORDED_FILE, "utf8")) as Recorded
  const times = recorded.cases.flatMap((row) => [row.updatedAt, ...row.steps.map((step) => step.createdAt)]).map((iso) => new Date(iso).getTime())
  const shift = times.length ? now - Math.max(...times) : 0
  const moved = (iso: string) => new Date(new Date(iso).getTime() + shift)

  for (const row of await listCases()) await deleteCase(row.id)
  const known = new Set((await db.select({ id: orders.id }).from(orders).where(inArray(orders.id, recorded.cases.map((row) => row.orderId)))).map((row) => row.id))
  const usable = recorded.cases.filter((row) => known.has(row.orderId))
  for (const { steps, ...row } of usable) {
    await db.insert(agentCases).values({ ...row, createdAt: moved(row.createdAt), updatedAt: moved(row.updatedAt) })
    if (steps.length) await db.insert(agentSteps).values(steps.map((step) => ({ ...step, createdAt: moved(step.createdAt) })))
  }
  return usable.length
}
