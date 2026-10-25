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
  withdraw_change_request: { label: "Withdraw an unconfirmed travel change request", autonomy: "auto", who: "agent" },
  other: { label: "Something else", autonomy: "needs_approval", who: "person" },
} as const satisfies Record<string, { label: string; autonomy: Autonomy; who: "agent" | "person" }>

export type ActionKind = keyof typeof ACTIONS
export const ACTION_KINDS = Object.keys(ACTIONS) as ActionKind[]
export const isActionKind = (value: unknown): value is ActionKind => typeof value === "string" && value in ACTIONS
export const AUTO_ACTIONS = ACTION_KINDS.filter((kind) => ACTIONS[kind].autonomy === "auto")
