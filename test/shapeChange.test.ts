import { describe, expect, it } from 'vitest'
import { shapeChangeImpact } from '../src/domain/shapeChange'
import { buildAllSlots } from '../src/domain/slots'
import type { Assignment } from '../src/domain/types'

/**
 * Saying what a change of shape is about to cost, before it costs it.
 *
 * Shifts are stored against a slot id built from the slot's start, so shortening a shift or
 * moving a day's opening time renames the grid underneath them. The shifts do not move with
 * it: they are left pointing at a slot nobody builds any more, which takes them off the
 * board, out of everybody's hours and out of the takings their jars are counted through,
 * and says nothing while doing it.
 */

const FRI = { fri: { startMin: 16 * 60 + 45, endMin: 21 * 60 } }
const SHAPE = { shiftMode: 'shifts' as const, shiftMinutes: 60, overlapMinutes: 0, checkInMinutes: 15 }

const shift = (id: string, slotId: string, personId: string): Assignment => ({
  id, slotId, personId, locationId: 'braemar',
  status: 'checkedIn', whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
})

const before = buildAllSlots(FRI, SHAPE)

describe('warning before a shape change', () => {
  it('says nothing when only the check-in moves', () => {
    // The point of modelling the lead inside the block: the ids do not move, so nothing
    // breaks, so the organiser is not warned off a change that is safe.
    const after = buildAllSlots(FRI, { ...SHAPE, checkInMinutes: 0 })
    const impact = shapeChangeImpact(before, after, [shift('x', 'fri-1645', 'p1')])
    expect(impact.orphaned).toBe(0)
    expect(impact.lost).toEqual([])
  })

  it('names every slot that would go, and who is on it', () => {
    // 60 minute shifts start on the hour, so the whole 4:45 grid is renamed.
    const after = buildAllSlots({ fri: { startMin: 17 * 60, endMin: 21 * 60 } },
      { shiftMode: 'shifts', shiftMinutes: 60, overlapMinutes: 0, checkInMinutes: 0 })
    const impact = shapeChangeImpact(before, after, [
      shift('a', 'fri-1645', 'p1'),
      shift('b', 'fri-1645', 'p2'),
      shift('c', 'fri-1845', 'p1'),
    ])

    expect(impact.orphaned).toBe(3)
    // Busiest first: the cost is the shifts, not the slots.
    expect(impact.lost[0]).toMatchObject({ slotId: 'fri-1645', shifts: 2 })
    expect(impact.lost[0]!.personIds).toEqual(['p1', 'p2'])
    expect(impact.lost.map((s) => s.slotId))
      .toEqual(['fri-1645', 'fri-1845', 'fri-1745', 'fri-1945'])
    // An empty slot still goes; it just costs nothing.
    expect(impact.lost.find((s) => s.slotId === 'fri-1745')!.shifts).toBe(0)
    expect(impact.added).toEqual(['fri-1700', 'fri-1800', 'fri-1900', 'fri-2000'])
  })

  it('shows the slot by the label the board uses today', () => {
    const after = buildAllSlots({ fri: { startMin: 17 * 60, endMin: 21 * 60 } }, SHAPE)
    const impact = shapeChangeImpact(before, after, [shift('a', 'fri-1645', 'p1')])
    expect(impact.lost[0]!.label).toBe('4:45 PM – 6:00 PM')
  })

  it('does not blame this edit for a shift that was already orphaned', () => {
    // `fri-0300` is in no grid, before or after. It is somebody else's problem, and crying
    // wolf about it would make the warning useless on every save.
    const after = buildAllSlots(FRI, SHAPE)
    const impact = shapeChangeImpact(before, after, [shift('a', 'fri-0300', 'p1')])
    expect(impact.orphaned).toBe(0)
  })

  it('counts a person once per slot however many shifts they have on it', () => {
    const after = buildAllSlots({ fri: { startMin: 17 * 60, endMin: 21 * 60 } }, SHAPE)
    const impact = shapeChangeImpact(before, after, [
      shift('a', 'fri-1645', 'p1'),
      shift('b', 'fri-1645', 'p1'),
    ])
    expect(impact.lost[0]).toMatchObject({ shifts: 2 })
    expect(impact.lost[0]!.personIds).toEqual(['p1'])
  })

  it('warns about a day being shortened, not just a shift being resized', () => {
    // Pulling Friday's close back to 8 drops the last block, which is the quiet way to lose
    // a shift: nothing about "shift length" was touched.
    const after = buildAllSlots({ fri: { startMin: 16 * 60 + 45, endMin: 20 * 60 } }, SHAPE)
    const impact = shapeChangeImpact(before, after, [shift('a', 'fri-1945', 'p1')])
    expect(impact.orphaned).toBe(1)
    expect(impact.lost[0]!.slotId).toBe('fri-1945')
  })
})
