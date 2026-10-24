// Run the on-the-road agent on one order from the command line and print what
// it did, step by step. Needs OPENROUTER_API_KEY in .env.
//
//   npm run agent -- ord-00322
//   npm run agent -- ord-00322 "Driver reports a red warning light" "What the driver privately knows"
//   npm run agent -- ord-00322 --approve     then approve whatever it hands over, to see the follow-up
//   npm run agent -- ord-00322 --approve --note="Dealer sends their own assistance"   with how a call went
//
// With only an order id, the order's demo scenario from lib/agent/scenarios.ts is used.

import "dotenv/config"
import { decide, openCase, runCase } from "@/lib/agent/loop"
import { closeDb } from "@/lib/agent/conn"
import { packScenario, scenarioFor } from "@/lib/agent/scenarios"
import { getCase, listSteps } from "@/lib/agent/store"

const args = process.argv.slice(2)
const approve = args.includes("--approve")
const note = args.find((arg) => arg.startsWith("--note="))?.slice("--note=".length)
const [orderId = "ord-00322", givenTrigger, givenScenario] = args.filter((arg) => !arg.startsWith("--"))
const demo = scenarioFor(orderId)
const trigger = givenTrigger ?? demo?.trigger ?? "Check on this moving order."
const scenario = givenScenario ?? packScenario(demo?.driver, demo?.site)

async function main(): Promise<void> {
  const caseRow = await openCase({ orderId, trigger, scenario })
  console.log(`Opened ${caseRow.id} on ${orderId}\n`)
  await runCase(caseRow.id)
  if (approve && (await getCase(caseRow.id))?.pendingDecision) {
    console.log("(approving the hand-over as Test operator)\n")
    await decide(caseRow.id, { choice: "approve", by: "Test operator", note })
  }
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
