// The agent runs inside the web app and from the command line, so it opens its
// own connection instead of going through lib/db.ts, which is server-only.

import "dotenv/config"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "@/lib/schema"

const url = process.env.DATABASE_URL
if (!url) throw new Error("DATABASE_URL is required. See starter/README.md.")

const globalForDb = globalThis as unknown as { agentSql?: ReturnType<typeof postgres> }
// Next reloads modules in development. Reusing the client stops every reload from opening a new pool.
const client = globalForDb.agentSql ?? postgres(url, { max: 5 })
globalForDb.agentSql = client

export const db = drizzle(client, { schema })
export const closeDb = () => client.end()
