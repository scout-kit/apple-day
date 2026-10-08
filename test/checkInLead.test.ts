import { describe, expect, it } from 'vitest'
import { countedHours, countedWindows } from '../src/domain/countedHours'
import { groupIntoRuns, runArrivalSpan, runSpan } from '../src/domain/shiftRuns'
import { buildSlots, parseSlotLabel } from '../src/domain/slots'
import { personTotals, staffedHoursByLocation } from '../src/domain/metrics'
import type { Assignment } from '../src/domain/types'

/**
 * Asking people to turn up a quarter of an hour early, without paying for it twice.
 *
 * The event wanted a 15 minute check-in window on hour-long shifts and bought it by setting
 * the shift length to 75 minutes. That put the extra quarter-hour on the *end* of the
 * shift, where it belongs to nobody: it collided with the next shift, so anybody doing two
 * in a row was credited with 2½ hours for a stretch of 2¼, and it pushed the last shift of
 * the evening past closing time so the final hour could not be staffed at all.
 *
 * A lead sits in front of the shift instead. These tests pin both halves of that: the hours
 * a person is credited with, and the fact that the schedule keeps whole-hour shifts.
 */

const FRI = { fri: { startMin: 17 * 60, endMin: 21 * 60 } }
const SHAPE = { shiftMode: 'shifts' as const, shiftMinutes: 60, overlapMinutes: 0, checkInMinutes: 15 }

const shift = (id: string, slotId: string, personId = 'p1', locationId = 'braemar'): Assignment => ({
  id, slotId, locationId, personId,
  status: 'checkedIn', whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
})

describe('the shape of a shift with a check-in lead', () => {
  it('keeps the shift an hour and asks for the quarter-hour in front of it', () => {
    const [first] = buildSlots('fri', FRI, SHAPE)
    expect(first!.startMin).toBe(17 * 60)
    expect(first!.endMin).toBe(18 * 60)
    expect(first!.arriveMin).toBe(16 * 60 + 45)
    // What the board and the money screens show, against what a pass and a reminder say.
    expect(first!.label).toBe('5:00 PM – 6:00 PM')
    expect(first!.arriveLabel).toBe('4:45 PM – 6:00 PM')
  })

  it('staffs the whole evening, which a 75 minute shift could not', () => {
    const asLead = buildSlots('fri', FRI, SHAPE)
    expect(asLead.map((s) => s.label)).toEqual([
      '5:00 PM – 6:00 PM', '6:00 PM – 7:00 PM', '7:00 PM – 8:00 PM', '8:00 PM – 9:00 PM',
    ])

    // The workaround this replaces: the last hour of the day has no shift to put anyone in.
    const asLongShift = buildSlots('fri', FRI, {
      shiftMode: 'shifts', shiftMinutes: 75, overlapMinutes: 15,
    })
    expect(asLongShift).toHaveLength(3)
    expect(asLongShift.at(-1)!.endMin).toBe(20 * 60 + 15)
  })

  it('leaves an event that asks for no lead exactly as it was', () => {
    const plain = buildSlots('fri', FRI, { shiftMode: 'shifts', shiftMinutes: 60, overlapMinutes: 0 })
    for (const slot of plain) {
      expect(slot.arriveMin).toBe(slot.startMin)
      expect(slot.arriveLabel).toBe(slot.label)
    }
  })
})

describe('hours credited for the stretch, not for the shifts', () => {
  const slots = buildSlots('fri', FRI, SHAPE)

  it('counts one shift as its hour plus the lead', () => {
    const hours = countedHours([shift('a', 'fri-1700')], slots)
    expect(hours.get('a')).toBe(1.25)
  })

  /** The reported bug, to the minute. */
  it('counts two shifts in a row as 2.25 hours, not 2.5', () => {
    const worked = [shift('a', 'fri-1700'), shift('b', 'fri-1800')]
    const hours = countedHours(worked, slots)

    // 4:45 to 7:00 is two and a quarter hours, however it is divided into shifts.
    expect([...hours.values()].reduce((a, b) => a + b, 0)).toBe(2.25)
    // The first shift keeps its lead; the second's lead is the first shift's own last
    // quarter of an hour, and is not charged again.
    expect(hours.get('a')).toBe(1.25)
    expect(hours.get('b')).toBe(1)
  })

  it('gives a lead back to a shift that stands on its own', () => {
    // 5–6 and 8–9: nothing to run into, so both are charged in full.
    const hours = countedHours([shift('a', 'fri-1700'), shift('b', 'fri-2000')], slots)
    expect([...hours.values()].reduce((a, b) => a + b, 0)).toBe(2.5)
  })

  it('counts three in a row as one stretch', () => {
    const worked = ['fri-1700', 'fri-1800', 'fri-1900'].map((s, i) => shift(`a${i}`, s))
    const total = [...countedHours(worked, slots).values()].reduce((a, b) => a + b, 0)
    // 4:45 PM to 8:00 PM.
    expect(total).toBe(3.25)
  })

  it("keeps one person out of another person's total", () => {
    const worked = [shift('a', 'fri-1700', 'p1'), shift('b', 'fri-1700', 'p2')]
    const hours = countedHours(worked, slots)
    expect(hours.get('a')).toBe(1.25)
    expect(hours.get('b')).toBe(1.25)
  })

  it('credits an hour once to somebody booked at two shops at the same time', () => {
    const worked = [
      shift('a', 'fri-1700', 'p1', 'braemar'),
      shift('b', 'fri-1700', 'p1', 'kelmont'),
    ]
    const hours = countedHours(worked, slots)
    expect(hours.get('a')).toBe(1.25)
    // Nobody is in two places at once, so the second shop earns no person-hours for it.
    expect(hours.get('b')).toBeUndefined()
  })

  it('does not run Friday evening into Saturday morning', () => {
    const both = [
      ...buildSlots('fri', FRI, SHAPE),
      ...buildSlots('sat', { sat: { startMin: 17 * 60, endMin: 19 * 60 } }, SHAPE),
    ]
    const worked = [shift('a', 'fri-1700'), shift('b', 'sat-1700')]
    const hours = countedHours(worked, both)
    // The same minutes from midnight on two different days, and both count in full.
    expect(hours.get('a')).toBe(1.25)
    expect(hours.get('b')).toBe(1.25)
  })

  it('places a shift whose slot has gone nowhere at all', () => {
    const windows = countedWindows([shift('a', 'fri-0300')], slots)
    expect(windows.get('a')).toBeUndefined()
  })
})

describe('the totals every screen reads', () => {
  const slots = buildSlots('fri', FRI, SHAPE)
  const worked = [shift('a', 'fri-1700'), shift('b', 'fri-1800')]

  it("agrees between a person's total and their location's", () => {
    expect(personTotals(worked, [], slots)[0]!.hours).toBe(2.25)
    expect(staffedHoursByLocation(worked, slots).get('braemar')).toBe(2.25)
  })

  it('leaves a no-show out of the counting, and out of the overlap maths', () => {
    const noShow: Assignment = { ...shift('a', 'fri-1700'), status: 'noShow', whereabouts: 'here' }
    // The 5:00 shift was not worked, so the 6:00 one is a stretch of its own and keeps its
    // own lead rather than losing it to a shift nobody turned up for.
    expect(personTotals([noShow, worked[1]!], [], slots)[0]!.hours).toBe(1.25)
  })
})

describe('what people are told, against what is counted', () => {
  const slots = buildSlots('fri', FRI, SHAPE)

  it('writes a run from the arrival time through to the end', () => {
    const runs = groupIntoRuns(
      [slots[0]!, slots[1]!].map((s) => ({
        locationId: 'braemar', startMin: s.startMin, endMin: s.endMin, arriveMin: s.arriveMin,
      })),
    )
    expect(runs).toHaveLength(1)
    // A pass and a reminder say when to be there.
    expect(runArrivalSpan(runs[0]!, '')).toBe('4:45 PM – 7:00 PM')
    // Reporting says what the shifts are.
    expect(runSpan(runs[0]!, '')).toBe('5:00 PM – 7:00 PM')
  })

  it('reads an arrival label on the signup form back onto its own shift', () => {
    const parsed = parseSlotLabel('fri', slots[0]!.arriveLabel, FRI, SHAPE)
    // 4:45 PM is before the day's window opens, and still belongs to the 5 o'clock shift.
    expect(parsed).toMatchObject({ ok: true, slotId: 'fri-1700' })
  })
})
