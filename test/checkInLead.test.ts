import { describe, expect, it } from 'vitest'
import { countedHours, countedWindows } from '../src/domain/countedHours'
import { buildSlots, parseSlotLabel, slotDurationHours } from '../src/domain/slots'
import { personTotals, staffedHoursByLocation } from '../src/domain/metrics'
import { buildPassShifts } from '../src/domain/publishing'
import type { Assignment } from '../src/domain/types'

/**
 * Counting the shift, not the block it sits in.
 *
 * The event this was written for runs Friday from a quarter to five until nine, in four 75
 * minute blocks with a 15 minute handover. People were out collecting for an hour of each:
 * the first fifteen minutes is checking in at the table and being handed a jar, which is
 * time somebody gave but is not time on a doorstep. Every hours figure in the app counted
 * the whole block, so a four shift evening read as 5 hours of work for an evening that was
 * 4, and revenue per hour was a fifth too low.
 *
 * The lead is the front of the block rather than something in front of it, which is the
 * whole reason an event can adopt it afterwards: `startMin` does not move, so the slot id
 * does not move, so every shift already recorded still answers to its own name.
 */

/** Production: Friday 4:45 PM to 9:00 PM, 75 minute blocks, 15 minute handover. */
const FRI = { fri: { startMin: 16 * 60 + 45, endMin: 21 * 60 } }
const SHAPE = {
  shiftMode: 'shifts' as const,
  shiftMinutes: 75,
  overlapMinutes: 15,
  checkInMinutes: 15,
}

const shift = (id: string, slotId: string, personId = 'p1', locationId = 'braemar'): Assignment => ({
  id, slotId, locationId, personId,
  status: 'checkedIn', whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
})

describe('a block, and the shift inside it', () => {
  const slots = buildSlots('fri', FRI, SHAPE)

  it('keeps the slot ids an event already has', () => {
    // The point of the whole design: adopting a lead renames nothing.
    expect(slots.map((s) => s.id)).toEqual(['fri-1645', 'fri-1745', 'fri-1845', 'fri-1945'])
    expect(buildSlots('fri', FRI, { ...SHAPE, checkInMinutes: 0 }).map((s) => s.id))
      .toEqual(slots.map((s) => s.id))
  })

  it('tells people the block and reports the shift', () => {
    const first = slots[0]!
    expect(first.startMin).toBe(16 * 60 + 45)
    expect(first.workStartMin).toBe(17 * 60)
    expect(first.endMin).toBe(18 * 60)
    // Unchanged from what this event already says on a pass and in a reminder.
    expect(first.arriveLabel).toBe('4:45 PM – 6:00 PM')
    // New, and only on the board and the money screens.
    expect(first.label).toBe('5:00 PM – 6:00 PM')
  })

  it('counts an hour for a block of an hour and a quarter', () => {
    expect(slotDurationHours(slots[0]!)).toBe(1)
  })

  it('covers the evening with the shifts worked back to back', () => {
    expect(slots.map((s) => s.label)).toEqual([
      '5:00 PM – 6:00 PM', '6:00 PM – 7:00 PM', '7:00 PM – 8:00 PM', '8:00 PM – 9:00 PM',
    ])
  })

  it('leaves an event that asks for no check-in exactly as it was', () => {
    for (const slot of buildSlots('fri', FRI, { ...SHAPE, checkInMinutes: 0 })) {
      expect(slot.workStartMin).toBe(slot.startMin)
      expect(slot.label).toBe(slot.arriveLabel)
    }
  })
})

describe('hours worked', () => {
  const slots = buildSlots('fri', FRI, SHAPE)

  it('counts one shift as the hour it was', () => {
    expect(countedHours([shift('a', 'fri-1645')], slots).get('a')).toBe(1)
  })

  /** The reported bug, to the minute. */
  it('counts two shifts in a row as 2 hours, not 2.5', () => {
    const worked = [shift('a', 'fri-1645'), shift('b', 'fri-1745')]
    const hours = countedHours(worked, slots)
    expect([...hours.values()].reduce((a, b) => a + b, 0)).toBe(2)
    expect(hours.get('a')).toBe(1)
    expect(hours.get('b')).toBe(1)
  })

  it('counts the whole evening as four hours', () => {
    const worked = slots.map((s, i) => shift(`a${i}`, s.id))
    const total = [...countedHours(worked, slots).values()].reduce((a, b) => a + b, 0)
    // A quarter to five until nine is four and a quarter hours on site, four of them worked.
    expect(total).toBe(4)
  })

  it("keeps one person out of another person's total", () => {
    const hours = countedHours(
      [shift('a', 'fri-1645', 'p1'), shift('b', 'fri-1645', 'p2')], slots,
    )
    expect(hours.get('a')).toBe(1)
    expect(hours.get('b')).toBe(1)
  })

  it('credits an hour once to somebody booked at two shops at the same time', () => {
    const hours = countedHours(
      [shift('a', 'fri-1645', 'p1', 'braemar'), shift('b', 'fri-1645', 'p1', 'kelmont')], slots,
    )
    expect(hours.get('a')).toBe(1)
    expect(hours.get('b')).toBeUndefined()
  })

  it('does not run Friday evening into Saturday morning', () => {
    const both = [
      ...slots,
      ...buildSlots('sat', { sat: { startMin: 16 * 60 + 45, endMin: 19 * 60 } }, SHAPE),
    ]
    const hours = countedHours([shift('a', 'fri-1645'), shift('b', 'sat-1645')], both)
    expect(hours.get('a')).toBe(1)
    expect(hours.get('b')).toBe(1)
  })

  it('places a shift whose slot has gone nowhere at all', () => {
    expect(countedWindows([shift('a', 'fri-0300')], slots).get('a')).toBeUndefined()
  })
})

describe('the totals every screen reads', () => {
  const slots = buildSlots('fri', FRI, SHAPE)
  const worked = [shift('a', 'fri-1645'), shift('b', 'fri-1745')]

  it("agrees between a person's total and their location's", () => {
    expect(personTotals(worked, [], slots)[0]!.hours).toBe(2)
    expect(staffedHoursByLocation(worked, slots).get('braemar')).toBe(2)
  })

  it('leaves a no-show out of the counting, and out of the overlap maths', () => {
    const noShow: Assignment = { ...shift('a', 'fri-1645'), status: 'noShow', whereabouts: 'here' }
    expect(personTotals([noShow, worked[1]!], [], slots)[0]!.hours).toBe(1)
  })
})

describe('what people are told', () => {
  const slots = buildSlots('fri', FRI, SHAPE)

  it('puts the block on a pass, not the shift', () => {
    const [passShift] = buildPassShifts('p1', {
      locations: [
        { id: 'braemar', name: 'Braemar', address: '1 High St', mapsUrl: '', comments: '' } as never,
      ],
      assignments: [shift('a', 'fri-1645')],
      slots,
    })
    expect(passShift!.slotLabel).toBe('4:45 PM – 6:00 PM')
  })

  it('reads a block label on the signup form back onto its own shift', () => {
    const parsed = parseSlotLabel('fri', slots[0]!.arriveLabel, FRI, SHAPE)
    expect(parsed).toMatchObject({ ok: true, slotId: 'fri-1645' })
  })
})
