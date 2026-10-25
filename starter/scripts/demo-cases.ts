// The recorded demo cases, for a desk that shows the agent's work without a
// model key.
//
//   npm run demo:load   clear the desk and load demo/recorded-cases.json (db:seed does this too)
//   npm run demo:save   save the cases on the desk now, after a fresh npm run agent:demo

import "dotenv/config"
import { closeDb } from "@/lib/agent/conn"
import { loadRecorded, saveRecorded } from "@/lib/agent/recorded"

async function main(): Promise<void> {
  if (process.argv.includes("--save")) {
    const count = await saveRecorded()
    console.log(`Saved ${count} case${count === 1 ? "" : "s"} to demo/recorded-cases.json.`)
    return
  }
  const count = await loadRecorded()
  console.log(`Loaded ${count} recorded demo case${count === 1 ? "" : "s"} onto the desk.`)
}

main().then(closeDb, async (error) => {
  console.error(error)
  await closeDb()
  process.exit(1)
})
