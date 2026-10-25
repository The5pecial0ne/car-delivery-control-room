# Bahn Continuity: Car Delivery Control Room

Our entry for Bahn's challenge at the Prompt Operations Hackathon (24 to 25 October 2026).

It is two things:

- **A control room** where people and agents share one desk. Orders that need a person sit in the middle, sorted by how serious they are and how much time is left. Everything else sits on the right under "On track", and each of those says what was checked ("no open alerts · driver on the road · app ETA inside the promise") or who is following it up. In the snapshot, 18 of the 100 orders need attention.
- **One real agent for the road.** It takes breakdowns, sold-out or missed ferries, delays, and pickups where the car isn't where it should be, and it works each case in two stages.

All the data is made up by Bahn. No real people, cars, companies or messages.

**Demo video (2:57):** _link to be added_

## How the agent works

1. **Investigate.** It reads the records and asks the driver or the pickup site. It sorts what it finds into confirmed, reported, planned and unknown, points out where sources disagree, names the one question that would unlock the case, and lays the planned delivery next to what is really happening.
2. **Plan the recovery.** It scores the options by arrival, cost and certainty, prepares a Plan B, and sets deadlines that count down. The operator can rank the options by speed, cost or certainty, then approve one. Every fact links back to its source.

A few things we cared about:

- **The agent proposes, a person decides.** It may read anything and message the driver. Anything that changes the world is a proposal, and each kind has its own switch in `starter/lib/agent/policy.ts`. Only one small action is automatic: withdrawing a travel change nobody has confirmed yet. The agent has no tool for contacting customers, so it can only draft those messages for a person to send.
- **Rules live in code, not only in the prompt.** A hand-over is refused if it cites a source the agent never saw, has no facts, or puts ids in the headline.
- **The agent has to ask.** The driver and the pickup desk are played by a second, smaller model with its own private scenario, so the agent can't just read the answer.
- **Patterns and reading comfort.** Site patterns flag places where the same trouble keeps coming back, and Easy reading mode switches the whole app to OpenDyslexic.

## Run it locally

You need Node.js 24 or newer and Docker. **No model key is needed** to see the agent's work: the seed step loads four recorded runs of the demo cases (`starter/demo/recorded-cases.json`), with every step of their traces.

```sh
cd starter
cp .env.example .env
npm ci
docker compose up -d --wait
npm run db:push
npm run db:seed
npm run attachments:seed
npm run dev
```

Then open http://localhost:3000.

If port 5438 or 9009 is already taken on your machine, change it in `starter/compose.yaml` and in the matching line of `starter/.env`. `starter/README.md` has the details.

**Running the agent live (optional).** Put an OpenRouter key in `starter/.env` as `OPENROUTER_API_KEY=...` (that file is git-ignored, so the key stays on your machine). Then run `npm run agent:demo` in `starter/` to clear the desk and run the demo cases again, or `npm run agent -- ord-00322` for a single case, or press "Hand to the agent" on any order that needs attention. `AGENT_MODEL` and `DRIVER_MODEL` take any OpenRouter model id.

**Checks.**

- `npm run test` checks the desk's rules and needs no database.
- `npm run agent:test` runs the agent's plumbing against a scripted model, so it spends no credit.
- `npm run smoke` checks that the data and the pages agree.

## Where to read more

- [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md): how we built it, and how we worked with AI along the way.
- [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md): the demo video's script, shot by shot, with the voiceover word for word.
- `PARTICIPANT-BRIEF.md` and `OPERATIONS-CONTEXT.md`: Bahn's brief and how car delivery work goes there.

## What is where

- `starter/app/`: the pages (control room, all orders, order page, inbox, customers, drivers, places).
- `starter/lib/agent/`: the agent, its tools, the policy switches and Plan B.
- `starter/lib/present/`: what the desk shows and why, including the timeline at the top of each order.
- `starter/scripts/`: seeding, the agent runners and the checks.
- `dataset/` and `attachments/`: Bahn's made-up orders, messages, documents and photos.

---

## About the challenge (from Bahn)

Everything below this line is Bahn's original README for the challenge, kept as it was apart from its run steps, which are in [Run it locally](#run-it-locally) above.

This is Bahn's challenge for the Prompt Operations Hackathon, 24 to 25 October
2026.

Bahn delivers used cars. A dealer sells a car, a driver from our network picks
it up and drives it to the buyer. Our agents already do a lot of the routine
work. The challenge is to build the place where people and agents work
together to get every car delivered, and one real agent for one part of the
job.

**Read `PARTICIPANT-BRIEF.md` first.** It says what to build, what to hand in,
and how we judge.

Everything in this repo is made up. No real people, cars, companies or
messages.

### What is in here

- `PARTICIPANT-BRIEF.md`: the challenge. Start here.
- `OPERATIONS-CONTEXT.md`: how car delivery work goes at Bahn, in plain
  words. Good reading for you and for your coding agent.
- `dataset/`: 100 made-up orders and everything around them: dealers,
  drivers, cars, bookings, messages, alerts, documents and events.
  `dataset/README.md` explains the files. `dataset/SCHEMA.md` explains every
  field.
- `attachments/`: made-up documents, receipts and photos that belong to those
  orders.
- `starter/`: a small web app that loads the data and shows it: a board of
  orders, an order page, a support inbox, and pages for customers, drivers and
  places. Use it, change it, or throw it away.
- `mockups/`: screenshots of the starter, so you can see it without running
  it.
- `check_packet.py`: a script that checks the data is complete. You do not
  need it, but you can run it with `python3 check_packet.py`.

### Tips

- Point your coding agent at `PARTICIPANT-BRIEF.md`, `OPERATIONS-CONTEXT.md`
  and `dataset/SCHEMA.md` before you start. They explain the world better than
  the code does.
- The data is a snapshot. Nothing in it changes by itself. Your agent can
  pretend to send messages, make calls and book things. Nothing real is
  connected.
- Some of the data is messy on purpose. A message can disagree with an
  address. An alert is a reason to look, not a diagnosis. A quote for a ferry
  is not a booked ferry.
- The starter's board of lanes is how people have worked so far. It is not the
  answer.
- Questions: our channel on the event Discord, or our booth.
