# Demo script

A walkthrough of the app, step by step, with what to say at each step. It matches the app as it is on `main`.

**To show it live:** start the app (README), open http://localhost:3000 at laptop width, and run `npm run db:seed` again just before you start, so the case countdowns begin fresh. No model key is needed: the seed loads the four recorded agent cases. To show live agent runs instead, run `npm run agent:demo` in `starter/` first (about two minutes, needs a model key).

## The control room (0:00 to 1:52)

**0:00 · Title.** Bahn Continuity: investigate, plan the recovery, a person makes the call.
> This is Bahn Continuity. Most cars on the move need nobody. Our control room shows a person only the ones that do, and one agent does the legwork first: it investigates, then plans the recovery. A person makes the call.

**0:18 · The desk.** Point at "18 need attention", then one row (Critical, Time left, Decision needed), then the On track panel and a "Checked:" line. Scroll On track a little.
> Of a hundred orders, eighteen need attention. Each row says how serious it is, how much time is left, and who moves next. Everything else is On track, and says what was checked. An order nobody checked is not fine.

**0:35 · BMW M4, Helsinki to Turku** (top of the list, open by default). Point at the title, the issue line, the countdown, the recommended action, then Approve plan, Edit plan and Reject.
> The top case: a driver is waiting in Helsinki, and the BMW isn't there. One line says what's wrong, one countdown says how long we have, and one recommended action waits for Approve, Edit or Reject.

**0:52 · View evidence.** Scroll to "The one question that unlocks this case", point at a "Site said" chip, then at the Confirmed and Reported columns and "Customer wrote, 21 Oct 07:39".
> The agent already called the pickup desk and found the car at a yard in Vantaa. Every fact is confirmed, reported or unknown, with who said it, and when.

**1:04 · Cost, then the site pattern.** Scroll back up and press **Cost**: the recommendation changes to the backup driver with its €134 cost. Scroll down and open **View pattern** for Velantora Helsinki.
> If cost matters more today, one click re-ranks every option. And this site has a pattern: keys and release papers, again.

**1:15 · Bentley Continental GT, Munich to Hamburg.** Point at the issue line, the agent's pick (call Marvellin Motorhandel about Bentley's roadside assistance or a tow), Quoted, and the drafted customer message. Then open **Who does what** at the bottom of Needs attention and point at its three lists.
> Bahn's own example: a warning light on the motorway. The agent's pick leads: call the dealer about roadside assistance, with tow quotes ready and a customer message drafted for a person to send. And who does what is spelled out.

**1:31 · Volkswagen Golf** (On track, "Agent handled"). Point at "The agent handled this without you" and the agent activity line. Then open **Ferrari Roma, Hamburg** in Needs attention and point at "No Plan B needed".
> It knows when to stay out. This driver had checked in, so the agent withdrew a stale change request, the one thing it may do alone, and closed the case. And when the trouble is paperwork, Plan B says so.

**1:46 · Easy reading.** Flip the switch in the sidebar.
> Easy reading switches everything to OpenDyslexic.

## How we built it (1:52 to 2:44)

**1:52 · Slide: one person, many Claude Code sessions.** One person, a coordinator session, one session per job, then pull request, real browser, merged only on a person's word.
> We built this with Claude Code: one coordinator, and a session for each job. Every change came back as a pull request, was checked in a real browser, and merged only when a person said so.

**2:06 · Slide: tuning the agent.** "If code can get it right, it goes in a tool or a check", three before-and-after rows, and `unseenSources` from `lib/agent/tools.ts`.
> We tuned the agent by reading full traces. If code can get it right, it goes in a tool or a check, not more prompt. It got dates wrong, so it got a sailing planner. It cited sources it never saw, so a checker now sends those hand-overs back. It even caught our mistake: our Bentley was in the wrong place.

**2:28 · Slide: what we threw away.** Screenshots of the all-red theme, the top bar and the vertical timeline, crossed out. Then the honest review: 43 → 18.
> We threw away first answers that looked fine: an all-red theme, a top bar, a long vertical timeline. Then we asked a fresh session to judge us honestly. Our desk flagged forty-three orders. Now it's eighteen.

**2:44 · Close.** The repo and `npm run db:seed`.
> Bahn Continuity. The agent does the legwork, a person makes the call. It runs from a fresh clone, with no model key needed.
