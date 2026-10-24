import { NextResponse, after } from "next/server"
import { isRunning, tellAgent } from "@/lib/agent/loop"
import { getCase } from "@/lib/agent/store"

export const runtime = "nodejs"

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  const body = await request.json().catch(() => ({})) as { text?: string; by?: string }
  if (!body.text?.trim()) return NextResponse.json({ error: "text is required" }, { status: 400 })
  if (!await getCase(id)) return NextResponse.json({ error: "Case not found" }, { status: 404 })
  // The running loop holds its own copy of the conversation, so a message now would be lost. Wait for it to finish.
  if (isRunning(id)) return NextResponse.json({ error: "The agent is still working. Try again in a moment." }, { status: 409 })
  after(() => tellAgent(id, { text: body.text!.trim(), by: body.by }))
  return NextResponse.json({ ok: true }, { status: 202 })
}
