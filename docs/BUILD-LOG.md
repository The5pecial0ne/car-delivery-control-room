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

**Step 3: the "Needs you" desk.**
- The home page is now a desk, not the board. Cases are grouped by who has the ball: waiting for you, agent is on it, handled without you. The old board of lanes moved to "All orders".
- Each case reads top to bottom the way a person decides: the headline, what happened, the agent's suggestion with Approve, Do something else and Reject, then what it found with a source on every fact, what is still unknown, and the full story underneath.
- Sources you can follow: a fact the driver told the agent links to that exact message in the story below. Made-up quotes are marked "Quote (simulated)" so nobody mistakes them for real records.
- The customer message is a draft the person edits and sends on approval. The page says plainly that the agent never sends it.
- Caught in review: a person could write to the agent while it was still mid-run, and the running loop would then overwrite the conversation and lose that message. The message box is now locked while the agent works, and the server refuses with a clear reason.
- We tried the case headline in the urgency colour first. A full orange sentence shouted, so the colour now lives in the small chips and the headline stays black.

**Step 2, second half: tuning the agent on real runs.** Once we had model access we ran the three demo cases again and again, read every trace, and fixed what we saw. The rule we kept to: when the model got something wrong that plain code can get right, we moved it into a tool or a check instead of adding more words to the prompt.

- *It did date maths in its head and got it wrong.* On the sold-out ferry it called Saturday "Friday", and once it said the later sailing needed one hotel night when it needs two. We added `plan_sailings`, a tool that works out the whole plan for every sailing that is left: when the driver reaches the terminal, whether they make check-in, which nights need a hotel, and when the car reaches the buyer against the promise. Every time now also comes with a local time and the weekday. After that the dates were right in every run.
- *It contradicted itself.* One hand-over had the headline "may miss the Oct 27 promise" and a customer message saying "well ahead of your Oct 27 window". `estimate_delay_impact` now takes the planned arrival and answers inside or outside the promise, with hours to spare. That check used to need a driver-app ETA, so it said "no promise on file" before pickup.
- *It said a promise was "already missed" before the window had even opened.* We added a short section to the prompt on time: compare in UTC, talk in local time, and "will miss" is not the same as "already missed".
- *It cited sources that did not back the fact.* Tow prices were cited as "the driver said so", and "Bentleys often have their own assistance" was cited to a driver message. The hand-over tool now checks every source against what the tools actually returned on this case. If it has never seen a source, it sends the hand-over back. It caught a citation to `plan_sailings` (a tool, not a record), a headline with an order id in it, and headlines that were too long. The refusals stay in the story, so you can watch the checker do its job.
- *The tow quotes were random.* A tow from Munich to Hamburg came back as 47 km. Pretend services now know rough coordinates for every city in the dataset, so distances, prices and transit times look like the real map.
- *Our own demo scenario contradicted the data.* We had put the Bentley near Munich, but the order's tracking has it about 230 km from Hamburg. The agent noticed the mismatch, and that is how we found it. We moved the breakdown to Rasthof Göttingen on the A7.
- *It never asked the driver on the ferry case.* It took a three-day-old message as the answer. Now the prompt says that on a live case the agent always messages the driver before it hands over or closes, and asks what the driver can live with (how long they can wait, their train home), not only where they are.
- *It made promises nobody had approved.* "We'll arrange your return travel." "Customer informed." Neither had happened. We tightened this in two places. The prompt says only what a step shows has happened. And after an approval, the agent is told exactly which action was carried out and that nothing else in its summary was.
- *Approving a phone call made no sense.* "Call the customer" was marked "Done (simulated)", so the agent made up what the customer said. Actions a person does themselves now show "I did this" instead of Approve and ask "How did it go?". The agent picks up from what the person writes. In the test run it told the driver to hand over to Bentley's recovery team and closed the case.
- *It left a loose end on the case that went fine.* In the ferry queue case, operations had asked the carrier to move the car to a later crossing while things looked bad. The agent saw that the driver had checked in and closed the case, but left the request open, so it could still have moved the car later. This became our first automatic action. `withdraw_change_request` is switched to `auto` in `lib/agent/policy.ts`, so the new `take_action` tool lets the agent do it alone. The tool refuses every action that is not switched to `auto`. The autonomy switch we designed in step 1 now does something real.
- *The simulated driver drifted off script.* At temperature 0.7, and with the old "I'm stuck in the queue" messages in its history, the driver sometimes said it was still stuck when its private scenario says it is checked in. We told it the scenario is the truth as of now and overrides earlier messages, and lowered the temperature to 0.4. After that, three runs out of three stayed on script.
- `npm run agent:demo` clears the desk and runs all three cases side by side, for recording. `npm run agent -- <order> --approve --note="..."` runs a case and then answers its hand-over, so we can test the follow-up without clicking.

Where it ended up, on the same three cases: the Bentley case hands over "call the customer" with roadside, local-workshop and tow-to-Hamburg quotes, how long the driver can wait, and a ready-to-send customer message. The ferry case recommends the earlier sailing with one hotel night, checked against the promise, with the driver's agreement. The queue case confirms check-in with the driver, withdraws the stale change request by itself, thanks the driver and closes. About $4 of model credit went into all the tuning runs together.
