import { describe, expect, it } from 'vitest'
import {
  coveredHoursByLocation,
  locationMetrics,
  staffedHoursByLocation,
  unionMinutes,
} from '../src/domain/metrics'
import { buildAllSlots, buildSlots } from '../src/domain/slots'
import type { Assignment, Jar, ScheduledLocation, Slot } from '../src/domain/types'
import {
  assignments2025,
  fridayAssignments2025,
  jars2025,
  locations2025,
  slots2025,
} from './fixtures/appleDay2025'

/**
 * A door covered by two people is covered once.
 *
 * Every rate on the money screen divided money by person-hours, so sending a pair to a shop
 * halved what that shop appeared to earn per hour and dropped it down the ranking — for a
 * staffing decision, not for anything about the shop. Braemar took $1,526 over four
 * person-hours on the Friday, but the door was only worked for three of them: the six
 * o'clock shift was two siblings.
 *
 * So both figures are kept. Person-hours still answer what the event spent on a door;
 * covered hours answer how long the door was worked, and the rate over them is what next
 * year's list should be judged on.
 */

const SLOTS: Slot[] = buildAllSlots()
const fri = (n: number): string => SLOTS.filter((s) => s.day === 'fri')[n]!.id
const sat = (n: number): string => SLOTS.filter((s) => s.day === 'sat')[n]!.id

const shift = (
  id: string,
  personId: string,
  locationId: string,
  slotId: string,
  status: Assignment['status'] = 'checkedIn',
): Assignment => ({
  id, slotId, locationId, personId,
  status, whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
})

const jar = (id: string, amount: number, locationId: string, assignmentId: string): Jar => ({
  id, jarNumber: 1, day: 'fri', locationId, personId: 'p1',
  assignmentId, assignmentIds: [assignmentId],
  status: 'counted', issuedAt: 1, issuedBy: 'o', amount, method: 'cash',
  note: '', countedBy: 'o', countedAt: 2,
})

const place = (id: string, priority: number): ScheduledLocation =>
  ({ id, name: id, groupCode: '', priority } as ScheduledLocation)

const row = (
  locations: ScheduledLocation[],
  assignments: Assignment[],
  jars: Jar[],
  id: string,
  slots: Slot[] = SLOTS,
) => {
  const report = locationMetrics(locations, assignments, jars, slots)
  return [...report.ranked, ...report.revenueWithoutHours].find((r) => r.locationId === id)
}

describe('the stretch a set of shifts covers', () => {
  it('counts a minute two shifts share once', () => {
    expect(unionMinutes([[300, 360], [300, 360]])).toBe(60)
    expect(unionMinutes([[300, 360], [330, 390]])).toBe(90)
  })

  it('adds stretches that do not touch, and joins ones that butt up', () => {
    expect(unionMinutes([[300, 360], [420, 480]])).toBe(120)
    expect(unionMinutes([[300, 360], [360, 420]])).toBe(120)
  })

  it('does not mind the order they arrive in', () => {
    expect(unionMinutes([[420, 480], [300, 360], [330, 390]])).toBe(150)
  })

  it('is zero for nothing at all', () => {
    expect(unionMinutes([])).toBe(0)
  })
})

describe('covered hours per location', () => {
  it('counts two siblings on one shift as one hour of cover, not two', () => {
    const shifts = [
      shift('a1', 'p1', 'braemar', fri(0)),
      shift('a2', 'p2', 'braemar', fri(0)),
    ]

    expect(staffedHoursByLocation(shifts, SLOTS).get('braemar')).toBe(2)
    expect(coveredHoursByLocation(shifts, SLOTS).get('braemar')).toBe(1)
  })

  it('adds consecutive shifts, so a door worked all evening reads as the whole evening', () => {
    const shifts = [
      shift('a1', 'p1', 'braemar', fri(0)),
      shift('a2', 'p2', 'braemar', fri(1)),
      shift('a3', 'p3', 'braemar', fri(2)),
    ]

    expect(coveredHoursByLocation(shifts, SLOTS).get('braemar')).toBe(3)
  })

  it('counts the shared minutes of a handover once', () => {
    // 60 minute shifts overlapping by 15 start 45 minutes apart: 5:00–6:00 and 5:45–6:45.
    const handover = buildSlots('fri', undefined, {
      shiftMode: 'shifts', shiftMinutes: 60, overlapMinutes: 15, checkInMinutes: 0,
    })
    const shifts = [
      shift('a1', 'p1', 'braemar', handover[0]!.id),
      shift('a2', 'p2', 'braemar', handover[1]!.id),
    ]

    // Two person-hours, but only an hour and three quarters of door.
    expect(staffedHoursByLocation(shifts, handover).get('braemar')).toBe(2)
    expect(coveredHoursByLocation(shifts, handover).get('braemar')).toBe(1.75)
  })

  it('keeps the days apart, so five o`clock Friday is not five o`clock Saturday', () => {
    const shifts = [
      shift('a1', 'p1', 'braemar', fri(0)),
      shift('a2', 'p1', 'braemar', sat(0)),
    ]

    expect(coveredHoursByLocation(shifts, SLOTS).get('braemar')).toBe(2)
  })

  it('keeps the locations apart, so one person cannot cover two doors into one', () => {
    // The same hour at two shops is two doors being worked, whatever the roster says about
    // how one person managed it. Unlike person-hours, which may only credit the minute once.
    const shifts = [
      shift('a1', 'p1', 'braemar', fri(0)),
      shift('a2', 'p1', 'copperpot', fri(0)),
    ]
    const covered = coveredHoursByLocation(shifts, SLOTS)

    expect(covered.get('braemar')).toBe(1)
    expect(covered.get('copperpot')).toBe(1)
    // Person-hours credit that hour once, to whichever shift took it.
    expect(
      [...staffedHoursByLocation(shifts, SLOTS).values()].reduce((a, b) => a + b, 0),
    ).toBe(1)
  })

  it('leaves out the check-in at the front of the block, which happens at base', () => {
    const withLead = buildSlots('fri', undefined, {
      shiftMode: 'shifts', shiftMinutes: 60, overlapMinutes: 0, checkInMinutes: 15,
    })
    const shifts = [shift('a1', 'p1', 'braemar', withLead[0]!.id)]

    // A 75 minute block is an hour of door, the same hour person-hours credit.
    expect(coveredHoursByLocation(shifts, withLead).get('braemar')).toBe(1)
  })

  it('covers nothing for a no-show, or for a shift handed to somebody else', () => {
    const shifts = [
      shift('a1', 'p1', 'braemar', fri(0), 'noShow'),
      shift('a2', 'p2', 'braemar', fri(1), 'swapped'),
    ]

    expect(coveredHoursByLocation(shifts, SLOTS).get('braemar')).toBeUndefined()
  })

  it('places no shift whose slot is unknown, rather than counting it as an hour', () => {
    const shifts = [shift('a1', 'p1', 'braemar', 'fri-nonesuch')]

    expect(coveredHoursByLocation(shifts, SLOTS).get('braemar')).toBeUndefined()
  })

  it('never exceeds the person-hours, and matches them where nobody doubled up', () => {
    const staffed = staffedHoursByLocation(assignments2025, slots2025)
    const covered = coveredHoursByLocation(assignments2025, slots2025)

    for (const [id, hours] of covered) {
      expect(hours).toBeLessThanOrEqual(staffed.get(id)!)
    }
    // Pet Value was one person at a time all the way through.
    expect(covered.get('pet-value-580')).toBe(staffed.get('pet-value-580'))
  })
})

describe('the two rates a location earns', () => {
  it('reports Braemar`s Friday as four person-hours over three hours of door', () => {
    const friday = buildSlots('fri')
    const staffed = staffedHoursByLocation(fridayAssignments2025, friday)
    const covered = coveredHoursByLocation(fridayAssignments2025, friday)

    // `Friday Breakdown!F4` said 3 — COUNTA, with two siblings sharing the 6pm cell.
    expect(staffed.get('braemar-640')).toBe(4)
    // Three shifts, one of them doubled up: the door was worked for three hours.
    expect(covered.get('braemar-640')).toBe(3)
  })

  it('divides the same money two ways, and the pair-worked shift is the difference', () => {
    const locations = [place('braemar', 1)]
    const shifts = [
      shift('a1', 'p1', 'braemar', fri(0)),
      shift('a2', 'p2', 'braemar', fri(0)),
    ]
    const result = row(locations, shifts, [jar('j1', 120, 'braemar', 'a1')], 'braemar')!

    expect(result.staffedHours).toBe(2)
    expect(result.coveredHours).toBe(1)
    expect(result.revenuePerHour).toBe(60)
    expect(result.revenuePerCoveredHour).toBe(120)
  })

  it('agrees with itself where one person worked one shift', () => {
    const locations = [place('braemar', 1)]
    const shifts = [shift('a1', 'p1', 'braemar', fri(0))]
    const result = row(locations, shifts, [jar('j1', 120, 'braemar', 'a1')], 'braemar')!

    expect(result.revenuePerCoveredHour).toBe(result.revenuePerHour)
  })

  it('withholds both rates from base, where the money did not come from the hours', () => {
    const locations = [place('hall', 1), place('braemar', 2)]
    const shifts = [
      shift('a1', 'p1', 'hall', fri(0)),
      shift('a2', 'p2', 'braemar', fri(0)),
    ]
    const jars = [jar('j1', 200, 'hall', 'a1'), jar('j2', 100, 'braemar', 'a2')]
    const report = locationMetrics(locations, shifts, jars, SLOTS, 'hall')

    expect(report.base?.coveredHours).toBe(1)
    expect(report.base?.revenuePerHour).toBeNull()
    expect(report.base?.revenuePerCoveredHour).toBeNull()
  })

  it('withholds both rates from money with no hours behind it, as one anomaly not two', () => {
    const locations = [place('staff-room', 1)]
    const jars = [jar('j1', 86.55, 'staff-room', 'nobody')]
    const report = locationMetrics(locations, [], jars, SLOTS)

    // The $86.55 jar that the workbook ranked fourth. Unrankable on either basis — the two
    // rates go to null together, so the anomaly lists say the same thing whichever is read.
    expect(report.ranked).toHaveLength(0)
    expect(report.revenueWithoutHours.map((r) => r.locationId)).toEqual(['staff-room'])
    expect(report.revenueWithoutHours[0]!.revenuePerCoveredHour).toBeNull()
  })
})

describe('which rate the ranking is on', () => {
  /*
    A shop worked by a pair, and a shop worked alone that took less money.

    Per person-hour the thinly staffed one wins; per covered hour the busier door does. Both
    readings are true and they answer different questions, which is why the screen offers
    both rather than picking one.
  */
  const LOCATIONS = [place('busy', 1), place('quiet', 2)]
  const SHIFTS = [
    shift('a1', 'p1', 'busy', fri(0)),
    shift('a2', 'p2', 'busy', fri(0)),
    shift('a3', 'p3', 'quiet', fri(0)),
  ]
  const JARS = [jar('j1', 150, 'busy', 'a1'), jar('j2', 100, 'quiet', 'a3')]

  it('ranks by person-hour unless told otherwise, as it always did', () => {
    const report = locationMetrics(LOCATIONS, SHIFTS, JARS, SLOTS)

    // $75/person-hour against $100.
    expect(report.ranked.map((r) => r.locationId)).toEqual(['quiet', 'busy'])
    expect(report.ranked.map((r) => r.rank)).toEqual([1, 2])
  })

  it('puts the busier door first when ranked by the hour it was covered', () => {
    const report = locationMetrics(LOCATIONS, SHIFTS, JARS, SLOTS, null, 'coveredHour')

    // $150/hour against $100 — the pair no longer counts against the shop.
    expect(report.ranked.map((r) => r.locationId)).toEqual(['busy', 'quiet'])
    expect(report.ranked.map((r) => r.rank)).toEqual([1, 2])
  })

  it('shares a rank between locations that earned the same, on either basis', () => {
    const locations = [place('a', 1), place('b', 2)]
    const shifts = [
      shift('a1', 'p1', 'a', fri(0)),
      shift('a2', 'p2', 'a', fri(0)),
      shift('a3', 'p3', 'b', fri(0)),
      shift('a4', 'p4', 'b', fri(0)),
    ]
    const jars = [jar('j1', 100, 'a', 'a1'), jar('j2', 100, 'b', 'a3')]
    const report = locationMetrics(locations, shifts, jars, SLOTS, null, 'coveredHour')

    expect(report.ranked.map((r) => r.rank)).toEqual([1, 1])
  })

  it('ranks the same rows whichever basis is chosen', () => {
    const byPerson = locationMetrics(locations2025, assignments2025, jars2025, slots2025)
    const byDoor = locationMetrics(
      locations2025, assignments2025, jars2025, slots2025, null, 'coveredHour',
    )

    expect(new Set(byDoor.ranked.map((r) => r.locationId)))
      .toEqual(new Set(byPerson.ranked.map((r) => r.locationId)))
    expect(byDoor.revenueWithoutHours.map((r) => r.locationId))
      .toEqual(byPerson.revenueWithoutHours.map((r) => r.locationId))
  })
})

describe('the totals the table foots to', () => {
  it('sums the covered hours of every location, base included', () => {
    const locations = [place('hall', 1), place('braemar', 2)]
    const shifts = [
      shift('a1', 'p1', 'hall', fri(0)),
      shift('a2', 'p2', 'braemar', fri(0)),
      shift('a3', 'p3', 'braemar', fri(0)),
    ]
    const report = locationMetrics(locations, shifts, [], SLOTS, 'hall')

    expect(report.totalStaffedHours).toBe(3)
    // One hour of base and one hour of door, however many people stood at either.
    expect(report.totalCoveredHours).toBe(2)
    expect(report.totalCollectingCoveredHours).toBe(1)
  })

  it('never foots to more cover than the event spent in person-hours', () => {
    const report = locationMetrics(locations2025, assignments2025, jars2025, slots2025)

    expect(report.totalCoveredHours).toBeLessThan(report.totalStaffedHours)
    expect(report.totalCollectingCoveredHours).toBeLessThanOrEqual(report.totalCoveredHours)
  })
})
