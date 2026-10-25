import { and, eq, inArray } from "drizzle-orm"
import { alerts, messages, operationalEvents, relatedRecords } from "@/lib/schema"
import { db } from "./conn"
import { parseSource } from "./labels"

export type SourceInfo = { who: string; at: string | null }

const WRITER: Record<string, string> = {
  driver: "Driver wrote", customer: "Customer wrote", operator: "Bahn operations wrote", site_contact: "Pickup site wrote",
  handoff_contact: "Handover contact wrote", agent: "Bahn agent wrote",
}

const WHEN = ["recorded_at", "observed_at", "authored_at", "triggered_at", "opened_at", "created_at", "quoted_at", "booked_at", "published_at", "updated_at"]

export async function resolveSources(json: unknown): Promise<Record<string, SourceInfo>> {
  const refs = [...new Set(JSON.stringify(json ?? null).match(/\b[a-z_]+\/[A-Za-z0-9_.:-]+/g) ?? [])]
  const byTable = new Map<string, string[]>()
  for (const ref of refs) {
    const { table, id } = parseSource(ref)
    if (table === "agent_steps" || table === "simulated") continue
    byTable.set(table, [...(byTable.get(table) ?? []), id])
  }
  const found: Record<string, SourceInfo> = {}
  for (const [table, ids] of byTable) {
    if (table === "messages") {
      for (const row of await db.select().from(messages).where(inArray(messages.id, ids))) {
        found[`messages/${row.id}`] = { who: WRITER[row.authorType] ?? "Message", at: row.authoredAt.toISOString() }
      }
    } else if (table === "alerts") {
      for (const row of await db.select().from(alerts).where(inArray(alerts.id, ids))) {
        found[`alerts/${row.id}`] = { who: "Alert raised", at: row.triggeredAt.toISOString() }
      }
    } else if (table === "operational_events") {
      for (const row of await db.select().from(operationalEvents).where(inArray(operationalEvents.id, ids))) {
        found[`operational_events/${row.id}`] = { who: "Order history", at: row.recordedAt.toISOString() }
      }
    } else {
      for (const row of await db.select().from(relatedRecords).where(and(eq(relatedRecords.collection, table), inArray(relatedRecords.id, ids)))) {
        const key = WHEN.find((field) => typeof row.details[field] === "string")
        found[`${table}/${row.id}`] = { who: parseSource(`${table}/${row.id}`).label, at: key ? String(row.details[key]) : null }
      }
    }
  }
  return found
}
