// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { resetUrl } from './helpers/url'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAllSlots } from '../src/domain/slots'
import { forgetRememberedDay } from '../src/lib/dayFilter'
import type { Assignment, Person, ScheduledLocation } from '../src/domain/types'

/**
 * The schedule board stays usable while a write is in flight.
 *
 * Firestore's `setDoc` promise resolves when the *server* acknowledges the write, not when
 * the local cache applies it. With offline persistence on — which this app needs, because
 * the market and some plazas have no signal — a write can stay pending indefinitely while
 * the optimistic local value is already on screen. Gating the UI on that promise means one
 * add locks every cell on the board, with the person visibly added.
 */

const assign = vi.fn()
const unassign = vi.fn()
let assignments: Assignment[] = []
let publishState:
  | { publishedAt: number; fingerprint: string; currentFingerprint: string }
  | null = null
const publishFn = vi.fn()

const SLOTS = buildAllSlots()

let locations: ScheduledLocation[] = [
  {
    id: 'braemar', name: 'Braemar', address: '', mapsUrl: '', lat: null, lng: null, groupCode: '',
    siteContact: null, insurance: '', comments: '', aliases: [],
    active: true, priority: 1,
    openHours: { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null },
  },
  {
    id: 'kelmont', name: 'Kelmont', address: '', mapsUrl: '', lat: null, lng: null, groupCode: '',
    siteContact: null, insurance: '', comments: '', aliases: [],
    active: true, priority: 2,
    openHours: { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null },
  },
]

const people: Person[] = [
  {
    id: 'p-one', firstName: 'Alpha', lastName: 'One', section: 'cubs',
    parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  },
  {
    id: 'p-two', firstName: 'Beta', lastName: 'Two', section: 'scouts',
    parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  },
]

// The requests inbox on this screen reads the signed-in organizer, which would
// otherwise boot Firebase Auth.
vi.mock('../src/lib/session', () => ({
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canSeeTheEvent: (r: string) => r === 'admin' || r === 'organizer' || r === 'viewer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
  useSession: () => ({ user: { uid: 'organizer' }, role: 'admin' }),
}))

let volunteerRequests: unknown[] = []
const markRequestHandled = vi.fn()

vi.mock('../src/lib/repo', () => ({
  // The requests inbox lives on this screen; empty unless a test says otherwise.
  useVolunteerRequests: () => ({ data: volunteerRequests, loading: false, error: null }),
  markRequestHandled: (...args: unknown[]) => markRequestHandled(...args),
  usePasses: () => ({ data: [], loading: false, error: null }),
  setAssignmentStatusMany: vi.fn(),

  assign: (...args: unknown[]) => assign(...args),
  unassign: (...args: unknown[]) => unassign(...args),
  useLocations: () => ({ data: locations, loading: false, error: null }),
  usePeople: () => ({ data: people, loading: false, error: null }),
  useSignups: () => ({ data: [], loading: false, error: null }),
  useAssignments: () => ({ data: assignments, loading: false, error: null }),
  // The board carries the re-publish notice, which needs to know what was published and
  // where volunteers report to.
  useBaseLocation: () => ({ data: null, loading: false, error: null }),
  usePublishState: () => ({ data: publishState, loading: false, error: null }),
}))

// The board carries the publish controls now, and `publish` reaches Firebase directly.
vi.mock('../src/lib/publish', () => ({
  publish: (...a: unknown[]) => publishFn(...a),
  unpublish: vi.fn(),
}))
vi.mock('../src/lib/csv', () => ({ downloadFile: vi.fn(), toCsv: vi.fn(() => '') }))

/** The open event, so a finished year can be put in front of the board. */
let boardEvent: Record<string, unknown> = { id: '2026', year: 2026, finishedAt: null }

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: boardEvent,
    slots: SLOTS,
    // Names on these screens link to the person's page, and the link is built
    // through pathFor so it survives an event reached by its link name.
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
  eventLinkFor: () => '2026',
}))

const { ScheduleScreen } = await import('../src/ui/ScheduleScreen')
const { publishedFingerprint } = await import('../src/domain/publishing')

/** What a publish of the board as it currently stands would record. */
const currentFingerprint = (): string =>
  publishedFingerprint({
    locations,
    people,
    assignments,
    slots: SLOTS,
    support: [],
    supportNote: '',
    arrivalNote: '',
    base: null,
  })

/** Every "+ add…" trigger currently on the board. */
const pickers = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll('button.cell-add'))

/**
 * The table row for a location.
 *
 * Scoped to the table body on purpose: the hidden-locations notice lists names too, so a
 * document-wide text query matches twice.
 */
const rowFor = (locationName: string): HTMLTableRowElement => {
  const rows = Array.from(
    document.querySelectorAll<HTMLTableRowElement>('.board tbody tr'),
  )
  const found = rows.find((r) =>
    r.querySelector('td')?.textContent?.includes(locationName),
  )
  if (!found) throw new Error(`No row for ${locationName}`)
  return found
}

const hasRow = (locationName: string): boolean => {
  try {
    rowFor(locationName)
    return true
  } catch {
    return false
  }
}

/**
 * The picker for one location and one hour.
 *
 * By row and column rather than a flat index — the board renders location-major, so the
 * second picker on the page is the same location's next hour, not the next location.
 */
const pickerAt = (locationName: string, hourIndex: number): HTMLButtonElement => {
  const found = rowFor(locationName).querySelectorAll<HTMLButtonElement>(
    'button.cell-add',
  )[hourIndex]
  if (!found) throw new Error(`No picker ${hourIndex} in ${locationName}`)
  return found
}

/** Names as the picker shows them. */
const NAME_OF: Record<string, string> = { 'p-one': 'Alpha One', 'p-two': 'Beta Two' }

/** Open a cell's picker and choose someone, the way an organizer does. */
const addPerson = async (
  locationName: string,
  hourIndex: number,
  personId: string,
): Promise<void> => {
  await userEvent.click(pickerAt(locationName, hourIndex))
  await userEvent.click(
    screen.getByRole('option', { name: new RegExp(NAME_OF[personId] ?? personId) }),
  )
}

const OPEN_FRIDAY = { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null }

beforeEach(() => {
  boardEvent = { id: '2026', year: 2026, finishedAt: null }
  forgetRememberedDay()
  resetUrl()
  assign.mockReset()
  unassign.mockReset()
  assignments = []
  publishState = null
  publishFn.mockReset()
  publishFn.mockResolvedValue([])
  // Rebuilt each test: several of them narrow a location's hours in place.
  locations = [
    {
      id: 'braemar', name: 'Braemar', address: '', mapsUrl: '', lat: null, lng: null, groupCode: '',
      siteContact: null, insurance: '', comments: '', aliases: [],
      active: true, priority: 1, openHours: { ...OPEN_FRIDAY },
    },
    {
      id: 'kelmont', name: 'Kelmont', address: '', mapsUrl: '', lat: null, lng: null, groupCode: '',
      siteContact: null, insurance: '', comments: '', aliases: [],
      active: true, priority: 2, openHours: { ...OPEN_FRIDAY },
    },
  ]
})

describe('adding someone while the write is still in flight', () => {
  it('leaves every other cell usable', async () => {
    // A write the server has not acknowledged yet — the normal case on a weak connection,
    // and the permanent case offline.
    assign.mockReturnValue(new Promise(() => {}))

    render(<ScheduleScreen />)
    expect(pickers().length).toBeGreaterThan(4)

    await addPerson('Braemar', 0, 'p-one')
    expect(assign).toHaveBeenCalledTimes(1)

    // The board must not be frozen behind one unacknowledged write.
    await waitFor(() => {
      for (const picker of pickers()) expect(picker.disabled).toBe(false)
    })
  })

  it('accepts a second add at a different location', async () => {
    assign.mockReturnValue(new Promise(() => {}))
    render(<ScheduleScreen />)

    await addPerson('Braemar', 0, 'p-one')
    // Different location, same hour — this is what locked before.
    await addPerson('Kelmont', 0, 'p-two')

    expect(assign).toHaveBeenCalledTimes(2)
    const [first, second] = assign.mock.calls
    expect(first![1]).toMatchObject({ locationId: 'braemar', personId: 'p-one' })
    expect(second![1]).toMatchObject({ locationId: 'kelmont', personId: 'p-two' })
  })

  it('keeps the remove buttons live too', async () => {
    assignments = [
      {
        id: 'a1', slotId: SLOTS[0]!.id, locationId: 'braemar', personId: 'p-one',
        status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    unassign.mockReturnValue(new Promise(() => {}))
    render(<ScheduleScreen />)

    const remove = screen.getByTitle('Remove from this shift')
    await userEvent.click(remove)
    expect(unassign).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      for (const picker of pickers()) expect(picker.disabled).toBe(false)
    })
  })

  it('accepts a second add in a later hour at the same location', async () => {
    assign.mockReturnValue(new Promise(() => {}))
    render(<ScheduleScreen />)

    await addPerson('Braemar', 0, 'p-one')
    await addPerson('Braemar', 1, 'p-two')

    expect(assign).toHaveBeenCalledTimes(2)
    expect(assign.mock.calls[0]![1]).toMatchObject({ slotId: 'fri-1700' })
    expect(assign.mock.calls[1]![1]).toMatchObject({ slotId: 'fri-1800' })
  })
})

describe('when a write actually fails', () => {
  it('says so instead of silently doing nothing', async () => {
    assign.mockRejectedValue(new Error('Missing or insufficient permissions.'))
    render(<ScheduleScreen />)

    await addPerson('Braemar', 0, 'p-one')

    await waitFor(() =>
      expect(screen.getByText(/insufficient permissions/)).toBeDefined(),
    )
    // And the board is still usable, so the organizer can retry.
    for (const picker of pickers()) expect(picker.disabled).toBe(false)
  })
})

describe('the fix holds for repeated adds', () => {
  it('allows a whole column to be filled with nothing acknowledged', async () => {
    // Building a schedule is dozens of adds in a row. None of them should wait for the
    // one before it, and none should block on the server.
    assign.mockReturnValue(new Promise(() => {}))
    render(<ScheduleScreen />)

    for (const hour of [0, 1, 2, 3]) {
      await addPerson('Braemar', hour, 'p-one')
      await addPerson('Kelmont', hour, 'p-two')
    }

    expect(assign).toHaveBeenCalledTimes(8)
    for (const picker of pickers()) expect(picker.disabled).toBe(false)
  })

  it('recovers after a failure and keeps accepting adds', async () => {
    assign
      .mockRejectedValueOnce(new Error('network hiccup'))
      .mockReturnValue(new Promise(() => {}))
    render(<ScheduleScreen />)

    await addPerson('Braemar', 0, 'p-one')
    await waitFor(() => expect(screen.getByText(/network hiccup/)).toBeDefined())

    // The error must not be a dead end.
    await addPerson('Kelmont', 0, 'p-two')
    expect(assign).toHaveBeenCalledTimes(2)
    // And it clears once a later write is attempted.
    expect(screen.queryByText(/network hiccup/)).toBeNull()
  })
})

/**
 * Closed and unrecorded locations are left off the board by default. Tests that inspect
 * those cells reveal them first, the way an organizer would.
 */
async function revealHidden(): Promise<void> {
  const button = screen.queryByRole('button', { name: 'Show them' })
  if (button) await userEvent.click(button)
}

describe('closed hours', () => {
  /** Braemar open 6–9pm Friday, so the 5pm hour is closed. Kelmont hours unrecorded. */
  const withClosedHour = (): void => {
    locations[0] = {
      ...locations[0]!,
      openHours: { fri: { openMin: 18 * 60, closeMin: 21 * 60 }, sat: null },
    }
    locations[1] = { ...locations[1]!, openHours: {} }
  }

  const cellFor = (locationName: string, hourIndex: number): HTMLElement =>
    rowFor(locationName).querySelectorAll('td')[hourIndex + 1] as HTMLElement

  it('offers no picker for an hour the location is shut', async () => {
    withClosedHour()
    render(<ScheduleScreen />)
    await revealHidden()

    const closed = cellFor('Braemar', 0)
    expect(closed.querySelector('button.cell-add')).toBeNull()
    expect(closed.textContent).toContain('closed')
    // The hours it is open still take a picker.
    expect(cellFor('Braemar', 1).querySelector('button.cell-add')).not.toBeNull()
  })

  it('still allows scheduling when hours were never recorded', async () => {
    // A location with no hours on file is left off the board, but revealing it must not
    // also block it — otherwise a newly added location is unschedulable until somebody
    // fills in hours the workbook never captured.
    withClosedHour()
    render(<ScheduleScreen />)
    await revealHidden()

    for (const hour of [0, 1, 2, 3]) {
      expect(cellFor('Kelmont', hour).querySelector('button.cell-add')).not.toBeNull()
    }
  })

  it('says why the cell is unavailable, distinguishing the two cases', async () => {
    withClosedHour()
    render(<ScheduleScreen />)
    await revealHidden()

    expect(cellFor('Braemar', 0).title).toContain('closed at this hour')
    expect(cellFor('Kelmont', 0).title).toContain('No opening hours recorded')
  })

  it('lets an organizer staff a closed hour deliberately', async () => {
    withClosedHour()
    assign.mockReturnValue(new Promise(() => {}))
    render(<ScheduleScreen />)
    await revealHidden()

    const closed = cellFor('Braemar', 0)
    await userEvent.click(closed.querySelector('button')!)

    // The trigger appears only for that cell, and is marked as an override.
    const trigger = cellFor('Braemar', 0).querySelector('button.cell-add')!
    expect(trigger).not.toBeNull()
    expect(trigger.textContent).toContain('closed')

    await addPerson('Braemar', 0, 'p-one')
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign.mock.calls[0]![1]).toMatchObject({
      slotId: 'fri-1700', locationId: 'braemar', personId: 'p-one',
    })
  })

  it('does not open up the other closed cells when one is overridden', async () => {
    locations[0] = {
      ...locations[0]!,
      // Open for the last hour only, so three Friday hours are closed.
      openHours: { fri: { openMin: 20 * 60, closeMin: 21 * 60 }, sat: null },
    }
    render(<ScheduleScreen />)
    await revealHidden()

    await userEvent.click(cellFor('Braemar', 0).querySelector('button')!)

    expect(cellFor('Braemar', 0).querySelector('button.cell-add')).not.toBeNull()
    expect(cellFor('Braemar', 1).querySelector('button.cell-add')).toBeNull()
    expect(cellFor('Braemar', 2).querySelector('button.cell-add')).toBeNull()
  })

  it('keeps an existing assignment removable in a closed hour', async () => {
    withClosedHour()
    assignments = [
      {
        id: 'a1', slotId: 'fri-1700', locationId: 'braemar', personId: 'p-one',
        status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    unassign.mockReturnValue(new Promise(() => {}))
    render(<ScheduleScreen />)

    // Hours can change after a schedule is built; that shift must not become stuck.
    await userEvent.click(screen.getByTitle('Remove from this shift'))
    expect(unassign).toHaveBeenCalledTimes(1)
  })
})

describe('a day marked closed all day', () => {
  const cellFor = (locationName: string, hourIndex: number): HTMLElement =>
    rowFor(locationName).querySelectorAll('td')[hourIndex + 1] as HTMLElement

  it('withholds the picker for every hour of it', async () => {
    // Explicit null: somebody turned Friday off in the library.
    locations[0] = { ...locations[0]!, openHours: { fri: null, sat: null } }
    render(<ScheduleScreen />)
    await revealHidden()

    for (const hour of [0, 1, 2, 3]) {
      const cell = cellFor('Braemar', hour)
      expect(cell.querySelector('button.cell-add')).toBeNull()
      expect(cell.textContent).toContain('closed')
    }
  })

  it('is not confused with a day nobody has recorded', async () => {
    locations[0] = { ...locations[0]!, openHours: { fri: null } }
    // Kelmont says nothing about Friday at all, so both are hidden and the board is empty
    // until they are revealed.
    locations[1] = { ...locations[1]!, openHours: {} }
    render(<ScheduleScreen />)
    await revealHidden()

    expect(cellFor('Braemar', 0).querySelector('button.cell-add')).toBeNull()
    expect(cellFor('Braemar', 0).title).toContain('closed at this hour')

    expect(cellFor('Kelmont', 0).querySelector('button.cell-add')).not.toBeNull()
    expect(cellFor('Kelmont', 0).title).toContain('No opening hours recorded')
  })

  it('can still be overridden for a single hour', async () => {
    locations[0] = { ...locations[0]!, openHours: { fri: null, sat: null } }
    assign.mockReturnValue(new Promise(() => {}))
    render(<ScheduleScreen />)
    await revealHidden()

    await userEvent.click(cellFor('Braemar', 1).querySelector('button')!)
    // Overriding one hour leaves it as the row's only trigger, so it is index 0 here.
    await addPerson('Braemar', 0, 'p-one')

    expect(assign.mock.calls[0]![1]).toMatchObject({ slotId: 'fri-1800' })
    // The other hours of that closed day stay shut.
    expect(cellFor('Braemar', 0).querySelector('button.cell-add')).toBeNull()
  })

  it('treats a zero-length range as closed too', async () => {
    locations[0] = {
      ...locations[0]!,
      openHours: { fri: { openMin: 18 * 60, closeMin: 18 * 60 } },
    }
    render(<ScheduleScreen />)
    await revealHidden()
    expect(cellFor('Braemar', 1).querySelector('button.cell-add')).toBeNull()
  })
})

describe('locations that are not part of the day', () => {
  const rowExists = (name: string): boolean => hasRow(name)

  it('leaves out a location closed all day', () => {
    locations[1] = { ...locations[1]!, openHours: { fri: null, sat: null } }
    render(<ScheduleScreen />)

    expect(rowExists('Braemar')).toBe(true)
    // A row of hatching for a shut location is noise.
    expect(rowExists('Kelmont')).toBe(false)
  })

  it('leaves out a location whose hours nobody recorded', () => {
    locations[1] = { ...locations[1]!, openHours: {} }
    render(<ScheduleScreen />)
    expect(rowExists('Kelmont')).toBe(false)
  })

  it('mentions the count quietly, without a warning', () => {
    // A closed location is unremarkable, so this is a muted line under the table rather
    // than a banner above it — but it still offers the way back for a location whose hours
    // have simply not been recorded yet.
    locations[1] = { ...locations[1]!, openHours: { fri: null } }
    render(<ScheduleScreen />)

    expect(screen.getByText(/1 closed or unset for Friday/)).toBeDefined()
    expect(screen.queryByRole('button', { name: 'Show them' })).not.toBeNull()
    /*
      Not dressed up as a problem. Scoped to the line itself rather than the whole screen,
      because the publish controls at the foot of the board carry warnings of their own —
      no base of operations, no day-of contacts — and those are nothing to do with a
      location being shut.
    */
    const line = screen.getByText(/1 closed or unset for Friday/).closest('p')!
    expect(line.className).not.toMatch(/note|warning/)
    expect(line.querySelectorAll('.note.warning, .note.info')).toHaveLength(0)
  })

  it('can show them anyway on request', async () => {
    locations[1] = { ...locations[1]!, openHours: { fri: null } }
    render(<ScheduleScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Show them' }))
    // Back in the table, and still blocked from taking a shift without an override.
    expect(rowFor('Kelmont').querySelector('button.cell-add')).toBeNull()
  })

  it('keeps a closed location that already has someone scheduled', () => {
    // Hours get corrected after a schedule is built; hiding the row would hide the shift
    // and there would be no way to move it.
    locations[1] = { ...locations[1]!, openHours: { fri: null } }
    assignments = [
      {
        id: 'a1', slotId: 'fri-1700', locationId: 'kelmont', personId: 'p-one',
        status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    render(<ScheduleScreen />)

    expect(rowExists('Kelmont')).toBe(true)
    expect(screen.getByTitle('Remove from this shift')).toBeDefined()
  })

  it('explains an empty day instead of showing a bare table', () => {
    locations = locations.map((l) => ({ ...l, openHours: { fri: null, sat: null } }))
    render(<ScheduleScreen />)
    expect(screen.getByText(/Nothing is open on Friday/)).toBeDefined()
  })
})

describe('when every location is hidden', () => {
  it('can still reveal them', async () => {
    // Above the table, not under it. Under it, a day where nothing has hours is a dead end:
    // no table, therefore no way back.
    locations = locations.map((l) => ({ ...l, openHours: { fri: null, sat: null } }))
    render(<ScheduleScreen />)

    expect(screen.getByText(/Nothing is open on Friday/)).toBeDefined()
    const reveal = screen.getByRole('button', { name: 'Show them' })
    await userEvent.click(reveal)

    expect(hasRow('Braemar')).toBe(true)
    expect(hasRow('Kelmont')).toBe(true)
  })
})

describe('a name is a way to reach that person', () => {
  it('links a youth placed on the board to their own page', () => {
    // The board is where a name is read most, so it is where somebody most often wants
    // what else that person is doing.
    assignments = [
      {
        id: 'a1', slotId: SLOTS[0]!.id, locationId: 'braemar', personId: 'p-one',
        status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    render(<ScheduleScreen />)

    const link = screen.getByRole('link', { name: 'Alpha One' })
    expect(link.getAttribute('href')).toBe('/e/2026/person/p-one')
  })
})

describe('the validation banner', () => {
  it('says nothing at all when the day is clean', () => {
    /*
      "No conflicts." is a green bar reporting the ordinary case, in the row with the least
      space to spare. The board below is the evidence that nothing is wrong.
    */
    assignments = []
    render(<ScheduleScreen />)

    expect(screen.queryByText(/No conflicts/)).toBeNull()
    expect(document.querySelector('.note.good')).toBeNull()
  })

  it('still speaks up when something is wrong', () => {
    // Somebody in two places at once, which is what the banner exists for.
    assignments = [
      {
        id: 'a1', slotId: SLOTS[0]!.id, locationId: 'braemar', personId: 'p-one',
        status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
      {
        id: 'a2', slotId: SLOTS[0]!.id, locationId: 'kelmont', personId: 'p-one',
        status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    render(<ScheduleScreen />)

    expect(document.querySelector('.note.error, .note.warning')).toBeTruthy()
  })
})

describe('telling somebody the published schedule has gone stale', () => {
  const notice = (): HTMLElement | null =>
    screen.queryByText(/has changed since (it was|they were) published/i)

  it('says nothing before anything has been published', () => {
    // There is nothing out of date, because there is nothing out there.
    publishState = null
    render(<ScheduleScreen />)
    expect(notice()).toBeNull()
  })

  it('says nothing while the published copy still matches', () => {
    // A permanent "all good" is a line of screen nobody reads after the first day.
    publishState = {
      publishedAt: 1,
      fingerprint: currentFingerprint(),
      currentFingerprint: currentFingerprint(),
    }
    render(<ScheduleScreen />)
    expect(notice()).toBeNull()
  })

  it('speaks up once the board has moved on', () => {
    publishState = {
      publishedAt: Date.UTC(2026, 9, 1, 18),
      fingerprint: 'something-else',
      currentFingerprint: currentFingerprint(),
    }
    render(<ScheduleScreen />)

    expect(notice()).toBeTruthy()
    // And the button that answers it, right underneath — no link away, because publishing
    // happens on this screen now.
    expect(screen.getByRole('button', { name: 'Publish schedule' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Go to/ })).toBeNull()
  })
})

describe('publishing, now that it has no page of its own', () => {
  /*
    The Publish screen is gone. Almost everything on it had found a better home — a
    volunteer's link and QR on their own page, the jar labels beside the jars, the "no
    contact details" warning already on the roster where the details are entered — and what
    was left was two buttons and a page to reach them by.
  */

  it('offers the one thing that page was for', () => {
    // Two, until the public schedule went: publishing now writes passes and nothing else.
    render(<ScheduleScreen />)
    expect(screen.getByRole('button', { name: 'Publish schedule' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: /public schedule/i })).toBeNull()
  })

  it('sits in the card with the day switch, not adrift at the foot of the page', () => {
    render(<ScheduleScreen />)
    const card = screen.getByRole('button', { name: 'Publish schedule' }).closest('.card') as HTMLElement
    expect(within(card).getByRole('button', { name: 'Friday' })).toBeTruthy()
  })

  it('offers no mail-merge, and no explanation of what publishing does', () => {
    // Both removed on request. The CSV was the only route from this app to a parent's
    // inbox, so its absence is a decision rather than an oversight.
    render(<ScheduleScreen />)
    expect(screen.queryByRole('button', { name: /Mail-merge/ })).toBeNull()
    expect(screen.queryByText(/Writes one pass per/)).toBeNull()
  })

  it('confirms briefly, then takes the confirmation away again', async () => {
    /*
      A line that stays until the screen is left leaves the board carrying a stale claim about
      something already finished, and a count nobody asked for reads as a figure to check.
    */
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      render(<ScheduleScreen />)
      await userEvent.click(screen.getByRole('button', { name: 'Publish schedule' }))

      await waitFor(() => expect(screen.getByText(/Schedule published/)).toBeTruthy())
      expect(screen.queryByText(/passes/)).toBeNull()

      await act(async () => {
        vi.advanceTimersByTime(4100)
      })
      expect(screen.queryByText(/Schedule published/)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('publishes the board as it stands', async () => {
    render(<ScheduleScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Publish schedule' }))

    expect(publishFn).toHaveBeenCalledTimes(1)
    const [eventId, input] = publishFn.mock.calls[0]!
    expect(eventId).toBe('2026')
    expect((input as { people: unknown[] }).people).toHaveLength(people.length)
  })

  it('warns about the two things a pass cannot be built without', () => {
    // Neither is repeated anywhere else, and both are baked into every pass the moment you
    // press the button.
    render(<ScheduleScreen />)
    expect(screen.getByText(/No base of operations set/)).toBeTruthy()
    expect(screen.getByText(/No day-of contacts set/)).toBeTruthy()
  })
})

describe('showing which shops are one place to stand', () => {
  /*
    A stripe beside the name rather than a re-ordering. Shops in one plaza need not be next
    to each other in the running order — that order is the organizers' own, set by dragging
    the Locations list — so the colour links them where they are.
  */
  it('marks the locations that share an area', () => {
    locations = locations.map((l, i) => (i < 2 ? { ...l, groupCode: 'LINDEN' } : l))
    render(<ScheduleScreen />)

    const marks = document.querySelectorAll('.area-mark')
    expect(marks.length).toBe(2)
  })

  it('gives them the same colour, so two rows read as one place', () => {
    locations = locations.map((l, i) => (i < 2 ? { ...l, groupCode: 'LINDEN' } : l))
    render(<ScheduleScreen />)

    const tones = [...document.querySelectorAll('.area-mark')].map((el) =>
      [...el.classList].find((c) => c.startsWith('tone-')),
    )
    expect(new Set(tones).size).toBe(1)
  })

  it('names the area under the shop, so the code is readable rather than guessed', () => {
    locations = locations.map((l, i) => (i < 2 ? { ...l, groupCode: 'linden' } : l))
    render(<ScheduleScreen />)
    expect(screen.getAllByText(/LINDEN/).length).toBeGreaterThan(0)
  })

  it('marks nothing on a shop that is on its own', () => {
    // Every shop in a fresh library has a blank code, and a stripe on all of them would say
    // they were all one place.
    locations = locations.map((l) => ({ ...l, groupCode: '' }))
    render(<ScheduleScreen />)
    expect(document.querySelectorAll('.area-mark').length).toBe(0)
  })
})

/**
 * A year that has been closed out.
 *
 * Finishing deletes every volunteer link and clears the parents' contact details, so
 * publishing again would mint a fresh set of the documents that existed to be deleted — for
 * people nobody can be told about. This is the screen somebody is on when they wonder why
 * the schedule is not going out, so it is the screen that has to say why.
 */
describe('publishing a finished year', () => {
  beforeEach(() => {
    boardEvent = { id: '2026', year: 2026, finishedAt: 1_700_000_000_000 }
  })

  it('is not offered at all', () => {
    render(<ScheduleScreen />)
    expect(screen.queryByRole('button', { name: 'Publish schedule' })).toBeNull()
  })

  it('says why, and where the way back is', () => {
    render(<ScheduleScreen />)
    expect(screen.getByText(/This year is finished/)).toBeTruthy()
    expect(screen.getByText(/reopen it on the Events screen/)).toBeTruthy()
  })

  it('leaves the board itself alone', () => {
    // The schedule is still worth reading — it is what the year was. Only publishing goes.
    render(<ScheduleScreen />)
    expect(screen.getByRole('button', { name: 'Friday' })).toBeTruthy()
  })
})
