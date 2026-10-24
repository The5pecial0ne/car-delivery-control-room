import { NextResponse, after } from "next/server"
import { openCase, runCase } from "@/lib/agent/loop"
import { listCases } from "@/lib/agent/store"

export const runtime = "nodejs"

export async function GET() {
  const cases = await listCases()
  // The model transcript is the agent's working memory, not something the interface needs.
  return NextResponse.json({ cases: cases.map(({ transcript: _transcript, scenario: _scenario, ...rest }) => rest) })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { orderId?: string; trigger?: string; scenario?: string }
  if (!body.orderId || !body.trigger) return NextResponse.json({ error: "orderId and trigger are required" }, { status: 400 })
  const caseRow = await openCase({ orderId: body.orderId, trigger: body.trigger, scenario: body.scenario })
  // Answer straight away and let the agent work in the background. The page polls the case.
  after(() => runCase(caseRow.id))
  return NextResponse.json({ id: caseRow.id }, { status: 201 })
}
