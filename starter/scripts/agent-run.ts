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
