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
