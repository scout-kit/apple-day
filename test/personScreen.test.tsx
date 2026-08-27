// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRoute } from './helpers/router'
import type { Assignment, Jar, Person, Signup, Slot } from '../src/domain/types'
import { forgetRememberedDay } from '../src/lib/dayFilter'
import type { VolunteerRequest } from '../src/domain/requests'

/**
 * Everything about one person.
 *
 * Every other screen answers a question about the event. This answers a question about a
 * person, which is what somebody at the table is holding when a parent rings up.
 */

const SLOTS: Slot[] = [
  { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00 PM' },
  { id: 'fri-1800', day: 'fri', startMin: 18 * 60, endMin: 19 * 60, label: '6:00 PM' },
]

const edsger: Person = {
  id: 'p-one', firstName: 'Edsger', lastName: 'Dijkstra', section: 'beavers',
  parentName: 'Ada Dijkstra', parentEmail: 'ada@example.org', parentPhone: '519-555-0100',
  pairWithPersonId: null,
}

let people: Person[] = []
let signups: Signup[] = []
let assignments: Assignment[] = []
let jars: Jar[] = []
let requests: VolunteerRequest[] = []
const savePersonWithPairing = vi.fn()

/** Passes exist only once the schedule has been published; some tests take them away. */
let passes: { token: string; personId: string; displayName: string; shiftCount: number }[] = []

let role = 'admin'

vi.mock('../src/lib/session', () => ({
  useSession: () => ({ user: { uid: 'u-organizer', email: 'o@example.org' }, role }),
  runsTheEvent: (r: string) => r === 'admin' || r === 'organizer',
}))

vi.mock('../src/lib/repo', () => ({
  usePeople: () => ({ data: people, loading: false, error: null }),
  useSignups: () => ({ data: signups, loading: false, error: null }),
  useAssignments: () => ({ data: assignments, loading: false, error: null }),
  useJars: () => ({ data: jars, loading: false, error: null }),
  useLocations: () => ({
    data: [{ id: 'braemar', name: 'Braemar' }],
    loading: false,
    error: null,
  }),
  usePasses: () => ({ data: passes, loading: false, error: null }),
  useVolunteerRequests: () => ({ data: requests, loading: false, error: null }),
  savePersonWithPairing: (...a: unknown[]) => savePersonWithPairing(...a),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026' },
    slots: SLOTS,
    // Names on these screens link to the person's page, and the link is built
    // through pathFor so it survives an event reached by its link name.
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
}))

const BEAVERS = {
  id: 'beavers', name: 'Beavers', youth: true, order: 1, tone: 'blue' as const, aliases: [],
}

vi.mock('../src/lib/sections', () => ({
  // SectionPill resolves a section id to its name and colour through this.
  useSections: () => ({ sections: [BEAVERS], lookup: () => BEAVERS }),
}))

const { PersonScreen } = await import('../src/ui/PersonScreen')

const shift = (id: string, slotId: string, over: Partial<Assignment> = {}): Assignment => ({
  id, slotId, locationId: 'braemar', personId: 'p-one',
  status: 'checkedIn', whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
  ...over,
})

const renderFor = (personId = 'p-one'): void => {
  render(
    <MemoryRoute path="/e/:eventId/person/:personId" url={`/e/2026/person/${personId}`}>
      <PersonScreen />
    </MemoryRoute>,
  )
}

beforeEach(() => {
  role = 'admin'
  forgetRememberedDay()
  passes = [{ token: 'tok-one', personId: 'p-one', displayName: 'Edsger Dijkstra', shiftCount: 1 }]
  savePersonWithPairing.mockReset()
  savePersonWithPairing.mockResolvedValue(undefined)
  people = [edsger]
  signups = [
    {
      id: 'su-1', personId: 'p-one',
      availability: { fri: ['fri-1700'] },
      attendingWithYouth: false, notes: 'Back by seven please', sourceRow: 4, importedAt: 1,
    },
  ]
  assignments = [shift('a1', 'fri-1700')]
  jars = [
    {
      id: 'j1', jarNumber: 4, day: 'fri', locationId: 'braemar', personId: 'p-one',
      assignmentId: 'a1', assignmentIds: ['a1'], status: 'counted', issuedAt: 1,
      issuedBy: 'o', amount: 120.5, method: 'cash', note: '', countedBy: 'o', countedAt: 2,
    },
  ]
  requests = []
})

describe('who they are', () => {
  it('names them, their section and their parent’s number', () => {
    // What somebody reaches for when a parent rings up.
    renderFor()
    expect(screen.getByRole('heading', { name: /Edsger Dijkstra/ })).toBeTruthy()
    expect(screen.getByText('Beavers')).toBeTruthy()
    expect(screen.getByRole('link', { name: '519-555-0100' }).getAttribute('href')).toBe(
      'tel:519-555-0100',
    )
    expect(screen.getByRole('link', { name: 'ada@example.org' })).toBeTruthy()
  })

  it('warns when there is no way to reach them', () => {
    people = [{ ...edsger, parentName: '', parentEmail: '', parentPhone: '' }]
    renderFor()
    expect(screen.getByText(/cannot be reached on the day/)).toBeTruthy()
  })

  it('links to whoever they work alongside', () => {
    people = [
      { ...edsger, pairWithPersonId: 'p-two' },
      { ...edsger, id: 'p-two', firstName: 'Ken', pairWithPersonId: 'p-one' },
    ]
    renderFor()
    const link = screen.getByRole('link', { name: /Ken/ })
    expect(link.getAttribute('href')).toBe('/e/2026/person/p-two')
  })

  it('says so plainly for an id that matches nobody', () => {
    renderFor('p-gone')
    expect(screen.getByText(/No youth or leader with that id/)).toBeTruthy()
  })
})

describe('this event', () => {
  it('lists their shifts with where, when and what state', () => {
    renderFor()
    const row = screen.getByRole('row', { name: /Friday 5:00 PM/ })
    expect(row.textContent).toContain('Braemar')
    expect(row.textContent).toContain('back')
  })

  it('shows the jar they carried and what was in it', () => {
    renderFor()
    // The "raised" stat shows the same figure, so read it out of the shift row.
    const row = screen.getByRole('row', { name: /Friday 5:00 PM/ })
    expect(row.textContent).toContain('#4')
    expect(within(row).getByText('$120.50')).toBeTruthy()
  })

  it('marks a jar that has not come back yet', () => {
    jars = [{ ...jars[0]!, status: 'out', amount: null }]
    renderFor()
    expect(screen.getByText(/still out/)).toBeTruthy()
  })

  it('says plainly when they are not on the board', () => {
    assignments = []
    renderFor()
    expect(screen.getByText('Not on the board.')).toBeTruthy()
  })
})

describe('what they offered against what they were given', () => {
  it('marks an hour they were given but never offered', () => {
    // Somebody the board is relying on who never said yes to that hour.
    assignments = [shift('a2', 'fri-1800')]
    renderFor()
    const given = screen.getByTitle('Given this hour, but never offered it')
    expect(given.textContent).toContain('6')
  })

  it('marks an hour they offered and are working', () => {
    renderFor()
    expect(screen.getByTitle('Offered and working').textContent).toContain('5')
  })

  it('marks an hour they offered that nobody used', () => {
    assignments = []
    renderFor()
    expect(screen.getByTitle('Offered, not used').textContent).toContain('5')
  })

  it('says when they never filled the form in at all', () => {
    signups = []
    renderFor()
    expect(screen.getByText(/added to the board by hand/)).toBeTruthy()
  })

  it('carries their note across from the form', () => {
    renderFor()
    expect(screen.getByText(/Back by seven please/)).toBeTruthy()
  })
})

describe('what they have asked for', () => {
  it('shows their own requests, newest first', () => {
    requests = [
      {
        id: 'r1', passToken: 'tok-one', kind: 'cancel', slotId: '', message: 'older',
        createdAt: 100, handledAt: 5, handledBy: 'organizer', handledByEmail: '',
      },
      {
        id: 'r2', passToken: 'tok-one', kind: 'swap', slotId: '', message: 'newer',
        createdAt: 200, handledAt: null, handledBy: '', handledByEmail: '',
      },
    ]
    renderFor()
    const items = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(items[0]).toContain('newer')
    expect(items[0]).toContain('still waiting')
    expect(items[1]).toContain('dealt with')
  })

  it('says nothing at all when they have asked for nothing', () => {
    renderFor()
    expect(screen.queryByText(/What they have asked for/)).toBeNull()
  })

  it('ignores somebody else’s requests', () => {
    requests = [
      {
        id: 'r1', passToken: 'tok-other', kind: 'cancel', slotId: '', message: 'not theirs',
        createdAt: 100, handledAt: null, handledBy: '', handledByEmail: '',
      },
    ]
    renderFor()
    expect(screen.queryByText(/not theirs/)).toBeNull()
  })
})

describe('there is no record across years, deliberately', () => {
  it('says nothing about earlier events', () => {
    /*
      People are stored under the event they took part in, so there is no identity spanning
      years to look anything up by. That is the point: a register of children outliving the
      event it was collected for is a liability rather than a convenience. Year-over-year
      lives on locations, which have a shared identity because a shop is not a child.
    */
    renderFor()
    expect(screen.queryByText(/Every year/)).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Raised' })).toBeNull()
  })
})

describe('getting to this page', () => {
  it('is linked from a name on the day-of table and the requests inbox', () => {
    // The point of a person page is being reachable from wherever somebody is named.
    const dayOf = readFileSync('src/ui/DayOfScreen.tsx', 'utf8')
    // The link from a request now lives in the notification's detail modal, where the rest
    // of the contact information is.
    const details = readFileSync('src/ui/NotificationsScreen.tsx', 'utf8')
    for (const [name, source] of [['DayOfScreen', dayOf], ['NotificationsScreen', details]]) {
      expect(source, name as string).toMatch(/pathFor\(`person\/\$\{[a-zA-Z.]+\}`\)/)
    }
  })
})

describe('correcting their details', () => {
  /*
    This is the screen an organizer is on when a parent rings up, so it is where a
    misspelled name or a wrong number gets noticed — and it was the one place you could
    not fix either. The only way was back to the roster to find the row again.

    It is the roster's own editor, not a second one: two forms writing the same six fields
    would drift, and the one on the roster already handles the pairing bookkeeping.
  */

  const openEditor = async (): Promise<void> => {
    renderFor()
    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }))
  }

  it('opens the same editor the roster uses', async () => {
    await openEditor()

    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('First name') as HTMLInputElement).value).toBe('Edsger')
    expect((within(dialog).getByLabelText('Phone') as HTMLInputElement).value).toBe('519-555-0100')
    // Section and pairing are on it too, not just the name.
    expect(within(dialog).getByLabelText('Section')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Choose someone' })).toBeTruthy()
  })

  it('saves a corrected phone number against this event', async () => {
    await openEditor()

    const phone = screen.getByLabelText('Phone')
    await userEvent.clear(phone)
    await userEvent.type(phone, '519-555-0199')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(savePersonWithPairing).toHaveBeenCalledWith(
      '2026',
      expect.objectContaining({ id: 'p-one', parentPhone: '519-555-0199' }),
      [],
    )
  })

  it('offers the editor as the way to fix missing contact details', async () => {
    // Otherwise the warning is a dead end: it says nobody can reach them and offers nowhere
    // to go.
    people = [{ ...edsger, parentName: '', parentEmail: '', parentPhone: '' }]
    renderFor()

    await userEvent.click(screen.getByRole('button', { name: /No contact details on file/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('will not save somebody with no first name', async () => {
    await openEditor()

    await userEvent.clear(screen.getByLabelText('First name'))
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('their own link', () => {
  /*
    This screen already held the tokens — it used them to find that person's requests — and
    then said nothing about them. So the one page built to answer questions about a
    volunteer could not answer "what did we actually send them?", which is what somebody
    reaches for when a parent rings to say the link does not work.
  */

  it('shows the link and a QR once the schedule has been published', async () => {
    renderFor()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Their link' })).toBeDefined())
    const link = screen.getByText(/\/p\/tok-one$/)
    expect(link.getAttribute('href')).toContain('/p/tok-one')
    // Drawn in the browser, so it arrives a tick later.
    await waitFor(() =>
      expect(screen.getByAltText(/QR code opening/).getAttribute('src')).toMatch(/^data:image/),
    )
  })

  it('says nothing at all before anything has been published', () => {
    // No pass exists yet, and this screen must never mint or guess a token.
    passes = []
    renderFor()
    expect(screen.queryByRole('heading', { name: 'Their link' })).toBeNull()
  })

  it('shows the pass belonging to this person, not somebody else’s', () => {
    passes = [
      { token: 'tok-other', personId: 'p-two', displayName: 'Someone Else', shiftCount: 1 },
      { token: 'tok-one', personId: 'p-one', displayName: 'Edsger Dijkstra', shiftCount: 1 },
    ]
    renderFor()

    expect(screen.getByText(/\/p\/tok-one$/)).toBeTruthy()
    expect(screen.queryByText(/tok-other/)).toBeNull()
  })

  it('warns that the link is a key, not just an address', () => {
    // It is a bearer token: whoever holds it sees this volunteer's shifts.
    renderFor()
    expect(screen.getByText(/key, not/)).toBeTruthy()
  })
})
