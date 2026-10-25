import { ACTIONS, isActionKind } from "./policy"
import type { Certainty, Option } from "./labels"

export type Priority = "speed" | "cost" | "certainty"

export const PRIORITIES: { key: Priority; label: string; tradeOff: string }[] = [
  { key: "speed", label: "Speed", tradeOff: "Protect the delivery promise where possible, even if recovery costs more." },
  { key: "cost", label: "Cost", tradeOff: "Avoid unnecessary ferry, hotel or driver cost, even if it risks a delay." },
  { key: "certainty", label: "Certainty", tradeOff: "Wait for verified information rather than act on an unconfirmed claim." },
]

export const isPriority = (value: unknown): value is Priority => value === "speed" || value === "cost" || value === "certainty"

const SURE: Record<Certainty, number> = { confirmed: 0, quoted: 1, uncertain: 2 }

function score(option: Option, priority: Priority): number[] {
  const time = option.arrives_at ? new Date(option.arrives_at).getTime() : Infinity
  const cost = option.cost_eur ?? Infinity
  const sure = option.certainty ? SURE[option.certainty] : 3
  if (priority === "speed") return [time, sure, cost]
  if (priority === "cost") return [cost, sure, time]
  return [sure, time, cost]
}

function compare(a: number[], b: number[]): number {
  const index = a.findIndex((value, at) => value !== b[at])
  return index === -1 ? 0 : a[index] < b[index] ? -1 : 1
}

export function rankOptions<T extends { option: Option }>(options: T[], priority: Priority): T[] {
  return [...options].sort((a, b) => compare(score(a.option, priority), score(b.option, priority)))
}

const hours = (ms: number) => {
  const value = Math.round(ms / 360_000) / 10
  if (value < 24) return `${value} h`
  const days = Math.round(value / 24 * 10) / 10
  return `${days} day${days === 1 ? "" : "s"}`
}
const euro = (value: number) => value.toLocaleString("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })

const CERTAIN_WHY: Record<Certainty, string> = {
  confirmed: "It rests only on facts someone who knows has confirmed.",
  quoted: "It rests on quotes that are real but not booked yet.",
  uncertain: "It depends on something nobody has confirmed yet.",
}

export function whyFor(option: Option, all: Option[], priority: Priority, best: boolean): string {
  if (priority === "speed") {
    const times = all.map((item) => item.arrives_at ? new Date(item.arrives_at).getTime() : null).filter((value): value is number => value != null)
    const mine = option.arrives_at ? new Date(option.arrives_at).getTime() : null
    if (mine == null) return "No arrival time could be worked out for this one, so it cannot compete on speed."
    const fastest = Math.min(...times)
    return best || mine === fastest ? "The fastest way to the buyer of the options on the table." : `Gets there ${hours(mine - fastest)} later than the fastest option.`
  }
  if (priority === "cost") {
    const costs = all.map((item) => item.cost_eur).filter((value): value is number => value != null)
    if (option.cost_eur == null) return "There is no cost estimate for this one, so it cannot compete on cost."
    const cheapest = Math.min(...costs)
    if (best || option.cost_eur === cheapest) return option.cost_eur === 0 ? "Costs nothing extra." : `The cheapest option, about ${euro(option.cost_eur)} extra.`
    return `About ${euro(option.cost_eur - cheapest)} more than the cheapest option.`
  }
  return option.certainty ? `${best ? "The most certain option. " : ""}${CERTAIN_WHY[option.certainty]}` : "Nobody has said how certain this one is."
}

export function needsApproval(action: unknown): boolean {
  return !isActionKind(action) || ACTIONS[action].autonomy !== "auto"
}
