// What the agent may do on its own, and what needs a person's yes first.
//
// Reading, looking things up and asking drivers or pickup places questions are
// free. Anything that changes the world (a booking, a date, a cost, a message
// to a customer) goes to a person as a proposal. Customers are never contacted
// by the agent directly: there is simply no tool for it.
//
// Each action kind carries its own switch so that, once the agent has earned
// trust on a kind of action, someone can flip it to "auto" without touching
// the agent itself.

export type Autonomy = "needs_approval" | "auto"

export const ACTIONS = {
  call_customer: { label: "Call the customer", autonomy: "needs_approval", who: "person" },
  message_customer: { label: "Send a message to the customer", autonomy: "needs_approval", who: "agent" },
  book_roadside_assistance: { label: "Book roadside assistance", autonomy: "needs_approval", who: "agent" },
  book_tow: { label: "Book a tow or collection", autonomy: "needs_approval", who: "agent" },
  change_delivery_time: { label: "Change the promised delivery time", autonomy: "needs_approval", who: "agent" },
  book_travel: { label: "Book travel or a hotel for the driver", autonomy: "needs_approval", who: "agent" },
  approve_cost: { label: "Approve a cost", autonomy: "needs_approval", who: "agent" },
  release_driver: { label: "Let the driver continue or go home", autonomy: "needs_approval", who: "agent" },
  hold_and_wait: { label: "Keep everything on hold and check again later", autonomy: "needs_approval", who: "agent" },
  // The first action we trust the agent with on its own: taking back a travel
  // change request that nobody confirmed, once the original plan is safe again.
  // It only ever returns things to what was already booked.
  withdraw_change_request: { label: "Withdraw an unconfirmed travel change request", autonomy: "auto", who: "agent" },
  other: { label: "Something else", autonomy: "needs_approval", who: "person" },
} as const satisfies Record<string, { label: string; autonomy: Autonomy; who: "agent" | "person" }>

export type ActionKind = keyof typeof ACTIONS
export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[]
export const isActionKind = (value: unknown): value is ActionKind => typeof value === "string" && value in ACTIONS
export const AUTO_ACTIONS = ACTION_KINDS.filter((kind) => ACTIONS[kind].autonomy === "auto")
