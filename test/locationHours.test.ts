import { describe, expect, it } from 'vitest'
import { locationHourGrid } from '../src/domain/metrics'
import type { Assignment, Jar, ScheduledLocation, Slot } from '../src/domain/types'

/**
 * Money and hours per location, hour by hour.
 *
 * The by-location table says Sobeys did well without saying when; the by-hour table says
 * 5pm did well without saying where. Neither answers the question next year's plan actually
 * asks — which door, at what time — and that is a grid.
 */

const SLOTS: Slot[] = [
  { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00 PM' },
  { id: 'fri-1800', day: 'fri', startMin: 18 * 60, endMin: 19 * 60, label: '6:00 PM' },
  { id: 'sat-0800', day: 'sat', startMin: 8 * 60, endMin: 9 * 60, label: '8:00 AM' },
]

const location = (id: string, name: string): ScheduledLocation => ({
  id, name, address: '', mapsUrl: '', lat: null, lng: null, groupCode: '', siteContact: null,
  insurance: '', comments: '', openHours: {}, aliases: [], active: true, priority: 1,
})

const LOCATIONS = [location('sobeys', 'Sobeys'), location('walmart', 'Walmart')]

const shift = (id: string, slotId: string, locationId: string, personId = 'p1'): Assignment => ({
  id, slotId, locationId, personId,
  status: 'checkedIn', whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
})

const jar = (over: Partial<Jar> & { id: string; locationId: string }): Jar => ({
  jarNumber: 1, day: 'fri', personId: 'p1', assignmentId: null, assignmentIds: [],
  status: 'counted', issuedAt: 1, issuedBy: 'o', amount: 100, method: 'cash',
  note: '', countedBy: 'o', countedAt: 2,
  ...over,
})

const cell = (grid: ReturnType<typeof locationHourGrid>, locationId: string, slotId: string) => {
  const row = grid.rows.find((r) => r.locationId === locationId)!
  return row.cells.find((c) => c.slotId === slotId)!
}

describe('reading the grid across', () => {
  const assignments = [
    shift('a1', 'fri-1700', 'sobeys'),
    shift('a2', 'fri-1800', 'sobeys'),
    shift('b1', 'fri-1700', 'walmart'),
  ]
  const jars = [
    jar({ id: 'j1', locationId: 'sobeys', assignmentId: 'a1', assignmentIds: ['a1'], amount: 300 }),
    jar({ id: 'j2', locationId: 'sobeys', assignmentId: 'a2', assignmentIds: ['a2'], amount: 50 }),
    jar({ id: 'j3', locationId: 'walmart', assignmentId: 'b1', assignmentIds: ['b1'], amount: 80 }),
  ]

  it('puts each hour’s money in its own cell', () => {
    const grid = locationHourGrid(LOCATIONS, assignments, jars, SLOTS)
    expect(cell(grid, 'sobeys', 'fri-1700').revenue).toBe(300)
    expect(cell(grid, 'sobeys', 'fri-1800').revenue).toBe(50)
    expect(cell(grid, 'walmart', 'fri-1700').revenue).toBe(80)
  })

  it('leaves an unstaffed hour empty rather than blank-looking-like-zero-earned', () => {
    const grid = locationHourGrid(LOCATIONS, assignments, jars, SLOTS)
    const quiet = cell(grid, 'walmart', 'fri-1800')
    expect(quiet.revenue).toBe(0)
    expect(quiet.staffedHours).toBe(0)
    // No rate at all, rather than zero — nobody was there to earn one.
    expect(quiet.revenuePerHour).toBeNull()
  })

  it('names each location’s best hour', () => {
    const grid = locationHourGrid(LOCATIONS, assignments, jars, SLOTS)
    expect(grid.rows.find((r) => r.locationId === 'sobeys')!.bestSlotId).toBe('fri-1700')
  })

  it('has no best hour for a location that took nothing', () => {
    const grid = locationHourGrid([location('quiet', 'Quiet Corner')], [], [], SLOTS)
    expect(grid.rows[0]!.bestSlotId).toBeNull()
  })

  it('keeps the year’s own running order, whatever the takings', () => {
    // The order comes from the Locations list, which the organizers arrange by hand. A grid
    // sorted by takings instead is the one screen that disagrees with the schedule board
    // about what order the locations come in.
    const quiet = location('walmart', 'Walmart')
    const busy = location('sobeys', 'Sobeys')
    const grid = locationHourGrid([quiet, busy], assignments, jars, SLOTS)
    expect(grid.rows.map((r) => r.locationId)).toEqual(['walmart', 'sobeys'])
    // Even though Sobeys took far more.
    expect(grid.rows[1]!.revenue).toBeGreaterThan(grid.rows[0]!.revenue)
  })

  it('puts a location that only appears in the data after the year’s own', () => {
    const grid = locationHourGrid(
      LOCATIONS,
      [...assignments, shift('x1', 'fri-1700', 'staff-lounge')],
      [
        ...jars,
        jar({ id: 'jx', locationId: 'staff-lounge', assignmentId: 'x1', assignmentIds: ['x1'], amount: 500 }),
      ],
      SLOTS,
    )
    // $500 is the biggest total on the grid, and it still comes last: it is not part of the
    // year's plan, so it does not belong in the middle of it.
    expect(grid.rows.map((r) => r.locationId)).toEqual(['sobeys', 'walmart', 'staff-lounge'])
  })
})

describe('reading the grid down', () => {
  it('totals each hour across every location', () => {
    const assignments = [shift('a1', 'fri-1700', 'sobeys'), shift('b1', 'fri-1700', 'walmart')]
    const grid = locationHourGrid(
      LOCATIONS,
      assignments,
      [
        jar({ id: 'j1', locationId: 'sobeys', assignmentId: 'a1', assignmentIds: ['a1'], amount: 100 }),
        jar({ id: 'j2', locationId: 'walmart', assignmentId: 'b1', assignmentIds: ['b1'], amount: 60 }),
      ],
      SLOTS,
    )
    const first = grid.totals.find((t) => t.slotId === 'fri-1700')!
    expect(first.revenue).toBe(160)
    expect(first.staffedHours).toBe(2)
    expect(first.revenuePerHour).toBe(80)
  })

  it('reconciles: every cell adds up to every row total', () => {
    const assignments = [shift('a1', 'fri-1700', 'sobeys'), shift('a2', 'fri-1800', 'sobeys')]
    const grid = locationHourGrid(
      LOCATIONS,
      assignments,
      [jar({ id: 'j1', locationId: 'sobeys', assignmentId: 'a1', assignmentIds: ['a1', 'a2'], amount: 100 })],
      SLOTS,
    )
    for (const row of grid.rows) {
      expect(row.revenue).toBe(
        Math.round(row.cells.reduce((n, c) => n + c.revenue, 0) * 100) / 100,
      )
    }
  })
})

describe('a jar carried across two hours', () => {
  it('splits into both cells of the same location', () => {
    const assignments = [shift('a1', 'fri-1700', 'sobeys'), shift('a2', 'fri-1800', 'sobeys')]
    const grid = locationHourGrid(
      LOCATIONS,
      assignments,
      [jar({ id: 'j1', locationId: 'sobeys', assignmentId: 'a1', assignmentIds: ['a1', 'a2'], amount: 200 })],
      SLOTS,
    )
    expect(cell(grid, 'sobeys', 'fri-1700').revenue).toBe(100)
    expect(cell(grid, 'sobeys', 'fri-1800').revenue).toBe(100)
  })
})

describe('nothing hides from the grid', () => {
  it('includes a location that only appears in the data', () => {
    // A jar recorded against a location dropped from this year still has to show up, or the
    // grid stops matching the total above it.
    const grid = locationHourGrid(
      LOCATIONS,
      [shift('x1', 'fri-1700', 'staff-lounge')],
      [jar({ id: 'j1', locationId: 'staff-lounge', assignmentId: 'x1', assignmentIds: ['x1'], amount: 86.55 })],
      SLOTS,
    )
    expect(grid.rows.map((r) => r.locationId)).toContain('staff-lounge')
    expect(cell(grid, 'staff-lounge', 'fri-1700').revenue).toBe(86.55)
  })

  it('includes a location the year uses but never staffed', () => {
    const grid = locationHourGrid(LOCATIONS, [], [], SLOTS)
    expect(grid.rows.map((r) => r.locationId).sort()).toEqual(['sobeys', 'walmart'])
  })
})

describe('columns', () => {
  it('run Friday before Saturday, in clock order', () => {
    const grid = locationHourGrid(LOCATIONS, [], [], [SLOTS[2]!, SLOTS[1]!, SLOTS[0]!])
    expect(grid.slots.map((s) => s.id)).toEqual(['fri-1700', 'fri-1800', 'sat-0800'])
    expect(grid.rows[0]!.cells.map((c) => c.slotId)).toEqual([
      'fri-1700',
      'fri-1800',
      'sat-0800',
    ])
  })
})
