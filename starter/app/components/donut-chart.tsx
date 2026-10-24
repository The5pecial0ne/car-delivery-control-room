"use client"

// A small donut chart in plain SVG. Every segment is a button: hover or focus
// shows its name, count and share. A click or Enter selects only that segment;
// Shift-click or Shift+Enter adds it to the selection or takes it out. The
// legend lists the same numbers in words, with a checkbox per row, so several
// groups can be picked on a touch screen too and nothing depends on colour.

import { useId, useState } from "react"

export type Segment = { key: string; label: string; count: number; color: string; hatched?: boolean }

const SIZE = 240
const RADIUS = 100
const WIDTH = 34
// A thin surface-coloured gap between segments, in degrees.
const GAP = 1.6

const percent = (count: number, total: number) => (total ? Math.round((count / total) * 1000) / 10 : 0)
export const shareText = (count: number, total: number) => `${percent(count, total).toLocaleString("en-GB")}%`

function point(angle: number, radius: number) {
  const radians = ((angle - 90) * Math.PI) / 180
  return [SIZE / 2 + radius * Math.cos(radians), SIZE / 2 + radius * Math.sin(radians)]
}

/** One ring segment from start to end, in degrees clockwise from the top. */
function arc(start: number, end: number, outer: number, inner: number) {
  const large = end - start > 180 ? 1 : 0
  const [x1, y1] = point(start, outer)
  const [x2, y2] = point(end, outer)
  const [x3, y3] = point(end, inner)
  const [x4, y4] = point(start, inner)
  return `M ${x1} ${y1} A ${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`
}

export function DonutChart({ segments, selected, onSelect, label }: {
  segments: Segment[]; selected: string[]; onSelect: (keys: string[]) => void; label: string
}) {
  const picked = new Set(selected)
  // A plain click picks just this one (or clears it if it was the only one); Shift adds or removes it.
  const press = (key: string, add: boolean) => {
    if (add) onSelect(picked.has(key) ? selected.filter((item) => item !== key) : [...selected, key])
    else onSelect(picked.has(key) && selected.length === 1 ? [] : [key])
  }
  const toggle = (key: string) => press(key, true)
  const id = useId()
  const [hover, setHover] = useState<string | null>(null)
  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  const shown = segments.filter((segment) => segment.count > 0)

  let angle = 0
  const arcs = shown.map((segment) => {
    const sweep = (segment.count / total) * 360
    const start = angle
    angle += sweep
    const gap = shown.length > 1 ? Math.min(GAP, sweep / 3) : 0
    const end = shown.length > 1 ? angle - gap : angle - 0.01
    return { segment, start, end, middle: start + sweep / 2 }
  })

  const single = hover ?? (selected.length === 1 ? selected[0] : null)
  const focus = segments.find((segment) => segment.key === single) ?? null
  const pickedCount = segments.filter((segment) => picked.has(segment.key)).reduce((sum, segment) => sum + segment.count, 0)
  const tip = hover ? arcs.find((item) => item.segment.key === hover) : null
  const [tipX, tipY] = tip ? point(tip.middle, RADIUS + 6) : [0, 0]

  return <div className="donut">
    <div className="donut-figure">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="group" aria-label={label} onMouseLeave={() => setHover(null)}>
        <defs>
          <pattern id={`${id}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--donut-hatch-bg)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--donut-hatch)" strokeWidth="2.5" />
          </pattern>
        </defs>
        {total === 0 && <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS - WIDTH / 2} fill="none" stroke="var(--hair)" strokeWidth={WIDTH} />}
        {arcs.map(({ segment, start, end, middle }) => {
          const on = picked.has(segment.key)
          // The selected segment steps out a little, so it reads as picked even without colour.
          const [dx, dy] = on ? point(middle, 6).map((value) => value - SIZE / 2) : [0, 0]
          return <path key={segment.key} d={arc(start, end, RADIUS, RADIUS - WIDTH)}
            className={`donut-seg${on ? " is-on" : ""}${selected.length && !on ? " is-dim" : ""}`}
            fill={segment.hatched ? `url(#${id}-hatch)` : segment.color} transform={`translate(${dx} ${dy})`}
            role="button" tabIndex={0} aria-pressed={on}
            aria-label={`${segment.label}: ${segment.count} order${segment.count === 1 ? "" : "s"}, ${shareText(segment.count, total)}`}
            onMouseEnter={() => setHover(segment.key)} onFocus={() => setHover(segment.key)} onBlur={() => setHover(null)}
            onClick={(event) => press(segment.key, event.shiftKey)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); press(segment.key, event.shiftKey) } }} />
        })}
      </svg>
      <div className="donut-center" aria-hidden="true">
        <b className="num">{focus ? focus.count : selected.length > 1 ? pickedCount : total}</b>
        <span>{focus ? focus.label : selected.length > 1 ? `in ${selected.length} groups` : "orders"}</span>
        {focus && <small className="num">{shareText(focus.count, total)} of all</small>}
        {!focus && selected.length > 1 && <small className="num">{shareText(pickedCount, total)} of all</small>}
      </div>
      {tip && <div className="donut-tip" role="tooltip" style={{ left: `${(tipX / SIZE) * 100}%`, top: `${(tipY / SIZE) * 100}%` }}>
        <b>{tip.segment.label}</b>
        <span className="num">{tip.segment.count} order{tip.segment.count === 1 ? "" : "s"} · {shareText(tip.segment.count, total)}</span>
      </div>}
    </div>
    <ul className="donut-legend" aria-label={`${label}, as a list. Tick several to compare them.`}>
      {segments.map((segment) => {
        const on = picked.has(segment.key)
        return <li key={segment.key} className={`${on ? "is-on" : ""}${segment.count === 0 ? " is-empty" : ""}`}
          onMouseEnter={() => setHover(segment.count ? segment.key : null)} onMouseLeave={() => setHover(null)}>
          <label>
            <input type="checkbox" checked={on} disabled={segment.count === 0} onChange={() => toggle(segment.key)} />
            <span className={`donut-swatch${segment.hatched ? " is-hatched" : ""}`} style={{ background: segment.hatched ? undefined : segment.color }} aria-hidden="true" />
            <span className="donut-legend-label">{segment.label}</span>
            <span className="donut-legend-count num">{segment.count}</span>
            <span className="donut-legend-share num">{shareText(segment.count, total)}</span>
          </label>
        </li>
      })}
    </ul>
  </div>
}
