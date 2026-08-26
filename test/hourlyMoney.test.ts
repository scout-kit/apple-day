import { describe, expect, it } from 'vitest'
import { revenueBySlot, splitAmount } from '../src/domain/metrics'
import type { Assignment, Jar, Slot } from '../src/domain/types'

/**
 * Money hour by hour — the question the location ranking cannot answer.
 *
 * "Where is it worth being" and "when is it worth being out" are different questions, and
 * the second one is invisible in a per-location table: a location only ever staffed at 5pm
 * cannot tell you whether 5pm was why it did well.
 */

const slot = (id: string, day: 'fri' | 'sat', startMin: number): Slot => ({
  id,
  day,
  startMin,
  endMin: startMin + 60,
  label: `${Math.floor(startMin / 60)}:00`,
})

const SLOTS: Slot[] = [
  slot('fri-1700', 'fri', 17 * 60),
  slot('fri-1800', 'fri', 18 * 60),
  slot('fri-1900', 'fri', 19 * 60),
]

const shift = (id: string, slotId: string, personId: string): Assignment => ({
  id,
  slotId,
  locationId: 'sobeys',
  personId,
  status: 'checkedIn',
  whereabouts: 'back',
  checkedInAt: 1,
  checkedOutAt: 2,
})

const jar = (over: Partial<Jar> & { id: string }): Jar => ({
  jarNumber: 1,
  day: 'fri',
  locationId: 'sobeys',
  personId: 'p1',
  assignmentId: 'a1', assignmentIds: ['a1'],
  status: 'counted',
  issuedAt: 1,
  issuedBy: 'o',
  amount: 100,
  method: 'cash',
  note: '',
  countedBy: 'o',
  countedAt: 2,
  ...over,
})

describe('revenue reaches an hour through the shift its jar went out on', () => {
  const assignments = [
    shift('a1', 'fri-1700', 'p1'),
    shift('a2', 'fri-1700', 'p2'),
    shift('a3', 'fri-1800', 'p1'),
  ]

  it('adds up each slot separately', () => {
    const report = revenueBySlot(
      assignments,
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 300 }),
        jar({ id: 'j2', assignmentId: 'a2', assignmentIds: ['a2'], amount: 197.9 }),
        jar({ id: 'j3', assignmentId: 'a3', assignmentIds: ['a3'], amount: 60 }),
      ],
      SLOTS,
    )
    const by = new Map(report.rows.map((r) => [r.slotId, r]))
    expect(by.get('fri-1700')!.revenue).toBe(497.9)
    expect(by.get('fri-1800')!.revenue).toBe(60)
    expect(by.get('fri-1900')!.revenue).toBe(0)
  })

  it('names the best hour', () => {
    const report = revenueBySlot(
      assignments,
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 300 }),
        jar({ id: 'j3', assignmentId: 'a3', assignmentIds: ['a3'], amount: 60 }),
      ],
      SLOTS,
    )
    expect(report.best!.slotId).toBe('fri-1700')
  })

  it('has no best hour before anything is counted', () => {
    const report = revenueBySlot(assignments, [], SLOTS)
    expect(report.best).toBeNull()
  })

  it('divides by person-hours, so two people for an hour is two hours', () => {
    const report = revenueBySlot(
      assignments,
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 300 }),
        jar({ id: 'j2', assignmentId: 'a2', assignmentIds: ['a2'], amount: 100 }),
      ],
      SLOTS,
    )
    const first = report.rows.find((r) => r.slotId === 'fri-1700')!
    expect(first.staffedHours).toBe(2)
    expect(first.revenuePerHour).toBe(200)
  })

  it('separates the hour that takes the most from the hour that pays best per person', () => {
    // The distinction that decides how thinly to staff: 5pm takes more money overall, 6pm
    // earns more per person out.
    const report = revenueBySlot(
      assignments,
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 200 }),
        jar({ id: 'j2', assignmentId: 'a2', assignmentIds: ['a2'], amount: 200 }),
        jar({ id: 'j3', assignmentId: 'a3', assignmentIds: ['a3'], amount: 250 }),
      ],
      SLOTS,
    )
    const by = new Map(report.rows.map((r) => [r.slotId, r]))
    expect(by.get('fri-1700')!.revenue).toBe(400)
    expect(by.get('fri-1800')!.revenue).toBe(250)
    // But per person out, the later hour is the better one.
    expect(by.get('fri-1700')!.revenuePerHour).toBe(200)
    expect(by.get('fri-1800')!.revenuePerHour).toBe(250)
    expect(report.best!.slotId).toBe('fri-1700')
  })

  it('leaves a rate blank for an hour nobody worked rather than inventing one', () => {
    const report = revenueBySlot([], [], SLOTS)
    expect(report.rows.every((r) => r.revenuePerHour === null)).toBe(true)
  })
})

describe('money that belongs to no hour', () => {
  const assignments = [shift('a1', 'fri-1700', 'p1')]

  it('is reported separately rather than dropped', () => {
    // Hand-recorded takings have no shift behind them, so nothing says which hour they
    // arrived in. Spreading or discarding them would stop this table reconciling with the
    // total at the top of the screen.
    const report = revenueBySlot(
      assignments,
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 100 }),
        jar({ id: 'j2', assignmentId: null, assignmentIds: [], jarNumber: null, amount: 45 }),
      ],
      SLOTS,
    )
    expect(report.unattributed).toBe(45)
    expect(report.rows.reduce((n, r) => n + r.revenue, 0)).toBe(100)
  })

  it('counts a jar whose shift has since been deleted as unattributed', () => {
    const report = revenueBySlot(
      assignments,
      [jar({ id: 'j1', assignmentId: 'gone', assignmentIds: ['gone'], amount: 70 })],
      SLOTS,
    )
    expect(report.unattributed).toBe(70)
  })
})

describe('jars still out', () => {
  it('are counted per hour but add nothing to revenue', () => {
    // So a low figure for the current hour reads as "not back yet", not "a bad hour".
    const report = revenueBySlot(
      [shift('a1', 'fri-1700', 'p1')],
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], status: 'out', amount: null }),
        jar({ id: 'j2', assignmentId: 'a1', assignmentIds: ['a1'], amount: 80 }),
      ],
      SLOTS,
    )
    const first = report.rows.find((r) => r.slotId === 'fri-1700')!
    expect(first.jarsOut).toBe(1)
    expect(first.revenue).toBe(80)
    expect(first.jarCount).toBe(1)
  })
})

describe('ordering', () => {
  it('reads down the day, Friday before Saturday', () => {
    const mixed = [
      slot('sat-0800', 'sat', 8 * 60),
      slot('fri-1800', 'fri', 18 * 60),
      slot('fri-1700', 'fri', 17 * 60),
    ]
    const report = revenueBySlot([], [], mixed)
    expect(report.rows.map((r) => r.slotId)).toEqual(['fri-1700', 'fri-1800', 'sat-0800'])
  })
})

describe('what an hour of Apple Day is worth', () => {
  const shifts = [
    shift('a1', 'fri-1700', 'p1'),
    shift('a2', 'fri-1700', 'p2'),
    shift('a3', 'fri-1800', 'p1'),
  ]

  it('is the takings over the hours actually run, not over person-hours', () => {
    // One hour worked, two people out, $497.90 in. Per person-hour that is $248.95; per
    // hour of Apple Day it is the whole $497.90 — the figure that says how the evening is
    // going regardless of how many people it took.
    const report = revenueBySlot(
      [shifts[0]!, shifts[1]!],
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 300 }),
        jar({ id: 'j2', assignmentId: 'a2', assignmentIds: ['a2'], amount: 197.9 }),
      ],
      SLOTS,
    )
    expect(report.clockHours).toBe(1)
    expect(report.slotsWorked).toBe(1)
    expect(report.revenuePerClockHour).toBe(497.9)
  })

  it('averages across the hours run so far', () => {
    const report = revenueBySlot(
      shifts,
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 300 }),
        jar({ id: 'j2', assignmentId: 'a2', assignmentIds: ['a2'], amount: 200 }),
        jar({ id: 'j3', assignmentId: 'a3', assignmentIds: ['a3'], amount: 100 }),
      ],
      SLOTS,
    )
    // Two hours run, $600 in.
    expect(report.clockHours).toBe(2)
    expect(report.revenuePerClockHour).toBe(300)
  })

  it('ignores an hour nobody was rostered for', () => {
    // 7pm is on the board but unstaffed, so the event was not running then and including
    // it would report a rate for time nobody was out.
    const report = revenueBySlot(
      [shifts[0]!],
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 120 })],
      SLOTS,
    )
    expect(report.clockHours).toBe(1)
    expect(report.revenuePerClockHour).toBe(120)
  })

  it('counts overlapping shifts as the time they cover, not the sum of their lengths', () => {
    // Shifts are configured to overlap so the next person is there before the last leaves:
    // 60-minute shifts starting every 45. Two of them cover an hour and three quarters,
    // not two hours.
    const overlapping: Slot[] = [
      { id: 'fri-a', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00' },
      { id: 'fri-b', day: 'fri', startMin: 17 * 60 + 45, endMin: 18 * 60 + 45, label: '5:45' },
    ]
    const report = revenueBySlot(
      [shift('a1', 'fri-a', 'p1'), shift('a2', 'fri-b', 'p2')],
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 175 })],
      overlapping,
    )
    expect(report.clockHours).toBe(1.75)
    expect(report.revenuePerClockHour).toBe(100)
  })

  it('does not merge the same time on two different days', () => {
    const twoDays: Slot[] = [
      { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00' },
      { id: 'sat-1700', day: 'sat', startMin: 17 * 60, endMin: 18 * 60, label: '5:00' },
    ]
    const report = revenueBySlot(
      [shift('a1', 'fri-1700', 'p1'), shift('a2', 'sat-1700', 'p2')],
      [],
      twoDays,
    )
    expect(report.clockHours).toBe(2)
  })

  it('leaves a gap in the day out of the total', () => {
    // Nothing at 6pm: the event was running for two hours, not three.
    const report = revenueBySlot(
      [shift('a1', 'fri-1700', 'p1'), shift('a3', 'fri-1900', 'p1')],
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 100 })],
      SLOTS,
    )
    expect(report.clockHours).toBe(2)
    expect(report.revenuePerClockHour).toBe(50)
  })

  it('includes hand-entered money, which still arrived during the event', () => {
    const report = revenueBySlot(
      [shifts[0]!],
      [
        jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1'], amount: 100 }),
        jar({ id: 'j2', assignmentId: null, assignmentIds: [], jarNumber: null, amount: 45 }),
      ],
      SLOTS,
    )
    expect(report.revenuePerClockHour).toBe(145)
  })

  it('has no rate before anybody has worked an hour', () => {
    const report = revenueBySlot([], [], SLOTS)
    expect(report.clockHours).toBe(0)
    expect(report.revenuePerClockHour).toBeNull()
  })
})

describe('a jar carried through several shifts', () => {
  const shifts = [
    shift('a1', 'fri-1700', 'p1'),
    shift('a2', 'fri-1800', 'p1'),
    shift('a3', 'fri-1900', 'p1'),
  ]

  it('divides its takings across the hours it was out', () => {
    // One jar, two hours at one store. Crediting the first hour with the lot said the 6pm
    // hour earned nothing, when in truth nobody knows which coins went in when.
    const report = revenueBySlot(
      shifts.slice(0, 2),
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1', 'a2'], amount: 200 })],
      SLOTS,
    )
    const by = new Map(report.rows.map((r) => [r.slotId, r]))
    expect(by.get('fri-1700')!.revenue).toBe(100)
    expect(by.get('fri-1800')!.revenue).toBe(100)
  })

  it('still adds up to what was in the jar', () => {
    // $100 over three hours cannot divide evenly, and the by-hour table has to reconcile
    // with the total at the top of the screen.
    const report = revenueBySlot(
      shifts,
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1', 'a2', 'a3'], amount: 100 })],
      SLOTS,
    )
    const total = report.rows.reduce((n, r) => n + r.revenue, 0)
    expect(total).toBe(100)
    expect(report.rows.map((r) => r.revenue).filter((n) => n > 0)).toEqual([33.34, 33.33, 33.33])
  })

  it('counts the jar once, in the hour it went out', () => {
    const report = revenueBySlot(
      shifts.slice(0, 2),
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1', 'a2'], amount: 60 })],
      SLOTS,
    )
    const by = new Map(report.rows.map((r) => [r.slotId, r]))
    // One jar on the street, not one per hour of the stretch.
    expect(by.get('fri-1700')!.jarCount).toBe(1)
    expect(by.get('fri-1800')!.jarCount).toBe(0)
  })

  it('counts a jar still out once, in the hour it went out', () => {
    const report = revenueBySlot(
      shifts.slice(0, 2),
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1', 'a2'], status: 'out', amount: null })],
      SLOTS,
    )
    const by = new Map(report.rows.map((r) => [r.slotId, r]))
    expect(by.get('fri-1700')!.jarsOut).toBe(1)
    expect(by.get('fri-1800')!.jarsOut).toBe(0)
  })

  it('divides by person-hours per hour, so a shared stretch reads right', () => {
    // Two youths out together for two hours on one jar: $240 over 4 person-hours is $60 an
    // hour each way you cut it.
    const report = revenueBySlot(
      [
        shift('a1', 'fri-1700', 'p1'),
        shift('a2', 'fri-1800', 'p1'),
        shift('b1', 'fri-1700', 'p2'),
        shift('b2', 'fri-1800', 'p2'),
      ],
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1', 'a2'], amount: 240 })],
      SLOTS,
    )
    const by = new Map(report.rows.map((r) => [r.slotId, r]))
    expect(by.get('fri-1700')!.staffedHours).toBe(2)
    expect(by.get('fri-1700')!.revenue).toBe(120)
    expect(by.get('fri-1700')!.revenuePerHour).toBe(60)
  })

  it('credits only the hours in view when the day is filtered', () => {
    // Scoped to a single hour, a two-hour jar contributes its share of that hour — not the
    // whole jar, which would make one hour look twice as good as it was.
    const oneHour = SLOTS.filter((s) => s.id === 'fri-1700')
    const report = revenueBySlot(
      shifts.slice(0, 2),
      [jar({ id: 'j1', assignmentId: 'a1', assignmentIds: ['a1', 'a2'], amount: 200 })],
      oneHour,
    )
    expect(report.rows[0]!.revenue).toBe(200)
  })

  it('leaves a stretch whose shifts have all gone unattributed', () => {
    const report = revenueBySlot(
      [],
      [jar({ id: 'j1', assignmentId: 'gone', assignmentIds: ['gone', 'also-gone'], amount: 50 })],
      SLOTS,
    )
    expect(report.unattributed).toBe(50)
  })
})

describe('splitAmount', () => {
  it('divides evenly when it can', () => {
    expect(splitAmount(100, 4)).toEqual([25, 25, 25, 25])
  })

  it('gives the odd cents to the earliest hours', () => {
    expect(splitAmount(100, 3)).toEqual([33.34, 33.33, 33.33])
    expect(splitAmount(0.05, 2)).toEqual([0.03, 0.02])
  })

  it('always adds back up to the amount', () => {
    for (const amount of [100, 86.55, 0.01, 1234.56, 7]) {
      for (const parts of [1, 2, 3, 5, 7, 11]) {
        const total = splitAmount(amount, parts).reduce((a, b) => a + b, 0)
        expect(Math.round(total * 100), `${amount}/${parts}`).toBe(Math.round(amount * 100))
      }
    }
  })

  it('handles a jar that came back empty', () => {
    expect(splitAmount(0, 3)).toEqual([0, 0, 0])
  })

  it('has nothing to divide between no shifts', () => {
    expect(splitAmount(50, 0)).toEqual([])
  })
})
