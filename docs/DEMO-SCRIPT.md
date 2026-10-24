# Demo video script (2 to 3 minutes)

Set up before recording: start the starter (README), then run `npm run agent:demo` in `starter/` so the desk fills with the four demo cases (about two minutes). Have http://localhost:3000 open.

**0:00 to 0:20. The pitch.** "Bahn delivers used cars, and the hard part is what goes wrong on the way. Our agent works every case in two stages. First it acts like an investigator: it separates facts from claims and asks the one question that matters. Then it acts like a recovery planner: it prepares safe options and lets the operator decide what to optimise for. A person only makes the call."

**0:20 to 0:35. The desk.** "This is what an operator sees in the morning. No red risk scores. Each card says how much time is left and for what: 42 minutes until the driver has to leave for their train."

**0:35 to 1:20. Stage one on the hardest case: the car is not at the pickup.** Open the BMW at Velantora Helsinki. "The driver is at the dealer and the car isn't there. Look at what the agent did first." Scroll through **Investigation**. "It sorted everything it found into confirmed, reported, planned and unknown. The customer's system says the car is here. That is reported, not confirmed. It wrote down the one question that unlocks the case, called the site desk, and the desk found the car at their other yard in Vantaa, with the keys in a key safe. Every fact links to where it came from. Here is the delivery reality timeline: planned against what really happened, with now in red." Point at the site-pattern card. "And this place has a habit. It's the second order here this month with a problem over keys or release papers."

**1:20 to 1:55. Stage two: recovery.** Scroll to **Recovery**. "Now it plans. The countdown says what must happen before when. It prepared a plan B while it waited, with real lookups: backup drivers nearby and the extra cost. Every option has arrival, cost and certainty. Switch to *Cost* or *Certainty* and the ranking changes. I pick, I approve, and it carries on. It can never contact the customer itself. It only drafts the message for me."

**1:55 to 2:20. It knows when to stay out of the way.** Open "Stuck in the ferry queue" under *Handled without you*. "Here it checked with the driver, who was already checked in. It found a leftover request to move the car to a later ferry and withdrew it. That is the one thing we let it do on its own. Then it closed the case."

**2:20 to 2:40. Built for people.** Flip **Easy reading** in the sidebar. "OpenDyslexic, calmer spacing, nothing cut off. It's remembered per person."

**2:40 to 2:55. How we built it.** Show `docs/BUILD-LOG.md`. "We tuned it by reading real runs. When the model got dates, distances or sources wrong, we moved that into a tool or a check. It cannot hand over until its findings are written down after the last answer, and it cannot cite a source it never saw."
