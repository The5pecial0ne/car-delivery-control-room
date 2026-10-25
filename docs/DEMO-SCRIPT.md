# Demo video script (2:59)

This is the script of the video we handed in, shot for shot, with the voiceover word for word. It matches the app as it is on `main`.

**To show it live:** start the app (README), open http://localhost:3000 at laptop width, and run `npm run db:seed` again just before you start, so the case countdowns begin fresh. No model key is needed: the seed loads the four recorded agent cases. To show live agent runs instead, run `npm run agent:demo` in `starter/` first (about two minutes, needs a model key).

## The control room (0:00 to 1:51)

**0:00 · Title.** Bahn Continuity: investigate, plan the recovery, a person makes the call.
> This is Bahn Continuity. Most of Bahn's cars on the move need nobody. Our control room shows a person only the ones that do, and one agent does the legwork first: it investigates, then plans the recovery. A person makes the call.

**0:14 · The desk.** Point at "18 need attention", then one row (Critical, Time left, Decision needed), then the On track panel and a "Checked:" line. Scroll On track a little.
> Out of a hundred orders, eighteen need attention. Each row says how serious it is, how much time is left, and who has the next move. Everything else is On track, and each one says what was checked. Because an order nobody checked is not fine.

**0:31 · BMW M4, Helsinki to Turku** (top of the list, open by default). Point at the title, the issue line, the countdown, the recommended action, then Approve plan, Edit plan and Reject.
> Here's the top case. A driver is waiting at the dealer in Helsinki, and the BMW isn't there. One line says what's wrong, one countdown says how long we have, and there's one recommended action, with Approve, Edit or Reject.

**0:46 · View evidence.** Scroll to "The one question that unlocks this case", point at a "Site said" chip, then at the Confirmed and Reported columns and "Customer wrote, 21 Oct 07:39".
> Before anyone looked, the agent called the pickup desk and found the car at a yard in Vantaa. Every fact is marked confirmed, reported or unknown, and says who said it, and when.

**0:58 · Cost, then the site pattern.** Scroll back up and press **Cost**: the recommendation changes to the backup driver with its €134 cost. Scroll down and open **View pattern** for Velantora Helsinki.
> If cost matters more today, one click re-ranks every option and explains the trade-off. And this site has a pattern: keys and release papers, again.

**1:09 · Bentley Continental GT, Munich to Hamburg.** Point at the issue line, the agent's pick (call Marvellin Motorhandel about Bentley's roadside assistance or a tow), Quoted, and the drafted customer message. Then open **Who does what** at the bottom of Needs attention and point at its three lists.
> This is Bahn's own example: a red warning light on the motorway. The agent's pick leads: call the dealer about roadside assistance, with tow quotes ready and a customer message drafted for a person to send. Who does what is spelled out: what the agent does alone, what waits for a yes, and what it never does.

**1:29 · Volkswagen Golf** (On track, "Agent handled"). Point at "The agent handled this without you" and the agent activity line. Then open **Ferrari Roma, Hamburg** in Needs attention and point at "No Plan B needed".
> It also knows when to stay out. Here the driver had already checked in, so the agent withdrew a stale change request, the one thing it may do alone, and closed the case. And when the trouble is paperwork, Plan B says so, instead of sending a new driver.

**1:45 · Easy reading.** Flip the switch in the sidebar.
> Easy reading switches the whole app to OpenDyslexic, with nothing cut off.

## How we built it (1:51 to 2:47)

**1:51 · Slide: one person, many Claude Code sessions.** Manas, the coordinator, one session per job, then pull request, real browser, merged only on Manas's word.
> We built this with Claude Code: one coordinator to talk to, and a separate session for each job. Every change came back as a pull request with screenshots, was checked in a real browser, and was merged only when Manas said so.

**2:05 · Slide: tuning the agent.** "If code can get it right, it goes in a tool or a check", three before-and-after rows, and `unseenSources` from `lib/agent/tools.ts`.
> We tuned the agent by reading full traces of real runs. When it got something wrong that code can get right, we moved it into a tool or a check, not more prompt. It got dates wrong, so it got a sailing planner. It cited sources it never saw, so a checker in code now sends those hand-overs back. It even caught our own mistake: we had put the Bentley in the wrong place, and the tracking data disagreed.

**2:30 · Slide: what we threw away.** Screenshots of the all-red theme, the top bar and the vertical timeline, crossed out. Then the honest review: 43 → 18.
> We threw away first answers that looked fine: an all-red theme, a top bar, a long vertical timeline. And this morning we asked a fresh session to judge us honestly against the brief. It found our desk flagged forty-three orders. Now it's eighteen.

**2:47 · Close.** The repo and `npm run db:seed`.
> Bahn Continuity. The agent does the legwork, a person makes the call. It runs from a fresh clone, with recorded traces and no model key needed.

## How the video was made

The video was made by a Claude Code session too. It ran the app headless from a fresh seed, drove it with Playwright, and captured it through Chrome's screencast at 1920×1080 with a drawn cursor. Every action is timed against the voiceover. The slides are plain HTML pages captured the same way. The voiceover was written from this repo and `docs/BUILD-LOG.md`, then spoken by OpenAI's `gpt-audio` through OpenRouter, and ffmpeg put the pieces together.
