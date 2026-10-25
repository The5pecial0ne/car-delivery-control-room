import { asc, eq, inArray } from "drizzle-orm"
import { conversations, messages, relatedRecords } from "@/lib/schema"
import { db } from "./conn"
import { DRIVER_MODEL, type ChatMessage, type CompleteFn } from "./model"
import { scenarioParts } from "./scenarios"
import { listSteps, type CaseRow } from "./store"

const DEFAULT_SITE = "Nothing unusual. If you are asked something you cannot know from the chat, say you will have to check, and do not make up details."

export async function pickupContactFor(orderId: string) {
  const rows = await db.select().from(relatedRecords).where(eq(relatedRecords.orderId, orderId))
  const pickup = rows.find((row) => row.collection === "order_endpoint_details" && row.details.boundary === "PICKUP")
  return pickup ? { name: String(pickup.details.contact_name ?? "the site desk"), role: String(pickup.details.contact_role ?? "site desk"), source: `order_endpoint_details/${pickup.id}` } : null
}

export async function simulateSiteReply(caseRow: CaseRow, complete: CompleteFn): Promise<string> {
  const contact = await pickupContactFor(caseRow.orderId)
  const threads = await db.select().from(conversations).where(eq(conversations.orderId, caseRow.orderId))
  const earlier = threads.length
    ? await db.select().from(messages).where(inArray(messages.conversationId, threads.map((thread) => thread.id))).orderBy(asc(messages.authoredAt))
    : []
  const history: ChatMessage[] = earlier.filter((row) => row.authorType === "site_contact").map((row) => ({ role: "assistant", content: row.body }))
  for (const step of await listSteps(caseRow.id)) {
    if (step.kind !== "message") continue
    if (step.actor === "site") history.push({ role: "assistant", content: step.body })
    else if (step.actor === "agent" && step.data.to === "site") history.push({ role: "user", content: `[Bahn] ${step.body}` })
  }
  const scenario = scenarioParts(caseRow.scenario).site ?? DEFAULT_SITE
  const system = [
    `You are ${contact?.name ?? "the person at the desk"}, ${contact?.role ?? "site desk"} at the pickup site for a car Bahn, a car delivery company, is collecting. Bahn is calling or messaging you.`,
    "Answer like a busy, helpful person at a desk: one to three short sentences, plain words, no lists.",
    "Only answer what you are asked. Do not decide anything for Bahn or for the seller.",
    "Everything here is fictional.",
    "",
    `What is true right now (private to you): ${scenario}`,
  ].join("\n")
  const last = history.at(-1)
  if (last?.role === "user") history[history.length - 1] = { role: "user", content: `${last.content}\n\n(Private note, not part of Bahn's message: ${scenario})` }
  const reply = await complete({ model: DRIVER_MODEL, messages: [{ role: "system", content: system }, ...history], temperature: 0.4 })
  return (reply.content ?? "").trim() || "Sorry, could you repeat that?"
}
