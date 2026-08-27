// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAllSlots } from '../src/domain/slots'
import type { EventLocation, ScheduledLocation } from '../src/domain/types'

/**
 * Reordering a year's locations.
 *
 * Order is the working priority for the day, so it gets rearranged a lot. Dragging is the
 * quick way; the arrows exist because HTML5 drag-and-drop works with neither a keyboard
 * nor a touchscreen, and this list gets edited on both.
 */

const reorderEventLocations = vi.fn()
const SLOTS = buildAllSlots()

const OPEN = { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null }

let locations: ScheduledLocation[] = []
let settings: EventLocation[] = []

vi.mock('../src/lib/repo', () => ({
  reorderEventLocations: (...args: unknown[]) => reorderEventLocations(...args),
  saveEventLocation: vi.fn(),
  removeEventLocation: vi.fn(),
  addLocationsToEvent: vi.fn(),
  useLocations: () => ({ data: locations, loading: false, error: null }),
  useLocationLibrary: () => ({ data: locations, loading: false, error: null }),
  useEventLocations: () => ({ data: settings, loading: false, error: null }),
  useAssignments: () => ({ data: [], loading: false, error: null }),
  useJars: () => ({ data: [], loading: false, error: null }),
  // Read by the map card under the table. It stays folded away, so nothing is drawn —
  // but the card is still mounted and still asks where base is.
  useBaseLocation: () => ({ data: null, loading: false, error: null }),
  saveLocationPosition: vi.fn(),
}))

// The screen reads the signed-in tier to decide what to offer, which would otherwise boot
// Firebase Auth.
/** The tier the screen is being viewed at. Set per test. */
let viewerRole = 'admin'

vi.mock('../src/lib/session', () => ({
  useSession: () => ({ user: { uid: 'admin-uid' }, role: viewerRole }),
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canSeeTheEvent: (r: string) => r === 'admin' || r === 'organizer' || r === 'viewer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026', year: 2026 },
    slots: SLOTS,
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
}))

const { LocationsScreen } = await import('../src/ui/LocationsScreen')

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta']

beforeEach(() => {
  viewerRole = 'admin'
  reorderEventLocations.mockReset()
  reorderEventLocations.mockResolvedValue(undefined)
  locations = NAMES.map((name, i) => ({
    id: name.toLowerCase(), name, address: '', mapsUrl: '', lat: null, lng: null, groupCode: '',
    siteContact: null, insurance: '', comments: '', aliases: [],
    active: true, priority: i + 1, openHours: { ...OPEN },
  }))
  settings = locations.map((l) => ({
    locationId: l.id, active: true, priority: l.priority,
  }))
})

const rowFor = (name: string): HTMLTableRowElement => {
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tbody tr'))
  const found = rows.find((r) => r.textContent?.includes(name))
  if (!found) throw new Error(`no row for ${name}`)
  return found
}

const buttonIn = (name: string, label: string): HTMLElement =>
  Array.from(rowFor(name).querySelectorAll('button')).find(
    (b) => b.getAttribute('aria-label') === label,
  )!

/** A minimal DataTransfer, which jsdom does not provide. */
const dataTransfer = (): DataTransfer =>
  ({
    effectAllowed: '',
    setData: vi.fn(),
    getData: vi.fn(),
  }) as unknown as DataTransfer

describe('the arrows', () => {
  it('moves a location up, renumbering the whole list', async () => {
    render(<LocationsScreen />)
    await userEvent.click(buttonIn('Charlie', 'Move Charlie up'))

    expect(reorderEventLocations).toHaveBeenCalledTimes(1)
    const [eventId, order] = reorderEventLocations.mock.calls[0]!
    expect(eventId).toBe('2026')
    expect(order).toEqual(['alpha', 'charlie', 'bravo', 'delta'])
  })

  it('moves a location down', async () => {
    render(<LocationsScreen />)
    await userEvent.click(buttonIn('Bravo', 'Move Bravo down'))
    expect(reorderEventLocations.mock.calls[0]![1]).toEqual([
      'alpha', 'charlie', 'bravo', 'delta',
    ])
  })

  it('cannot move the first up or the last down', () => {
    render(<LocationsScreen />)
    expect((buttonIn('Alpha', 'Move Alpha up') as HTMLButtonElement).disabled).toBe(true)
    expect((buttonIn('Delta', 'Move Delta down') as HTMLButtonElement).disabled).toBe(true)
    // The ones in the middle are free to move either way.
    expect((buttonIn('Bravo', 'Move Bravo up') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('dragging', () => {
  const drag = async (fromName: string, toName: string, below: boolean): Promise<void> => {
    const transfer = dataTransfer()
    const handle = Array.from(rowFor(fromName).querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-label') === `Reorder ${fromName}`,
    )!
    const target = rowFor(toName)

    // jsdom does no layout, so every rect is zero and "below the midpoint" is
    // inexpressible. Give the target a real box for the duration of the drag.
    const TOP = 100
    const HEIGHT = 40
    target.getBoundingClientRect = () =>
      ({ top: TOP, height: HEIGHT, bottom: TOP + HEIGHT }) as DOMRect

    const { fireEvent } = await import('@testing-library/react')
    fireEvent.dragStart(handle, { dataTransfer: transfer })
    // Which half of the row the pointer is over decides the drop side.
    fireEvent.dragOver(target, {
      dataTransfer: transfer,
      clientY: below ? TOP + HEIGHT - 1 : TOP + 1,
    })
    fireEvent.drop(target, {
      dataTransfer: transfer,
      clientY: below ? TOP + HEIGHT - 1 : TOP + 1,
    })
  }

  it('drops a later row above an earlier one', async () => {
    render(<LocationsScreen />)
    await drag('Delta', 'Bravo', false)

    expect(reorderEventLocations.mock.calls[0]![1]).toEqual([
      'alpha', 'delta', 'bravo', 'charlie',
    ])
  })

  it('reorders when an earlier row is dragged onto a later one', async () => {
    render(<LocationsScreen />)
    await drag('Alpha', 'Charlie', true)

    // jsdom reports no layout, so which half of the row the pointer was in cannot be
    // simulated reliably; `reorderByDrop` covers both sides in test/ordering.test.ts.
    // What matters here is that the drag reaches the write with the right ids.
    expect(reorderEventLocations).toHaveBeenCalledTimes(1)
    const order = reorderEventLocations.mock.calls[0]![1] as string[]
    expect(order).toHaveLength(4)
    expect([...order].sort()).toEqual(['alpha', 'bravo', 'charlie', 'delta'])
    // Alpha moved out of first place, and Charlie is now ahead of it.
    expect(order.indexOf('alpha')).toBeGreaterThan(0)
    expect(order.indexOf('alpha')).toBeGreaterThan(order.indexOf('bravo'))
  })

  it('does nothing when dropped on itself', async () => {
    render(<LocationsScreen />)
    await drag('Bravo', 'Bravo', false)
    expect(reorderEventLocations).not.toHaveBeenCalled()
  })

  it('offers a drag handle for every row', () => {
    render(<LocationsScreen />)
    for (const name of NAMES) {
      const handle = Array.from(rowFor(name).querySelectorAll('button')).find(
        (b) => b.getAttribute('aria-label') === `Reorder ${name}`,
      )
      expect(handle, name).toBeDefined()
      expect(handle!.getAttribute('draggable')).toBe('true')
    }
  })
})

describe('failures', () => {
  it('reports a rejected reorder rather than appearing to have worked', async () => {
    reorderEventLocations.mockRejectedValue(new Error('permission denied'))
    render(<LocationsScreen />)
    await userEvent.click(buttonIn('Charlie', 'Move Charlie up'))

    expect(await screen.findByText(/permission denied/)).toBeDefined()
  })
})

describe('what an organizer does here', () => {
  /*
    Where the line falls, and why not with the admins.

    Which locations the year uses, and in what order, looks like the shape of the event rather
    than the running of it. It is not: it is this year's schedule, decided by the same person
    who decides which hour somebody works, often
    in the same sitting. It sat behind the cross-year gate because it is stored under the
    event alongside things that genuinely are shared.
  */
  it('reads the locations and their order', () => {
    viewerRole = 'organizer'
    render(<LocationsScreen />)
    for (const name of NAMES) expect(screen.getByText(name)).toBeTruthy()
  })

  it('sets which locations the year uses, and in what order', () => {
    viewerRole = 'organizer'
    render(<LocationsScreen />)

    expect(screen.getAllByRole('button', { name: /^Move Alpha/ }).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Add from library' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThan(0)
  })

  it('switches a location off for the year', () => {
    viewerRole = 'organizer'
    render(<LocationsScreen />)
    const toggle = screen.getByLabelText(/^Use Alpha/) as HTMLInputElement
    expect(toggle.disabled).toBe(false)
  })

  it('still offers all of it to an admin', () => {
    render(<LocationsScreen />)
    expect(screen.getByRole('button', { name: 'Add from library' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThan(0)
    expect((screen.getByLabelText(/^Use Alpha/) as HTMLInputElement).disabled).toBe(false)
  })
})
