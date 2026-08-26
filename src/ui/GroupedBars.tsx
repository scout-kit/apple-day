import { useState } from 'react'
import type { ReactNode } from 'react'

/**
 * One bar per series, grouped along a shared axis.
 *
 * Built for the hour-by-hour comparison: the groups are clock hours and the series are
 * events, so each cluster of bars is one hour of the evening seen across every year. A table
 * of two hundred rows carried the same numbers and nobody could see a shape in it.
 *
 * Hand-drawn SVG, like the other chart here, because a charting library would cost more
 * bundle than every screen in the app put together.
 */
export interface BarGroup {
  label: string
  /** A second line under the label, for the day a group belongs to. */
  sub?: string
  /** One value per series, in the same order. Null draws nothing — see below. */
  values: (number | null)[]
  /**
   * Each series' bar broken into bands, drawn stacked, in `bands` order.
   *
   * For a bar that is made of parts: an hour's takings across several shops. Stacking is
   * only honest when the parts add up to the whole — years never do, so this stacks the
   * locations within a year rather than the years within an hour.
   *
   * Absent means a plain bar.
   */
  stacks?: (number | null)[][]
}

export interface BarSeries {
  label: string
  /**
   * Something stable to key on, when the labels are not.
   *
   * Two events can fall in the same year — a rehearsal beside the real thing — and both
   * series then read "2026". React warned about the duplicate key; the deeper point is that
   * a legend must not depend on the caller's labels being unique.
   */
  id?: string
}

const WIDTH = 860
const HEIGHT = 300
const PAD = { top: 18, right: 16, bottom: 62, left: 58 }

/** Five is more events than this group is likely to compare at once. */
const COLOURS = ['var(--accent)', 'var(--blue)', 'var(--purple)', 'var(--good)', 'var(--warn)']

export function GroupedBars({
  groups,
  series,
  bands,
  format,
  emptyNote = 'Nothing to chart yet.',
}: {
  groups: BarGroup[]
  series: BarSeries[]
  /**
   * What the bands of a stacked bar are, when the groups carry `stacks`.
   *
   * These take the colours, because they are what a reader is telling apart. The series
   * are then told apart by position within the cluster and named on hover — with three
   * shops across two years, colour says which shop and place says which year.
   */
  bands?: BarSeries[]
  /** How to write a value out — currency, hours, whatever the caller is measuring. */
  format: (value: number) => string
  emptyNote?: string
}): ReactNode {
  const [hovered, setHovered] = useState<
    { group: number; series: number; band?: number } | null
  >(null)
  /*
    A legend entry being pointed at, by index into whatever carries the colour.

    Following the colour across the whole chart is the thing a legend is for and the thing
    it cannot do on its own: with three shops in every bar, finding Braemar means matching a
    swatch against a dozen bands by eye. Pointing at the name lights all of them at once.
  */
  const [spotlit, setSpotlit] = useState<number | null>(null)

  if (groups.length === 0 || series.length === 0) {
    return <p className="muted">{emptyNote}</p>
  }

  const plotW = WIDTH - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom

  // The tallest thing drawn, which for a stacked bar is the stack and not any one band.
  const values = groups.flatMap((g) => g.values.filter((v): v is number => v !== null))
  const peak = Math.max(1, ...values)
  const band = plotW / groups.length
  // A sliver of space between clusters, so it reads as groups rather than one long row.
  const barW = Math.max(2, (band * 0.78) / series.length)

  const y = (value: number): number => PAD.top + plotH - (value / peak) * plotH
  const groupLeft = (i: number): number => PAD.left + band * i + band * 0.11
  const ticks = [0, peak / 2, peak]

  const active = (() => {
    if (!hovered) return null
    const group = groups[hovered.group]
    const line = series[hovered.series]
    if (!group || !line || hovered.series >= group.values.length) return null

    /*
      A band if the pointer is on one, the whole bar otherwise.

      Reading a stack is asking how much of it is which shop, so the answer has to be that
      shop's figure and its name — the total is what the bar's height already says.
    */
    if (hovered.band !== undefined && group.stacks) {
      const band = bands?.[hovered.band]
      const value = group.stacks[hovered.series]?.[hovered.band] ?? null
      if (band) {
        /*
          The whole bar's figure comes with the band's, always.

          The bands cover the bar between them, so there is nowhere left to hover for the
          total — and least of all on the tallest bar, whose top band reaches the top of the
          plot. Carrying it in the readout means the total is never something to go hunting
          for; "$150 of $210" is also the more useful sentence, since a share is the thing a
          stack is read for.
        */
        const parts = (group.stacks[hovered.series] ?? []).filter((p) => p !== null && p > 0)
        return {
          group,
          series: line,
          band,
          value,
          // Only worth saying when the bar is actually made of more than this band.
          total: parts.length > 1 ? (group.values[hovered.series] ?? null) : null,
        }
      }
    }
    return {
      group,
      series: line,
      band: null,
      value: group.values[hovered.series] ?? null,
      total: null,
    }
  })()

  return (
    <div className="chart-wrap">
      {/* The legend names whatever carries the colour, and lights it across the chart. */}
      <div className="bar-legend">
        {(bands ?? series).map((s, i) => (
          <button
            key={s.id ?? `s${i}`}
            type="button"
            className={`bar-legend-item${spotlit === i ? ' on' : ''}`}
            aria-label={`Highlight ${s.label}`}
            aria-pressed={spotlit === i}
            onMouseEnter={() => setSpotlit(i)}
            onMouseLeave={() => setSpotlit(null)}
            onFocus={() => setSpotlit(i)}
            onBlur={() => setSpotlit(null)}
          >
            <span className="bar-swatch" style={{ background: COLOURS[i % COLOURS.length] }} />
            {s.label}
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={`Grouped bars: ${series.map((s) => s.label).join(', ')} across ${
          groups.length
        } hours.`}
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
              {format(t)}
            </text>
          </g>
        ))}

        {groups.map((group, gi) => (
          <g key={`${group.sub ?? ''}-${group.label}`}>
            {group.values.map((value, si) => {
              const x = groupLeft(gi) + barW * si
              const isActive = hovered?.group === gi && hovered?.series === si
              return (
                <g key={si}>
                  {/* A full-height target per bar, so an hour that earned nothing — often the
                      one worth asking about — is still hoverable. */}
                  <rect
                    x={x}
                    y={PAD.top}
                    width={barW}
                    height={plotH}
                    className="chart-hit"
                    tabIndex={0}
                    role="button"
                    aria-label={`${group.sub ? `${group.sub} ` : ''}${group.label}, ${
                      series[si]!.label
                    }: ${value === null ? 'not run' : format(value)}`}
                    onMouseEnter={() => setHovered({ group: gi, series: si })}
                    onFocus={() => setHovered({ group: gi, series: si })}
                    onBlur={() => setHovered(null)}
                  />
                  {value === null ? (
                    // Not run that year. A zero-height bar would read as "earned nothing",
                    // which is a different fact.
                    <text
                      x={x + barW / 2}
                      y={PAD.top + plotH - 4}
                      className="chart-axis chart-axis-dim"
                      textAnchor="middle"
                      pointerEvents="none"
                    >
                      ·
                    </text>
                  ) : group.stacks ? (
                    /*
                      Bands from the bottom up, each sitting on the running total below it.
                      A band of nothing is skipped rather than drawn as a hairline, which
                      would put a stripe of colour against a shop that took nothing.
                    */
                    (() => {
                      let below = 0
                      return (group.stacks[si] ?? []).map((part, bi) => {
                        if (part === null || part <= 0) return null
                        const top = below + part
                        const bandTop = y(top)
                        const bandHeight = Math.max(0, y(below) - y(top))
                        const onBand = isActive && hovered?.band === bi
                        const piece = (
                          <g key={bi}>
                            <rect
                              x={x}
                              y={bandTop}
                              width={Math.max(1, barW - 1)}
                              height={bandHeight}
                              fill={COLOURS[bi % COLOURS.length]}
                              opacity={
                                spotlit !== null && spotlit !== bi
                                  ? 0.22
                                  : onBand || spotlit === bi
                                    ? 1
                                    : isActive
                                      ? 0.9
                                      : 0.82
                              }
                              pointerEvents="none"
                            />
                            {/* Its own target, so the answer to "how much of this is
                                Braemar" is one hover rather than arithmetic. */}
                            <rect
                              x={x}
                              y={bandTop}
                              width={Math.max(1, barW - 1)}
                              height={bandHeight}
                              className="chart-hit"
                              tabIndex={0}
                              role="button"
                              aria-label={`${group.sub ? `${group.sub} ` : ''}${
                                group.label
                              }, ${series[si]!.label}, ${
                                bands?.[bi]?.label ?? ''
                              }: ${format(part)}`}
                              onMouseEnter={() => setHovered({ group: gi, series: si, band: bi })}
                              onFocus={() => setHovered({ group: gi, series: si, band: bi })}
                              onBlur={() => setHovered(null)}
                            />
                          </g>
                        )
                        below = top
                        return piece
                      })
                    })()
                  ) : (
                    <rect
                      x={x}
                      y={y(value)}
                      width={Math.max(1, barW - 1)}
                      height={Math.max(0, PAD.top + plotH - y(value))}
                      fill={COLOURS[si % COLOURS.length]}
                      opacity={
                        spotlit !== null && spotlit !== si
                          ? 0.22
                          : isActive || spotlit === si
                            ? 1
                            : 0.82
                      }
                      pointerEvents="none"
                    />
                  )}
                </g>
              )
            })}
            <text
              x={groupLeft(gi) + (barW * series.length) / 2}
              y={HEIGHT - PAD.bottom + 16}
              className="chart-axis"
              textAnchor="end"
              transform={`rotate(-40 ${groupLeft(gi) + (barW * series.length) / 2} ${
                HEIGHT - PAD.bottom + 16
              })`}
              pointerEvents="none"
            >
              {group.sub ? `${group.sub} ${group.label}` : group.label}
            </text>
          </g>
        ))}
      </svg>

      <p className="small" style={{ margin: '0.2rem 0 0' }} aria-live="polite">
        {active ? (
          <>
            <strong>
              {active.group.sub ? `${active.group.sub} ` : ''}
              {active.group.label}
            </strong>{' '}
            · {active.series.label}
            {active.band && <> · {active.band.label}</>} ·{' '}
            <strong>
              {active.value === null ? 'not run that year' : format(active.value)}
            </strong>
            {active.total !== null && active.value !== null && (
              <span className="muted"> of {format(active.total)}</span>
            )}
          </>
        ) : (
          <span className="muted">
            Hover a bar for its exact figure. A band of a stack gives that location&apos;s
            share and the bar&apos;s total. A dot marks an hour that year did not run.
          </span>
        )}
      </p>
    </div>
  )
}
