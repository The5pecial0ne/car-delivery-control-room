# Demo video script (2 to 3 minutes)

Set up before recording: start the starter (README), then run `npm run agent:demo -- --clear` so the desk is empty. Have http://localhost:3000 open.

**0:00 to 0:20. The problem.** "Bahn delivers used cars. Most days go fine. The hard part is what happens on the road: a warning light, a sold-out ferry, a queue at the terminal. Today a person has to dig through chats, alerts and bookings to work out what to do. We built a desk where an agent does the digging, and a person only makes the call."

**0:20 to 0:35. Start the agents.** Click the three demo cases under "Start a demo case", or run `npm run agent:demo`. "Three things just went wrong on the road. The agent takes all three at once."

**0:35 to 1:05. The case that needs nobody.** Open "Stuck in the ferry queue" once it moves to "Handled without you". Scroll through the story. "It read the booking, asked the driver, and the driver is checked in. Then it found something a tired person might miss: operations had asked the carrier to move this car to a later ferry, and that request was still open. Moving a car off a ferry it is already checked in for would be bad. Withdrawing that request is the one thing we let it do on its own, and it says so. Then it thanks the driver and closes the case."

**1:05 to 1:50. The case that needs a judgement.** Open the Bentley. "Red warning light on the motorway. The agent asked the driver where they are, for a photo, and how long they can wait. They have a train tonight. It got quotes for roadside help, a tow to a local workshop and a tow to Hamburg, and checked the delivery promise. Every fact has a source. Click one and it jumps to the driver's actual message. Things it does not know are listed as unknown. It cannot contact the customer at all, so it drafted the message for me." Click "I did this" and type: "Dealer will send Bentley assistance within two hours, driver not needed after hand-over, delivery moves to tomorrow." "I tell it how the call went, and it picks up from there. It tells the driver, and closes the case."

**1:50 to 2:20. The sold-out ferry.** Open the BMW. "Here the maths is the hard part. A tool works out every remaining sailing: check-in, hotel nights, arrival against the promise. The agent agreed the plan with the driver. The decision is just: book it, for this much."

**2:20 to 2:50. How we built it.** Show `docs/BUILD-LOG.md` briefly. "We tuned it by reading real runs. Whenever the model got something wrong that code can get right, like dates, distances or citations, we moved it into a tool or a check. The hand-over is refused if it cites anything the agent has not actually seen. You can watch that happen in the story."
