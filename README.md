# Car Delivery Control Room: our entry

We built the **"Needs you" desk** and an agent that works each case in **two stages**. It handles breakdowns, sold-out or missed ferries, delays, and pickups where the car is not where it should be.

1. **Investigate.** It reads the records and asks the driver or the pickup site. It sorts what it finds into confirmed, reported, planned and unknown, lists where sources disagree, names the one question that unlocks the case, and lays out the delivery as planned against what is really happening.
2. **Plan the recovery.** It scores options by arrival, cost and certainty, prepares a plan B, and sets deadlines that count down. The operator ranks the options by speed, cost or certainty, and approves one. Every fact has a source.

- What a person sees: cases grouped by who has the ball, a suggestion with Approve, Do something else and Reject, the facts with sources, what is still unknown, and the full story of what the agent did.
- What the agent may do: read anything and message the driver. Everything that changes the world is a proposal, listed with its own switch in `starter/lib/agent/policy.ts`. One small action, withdrawing an unconfirmed travel change, is switched to automatic. The agent has no tool for contacting customers, so it can only draft messages for a person to send.
- Checks in code, not only in the prompt: a hand-over is refused if it cites a source the agent never saw, has no facts, or puts ids in the headline.
- The driver and the pickup desk are played by a second, smaller model with a private scenario, so the agent has to ask.
- Site patterns flag places where the same trouble keeps coming back. Easy reading mode switches the app to OpenDyslexic.

How we built it: [`docs/BUILD-LOG.md`](docs/BUILD-LOG.md). Demo walkthrough: [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md).

- Only orders with a real problem reach the desk (18 of 100 in the snapshot, with the recorded cases loaded). Every other order says what was checked ("no open alerts · driver on the road · app ETA inside the promise"), or who is following it up.

**Run it:** follow "Run the starter" below and open http://localhost:3000.

- **No model key needed to see the agent's work.** `npm run db:seed` loads four recorded runs of the demo cases (`starter/demo/recorded-cases.json`), with every step of their traces.
- **To run the agent live,** put an OpenRouter key in `starter/.env` (`OPENROUTER_API_KEY=`), then run `npm run agent:demo` in `starter/`. You can also run one case from the terminal with `npm run agent -- ord-00322`, or press "Hand to the agent" on any order that needs attention.
- **Checks:** `npm run test` (the desk's rules, no database needed), `npm run agent:test` (the agent's plumbing with a scripted model, no credit spent), `npm run smoke` (data and pages agree).

---

# The Car Delivery Control Room

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

## What is in here

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

## Run the starter

You need Node.js 24 or newer and Docker.

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

If port 5438 or 9009 is already in use on your computer, change it in
`starter/compose.yaml` and in the matching line of `starter/.env`.
`starter/README.md` has the details.

## Tips

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
