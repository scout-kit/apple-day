// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HourChart } from '../src/ui/HourChart'
import type { HourPoint } from '../src/ui/HourChart'

/**
 * The axis of the by-hour chart.
 *
 * A tick has about one column of width. The whole slot label — "5:00 PM – 6:00 PM" — in
 * roughly fifty pixels means the labels run into each other however they are angled. The
 * range belongs in the readout; the axis gets the start time.
 */

const hour = (start: string, range: string, revenue: number, dayLabel?: string): HourPoint => ({
  label: range,
  axisLabel: start,
  ...(dayLabel ? { dayLabel } : {}),
  revenue,
})

/** A full Apple Day: four Friday evening hours and seven on Saturday. */
const wholeEvent: HourPoint[] = [
  ...[5, 6, 7, 8].map((h, i) => hour(`${h} PM`, `${h}:00 PM – ${h + 1}:00 PM`, 100 + i, 'Friday')),
  ...[8, 9, 10, 11].map((h) => hour(`${h} AM`, `${h}:00 AM – ${h + 1}:00 AM`, 80, 'Saturday')),
  ...[12, 1, 2].map((h) => hour(`${h} PM`, `${h}:00 PM – ${h + 1}:00 PM`, 60, 'Saturday')),
]

const svg = (): HTMLElement => screen.getByRole('img', { name: /Revenue by hour/ })

const axisLabels = (): string[] =>
  Array.from(svg().querySelectorAll('text.chart-axis:not(.chart-axis-dim)'))
    .map((t) => t.textContent!)
    // Drop the money ticks down the left-hand side.
    .filter((t) => !t.startsWith('$'))

describe('the axis', () => {
  it('shows the start of each hour, not the whole range', () => {
    render(<HourChart points={wholeEvent} />)
    expect(axisLabels()).toEqual([
      '5 PM', '6 PM', '7 PM', '8 PM',
      '8 AM', '9 AM', '10 AM', '11 AM',
      '12 PM', '1 PM', '2 PM',
    ])
  })

  it('keeps the full range for the readout, where there is room for it', () => {
    render(<HourChart points={wholeEvent} />)
    const first = within(svg()).getAllByRole('button')[0]!
    expect(first.getAttribute('aria-label')).toContain('5:00 PM – 6:00 PM')
  })

  it('names each day once, not under every bar', () => {
    render(<HourChart points={wholeEvent} />)
    const days = Array.from(svg().querySelectorAll('text.chart-axis-dim')).map(
      (t) => t.textContent,
    )
    // Eleven bars, two days. Repeating the day under all of them was half the crowding.
    expect(days).toEqual(['Friday', 'Saturday'])
  })

  it('marks where one day becomes the next', () => {
    render(<HourChart points={wholeEvent} />)
    expect(svg().querySelectorAll('line.chart-divider')).toHaveLength(1)
  })
})

describe('slanting, only when the labels genuinely do not fit', () => {
  const rotation = (): string | null => {
    const label = Array.from(svg().querySelectorAll('text.chart-axis')).find(
      (t) => t.textContent === '5 PM',
    )!
    return label.getAttribute('transform')
  }

  it('leaves short labels upright across a whole two-day event', () => {
    // Eleven columns of about fifty-nine pixels each, holding "5 PM". Angling those would
    // be harder to read, not easier.
    render(<HourChart points={wholeEvent} />)
    expect(rotation()).toBeNull()
  })

  it('slants them once they are wide enough to collide', () => {
    const wordy = wholeEvent.map((p) => ({ ...p, axisLabel: `${p.axisLabel} start` }))
    render(<HourChart points={wordy} />)
    const label = Array.from(svg().querySelectorAll('text.chart-axis')).find(
      (t) => t.textContent === '5 PM start',
    )!
    expect(label.getAttribute('transform')).toMatch(/rotate\(-40/)
  })

  it('leaves a single day of short labels upright', () => {
    render(<HourChart points={wholeEvent.slice(0, 4)} />)
    expect(rotation()).toBeNull()
  })
})

describe('an event with nothing in it yet', () => {
  it('says so rather than drawing an empty axis', () => {
    render(<HourChart points={[]} />)
    expect(screen.getByText(/No hours to chart yet/)).toBeTruthy()
  })

  it('still draws an axis when every hour took nothing', () => {
    render(<HourChart points={wholeEvent.map((p) => ({ ...p, revenue: 0 }))} />)
    expect(axisLabels()).toHaveLength(11)
  })
})
