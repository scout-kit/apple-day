// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GroupedBars } from '../src/ui/GroupedBars'

/**
 * The bars themselves, apart from the legend.
 *
 * The legend entries are buttons too — pointing at one lights its colour across the chart —
 * so a query for a location by name finds both. These look inside the plot.
 */
const plot = () => within(screen.getByRole('img'))

/**
 * Stacked bars, where each bar is a year and its bands are the shops it was made of.
 *
 * Stacking is only honest when the parts add up to the whole. Shops do — an hour's takings
 * are the sum of the doors staffed that hour — and years do not, so the bands are locations
 * and the bars beside each other are years.
 */

describe('reading a stacked bar', () => {
  /*
    The bands are the point of stacking: how much of this hour was Braemar. Without a target
    of its own, hovering a band gives the whole bar's total and the reader is left doing the
    arithmetic the chart was supposed to do for them.
  */
  const stacked = (
    <GroupedBars
      groups={[
        {
          label: '5:00 PM',
          values: [140, 210],
          stacks: [
            [100, 40],
            [150, 60],
          ],
        },
      ]}
      series={[
        { id: '2025', label: 'Apple Day 2025' },
        { id: '2026', label: 'Apple Day 2026' },
      ]}
      bands={[
        { id: 'braemar', label: 'Braemar' },
        { id: 'kelmont', label: 'Kelmont' },
      ]}
      format={(v) => `$${v}`}
    />
  )

  it('gives every band its own hover target, named and figured', () => {
    render(stacked)
    expect(
      screen.getByRole('button', { name: '5:00 PM, Apple Day 2026, Braemar: $150' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: '5:00 PM, Apple Day 2026, Kelmont: $60' }),
    ).toBeTruthy()
  })

  it('names the location in the readout, not just the year', () => {
    render(stacked)
    fireEvent.mouseEnter(
      screen.getByRole('button', { name: '5:00 PM, Apple Day 2025, Kelmont: $40' }),
    )
    const readout = document.querySelector('[aria-live="polite"]')!
    expect(readout.textContent).toContain('Kelmont')
    expect(readout.textContent).toContain('$40')
  })

  it('gives the bands the colours, since they are what is being told apart', () => {
    // The years are told apart by their place in the cluster, and named on hover.
    render(stacked)
    const legend = document.querySelector('.bar-legend')!
    expect(legend.textContent).toContain('Braemar')
    expect(legend.textContent).toContain('Kelmont')
    expect(legend.textContent).not.toContain('Apple Day 2025')
  })

  it('draws nothing for a door that was shut, rather than a stripe of colour', () => {
    render(
      <GroupedBars
        groups={[{ label: '5:00 PM', values: [100], stacks: [[100, null]] }]}
        series={[{ id: '2026', label: 'Apple Day 2026' }]}
        bands={[
          { id: 'braemar', label: 'Braemar' },
          { id: 'kelmont', label: 'Kelmont' },
        ]}
        format={(v) => `$${v}`}
      />,
    )
    expect(plot().queryByRole('button', { name: /Kelmont/ })).toBeNull()
  })

  it('still draws a plain bar, and labels it, when nothing is stacked', () => {
    render(
      <GroupedBars
        groups={[{ label: '5:00 PM', values: [100, 150] }]}
        series={[
          { id: '2025', label: 'Apple Day 2025' },
          { id: '2026', label: 'Apple Day 2026' },
        ]}
        format={(v) => `$${v}`}
      />,
    )
    const legend = document.querySelector('.bar-legend')!
    expect(legend.textContent).toContain('Apple Day 2025')
  })
})

describe('getting at the total of a stacked bar', () => {
  /*
    Reported: the bands cover the bar between them, so there was nowhere left to hover for
    the whole bar — worst on the tallest one, whose top band reaches the top of the plot.
    Carrying the total alongside the band means it is never something to aim for.
  */
  const stacked = (
    <GroupedBars
      groups={[
        { label: '5:00 PM', values: [210], stacks: [[150, 60]] },
      ]}
      series={[{ id: '2026', label: 'Apple Day 2026' }]}
      bands={[
        { id: 'braemar', label: 'Braemar' },
        { id: 'kelmont', label: 'Kelmont' },
      ]}
      format={(v) => `$${v}`}
    />
  )

  const readout = (): string =>
    document.querySelector('[aria-live="polite"]')?.textContent ?? ''

  it('gives the band and the bar it is part of, in one hover', () => {
    render(stacked)
    fireEvent.mouseEnter(
      screen.getByRole('button', { name: '5:00 PM, Apple Day 2026, Braemar: $150' }),
    )
    expect(readout()).toContain('$150')
    expect(readout(), 'the whole bar, without aiming for it').toContain('of $210')
  })

  it('says it for the top band too, which has nothing above it to hover', () => {
    render(stacked)
    fireEvent.mouseEnter(
      screen.getByRole('button', { name: '5:00 PM, Apple Day 2026, Kelmont: $60' }),
    )
    expect(readout()).toContain('of $210')
  })

  it('leaves it out when the bar is only that one band', () => {
    // "$150 of $150" is noise.
    render(
      <GroupedBars
        groups={[{ label: '5:00 PM', values: [150], stacks: [[150, null]] }]}
        series={[{ id: '2026', label: 'Apple Day 2026' }]}
        bands={[
          { id: 'braemar', label: 'Braemar' },
          { id: 'kelmont', label: 'Kelmont' },
        ]}
        format={(v) => `$${v}`}
      />,
    )
    fireEvent.mouseEnter(plot().getByRole('button', { name: /Braemar/ }))
    expect(readout()).not.toContain('of $150')
  })
})

describe('following a colour from the legend', () => {
  /*
    With three shops in every bar, finding Braemar means matching a swatch against a dozen
    bands by eye. Pointing at the name in the legend lights all of them at once, which is
    the thing a legend is for and the thing it cannot do on its own.
  */
  const chart = (
    <GroupedBars
      groups={[
        { label: '5:00 PM', values: [140, 210], stacks: [[100, 40], [150, 60]] },
        { label: '6:00 PM', values: [90, 120], stacks: [[60, 30], [80, 40]] },
      ]}
      series={[
        { id: '2025', label: 'Apple Day 2025' },
        { id: '2026', label: 'Apple Day 2026' },
      ]}
      bands={[
        { id: 'braemar', label: 'Braemar' },
        { id: 'kelmont', label: 'Kelmont' },
      ]}
      format={(v) => `$${v}`}
    />
  )

  const legendItem = (name: string): HTMLElement =>
    screen.getByRole('button', { name: `Highlight ${name}` })

  const bandOpacities = (): string[] =>
    Array.from(screen.getByRole('img').querySelectorAll('rect[fill]')).map(
      (r) => r.getAttribute('opacity') ?? '',
    )

  it('offers every colour as something to point at', () => {
    render(chart)
    expect(legendItem('Braemar')).toBeTruthy()
    expect(legendItem('Kelmont')).toBeTruthy()
  })

  it('lights one colour and dims the rest, across every bar', () => {
    render(chart)
    const before = bandOpacities()
    fireEvent.mouseEnter(legendItem('Braemar'))
    const after = bandOpacities()

    expect(after).not.toEqual(before)
    // Four Braemar bands lit, four Kelmont bands dimmed — two hours, two years.
    expect(after.filter((o) => o === '1')).toHaveLength(4)
    expect(after.filter((o) => o === '0.22')).toHaveLength(4)
  })

  it('puts it back when the pointer leaves', () => {
    render(chart)
    const before = bandOpacities()
    fireEvent.mouseEnter(legendItem('Kelmont'))
    fireEvent.mouseLeave(legendItem('Kelmont'))
    expect(bandOpacities()).toEqual(before)
  })

  it('follows the keyboard, so the legend is not pointer-only', () => {
    render(chart)
    fireEvent.focus(legendItem('Kelmont'))
    expect(bandOpacities().filter((o) => o === '1')).toHaveLength(4)
  })

  it('lights a plain bar too, where the legend names the years', () => {
    render(
      <GroupedBars
        groups={[{ label: '5:00 PM', values: [100, 150] }]}
        series={[
          { id: '2025', label: 'Apple Day 2025' },
          { id: '2026', label: 'Apple Day 2026' },
        ]}
        format={(v) => `$${v}`}
      />,
    )
    fireEvent.mouseEnter(legendItem('Apple Day 2026'))
    expect(bandOpacities()).toContain('0.22')
  })
})
