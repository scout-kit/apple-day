// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { resetUrl } from './helpers/url'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventData } from '../src/domain/history'
import type { AppleDayEvent, Assignment, Jar, Slot } from '../src/domain/types'

/**
 * Year over year.
 *
 * The workbook could not do this: it changed its model every year and grouped locations by
 * a display string, so one shop appeared as three places. Here the library is shared and
 * its ids are stable, so the comparison is just arithmetic.
 */

let history: EventData[] = []
let loading = false

vi.mock('../src/lib/repo', () => ({
  useEventHistory: (ids: string[]) => {
    /*
      The mock honours the ids, because the ids are the thing under test.

      Narrowing happens before the fetch: the screen decides which years it needs and only
      those are read. A mock returning every year regardless would let that wiring be cut and
      still pass.
    */
    asked = ids
    return {
      data: ids.flatMap((id) => history.filter((h) => h.event.id === id)),
      loading,
      error: null,
    }
  },
  useLocationLibrary: () => ({
    data: [
      { id: 'braemar', name: 'Braemar' },
      { id: 'kelmont', name: 'Kelmont' },
    ],
    loading: false,
    error: null,
  }),
}))

// Location names link to their own page now, and the link is built through pathFor.
vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    eventId: '2026',
    event: { id: '2026', year: 2026 },
    /*
      The same events the fixture has history for.

      The screen builds its year chooser from this list rather than from the loaded history,
      which is what lets it load only the years it shows. Derived from the fixture so the
      two cannot disagree — a chooser offering a year with no history, or history for a year
      not in the chooser, is a state the app cannot actually be in.
    */
    events: history.map((h) => h.event),
    loading: false,
    slots: [],
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
  eventLinkFor: () => '2026',
}))

/** Which years the screen last asked to have read. */
let asked: string[] = []

const { HistoryScreen } = await import('../src/ui/HistoryScreen')

const SLOTS: Slot[] = [
  { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00 PM' },
  { id: 'fri-1800', day: 'fri', startMin: 18 * 60, endMin: 19 * 60, label: '6:00 PM' },
]

const event = (id: string, year: number): AppleDayEvent => ({
  id, name: `Apple Day ${year}`, slug: '', year,
  fridayDate: `${year}-10-02`, saturdayDate: `${year}-10-03`,
  support: [], supportNote: '', arrivalNote: '', baseLocationId: null, finishedAt: null,
  shiftMode: 'shifts', shiftMinutes: 60, overlapMinutes: 0,
  schedule: { fri: { startMin: 17 * 60, endMin: 19 * 60 } },
})

const shift = (id: string, slotId: string, locationId: string, personId: string): Assignment => ({
  id, slotId, locationId, personId,
  status: 'checkedIn', whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
})

const jar = (over: Partial<Jar> & { id: string; locationId: string }): Jar => ({
  jarNumber: 1, day: 'fri', personId: 'y01', assignmentId: null, assignmentIds: [],
  status: 'counted', issuedAt: 1, issuedBy: 'o', amount: 100, method: 'cash',
  note: '', countedBy: 'o', countedAt: 2,
  ...over,
})

/*
  Jars are linked to the shift they went out on.

  Money reaches an hour through jar → shift → slot, so a jar with no shift behind it belongs
  to no hour at all — the same rule the per-event by-hour table follows.
*/
const twoYears = (): EventData[] => [
  {
    event: event('2025', 2025),
    slots: SLOTS,
    assignments: [shift('a', 'fri-1700', 'braemar', 'y01')],
    jars: [jar({ id: 'j1', locationId: 'braemar', assignmentId: 'a', assignmentIds: ['a'], amount: 100 })],
  },
  {
    event: event('2026', 2026),
    slots: SLOTS,
    assignments: [
      shift('b', 'fri-1700', 'braemar', 'y01'),
      shift('c', 'fri-1800', 'kelmont', 'y02'),
    ],
    jars: [
      jar({ id: 'j2', locationId: 'braemar', assignmentId: 'b', assignmentIds: ['b'], amount: 150 }),
      jar({ id: 'j3', locationId: 'kelmont', assignmentId: 'c', assignmentIds: ['c'], amount: 50 }),
    ],
  },
]

beforeEach(() => {
  resetUrl()
  history = twoYears()
  loading = false
  asked = []
})

describe('every event side by side', () => {
  const eventsTable = (): HTMLElement =>
    screen.getByRole('columnheader', { name: 'Event' }).closest('table')!

  /** A row by the event it is about, rather than by where it happens to sit. */
  const eventRow = (name: string): HTMLElement =>
    Array.from(eventsTable().querySelectorAll<HTMLElement>('tbody tr')).find((r) =>
      r.textContent?.includes(name),
    )!

  it('lists them newest first, which is the one being asked about', () => {
    // The same order as the event list and the picker in the bar. The question at a table
    // is nearly always about this year, so it should not be at the bottom.
    render(<HistoryScreen />)
    const rows = Array.from(eventsTable().querySelectorAll('tbody tr'))
    expect(rows[0]!.textContent).toContain('Apple Day 2026')
    expect(rows[1]!.textContent).toContain('Apple Day 2025')
  })

  it('says how each year compares with the one before it, not the one after', () => {
    /*
      The trap in turning the table round. Each row is compared with the one that came
      earlier, which the list gives by position — so reversing before pairing would make
      "before" the year *after*, flipping every change on the table with nothing on screen
      to say so.
    */
    render(<HistoryScreen />)
    // $100 in 2025 to $200 in 2026 is a doubling, and it belongs to the 2026 row.
    expect(eventRow('Apple Day 2026').textContent).toContain('+100%')
  })

  it('has nothing to compare the earliest year against', () => {
    render(<HistoryScreen />)
    expect(eventRow('Apple Day 2025').textContent).toContain('—')
  })

  it('divides by hours somebody worked, and says so', () => {
    render(<HistoryScreen />)
    // 2026: $200 over 2 person-hours is $100 an hour. 2025's total is also $100, so read the
    // rate out of its own row rather than the whole table.
    const row = eventRow('Apple Day 2026')
    const cells = Array.from(row.querySelectorAll('td')).map((c) => c.textContent)
    expect(cells[1]).toBe('$200.00')
    expect(cells[4]).toBe('$100.00')
    expect(screen.getByText(/a shift nobody turned up for did not staff an hour/)).toBeTruthy()
  })

  it('draws a bar per event, without a running total across years', () => {
    render(<HistoryScreen />)
    // Years do not accumulate into each other, so a cumulative line would be meaningless.
    expect(document.querySelectorAll('.year-bar')).toHaveLength(2)
  })
})

describe('locations across the years', () => {
  const gridRow = (name: string): HTMLElement =>
    screen
      .getAllByRole('row')
      .find((r) => r.textContent?.startsWith(name))!

  it('keeps one row per location, with a cell per event', () => {
    render(<HistoryScreen />)
    const braemar = gridRow('Braemar')
    const cells = Array.from(braemar.querySelectorAll('td')).map((c) => c.textContent)
    expect(cells[1]).toBe('$100.00')
    expect(cells[2]).toBe('$150.00')
  })

  it('marks a year a location was not used differently from one it earned nothing in', () => {
    render(<HistoryScreen />)
    // Kelmont is new in 2026: 2025 is a dot, not a zero.
    const cells = Array.from(gridRow('Kelmont').querySelectorAll('td')).map((c) => c.textContent)
    expect(cells[1]).toBe('·')
  })

  it('says which way each location is going', () => {
    render(<HistoryScreen />)
    expect(gridRow('Braemar').textContent).toContain('+50%')
  })
})

describe('before there is anything to compare', () => {
  it('says so rather than drawing a chart of one bar', () => {
    history = [twoYears()[0]!]
    render(<HistoryScreen />)
    expect(screen.getByText(/Only one event so far/)).toBeTruthy()
  })

  it('says so when there are no events at all', () => {
    history = []
    render(<HistoryScreen />)
    expect(screen.getByText(/No events with any results yet/)).toBeTruthy()
  })

  it('waits rather than showing zeros while the years are being read', () => {
    loading = true
    render(<HistoryScreen />)
    expect(screen.getByText(/Adding up every year/)).toBeTruthy()
  })
})

/** Choose the one location the hour comparison is about. */
/**
 * Pick one location or several, then close the panel.
 *
 * Closed on the way out because the panel overlays the chips and the tables — leaving it
 * open means a location's name is on screen twice, and a query cannot tell the row in the
 * panel from the chip below it.
 */
const pickLocation = async (...names: string[]): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Locations' }))
  const panel = screen.getByRole('dialog', { name: 'Locations' })
  for (const name of names) {
    await userEvent.click(within(panel).getByRole('button', { name: new RegExp(name) }))
  }
  await userEvent.click(within(panel).getByRole('button', { name: 'Done' }))
}

describe('hours, year by year', () => {
  /** Both hour tables head their first column "Hour", so find this one by its heading. */
  /** The figures behind the chart, which sit inside a disclosure. */
  const hourTable = (): HTMLElement =>
    screen
      .getByRole('heading', { name: /hour by hour/i })
      .closest('.card')!
      .querySelector('table')!

  const hourRow = (label: string): HTMLElement =>
    within(hourTable())
      .getAllByRole('row')
      .find((r) => r.textContent?.startsWith(label))!

  it('compares the same clock hour across events', () => {
    render(<HistoryScreen />)
    const cells = Array.from(hourRow('Fri 5:00 PM').querySelectorAll('td')).map(
      (c) => c.textContent,
    )
    // 2025 took $100 in the 5pm hour; 2026 took $150 there.
    expect(cells[1]).toBe('$100.00')
    expect(cells[2]).toBe('$150.00')
  })

  it('says which way an hour is going', () => {
    render(<HistoryScreen />)
    expect(hourRow('Fri 5:00 PM').textContent).toContain('+50%')
  })

  it('narrows to one location, which is the question worth asking', async () => {
    /*
      "What is five o'clock at Braemar worth, year on year" is the thing this is for, and it is
      not answerable from a total. A sum of six doors cannot be read as any one of them.
    */
    render(<HistoryScreen />)
    await pickLocation('Kelmont')

    const cells = Array.from(hourRow('Fri 6:00 PM').querySelectorAll('td')).map(
      (c) => c.textContent,
    )
    // Kelmont only earned in 2026, and only in the 6pm hour.
    expect(cells[1]).toBe('$0.00')
    expect(cells[2]).toBe('$50.00')
  })

  it('names the location it is showing', async () => {
    render(<HistoryScreen />)
    expect(screen.getByRole('heading', { name: 'Hour by hour' })).toBeTruthy()

    await pickLocation('Kelmont')
    expect(screen.getByRole('heading', { name: 'Kelmont, hour by hour' })).toBeTruthy()
  })

  it('explains why it groups by the clock rather than by shift', () => {
    render(<HistoryScreen />)
    expect(screen.getByText(/straddling two hours is divided between them/)).toBeTruthy()
  })
})

describe('what the locations table is measuring', () => {
  const gridRow = (name: string): HTMLElement =>
    screen.getAllByRole('row').find((r) => r.textContent?.startsWith(name))!

  const cells = (name: string): (string | null)[] =>
    Array.from(gridRow(name).querySelectorAll('td')).map((c) => c.textContent)

  it('shows revenue to begin with', () => {
    render(<HistoryScreen />)
    expect(cells('Braemar')[1]).toBe('$100.00')
  })

  it('offers takings and what an hour there was worth, and nothing else', () => {
    /*
      There was an Hours button too. It answered a question about effort rather than about
      takings, which belongs to the money screen where an hour is being planned — not to a
      history read to decide where to stand next year.
    */
    render(<HistoryScreen />)
    expect(screen.getByRole('button', { name: 'Revenue' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Per hour' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Hours' })).toBeNull()
  })

  it('switches to what an hour there was worth', async () => {
    render(<HistoryScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Per hour' }))
    expect(cells('Braemar')[1]).toBe('$100.00')
    expect(cells('Braemar')[2]).toBe('$150.00')
  })

  it('changes what the trend column compares, not just the cells', async () => {
    /*
      The two measures have to be able to disagree for this to mean anything: Braemar is
      staffed for twice as long in 2026 and takes half as much again, so its takings are up
      by half while an hour spent there is worth a quarter less. A trend column stuck on
      revenue would call that a good year.
    */
    const [y2025, y2026] = twoYears()
    history = [
      y2025!,
      {
        ...y2026!,
        assignments: [...y2026!.assignments, shift('b2', 'fri-1800', 'braemar', 'y03')],
      },
    ]
    render(<HistoryScreen />)
    expect(gridRow('Braemar').textContent).toContain('+50%')

    await userEvent.click(screen.getByRole('button', { name: 'Per hour' }))
    expect(gridRow('Braemar').textContent).toContain('-25%')
  })

  it('says what the chosen measure means', async () => {
    render(<HistoryScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Per hour' }))
    expect(screen.getByText(/takings up by half is not a win/)).toBeTruthy()
  })

  it('still marks a year a location was not used, whatever is being measured', async () => {
    render(<HistoryScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Per hour' }))
    // Kelmont is new in 2026: 2025 is a dot, not a zero.
    expect(cells('Kelmont')[1]).toBe('·')
  })
})


describe('the hour comparison as a chart', () => {
  const chart = (): HTMLElement => screen.getByRole('img', { name: /Grouped bars/ })

  /** The hover target for one bar: an hour and a year. */
  const bar = (hour: string, year: string): HTMLElement =>
    within(chart())
      .getAllByRole('button')
      .find((b) => {
        // A series is labelled by the event's name — "Apple Day 2025", not "2025" — so
        // match the hour exactly and the year within whatever the event is called.
        const label = b.getAttribute('aria-label') ?? ''
        return label.startsWith(`${hour}, `) && label.includes(year)
      })!

  it('draws a bar per year at each hour', () => {
    // Two hundred rows of numbers carried the same figures and nobody could see a shape.
    render(<HistoryScreen />)
    expect(bar('5:00 PM', '2025')).toBeTruthy()
    expect(bar('5:00 PM', '2026')).toBeTruthy()
  })

  it('names which colour is which year', () => {
    render(<HistoryScreen />)
    const legend = document.querySelector('.bar-legend')!
    expect(legend.textContent).toContain('2025')
    expect(legend.textContent).toContain('2026')
  })

  it('gives an exact figure on hover, not just a height', async () => {
    render(<HistoryScreen />)
    const readout = () =>
      chart().parentElement!.querySelector('[aria-live="polite"]')!.textContent!

    expect(readout()).toContain('Hover a bar')
    await userEvent.hover(bar('5:00 PM', '2026'))
    expect(readout()).toContain('$150')
    expect(readout()).toContain('2026')
  })

  it('carries every figure in a label, so the chart is not pointer-only', () => {
    render(<HistoryScreen />)
    expect(bar('5:00 PM', '2025').getAttribute('aria-label')).toContain('$100')
  })

  it('marks an hour a year did not run, rather than drawing it as nothing earned', () => {
    /*
      A zero-height bar and an hour that was never scheduled look identical, and they are
      different facts — one is a bad hour, the other is an hour nobody was sent to.
    */
    history = [
      { ...twoYears()[0]!, slots: [SLOTS[0]!] },
      twoYears()[1]!,
    ]
    render(<HistoryScreen />)
    expect(bar('6:00 PM', '2025').getAttribute('aria-label')).toContain('not run')
  })

  it('follows the location, so it draws what the table below it says', async () => {
    render(<HistoryScreen />)
    expect(bar('5:00 PM', '2026').getAttribute('aria-label')).toContain('$150')

    await pickLocation('Kelmont')
    // Kelmont earned nothing at five, in either year.
    expect(bar('5:00 PM', '2026').getAttribute('aria-label')).toContain('$0')
  })

  it('follows the measure buttons', async () => {
    render(<HistoryScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Per hour' }))
    // A rate now, not a total: 2025 took $100 at five over one staffed hour.
    expect(bar('5:00 PM', '2025').getAttribute('aria-label')).toContain('$100')
  })
})

describe('the every-event table', () => {
  it('has no column counting jars', () => {
    // How many tins went out is not something one year can be judged against another by.
    render(<HistoryScreen />)
    const headers = Array.from(document.querySelectorAll('thead th')).map((h) => h.textContent)
    expect(headers).not.toContain('Jars')
    // The figures that do compare are still there.
    expect(headers).toContain('Revenue')
    expect(headers).toContain('Per hour')
  })
})

describe('finding a location in the year-by-year table', () => {
  /*
    Twenty-one locations across four years is a wide table and a long one, and "how has
    Braemar done" was a question that could only be answered by reading down it.
  */

  const trendTable = (): HTMLElement =>
    screen.getByRole('columnheader', { name: 'Location' }).closest('table') as HTMLElement

  it('narrows the rows to what was typed', async () => {
    render(<HistoryScreen />)
    expect(within(trendTable()).getByText('Kelmont')).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Find a location'), 'braemar')

    expect(within(trendTable()).getByText('Braemar')).toBeTruthy()
    expect(within(trendTable()).queryByText('Kelmont')).toBeNull()
  })

  it('leaves the hour comparison below it alone', async () => {
    /*
      Choosing which door the hours are about is a different question from finding a row in
      the table above, and a search that quietly changed it would change the figures under
      it without saying so.
    */
    render(<HistoryScreen />)
    await userEvent.type(screen.getByLabelText('Find a location'), 'braemar')

    expect(screen.getByRole('heading', { name: 'Hour by hour' })).toBeTruthy()
  })
})

describe('one hour at one door, year on year', () => {
  /*
    The question this section is for, in the words it was asked in: what is five o'clock at
    Braemar worth, against five o'clock at Braemar last year.

    It could not be answered before. The control was a checkbox per location with everything
    ticked by default, and the figures were the sum of whatever was ticked — a total across
    six doors, which cannot be read as any one of them.
  */

  const hourTable = (): HTMLElement =>
    screen.getByRole('heading', { name: /hour by hour/i }).closest('.card')!
      .querySelector('table') as HTMLElement

  const row = (label: string): HTMLElement =>
    within(hourTable()).getAllByRole('row').find((r) => r.textContent?.startsWith(label))!

  it('shows one location’s hours against the same hours last year', async () => {
    render(<HistoryScreen />)
    await pickLocation('Braemar')

    const cells = Array.from(row('Fri 5:00 PM').querySelectorAll('td')).map((c) => c.textContent)
    expect(cells[1]).toBe('$100.00')
    expect(cells[2]).toBe('$150.00')
  })

  it('keeps the location in the address bar, so the comparison can be sent to somebody', async () => {
    render(<HistoryScreen />)
    await pickLocation('Kelmont')
    expect(window.location.search).toContain('at=kelmont')
  })

  it('opens on the location the address bar names', () => {
    window.history.replaceState(null, '', '/e/2026/history?at=kelmont')
    render(<HistoryScreen />)
    expect(screen.getByRole('heading', { name: 'Kelmont, hour by hour' })).toBeTruthy()
  })

  it('adds every location together when none is chosen', () => {
    // Still worth having: the shape of the whole evening, rather than one door's.
    render(<HistoryScreen />)
    const cells = Array.from(row('Fri 6:00 PM').querySelectorAll('td')).map((c) => c.textContent)
    // Kelmont's $50 at six in 2026 is in the total; on its own it would be the only figure.
    expect(cells[2]).toBe('$50.00')
  })
})

/**
 * How far back a lookback looks.
 *
 * Every event at once was the wrong default. The question asked of this screen is almost
 * always "how are we doing against last year", and each passing year added a series nobody
 * asked about — the table got wider and the chart harder to read. The wide sweep is kept,
 * one click away, because "the year Braemar doubled" is a real question, just not the first.
 */
describe('what this year is held against', () => {
  const threeYears = (): EventData[] => [
    {
      event: event('2024', 2024),
      slots: SLOTS,
      assignments: [shift('z', 'fri-1700', 'braemar', 'y01')],
      jars: [jar({ id: 'j0', locationId: 'braemar', assignmentId: 'z', assignmentIds: ['z'], amount: 70 })],
    },
    ...twoYears(),
  ]

  /** The years the table is actually built from, in the order it shows them. */
  const yearsOnScreen = (): string[] => {
    const table = screen.getByRole('columnheader', { name: 'Event' }).closest('table')!
    return Array.from(table.querySelectorAll('tbody tr')).map(
      (r) => /20\d\d/.exec(r.textContent ?? '')?.[0] ?? '',
    )
  }

  it('shows the year before this one, and not the ones before that', () => {
    history = threeYears()
    render(<HistoryScreen />)
    expect(yearsOnScreen()).toEqual(['2026', '2025'])
  })

  it('reads only the years it shows', () => {
    /*
      The point of the whole arrangement. Three years on file, two on screen, two read —
      and it stays two however many years the group goes on to run.
    */
    history = threeYears()
    render(<HistoryScreen />)
    expect(asked).toEqual(['2025', '2026'])
  })

  it('reads every year only when every year is asked for', () => {
    history = threeYears()
    render(<HistoryScreen />)
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'all' } })
    expect(asked).toEqual(['2024', '2025', '2026'])
  })

  it('offers a year in the chooser before that year has been read', () => {
    /*
      The chooser comes from the event list, not from the loaded history — otherwise it
      could only offer years already fetched, and every year would have to be fetched to
      offer any, which is the loop this replaced.
    */
    history = threeYears()
    render(<HistoryScreen />)
    const options = Array.from(
      (screen.getByLabelText('Compare with') as HTMLSelectElement).options,
    ).map((o) => o.value)
    expect(options).toContain('2024')
    expect(asked).not.toContain('2024')
  })

  it('can be pointed at any other year', () => {
    history = threeYears()
    render(<HistoryScreen />)

    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: '2024' } })
    expect(yearsOnScreen()).toEqual(['2026', '2024'])
  })

  it('still offers every year at once', () => {
    history = threeYears()
    render(<HistoryScreen />)

    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'all' } })
    expect(yearsOnScreen()).toEqual(['2026', '2025', '2024'])
  })

  it('names the year that "last time" means', () => {
    // "Compared with the time before" tells nobody which year they are looking at.
    history = threeYears()
    render(<HistoryScreen />)
    expect(screen.getByLabelText('Compare with').textContent).toContain('2025 (last time)')
  })

  it('offers no chooser when there is only one event', () => {
    history = [twoYears()[1]!]
    render(<HistoryScreen />)
    expect(screen.queryByLabelText('Compare with')).toBeNull()
  })
})

describe('comparing several doors at once', () => {
  /** The columns of the hour table, which follow the chart's series exactly. */
  const hourHeadings = (): string[] => {
    const table = screen
      .getAllByRole('table')
      .find((t) => t.querySelector('th')?.textContent === 'Hour')!
    return Array.from(table.querySelectorAll('thead th')).map((h) => h.textContent ?? '')
  }

  it('keeps the doors apart rather than adding them up', async () => {
    /*
      The question a multi-select is for: which door is worth staffing at five. Summed, two
      shops are one number that is neither of them.
    */
    render(<HistoryScreen />)
    await pickLocation('Braemar', 'Kelmont')

    const headings = hourHeadings()
    expect(headings.some((h) => h.includes('Braemar'))).toBe(true)
    expect(headings.some((h) => h.includes('Kelmont'))).toBe(true)
  })

  it('carries the years alongside, so a door can be read against itself', async () => {
    // Both halves of the question at once — which door, and whether it is changing.
    render(<HistoryScreen />)
    await pickLocation('Braemar', 'Kelmont')

    const braemar = hourHeadings().filter((h) => h.includes('Braemar'))
    expect(braemar).toHaveLength(2)
    expect(braemar.join(' ')).toContain('Apple Day 2025')
    expect(braemar.join(' ')).toContain('Apple Day 2026')
  })

  it('says how many are being compared', async () => {
    render(<HistoryScreen />)
    await pickLocation('Braemar', 'Kelmont')
    expect(screen.getByRole('heading', { name: /2 locations, hour by hour/ })).toBeTruthy()
  })

  it('stays on the year comparison for a single door', async () => {
    // One location is still a question about years, and that chart was already right.
    render(<HistoryScreen />)
    await pickLocation('Kelmont')
    expect(hourHeadings().some((h) => h.includes('·'))).toBe(false)
    expect(screen.getByRole('heading', { name: /Kelmont, hour by hour/ })).toBeTruthy()
  })

  it('sends the whole comparison in the address bar', async () => {
    render(<HistoryScreen />)
    await pickLocation('Braemar', 'Kelmont')
    expect(window.location.search).toContain('at=braemar%2Ckelmont')
  })

  it('can be put back to every location', async () => {
    /*
      Reported: once a location was picked there was no way back to all of them, because the
      only thing the list offered was a different location.
    */
    render(<HistoryScreen />)
    await pickLocation('Kelmont')
    expect(screen.getByRole('heading', { name: /Kelmont, hour by hour/ })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Locations' }))
    const panel = screen.getByRole('dialog', { name: 'Locations' })
    await userEvent.click(within(panel).getByRole('button', { name: /Every location/ }))

    expect(screen.getByRole('heading', { name: 'Hour by hour' })).toBeTruthy()
  })

  it('drops one without disturbing the others', async () => {
    render(<HistoryScreen />)
    await pickLocation('Braemar', 'Kelmont')

    await userEvent.click(screen.getByRole('button', { name: 'Stop showing Kelmont' }))
    expect(screen.getByRole('heading', { name: /Braemar, hour by hour/ })).toBeTruthy()
  })

  it('ignores an id for a location that is no longer there', async () => {
    /*
      A link sent last year naming a shop since removed from the library. Better to show the
      doors it still knows than a column with nothing at its head.
    */
    window.history.replaceState(null, '', '/e/2026/history?at=braemar,gone-away')
    render(<HistoryScreen />)
    expect(screen.getByRole('heading', { name: /Braemar, hour by hour/ })).toBeTruthy()
  })
})
