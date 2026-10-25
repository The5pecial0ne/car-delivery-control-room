"use client"

import { ACTIONS } from "@/lib/agent/policy"
import { Disclosure } from "./disclosure"

const alone = Object.values(ACTIONS).filter((action) => action.autonomy === "auto").map((action) => action.label)
const needsYou = Object.values(ACTIONS).filter((action) => action.autonomy === "needs_approval" && action.label !== "Something else").map((action) => action.label)

export function WhoDoesWhat() {
  return <Disclosure id="who-does-what" tone="agent" action="See how" summary={<>Who does what: the agent does the legwork, you decide.</>}>
    <div className="who-does-what">
      <section>
        <h3>The agent does on its own</h3>
        <ul>
          <li>Reads the order, its messages, alerts and bookings</li>
          <li>Asks the driver and the pickup site, and gets quotes</li>
          <li>Prepares options, a Plan B and the deadlines</li>
          {alone.map((label) => <li key={label}>{label}</li>)}
        </ul>
      </section>
      <section>
        <h3>Waits for your yes</h3>
        <ul>{needsYou.map((label) => <li key={label}>{label}</li>)}</ul>
      </section>
      <section>
        <h3>Never</h3>
        <ul>
          <li>Contacts a customer. It drafts the message and you send it.</li>
          <li>Books, pays or changes a date without your yes.</li>
        </ul>
      </section>
      <p className="who-does-what-note">When the agent stops or is unsure, the order comes back to Needs attention as "Agent stopped" or with what is still unknown, and nothing has been changed.</p>
    </div>
  </Disclosure>
}
