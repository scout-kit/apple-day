// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Location, ScheduledLocation } from '../src/domain/types'

/**
 * The map and the list beside it, as two views of one thing.
 *
 * A numbered pin only answers "which of these is Market Square" if you go hunting for the
 * number, and a list of nineteen names says nothing about where any of them is. Pointing at
 * either has to light the other, or the numbering is the whole of the connection.
 */

const shop = (id: string, over: Partial<ScheduledLocation> = {}): ScheduledLocation => ({
  id,
  name: id,
  address: '1 High Street',
  mapsUrl: '',
  groupCode: '',
  siteContact: null,
  insurance: '',
  comments: '',
  openHours: {},
  aliases: [],
  lat: 43.47,
  lng: -80.52,
  active: true,
  priority: 1,
  ...over,
})

const saveLocationPosition = vi.fn()
let base: Location | null = null

vi.mock('../src/lib/repo', () => ({
  useBaseLocation: () => ({ data: base, loading: false, error: null }),
  saveLocationPosition: (...a: unknown[]) => saveLocationPosition(...a),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({ pathFor: (screen: string) => `/e/2026/${screen}` }),
}))

/**
 * The map itself, stubbed.
 *
 * Leaflet needs a real layout engine, which jsdom does not have. What matters here is the
 * wiring — what the card hands the map, and what it does with what the map reports — so the
 * stub renders the props and offers a way to fire a hover back.
 */
vi.mock('../src/ui/LocationsMap', () => ({
  LocationsMap: ({
    places,
    base: mapBase,
    highlighted,
    onHighlight,
  }: {
    places: { id: string }[]
    base: { id: string } | null
    highlighted: string | null
    onHighlight: (id: string | null) => void
  }) => (
    <div
      data-testid="map"
      data-highlighted={highlighted ?? ''}
      data-base={mapBase?.id ?? ''}
      data-pins={places.map((p) => p.id).join(',')}
    >
      {mapBase && (
        <button
          data-testid={`pin-${mapBase.id}`}
          onMouseEnter={() => onHighlight(mapBase.id)}
          onMouseLeave={() => onHighlight(null)}
        >
          base
        </button>
      )}
      {places.map((p) => (
        <button
          key={p.id}
          data-testid={`pin-${p.id}`}
          onMouseEnter={() => onHighlight(p.id)}
          onMouseLeave={() => onHighlight(null)}
        >
          {p.id}
        </button>
      ))}
    </div>
  ),
}))

const { LocationsMapCard } = await import('../src/ui/LocationsMapCard')
const { LocationsField } = await import('../src/ui/LocationsField')

const open = async (locations: ScheduledLocation[]): Promise<void> => {
  render(<LocationsMapCard locations={locations} mayEdit />)
  await userEvent.click(screen.getByRole('button', { name: 'Show the map' }))
  await waitFor(() => expect(screen.getByTestId('map')).toBeTruthy())
}

const row = (name: string): HTMLElement =>
  screen.getByRole('link', { name }).closest('li')!

beforeEach(() => {
  base = null
  saveLocationPosition.mockReset()
})

afterEach(cleanup)

describe('pointing at the list', () => {
  const two = [shop('market', { lat: 43.47 }), shop('corner', { lat: 43.48 })]

  it('lights the pin for the shop under the pointer', async () => {
    await open(two)
    expect(screen.getByTestId('map').dataset.highlighted).toBe('')

    fireEvent.mouseEnter(row('corner'))
    expect(screen.getByTestId('map').dataset.highlighted).toBe('corner')
  })

  it('puts it out again on the way past', async () => {
    await open(two)
    fireEvent.mouseEnter(row('corner'))
    fireEvent.mouseLeave(row('corner'))
    expect(screen.getByTestId('map').dataset.highlighted).toBe('')
  })

  it('follows the keyboard too', async () => {
    /*
      Tabbing through nineteen names with the map sitting still is the same list it was
      before. A touch screen has no hover at all, so focus is the only route either has.
    */
    await open(two)
    fireEvent.focus(row('market'))
    expect(screen.getByTestId('map').dataset.highlighted).toBe('market')

    fireEvent.blur(row('market'))
    expect(screen.getByTestId('map').dataset.highlighted).toBe('')
  })

  it('lights one at a time', async () => {
    await open(two)
    fireEvent.mouseEnter(row('market'))
    fireEvent.mouseEnter(row('corner'))
    expect(screen.getByTestId('map').dataset.highlighted).toBe('corner')
  })
})

describe('pointing at the map', () => {
  const two = [shop('market'), shop('corner', { lat: 43.48 })]

  it('lights the row for the pin under the pointer', async () => {
    await open(two)
    expect(row('corner').className).not.toContain('on')

    fireEvent.mouseEnter(screen.getByTestId('pin-corner'))
    expect(row('corner').className).toContain('on')
    expect(row('market').className, 'only the one').not.toContain('on')
  })

  it('puts it out again', async () => {
    await open(two)
    fireEvent.mouseEnter(screen.getByTestId('pin-corner'))
    fireEvent.mouseLeave(screen.getByTestId('pin-corner'))
    expect(row('corner').className).not.toContain('on')
  })
})

describe('what the list is for', () => {
  it('gets to each shop’s own page, so a name is not a dead end', async () => {
    await open([shop('market')])
    expect(screen.getByRole('link', { name: 'market' }).getAttribute('href')).toBe(
      '/e/2026/location/market',
    )
  })

  it('lists only the shops it can actually draw', async () => {
    // A name in the key with no pin against it is a number that leads nowhere.
    await open([shop('market'), shop('nowhere', { lat: null, lng: null })])
    expect(screen.queryByRole('link', { name: 'market' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'nowhere' })).toBeNull()
  })
})

describe('closing it', () => {
  it('stops pointing at anything', async () => {
    // Otherwise it opens again with a shop lit that nobody is pointing at.
    await open([shop('market'), shop('corner', { lat: 43.48 })])
    fireEvent.mouseEnter(row('corner'))

    // The dialog offers two ways out — the ✕ in its head and this one in the foot, both
    // named Close. The footer one is the one being tested.
    const closers = screen.getAllByRole('button', { name: 'Close' })
    await userEvent.click(closers.find((b) => b.textContent === 'Close')!)
    await userEvent.click(screen.getByRole('button', { name: 'Show the map' }))

    expect(screen.getByTestId('map').dataset.highlighted).toBe('')
  })
})

describe('the card before it is opened', () => {
  it('says how many are placed without drawing anything', () => {
    render(
      <LocationsMapCard
        locations={[shop('market'), shop('nowhere', { lat: null, lng: null })]}
        mayEdit
      />,
    )
    expect(screen.getByText(/1 of 2 placed/)).toBeTruthy()
    // Nothing is fetched until it is asked for — tiles are somebody else's servers.
    expect(screen.queryByTestId('map')).toBeNull()
  })

  it('names what is missing, rather than only counting what is not', () => {
    render(
      <LocationsMapCard
        locations={[shop('market'), shop('nowhere', { lat: null, lng: null })]}
        mayEdit
      />,
    )
    expect(screen.getByText(/not been looked up/)).toBeTruthy()
  })
})

describe('base, on the map and in the list', () => {
  const shops = [shop('market'), shop('corner', { lat: 43.48 })]
  const hall = shop('hall', { name: 'Scout Hall', lat: 43.46 })

  beforeEach(() => {
    base = hall
  })

  it('is a star rather than a number in the list', async () => {
    await open(shops)
    const line = screen.getByText(/base of operations/).closest('p')!
    expect(line.textContent).toContain('★')
    expect(line.textContent).toContain('Scout Hall')
  })

  it('is kept out of the numbered shops', async () => {
    await open(shops)
    expect(screen.getByTestId('map').dataset.pins).toBe('market,corner')
    expect(screen.getByTestId('map').dataset.base).toBe('hall')
    // Not an <li> among the shops.
    expect(screen.queryByRole('link', { name: 'Scout Hall' })!.closest('li')).toBeNull()
  })

  it('is dropped from the shops when the year also lists it', async () => {
    // Otherwise two markers land on one spot and the hall gets a number.
    await open([...shops, hall])
    expect(screen.getByTestId('map').dataset.pins).toBe('market,corner')
    expect(screen.getAllByRole('link', { name: 'Scout Hall' })).toHaveLength(1)
  })

  it('lights up like any other line', async () => {
    await open(shops)
    fireEvent.mouseEnter(screen.getByText(/base of operations/).closest('p')!)
    expect(screen.getByTestId('map').dataset.highlighted).toBe('hall')
  })

  it('lights its line when its own pin is pointed at', async () => {
    await open(shops)
    fireEvent.mouseEnter(screen.getByTestId('pin-hall'))
    expect(
      screen.getByText(/base of operations/).closest('p')!.className,
    ).toContain('on')
  })

  it('says nothing about a base when the event has none', async () => {
    base = null
    await open(shops)
    expect(screen.queryByText(/base of operations/)).toBeNull()
  })
})

describe('the locations panel stays where it was opened', () => {
  /*
    Reported twice. The panel is positioned against whatever contains it, and every other
    part of this field grows: a chip per location picked, wrapping onto a second line once
    there are a few. Anchored to anything holding the chips, it walked down the page with
    each location added until it left the screen.

    A source check, because jsdom lays nothing out — the bug is only visible in a browser
    and invisible to every render test here.
  */
  const SOURCE = readFileSync('src/ui/LocationsField.tsx', 'utf8')
  const CSS = readFileSync('src/styles.css', 'utf8')

  it('positions the panel against an anchor of its own', () => {
    expect(CSS).toMatch(/\.locations-anchor\s*\{[^}]*position:\s*relative/)
    expect(CSS).toMatch(/\.locations-panel\s*\{[^}]*position:\s*absolute/)
  })

  it('holds nothing in that anchor but the button and the panel', () => {
    // The chips must be outside it, or the anchor grows and the panel goes with it.
    const anchor = SOURCE.slice(
      SOURCE.indexOf('locations-anchor'),
      SOURCE.indexOf('row chips'),
    )
    expect(anchor).not.toContain('chosen.map')
  })

  it('lets a long list scroll instead of growing past the panel', () => {
    /*
      A `flex: 1` child gets `min-height: auto`, which is its content's height — so it
      refuses to shrink, the panel grows past its own max-height, and nothing scrolls
      however many locations there are.
    */
    const list = /\.picker-list\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(list).toMatch(/overflow-y:\s*auto/)
    expect(list, 'without this the list cannot shrink to scroll').toMatch(/min-height:\s*0/)
  })

  it('keeps the panel narrower than the screen it opens on', () => {
    const panel = /\.locations-panel\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(panel).toMatch(/width:\s*min\(/)
  })
})

describe('the locations panel does not freeze the page', () => {
  /*
    Reported: with the panel open the page would not scroll, so opening it anywhere but the
    bottom left most of it below the fold and no way to reach it.

    The cause is the sheet that catches an outside click — `position: fixed; inset: 0` over
    the whole viewport catches every wheel and swipe with it.
  */
  const SOURCE = readFileSync('src/ui/LocationsField.tsx', 'utf8')

  it('lays no sheet over the viewport', () => {
    expect(SOURCE).not.toMatch(/position:\s*'fixed'[^}]*inset:\s*0/)
    expect(SOURCE).not.toMatch(/inset:\s*0[^}]*position:\s*'fixed'/)
  })

  it('closes on a click outside itself instead', () => {
    expect(SOURCE).toMatch(/addEventListener\('mousedown'/)
    expect(SOURCE).toMatch(/contains\(target\)/)
  })

  it('closes on Escape, because a panel with no way out is worse', () => {
    expect(SOURCE).toMatch(/'Escape'/)
  })

  it('takes its listeners away again', () => {
    // Left behind, every panel ever opened goes on answering document clicks.
    expect(SOURCE).toMatch(/removeEventListener\('mousedown'/)
    expect(SOURCE).toMatch(/removeEventListener\('keydown'/)
  })
})

describe('closing the locations panel', () => {
  const shops = [shop('market'), shop('corner', { lat: 43.48 })]

  it('shuts when something outside it is clicked', async () => {
    render(<LocationsField label="Locations" locations={shops} value={[]} onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Locations' }))
    expect(screen.getByRole('dialog', { name: 'Locations' })).toBeTruthy()

    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('dialog', { name: 'Locations' })).toBeNull()
  })

  it('stays open when something inside it is clicked', async () => {
    // Picking a location must not shut the panel — picking several is the point of it.
    const onChange = vi.fn()
    render(<LocationsField label="Locations" locations={shops} value={[]} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Locations' }))

    const panel = screen.getByRole('dialog', { name: 'Locations' })
    await userEvent.click(within(panel).getByRole('button', { name: /market/ }))

    expect(onChange).toHaveBeenCalledWith(['market'])
    expect(screen.queryByRole('dialog', { name: 'Locations' })).toBeTruthy()
  })

  it('shuts on Escape', async () => {
    render(<LocationsField label="Locations" locations={shops} value={[]} onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Locations' }))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Locations' })).toBeNull()
  })
})
