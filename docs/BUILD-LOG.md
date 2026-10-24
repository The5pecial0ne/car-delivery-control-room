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
