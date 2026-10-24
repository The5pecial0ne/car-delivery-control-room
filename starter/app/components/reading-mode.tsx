"use client"

// Easy reading: a calmer type setting for people with dyslexia, or anyone at
// the end of a long shift. OpenDyslexic, more space between letters, words and
// lines, no italics, and no text cut off with "…". Remembered per browser.

import { useEffect, useState } from "react"

const KEY = "reading-mode"

// Runs before the first paint, so the page does not flash in the other style.
export const READING_MODE_SCRIPT = `try{if(localStorage.getItem("${KEY}")==="easy")document.documentElement.dataset.reading="easy"}catch(e){}`

export function ReadingModeToggle() {
  const [easy, setEasy] = useState(false)
  useEffect(() => { setEasy(document.documentElement.dataset.reading === "easy") }, [])
  const toggle = () => {
    const next = !easy
    setEasy(next)
    if (next) document.documentElement.dataset.reading = "easy"
    else delete document.documentElement.dataset.reading
    try { localStorage.setItem(KEY, next ? "easy" : "normal") } catch { /* private window */ }
  }
  return <button type="button" className={`reading-toggle${easy ? " on" : ""}`} role="switch" aria-checked={easy} onClick={toggle}>
    <span className="reading-switch" aria-hidden="true" />Easy reading
  </button>
}
