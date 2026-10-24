# Build log

Notes on how we built this with coding agents, kept as we go so the demo video can tell the real story.

## Saturday 24 October

**Plan.** We asked Claude Code to read the brief and the repo and to ask us questions before planning. We chose the on-the-road area because the brief's own example (a warning light on the motorway) is about it, and because a simulated driver makes a demo that feels alive. We kept the starter app instead of starting over.

**Step 1: agent backend.**
- The agent's work lives in two new tables, `agent_cases` and `agent_steps`, so the dataset snapshot stays untouched. Every lookup, message, proposal and decision becomes a step, and that is the trace.
- Approvals are built in from the start. `lib/agent/policy.ts` lists every kind of change the agent can propose, each with its own switch (`needs_approval` or `auto`), so autonomy can grow one action at a time.
- The agent has no tool for contacting customers at all. It can only draft a message for a person to send. We liked that better than a rule in the prompt that the model might ignore.
- The simulated driver is a second, smaller model. It gets a private scenario (where they really are, what the dashboard shows) that the agent cannot see, so the agent has to ask.
- Hand-overs are checked. If the agent tries to hand over without a headline, with facts that are not a list, or with an action that does not exist, the tool refuses and tells it to fix that.
- We wrote a plumbing test (`npm run agent:test`) with a scripted stand-in for the model, so we can check the state machine without spending credit.
- What we threw away: the first version of the driver lookup scanned every job and filtered in code. We moved the filter into the database query.

**Step 2: the on-the-road agent (first half, before we had model access).**
- Pretend outside services in `lib/agent/services.ts`: roadside help, tow quotes, ferries, hotels and a delay-against-promise check. Prices are made up but stable (seeded by the input), so the demo can be rehearsed. Where the dataset already has a record (the sold-out ferry on CD-420299) the tool returns it with its id, so it can be cited.
- Three demo scenarios in `lib/agent/scenarios.ts`, picked to show both halves of the job: two cases that need a person (a warning light on a Bentley, a sold-out ferry) and one the agent should close by itself (a ferry queue that starts moving).
- Caught while testing: the agent would have used the wall clock as "now", but the data is a snapshot from 21 October. The case now starts with the snapshot time.
- Caught while reading the data: the simulated driver only heard `driver_chat` messages, but some drivers write in `support_chat` or email. It now hears every public message to or from the driver.
