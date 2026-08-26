import { describe, expect, it } from 'vitest'
import {
  buildHistory,
  changeFrom,
  eventLabels,
  eventTotals,
  hourlyTrends,
  hourlyTrendsSplit,
  locationTrends,
  seriesKey,
  stackBands,
  stackTotals,
} from '../src/domain/history'
import type { EventData } from '../src/domain/history'
import type { AppleDayEvent, Assignment, Jar, Slot } from '../src/domain/types'

/**
 * One event compared with the others.
 *
 * Last year's results are the evidence for this year's choices — the reason the app holds
 * several events at all — and nothing put them side by side. The location library is shared
 * and its ids are stable, so a location keeps its identity across years with no name
 * matching at all.
 */

const slots = (day: 'fri' | 'sat', hours: number[]): Slot[] =>
  hours.map((h) => ({
    id: `${day}-${String(h).padStart(2, '0')}00`,
    day,
    startMin: h * 60,
    endMin: (h + 1) * 60,
    label: `${h}:00`,
  }))

const event = (id: string, over: Partial<AppleDayEvent> = {}): AppleDayEvent => ({
  id,
  name: `Apple Day ${id}`,
  slug: '',
  year: Number(id) || 0,
  fridayDate: `${id}-10-02`,
  saturdayDate: `${id}-10-03`,
  support: [],
  supportNote: '',
  arrivalNote: '',
  baseLocationId: null,
  shiftMode: 'shifts',
  shiftMinutes: 60,
  overlapMinutes: 0,
  schedule: { fri: { startMin: 17 * 60, endMin: 19 * 60 } },
  ...over,
})

const shift = (
  id: string,
  slotId: string,
  locationId: string,
  personId: string,
  over: Partial<Assignment> = {},
): Assignment => ({
  id, slotId, locationId, personId,
  status: 'checkedIn', whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
  ...over,
})

const jar = (over: Partial<Jar> & { id: string; locationId: string }): Jar => ({
  jarNumber: 1, day: 'fri', personId: 'y01', assignmentId: null, assignmentIds: [],
  status: 'counted', issuedAt: 1, issuedBy: 'o', amount: 100, method: 'cash',
  note: '', countedBy: 'o', countedAt: 2,
  ...over,
})

/** 2025: one hour at Sobeys, $100. */
const y2025: EventData = {
  event: event('2025'),
  slots: slots('fri', [17, 18]),
  assignments: [shift('a', 'fri-1700', 'sobeys', 'y01')],
  jars: [jar({ id: 'j1', locationId: 'sobeys', amount: 100 })],
}

/** 2026: two hours at Sobeys and one at Walmart, $150 and $50. */
const y2026: EventData = {
  event: event('2026'),
  slots: slots('fri', [17, 18]),
  assignments: [
    shift('b', 'fri-1700', 'sobeys', 'y01'),
    shift('c', 'fri-1800', 'sobeys', 'y02'),
    shift('d', 'fri-1700', 'walmart', 'y03'),
  ],
  jars: [
    jar({ id: 'j2', locationId: 'sobeys', amount: 150 }),
    jar({ id: 'j3', locationId: 'walmart', personId: 'y03', amount: 50 }),
  ],
}

describe('one event’s totals', () => {
  it('adds up the money, the hours and the people', () => {
    const t = eventTotals(y2026)
    expect(t.revenue).toBe(200)
    expect(t.staffedHours).toBe(3)
    expect(t.volunteers).toBe(3)
    expect(t.earningLocations).toBe(2)
  })

  it('divides by hours somebody worked, not by the board', () => {
    // The same basis the money screen defaults to: a shift nobody turned up for did not
    // staff an hour.
    const absent: EventData = {
      ...y2025,
      assignments: [shift('a', 'fri-1700', 'sobeys', 'y01', { status: 'noShow', whereabouts: 'here' })],
    }
    const t = eventTotals(absent)
    expect(t.staffedHours).toBe(0)
    expect(t.revenuePerHour).toBeNull()
  })

  it('leaves the rate blank rather than reporting the raw total', () => {
    expect(eventTotals({ ...y2025, assignments: [] }).revenuePerHour).toBeNull()
  })

  it('does not report how many jars an event used', () => {
    /*
      Removed: it counted tins, which is a function of how many the group owns and how many
      times each went out. A year with forty jars going out twice reads as half a year with
      eighty going out once, for the same money and the same hours — and it sat in the
      year-by-year table beside figures that do compare, which is what made it look like
      one of them.
    */
    expect(eventTotals(y2026)).not.toHaveProperty('jarCount')
  })

  it('ignores a jar still out there', () => {
    const withOut: EventData = {
      ...y2025,
      jars: [...y2025.jars, jar({ id: 'j9', locationId: 'sobeys', status: 'out', amount: null })],
    }
    expect(eventTotals(withOut).revenue).toBe(100)
  })
})

describe('the history', () => {
  it('reads oldest first, which is the direction a trend runs', () => {
    expect(buildHistory([y2026, y2025]).map((h) => h.eventId)).toEqual(['2025', '2026'])
  })

  it('orders by the event’s own dates, not by name or id', () => {
    // A spring bottle drive in April 2026 comes before Apple Day in October 2026, even
    // though "2026" sorts before "spring".
    const spring = { ...y2025, event: event('spring', { fridayDate: '2026-04-10', year: 0 }) }
    expect(buildHistory([y2026, spring]).map((h) => h.eventId)).toEqual(['spring', '2026'])
  })

  it('handles a single event with nothing to compare against', () => {
    expect(buildHistory([y2026])).toHaveLength(1)
  })
})

describe('changeFrom', () => {
  it('is the signed fraction between two figures', () => {
    expect(changeFrom(100, 150)).toBe(0.5)
    expect(changeFrom(200, 100)).toBe(-0.5)
  })

  it('is nothing when there is nothing to compare with', () => {
    expect(changeFrom(null, 100)).toBeNull()
    expect(changeFrom(100, null)).toBeNull()
  })

  it('is nothing rather than infinite when last time was zero', () => {
    expect(changeFrom(0, 100)).toBeNull()
  })
})

describe('a location across the years', () => {
  const names = new Map([
    ['sobeys', 'Sobeys'],
    ['walmart', 'Walmart'],
  ])

  it('keeps one row per location without any name matching', () => {
    // The library is global and its ids are stable, which is what the workbook's fuzzy name
    // matching was trying and failing to achieve.
    const { rows } = locationTrends([y2025, y2026], names)
    expect(rows.map((r) => r.locationId)).toEqual(['sobeys', 'walmart'])
  })

  it('puts each event in its own cell', () => {
    const { rows } = locationTrends([y2025, y2026], names)
    const sobeys = rows.find((r) => r.locationId === 'sobeys')!
    expect(sobeys.cells.map((c) => c.revenue)).toEqual([100, 150])
    expect(sobeys.cells.map((c) => c.staffedHours)).toEqual([1, 2])
  })

  it('says how the most recent year compares with the one before', () => {
    const { rows } = locationTrends([y2025, y2026], names)
    expect(rows.find((r) => r.locationId === 'sobeys')!.changes.revenue).toBe(0.5)
  })

  it('has no comparison for a location used only once', () => {
    // Walmart is new in 2026; calling that an infinite rise would be nonsense.
    const { rows } = locationTrends([y2025, y2026], names)
    expect(rows.find((r) => r.locationId === 'walmart')!.changes.revenue).toBeNull()
  })

  it('compares the years a location was actually used, skipping a year off', () => {
    /*
      A location rested for a year must not read as a collapse to zero and back.

      Sobeys is used in 2025 and 2027 but not 2026, so the comparison is 2025 against 2027.
      Comparing against the previous *event* instead would divide by a year the location was
      never open for, which is a null, not a rise.
    */
    const y2026WithoutSobeys: EventData = {
      ...y2026,
      assignments: [shift('d', 'fri-1700', 'walmart', 'y03')],
      jars: [jar({ id: 'j3', locationId: 'walmart', personId: 'y03', amount: 50 })],
    }
    const y2027: EventData = {
      event: event('2027'),
      slots: slots('fri', [17]),
      assignments: [shift('e', 'fri-1700', 'sobeys', 'y01')],
      jars: [jar({ id: 'j4', locationId: 'sobeys', amount: 150 })],
    }
    const { rows } = locationTrends([y2025, y2026WithoutSobeys, y2027], names)
    const sobeys = rows.find((r) => r.locationId === 'sobeys')!
    // 2025 gave 100, 2027 gave 150 — a rise of half, with 2026 simply not counted.
    expect(sobeys.changes.revenue).toBe(0.5)
    // And the empty year is still an empty cell, not a zero.
    expect(sobeys.cells.map((c) => c.revenue)).toEqual([100, 0, 150])
  })

  it('ranks by what the location has brought in overall', () => {
    const { rows } = locationTrends([y2025, y2026], names)
    expect(rows[0]!.locationId).toBe('sobeys')
  })

  it('shows a location that only appears in the data', () => {
    const stray: EventData = {
      ...y2026,
      jars: [jar({ id: 'j5', locationId: 'staff-lounge', amount: 20 })],
    }
    const { rows } = locationTrends([stray], names)
    expect(rows.map((r) => r.name)).toContain('staff-lounge')
  })
})


describe('takings by clock hour, year over year', () => {
  /*
    Events do not share their slots. One year runs 60-minute shifts on the hour; the next
    overlaps them by fifteen and starts every 45 minutes, so its slot ids are different
    strings covering different spans. Comparing by hour across years cannot use slots at all.
  */
  const onTheHour: EventData = {
    event: event('2025'),
    slots: slots('fri', [17, 18]),
    assignments: [
      shift('a', 'fri-1700', 'sobeys', 'y01'),
      shift('b', 'fri-1800', 'sobeys', 'y01'),
    ],
    jars: [
      jar({ id: 'j1', locationId: 'sobeys', assignmentId: 'a', assignmentIds: ['a'], amount: 100 }),
      jar({ id: 'j2', locationId: 'sobeys', assignmentId: 'b', assignmentIds: ['b'], amount: 60 }),
    ],
  }

  /** The same evening, cut up differently: 60-minute shifts starting every 45. */
  const overlapped: EventData = {
    event: event('2026'),
    slots: [
      { id: 'fri-a', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00' },
      { id: 'fri-b', day: 'fri', startMin: 17 * 60 + 45, endMin: 18 * 60 + 45, label: '5:45' },
    ],
    assignments: [
      shift('c', 'fri-a', 'sobeys', 'y01'),
      shift('d', 'fri-b', 'sobeys', 'y02'),
    ],
    jars: [
      jar({ id: 'j3', locationId: 'sobeys', assignmentId: 'c', assignmentIds: ['c'], amount: 120 }),
      jar({ id: 'j4', locationId: 'sobeys', assignmentId: 'd', assignmentIds: ['d'], amount: 80 }),
    ],
  }

  const row = (result: ReturnType<typeof hourlyTrends>, hour: number) =>
    result.rows.find((r) => r.hour === hour)!

  it('buckets by the clock, so two differently cut years line up', () => {
    const result = hourlyTrends([onTheHour, overlapped], null)
    expect(result.rows.map((r) => r.hour)).toEqual([17, 18])
    expect(row(result, 17).label).toBe('Fri 5:00 PM')
  })

  it('divides a straddling shift between the hours it spends time in', () => {
    // 5:45–6:45 is a quarter in the 5pm hour and three quarters in the 6pm one. Rounding it
    // to the hour it started in would put a whole evening of overlapped shifts an hour early.
    const result = hourlyTrends([overlapped], null)
    expect(row(result, 17).cells[0]!.revenue).toBe(140) // 120 + a quarter of 80
    expect(row(result, 18).cells[0]!.revenue).toBe(60) // three quarters of 80
  })

  it('never loses a cent to the division', () => {
    const odd: EventData = {
      ...overlapped,
      jars: [jar({ id: 'j5', locationId: 'sobeys', assignmentId: 'd', assignmentIds: ['d'], amount: 100 })],
    }
    const result = hourlyTrends([odd], null)
    const total = result.rows.reduce((n, r) => n + r.revenue, 0)
    expect(Math.round(total * 100)).toBe(10_000)
  })

  it('puts each event in its own column', () => {
    const result = hourlyTrends([onTheHour, overlapped], null)
    expect(row(result, 17).cells.map((c) => c.revenue)).toEqual([100, 140])
    expect(row(result, 18).cells.map((c) => c.revenue)).toEqual([60, 60])
  })

  it('says how the most recent year compares with the one before', () => {
    const result = hourlyTrends([onTheHour, overlapped], null)
    // The 5pm hour went from 100 to 140.
    expect(row(result, 17).changes.revenue).toBeCloseTo(0.4, 5)
  })

  it('narrows to one location', () => {
    const withWalmart: EventData = {
      ...onTheHour,
      assignments: [...onTheHour.assignments, shift('w', 'fri-1700', 'walmart', 'y03')],
      jars: [
        ...onTheHour.jars,
        jar({ id: 'j9', locationId: 'walmart', assignmentId: 'w', assignmentIds: ['w'], amount: 500 }),
      ],
    }
    const all = hourlyTrends([withWalmart], null)
    const sobeys = hourlyTrends([withWalmart], ['sobeys'])
    expect(row(all, 17).cells[0]!.revenue).toBe(600)
    expect(row(sobeys, 17).cells[0]!.revenue).toBe(100)
  })

  it('marks an hour an event never ran as absent, not as zero', () => {
    // A year that finished at seven did not earn nothing at eight; it was not there.
    const short: EventData = { ...onTheHour, slots: slots('fri', [17]), assignments: [onTheHour.assignments[0]!], jars: [onTheHour.jars[0]!] }
    const long: EventData = { ...overlapped, slots: [
      { id: 'fri-a', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00' },
      { id: 'fri-c', day: 'fri', startMin: 19 * 60, endMin: 20 * 60, label: '7:00' },
    ], assignments: [shift('c', 'fri-a', 'sobeys', 'y01')], jars: [] }

    const result = hourlyTrends([short, long], null)
    const seven = row(result, 19)
    expect(seven.cells[0]!.ran).toBe(false)
    expect(seven.cells[1]!.ran).toBe(true)
  })

  it('compares the years an hour was actually run, skipping one it was not', () => {
    const withoutFive: EventData = {
      ...overlapped,
      slots: [{ id: 'fri-c', day: 'fri', startMin: 19 * 60, endMin: 20 * 60, label: '7:00' }],
      assignments: [],
      jars: [],
    }
    const later: EventData = {
      event: event('2027'),
      slots: slots('fri', [17]),
      assignments: [shift('e', 'fri-1700', 'sobeys', 'y01')],
      jars: [jar({ id: 'j6', locationId: 'sobeys', assignmentId: 'e', assignmentIds: ['e'], amount: 150 })],
    }
    const result = hourlyTrends([onTheHour, withoutFive, later], null)
    // 2025 gave 100 at 5pm, 2027 gave 150; 2026 did not run that hour at all.
    expect(row(result, 17).changes.revenue).toBe(0.5)
  })

  it('reads Friday before Saturday, and in clock order', () => {
    const saturday: EventData = {
      ...onTheHour,
      slots: [
        ...slots('fri', [17]),
        { id: 'sat-0800', day: 'sat', startMin: 8 * 60, endMin: 9 * 60, label: '8:00' },
      ],
      assignments: [],
      jars: [],
    }
    const result = hourlyTrends([saturday], null)
    expect(result.rows.map((r) => r.label)).toEqual(['Fri 5:00 PM', 'Sat 8:00 AM'])
  })
})


describe('hours behind the money, location by location', () => {
  const names = new Map([['sobeys', 'Sobeys'], ['walmart', 'Walmart']])

  it('counts person-hours per location per event', () => {
    const { rows } = locationTrends([y2025, y2026], names)
    const sobeys = rows.find((r) => r.locationId === 'sobeys')!
    // One hour staffed in 2025, two in 2026.
    expect(sobeys.cells.map((c) => c.staffedHours)).toEqual([1, 2])
  })

  it('says which way the takings went, and which way an hour there went', () => {
    /*
      The pair that matters, and the reason both are kept: takings up by half is not a win
      when the hours behind them doubled — an hour there was worth a quarter less.

      There was a third, plain hours, and it is gone. It measured effort rather than
      takings, which is the money screen's question when an hour is being planned, not this
      screen's when somewhere is being chosen for next year.
    */
    const { rows } = locationTrends([y2025, y2026], names)
    const sobeys = rows.find((r) => r.locationId === 'sobeys')!
    expect(sobeys.changes.revenue).toBe(0.5)
    expect(sobeys.changes.perHour).toBe(-0.25)
    expect(sobeys.changes).not.toHaveProperty('hours')
  })

  it('has no comparison on any measure for a location used once', () => {
    const { rows } = locationTrends([y2025, y2026], names)
    const walmart = rows.find((r) => r.locationId === 'walmart')!
    expect(walmart.changes).toEqual({ revenue: null, perHour: null })
  })

  it('has no rate to compare when a year had no recorded hours', () => {
    // A year backfilled from the workbook has money and no check-ins.
    const noHours: EventData = { ...y2026, assignments: [] }
    const { rows } = locationTrends([y2025, noHours], names)
    const sobeys = rows.find((r) => r.locationId === 'sobeys')!
    expect(sobeys.changes.perHour).toBeNull()
    expect(sobeys.changes.revenue).toBe(0.5)
  })
})


describe('adding several locations together', () => {
  const twoDoors: EventData = {
    event: event('2026'),
    slots: slots('fri', [17]),
    assignments: [
      shift('a', 'fri-1700', 'sobeys', 'y01'),
      shift('b', 'fri-1700', 'walmart', 'y02'),
    ],
    jars: [
      jar({ id: 'j1', locationId: 'sobeys', assignmentId: 'a', assignmentIds: ['a'], amount: 100 }),
      jar({ id: 'j2', locationId: 'walmart', assignmentId: 'b', assignmentIds: ['b'], amount: 40 }),
    ],
  }

  const five = (result: ReturnType<typeof hourlyTrends>) =>
    result.rows.find((r) => r.hour === 17)!.cells[0]!

  it('adds up only the locations chosen', () => {
    expect(five(hourlyTrends([twoDoors], ['sobeys', 'walmart'])).revenue).toBe(140)
    expect(five(hourlyTrends([twoDoors], ['sobeys'])).revenue).toBe(100)
  })

  it('counts nothing when nothing is chosen', () => {
    // Different from choosing everything, and the screen says so rather than drawing an
    // empty axis.
    expect(five(hourlyTrends([twoDoors], [])).revenue).toBe(0)
  })

  it('treats null as every location', () => {
    expect(five(hourlyTrends([twoDoors], null)).revenue).toBe(140)
  })

  it('counts the hours worked at the chosen locations too', () => {
    // So the Hours measure is about the same doors as the money beside it.
    expect(five(hourlyTrends([twoDoors], ['sobeys'])).staffedHours).toBe(1)
    expect(five(hourlyTrends([twoDoors], ['sobeys', 'walmart'])).staffedHours).toBe(2)
  })

  it('reports what an hour at those locations was worth', () => {
    expect(five(hourlyTrends([twoDoors], ['sobeys', 'walmart'])).revenuePerHour).toBe(70)
  })
})

describe('what an event is called when several are shown together', () => {
  const e = (eventId: string, name: string, year: number) => ({ eventId, name, year })

  it('is the name, on every bar and in every column', () => {
    const labels = eventLabels([e('a', 'Apple Day 2026', 2026), e('b', 'Apple Day 2025', 2025)])
    expect(labels.get('a')).toBe('Apple Day 2026')
    expect(labels.get('b')).toBe('Apple Day 2025')
  })

  it('does not fall back to a year that disagrees with the name', () => {
    expect(eventLabels([e('a', 'Apple Day 2025', 2026)]).get('a')).toBe('Apple Day 2025')
  })

  it('tells two events in one year apart, because their names differ', () => {
    const labels = eventLabels([
      e('a', 'Apple Day 2026', 2026),
      e('b', 'Rehearsal 2026', 2026),
    ])
    expect(labels.get('a')).toBe('Apple Day 2026')
    expect(labels.get('b')).toBe('Rehearsal 2026')
  })

  it('names an event that is not a year at all', () => {
    expect(eventLabels([e('a', 'Spring bottle drive', 0)]).get('a')).toBe('Spring bottle drive')
  })
})

describe('locations kept apart instead of added together', () => {
  /*
    `hourlyTrends` sums whatever locations it is given, which answers "what is this hour
    worth across these doors". The other question — which door, and whether it is changing —
    needs them side by side, and needs the years beside them too.
  */
  const twoDoors = (id: string, sobeys: number, walmart: number): EventData => ({
    event: event(id),
    slots: slots('fri', [17, 18]),
    assignments: [
      shift('a' + id, 'fri-1700', 'sobeys', 'y01'),
      shift('b' + id, 'fri-1700', 'walmart', 'y02'),
    ],
    jars: [
      jar({ id: 'js' + id, locationId: 'sobeys', assignmentId: 'a' + id, assignmentIds: ['a' + id], amount: sobeys }),
      jar({ id: 'jw' + id, locationId: 'walmart', assignmentId: 'b' + id, assignmentIds: ['b' + id], amount: walmart }),
    ],
  })

  const years = [twoDoors('2025', 100, 40), twoDoors('2026', 150, 60)]

  it('gives a column per location per year', () => {
    const { series } = hourlyTrendsSplit(years, ['sobeys', 'walmart'])
    expect(series.map((s) => s.key)).toEqual([
      seriesKey('sobeys', '2025'),
      seriesKey('sobeys', '2026'),
      seriesKey('walmart', '2025'),
      seriesKey('walmart', '2026'),
    ])
  })

  it('keeps each door to its own takings, rather than summing them', () => {
    // The whole point. Summed, this hour is $250; apart, it is $150 and $60.
    const { rows } = hourlyTrendsSplit(years, ['sobeys', 'walmart'])
    const at5 = rows.find((r) => r.hour === 17)!
    expect(at5.cells.map((c) => c.revenue)).toEqual([100, 150, 40, 60])
  })

  it('agrees with the summing version when asked for one location', () => {
    /*
      Both walk the same data through the same rule. If they ever disagreed about one
      location, one of them would be wrong about the split of a straddling shift.
    */
    const split = hourlyTrendsSplit(years, ['sobeys'])
    const summed = hourlyTrends(years, ['sobeys'])
    expect(split.rows.map((r) => r.cells.map((c) => c.revenue))).toEqual(
      summed.rows.map((r) => r.cells.map((c) => c.revenue)),
    )
  })

  it('lines up an hour one door worked and another did not', () => {
    const lateOpener: EventData = {
      event: event('2026'),
      slots: slots('fri', [17, 18]),
      assignments: [
        shift('early', 'fri-1700', 'sobeys', 'y01'),
        shift('late', 'fri-1800', 'walmart', 'y02'),
      ],
      jars: [
        jar({ id: 'j1', locationId: 'sobeys', assignmentId: 'early', assignmentIds: ['early'], amount: 100 }),
        jar({ id: 'j2', locationId: 'walmart', assignmentId: 'late', assignmentIds: ['late'], amount: 80 }),
      ],
    }
    const { rows } = hourlyTrendsSplit([lateOpener], ['sobeys', 'walmart'])

    // Both hours appear, and the door that was shut reads as shut.
    expect(rows.map((r) => r.hour)).toEqual([17, 18])
    const at5 = rows.find((r) => r.hour === 17)!
    expect(at5.cells.map((c) => c.ran)).toEqual([true, false])
  })

  it('says a door was shut rather than that it earned nothing', () => {
    // Different facts, and only one of them is a reason to stop staffing it.
    const only: EventData = {
      event: event('2026'),
      slots: slots('fri', [17, 18]),
      assignments: [shift('a', 'fri-1700', 'sobeys', 'y01')],
      jars: [jar({ id: 'j', locationId: 'sobeys', assignmentId: 'a', assignmentIds: ['a'], amount: 100 })],
    }
    const { rows } = hourlyTrendsSplit([only], ['sobeys', 'walmart'])
    const walmartCell = rows.find((r) => r.hour === 17)!.cells[1]!
    expect(walmartCell.ran).toBe(false)
    expect(walmartCell.revenuePerHour).toBeNull()
  })

  it('keeps the order the locations were given', () => {
    // Which is the order the year works them, on the screen that picked them.
    const { series } = hourlyTrendsSplit(years, ['walmart', 'sobeys'])
    expect(series.map((s) => s.locationId)).toEqual([
      'walmart', 'walmart', 'sobeys', 'sobeys',
    ])
  })

  it('has nothing to draw when nothing is picked', () => {
    expect(hourlyTrendsSplit(years, [])).toEqual({ series: [], rows: [] })
  })

  it('gives every row a cell for every column', () => {
    // A chart reads these positionally, so a short row would silently shift every value in
    // it into the wrong series.
    const { series, rows } = hourlyTrendsSplit(years, ['sobeys', 'walmart'])
    for (const row of rows) expect(row.cells).toHaveLength(series.length)
  })
})

describe('rearranging a split row into stacks', () => {
  /*
    The cells come back location-major, because that is how a table reads. A stacked chart
    wants the other grouping — the bar is a year, the bands within it are the shops — and
    the indexing between the two is positional, which is exactly the kind of thing that goes
    wrong without saying so.
  */
  const series = [
    { key: seriesKey('sobeys', '2025'), eventId: '2025', locationId: 'sobeys' },
    { key: seriesKey('sobeys', '2026'), eventId: '2026', locationId: 'sobeys' },
    { key: seriesKey('walmart', '2025'), eventId: '2025', locationId: 'walmart' },
    { key: seriesKey('walmart', '2026'), eventId: '2026', locationId: 'walmart' },
  ]
  const events = [{ eventId: '2025' }, { eventId: '2026' }]

  const cell = (revenue: number, ran = true) => ({
    eventId: 'x',
    revenue,
    staffedHours: 1,
    revenuePerHour: revenue,
    ran,
  })

  const row = {
    day: 'fri' as const,
    hour: 17,
    label: 'Fri 5:00 PM',
    // sobeys 2025, sobeys 2026, walmart 2025, walmart 2026
    cells: [cell(100), cell(150), cell(40), cell(60)],
  }

  it('groups by year and bands by location', () => {
    expect(stackBands(row, series, events, 'revenue')).toEqual([
      [100, 40], // 2025: sobeys, walmart
      [150, 60], // 2026: sobeys, walmart
    ])
  })

  it('keeps the bands in the order the locations were picked', () => {
    // The bands take the colours, so getting this wrong recolours every shop.
    const reversed = [series[2]!, series[3]!, series[0]!, series[1]!]
    const swapped = { ...row, cells: [cell(40), cell(60), cell(100), cell(150)] }
    expect(stackBands(swapped, reversed, events, 'revenue')).toEqual([
      [40, 100],
      [60, 150],
    ])
  })

  it('adds a stack up to what the bar has to reach', () => {
    expect(stackTotals(row, series, events, 'revenue')).toEqual([140, 210])
  })

  it('leaves a shut door out of the stack rather than drawing it as nothing', () => {
    // Null, not zero: a band of zero is a stripe of colour against a door nobody stood at.
    const shut = { ...row, cells: [cell(100), cell(150), cell(0, false), cell(60)] }
    expect(stackBands(shut, series, events, 'revenue')).toEqual([[100, null], [150, 60]])
    expect(stackTotals(shut, series, events, 'revenue')).toEqual([100, 210])
  })

  it('marks a year no door was open as not run', () => {
    const none = { ...row, cells: [cell(0, false), cell(150), cell(0, false), cell(60)] }
    expect(stackTotals(none, series, events, 'revenue')).toEqual([null, 210])
  })

  it('follows the measure being read', () => {
    const perHour = { ...row, cells: [cell(100), cell(150), cell(40), cell(60)] }
    expect(stackTotals(perHour, series, events, 'perHour')).toEqual([140, 210])
  })

  it('never loses a cent adding a stack up', () => {
    const odd = {
      ...row,
      cells: [cell(33.33), cell(0, false), cell(33.34), cell(0, false)],
    }
    expect(stackTotals(odd, series, events, 'revenue')[0]).toBe(66.67)
  })
})
