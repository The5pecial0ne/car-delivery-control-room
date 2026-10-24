import { NextRequest, NextResponse } from "next/server"
import { preparePlanB, rankPlanB, type PlanB } from "@/lib/agent/plan-b"
import { isPriority } from "@/lib/agent/priority"

export const runtime = "nodejs"

// The legwork does not depend on the priority, so it is kept for a while and
// only the ranking is redone when the operator switches. "refresh" redoes the lookups.
const KEEP_MS = 10 * 60_000
const prepared = new Map<string, PlanB>()

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const query = request.nextUrl.searchParams
  const priority = query.get("priority")
  if (!isPriority(priority)) return NextResponse.json({ error: "priority must be speed, cost or certainty" }, { status: 400 })
  let plan = prepared.get(id)
  if (!plan || query.get("refresh") === "1" || Date.now() - new Date(plan.preparedAt).getTime() > KEEP_MS) {
    const fresh = await preparePlanB(id)
    if (!fresh) return NextResponse.json({ error: "Order not found" }, { status: 404 })
    plan = fresh
    prepared.set(id, plan)
  }
  return NextResponse.json(rankPlanB(plan, priority))
}
