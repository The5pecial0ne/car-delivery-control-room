import { NextResponse, after } from "next/server"
import { openCase, runCase } from "@/lib/agent/loop"
import { SCENARIOS, scenarioFor } from "@/lib/agent/scenarios"
import { listCases } from "@/lib/agent/store"

export const runtime = "nodejs"

export async function GET() {
  const cases = await listCases()
  // The model transcript is the agent's working memory, not something the interface needs.
  return NextResponse.json({ cases: cases.map(({ transcript: _transcript, scenario: _scenario, ...rest }) => rest) })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { orderId?: string; trigger?: string; scenario?: string }
  // With only an order id, start that order's demo scenario.
  const demo = body.orderId && !body.trigger ? scenarioFor(body.orderId) : undefined
  const trigger = body.trigger ?? demo?.trigger
  if (!body.orderId || !trigger) {
    return NextResponse.json({ error: "Send orderId and trigger, or the orderId of a demo scenario", demos: SCENARIOS.map((item) => item.orderId) }, { status: 400 })
  }
  const caseRow = await openCase({ orderId: body.orderId, trigger, scenario: body.scenario ?? demo?.driver })
  // Answer straight away and let the agent work in the background. The page polls the case.
  after(() => runCase(caseRow.id))
  return NextResponse.json({ id: caseRow.id }, { status: 201 })
}
