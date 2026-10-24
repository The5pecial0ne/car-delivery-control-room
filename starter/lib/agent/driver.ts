// A simulated driver, so the agent has someone real-sounding to talk to in the
// demo. It is a second, smaller model playing the driver on the order. It sees
// the same chat the driver would see, plus a short private scenario that says
// what is really going on (where they are, what the dashboard shows). The agent
// never sees that scenario; it has to ask.

import { and, asc, eq, inArray } from "drizzle-orm"
import { conversations, drivers, messages, relatedRecords } from "@/lib/schema"
import { db } from "./conn"
import { DRIVER_MODEL, type ChatMessage, type CompleteFn } from "./model"
import { listSteps, type CaseRow } from "./store"

const DEFAULT_SCENARIO = "Nothing unusual beyond what is already in the chat. If you are asked something the chat does not settle, give a plausible, ordinary answer and keep it consistent afterwards."

export async function simulateDriverReply(caseRow: CaseRow, complete: CompleteFn): Promise<string> {
  const [assignment] = await db.select().from(relatedRecords).where(and(
    eq(relatedRecords.collection, "work_assignments"), eq(relatedRecords.orderId, caseRow.orderId),
  )).limit(1)
  const driverId = typeof assignment?.details.driver_id === "string" ? assignment.details.driver_id : null
  const [driver] = driverId ? await db.select().from(drivers).where(eq(drivers.id, driverId)).limit(1) : []

  // What the driver has already said and heard on this order, from the dataset.
  const threads = await db.select().from(conversations).where(eq(conversations.orderId, caseRow.orderId))
  const earlier = threads.length
    ? await db.select().from(messages).where(inArray(messages.conversationId, threads.map((thread) => thread.id))).orderBy(asc(messages.authoredAt))
    : []
  const history: ChatMessage[] = earlier
    .filter((row) => row.details.visibility === "PUBLIC" && (row.authorType === "driver" || row.details.recipient_type === "driver"))
    .map((row) => row.authorType === "driver"
      ? { role: "assistant", content: row.body }
      : { role: "user", content: `[Bahn] ${row.body}` })

  // And what has been said since the agent picked the case up.
  for (const step of await listSteps(caseRow.id)) {
    if (step.kind !== "message") continue
    if (step.actor === "driver") history.push({ role: "assistant", content: step.body })
    else if (step.actor === "agent" && step.data.to === "driver") history.push({ role: "user", content: `[Bahn] ${step.body}` })
  }

  const name = driver?.displayName ?? "the driver"
  const system = [
    `You are ${name}, a freelance driver delivering a car for Bahn, a car delivery company. You are chatting with Bahn in the driver app.`,
    "Write like a real person on a phone: one to three short sentences, plain words, no lists, no sign-off.",
    "Only answer what you are asked. Do not volunteer the whole story at once.",
    "If you are asked for a photo, reply with what you send in square brackets, for example [photo: dashboard with a red warning light].",
    "You are not a mechanic and you do not diagnose the car. You will not drive on unless Bahn clearly tells you to.",
    "Everything here is fictional.",
    "",
    `What is really going on right now (private to you): ${caseRow.scenario ?? DEFAULT_SCENARIO}`,
    "This is the truth as of now. It overrides anything you said earlier in the chat, because things have moved on since. Stay consistent with it in every reply.",
  ].join("\n")

  // A small model drifts back to the old chat ("still in the queue"), so remind
  // it of where things stand right next to the message it is answering.
  const last = history.at(-1)
  if (last?.role === "user" && caseRow.scenario) {
    history[history.length - 1] = { role: "user", content: `${last.content}\n\n(Private note to you, not part of Bahn's message: right now, ${caseRow.scenario})` }
  }
  const reply = await complete({ model: DRIVER_MODEL, messages: [{ role: "system", content: system }, ...history], temperature: 0.4 })
  return (reply.content ?? "").trim() || "Sorry, can you say that again?"
}
