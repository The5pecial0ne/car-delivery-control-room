import { NextResponse, after } from "next/server"
import { decide, type Choice } from "@/lib/agent/loop"
import { getCase } from "@/lib/agent/store"

export const runtime = "nodejs"

const CHOICES: Choice[] = ["approve", "change", "reject"]

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as { choice?: Choice; note?: string; by?: string }
  if (!body.choice || !CHOICES.includes(body.choice)) return NextResponse.json({ error: "choice must be approve, change or reject" }, { status: 400 })
  if (body.choice === "change" && !body.note?.trim()) return NextResponse.json({ error: "Say what you want instead" }, { status: 400 })
  const caseRow = await getCase(id)
  if (!caseRow) return NextResponse.json({ error: "Case not found" }, { status: 404 })
  if (!caseRow.pendingDecision) return NextResponse.json({ error: "There is no decision waiting on this case" }, { status: 409 })
  after(() => decide(id, { choice: body.choice!, note: body.note, by: body.by }))
  return NextResponse.json({ ok: true }, { status: 202 })
}
