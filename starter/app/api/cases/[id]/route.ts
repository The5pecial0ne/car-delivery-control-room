import { NextResponse } from "next/server"
import { isRunning } from "@/lib/agent/loop"
import { getCase, listSteps } from "@/lib/agent/store"

export const runtime = "nodejs"

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const caseRow = await getCase(id)
  if (!caseRow) return NextResponse.json({ error: "Case not found" }, { status: 404 })
  const { transcript: _transcript, scenario: _scenario, ...rest } = caseRow
  return NextResponse.json({ case: { ...rest, running: isRunning(id) }, steps: await listSteps(id) })
}
