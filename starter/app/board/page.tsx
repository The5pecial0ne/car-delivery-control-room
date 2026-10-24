"use client"

// All orders, at a glance: one donut of where every order stands, by the
// board's own lanes. Pick a lane to list just those orders in compact rows,
// or several (Shift-click, or the legend's checkboxes) to compare them; each
// row opens the order record as before.
// Search and "Needs a person" narrow the chart and the list together.

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { LANES, laneLabel } from "@/lib/present/labels"
import type { BoardCard, Overview } from "@/lib/present/types"
import { AppFrame } from "../components/app-frame"
import { DonutChart, type Segment } from "../components/donut-chart"
import { Icon } from "../components/icons"

// One colour per lane, in pipeline order. Checked with the data-viz palette
// validator: neighbours stay apart for colour-blind readers, and Cancelled is
// a hatched grey on purpose, because it is out of play.
const LANE_COLOR: Record<string, string> = {
  intake: "#8a78dc", ready: "#d8703a", market: "#a34c72", booked: "#5f93d8", moving: "#2d4f97", delivered: "#1f9a63", cancelled: "#b3ada2",
}
const STORE = "board-lanes"

export default function Orders() {
  const [search, setSearch] = useState("")
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [error, setError] = useState("")
  const [picked, setPicked] = useState<string[]>([])

  // Coming back from an order keeps the lanes that were open.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as unknown
      if (Array.isArray(saved)) setPicked(saved.filter((key): key is string => LANES.some(([lane]) => lane === key)))
    } catch { /* private window, or an older saved value */ }
  }, [])
  const choose = (next: string[]) => {
    setPicked(next)
    try { if (next.length) sessionStorage.setItem(STORE, JSON.stringify(next)); else sessionStorage.removeItem(STORE) } catch { /* private window */ }
  }

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/overview?q=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error("Could not load orders"); return response.json() as Promise<Overview> })
        .then((data) => { setOverview(data); setError("") })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load orders") })
    }, search ? 180 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [search])

  const visible = useMemo(() => {
    const cards = overview?.visible ?? []
    return onlyAttention ? cards.filter((card) => card.attention.length > 0) : cards
  }, [overview, onlyAttention])
  const attentionTotal = overview ? Object.values(overview.attentionCounts).reduce((sum, count) => sum + count, 0) : 0
  const filtering = !!search || onlyAttention

  // Without a filter the counts are the snapshot's own; with one, they are what the filter leaves.
  const segments: Segment[] = LANES.map(([key, label]) => ({
    key, label, color: LANE_COLOR[key] ?? "var(--sand)", hatched: key === "cancelled",
    count: filtering ? visible.filter((card) => card.displayLane === key).length : overview?.counts[key] ?? 0,
  }))
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  const rank = (card: BoardCard) => LANES.findIndex(([key]) => key === card.displayLane)
  // Lanes in pipeline order, whatever order they were picked in. An order has one lane, and the id check keeps any repeat out.
  const lanes: string[] = LANES.map(([key]) => key).filter((key) => picked.includes(key))
  const chosen = new Set<string>(lanes)
  const seen = new Set<string>()
  const rows = visible.filter((card) => (!chosen.size || chosen.has(card.displayLane)) && !seen.has(card.id) && seen.add(card.id))
    .sort((a, b) => rank(a) - rank(b))
  const listTitle = !lanes.length ? filtering ? "Matching orders" : "All orders"
    : lanes.length <= 3 ? lanes.map(laneLabel).join(" + ") : `${lanes.length} selected categories`

  return <AppFrame section="board" snapshotAt={overview?.snapshotAt ?? null}><main className="orders-page">
    <header className="orders-head">
      <div>
        <h1>Orders</h1>
        <p className="board-sub">{overview
          ? <><b>{overview.total}</b> orders · <b>{overview.counts.moving ?? 0}</b> moving · <b>{attentionTotal}</b> need a person</>
          : "Loading the snapshot"}</p>
      </div>
      <div className="board-tools">
        <label className="search">
          <span className="sr-only">Search orders</span>
          <Icon name="search" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, car, plate, customer or city" />
          {search && <button type="button" className="search-clear" onClick={() => setSearch("")} aria-label="Clear search"><Icon name="arrow" size={14} style={{ transform: "rotate(45deg)" }} /></button>}
        </label>
        <button type="button" className="toggle" aria-pressed={onlyAttention} onClick={() => setOnlyAttention((value) => !value)}>
          <Icon name="alert" size={14} /> Needs a person{overview ? <b>{attentionTotal}</b> : null}
        </button>
      </div>
    </header>
    {error && <p className="board-error" role="alert">{error}. Check that the local database is running and seeded.</p>}

    <div className="orders-body">
      <section className="orders-chart" aria-label="Orders by status">
        <header className="orders-chart-head">
          <h2 className="orders-sec-title">All orders overview{filtering && <small> · {total} after filters</small>}</h2>
          <button type="button" className="btn small" onClick={() => choose([])} disabled={!lanes.length}>Show all orders</button>
        </header>
        {!overview && !error && <div className="skeleton orders-chart-skeleton" aria-busy="true" />}
        {overview && <DonutChart segments={segments} selected={lanes} onSelect={choose} label="Orders by status" />}
        {overview && <p className="orders-chart-hint">Tip: Shift-click categories to compare multiple groups, or tick them in the list.</p>}
      </section>

      <section className="orders-list" aria-label={listTitle} aria-live="polite">
        <header className="orders-list-head">
          <h2>{lanes.length > 0 && lanes.length <= 3 && <span className="orders-list-swatches" aria-hidden="true">{lanes.map((key) => <span key={key} className={`donut-swatch${key === "cancelled" ? " is-hatched" : ""}`} style={{ background: key === "cancelled" ? undefined : LANE_COLOR[key] }} />)}</span>}
            {listTitle} <span className="num">— {rows.length} order{rows.length === 1 ? "" : "s"}</span></h2>
        </header>
        {!overview && !error && <ul className="order-rows" aria-busy="true">{[0, 1, 2, 3].map((index) => <li className="skeleton order-row-skeleton" key={index} />)}</ul>}
        {overview && rows.length === 0 && <p className="orders-empty">{search ? <>No orders match “{search}”{lanes.length ? ` in ${lanes.map(laneLabel).join(" or ").toLowerCase()}` : ""}.</> : "No orders here."}</p>}
        {rows.length > 0 && <ul className="order-rows">{rows.map((card) => <li key={card.id}><OrderRow card={card} showLane={lanes.length !== 1} /></li>)}</ul>}
      </section>
    </div>
  </main></AppFrame>
}

function OrderRow({ card, showLane }: { card: BoardCard; showLane: boolean }) {
  const needs = card.attention.length > 0
  return <Link className="order-row" href={`/orders/${card.id}`} aria-label={`${card.vehicle}, ${card.from.city} to ${card.to.city}, ${card.reference}, ${laneLabel(card.displayLane)}${needs ? ", needs a person" : ""}`}>
    <span className="order-row-main">
      <b>{card.vehicle}</b>
      <span className="order-row-route">{card.from.city}<Icon name="arrow" size={11} />{card.to.city}</span>
    </span>
    <span className="order-row-meta">
      <span className="mono">{card.reference}</span>
      {showLane && <span className="order-row-lane"><span className={`donut-swatch${card.displayLane === "cancelled" ? " is-hatched" : ""}`} style={{ background: card.displayLane === "cancelled" ? undefined : LANE_COLOR[card.displayLane] }} aria-hidden="true" />{laneLabel(card.displayLane)}</span>}
      {needs && <span className="order-row-flag"><Icon name="alert" size={12} />Needs a person</span>}
    </span>
    <Icon name="chevron" size={13} />
  </Link>
}
