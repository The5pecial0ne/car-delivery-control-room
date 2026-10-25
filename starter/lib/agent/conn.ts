import "dotenv/config"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "@/lib/schema"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required. See starter/README.md.")

const globalForDb = globalThis as unknown as { agentSql?: ReturnType<typeof postgres> }
const client = globalForDb.agentSql ?? postgres(url, { max: 5 })
globalForDb.agentSql = client

export const db = drizzle(client, { schema })
export const closeDb = () => client.end()
