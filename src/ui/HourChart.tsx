import { useState } from 'react'
import type { ReactNode } from 'react'

/**
 * Money by hour, as bars with the evening's running total over them.
 *
 * Hand-drawn SVG rather than a charting library: the whole app is built to sit inside the
 * free Hosting transfer allowance, and a chart package would cost more bundle than every
 * screen here put together.
 *
 * Bars are each hour's takings; the line is the evening adding up. The line answers "are we
 * on track", the bars answer "when should we be out".
 */
export interface HourPoint {
  /** The whole hour, for readouts: "5:00 PM – 6:00 PM". */
  label: string
  /**
   * Just the start, for the axis: "5 PM".
   *
   * An axis tick has about one column of width. Putting the full range there — which is
   * what it used to do — meant "5:00 PM – 6:00 PM" in fifty pixels, so every label ran
   * into its neighbours no matter how they were angled.
   */
  axisLabel: string
  /** Shown once where the day changes, not under every bar. */
  dayLabel?: string
  revenue: number
}

const WIDTH = 760
const HEIGHT = 260
const PAD = { top: 22, right: 56, bottom: 52, left: 56 }

/** Rounded, for axis ticks where the exact figure would not fit. */
const short = (n: number): string =>
  n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n)}`

/** To the cent, for anything somebody is reading a number off. */
const exact = (n: number): string =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD' })

export function HourChart({ points }: { points: HourPoint[] }): ReactNode {
  const [hovered, setHovered] = useState<number | null>(null)

  if (points.length === 0) {
    return <p className="muted">No hours to chart yet.</p>
  }

  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom

  const cumulative: number[] = []
  let running = 0
  for (const p of points) {
    running += p.revenue
    cumulative.push(running)
  }

  // Both series share the axis, so the bars stay readable beside a line that only climbs.
  // Guarded so an event that has taken nothing still draws an axis.
  const peak = Math.max(running, ...points.map((p) => p.revenue), 1)
  const band = plotW / points.length
  const barW = Math.max(6, band * 0.6)

  const y = (value: number): number => PAD.top + plotH - (value / peak) * plotH
  const x = (i: number): number => PAD.left + band * i + band / 2

  const line = cumulative.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ')
  const ticks = [0, peak / 2, peak]

  /*
    Slant the labels only when they genuinely do not fit.

    Measured rather than guessed at a column count: eleven hours over two days leaves about
    fifty-nine pixels each, which is plenty for "5 PM" and nowhere near enough for a full
    range. Roughly 6.2px per character at this font size, and a few pixels of breathing room
    between neighbours.
  */
  const widest = Math.max(...points.map((p) => p.axisLabel.length)) * 6.2
  const slanted = widest > band - 8
  const axisY = HEIGHT - PAD.bottom + 16

  /** Where each day starts, so the day is named once instead of under every bar. */
  const dayStarts = new Set(
    points
      .map((p, i) => (i === 0 || points[i - 1]!.dayLabel !== p.dayLabel ? i : -1))
      .filter((i) => i >= 0),
  )

  const active = hovered !== null ? points[hovered] : null

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Revenue by hour. Total ${exact(running)} across ${points.length} hour${
          points.length === 1 ? '' : 's'
        }.`}
        preserveAspectRatio="xMidYMid meet"
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={y(t)}
              y2={y(t)}
              className="chart-grid"
            />
            <text x={PAD.left - 8} y={y(t) + 4} className="chart-axis" textAnchor="end">
              {short(t)}
            </text>
          </g>
        ))}

        {points.map((p, i) => {
          const barH = Math.max(0, PAD.top + plotH - y(p.revenue))
          const isActive = hovered === i
          return (
            <g key={`${p.dayLabel ?? ''}-${p.label}`}>
              {/* A full-height target, so the hour is hoverable even when its bar is short
                  or empty — an hour that took nothing is exactly the one worth asking about. */}
              <rect
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={plotH}
                className="chart-hit"
                onMouseEnter={() => setHovered(i)}
                onFocus={() => setHovered(i)}
                onBlur={() => setHovered(null)}
                tabIndex={0}
                role="button"
                aria-label={`${p.dayLabel ? `${p.dayLabel} ` : ''}${p.label}: ${exact(
                  p.revenue,
                )}, running total ${exact(cumulative[i]!)}`}
              />
              <rect
                x={x(i) - barW / 2}
                y={y(p.revenue)}
                width={barW}
                height={barH}
                className={`chart-bar${isActive ? ' is-active' : ''}`}
                pointerEvents="none"
              />
              {isActive && (
                // The exact figure, on the chart, where the pointer already is.
                <text
                  x={x(i)}
                  y={Math.max(PAD.top - 6, y(p.revenue) - 8)}
                  className="chart-value"
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {exact(p.revenue)}
                </text>
              )}
              <text
                x={x(i)}
                y={axisY}
                className={`chart-axis${isActive ? ' is-active' : ''}`}
                textAnchor={slanted ? 'end' : 'middle'}
                transform={slanted ? `rotate(-40 ${x(i)} ${axisY})` : undefined}
                pointerEvents="none"
              >
                {p.axisLabel}
              </text>
              {p.dayLabel && dayStarts.has(i) && (
                <>
                  {/* Named once, where the day changes. Repeating "Friday" under all four
                      Friday bars was half the crowding. */}
                  <text
                    x={PAD.left + band * i + 2}
                    y={axisY + (slanted ? 26 : 15)}
                    className="chart-axis chart-axis-dim"
                    textAnchor="start"
                    pointerEvents="none"
                  >
                    {p.dayLabel}
                  </text>
                  {i > 0 && (
                    <line
                      x1={PAD.left + band * i}
                      x2={PAD.left + band * i}
                      y1={PAD.top}
                      y2={PAD.top + plotH}
                      className="chart-divider"
                    />
                  )}
                </>
              )}
            </g>
          )
        })}

        <path d={line} className="chart-line" fill="none" pointerEvents="none" />
        {cumulative.map((v, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(v)}
            r={hovered === i ? 5 : 3}
            className="chart-dot"
            pointerEvents="none"
          />
        ))}

        {/* The total, drawn on the chart rather than only in the caption. */}
        <text
          x={WIDTH - PAD.right + 6}
          y={y(running) + 4}
          className="chart-total"
          pointerEvents="none"
        >
          {short(running)}
        </text>
      </svg>

      <p className="small" style={{ margin: '0.2rem 0 0' }} aria-live="polite">
        {active ? (
          <>
            <strong>
              {active.dayLabel ? `${active.dayLabel} ` : ''}
              {active.label}
            </strong>{' '}
            took <strong>{exact(active.revenue)}</strong> · running total{' '}
            {exact(cumulative[hovered!]!)}
          </>
        ) : (
          <span className="muted">
            Bars are each hour’s takings; the line is the running total, ending at{' '}
            <strong>{exact(running)}</strong>. Hover an hour for its exact figure.
          </span>
        )}
      </p>
    </div>
  )
}
