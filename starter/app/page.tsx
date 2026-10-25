"use client"

// The control room. In the middle, the orders that need a person, each one
// saying what is wrong and how long is left. On the right, everything that is
// going to plan, so nobody has to wonder about it. Pick any order to see its
// timeline and, when the agent has a case on it, the case itself.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { laneLabel } from "@/lib/present/labels"
import { followUp, latestCases, needsAttention, splitQueue } from "@/lib/present/queue"
import type { BoardCard } from "@/lib/present/types"
import type { Overview } from "@/lib/present/types"
import { AppFrame } from "./components/app-frame"
import type { CaseSummary } from "./components/case-view"
import { Icon } from "./components/icons"
import { OrderFocus } from "./components/order-focus"
import { cardDeadline, QueueCard, WatchCard } from "./components/queue-cards"

type Demo = { orderId: string; title: string; open: boolean }
type Listing = { cases: CaseSummary[]; demos: Demo[]; snapshotAt: string | null }

export default function ControlRoom() {
  const [search, setSearch] = useState("")
  const [overview, setOverview] = useState<Overview | null>(null)
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [showList, setShowList] = useState(true)
  const [starting, setStarting] = useState<string | null>(null)
  // The On track panel can fold to a thin rail. It starts open every visit, and
  // its scroll position is kept across a fold, so reopening shows it as it was.
  const [watchOpen, setWatchOpen] = useState(true)
  const watchRef = useRef<HTMLElement>(null)
  const watchScroll = useRef(0)
  const toggleWatch = () => {
    if (watchOpen) watchScroll.current = watchRef.current?.scrollTop ?? 0
    setWatchOpen((open) => !open)
  }
  useEffect(() => {
    const panel = watchRef.current
    if (!watchOpen || !panel) return
    // Restore now, and again once the column has finished widening, because
    // the text rewraps while it grows and the browser nudges the scroll.
    const restore = () => { panel.scrollTop = watchScroll.current }
    restore()
    const timer = setTimeout(restore, 260)
    return () => clearTimeout(timer)
  }, [watchOpen])
  // Countdowns on the cards tick with the real clock.
  const [wall, setWall] = useState(() => Date.now())
  useEffect(() => { const timer = setInterval(() => setWall(Date.now()), 20_000); return () => clearInterval(timer) }, [])

  // The same orders and search as the board, so both pages agree.
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      fetch(`/api/overview?q=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error("Could not load the orders"); return response.json() as Promise<Overview> })
        .then((data) => { setOverview(data); setError("") })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load the orders") })
    }, search ? 180 : 0)
    return () => { clearTimeout(timer); controller.abort() }
  }, [search])

  const loadCases = useCallback(async () => {
    try {
      const response = await fetch("/api/cases", { cache: "no-store" })
      if (!response.ok) throw new Error("Could not load the agent's cases")
      setListing(await response.json() as Listing)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the agent's cases")
    }
  }, [])

  // Poll quickly while the agent is busy, slowly otherwise.
  const busy = listing?.cases.some((item) => item.status === "working") ?? false
  useEffect(() => {
    loadCases()
    const timer = setInterval(loadCases, busy ? 2000 : 8000)
    return () => clearInterval(timer)
  }, [loadCases, busy])

  const cases = useMemo(() => latestCases(listing?.cases ?? []), [listing])
  const { attention, monitored } = useMemo(() => splitQueue(overview?.visible ?? [], cases), [overview, cases])
  const snapshotAt = overview?.snapshotAt ?? listing?.snapshotAt ?? null
  // Every card seen so far, so the selected order keeps its context while a search hides it.
  const known = useRef(new Map<string, BoardCard>())
  for (const card of overview?.visible ?? []) known.current.set(card.id, card)
  const selectedCard = selected ? known.current.get(selected) ?? null : null
  const selectedCase = selected ? cases.get(selected) ?? null : null
  const problem = selectedCard && needsAttention(selectedCard, selectedCase)
    ? {
        title: (selectedCase?.status === "needs_person" ? selectedCase.headline : null) ?? selectedCard.attention[0]?.title ?? "Waiting for a decision",
        detail: selectedCard.attention[0]?.detail ?? null,
        more: Math.max(0, selectedCard.attention.length - 1),
        tone: selectedCard.attentionTone,
        deadline: cardDeadline(selectedCard, selectedCase, snapshotAt, wall),
      }
    : null

  // Start on the order in the address, or the most pressing one. Older links point at a case.
  useEffect(() => {
    if (selected || !overview || !listing) return
    const wanted = window.location.hash.replace(/^#/, "")
    const fromCase = listing.cases.find((item) => item.id === wanted)?.orderId
    const known = overview.visible.some((card) => card.id === wanted) ? wanted : fromCase
    setSelected(known ?? attention[0]?.id ?? monitored[0]?.id ?? null)
    if (known) setShowList(false)
  }, [selected, overview, listing, attention, monitored])

  const choose = (id: string) => {
    setSelected(id)
    setShowList(false)
    window.history.replaceState(null, "", `#${id}`)
  }

  const startDemo = async (orderId: string) => {
    setStarting(orderId)
    try {
      const response = await fetch("/api/cases", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId }) })
      if (!response.ok) throw new Error("Could not start the case")
      await loadCases()
      choose(orderId)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the case")
    } finally {
      setStarting(null)
    }
  }

  const followed = monitored.filter((card) => followUp(card)).length
  const waiting = [...cases.values()].filter((item) => item.status === "needs_person").length
  const lanes = [...new Set(monitored.map((card) => card.displayLane))]
  const loading = !overview && !error

  return <AppFrame section="desk" snapshotAt={snapshotAt}><main className={`control${showList ? "" : " reading"}${watchOpen ? "" : " watch-folded"}`}>
    <header className="control-head">
      <h1 className="sr-only">Control room</h1>
      <p className="control-sum">{overview
        ? <><span className="sum-alert"><b className="num">{attention.length}</b> need attention</span>{waiting ? <span><b className="num">{waiting}</b> waiting for your decision</span> : null}<span><b className="num">{monitored.length}</b> on track or done{followed ? `, ${followed} of them followed up by the team` : ""}</span>{search ? <span>matching “{search}”</span> : null}</>
        : "Loading the snapshot"}</p>
      <label className="search">
        <span className="sr-only">Search orders</span>
        <Icon name="search" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Reference, car, plate, customer or city" />
        {search && <button type="button" className="search-clear" onClick={() => setSearch("")} aria-label="Clear search"><Icon name="arrow" size={14} style={{ transform: "rotate(45deg)" }} /></button>}
      </label>
    </header>
    {error && <p className="board-error" role="alert">{error}. Check that the local database is running and seeded.</p>}

    <section className="control-queue" aria-labelledby="queue-title">
      <h2 className="control-col-title" id="queue-title">Needs attention<span className="num">{overview ? attention.length : ""}</span><small>Most urgent first</small></h2>
      {loading && <ul className="queue-list" aria-busy="true">{[0, 1, 2].map((index) => <li className="skeleton queue-skeleton" key={index} />)}</ul>}
      {overview && attention.length === 0 && <div className="desk-empty">
        <Icon name="check" size={18} />
        <p>{search ? <><b>No order that needs attention matches “{search}”.</b></> : <><b>Everything is currently on track.</b><br />When something goes wrong it shows up here with what is wrong and how long is left.</>}</p>
      </div>}
      {attention.length > 0 && <ul className="queue-list">{attention.map((card) => <li key={card.id}>
        <QueueCard card={card} agentCase={cases.get(card.id)} snapshotAt={snapshotAt} wall={wall} active={card.id === selected} onSelect={choose} />
      </li>)}</ul>}
      {listing && listing.demos.length > 0 && <footer className="desk-demos">
        <p>Start a demo case</p>
        <ul>{listing.demos.map((demo) => <li key={demo.orderId}>
          <button type="button" className="demo-button" onClick={() => startDemo(demo.orderId)} disabled={!!starting || demo.open}>
            <Icon name={demo.open ? "check" : "arrow"} size={13} />{demo.title}{demo.open && <small>open</small>}
          </button>
        </li>)}</ul>
      </footer>}
    </section>

    <section className="control-read" aria-label="Selected order">
      {selected
        ? <OrderFocus key={selected} orderId={selected} agentCase={selectedCase} problem={problem} snapshotAt={snapshotAt} onBack={() => setShowList(true)} onChange={loadCases} />
        : <p className="empty desk-read-empty">{overview ? "Choose an order to see its timeline." : "Loading…"}</p>}
    </section>

    <aside className="control-watch" ref={watchRef} aria-labelledby="watch-title">
      <h2 className="control-col-title" id="watch-title">
        <button type="button" className="watch-toggle" onClick={toggleWatch} aria-expanded={watchOpen} aria-controls="watch-body"
          aria-label={watchOpen ? "Collapse On track" : "Show On track"} title={watchOpen ? "Collapse On track" : "Show On track"}>
          <Icon name="chevron" size={13} />
        </button>
        <span className="watch-title-text">On track</span><span className="num">{overview ? monitored.length : ""}</span><small>Checked, nothing to do</small>
      </h2>
      {/* Folded, the list stays mounted but hidden, so nothing in it resets. */}
      <div className="control-watch-body" id="watch-body" hidden={!watchOpen}>
        {loading && <ul className="watch-list" aria-busy="true">{[0, 1, 2, 3].map((index) => <li className="skeleton watch-skeleton" key={index} />)}</ul>}
        {overview && monitored.length === 0 && <p className="lane-empty">{search ? `No monitored orders match “${search}”.` : "No orders are being monitored right now."}</p>}
        {lanes.map((lane) => <div className="watch-group" key={lane}>
          <h3 className="watch-group-title">{laneLabel(lane)}<span className="num">{monitored.filter((card) => card.displayLane === lane).length}</span></h3>
          <ul className="watch-list">{monitored.filter((card) => card.displayLane === lane).map((card) => <li key={card.id}>
            <WatchCard card={card} snapshotAt={snapshotAt} active={card.id === selected} onSelect={choose} />
          </li>)}</ul>
        </div>)}
      </div>
    </aside>
  </main></AppFrame>
}
