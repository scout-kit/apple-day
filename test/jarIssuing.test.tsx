// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { resetUrl } from './helpers/url'
import userEvent from '@testing-library/user-event'
import { useMemo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAllSlots } from '../src/domain/slots'
import { forgetRememberedDay } from '../src/lib/dayFilter'
import type {
  Assignment,
  Jar,
  Location,
  Person,
  ScheduledLocation,
} from '../src/domain/types'

/**
 * Issuing jars, and taking them back.
 *
 * Handing a jar over is what sends somebody out, so it does two things at once. Taking one
 * back has to undo only as much as it should: hand one of three jars back and you are still
 * out collecting, so the shift must not revert.
 */

const issueJar = vi.fn()
const unissueJar = vi.fn()
const setAssignmentStatusMany = vi.fn()
const revealPassShifts = vi.fn()
const setWhereaboutsMany = vi.fn()
const swapAssignments = vi.fn()

const SLOTS = buildAllSlots()
const SLOT = 'fri-1700'

/**
 * The locations this year staffs. The base of operations is deliberately NOT among them —
 * it must never appear as a row on the board or in the revenue ranking — and this fixture
 * reflects that, because a fixture where the base *was* staffed is exactly what hid a bug
 * where the base was looked up in this list and therefore never found.
 */
const locations: ScheduledLocation[] = [
  {
    id: 'braemar', name: 'Braemar', address: '640 Linden Dr', mapsUrl: '', lat: null, lng: null, groupCode: '',
    siteContact: null, insurance: '', comments: '', aliases: [],
    active: true, priority: 1,
    openHours: { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null },
  },
]

/** The base, which lives in the library only. */
const hall: Location = {
  id: 'hall', name: 'Scout Hall', address: '123 Hall St', mapsUrl: '', lat: null, lng: null, groupCode: '',
  siteContact: null, insurance: '', comments: '', aliases: [],
  openHours: {},
}

/** The event's passes, as an organizer sees them. */
let passRecords: { token: string; personId: string; role: string }[] = []

/** Which location the event runs from, if any. Set per test. */
let baseId: string | null = 'hall'

/**
 * Whether the data is still arriving.
 *
 * Controllable, so the screen's loading branch actually renders. A mock reporting
 * `loading: false` forever never reaches it, and a hook placed after that early return is
 * never counted twice — React throws when the hook count changes between renders, so the
 * page breaks on its first real load with every test still green.
 */
let loadingData = false

// Reassigned in beforeEach: the contact-flag tests change what is on file.
let people: Person[] = []

const alpha: Person = {
  id: 'p-one', firstName: 'Alpha', lastName: 'One', section: 'cubs',
  parentName: '', parentEmail: '', parentPhone: '519-555-0100', pairWithPersonId: null,
}

let assignments: Assignment[] = []
let jars: Jar[] = []

let volunteerRequests: unknown[] = []
const markRequestHandled = vi.fn()

vi.mock('../src/lib/repo', () => ({
  // The requests inbox lives on this screen; empty unless a test says otherwise.
  useVolunteerRequests: () => ({ data: volunteerRequests, loading: false, error: null }),
  markRequestHandled: (...args: unknown[]) => markRequestHandled(...args),

  issueJar: (...args: unknown[]) => issueJar(...args),
  unissueJar: (...args: unknown[]) => unissueJar(...args),
  setAssignmentStatusMany: (...args: unknown[]) => setAssignmentStatusMany(...args),
  revealPassShifts: (...args: unknown[]) => revealPassShifts(...args),
  // Organizers list the event's passes so a check-in can reveal that person's location.
  usePasses: () => ({ data: passRecords, loading: false, error: null }),
  setWhereaboutsMany: (...args: unknown[]) => setWhereaboutsMany(...args),
  swapAssignments: (...args: unknown[]) => swapAssignments(...args),
  useLocations: () => ({ data: locations, loading: loadingData, error: null }),
  // Resolved from the library, not the year's selection — the base is deliberately not one
  // of the staffed locations.
  // Calls a real hook, like the implementation does (useLocationLibrary, useEvent,
  // useMemo). A mock that returns a bare object participates in no hook count, and so
  // cannot reproduce a hook placed below an early return — which is exactly how that bug
  // reached the browser.
  useBaseLocation: () => {
    const data = useMemo(() => (baseId === hall.id ? hall : null), [])
    return { data, loading: loadingData, error: null }
  },
  usePeople: () => ({ data: people, loading: false, error: null }),
  useAssignments: () => ({ data: assignments, loading: false, error: null }),
  useJars: () => ({ data: jars, loading: false, error: null }),
}))

/** The event's dates, so the screen can tell which day today is. Set per test. */
let eventDates = { fridayDate: '', saturdayDate: '' }

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    pathFor: (screen: string) => `/e/2026/${screen}`,
    event: {
      id: '2026',
      year: 2026,
      baseLocationId: baseId,
      ...eventDates,
      schedule: {
        fri: { startMin: 17 * 60, endMin: 21 * 60 },
        sat: { startMin: 8 * 60, endMin: 15 * 60 },
      },
    },
    slots: SLOTS,
  }),
}))

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

const { DayOfScreen } = await import('../src/ui/DayOfScreen')

const jar = (over: Partial<Jar> & { id: string; jarNumber: number }): Jar => ({
  day: 'fri',
  locationId: 'braemar',
  personId: 'p-one',
  assignmentId: 'a1', assignmentIds: ['a1'],
  status: 'out',
  issuedAt: 1,
  issuedBy: 'organizer',
  amount: null,
  method: 'cash',
  note: '',
  countedBy: '',
  countedAt: 0,
  ...over,
})

beforeEach(() => {
  forgetRememberedDay()
  resetUrl()
  issueJar.mockReset()
  issueJar.mockResolvedValue('fri-jar-1')
  unissueJar.mockReset()
  unissueJar.mockResolvedValue(undefined)
  // Every mocked write has to return a promise: the component attaches `.catch` to report
  // a failure, and a mock returning undefined throws there instead — an unhandled error
  // that vitest flags as able to cause false positives elsewhere.
  setAssignmentStatusMany.mockReset()
  setAssignmentStatusMany.mockResolvedValue(undefined)
  setWhereaboutsMany.mockReset()
  setWhereaboutsMany.mockResolvedValue(undefined)
  baseId = 'hall'
  loadingData = false
  passRecords = [{ token: 'tok-one', personId: 'p-one', role: 'volunteer' }]
  eventDates = { fridayDate: '', saturdayDate: '' }
  revealPassShifts.mockReset()
  revealPassShifts.mockResolvedValue(undefined)
  swapAssignments.mockReset()
  swapAssignments.mockResolvedValue(undefined)
  assignments = [
    {
      id: 'a1', slotId: SLOT, locationId: 'braemar', personId: 'p-one',
      status: 'checkedIn', whereabouts: 'here', checkedInAt: 1, checkedOutAt: null,
    },
  ]
  jars = []
  people = [alpha]
})

describe('issuing a jar', () => {
  it('offers the lowest number not already out', async () => {
    jars = [jar({ id: 'j1', jarNumber: 1 }), jar({ id: 'j3', jarNumber: 3 })]
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))

    // 1 and 3 are out, so 2 is the obvious next one.
    expect((screen.getByLabelText('Jar number') as HTMLInputElement).value).toBe('2')
  })

  it('records the location, youth and shift from the schedule', async () => {
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))
    // The dialog's confirm carries the number; the row's button does not.
    await userEvent.click(screen.getByRole('button', { name: /^Issue jar \d+$/ }))

    expect(issueJar).toHaveBeenCalledTimes(1)
    const [eventId, input, issuedBy] = issueJar.mock.calls[0]!
    expect(eventId).toBe('2026')
    expect(input).toMatchObject({
      jarNumber: 1,
      day: 'fri',
      locationId: 'braemar',
      personId: 'p-one',
      assignmentId: 'a1', assignmentIds: ['a1'],
    })
    expect(issuedBy).toBe('organizer')
  })

  it('refuses a number already out, rather than duplicating it', async () => {
    jars = [jar({ id: 'j5', jarNumber: 5 })]
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))

    const input = screen.getByLabelText('Jar number')
    await userEvent.clear(input)
    await userEvent.type(input, '5')

    expect(screen.getByText(/already out with someone/)).toBeDefined()
    expect(
      (screen.getByRole('button', { name: /^Issue jar \d+$/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('shows what is already out, so the table can be checked at a glance', async () => {
    jars = [jar({ id: 'j2', jarNumber: 2 }), jar({ id: 'j9', jarNumber: 9 })]
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))
    expect(screen.getByText(/2 jars out at the moment: 2, 9/)).toBeDefined()
  })
})

describe('the shift shows what they are holding', () => {
  it('marks them as out collecting with their jar numbers', () => {
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = [jar({ id: 'j4', jarNumber: 4 }), jar({ id: 'j7', jarNumber: 7 })]
    render(<DayOfScreen />)

    // Scoped to the pill: the stat tiles above use the same words.
    expect(screen.getByText('out collecting', { selector: '.pill' })).toBeDefined()
    expect(screen.getByLabelText('Take jar 4 back from Alpha One')).toBeDefined()
    expect(screen.getByLabelText('Take jar 7 back from Alpha One')).toBeDefined()
  })

  it('does not offer to take back a jar already counted', () => {
    assignments = [{ ...assignments[0]!, whereabouts: 'back' as const }]
    jars = [jar({ id: 'j4', jarNumber: 4, status: 'counted', amount: 30 })]
    render(<DayOfScreen />)

    expect(screen.getByText('back', { selector: '.pill' })).toBeDefined()
    expect(screen.queryByLabelText(/Take jar 4 back/)).toBeNull()
  })
})

describe('taking a jar back', () => {
  it('ends the shift when it was their only jar', async () => {
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = [jar({ id: 'j4', jarNumber: 4 })]
    render(<DayOfScreen />)

    await userEvent.click(screen.getByLabelText('Take jar 4 back from Alpha One'))

    expect(unissueJar).toHaveBeenCalledTimes(1)
    const [eventId, taken, wasLast] = unissueJar.mock.calls[0]!
    expect(eventId).toBe('2026')
    expect(taken.jarNumber).toBe(4)
    expect(wasLast).toBe(true)
  })

  it('leaves them out when they are still holding another', async () => {
    // Handing one of two back does not bring somebody in off the street.
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = [jar({ id: 'j4', jarNumber: 4 }), jar({ id: 'j5', jarNumber: 5 })]
    render(<DayOfScreen />)

    await userEvent.click(screen.getByLabelText('Take jar 4 back from Alpha One'))
    expect(unissueJar.mock.calls[0]![2]).toBe(false)
  })

  it('ignores a counted jar when deciding whether the shift ends', async () => {
    // A counted jar is already back, so it does not keep them out.
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = [
      jar({ id: 'j4', jarNumber: 4 }),
      jar({ id: 'j5', jarNumber: 5, status: 'counted', amount: 12 }),
    ]
    render(<DayOfScreen />)

    await userEvent.click(screen.getByLabelText('Take jar 4 back from Alpha One'))
    expect(unissueJar.mock.calls[0]![2]).toBe(true)
  })

  it('reports a failure rather than appearing to have worked', async () => {
    unissueJar.mockRejectedValue(new Error('permission denied'))
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = [jar({ id: 'j4', jarNumber: 4 })]
    render(<DayOfScreen />)

    await userEvent.click(screen.getByLabelText('Take jar 4 back from Alpha One'))
    expect(await screen.findByText(/permission denied/)).toBeDefined()
  })
})

describe('a jar going out again after it has been counted', () => {
  it('offers the number back as the next suggestion', async () => {
    // Jar 1 has been counted, so it is empty and back on the table. Nothing is out.
    jars = [jar({ id: 'j1', jarNumber: 1, status: 'counted', amount: 40 })]
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))

    expect((screen.getByLabelText('Jar number') as HTMLInputElement).value).toBe('1')
  })

  it('lets it be issued again', async () => {
    jars = [jar({ id: 'j1', jarNumber: 1, status: 'counted', amount: 40 })]
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))
    await userEvent.click(screen.getByRole('button', { name: /^Issue jar \d+$/ }))

    expect(issueJar).toHaveBeenCalledTimes(1)
    expect(issueJar.mock.calls[0]![1]).toMatchObject({ jarNumber: 1 })
  })

  it('still refuses one that is out right now', async () => {
    jars = [
      jar({ id: 'j1', jarNumber: 1, status: 'counted', amount: 40 }),
      jar({ id: 'j2', jarNumber: 2 }),
    ]
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))

    const input = screen.getByLabelText('Jar number')
    await userEvent.clear(input)
    await userEvent.type(input, '2')
    expect(screen.getByText(/already out with someone/)).toBeDefined()

    // But the counted one is fine.
    await userEvent.clear(input)
    await userEvent.type(input, '1')
    expect(screen.queryByText(/already out with someone/)).toBeNull()
  })

  it('counts only what is out when suggesting a number', async () => {
    // 1 and 2 counted, 3 out: the next free number is 1, not 4.
    jars = [
      jar({ id: 'j1', jarNumber: 1, status: 'counted', amount: 10 }),
      jar({ id: 'j2', jarNumber: 2, status: 'counted', amount: 20 }),
      jar({ id: 'j3', jarNumber: 3 }),
    ]
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))
    expect((screen.getByLabelText('Jar number') as HTMLInputElement).value).toBe('1')
  })

  it('gives each trip its own record rather than overwriting the last', async () => {
    // Two trips for jar 1 on one day: two rows of money, not one replacing the other.
    jars = [jar({ id: 'j1a', jarNumber: 1, status: 'counted', amount: 40 })]
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Give Alpha One a jar/))
    await userEvent.click(screen.getByRole('button', { name: /^Issue jar \d+$/ }))

    // The write does not name a document, so it cannot collide with the counted trip.
    expect(issueJar.mock.calls[0]![1]).not.toHaveProperty('id')
  })
})

describe('the day-of desk works person by person', () => {
  const row = (name: string): HTMLElement => {
    const found = Array.from(document.querySelectorAll('tbody tr')).find((r) =>
      r.querySelector('td')?.textContent?.includes(name),
    )
    if (!found) throw new Error(`no row for ${name}`)
    return found as HTMLElement
  }
  const hasRow = (name: string): boolean => {
    try {
      row(name)
      return true
    } catch {
      return false
    }
  }
  const OTHER: Person = {
    id: 'p-two', firstName: 'Beta', lastName: 'Two', section: 'scouts',
    parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  }

  it('lists people, not locations', () => {
    render(<DayOfScreen />)
    // A person walks up to the table; the row is theirs.
    expect(row('Alpha One')).toBeDefined()
    expect(screen.getByRole('columnheader', { name: 'Who' })).toBeDefined()
  })

  it('shows the whole day at once by default', () => {
    people.push(OTHER)
    assignments = [
      assignments[0]!,
      {
        id: 'a2', slotId: 'fri-2000', locationId: 'braemar', personId: 'p-two',
        status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    render(<DayOfScreen />)

    // Two different hours, both visible without switching.
    expect(hasRow('Alpha One')).toBe(true)
    expect(hasRow('Beta Two')).toBe(true)
    people.pop()
  })

  it('can narrow to a single shift', async () => {
    people.push(OTHER)
    assignments = [
      assignments[0]!,
      {
        id: 'a2', slotId: 'fri-2000', locationId: 'braemar', personId: 'p-two',
        status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    render(<DayOfScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'One shift' }))
    expect(hasRow('Alpha One')).toBe(true)
    expect(hasRow('Beta Two')).toBe(false)
    people.pop()
  })

  it('groups a person’s several shifts under their name', () => {
    assignments = [
      assignments[0]!,
      {
        id: 'a2', slotId: 'fri-1900', locationId: 'braemar', personId: 'p-one',
        status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    render(<DayOfScreen />)

    expect(screen.getByText('2 shifts today')).toBeDefined()
    // The second line does not repeat the name.
    expect(screen.getByText('↳ same person')).toBeDefined()
  })

  it('can find somebody by name', async () => {
    people.push(OTHER)
    assignments = [
      assignments[0]!,
      {
        id: 'a2', slotId: 'fri-1800', locationId: 'braemar', personId: 'p-two',
        status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    render(<DayOfScreen />)

    await userEvent.type(screen.getByPlaceholderText(/Find a name/), 'beta')
    expect(hasRow('Beta Two')).toBe(true)
    expect(hasRow('Alpha One')).toBe(false)
    people.pop()
  })
})

describe('a jar only goes to somebody who has arrived', () => {
  const buttonFor = (label: string): HTMLButtonElement =>
    screen.getAllByRole('button').find((b) => b.textContent === label)! as HTMLButtonElement

  it('is not offered before check-in', () => {
    // Absent rather than greyed out with an explanation: the row has seven controls, and
    // five of them doing nothing yet is worse than five of them not being there.
    assignments = [{ ...assignments[0]!, status: 'confirmed' }]
    render(<DayOfScreen />)
    expect(screen.queryByRole('button', { name: 'Issue jar' })).toBeNull()
  })

  it('can be issued once they are checked in', () => {
    assignments = [{ ...assignments[0]!, status: 'checkedIn' }]
    render(<DayOfScreen />)
    expect(buttonFor('Issue jar').disabled).toBe(false)
  })

  it('can still add a second jar to somebody already out', () => {
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = [jar({ id: 'j1', jarNumber: 1 })]
    render(<DayOfScreen />)
    expect(buttonFor('+ jar').disabled).toBe(false)
  })
})

describe('out collecting without a jar', () => {
  const buttonFor = (label: string): HTMLButtonElement =>
    screen.getAllByRole('button').find((b) => b.textContent === label)! as HTMLButtonElement

  it('can be set by hand, without touching whether they turned up', async () => {
    assignments = [{ ...assignments[0]!, status: 'checkedIn' }]
    render(<DayOfScreen />)

    await userEvent.click(buttonFor('Out'))
    expect(setWhereaboutsMany).toHaveBeenCalledWith('2026', ['a1'], 'out')
    // The check-in is a separate fact and must survive being sent out.
    expect(setAssignmentStatusMany).not.toHaveBeenCalled()
  })

  it('can be brought back by hand, again leaving attendance alone', async () => {
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    render(<DayOfScreen />)

    await userEvent.click(buttonFor('Back'))
    expect(setWhereaboutsMany).toHaveBeenCalledWith('2026', ['a1'], 'back')
    expect(setAssignmentStatusMany).not.toHaveBeenCalled()
  })

  it('undoing a check-in does not move them off a location', async () => {
    // The collision this whole split exists to prevent: touching attendance must not make
    // the board forget where somebody is. Asserted in the state where the attendance
    // button is actually offered — while they are out it is hidden, which is a second,
    // stronger guard on the same mistake.
    assignments = [{ ...assignments[0]!, whereabouts: 'back' as const }]
    render(<DayOfScreen />)

    await userEvent.click(buttonFor('Here'))
    expect(setAssignmentStatusMany).toHaveBeenCalledWith('2026', ['a1'], 'confirmed')
    expect(setWhereaboutsMany).not.toHaveBeenCalled()
    // Still shown as back, because it is still true. (The pill, not the button.)
    expect(document.querySelector('.pill.tone-blue')!.textContent).toBe('back')
  })

  it('offers no attendance button while somebody who has arrived is out', async () => {
    /*
      Written against `checkedIn` + `out`, because `confirmed` + `out` is not a state.

      Nobody un-checks-in somebody standing at a location, which is what this pins down. But
      "out collecting" is a fact about a person who has arrived, and a shift saying
      `confirmed` + `out` is a check-in that
      was taken back and a whereabouts nobody cleared. Guarding the attendance buttons on it
      is what left a row that was expected and out with nothing on it but "Back".
    */
    assignments = [{ ...assignments[0]!, status: 'checkedIn', whereabouts: 'out' as const }]
    render(<DayOfScreen />)

    expect(screen.queryByRole('button', { name: 'Check in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Here' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No-show' })).toBeNull()
    expect(screen.getByText('out collecting')).toBeTruthy()
    // And one press brings them in, which is what stops it being a trap.
    expect(buttonFor('Out')).toBeTruthy()
  })

  it('reads a stale whereabouts as what it means, not what it says', async () => {
    /*
      Reported from the day: expected, out collecting, one jar counted, and "Back" the only
      thing that could be pressed. The pair had been reachable by taking a check-in back and
      leaving the whereabouts behind it.
    */
    assignments = [
      { ...assignments[0]!, status: 'confirmed', whereabouts: 'out' as const },
    ]
    render(<DayOfScreen />)

    const cells = screen.getByRole('row', { name: /Alpha One/ }).querySelectorAll('td')
    const buttons = Array.from(cells[cells.length - 1]!.querySelectorAll('button'))
    expect(buttons.map((b) => b.textContent)).toEqual(['Check in', 'No-show', 'Swap'])
    // Not shown as out, because they have not arrived — the pill would be a lie.
    expect(screen.queryByText('out collecting')).toBeNull()
    expect(screen.getByText('expected')).toBeTruthy()
  })

  it('is warned about, because returning money has nothing to attach to', () => {
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = []
    render(<DayOfScreen />)

    expect(screen.getByText(/1 out collecting with no jar/)).toBeDefined()
    expect(screen.getByText(/nothing to attach to/)).toBeDefined()
  })

  it('is not warned about once a jar is in their hands', () => {
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = [jar({ id: 'j1', jarNumber: 1 })]
    render(<DayOfScreen />)

    expect(screen.queryByText(/out collecting with no jar/)).toBeNull()
  })

  it('is warned about again if their only jar is taken back', () => {
    // Taking the jar back leaves the shift out with nothing, which is the state worth
    // catching: it is how money comes back unattributable.
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = [jar({ id: 'j1', jarNumber: 1, status: 'counted', amount: 20 })]
    render(<DayOfScreen />)

    expect(screen.getByText(/1 out collecting with no jar/)).toBeDefined()
  })

  it('offers to issue a jar straight from the warning', async () => {
    assignments = [{ ...assignments[0]!, whereabouts: 'out' as const }]
    jars = []
    render(<DayOfScreen />)

    const warning = screen
      .getByText(/1 out collecting with no jar/)
      .closest('.note') as HTMLElement
    await userEvent.click(within(warning).getByRole('button', { name: 'Issue jar' }))
    expect(screen.getByLabelText('Jar number')).toBeDefined()
  })
})


describe('the row shows only the buttons the shift can use', () => {
  /** Every button in the shift's own controls cell, in order. */
  const controls = (): string[] => {
    const cells = screen.getByRole('row', { name: /Alpha One/ }).querySelectorAll('td')
    const last = cells[cells.length - 1]!
    return Array.from(last.querySelectorAll('button')).map((b) => b.textContent!)
  }

  const inState = (over: Partial<Assignment>): void => {
    assignments = [{ ...assignments[0]!, ...over }]
    render(<DayOfScreen />)
  }

  it('offers arriving, not arriving, or a swap before anybody turns up', () => {
    inState({ status: 'confirmed', whereabouts: 'here' })
    expect(controls()).toEqual(['Check in', 'No-show', 'Swap'])
  })

  it('drops no-show once they have arrived, and offers the jar', () => {
    inState({ status: 'checkedIn', whereabouts: 'here' })
    expect(controls()).toEqual(['Here', 'Issue jar', 'Out', 'Swap'])
  })

  it('drops check-in once they are marked absent, keeping the undo', () => {
    inState({ status: 'noShow', whereabouts: 'here' })
    // Named for what pressing it does. "No-show" on a row already marked absent reads as
    // the button to press to mark them absent, which is how it came to look one-way.
    expect(controls()).toEqual(['Undo no-show', 'Swap'])
  })

  it('can take a no-show back after the shift has already finished', async () => {
    /*
      Reported from the day: somebody was marked absent after their shift was over, and the
      row then offered nothing but "Back".

      Two guards collided. `absent` hid the check-in, and `done` hid the no-show — and the
      no-show button is the undo. Both were right about when a no-show may be newly marked
      and wrong about taking one back, which is never a thing to prevent.
    */
    inState({ status: 'noShow', whereabouts: 'back' })
    expect(controls()).toContain('Undo no-show')

    await userEvent.click(screen.getByRole('button', { name: 'Undo no-show' }))
    expect(setAssignmentStatusMany).toHaveBeenCalledWith('2026', ['a1'], 'confirmed')
  })

  it('offers the way back to checked-in once the no-show is taken back', () => {
    // The second press. Attendance is a decision with two answers and either can be given.
    inState({ status: 'confirmed', whereabouts: 'back' })
    expect(controls()).toContain('Check in')
  })

  it('offers another jar and the way back once they are out', () => {
    inState({ status: 'checkedIn', whereabouts: 'out' })
    // No check-in to undo mid-shift, and no swapping somebody already at a location. The
    // jar button reads "Issue jar" because this shift went out without one.
    expect(controls()).toEqual(['Issue jar', 'Out', 'Back'])
  })

  it('is down to here and back once the shift is over', () => {
    inState({ status: 'checkedIn', whereabouts: 'back' })
    expect(controls()).toEqual(['Here', 'Back'])
  })

  it('lets every decision be undone from the state it leads to', async () => {
    inState({ status: 'checkedIn', whereabouts: 'back' })
    // Back sends them out again rather than being a dead end.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(setWhereaboutsMany).toHaveBeenCalledWith('2026', ['a1'], 'out')
  })
})

describe('finding a location from the table', () => {
  it('opens a map for the place, without leaving the screen', async () => {
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Where Braemar is/))

    const frame = screen.getByTitle('Map of Braemar') as HTMLIFrameElement
    expect(frame.src).toContain('output=embed')
  })

  it('routes from the base of operations when one is set', async () => {
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Where Braemar is/))

    const frame = screen.getByTitle('Map of Braemar') as HTMLIFrameElement
    // The question at a shift change is how to get there from base, not where it is in the
    // abstract.
    expect(frame.src).toContain('saddr=')
    expect(screen.getByText(/Directions from/)).toBeTruthy()
  })

  it('says so when no base is set, rather than silently showing a pin', async () => {
    /*
      Here it matters: somebody is being sent out and the answer they wanted was a route.

      It does not matter on a location's own page, where the question is only where the place
      is.
    */
    baseId = null
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Where Braemar is/))

    expect(screen.getByText(/No base of operations is set/)).toBeTruthy()
    expect((screen.getByTitle('Map of Braemar') as HTMLIFrameElement).src).toContain('q=')
  })

  it('always offers the way out to Google Maps proper', async () => {
    // The keyless embed is undocumented and could stop working; the link is what keeps the
    // place findable if it does.
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Where Braemar is/))
    expect(screen.getByRole('link', { name: 'Open in Google Maps' })).toBeTruthy()
  })

  it('closes again', async () => {
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Where Braemar is/))
    // The modal's own Close, not the dismiss button in its corner.
    const footer = screen.getByTitle('Map of Braemar').closest('.modal')!
    await userEvent.click(
      Array.from(footer.querySelectorAll('button')).find((b) => b.textContent === 'Close')!,
    )
    expect(screen.queryByTitle('Map of Braemar')).toBeNull()
  })
})

describe('the base of operations is found even though it is not a staffed location', () => {
  /**
   * The bug: the base was looked up in the year's *selected* locations. It is deliberately
   * excluded from those — it must not be a row on the board or in the revenue ranking — so
   * the lookup always came back empty. The banner went blank, published passes lost the
   * base, and the location map showed a bare pin with no route from anywhere.
   */
  it('names the base on the screen', () => {
    render(<DayOfScreen />)
    expect(screen.getByText(/Scout Hall/)).toBeTruthy()
  })

  it('routes the map from it', async () => {
    render(<DayOfScreen />)
    await userEvent.click(screen.getByTitle(/Where Braemar is/))

    const frame = screen.getByTitle('Map of Braemar') as HTMLIFrameElement
    expect(frame.src).toContain('saddr=123%20Hall%20St')
    expect(frame.src).toContain('daddr=640%20Linden%20Dr')
  })
})


describe('arriving data', () => {
  it('renders through the load without changing its hooks', async () => {
    // The regression: every hook has to run on the loading render as well as the loaded
    // one. React counts them and throws "rendered more hooks than during the previous
    // render" when a hook sits below the early return.
    loadingData = true
    const { rerender } = render(<DayOfScreen />)
    expect(screen.getByText(/Loading the day/)).toBeTruthy()

    loadingData = false
    rerender(<DayOfScreen />)

    // Same component instance, now loaded: the row is there and nothing threw.
    expect(screen.getByText(/Alpha One/)).toBeTruthy()
    expect(screen.getByText(/Scout Hall/)).toBeTruthy()
  })
})

describe('back-to-back shifts at one location are one stretch of work', () => {
  /** Two consecutive hours at Braemar, plus a later one so runs can be told apart. */
  const backToBack = (status: 'confirmed' | 'checkedIn' = 'confirmed'): void => {
    assignments = [
      { ...assignments[0]!, id: 'a1', slotId: 'fri-1700', status },
      { ...assignments[0]!, id: 'a2', slotId: 'fri-1800', status },
    ]
  }

  const personRow = (): HTMLElement => screen.getByRole('row', { name: /Alpha One/ })

  const controls = (): string[] => {
    const cells = personRow().querySelectorAll('td')
    return Array.from(cells[cells.length - 1]!.querySelectorAll('button')).map(
      (b) => b.textContent!,
    )
  }

  it('is one row, not two', () => {
    backToBack()
    render(<DayOfScreen />)
    // Not two, the second labelled "↳ same person" — that is two of everything to press.
    expect(screen.getAllByRole('row', { name: /Alpha One/ })).toHaveLength(1)
  })

  it('shows the whole stretch and says it is back to back', () => {
    backToBack()
    render(<DayOfScreen />)
    const text = personRow().textContent!
    expect(text).toContain('2 shifts, back to back')
    expect(text).toContain('5:00 PM–7:00 PM')
  })

  it('says so in the one-hour view too, where it would otherwise look ordinary', async () => {
    backToBack()
    render(<DayOfScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'One shift' }))

    // This is the whole point: at 5pm you need to know they are not coming back at 6.
    expect(personRow().textContent).toContain('2 shifts, back to back')
  })

  it('checks both shifts in with one press', async () => {
    backToBack()
    render(<DayOfScreen />)

    // "on the board" is a note, not a button — asserted separately below.
    expect(controls()).toEqual(['Check in', 'No-show'])
    await userEvent.click(screen.getByRole('button', { name: 'Check in' }))
    expect(setAssignmentStatusMany).toHaveBeenCalledWith('2026', ['a1', 'a2'], 'checkedIn')
  })

  it('sends both out with one press', async () => {
    backToBack('checkedIn')
    render(<DayOfScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Out' }))
    expect(setWhereaboutsMany).toHaveBeenCalledWith('2026', ['a1', 'a2'], 'out')
  })

  it('issues one jar for the stretch, and sends the stretch out', async () => {
    backToBack('checkedIn')
    render(<DayOfScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Issue jar' }))
    const dialog = screen.getByText(/Send Alpha One out/).closest('.modal') as HTMLElement
    await userEvent.click(within(dialog).getByRole('button', { name: /^Issue jar/ }))

    // The jar record points at one shift, so it hangs off the one they leave on…
    expect(issueJar.mock.calls[0]![1]).toMatchObject({ assignmentId: 'a1' })
    // …and carries the whole stretch, which `issueJar` sends out in the same batch. No
    // second write from here: a stretch must never be half out.
    expect(issueJar.mock.calls[0]![1]).toMatchObject({ assignmentIds: ['a1', 'a2'] })
    expect(setWhereaboutsMany).not.toHaveBeenCalled()
  })

  it('warns once, not twice, when the stretch is out with no jar', () => {
    backToBack('checkedIn')
    assignments = assignments.map((a) => ({ ...a, whereabouts: 'out' as const }))
    jars = []
    render(<DayOfScreen />)

    expect(screen.getByText(/1 out collecting with no jar/)).toBeTruthy()
  })

  it('counts the shift held against the second hour as covering the stretch', () => {
    backToBack('checkedIn')
    assignments = assignments.map((a) => ({ ...a, whereabouts: 'out' as const }))
    jars = [jar({ id: 'j1', jarNumber: 4, assignmentId: 'a2' })]
    render(<DayOfScreen />)

    // They are holding a jar. Which of their two hours it was booked against is not a
    // reason to chase them.
    expect(screen.queryByText(/out collecting with no jar/)).toBeNull()
  })

  it('keeps a gap in the day as two separate stretches', () => {
    assignments = [
      { ...assignments[0]!, id: 'a1', slotId: 'fri-1700' },
      { ...assignments[0]!, id: 'a3', slotId: 'fri-1900' },
    ]
    render(<DayOfScreen />)

    // The second stretch's row says "same person" rather than repeating the name, so count
    // body rows rather than named ones.
    const rows = Array.from(document.querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).not.toContain('back to back')
    expect(rows[1]!.textContent).toContain('same person')
  })

  it('offers the board rather than a swap that could only move half a stretch', () => {
    backToBack()
    render(<DayOfScreen />)
    expect(controls()).not.toContain('Swap')
    expect(personRow().textContent).toContain('on the board')
  })
})

describe('a jar issued for a stretch records the whole stretch', () => {
  it('so its money can be divided across the hours it was out', async () => {
    assignments = [
      { ...assignments[0]!, id: 'a1', slotId: 'fri-1700', status: 'checkedIn' },
      { ...assignments[0]!, id: 'a2', slotId: 'fri-1800', status: 'checkedIn' },
    ]
    render(<DayOfScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Issue jar' }))
    const dialog = screen.getByText(/Send Alpha One out/).closest('.modal') as HTMLElement
    await userEvent.click(within(dialog).getByRole('button', { name: /^Issue jar/ }))

    const input = issueJar.mock.calls[0]![1] as { assignmentId: string; assignmentIds: string[] }
    // The one it closes when it comes back…
    expect(input.assignmentId).toBe('a1')
    // …and every hour it was out for, recorded at issue time so a later schedule edit
    // cannot change how this money was divided.
    expect(input.assignmentIds).toEqual(['a1', 'a2'])
  })

  it('records a single shift as a stretch of one', async () => {
    assignments = [{ ...assignments[0]!, id: 'a1', status: 'checkedIn' }]
    render(<DayOfScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Issue jar' }))
    const dialog = screen.getByText(/Send Alpha One out/).closest('.modal') as HTMLElement
    await userEvent.click(within(dialog).getByRole('button', { name: /^Issue jar/ }))

    expect((issueJar.mock.calls[0]![1] as { assignmentIds: string[] }).assignmentIds).toEqual(['a1'])
  })
})


describe('the day it opens on', () => {
  const dayButton = (label: string): HTMLButtonElement =>
    screen.getByRole('button', { name: label }) as HTMLButtonElement

  /** Local noon on a date, so the test is not measuring the runner's timezone. */
  const noonOn = (iso: string, hour = 12): Date => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y!, m! - 1, d!, hour, 0)
  }

  beforeEach(() => {
    eventDates = { fridayDate: '2026-10-02', saturdayDate: '2026-10-03' }
    assignments = [
      { ...assignments[0]!, id: 'a1', slotId: 'fri-1700' },
      { ...assignments[0]!, id: 'a2', slotId: 'sat-0900' },
    ]
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const on = (iso: string, hour = 12): void => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(noonOn(iso, hour))
  }

  it('opens on Saturday on the Saturday', () => {
    // The whole point: on the busiest morning of the year, nobody should have to reach for
    // the day switch before they can check anybody in.
    on('2026-10-03')
    render(<DayOfScreen />)
    expect(dayButton('Saturday').className).toContain('primary')
  })

  it('opens on Friday on the Friday', () => {
    on('2026-10-02')
    render(<DayOfScreen />)
    expect(dayButton('Friday').className).toContain('primary')
  })

  it('opens on the first day on any other date', () => {
    // Matching on the weekday alone would call a Saturday in March a day of the event.
    on('2026-03-07')
    render(<DayOfScreen />)
    expect(dayButton('Friday').className).toContain('primary')
  })

  it('leaves a day the organizer picked alone', async () => {
    on('2026-10-03')
    render(<DayOfScreen />)
    await userEvent.click(dayButton('Friday'))
    // Somebody looking at Friday's numbers on the Saturday is not second-guessed.
    expect(dayButton('Friday').className).toContain('primary')
  })

  it('opens on the hour that is happening, not the first of the day', async () => {
    on('2026-10-02', 19)
    render(<DayOfScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'One shift' }))

    // By 7pm the 5pm hour is nobody's question.
    const hours = screen.getAllByRole('button').filter((b) => /^\d/.test(b.textContent!))
    expect(hours.find((b) => b.className.includes('primary'))!.textContent).toContain('7')
  })

  it('falls back to the first hour on a date that is not the event', async () => {
    on('2026-03-07')
    render(<DayOfScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'One shift' }))

    const hours = screen.getAllByRole('button').filter((b) => /^\d/.test(b.textContent!))
    expect(hours.find((b) => b.className.includes('primary'))!.textContent).toContain('5')
  })
})

describe('what a volunteer is told on their own pass', () => {
  const buttonFor = (label: string): HTMLButtonElement =>
    screen.getAllByRole('button').find((b) => b.textContent === label)! as HTMLButtonElement

  /*
    Their pass shows the time only until they check in — everybody reports to base first,
    and that is where they are told where to go. So the reveal has to follow the check-in
    in BOTH directions: checked in by mistake, or marked absent, and the location has to
    come off the page again. A reveal that outlives its check-in quietly undoes the rule.
  */

  it('names the location once they are checked in', async () => {
    assignments = [{ ...assignments[0]!, status: 'confirmed' }]
    render(<DayOfScreen />)

    await userEvent.click(buttonFor('Check in'))
    expect(revealPassShifts).toHaveBeenCalledWith('tok-one', true)
  })

  it('takes the location back off when the check-in is undone', async () => {
    render(<DayOfScreen />)

    await userEvent.click(buttonFor('Here'))
    expect(setAssignmentStatusMany).toHaveBeenCalledWith('2026', ['a1'], 'confirmed')
    expect(revealPassShifts).toHaveBeenCalledWith('tok-one', false)
  })

  it('takes it off when they are marked absent', async () => {
    assignments = [{ ...assignments[0]!, status: 'confirmed' }]
    render(<DayOfScreen />)

    await userEvent.click(buttonFor('No-show'))
    expect(revealPassShifts).toHaveBeenCalledWith('tok-one', false)
  })

  it('says nothing to somebody with no pass', async () => {
    passRecords = []
    render(<DayOfScreen />)

    await userEvent.click(buttonFor('Here'))
    // No pass to update, and no crash reaching for a token that is not there.
    expect(revealPassShifts).not.toHaveBeenCalled()
  })

  it('never blocks a check-in at a busy table when the pass write fails', async () => {
    revealPassShifts.mockRejectedValue(new Error('offline'))
    assignments = [{ ...assignments[0]!, status: 'confirmed' }]
    render(<DayOfScreen />)

    await userEvent.click(buttonFor('Check in'))
    expect(setAssignmentStatusMany).toHaveBeenCalledWith('2026', ['a1'], 'checkedIn')
  })
})

describe('knowing whether somebody can be rung', () => {
  /*
    At the table with a queue behind you, the question is about the person in front of you:
    if they do not turn up, is there a number to call? The roster answers this in a banner
    covering everybody, which is right before the day and useless during it — and a warning
    against every second name would be read once and then not at all.
  */

  const flag = (): HTMLElement | null => document.querySelector('.contact-flag')

  it('says nothing when there is a phone number', () => {
    render(<DayOfScreen />)
    expect(flag()).toBeNull()
  })

  it('marks somebody with no phone, and says why on hover', () => {
    people = [{ ...alpha, parentPhone: '', parentEmail: 'parent@example.org' }]
    render(<DayOfScreen />)

    const mark = flag()!
    expect(mark).toBeTruthy()
    expect(mark.getAttribute('title')).toContain('No phone number')
    // A glyph with no accessible name is furniture to a screen reader.
    expect(mark.getAttribute('aria-label')).toBe(mark.getAttribute('title'))
  })

  it('marks somebody with nothing on file at all', () => {
    people = [{ ...alpha, parentPhone: '', parentEmail: '' }]
    render(<DayOfScreen />)
    expect(flag()!.getAttribute('title')).toContain('No phone number or email address')
  })

  it('comes before the name, where the eye already runs down', () => {
    // After the name it moves with the length of the name and has to be hunted for.
    people = [{ ...alpha, parentPhone: '', parentEmail: '' }]
    render(<DayOfScreen />)

    const cell = flag()!.parentElement!
    const order = Array.from(cell.childNodes)
    expect(order.indexOf(flag()!)).toBeLessThan(
      order.findIndex((n) => (n.textContent ?? '').includes('Alpha One')),
    )
  })

  it('never puts a parent’s phone number on the board', () => {
    /*
      Under the name would put a parent's phone number on a screen open on a table in a shop
      doorway all day, for the sake of a call almost nobody makes. The person's own page has
      it, one click away.
    */
    people = [{ ...alpha, parentPhone: '519-555-0100' }]
    render(<DayOfScreen />)

    expect(screen.queryByText('519-555-0100')).toBeNull()
    expect(document.querySelector('a[href^="tel:"]')).toBeNull()
  })

  it('stays out of the way — no banner, nothing bold', () => {
    // The report was explicit: an indicator to hover, not something in your face.
    people = [{ ...alpha, parentPhone: '', parentEmail: '' }]
    render(<DayOfScreen />)

    expect(document.querySelectorAll('.note.warning')).toHaveLength(0)
    expect(screen.queryByText(/no way to reach/i)).toBeNull()
  })
})

describe('coming back to where you were', () => {
  /*
    The report, verbatim in effect: check somebody in on the Saturday table at a particular
    shift, click through to that person, press Back — and you are on Friday with the filters
    cleared, four button presses from where you were, on the morning you can least spare
    them.

    The view now lives in the address bar, so Back brings it with it.
  */

  const search = (): string => window.location.search

  it('puts the chosen day in the address bar', async () => {
    eventDates = { fridayDate: '2026-10-02', saturdayDate: '2026-10-03' }
    render(<DayOfScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Saturday' }))
    expect(search()).toContain('day=sat')
  })

  it('puts a name search there too', async () => {
    render(<DayOfScreen />)
    await userEvent.type(screen.getByPlaceholderText(/Find/i), 'alpha')
    expect(search()).toContain('find=alpha')
  })

  it('opens on the day the address bar names', () => {
    // What Back actually restores.
    window.history.replaceState(null, '', '/e/2026/day-of?day=sat')
    eventDates = { fridayDate: '2026-10-02', saturdayDate: '2026-10-03' }
    render(<DayOfScreen />)

    const saturday = screen.getByRole('button', { name: 'Saturday' })
    expect(saturday.className).toContain('primary')
  })

  it('restores a search from the address bar', () => {
    window.history.replaceState(null, '', '/e/2026/day-of?find=alpha')
    render(<DayOfScreen />)
    expect((screen.getByPlaceholderText(/Find/i) as HTMLInputElement).value).toBe('alpha')
  })

  it('does not pile up history entries as the filters are pressed', async () => {
    // Twenty filter changes must not become twenty presses of Back between you and the
    // page you came from.
    render(<DayOfScreen />)
    const before = window.history.length

    await userEvent.type(screen.getByPlaceholderText(/Find/i), 'alpha')
    expect(window.history.length).toBe(before)
  })
})
