// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Location } from '../src/domain/types'

/**
 * The open-days column in the library list.
 *
 * A record that has been through the editor once has every day present, five of them
 * explicitly closed — and the column read "Sun closed / Mon closed / …" for seven rows,
 * which is a wall of nothing where the two days that matter should be.
 *
 * The editor's own switches are tested next door, in `locationEditorHours.test.tsx`. They
 * shared a file while the list had an Edit button to reach the editor through; it does not
 * any more — a location is edited on its own page.
 */

const library: { data: Location[]; loading: boolean; error: null } = {
  data: [],
  loading: false,
  error: null,
}

vi.mock('../src/lib/repo', () => ({
  saveLocation: vi.fn(),
  useLocationLibrary: () => library,
  useEventLocations: () => ({ data: [], loading: false, error: null }),
  addLocationsToEvent: vi.fn(),
}))

vi.mock('../src/lib/eventContext', () => ({
  // Location names link to their own page, and the link is built through pathFor.
  useEvent: () => ({
    event: { id: '2026', year: 2026 },
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
}))

const { LibraryScreen } = await import('../src/ui/LibraryScreen')

const braemar: Location = {
  id: 'braemar-640',
  name: 'Braemar — 640 Linden Drive',
  address: '640 Linden Dr',
  mapsUrl: '',
  lat: null,
  lng: null,
  groupCode: '640',
  siteContact: null,
  insurance: '',
  comments: '',
  openHours: {
    fri: { openMin: 17 * 60, closeMin: 21 * 60 },
    sat: { openMin: 8 * 60, closeMin: 15 * 60 },
  },
  aliases: [],
}

beforeEach(() => {
  library.data = [braemar]
})

describe('the list shows the open days, not the closed ones', () => {
  /** The cell that used to read "Sun closed / Mon closed / …" for seven rows. */
  const openCell = (): HTMLElement =>
    screen.getByRole('row', { name: /Braemar/ }).querySelectorAll('td')[2] as HTMLElement

  it('lists only the days with hours', () => {
    // What a record looks like after one round trip through the editor: every day present,
    // five of them explicitly closed.
    library.data = [
      {
        ...braemar,
        openHours: {
          sun: null, mon: null, tue: null, wed: null, thu: null,
          fri: { openMin: 17 * 60, closeMin: 21 * 60 },
          sat: { openMin: 8 * 60, closeMin: 15 * 60 },
        },
      },
    ]
    render(<LibraryScreen />)

    const text = openCell().textContent!
    expect(text).toContain('Fri')
    expect(text).toContain('Sat')
    expect(text).not.toContain('closed')
    for (const day of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']) {
      expect(text).not.toContain(day)
    }
  })

  it('says nothing is recorded when nothing is', () => {
    library.data = [{ ...braemar, openHours: {} }]
    render(<LibraryScreen />)
    expect(openCell().textContent).toBe('not set')
  })

  it('distinguishes a place that is shut every day from one nobody has asked about', () => {
    library.data = [{ ...braemar, openHours: { fri: null, sat: null } }]
    render(<LibraryScreen />)
    expect(openCell().textContent).toBe('closed all week')
  })
})

describe('editing is not offered here', () => {
  it('has no Edit button on a row', () => {
    /*
      Removed deliberately. A location is edited on its own page, reached by its name — the
      list could not show what an edit affected while you were making it: the year it is
      used in, its hours, its history.
    */
    render(<LibraryScreen />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('still offers Add, because a new place has no page yet', () => {
    render(<LibraryScreen />)
    expect(screen.getByRole('button', { name: 'Add location' })).toBeTruthy()
  })

  it('links the name to the place own page', () => {
    render(<LibraryScreen />)
    expect(screen.getByRole('link', { name: /Braemar/ }).getAttribute('href')).toContain(
      'location/braemar-640',
    )
  })
})
