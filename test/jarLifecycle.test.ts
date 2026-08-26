import { describe, expect, it } from 'vitest'
import {
  locationMetrics,
  outstandingByLocation,
  personTotals,
  revenueByLocation,
  summariseMoney,
} from '../src/domain/metrics'
import {
  sharesShiftWith,
  shiftsCoveredBy,
  shiftsOnCount,
  shiftsOnIssue,
  shiftsOnUnissue,
} from '../src/domain/jars'
import { isCounted } from '../src/domain/types'
import type { Jar } from '../src/domain/types'
import {
  KNOWN,
  assignments2025,
  fridayAssignments2025,
  fridayJars2025,
  jars2025,
  locations2025,
  reconciliation2025,
  slots2025,
} from './fixtures/appleDay2025'

/**
 * A jar from being handed over to being counted.
 *
 * A jar exists from the moment somebody takes it out, so for most of the evening it has no
 * amount. That is deliberately `null` rather than 0: an outstanding jar is money nobody has
 * yet, and treating it as zero would drag a location's revenue per hour down mid-event and
 * make the ranking meaningless until everything was back.
 */

const outJar = (over: Partial<Jar> & { id: string; jarNumber: number }): Jar => ({
  day: 'fri',
  locationId: 'sobeys-640',
  personId: 'y01',
  assignmentId: 'fa-1', assignmentIds: ['fa-1'],
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

describe('an outstanding jar is not zero', () => {
  it('is not counted', () => {
    expect(isCounted(outJar({ id: 'j1', jarNumber: 1 }))).toBe(false)
    // Nor is a jar marked counted but somehow missing its amount.
    expect(isCounted(outJar({ id: 'j2', jarNumber: 2, status: 'counted' }))).toBe(false)
    expect(
      isCounted(outJar({ id: 'j3', jarNumber: 3, status: 'counted', amount: 0 })),
    ).toBe(true)
  })

  it('contributes nothing to revenue', () => {
    const revenue = revenueByLocation([
      outJar({ id: 'j1', jarNumber: 1 }),
      outJar({ id: 'j2', jarNumber: 2, status: 'counted', amount: 40 }),
    ])
    expect(revenue.get('sobeys-640')).toBe(40)
  })

  it('is reported as outstanding instead', () => {
    const out = outstandingByLocation([
      outJar({ id: 'j1', jarNumber: 1 }),
      outJar({ id: 'j2', jarNumber: 2 }),
      outJar({ id: 'j3', jarNumber: 3, status: 'counted', amount: 10 }),
    ])
    expect(out.get('sobeys-640')).toBe(2)
  })

  it('does not drag revenue per hour down while it is out', () => {
    // One counted jar over one staffed hour is $40/hr, whether or not more are still out.
    const assignments = [
      {
        id: 'fa-1', slotId: 'fri-1700', locationId: 'sobeys-640', personId: 'y01',
        status: 'checkedIn' as const, whereabouts: 'out' as const,
        checkedInAt: 1, checkedOutAt: null,
      },
    ]
    const withOutstanding = locationMetrics(
      locations2025,
      assignments,
      [
        outJar({ id: 'j1', jarNumber: 1, status: 'counted', amount: 40 }),
        outJar({ id: 'j2', jarNumber: 2 }),
        outJar({ id: 'j3', jarNumber: 3 }),
      ],
      slots2025,
    )
    const row = withOutstanding.ranked.find((r) => r.locationId === 'sobeys-640')!
    expect(row.revenue).toBe(40)
    expect(row.revenuePerHour).toBe(40)
    // But the jars still out are surfaced, so nobody reads it as final.
    expect(row.jarsOut).toBe(2)
    expect(row.jarCount).toBe(1)
  })

  it('counts a shift that is out or back as having worked the hour', () => {
    // Attendance and whereabouts are separate fields, so every combination that means
    // "they were really there" has to count — including the shift that went out without
    // ever being checked in by hand.
    const present = [
      { status: 'checkedIn', whereabouts: 'here' },
      { status: 'checkedIn', whereabouts: 'out' },
      { status: 'checkedIn', whereabouts: 'back' },
      { status: 'confirmed', whereabouts: 'out' },
      { status: 'confirmed', whereabouts: 'back' },
    ] as const

    for (const { status, whereabouts } of present) {
      const report = locationMetrics(
        locations2025,
        [
          {
            id: 'a', slotId: 'fri-1700', locationId: 'sobeys-640', personId: 'y01',
            status, whereabouts, checkedInAt: 1, checkedOutAt: null,
          },
        ],
        [outJar({ id: 'j1', jarNumber: 1, status: 'counted', amount: 30 })],
        slots2025,
      )
      const row = report.ranked.find((r) => r.locationId === 'sobeys-640')!
      expect(row.staffedHours, `${status}/${whereabouts}`).toBe(1)
    }
  })

  it('leaves an outstanding jar out of a person’s total', () => {
    const totals = personTotals(
      assignments2025.slice(0, 1),
      [
        outJar({ id: 'j1', jarNumber: 1, status: 'counted', amount: 25 }),
        outJar({ id: 'j2', jarNumber: 2 }),
      ],
      slots2025,
    )
    const y01 = totals.find((t) => t.personId === 'y01')!
    expect(y01.revenue).toBe(25)
    expect(y01.jarCount).toBe(1)
  })
})

describe('totals while jars are still out', () => {
  it('says how many have not come back', () => {
    const summary = summariseMoney(
      [...jars2025, outJar({ id: 'extra', jarNumber: 99 })],
      reconciliation2025,
    )
    expect(summary.stillOut).toBe(1)
    expect(summary.days.find((d) => d.day === 'fri')!.stillOut).toBe(1)
  })

  it('does not let an outstanding jar move the totals', () => {
    const before = summariseMoney(jars2025, reconciliation2025)
    const after = summariseMoney(
      [...jars2025, outJar({ id: 'extra', jarNumber: 99 })],
      reconciliation2025,
    )
    expect(after.jarTotal).toBe(before.jarTotal)
    expect(after.grandTotal).toBe(before.grandTotal)
    expect(before.stillOut).toBe(0)
    expect(after.stillOut).toBe(1)
  })

  it('reproduces the 2025 totals from the jars alone', () => {
    const summary = summariseMoney(jars2025, reconciliation2025)
    expect(summary.jarTotal).toBe(5834.61)
    expect(summary.grandTotal).toBe(6014.61)
    expect(summary.stillOut).toBe(0)
  })
})

describe('money recorded by hand', () => {
  const manual = (over: Partial<Jar> & { id: string }): Jar => ({
    jarNumber: null,
    day: 'fri',
    locationId: 'sobeys-640',
    personId: null,
    assignmentId: null, assignmentIds: [],
    status: 'counted',
    issuedAt: 0,
    issuedBy: '',
    amount: 40,
    method: 'cash',
    note: 'bushel sales',
    countedBy: 'organizer',
    countedAt: 1,
    ...over,
  })

  it('counts towards the location’s revenue', () => {
    // Money raised at a place is money raised at that place, jar or no jar.
    const revenue = revenueByLocation([manual({ id: 'm1' })])
    expect(revenue.get('sobeys-640')).toBe(40)
  })

  it('is not counted as a jar', () => {
    // A location with only hand-recorded money reads as revenue with no jars, rather than
    // claiming a jar that never existed.
    const report = locationMetrics(
      locations2025,
      [
        {
          id: 'a', slotId: 'fri-1700', locationId: 'sobeys-640', personId: 'y01',
          status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
        },
      ],
      [manual({ id: 'm1' })],
      slots2025,
    )
    const row = report.ranked.find((r) => r.locationId === 'sobeys-640')!
    expect(row.revenue).toBe(40)
    expect(row.jarCount).toBe(0)
  })

  it('counts alongside real jars without disturbing their count', () => {
    const report = locationMetrics(
      locations2025,
      [
        {
          id: 'a', slotId: 'fri-1700', locationId: 'sobeys-640', personId: 'y01',
          status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
        },
      ],
      [
        manual({ id: 'm1', amount: 40 }),
        manual({ id: 'j1', jarNumber: 3, amount: 60, note: '' }),
      ],
      slots2025,
    )
    const row = report.ranked.find((r) => r.locationId === 'sobeys-640')!
    expect(row.revenue).toBe(100)
    expect(row.jarCount).toBe(1)
  })

  it('appears in the day totals and the cash split', () => {
    const summary = summariseMoney(
      [manual({ id: 'm1', amount: 25 }), manual({ id: 'm2', amount: 15, method: 'square' })],
      { bushelSales: 0, deposit: 0, notes: '' },
    )
    const friday = summary.days.find((d) => d.day === 'fri')!
    expect(friday.jarTotal).toBe(40)
    expect(friday.cash).toBe(25)
    expect(friday.card).toBe(15)
    // Neither was a jar.
    expect(friday.jarCount).toBe(0)
  })

  it('is never treated as outstanding', () => {
    // It is recorded because the money is in hand; there is nothing to wait for.
    const summary = summariseMoney([manual({ id: 'm1' })], {
      bushelSales: 0, deposit: 0, notes: '',
    })
    expect(summary.stillOut).toBe(0)
  })

  it('can be attributed to a youth when it is known', () => {
    const totals = personTotals(
      [],
      [manual({ id: 'm1', personId: 'y01', amount: 30 })],
      slots2025,
    )
    expect(totals.find((t) => t.personId === 'y01')?.revenue).toBe(30)
  })
})

describe('the 2025 books reconcile from the table alone', () => {
  it('accounts for every dollar across ranked and unranked rows', () => {
    // The Home Hardware jar is unrankable, so it lives in the second list. Together the two
    // lists have to account for the full $2,042.30 of Friday jars — that is the sum the
    // screen's headline figure claims, and the table is what explains it.
    const fri = locationMetrics(
      locations2025,
      fridayAssignments2025,
      fridayJars2025,
      slots2025,
    )
    const shown = [...fri.ranked, ...fri.revenueWithoutHours]
    const sum = Math.round(shown.reduce((total, r) => total + r.revenue, 0) * 100) / 100

    expect(sum).toBe(KNOWN.fridayJarTotal)
    expect(fri.totalRevenue).toBe(KNOWN.fridayJarTotal)
    // And the unrankable row is genuinely only in the second list.
    expect(fri.ranked.some((r) => r.locationId === 'home-hardware-lounge')).toBe(false)
    expect(
      fri.revenueWithoutHours.some((r) => r.locationId === 'home-hardware-lounge'),
    ).toBe(true)
  })

  it('would be short by exactly the lounge jar if only the ranked rows were shown', () => {
    // Which is what the screen did: the total said one thing and the list another.
    const fri = locationMetrics(
      locations2025,
      fridayAssignments2025,
      fridayJars2025,
      slots2025,
    )
    const rankedOnly = Math.round(
      fri.ranked.reduce((total, r) => total + r.revenue, 0) * 100,
    ) / 100
    // toBeCloseTo, because subtracting two already-rounded figures reintroduces the float
    // error the production code rounds away at each step.
    expect(KNOWN.fridayJarTotal - rankedOnly).toBeCloseTo(KNOWN.uncountedFridayJar, 2)
  })
})

describe('the shifts a jar was out for', () => {
  const base = {
    id: 'fri-jar-1-abc', jarNumber: 1, day: 'fri' as const, locationId: 'sobeys-640',
    personId: 'y01', status: 'out' as const, issuedAt: 1, issuedBy: 'o',
    amount: null, method: 'cash' as const, note: '', countedBy: '', countedAt: 0,
  }

  it('is the recorded stretch when there is one', () => {
    expect(shiftsCoveredBy({ ...base, assignmentId: 'a1', assignmentIds: ['a1', 'a2'] }))
      .toEqual(['a1', 'a2'])
  })

  it('falls back to the single shift older jars carry', () => {
    // Every jar in the database predates the list; counting one in has to bring its shift
    // back, not silently move nothing.
    expect(shiftsCoveredBy({ ...base, assignmentId: 'a1', assignmentIds: [] }))
      .toEqual(['a1'])
  })

  it('is empty for money recorded against no shift', () => {
    expect(shiftsCoveredBy({ ...base, assignmentId: null, assignmentIds: [] })).toEqual([])
  })
})

describe('two jars on the same trip', () => {
  const jarFor = (id: string, ids: string[]) => ({
    assignmentId: ids[0] ?? null,
    assignmentIds: ids,
    id,
  })

  it('share a shift when they cover the same hour', () => {
    expect(sharesShiftWith(jarFor('j1', ['a1', 'a2']), jarFor('j2', ['a2']))).toBe(true)
  })

  it('share a shift when one is the whole stretch and the other its start', () => {
    // Which hour a second jar was booked against is not a reason to call somebody back in
    // while they are still out there.
    expect(sharesShiftWith(jarFor('j1', ['a1']), jarFor('j2', ['a1', 'a2']))).toBe(true)
  })

  it('do not share a shift across different trips', () => {
    expect(sharesShiftWith(jarFor('j1', ['a1']), jarFor('j2', ['a3']))).toBe(false)
  })

  it('do not share a shift when one belongs to no shift at all', () => {
    expect(sharesShiftWith(jarFor('j1', []), jarFor('j2', ['a1']))).toBe(false)
  })
})

describe('which shifts a jar moves', () => {
  const stretch = { assignmentId: 'a1', assignmentIds: ['a1', 'a2'] }
  const single = { assignmentId: 'a1', assignmentIds: ['a1'] }
  const legacy = { assignmentId: 'a1', assignmentIds: [] }
  const byHand = { assignmentId: null, assignmentIds: [] }

  describe('handing it over', () => {
    it('sends out every hour of the trip', () => {
      expect(shiftsOnIssue(stretch)).toEqual([
        { assignmentId: 'a1', whereabouts: 'out' },
        { assignmentId: 'a2', whereabouts: 'out' },
      ])
    })

    it('sends out the one hour of a single-shift trip', () => {
      expect(shiftsOnIssue(single)).toEqual([{ assignmentId: 'a1', whereabouts: 'out' }])
    })

    it('moves nothing for money recorded against no shift', () => {
      expect(shiftsOnIssue(byHand)).toEqual([])
    })
  })

  describe('counting it in', () => {
    it('brings back every hour of the trip', () => {
      // The reported bug: the money split across the hours correctly, but only the first
      // shift came back, so the youth stayed on the board as out collecting.
      expect(shiftsOnCount(stretch, { at: 9, wasTheirLastJar: true })).toEqual([
        { assignmentId: 'a1', whereabouts: 'back', checkedOutAt: 9 },
        { assignmentId: 'a2', whereabouts: 'back', checkedOutAt: 9 },
      ])
    })

    it('brings back the shift an older jar carries, with no list of its own', () => {
      expect(shiftsOnCount(legacy, { at: 9, wasTheirLastJar: true })).toEqual([
        { assignmentId: 'a1', whereabouts: 'back', checkedOutAt: 9 },
      ])
    })

    it('brings nobody back while they still hold another jar', () => {
      expect(shiftsOnCount(stretch, { at: 9, wasTheirLastJar: false })).toEqual([])
    })

    it('moves nothing for money recorded against no shift', () => {
      expect(shiftsOnCount(byHand, { at: 9, wasTheirLastJar: true })).toEqual([])
    })
  })

  describe('taking it back uncounted', () => {
    it('undoes the trip rather than completing it', () => {
      // They never went anywhere, so `here` — not `back`, which would claim a trip happened
      // and stamp a time it finished.
      expect(shiftsOnUnissue(stretch, { wasTheirLastJar: true })).toEqual([
        { assignmentId: 'a1', whereabouts: 'here' },
        { assignmentId: 'a2', whereabouts: 'here' },
      ])
    })

    it('leaves them out while another jar is still with them', () => {
      expect(shiftsOnUnissue(stretch, { wasTheirLastJar: false })).toEqual([])
    })
  })
})
