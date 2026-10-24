// Run the on-the-road agent on one order from the command line and print what
// it did, step by step. Needs OPENROUTER_API_KEY in .env.
//
//   npm run agent -- ord-00322
//   npm run agent -- ord-00322 "Driver reports a red warning light" "What the driver privately knows"
//
// With only an order id, the order's demo scenario from lib/agent/scenarios.ts is used.

import "dotenv/config"
import { openCase, runCase } from "@/lib/agent/loop"
import { closeDb } from "@/lib/agent/conn"
import { scenarioFor } from "@/lib/agent/scenarios"
import { getCase, listSteps } from "@/lib/agent/store"

const [orderId = "ord-00322", givenTrigger, givenScenario] = process.argv.slice(2)
const demo = scenarioFor(orderId)
const trigger = givenTrigger ?? demo?.trigger ?? "Check on this moving order."
const scenario = givenScenario ?? demo?.driver

async function main(): Promise<void> {
  const caseRow = await openCase({ orderId, trigger, scenario })
  console.log(`Opened ${caseRow.id} on ${orderId}\n`)
  await runCase(caseRow.id)
  for (const step of await listSteps(caseRow.id)) console.log(`${String(step.seq).padStart(3)}  ${step.actor.padEnd(6)} ${step.kind.padEnd(8)} ${step.body}`)
  const done = await getCase(caseRow.id)
  console.log(`\nStatus: ${done?.status}\nHeadline: ${done?.headline}`)
  if (done?.pendingDecision) console.log(JSON.stringify(done.pendingDecision, null, 2))
  await closeDb()
}

main().catch(async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})
