// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { EventData } from '../src/domain/history'
import { forgetRememberedDay } from '../src/lib/dayFilter'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRoute } from './helpers/router'
import { resetUrl } from './helpers/url'
import type { Assignment, Jar, Location, Person, ScheduledLocation, Slot } from '../src/domain/types'

/**
 * Everything about one location, in one place.
 *
 * The counterpart of the person page, and it exists for the same reason: the facts about a
 * shop were spread over six screens — its address in the library, its priority in this
 * year's list, its takings on the money screen, its best hour on another tab of it, and its
 * hour-by-hour comparison behind a picker on the history page, which was the most
 * interesting thing about it and the hardest to reach.
 */

const SLOTS: Slot[] = [
  { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00 PM' },
  { id: 'fri-1800', day: 'fri', startMin: 18 * 60, endMin: 19 * 60, label: '6:00 PM' },
]

const braemar: Location = {
  id: 'braemar', name: 'Braemar', address: '640 Linden Drive', mapsUrl: '', lat: null, lng: null, groupCode: '1W',
  siteContact: { name: 'A Manager', role: 'Store manager', phone: '519-555-0123', email: 'm@example.org' },
  insurance: 'Certificate sent', comments: 'Use the north doors.',
  openHours: { fri: { openMin: 17 * 60, closeMin: 21 * 60 } }, aliases: [],
}

const people: Person[] = [
  {
    id: 'p-one', firstName: 'Alpha', lastName: 'One', section: 'cubs',
    parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  },
]

let library: Location[] = []
let yearLocations: ScheduledLocation[] = []
let assignments: Assignment[] = []
let jars: Jar[] = []
let history: EventData[] = []
let historyLoading = false
const saveLocation = vi.fn()

vi.mock('../src/lib/repo', () => ({
  useLocationLibrary: () => ({ data: library, loading: false, error: null }),
  useLocations: () => ({ data: yearLocations, loading: false, error: null }),
  useAssignments: () => ({ data: assignments, loading: false, error: null }),
  useJars: () => ({ data: jars, loading: false, error: null }),
  usePeople: () => ({ data: people, loading: false, error: null }),
  useEventHistory: (ids: string[]) => {
    // Honours the ids: the narrowing moved ahead of the fetch, so a mock that ignored
    // them would let that wiring be cut and still pass. See the history screen's test.
    asked = ids
    return {
      data: ids.flatMap((id) => history.filter((h) => h.event.id === id)),
      loading: historyLoading,
      error: null,
    }
  },
  saveLocation: (...a: unknown[]) => saveLocation(...a),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026', year: 2026 },
    // The chooser is built from this rather than from the loaded history, which is what
    // lets the page read only the years it shows. Derived, so the two cannot disagree.
    events: history.map((h) => h.event),
    loading: false,
    slots: SLOTS,
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
  eventLinkFor: () => '2026',
}))

/** Which years the page last asked to have read. */
let asked: string[] = []

let role = 'admin'

vi.mock('../src/lib/session', () => ({
  useSession: () => ({ user: { uid: 'u' }, role }),
  canEditSetup: (r: string) => r === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
  runsTheEvent: (r: string) => r === 'admin' || r === 'organizer',
}))

vi.mock('../src/lib/sections', () => ({
  useSections: () => ({
    sections: [],
    lookup: (id: string) => ({ id, name: id, youth: true, order: 1, tone: 'blue', aliases: [] }),
  }),
}))

const { LocationScreen } = await import('../src/ui/LocationScreen')

const shift = (id: string, slotId: string, over: Partial<Assignment> = {}): Assignment => ({
  id, slotId, locationId: 'braemar', personId: 'p-one',
  status: 'checkedIn', whereabouts: 'here', checkedInAt: 1, checkedOutAt: null,
  ...over,
})

const jar = (over: Partial<Jar> = {}): Jar => ({
  id: 'j1', jarNumber: 4, day: 'fri', locationId: 'braemar', personId: 'p-one',
  assignmentId: 'a1', assignmentIds: ['a1'], status: 'counted', issuedAt: 1, issuedBy: 'o',
  amount: 100, method: 'cash', countedBy: 'organizer', countedAt: 2, note: '',
  ...over,
})

/*
  Two years of the same shop, so the year-on-year figures have something to compare.

  Jars reach an hour through jar → shift → slot, so a jar with no shift behind it belongs to
  no hour at all — the same rule the money screen follows.
*/
const twoYears = () => {
  const event = (id: string, year: number) => ({
    id, name: `Apple Day ${year}`, slug: '', year,
    fridayDate: `${year}-10-02`, saturdayDate: `${year}-10-03`,
    support: [], supportNote: '', arrivalNote: '', baseLocationId: null,
    status: 'closed' as const, shiftMode: 'shifts' as const, shiftMinutes: 60,
    overlapMinutes: 0, schedule: { fri: { startMin: 17 * 60, endMin: 19 * 60 } },
  })
  return [
    {
      event: event('2025', 2025),
      slots: SLOTS,
      assignments: [shift('a', 'fri-1700', { personId: 'p-one' })],
      jars: [jar({ id: 'j1', assignmentId: 'a', assignmentIds: ['a'], amount: 100 })],
    },
    {
      event: event('2026', 2026),
      slots: SLOTS,
      assignments: [shift('b', 'fri-1700', { personId: 'p-one' })],
      jars: [jar({ id: 'j2', assignmentId: 'b', assignmentIds: ['b'], amount: 150 })],
    },
  ]
}

const renderFor = (id = 'braemar'): void => {
  render(
    <MemoryRoute path="/e/:eventId/location/:locationId" url={`/e/2026/location/${id}`}>
      <LocationScreen />
    </MemoryRoute>,
  )
}

beforeEach(() => {
  forgetRememberedDay()
  resetUrl()
  library = [braemar]
  yearLocations = [{ ...braemar, active: true, priority: 2 }]
  assignments = [shift('a1', 'fri-1700')]
  jars = [jar()]
  history = []
  asked = []
  historyLoading = false
  role = 'admin'
  saveLocation.mockReset()
  saveLocation.mockResolvedValue(undefined)
})

describe('what the page says about a location', () => {
  it('names it, with its address and a way to see where it is', () => {
    renderFor()
    expect(screen.getByRole('heading', { name: 'Braemar' })).toBeTruthy()
    expect(screen.getByText(/640 Linden Drive/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Map' })).toBeTruthy()
  })

  it('says whether this year is using it, and where in the order', () => {
    renderFor()
    expect(screen.getByText(/Used this year · priority 2/)).toBeTruthy()
  })

  it('says plainly when this year is not using it', () => {
    // A location dropped from the year still exists and still has a history worth reading.
    yearLocations = []
    renderFor()
    expect(screen.getByText(/Not used in 2026/)).toBeTruthy()
  })

  it('shows when it is open, which decides whether a shift can be staffed at all', () => {
    // It was on the page's own subject and nowhere on the page.
    renderFor()
    expect(screen.getByText(/Friday 5:00 PM/)).toBeTruthy()
  })

  it('tells a gap in the record apart from a decision', () => {
    /*
      Never recorded and closed all week are different facts: one is something to go and
      find out, the other is the answer.
    */
    library = [{ ...braemar, openHours: {} }]
    renderFor()
    expect(screen.getByText(/No hours recorded/)).toBeTruthy()

    library = [{ ...braemar, openHours: { fri: null } }]
    renderFor()
    expect(screen.getByText(/Closed all week/)).toBeTruthy()
  })

  it('shows the past names that keep four years on one row', () => {
    library = [{ ...braemar, aliases: ['Braemar Aldergrove', 'Braemar - 640 Linden'] }]
    renderFor()
    expect(screen.getByText(/Braemar Aldergrove/)).toBeTruthy()
  })

  it('says plainly when there is nothing recorded about arranging it', () => {
    // An empty card that renders nothing at all reads as a page that failed to load.
    library = [{ ...braemar, siteContact: null, insurance: '', comments: '' }]
    renderFor()
    expect(screen.getByText(/nothing to go on/)).toBeTruthy()
  })

  it('carries the things somebody rings ahead about', () => {
    renderFor()
    expect(screen.getByText('A Manager')).toBeTruthy()
    expect(screen.getByRole('link', { name: '519-555-0123' })).toBeTruthy()
    expect(screen.getByText(/Certificate sent/)).toBeTruthy()
    expect(screen.getByText(/north doors/)).toBeTruthy()
  })

  it('lists who is on the board there, linking each of them', () => {
    renderFor()
    const card = screen.getByRole('heading', { name: 'This event' }).closest('.card')!
    expect(within(card as HTMLElement).getByRole('link', { name: 'Alpha One' })).toBeTruthy()
    expect(within(card as HTMLElement).getByText(/Fri 5:00 PM/)).toBeTruthy()
  })

  it('lists the jars counted there', () => {
    renderFor()
    const card = screen.getByRole('heading', { name: 'Jars counted here' }).closest('.card')!
    expect(within(card as HTMLElement).getByText('Jar 4')).toBeTruthy()
    expect(within(card as HTMLElement).getByText('$100.00')).toBeTruthy()
  })

  it('says so when there is no location with that id', () => {
    // Past years reference locations by id, so a deleted one leaves rows pointing at nothing.
    renderFor('gone')
    expect(screen.getByRole('heading', { name: 'Not found' })).toBeTruthy()
  })

  it('reads the library, not this year’s list', () => {
    /*
      The bug the base of operations had: looking a location up in the year-scoped list
      reports it missing whenever the year is not using it.
    */
    yearLocations = []
    renderFor()
    expect(screen.queryByRole('heading', { name: 'Not found' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Braemar' })).toBeTruthy()
  })
})

describe('a location name is a way to reach its page', () => {
  it('is built through pathFor, like every other link in the app', async () => {
    const { LocationLink } = await import('../src/ui/LocationLink')
    render(<LocationLink name="Braemar" locationId="braemar" />)
    expect(screen.getByRole('link', { name: 'Braemar' }).getAttribute('href')).toBe(
      '/e/2026/location/braemar',
    )
  })

  it('falls back to plain text when there is nothing to link to', async () => {
    // Jars and assignments hold an id; a location deleted from the library leaves rows
    // behind that still name it.
    const { LocationLink } = await import('../src/ui/LocationLink')
    render(<LocationLink name="Somewhere" locationId="" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Somewhere')).toBeTruthy()
  })
})

describe('the thing this page was worth building for', () => {
  /*
    What a given hour at this door has been worth, year on year. It lived behind a picker on
    the history screen — the right figures in the wrong place, because "how has five o'clock
    at Braemar gone" is a question about one shop, and answering it meant leaving the shop
    and choosing it from a list.
  */

  /** The figures, which are behind the Table button — the card opens on the chart. */
  const hourTable = async (): Promise<HTMLElement> => {
    await userEvent.click(screen.getByRole('button', { name: 'Table' }))
    return screen.getByRole('heading', { name: /Hour by hour/ }).closest('.card')!
      .querySelector('table') as HTMLElement
  }

  beforeEach(() => {
    history = twoYears()
  })


  it('reads only the years it shows', () => {
    /*
      This page is reached by clicking a shop name from the board, the day-of table or the
      money screen, so it is opened far more often than the history screen. Reading every year
      the group has ever run, every time, to show the one before this is the cost worth
      avoiding.
    */
    render(<LocationScreen />)
    expect(asked).toEqual(['2025', '2026'])
  })

  it('compares each hour at this location across the years', async () => {
    renderFor()
    const row = within(await hourTable())
      .getAllByRole('row')
      .find((r) => r.textContent?.includes('5:00 PM'))!
    const cells = Array.from(row.querySelectorAll('td')).map((c) => c.textContent)

    expect(cells[1]).toBe('$100.00')
    expect(cells[2]).toBe('$150.00')
  })

  it('needs no picker, because the page already knows which location it is', () => {
    renderFor()
    expect(screen.queryByRole('button', { name: 'Location' })).toBeNull()
  })

  it('shows this location only, not a total across every door', async () => {
    // Kelmont's takings in 2026 must not appear on Braemar' page.
    history = [
      ...twoYears().slice(0, 1),
      {
        ...twoYears()[1]!,
        assignments: [
          shift('b', 'fri-1700', { personId: 'p-one' }),
          shift('c', 'fri-1800', { locationId: 'kelmont', personId: 'p-one' }),
        ],
        jars: [
          jar({ id: 'j2', assignmentId: 'b', assignmentIds: ['b'], amount: 150 }),
          jar({ id: 'j3', locationId: 'kelmont', assignmentId: 'c', assignmentIds: ['c'], amount: 50 }),
        ],
      },
    ]
    renderFor()

    const rows = within(await hourTable()).getAllByRole('row')
    const six = rows.find((r) => r.textContent?.includes('6:00 PM'))
    // Either the hour is absent for this door, or it is there with nothing in it.
    expect(six?.textContent ?? '').not.toContain('$50.00')
  })

  it('gives the totals year by year as well as the hours', () => {
    renderFor()
    const card = screen.getByRole('heading', { name: 'Year by year' }).closest('.card')!
    /*
      The table, not the card: the card also holds the "compared with" chooser, whose options
      are years too. Asking the card for the text "2025" cannot tell a row from an option.
    */
    const table = within(card as HTMLElement).getAllByRole('table')[0]!
    // Rows are labelled by the event's name, not its year.
    expect(within(table).getByText('Apple Day 2025')).toBeTruthy()
    expect(within(table).getByText('Apple Day 2026')).toBeTruthy()
    // The 2026 row: takings, hours, and what an hour there was worth.
    const row2026 = within(card as HTMLElement)
      .getAllByRole('row')
      .find((r) => r.textContent?.startsWith('Apple Day 2026'))!
    expect(row2026.textContent).toContain('$150.00')
  })

  it('says it is still adding up while the years are loading', () => {
    historyLoading = true
    renderFor()
    expect(screen.getByText(/Adding up every year/)).toBeTruthy()
  })
})

describe('getting to a location page', () => {
  it('is reachable by name from every table that lists one', async () => {
    /*
      The same rule person names follow: a name that links on one screen and not the next
      teaches somebody the wrong thing twice. Location names were inert text in a dozen
      tables while every person's name had been clickable for weeks.

      Read off the sources, because the claim is about which screens do it rather than about
      what any one of them renders.
    */
    const { readFileSync } = await import('node:fs')
    for (const name of [
      'MoneyScreen',
      'HistoryScreen',
      'JarsScreen',
      // The three that list locations as their subject rather than as a column, and were
      // the last to be left as plain text.
      'LocationsScreen',
      'LibraryScreen',
      'ScheduleScreen',
    ]) {
      expect(readFileSync(`src/ui/${name}.tsx`, 'utf8'), name).toContain('<LocationLink')
    }
  })

  it('has a route of its own', async () => {
    const { readFileSync } = await import('node:fs')
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("'location/:locationId'")
  })
})

describe('how the page is laid out', () => {
  beforeEach(() => {
    history = twoYears()
  })

  const headings = (): string[] =>
    Array.from(document.querySelectorAll('h2')).map((h) => h.textContent ?? '')

  it('leads with the years, because that is what the page is for', () => {
    // Who is on the board today is on the board. What this door has been worth over four
    // years is not anywhere else, and it is the reason to open this page at all.
    renderFor()
    const order = headings()
    expect(order.indexOf('Year by year')).toBeLessThan(order.indexOf('This event'))
    expect(order.indexOf('Hour by hour, year on year')).toBeLessThan(
      order.indexOf('This event'),
    )
  })

  it('keeps the practical details above them', () => {
    // Who to ring is what you came for when you came for that, and it is two lines.
    renderFor()
    const order = headings()
    expect(order.indexOf('Arranging it')).toBeLessThan(order.indexOf('Year by year'))
  })
})

describe('reading the hours as a shape or as figures', () => {
  beforeEach(() => {
    history = twoYears()
  })

  it('opens on the chart, which is what a glance wants', () => {
    renderFor()
    expect(screen.getByRole('img', { name: /Grouped bars/ })).toBeTruthy()
  })

  it('shows one or the other, never both', async () => {
    // Stacked, the card is twice as long and says one thing twice.
    renderFor()
    const card = () =>
      screen.getByRole('heading', { name: /Hour by hour/ }).closest('.card') as HTMLElement
    expect(card().querySelector('table')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(card().querySelector('table')).toBeTruthy()
    expect(within(card()).queryByRole('img', { name: /Grouped bars/ })).toBeNull()
  })

  it('keeps the choice in the address bar', async () => {
    renderFor()
    await userEvent.click(screen.getByRole('button', { name: 'Table' }))
    expect(window.location.search).toContain('as=table')
  })
})

describe('correcting a location from its own page', () => {
  /*
    The same gap the person page had: this is the screen somebody is on when they notice the
    manager's number is wrong, and it was the one place they could not fix it. The only way
    was back to the library to find the row again.

    It is the library's own editor, not a second one — two forms writing the same record
    would drift, and this one carries the opening hours and the past names.
  */

  const openEditor = async (): Promise<void> => {
    renderFor()
    await userEvent.click(screen.getByRole('button', { name: 'Edit details' }))
  }

  it('opens the library editor, filled in', async () => {
    await openEditor()
    const dialog = screen.getByRole('dialog')
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Braemar')
    expect((within(dialog).getByLabelText(/Address/) as HTMLInputElement).value).toBe(
      '640 Linden Drive',
    )
  })

  it('saves a corrected address', async () => {
    await openEditor()
    const address = screen.getByLabelText(/Address/)
    await userEvent.clear(address)
    await userEvent.type(address, '999 New Road')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveLocation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'braemar', address: '999 New Road' }),
    )
  })

  it('lets an organizer correct it', async () => {
    /*
      The library is shared across every year, which is an argument for keeping this to
      admins and not a good one: finding an address wrong happens standing outside the shop,
      and the person standing there should be able to fix it. Renames do not lose history:
      the roll-ups resolve old spellings through `aliases`, and the edit is on the log.

      Removing a location is the part that stays with an admin, and there is no button for
      it here.
    */
    role = 'organizer'
    renderFor()
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeTruthy()
  })

  it('will not save a location with no name', async () => {
    await openEditor()
    await userEvent.clear(screen.getByLabelText('Name'))
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('the page shows everything the record holds', () => {
  it('reads every field a location has', async () => {
    /*
      The omission this catches, and did not: the card showed the contact, the insurance and
      the notes and stopped there, so the opening hours — which decide whether a shift can be
      staffed at all — were on the page's own subject and nowhere on the page.

      Read off the type rather than listed by hand, so a field added to `Location` later
      fails here until somebody decides where it belongs. A field deliberately not shown
      needs a line below saying why.
    */
    const { readFileSync } = await import('node:fs')
    const types = readFileSync('src/domain/types.ts', 'utf8')
    const iface = types.slice(types.indexOf('export interface Location {'))
    const fields = [...iface.slice(0, iface.indexOf('\n}')).matchAll(/^\s{2}(\w+)\??:/gm)].map(
      (m) => m[1]!,
    )
    expect(fields.length).toBeGreaterThan(5)

    const page = readFileSync('src/ui/LocationScreen.tsx', 'utf8')
    const excused: Record<string, string> = {
      // The page is reached by it; showing it would be showing somebody the plumbing.
      id: 'the URL',
      // Read through mapLink(location), which derives one from the address when it is blank.
      mapsUrl: 'the Map button',
      /*
        The position is what puts a pin on the year's map, and the year's map is where it
        means something — a pair of coordinates on this page is a number nobody reads and a
        button nobody presses. Shown and corrected on the locations screen instead.
      */
      lat: "the year's map, on the locations screen",
      lng: "the year's map, on the locations screen",
    }

    const missing = fields.filter(
      (f) => !new RegExp(`location\\.${f}\\b`).test(page) && !Object.hasOwn(excused, f),
    )
    expect(missing).toEqual([])
  })
})

describe('the map on a location page', () => {
  it('shows the pin without complaining about a base', async () => {
    /*
      It said "No base of operations is set for this event, so this is just the location" —
      on a location page, inside an event that has one. Untrue, and beside the point: the
      question here is where this place is, not how to reach it from anywhere in particular.
    */
    renderFor()
    await userEvent.click(screen.getByRole('button', { name: 'Map' }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.queryByText(/No base of operations/)).toBeNull()
    expect(screen.queryByText(/Directions from/)).toBeNull()
  })
})
