# Demo video script (2 to 3 minutes)

Before recording: start the starter (README). `npm run db:seed` already puts the four recorded demo cases on the desk. To record live agent runs instead, run `npm run agent:demo` in `starter/` (about two minutes, needs a model key). Open http://localhost:3000 at laptop width.

**0:00 to 0:15. The pitch.** "Bahn has hundreds of orders on the go and most need nobody. Our control room shows a person only the ones that do, and our agent does the legwork first: it investigates, then plans the recovery. A person makes the call."

**0:15 to 0:40. The desk.** On the home page. "19 of 100 orders need attention. Everything else is on the right, and every one of those says what was checked: no open alerts, driver on the road, ETA inside the promise. Orders with a routine follow-up say who owns it. Each row on the left says how serious it is, how much time is left, and who has the next move."

**0:40 to 1:20. One case in a few seconds.** Open the BMW M4 at Velantora Helsinki (top of the list). "The driver is at the dealer and the car isn't there. The header says it in one line, the countdown says what happens in 27 minutes, and there is one recommended plan with Approve, Edit or Reject." Open *View evidence*. "Before I saw anything, the agent called the pickup desk and found the car at the Vantaa yard. Every fact is marked confirmed, reported or unknown, with its source." Switch *Speed* to *Cost*. "The ranking changes, and it explains each option against the others." Open *View pattern*. "And this place has a habit with keys and release papers."

**1:20 to 1:40. Knowing when to stay out.** Open "Stuck in the ferry queue" (under On track, Booked). "Here the agent checked with the driver, found they had checked in, withdrew a stale change request by itself, which is the one thing it may do alone, and closed the case." Then open the Ferrari Roma. "And when the problem is paperwork, Plan B says so, instead of suggesting a new driver."

**1:40 to 1:50. Built for people.** Flip **Easy reading** in the sidebar. "OpenDyslexic, calmer spacing, nothing cut off."

**1:50 to 2:50. How we built it.** Show `docs/BUILD-LOG.md`, then the agent activity on the Bentley case. "We built this with Claude Code: one coordinator and a session per job, every change a pull request we checked in the browser before merging. We tuned the agent by reading full traces. When it got dates or sources wrong, we moved that into a tool or a check, not more prompt. Here the checker refuses a hand-over that cites a source the agent never saw. The agent even caught our own mistake: we had put the Bentley in the wrong place, and it noticed the tracking data disagreed. We threw away a dark theme, a top bar and a vertical timeline. And this morning we asked Claude to judge us honestly. It found our desk flagged 43 orders, so we fixed it to 19."
