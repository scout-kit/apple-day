// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { resetUrl } from './helpers/url'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAllSlots } from '../src/domain/slots'
import type { Assignment, Jar, Person, ScheduledLocation } from '../src/domain/types'

/**
 * The money screen's by-location table.
 *
 * It renders the list that is meant to explain the total at the top of the screen, so every
 * location that saw money has to appear in it. Rendering only the *rankable* rows meant a
 * location with money but no staffed hours was counted in the total, flagged in a warning,
 * and missing from the table — three places disagreeing about the same money.
 */

const SLOTS = buildAllSlots()

const location = (id: string, name: string): ScheduledLocation => ({
  id, name, address: '', mapsUrl: '', lat: null, lng: null, groupCode: '',
  siteContact: null, insurance: '', comments: '', aliases: [],
  active: true, priority: 1,
  openHours: { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null },
})

const locations = [location('braemar', 'Braemar'), location('lounge', 'Staff lounge')]

const people: Person[] = [
  {
    id: 'p-one', firstName: 'Alpha', lastName: 'One', section: 'cubs',
    parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  },
]

// Braemar is staffed for two hours; the lounge took money with nobody rostered. Two rather
// than one so the total and the per-hour rate cannot coincidentally be the same number.
//
// Both are checked in: hours mean hours somebody worked, so a shift nobody turned up for
// contributes nothing and would make this fixture measure the wrong thing.
const worked = (over: Partial<Assignment> & { id: string; slotId: string }): Assignment => ({
  locationId: 'braemar',
  personId: 'p-one',
  status: 'checkedIn',
  whereabouts: 'here',
  checkedInAt: 1,
  checkedOutAt: null,
  ...over,
})

let assignments: Assignment[] = [
  worked({ id: 'a1', slotId: 'fri-1700' }),
  worked({ id: 'a2', slotId: 'fri-1800' }),
]

const jar = (over: Partial<Jar> & { id: string }): Jar => ({
  jarNumber: 1, day: 'fri', locationId: 'braemar', personId: 'p-one',
  assignmentId: 'a1', assignmentIds: ['a1'], status: 'counted', issuedAt: 1, issuedBy: 'o',
  amount: 100, method: 'cash', note: '', countedBy: 'o', countedAt: 2,
  ...over,
})

/*
  Rebuilt for every test.

  It used to be a shared const that individual tests pushed to and popped from, so a test
  that failed part-way left its extra jar behind and took two later tests down with it — a
  single failure reported as three.
*/
let jars: Jar[] = []

const repairAssignment = vi.fn()
const relocateJar = vi.fn()
const unassign = vi.fn()
const deleteJar = vi.fn()

vi.mock('../src/lib/repo', () => ({
  useLocations: () => ({ data: locations, loading: false, error: null }),
  // The library, which is what existence is judged against.
  useLocationLibrary: () => ({ data: locations, loading: false, error: null }),
  repairAssignment: (...a: unknown[]) => repairAssignment(...a),
  relocateJar: (...a: unknown[]) => relocateJar(...a),
  unassign: (...a: unknown[]) => unassign(...a),
  deleteJar: (...a: unknown[]) => deleteJar(...a),
  usePeople: () => ({ data: people, loading: false, error: null }),
  useAssignments: () => ({ data: assignments, loading: false, error: null }),
  useJars: () => ({ data: jars, loading: false, error: null }),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026', year: 2026 },
    slots: SLOTS,
    // Names on these screens link to the person's page, and the link is built
    // through pathFor so it survives an event reached by its link name.
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
}))

vi.mock('../src/lib/csv', () => ({ downloadFile: vi.fn(), toCsv: vi.fn(() => '') }))

beforeEach(() => {
  resetUrl()
  jars = [
    jar({ id: 'j1', amount: 100 }),
    jar({ id: 'j2', jarNumber: 2, locationId: 'lounge', assignmentId: null, assignmentIds: [], amount: 86.55 }),
  ]
  assignments = [worked({ id: 'a1', slotId: 'fri-1700' }), worked({ id: 'a2', slotId: 'fri-1800' })]
  for (const fn of [repairAssignment, relocateJar, unassign, deleteJar]) {
    fn.mockReset()
    fn.mockResolvedValue(undefined)
  }
})

const { MoneyScreen } = await import('../src/ui/MoneyScreen')

/**
 * Open one of the screen's views.
 *
 * The detail sits behind a tab now: four tables on one page meant whatever you had come to
 * look at was always underneath something else.
 */
const showTab = async (label: string): Promise<void> => {
  await userEvent.click(screen.getByRole('tab', { name: label }))
}

const byLocationTable = (): HTMLElement =>
  screen.getByRole('columnheader', { name: 'Location' }).closest('table')!

describe('every location that saw money is listed', () => {
  it('includes one with no staffed hours', () => {
    render(<MoneyScreen />)
    const table = within(byLocationTable())

    expect(table.getByText('Braemar')).toBeDefined()
    // Previously only in the warning above, never in the table.
    expect(table.getByText('Staff lounge')).toBeDefined()
    expect(table.getByText('$86.55')).toBeDefined()
  })

  it('leaves its rate blank instead of inventing one', () => {
    render(<MoneyScreen />)
    const row = within(byLocationTable()).getByText('Staff lounge').closest('tr')!

    // No rank, no rate — the 2025 books gave this row $86.55/hour and 4th place.
    expect(row.textContent).not.toContain('86.55/')
    const cells = Array.from(row.querySelectorAll('td')).map((c) => c.textContent)
    expect(cells[0]).toBe('—')
  })

  it('still warns about it separately', () => {
    render(<MoneyScreen />)
    expect(screen.getByText(/Revenue with no staffed hours/)).toBeDefined()
  })

  it('adds up to the figure at the top of the screen', () => {
    render(<MoneyScreen />)
    const table = byLocationTable()
    const totals = within(table.querySelector('tfoot')!)

    // 100 + 86.55: the table now reconciles with the headline total rather than being
    // short by whatever had no hours.
    expect(totals.getByText('$186.55')).toBeDefined()
    expect(totals.getByText('Total')).toBeDefined()
    // And the overall rate divides by the hours actually staffed, not by the rows.
    expect(totals.getByText('$93.28')).toBeDefined()
  })

  it('ranks only what can be ranked', () => {
    render(<MoneyScreen />)
    const rows = Array.from(byLocationTable().querySelectorAll('tbody tr'))
    expect(rows).toHaveLength(2)
    // Ranked rows first, unrankable at the end.
    expect(rows[0]!.textContent).toContain('Braemar')
    expect(rows[1]!.textContent).toContain('Staff lounge')
  })
})


describe('hours mean hours somebody worked', () => {
  const hoursStat = (): string =>
    screen.getByText('staffed hours').closest('.stat')!.textContent!

  const setBasis = async (label: string): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: label }))
  }

  it('counts a checked-in shift', () => {
    render(<MoneyScreen />)
    expect(hoursStat()).toContain('2')
  })

  it('does not count a shift nobody turned up for', () => {
    // The defect: revenue per hour divided by the board rather than by attendance, so a
    // location whose volunteers never arrived still reported a full rate — and reported it
    // lower than the locations that did turn up, which is backwards.
    assignments = [
      { ...assignments[0]!, status: 'confirmed', checkedInAt: null },
      { ...assignments[1]!, status: 'confirmed', checkedInAt: null },
    ]
    render(<MoneyScreen />)
    expect(hoursStat()).toContain('0')
  })

  it('counts a shift that went out without being checked in by hand', () => {
    // A jar in their hands is proof they were there, whatever the attendance column says.
    assignments = [
      { ...assignments[0]!, status: 'confirmed', checkedInAt: null, whereabouts: 'out' },
      { ...assignments[1]!, status: 'confirmed', checkedInAt: null, whereabouts: 'back' },
    ]
    render(<MoneyScreen />)
    expect(hoursStat()).toContain('2')
  })

  it('does not count a no-show even once a jar has been issued to them', () => {
    assignments = [
      { ...assignments[0]!, status: 'noShow', whereabouts: 'out' },
      { ...assignments[1]!, status: 'noShow', whereabouts: 'here' },
    ]
    render(<MoneyScreen />)
    expect(hoursStat()).toContain('0')
  })

  it('can be switched back to the board, for a year with no check-ins recorded', async () => {
    assignments = [
      { ...assignments[0]!, status: 'confirmed', checkedInAt: null },
      { ...assignments[1]!, status: 'confirmed', checkedInAt: null },
    ]
    render(<MoneyScreen />)
    expect(hoursStat()).toContain('0')

    await setBasis('Scheduled')
    expect(hoursStat()).toContain('2')

    await setBasis('Worked')
    expect(hoursStat()).toContain('0')
  })

  it('says why everything is zero rather than leaving it unexplained', () => {
    assignments = [{ ...assignments[0]!, status: 'confirmed', checkedInAt: null }]
    render(<MoneyScreen />)
    expect(
      screen.getByText(/No shift here has anybody checked in against it/),
    ).toBeTruthy()
  })

  it('stays quiet when there are no shifts at all', () => {
    assignments = []
    render(<MoneyScreen />)
    expect(screen.queryByText(/No shift here has anybody checked in/)).toBeNull()
  })

  it('applies the same basis to the per-person hours', async () => {
    assignments = [
      { ...assignments[0]!, status: 'confirmed', checkedInAt: null },
      { ...assignments[1]!, status: 'confirmed', checkedInAt: null },
    ]
    render(<MoneyScreen />)
    await showTab('People')
    // "all hours on the page" — the person table divides by the same shifts as the
    // headline, so the two cannot disagree.
    const person = screen.getByText('Alpha One').closest('tr')!
    expect(person.textContent).not.toContain('2.0')
  })
})

describe('the by-youth table', () => {
  const youthTable = (): HTMLElement =>
    screen.getByRole('columnheader', { name: 'Youth' }).closest('table')!

  it('shows a name, a total and hours, and nothing else', async () => {
    render(<MoneyScreen />)
    await showTab('People')
    const headers = Array.from(youthTable().querySelectorAll('thead th')).map(
      (h) => h.textContent,
    )
    expect(headers).toEqual(['Youth', 'Revenue', 'Hours'])
  })

  it('has a cell for every header', async () => {
    // It did not: five headers over four cells, so "Out" was a column of nothing and every
    // figure under it was reading against the wrong heading.
    render(<MoneyScreen />)
    await showTab('People')
    const table = youthTable()
    const headers = table.querySelectorAll('thead th').length
    for (const row of Array.from(table.querySelectorAll('tbody tr'))) {
      expect(row.querySelectorAll('td')).toHaveLength(headers)
    }
  })

  it('links each youth to their own page', async () => {
    // "Who raised the most" is exactly the moment somebody wants to know what else that
    // person worked.
    render(<MoneyScreen />)
    await showTab('People')

    const link = within(youthTable()).getByRole('link', { name: 'Alpha One' })
    expect(link.getAttribute('href')).toBe('/e/2026/person/p-one')
  })
})

describe('the by-hour breakdown', () => {
  const hourTable = (): HTMLElement =>
    screen.getByRole('columnheader', { name: 'Hour' }).closest('table')!

  const hourRow = (label: string): HTMLElement =>
    within(hourTable())
      .getAllByRole('row')
      .find((r) => r.textContent?.includes(label))!

  it('breaks the money down by the hour it came in', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    // j1 ($100) went out on a1, the 5pm shift; the lounge jar has no shift behind it.
    expect(hourRow('5:00').textContent).toContain('$100.00')
  })

  it('shows the hour that took the most', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    expect(screen.getByText(/Best hour/).textContent).toContain('$100.00')
  })

  it('keeps money with no shift out of the hours but inside the total', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    // $86.55 belongs to no hour, so it is called out rather than spread across the day…
    expect(screen.getByText(/nothing to say which hour it came in/)).toBeTruthy()
    // …and the footer still reconciles with the headline figure.
    const totals = within(hourTable().querySelector('tfoot')!)
    expect(totals.getByText('$186.55')).toBeDefined()
  })

  it('separates money taken from money earned per person out', async () => {
    // Two people out in the 5pm hour rather than one halves the rate without changing the
    // takings — the distinction that says how thinly an hour can be staffed.
    assignments = [
      worked({ id: 'a1', slotId: 'fri-1700' }),
      worked({ id: 'a2', slotId: 'fri-1700', personId: 'p-two' }),
    ]
    render(<MoneyScreen />)
    await showTab('Hours')
    const row = hourRow('5:00')
    expect(row.textContent).toContain('$100.00')
    expect(row.textContent).toContain('$50.00')
  })

  it('uses the same hours basis as the rest of the page', async () => {
    assignments = [{ ...assignments[0]!, status: 'confirmed', checkedInAt: null }]
    render(<MoneyScreen />)
    await showTab('Hours')
    // Nobody checked in, so the hour has no revenue attributed and no rate.
    expect(hourRow('5:00').textContent).not.toContain('$100.00')
  })
})

describe('the per-hour figure at the top', () => {
  const stat = (label: string): string =>
    screen.getByText(label).closest('.stat')!.textContent!

  it('is the takings over the hours actually run', () => {
    // Two slots worked, $186.55 taken across both jars: $93.28 an hour. One person working
    // both hours makes the two rates coincide here — the test below is what separates them.
    render(<MoneyScreen />)
    expect(stat('per hour')).toContain('$93.28')
  })

  it('sits alongside the per-person-hour rate rather than replacing it', () => {
    render(<MoneyScreen />)
    expect(stat('per person-hour')).toContain('$93.28')
  })

  it('divides by the hour, not by the head', () => {
    // Two people out in the same single hour. Per person-hour halves; per hour does not,
    // because the hour still took the same money.
    assignments = [
      worked({ id: 'a1', slotId: 'fri-1700' }),
      worked({ id: 'a2', slotId: 'fri-1700', personId: 'p-two' }),
    ]
    render(<MoneyScreen />)
    expect(stat('per hour')).toContain('$186.55')
    expect(stat('per person-hour')).toContain('$93.28')
  })

  it('is blank before anybody has worked an hour', () => {
    assignments = []
    render(<MoneyScreen />)
    expect(stat('per hour')).not.toContain('$')
  })
})

describe('records that point at something gone', () => {
  const warning = (): HTMLElement =>
    screen.getByText(/at something that no longer exists/).closest('.note')!

  it('says what the record was for instead of printing an id', () => {
    // A youth deleted after being scheduled. The old warning said "unknown personId
    // p-test" and left you to work out the rest.
    assignments = [worked({ id: 'fri-1700_braemar_p-gone', slotId: 'fri-1700', personId: 'p-gone' })]
    render(<MoneyScreen />)

    const text = warning().textContent!
    expect(text).toContain('Shift with no youth')
    // What survives is named, so it is clear what is being decided about.
    expect(text).toContain('Braemar')
  })

  it('explains why a deleted youth cannot be recovered', () => {
    assignments = [worked({ id: 'fri-1700_braemar_p-gone', slotId: 'fri-1700', personId: 'p-gone' })]
    render(<MoneyScreen />)

    expect(warning().textContent).toContain('no longer exists')
    expect(
      within(warning()).queryByRole('button', { name: 'Fix' }),
    ).toBeNull()
  })

  it('repairs a shift that still knows what it was for', async () => {
    // Fields lost, name intact: everything it names still exists, so it can be rebuilt.
    assignments = [
      worked({ id: 'fri-1700_braemar_p-one', slotId: '', locationId: '', personId: '' }),
    ]
    render(<MoneyScreen />)

    await userEvent.click(within(warning()).getByRole('button', { name: 'Fix' }))
    expect(repairAssignment).toHaveBeenCalledWith('2026', 'fri-1700_braemar_p-one', {
      slotId: 'fri-1700',
      locationId: 'braemar',
      personId: 'p-one',
    })
  })

  it('warns what deleting a shift does to the numbers before doing it', async () => {
    assignments = [worked({ id: 'fri-1700_braemar_p-gone', slotId: 'fri-1700', personId: 'p-gone' })]
    render(<MoneyScreen />)

    await userEvent.click(within(warning()).getByRole('button', { name: 'Delete' }))
    // A shift is an hour of staffing; removing it changes the location's rate.
    const dialog = screen.getByText('Delete this record?').closest('.modal') as HTMLElement
    expect(within(dialog).getByText(/revenue per hour/)).toBeTruthy()
    expect(unassign).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(unassign).toHaveBeenCalledWith('2026', 'fri-1700_braemar_p-gone')
  })

  it('can move a jar whose location has gone rather than lose the money', async () => {
    jars.push(jar({ id: 'j3', locationId: 'vanished', assignmentId: null, assignmentIds: [], amount: 12 }))
    render(<MoneyScreen />)

    // The same type-to-search picker as everywhere else a location is chosen.
    await userEvent.click(within(warning()).getByRole('button', { name: 'Location for j3' }))
    await userEvent.click(await screen.findByRole('option', { name: /Braemar/ }))
    expect(relocateJar).toHaveBeenCalledWith('2026', 'j3', 'braemar')
  })

  it('stays silent for a healthy schedule', () => {
    render(<MoneyScreen />)
    expect(screen.queryByText(/at something that no longer exists/)).toBeNull()
  })
})

describe('one question at a time', () => {
  it('opens on where the money came from', () => {
    render(<MoneyScreen />)
    expect(screen.getByRole('columnheader', { name: 'Location' })).toBeTruthy()
    // Four tables on one page meant the thing you came to read was always below something.
    expect(screen.queryByRole('columnheader', { name: 'Youth' })).toBeNull()
    expect(screen.queryByRole('columnheader', { name: 'Hour' })).toBeNull()
  })

  it('keeps the headline and the warnings whatever view is showing', async () => {
    jars.push(jar({ id: 'jout', status: 'out', amount: null, assignmentId: null, assignmentIds: [] }))
    render(<MoneyScreen />)
    await showTab('People')

    // These are what you need whether you asked for them or not.
    expect(screen.getByText('revenue')).toBeTruthy()
    expect(screen.getByText(/still out/)).toBeTruthy()
    jars.pop()
  })

  it('switches between views', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    expect(screen.getByRole('columnheader', { name: 'Hour' })).toBeTruthy()
    // The grid on this tab also has a Location column, so check the heading instead.
    expect(screen.queryByRole('heading', { name: 'By location' })).toBeNull()

    await showTab('People')
    expect(screen.getByRole('columnheader', { name: 'Youth' })).toBeTruthy()
  })

  it('marks the open view for a screen reader, not just visually', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    expect(screen.getByRole('tab', { name: 'Hours' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('false')
  })
})

describe('location by hour', () => {
  const gridTable = (): HTMLElement =>
    screen.getByRole('columnheader', { name: /Location$/ }).closest('table')!

  const gridRow = (name: string): HTMLElement =>
    within(gridTable())
      .getAllByRole('row')
      .find((r) => r.textContent?.startsWith(name))!

  it('answers which door at what time, which neither other table can', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')

    // Braemar took $100 in the 5pm hour and nothing at 6pm.
    const row = gridRow('Braemar')
    const cells = Array.from(row.querySelectorAll('td')).map((c) => c.textContent)
    expect(cells[1]).toBe('$100.00')
    expect(cells[2]).toBe('$0')
  })

  it('marks an hour nobody was there differently from an hour that earned nothing', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')

    // "$0" means somebody stood there and got nothing; "·" means nobody was sent.
    const lounge = gridRow('Staff lounge')
    const cells = Array.from(lounge.querySelectorAll('td')).map((c) => c.textContent)
    expect(cells[2]).toBe('·')
  })

  it('highlights each location’s best hour', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    const best = gridRow('Braemar').querySelectorAll('td.hour-best')
    expect(best).toHaveLength(1)
    expect(best[0]!.textContent).toBe('$100.00')
  })

  it('totals down the columns and reconciles with the headline', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    const totals = within(gridTable().querySelector('tfoot')!)
    expect(totals.getByText('$186.55')).toBeTruthy()
  })

  it('reads down in the same order as the Locations list', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    const names = Array.from(gridTable().querySelectorAll('tbody td.sticky-name')).map(
      (c) => c.textContent,
    )
    // Braemar and the lounge in the order they were given, not ranked by takings.
    expect(names).toEqual(['Braemar', 'Staff lounge'])
  })

  it('shows a location that is only in the data, so nothing hides', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    // The lounge took money with nobody rostered; it still needs a row.
    expect(gridRow('Staff lounge')).toBeTruthy()
  })
})

describe('the evening as a chart', () => {
  it('draws the hours with a running total', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')

    const chart = screen.getByRole('img', { name: /Revenue by hour/ })
    // One bar per hour of the event.
    expect(chart.querySelectorAll('rect.chart-bar').length).toBeGreaterThan(0)
    // And a line, which is what answers "are we on track".
    expect(chart.querySelector('path.chart-line')).toBeTruthy()
  })

  it('names the total in its label, for anyone who cannot see it', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    expect(
      screen.getByRole('img', { name: /Revenue by hour/ }).getAttribute('aria-label'),
    ).toMatch(/Total \$\d/)
  })
})

describe('reading a figure off the chart', () => {
  const chart = (): HTMLElement => screen.getByRole('img', { name: /Revenue by hour/ })

  /**
   * The hover target for one hour.
   *
   * Labels read "Friday 5:00 PM – 6:00 PM: $100.00, running total $100.00" — the hour is a
   * range, so match on how it starts.
   */
  const hourTarget = (startsWith: string): HTMLElement =>
    within(chart())
      .getAllByRole('button')
      .find((b) => b.getAttribute('aria-label')?.startsWith(startsWith))!

  it('shows the total on the chart, not only in the caption', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    // $100 of the $186.55 can be placed in an hour; the rest has no shift behind it.
    expect(chart().querySelector('text.chart-total')!.textContent).toBe('$100')
  })

  it('names the total to the cent for anyone who cannot see it', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    expect(chart().getAttribute('aria-label')).toContain('$100.00')
  })

  it('says why the line stops below the figure at the top of the screen', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')
    // Otherwise the chart looks like it has lost $86.55.
    expect(screen.getByText(/belongs to no hour and is not drawn/)).toBeTruthy()
  })

  it('gives the exact figure when an hour is hovered', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')

    // Rounded axis labels are fine; a figure somebody is reading off is not.
    await userEvent.hover(hourTarget('Friday 5:00 PM'))
    expect(within(chart()).getByText('$100.00')).toBeTruthy()
    expect(screen.getByText(/took/).textContent).toContain('$100.00')
  })

  it('gives the running total alongside it, which is the other question', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')

    await userEvent.hover(hourTarget('Friday 6:00 PM'))
    // 5pm took $100 and 6pm nothing, so the running total is still $100.
    expect(screen.getByText(/running total/).textContent).toContain('$100.00')
  })

  it('goes back to the summary when the pointer leaves', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')

    await userEvent.hover(hourTarget('Friday 5:00 PM'))
    await userEvent.unhover(hourTarget('Friday 5:00 PM'))
    expect(screen.getByText(/Hover an hour for its exact figure/)).toBeTruthy()
  })

  it('can be read with a keyboard, and by a screen reader, without hovering', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')

    // Every hour carries its own figure, so the chart is not pointer-only.
    expect(hourTarget('Friday 5:00 PM').getAttribute('aria-label')).toContain('$100.00')
    expect(hourTarget('Friday 5:00 PM').getAttribute('tabindex')).toBe('0')
  })

  it('gives an hour that took nothing something to aim at', async () => {
    render(<MoneyScreen />)
    await showTab('Hours')

    // The hours worth asking about are often the ones with no bar to hover.
    await userEvent.hover(hourTarget('Friday 6:00 PM'))
    expect(screen.getByText(/took/).textContent).toContain('$0.00')
  })
})

describe('finding one row rather than reading down the table', () => {
  /*
    The ranking means a location is never where you last saw it, so "what did Braemar take"
    could only be answered by scrolling. Twenty-one locations and a hundred-odd volunteers
    is past the point where a list is a lookup.
  */

  const locationTable = (): HTMLElement =>
    screen.getByRole('columnheader', { name: 'Location' }).closest('table') as HTMLElement

  it('filters the locations by name', async () => {
    render(<MoneyScreen />)
    const before = within(locationTable()).getAllByRole('row').length

    await userEvent.type(screen.getByLabelText('Find a location'), 'braemar')
    const after = within(locationTable()).getAllByRole('row').length

    expect(after).toBeLessThan(before)
    expect(within(locationTable()).getByText(/Braemar/)).toBeTruthy()
  })

  it('needs every word, in any order, as everywhere else in the app', async () => {
    render(<MoneyScreen />)
    await userEvent.type(screen.getByLabelText('Find a location'), 'staff lounge')
    expect(within(locationTable()).getByText(/Staff lounge/)).toBeTruthy()
  })

  it('filters the youth by name', async () => {
    render(<MoneyScreen />)
    await showTab('People')

    await userEvent.type(screen.getByLabelText('Find a youth'), 'alpha')
    expect(screen.getByText(/Alpha One/)).toBeTruthy()
  })

  it('filters the youth by section', async () => {
    // The other way somebody is looked up: not "who is this" but "who are the Cubs".
    render(<MoneyScreen />)
    await showTab('People')

    const sections = screen.getByLabelText('Section')
    expect(within(sections).getByText('Every section')).toBeTruthy()
  })

  it('says so when nothing matches, rather than showing an empty table', async () => {
    render(<MoneyScreen />)
    await showTab('People')

    await userEvent.type(screen.getByLabelText('Find a youth'), 'nobodyatall')
    expect(screen.getByText(/Nobody matches that/)).toBeTruthy()
  })
})

describe('where the export button sits', () => {
  it('is beside the heading, not below the search', async () => {
    /*
      All three were in one row, and the button wrapped underneath the search box — which
      read as though it exported what had been found rather than the table. It exports the
      table.
    */
    render(<MoneyScreen />)
    const heading = screen.getByRole('heading', { name: 'By location' })
    const row = heading.parentElement as HTMLElement

    expect(within(row).getByRole('button', { name: 'Export CSV' })).toBeTruthy()
    expect(within(row).queryByLabelText('Find a location')).toBeNull()
  })

  it('is not disabled or hidden by a search that finds nothing', async () => {
    // It exports the table, so a search that matches nothing must not take it away.
    render(<MoneyScreen />)
    await userEvent.type(screen.getByLabelText('Find a location'), 'nowhereatall')

    const button = screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement
    expect(button.disabled).toBe(false)
  })
})

describe('finding a location by hour', () => {
  it('narrows that grid too, with the same box', async () => {
    // Missed on the first pass: the grid ignored the search entirely.
    render(<MoneyScreen />)
    await showTab('Hours')

    await userEvent.type(screen.getByLabelText('Find a location by hour'), 'braemar')
    const grid = screen
      .getByRole('columnheader', { name: 'Location' })
      .closest('table') as HTMLElement
    expect(within(grid).getByText('Braemar')).toBeTruthy()
    expect(within(grid).queryByText('Staff lounge')).toBeNull()
  })
})
