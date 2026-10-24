// Run the on-the-road agent on one order from the command line and print what
// it did, step by step. Needs OPENROUTER_API_KEY in .env.
//
//   npm run agent -- ord-00322 "Driver reports a red warning light"

import "dotenv/config"
import { openCase, runCase } from "@/lib/agent/loop"
import { closeDb } from "@/lib/agent/conn"
import { getCase, listSteps } from "@/lib/agent/store"

const [orderId = "ord-00322", trigger = "Driver reports a red dashboard warning and has stopped.", scenario] = process.argv.slice(2)

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
