import { ACTIONS, isActionKind } from "./policy"

export const actionLabel = (kind: unknown) => isActionKind(kind) ? ACTIONS[kind].label : "Something else"

export const isPersonLed = (kind: unknown) => !isActionKind(kind) || ACTIONS[kind].who === "person"

const SOURCE_NAMES: Record<string, string> = {
  agent_steps: "Asked in this case",
  messages: "Message",
  alerts: "Alert",
  incidents: "Incident",
  agent_proposals: "Earlier agent proposal",
  orders: "Order",
  customers: "Customer",
  vehicles: "Car",
  drivers: "Driver profile",
  addresses: "Address",
  time_windows: "Time window",
  tracking_observations: "Driver app position",
  work_assignments: "Driver booking",
  travel_options: "Travel quote",
  travel_reservations: "Travel booking",
  travel_confirmations: "Travel confirmation",
  transport_plans: "Route plan",
  transport_segments: "Route leg",
  documents: "Document",
  expenses: "Expense",
  proofs: "Proof",
  order_endpoint_details: "Pickup or delivery details",
  endpoint_claims: "Statement about a place",
  operational_events: "Event",
  simulated: "Quote (simulated)",
}

export type SourceRef = { table: string; id: string; label: string }

export function parseSource(ref: string): SourceRef {
  const [table, ...rest] = ref.split("/")
  const id = rest.join("/") || table
  return { table, id, label: SOURCE_NAMES[table] ?? table.replaceAll("_", " ") }
}

export type Certainty = "confirmed" | "quoted" | "uncertain"
export type OptionScores = { arrives_at?: string; cost_eur?: number; certainty?: Certainty }
export type Option = OptionScores & { action?: string; summary?: string }
export type Deadline = { at: string; what: string; miss?: string; zone?: string; sources?: string[] }
export type PlanB = OptionScores & { trigger?: string; summary?: string; steps?: string[]; action?: string; sources?: string[] }

export const CERTAINTY_LABEL: Record<Certainty, string> = { confirmed: "Confirmed", quoted: "Quoted", uncertain: "Uncertain" }

export type Decision = {
  headline?: string
  situation?: string
  facts?: { text: string; sources?: string[] }[]
  unknowns?: string[]
  recommendation?: Option & { customer_message_draft?: string }
  alternatives?: Option[]
  deadlines?: Deadline[]
  plan_b?: PlanB
  impact?: string
  urgency?: "now" | "today" | "can_wait"
}

export const URGENCY: Record<string, { label: string; tone: "danger" | "warn" | "neutral" }> = {
  now: { label: "Now", tone: "danger" },
  today: { label: "Today", tone: "warn" },
  can_wait: { label: "Can wait", tone: "neutral" },
}
