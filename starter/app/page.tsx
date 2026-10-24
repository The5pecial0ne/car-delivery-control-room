"use client"

// The desk: the cases that need a person, and nothing else in the way. The
// agent works every case first. What lands here has already been looked into,
// with one decision waiting.

import { useCallback, useEffect, useMemo, useState } from "react"
import { relativeTo } from "@/lib/present/time"
import { AppFrame } from "./components/app-frame"
import { CaseView, type CaseSummary } from "./components/case-view"
import { Icon } from "./components/icons"

type Demo = { orderId: string; title: string; open: boolean }
type Listing = { cases: CaseSummary[]; demos: Demo[] }

const GROUPS: { key: string; title: string; note: string; statuses: CaseSummary["status"][] }[] = [
  { key: "you", title: "Waiting for you", note: "One decision each", statuses: ["needs_person", "failed"] },
  { key: "agent", title: "Agent is on it", note: "Looking things up and asking", statuses: ["working"] },
  { key: "done", title: "Handled without you", note: "Closed by the agent or after your decision", statuses: ["resolved"] },
]

export default function Desk() {
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<string | null>(null)
  const [showList, setShowList] = useState(true)
  const [starting, setStarting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/cases", { cache: "no-store" })
      if (!response.ok) throw new Error("Could not load the cases")
      const data = await response.json() as Listing
      setListing(data)
      setError("")
      setSelected((current) => {
        if (current && data.cases.some((item) => item.id === current)) return current
        const wanted = window.location.hash.replace(/^#/, "")
        return data.cases.find((item) => item.id === wanted)?.id ?? data.cases.find((item) => item.status === "needs_person")?.id ?? data.cases[0]?.id ?? null
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the cases")
    }
  }, [])

  // Poll quickly while the agent is busy, slowly otherwise.
  const busy = listing?.cases.some((item) => item.status === "working") ?? false
  useEffect(() => {
    load()
    const timer = setInterval(load, busy ? 2000 : 8000)
    return () => clearInterval(timer)
  }, [load, busy])

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
      const { id } = await response.json() as { id: string }
      await load()
      choose(id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the case")
    } finally {
      setStarting(null)
    }
  }

  const cases = listing?.cases ?? []
  const waiting = cases.filter((item) => item.status === "needs_person" || item.status === "failed").length
  const working = cases.filter((item) => item.status === "working").length
  const current = useMemo(() => cases.find((item) => item.id === selected) ?? null, [cases, selected])

  return <AppFrame section="desk"><main className={`desk${showList ? "" : " reading"}`}>
    <section className="desk-list" aria-label="Cases">
      <header className="desk-list-head">
        <h1>Needs you</h1>
        <p>{listing
          ? waiting ? <><b>{waiting}</b> waiting for a decision{working ? <> · the agent is working on <b>{working}</b></> : null}</> : working ? <>Nothing yet · the agent is working on <b>{working}</b></> : "Nothing needs you right now"
          : "Loading"}</p>
      </header>
      {error && <p className="board-error" role="alert">{error}. Check that the local database is running.</p>}
      {!listing && !error && <ul className="desk-rows" aria-busy="true">{[0, 1, 2].map((index) => <li className="skeleton desk-skeleton" key={index} />)}</ul>}
      {listing && GROUPS.map((group) => {
        const rows = cases.filter((item) => group.statuses.includes(item.status))
        if (!rows.length) return null
        return <div className={`desk-group desk-group-${group.key}`} key={group.key}>
          <h2 className="desk-group-title">{group.title}<span className="num">{rows.length}</span></h2>
          <ul className="desk-rows">{rows.map((item) => <li key={item.id}>
            <button type="button" className={`desk-row status-${item.status}${item.id === selected ? " active" : ""}`} onClick={() => choose(item.id)} aria-current={item.id === selected ? "true" : undefined}>
              <span className="desk-row-top">
                <span className="desk-row-ref mono">{item.order?.reference ?? item.orderId}</span>
                <span className="desk-row-car">{item.order?.car}</span>
                <span className="desk-row-when">{relativeTo(item.updatedAt, new Date().toISOString())?.text}</span>
              </span>
              <span className="desk-row-headline">{item.status === "working" ? <><span className="pulse" aria-hidden="true" />{item.headline ?? item.trigger}</> : item.headline ?? item.trigger}</span>
            </button>
          </li>)}</ul>
        </div>
      })}
      {listing && !cases.length && <div className="desk-empty">
        <Icon name="check" size={18} />
        <p><b>Nothing needs you right now.</b><br />When the agent finds something it cannot settle on its own, it lands here with one decision.</p>
      </div>}
      {listing && listing.demos.length > 0 && <footer className="desk-demos">
        <p>Start a demo case</p>
        <ul>{listing.demos.map((demo) => <li key={demo.orderId}>
          <button type="button" className="demo-button" onClick={() => startDemo(demo.orderId)} disabled={!!starting || demo.open}>
            <Icon name={demo.open ? "check" : "arrow"} size={13} />{demo.title}{demo.open && <small>open</small>}
          </button>
        </li>)}</ul>
      </footer>}
    </section>
    <section className="desk-read" aria-label="Case">
      {current
        ? <CaseView key={current.id} summary={current} onBack={() => setShowList(true)} onChange={load} />
        : <p className="empty desk-read-empty">{listing ? cases.length ? "Choose a case." : "Start a demo case to see the agent work." : "Loading…"}</p>}
    </section>
  </main></AppFrame>
}
