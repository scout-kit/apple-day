import { describe, expect, it } from 'vitest'
import {
  buildAllSlots,
  buildSlots,
  DEFAULT_SHAPE,
  hourOptions,
  minutesToTimeValue,
  timeValueToMinutes,
  parseAvailability,
  parseSlotLabel,
  slotDurationHours,
  stepMinutes,
} from '../src/domain/slots'
import { staffedHoursByLocation } from '../src/domain/metrics'
import type { SlotShape } from '../src/domain/slots'
import type { Day, SchedulingWindow } from '../src/domain/types'

/**
 * Shift length and overlap.
 *
 * Shifts were fixed at one hour, stepping one hour. A handover needs the next pair to arrive
 * while the current ones are still there — 60 minute shifts overlapping by 15 means a shift
 * ending at 6:00 is followed by one starting at 5:45 — so the step and the length are two
 * different numbers.
 */

const FRIDAY: Partial<Record<Day, SchedulingWindow>> = {
  fri: { startMin: 17 * 60, endMin: 21 * 60 },
}

const HANDOVER: SlotShape = { shiftMinutes: 60, overlapMinutes: 15 }

const labels = (shape: SlotShape): string[] =>
  buildSlots('fri', FRIDAY, shape).map((s) => s.label)

describe('the step between shifts', () => {
  it('is the shift length when nothing overlaps', () => {
    expect(stepMinutes(DEFAULT_SHAPE)).toBe(60)
  })

  it('is shortened by the overlap', () => {
    expect(stepMinutes(HANDOVER)).toBe(45)
  })

  it('never collapses to nothing, however large the overlap', () => {
    // An overlap as long as the shift would otherwise step zero minutes and loop forever.
    expect(stepMinutes({ shiftMinutes: 60, overlapMinutes: 60 })).toBe(5)
    expect(stepMinutes({ shiftMinutes: 60, overlapMinutes: 999 })).toBe(5)
  })
})

describe('building overlapping shifts', () => {
  it('starts them 45 minutes apart and keeps each one an hour long', () => {
    const slots = buildSlots('fri', FRIDAY, HANDOVER)
    expect(slots.map((s) => s.startMin)).toEqual([1020, 1065, 1110, 1155, 1200])
    for (const slot of slots) expect(slot.endMin - slot.startMin).toBe(60)
  })

  it('reads the way the handover was described', () => {
    // "someone ending at 6pm, the person after them starting at 5:45pm"
    const [first, second] = labels(HANDOVER)
    expect(first).toBe('5:00 PM – 6:00 PM')
    expect(second).toBe('5:45 PM – 6:45 PM')
  })

  it('gives every shift a distinct id, minutes included', () => {
    const ids = buildSlots('fri', FRIDAY, HANDOVER).map((s) => s.id)
    expect(ids).toEqual(['fri-1700', 'fri-1745', 'fri-1830', 'fri-1915', 'fri-2000'])
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never runs a shift past the end of the day', () => {
    // A trailing part-shift would send somebody out after the event has packed up.
    for (const slot of buildSlots('fri', FRIDAY, HANDOVER)) {
      expect(slot.endMin).toBeLessThanOrEqual(21 * 60)
    }
  })

  it('keeps the hourly behaviour when nothing overlaps', () => {
    expect(buildSlots('fri', FRIDAY).map((s) => s.id)).toEqual([
      'fri-1700', 'fri-1800', 'fri-1900', 'fri-2000',
    ])
  })

  it('handles a shift length that is not an hour', () => {
    const short = buildSlots('fri', FRIDAY, { shiftMinutes: 30, overlapMinutes: 10 })
    expect(stepMinutes({ shiftMinutes: 30, overlapMinutes: 10 })).toBe(20)
    expect(short[0]!.label).toBe('5:00 PM – 5:30 PM')
    expect(short[1]!.startMin).toBe(1040)
  })

  it('still offers one shift when the window is shorter than a shift', () => {
    // Better a clipped shift than no way to staff the day at all.
    const tight = buildSlots('fri', { fri: { startMin: 600, endMin: 630 } }, DEFAULT_SHAPE)
    expect(tight).toHaveLength(1)
    expect(tight[0]!.endMin - tight[0]!.startMin).toBe(30)
  })

  it('applies the shape to every day at once', () => {
    const both = buildAllSlots(
      { fri: { startMin: 1020, endMin: 1260 }, sat: { startMin: 420, endMin: 900 } },
      HANDOVER,
    )
    expect(both.filter((s) => s.day === 'fri')).toHaveLength(5)
    expect(both.filter((s) => s.day === 'sat')).toHaveLength(10)
  })
})

describe('hours worked', () => {
  it('counts the shift length, not the gap between starts', () => {
    // Somebody working an overlapping hour still worked an hour.
    const slots = buildSlots('fri', FRIDAY, HANDOVER)
    for (const slot of slots) expect(slotDurationHours(slot)).toBe(1)
  })

  it('gives two overlapping shifts two person-hours', () => {
    const slots = buildSlots('fri', FRIDAY, HANDOVER)
    const hours = staffedHoursByLocation(
      [
        {
          id: 'a', slotId: slots[0]!.id, locationId: 'sobeys', personId: 'p1',
          status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
        },
        {
          id: 'b', slotId: slots[1]!.id, locationId: 'sobeys', personId: 'p2',
          status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
        },
      ],
      slots,
    )
    // 15 minutes of that is side by side, and both of them really did work an hour.
    expect(hours.get('sobeys')).toBe(2)
  })
})

describe('reading availability against overlapping shifts', () => {
  it('snaps an hourly form answer to the nearest real shift', () => {
    // A form still offering "6:00 – 7:00" must not produce an id for a shift that does not
    // exist, or the availability silently reads as "not free".
    expect(parseSlotLabel('fri', '6:00 - 7:00', FRIDAY, HANDOVER)).toMatchObject({
      ok: true,
      slotId: 'fri-1745',
    })
    expect(parseSlotLabel('fri', '5:00 - 6:00', FRIDAY, HANDOVER)).toMatchObject({
      ok: true,
      slotId: 'fri-1700',
    })
  })

  it('takes an exact overlapping time as itself', () => {
    expect(parseSlotLabel('fri', '5:45 - 6:45', FRIDAY, HANDOVER)).toMatchObject({
      ok: true,
      slotId: 'fri-1745',
    })
  })

  it('still refuses a time outside the day', () => {
    expect(parseSlotLabel('fri', '11:00 - 12:00', FRIDAY, HANDOVER)).toMatchObject({
      ok: false,
      reason: 'outsideWindow',
    })
  })

  it('maps a whole multi-select answer onto real shifts', () => {
    const { slotIds, problems } = parseAvailability(
      'fri',
      '5:00 - 6:00, 6:00 - 7:00, 8:00 - 9:00',
      FRIDAY,
      HANDOVER,
    )
    expect(problems).toEqual([])
    expect(slotIds).toEqual(['fri-1700', 'fri-1745', 'fri-2000'])
  })

  it('does not collapse two answers onto one shift', () => {
    // Shifts start 5:00, 5:45, 6:30, 7:15, 8:00. 6:00 is nearest 5:45; 7:00 is 15 minutes
    // from 7:15 but 30 from 6:30, so it snaps forward. Distinct answers stay distinct.
    const { slotIds } = parseAvailability('fri', '6:00 - 7:00, 7:00 - 8:00', FRIDAY, HANDOVER)
    expect(new Set(slotIds).size).toBe(slotIds.length)
    expect(slotIds).toEqual(['fri-1745', 'fri-1915'])
  })

  it('picks whichever shift start is closest, in either direction', () => {
    // Shifts start 5:45 and 6:30. An exact start matches itself.
    expect(parseSlotLabel('fri', '6:30', FRIDAY, HANDOVER)).toMatchObject({
      slotId: 'fri-1830',
    })
    // 6:15 is 15 minutes from 6:30 and 30 from 5:45, so it snaps forward.
    expect(parseSlotLabel('fri', '6:15', FRIDAY, HANDOVER)).toMatchObject({
      slotId: 'fri-1830',
    })
    // 6:00 is 15 from 5:45 and 30 from 6:30, so it snaps back.
    expect(parseSlotLabel('fri', '6:00', FRIDAY, HANDOVER)).toMatchObject({
      slotId: 'fri-1745',
    })
  })

  it('refuses a time no shift is near, rather than snapping across the evening', () => {
    // Half a shift is the limit: an answer far from any start is a problem to report, not
    // something to guess at.
    const short: SlotShape = { shiftMinutes: 30, overlapMinutes: 0 }
    const window = { fri: { startMin: 17 * 60, endMin: 18 * 60 } }
    expect(parseSlotLabel('fri', '8:00', window, short)).toMatchObject({ ok: false })
  })
})

describe('entering a time', () => {
  it('round-trips minutes through an input value', () => {
    for (const min of [0, 15, 7 * 60, 17 * 60 + 45, 23 * 60 + 45]) {
      expect(timeValueToMinutes(minutesToTimeValue(min))).toBe(min)
    }
  })

  it('formats with a leading zero, as the input requires', () => {
    expect(minutesToTimeValue(7 * 60 + 5)).toBe('07:05')
    expect(minutesToTimeValue(17 * 60 + 45)).toBe('17:45')
  })

  it('reads a quarter-hour time', () => {
    expect(timeValueToMinutes('17:45')).toBe(1065)
    expect(timeValueToMinutes('07:15')).toBe(435)
  })

  it('accepts a single-digit hour, which some browsers emit', () => {
    expect(timeValueToMinutes('7:15')).toBe(435)
  })

  it('returns nothing for a cleared or half-typed field', () => {
    // Null, not zero: a blank field must leave the stored time alone rather than silently
    // resetting the day to midnight.
    for (const value of ['', '  ', '1', '17:', ':30', 'abc', '17:5']) {
      expect(timeValueToMinutes(value), value).toBeNull()
    }
  })

  it('rejects an impossible time', () => {
    expect(timeValueToMinutes('24:00')).toBeNull()
    expect(timeValueToMinutes('17:60')).toBeNull()
  })

  it('clamps a stored value that could not be shown', () => {
    // 24:00 is a valid stored end-of-day but not a valid input value.
    expect(minutesToTimeValue(24 * 60)).toBe('23:59')
    expect(minutesToTimeValue(-30)).toBe('00:00')
  })

  it('offers quarter-hour options where a list is still used', () => {
    const options = hourOptions()
    // Every 15 minutes across the day, plus midnight at the end.
    expect(options).toHaveLength(97)
    expect(options[1]!.label).toBe('12:15 AM')
    expect(options.at(-1)).toEqual({ min: 1440, label: 'midnight' })
  })
})

describe('an event with no shifts at all', () => {
  const WHOLE_DAY: SlotShape = {
    shiftMode: 'wholeDay',
    shiftMinutes: 60,
    overlapMinutes: 0,
  }

  it('gives each day a single slot spanning its window', () => {
    const slots = buildSlots('fri', FRIDAY, WHOLE_DAY)
    expect(slots).toHaveLength(1)
    expect(slots[0]!.startMin).toBe(17 * 60)
    expect(slots[0]!.endMin).toBe(21 * 60)
    expect(slots[0]!.label).toBe('5:00 PM – 9:00 PM')
  })

  it('ignores the shift length and overlap entirely', () => {
    const withShape = buildSlots('fri', FRIDAY, {
      shiftMode: 'wholeDay',
      shiftMinutes: 30,
      overlapMinutes: 25,
    })
    expect(withShape).toHaveLength(1)
    expect(withShape[0]!.endMin - withShape[0]!.startMin).toBe(4 * 60)
  })

  it('counts the whole window as hours worked', () => {
    // Somebody there for the duration worked four hours, not one.
    const slot = buildSlots('fri', FRIDAY, WHOLE_DAY)[0]!
    expect(slotDurationHours(slot)).toBe(4)
  })

  it('gives one slot per day across the event', () => {
    const slots = buildAllSlots(
      { fri: { startMin: 1020, endMin: 1260 }, sat: { startMin: 420, endMin: 900 } },
      WHOLE_DAY,
    )
    expect(slots).toHaveLength(2)
    expect(slots.map((s) => s.day)).toEqual(['fri', 'sat'])
  })

  it('has no slots for a day the event does not run', () => {
    expect(buildSlots('sun', FRIDAY, WHOLE_DAY)).toEqual([])
  })

  it('takes any time in the day as available', () => {
    // The single slot starts at the beginning of the day, so an answer of 8pm is hours from
    // that start but plainly inside the day — every time in the window means the same thing.
    for (const answer of ['5:00 - 6:00', '6:00 - 7:00', '7:00 - 8:00', '8:00 - 9:00']) {
      expect(parseSlotLabel('fri', answer, FRIDAY, WHOLE_DAY), answer).toMatchObject({
        ok: true,
        slotId: 'fri-1700',
      })
    }
  })

  it('collapses a whole multi-select answer to the one slot', () => {
    const { slotIds, problems } = parseAvailability(
      'fri',
      '5:00 - 6:00, 7:00 - 8:00, 8:00 - 9:00',
      FRIDAY,
      WHOLE_DAY,
    )
    expect(problems).toEqual([])
    expect(slotIds).toEqual(['fri-1700'])
  })

  it('still refuses a time outside the day', () => {
    expect(parseSlotLabel('fri', '11:00 - 12:00', FRIDAY, WHOLE_DAY)).toMatchObject({
      ok: false,
    })
  })
})

describe('the containment fallback does not disturb shift matching', () => {
  it('still identifies a shift by its start time', () => {
    // A form answer is a shift label, so nearest start wins before containment is tried.
    expect(parseSlotLabel('fri', '6:00 - 7:00', FRIDAY, DEFAULT_SHAPE)).toMatchObject({
      slotId: 'fri-1800',
    })
    expect(parseSlotLabel('fri', '6:00 - 7:00', FRIDAY, HANDOVER)).toMatchObject({
      slotId: 'fri-1745',
    })
  })

  it('never needs the fallback for ordinary shifts', () => {
    // Tolerance is half a shift, so any time inside a shift is within reach of one of its
    // ends — nearest start decides every answer, and containment is only what rescues the
    // whole-day case, where one slot spans hours from its single start.
    const long: SlotShape = { shiftMinutes: 120, overlapMinutes: 0 }
    const slots = buildSlots('fri', FRIDAY, long)
    expect(slots.map((s) => s.id)).toEqual(['fri-1700', 'fri-1900'])

    // 6:30 is 30 minutes from the 7:00 start and 90 from the 5:00 one.
    expect(parseSlotLabel('fri', '6:30', FRIDAY, long)).toMatchObject({
      slotId: 'fri-1900',
    })
    // 5:30 is nearer the 5:00 start.
    expect(parseSlotLabel('fri', '5:30', FRIDAY, long)).toMatchObject({
      slotId: 'fri-1700',
    })
  })
})
