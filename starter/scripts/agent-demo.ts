// Sets the desk up for a demo: clears every agent case, then runs the three
// demo scenarios side by side, so the desk fills up the way it would on a
// real morning. Open http://localhost:3000 while it runs to watch it live.
//
//   npm run agent:demo            clear the desk and run all three
//   npm run agent:demo -- --clear just clear the desk

import "dotenv/config"
import { closeDb } from "@/lib/agent/conn"
import { openCase, runCase } from "@/lib/agent/loop"
import { SCENARIOS } from "@/lib/agent/scenarios"
import { deleteCase, getCase, listCases } from "@/lib/agent/store"

async function main(): Promise<void> {
  const old = await listCases()
  for (const row of old) await deleteCase(row.id)
  console.log(`Cleared ${old.length} case${old.length === 1 ? "" : "s"} from the desk.`)
  if (process.argv.includes("--clear")) return

  await Promise.all(SCENARIOS.map(async (scenario) => {
    const caseRow = await openCase({ orderId: scenario.orderId, trigger: scenario.trigger, scenario: scenario.driver })
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
