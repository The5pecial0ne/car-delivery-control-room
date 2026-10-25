import "dotenv/config"
import { closeDb } from "@/lib/agent/conn"
import { openCase, runCase } from "@/lib/agent/loop"
import { packScenario, SCENARIOS } from "@/lib/agent/scenarios"
import { deleteCase, getCase, listCases } from "@/lib/agent/store"

async function main(): Promise<void> {
  const old = await listCases()
  for (const row of old) await deleteCase(row.id)
  console.log(`Cleared ${old.length} case${old.length === 1 ? "" : "s"} from the desk.`)
  if (process.argv.includes("--clear")) return

  await Promise.all(SCENARIOS.map(async (scenario) => {
    const caseRow = await openCase({ orderId: scenario.orderId, trigger: scenario.trigger, scenario: packScenario(scenario.driver, scenario.site) })
    console.log(`Started: ${scenario.title}`)
    await runCase(caseRow.id)
    const done = await getCase(caseRow.id)
    console.log(`Finished: ${scenario.title} -> ${done?.status}: ${done?.headline}`)
  }))
}

main().then(closeDb, async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})
