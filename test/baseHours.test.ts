import { describe, expect, it } from 'vitest'
import { personTotals, revenueBySlot, sectionParticipation } from '../src/domain/metrics'
import { eventTotals } from '../src/domain/history'
import { buildAllSlots } from '../src/domain/slots'
import { blankEvent } from '../src/domain/events'
import { DEFAULT_SECTIONS } from '../src/domain/sections'
import type { Assignment, Jar, Person, Slot } from '../src/domain/types'

/**
 * Hours at base are hours, but they are not hours anybody was out collecting.
 *
 * Three or four people are on the table all day — check-in, apples, cooking, counting the
 * money — and every rate in this app divides money by hours. Counting them in the
 * denominator means the better a group staffs its base the worse its evening looks, which
 * is the opposite of what the figure is read for.
 *
 * So they are still counted, and still shown. They are kept out of the division.
 */

const SLOTS: Slot[] = buildAllSlots()
const SLOT = SLOTS.find((s) => s.day === 'fri')!.id
const BASE = 'hall'

const shift = (id: string, personId: string, locationId: string): Assignment => ({
  id, slotId: SLOT, locationId, personId,
  status: 'checkedIn', whereabouts: 'back', checkedInAt: 1, checkedOutAt: 2,
})

const jar = (id: string, amount: number, assignmentId: string): Jar => ({
  id, jarNumber: 1, day: 'fri', locationId: 'braemar', personId: 'p-out',
  assignmentId, assignmentIds: [assignmentId],
  status: 'counted', issuedAt: 1, issuedBy: 'o', amount, method: 'cash',
  note: '', countedBy: 'o', countedAt: 2,
})

const person = (id: string, section: string): Person => ({
  id, firstName: id, lastName: 'X', section,
  parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
} as Person)

/** One youth out collecting and bringing in $100; one leader on the table beside them. */
const WORKED = [shift('a-out', 'p-out', 'braemar'), shift('a-base', 'p-base', BASE)]
const JARS = [jar('j1', 100, 'a-out')]

describe('the rate a slot earned', () => {
  it('divides by the hours out collecting, not by every hour worked', () => {
    const report = revenueBySlot(WORKED, JARS, SLOTS, BASE)
    const row = report.rows.find((r) => r.slotId === SLOT)!

    // Both hours are counted and reported...
    expect(row.staffedHours).toBe(2)
    expect(row.baseHours).toBe(1)
    // ...and the rate is $100 over the one hour that was actually out.
    expect(row.revenuePerHour).toBe(100)
  })

  it('was the bug: the same evening read as half the rate', () => {
    // No base set, so the leader's hour counts as collecting and drags the figure down.
    const row = revenueBySlot(WORKED, JARS, SLOTS).rows.find((r) => r.slotId === SLOT)!
    expect(row.revenuePerHour).toBe(50)
  })

  it('reports no rate for an hour that was all base', () => {
    // Money against nobody who was out is not a rate, and $100 over zero hours is not a
    // number worth printing.
    const report = revenueBySlot([shift('a-base', 'p-base', BASE)], JARS, SLOTS, BASE)
    const row = report.rows.find((r) => r.slotId === SLOT)!
    expect(row.staffedHours).toBe(1)
    expect(row.revenuePerHour).toBeNull()
  })

  it('leaves an event with no base exactly as it was', () => {
    const withBase = revenueBySlot(WORKED, JARS, SLOTS, null)
    const without = revenueBySlot(WORKED, JARS, SLOTS)
    expect(withBase.rows).toEqual(without.rows)
  })
})

describe("a year's own rate", () => {
  const data = {
    event: { ...blankEvent('Apple Day 2026'), id: 'e1', baseLocationId: BASE },
    assignments: WORKED,
    jars: JARS,
    slots: SLOTS,
  }

  it('keeps the base hours and leaves them out of the rate', () => {
    const totals = eventTotals(data)
    expect(totals.staffedHours).toBe(2)
    expect(totals.baseHours).toBe(1)
    expect(totals.revenuePerHour).toBe(100)
  })

  it('counts somebody at base as a volunteer, because they turned out', () => {
    expect(eventTotals(data).volunteers).toBe(2)
  })

  it('reads as it always did when no base is set', () => {
    const totals = eventTotals({ ...data, event: { ...data.event, baseLocationId: null } })
    expect(totals.baseHours).toBe(0)
    expect(totals.revenuePerHour).toBe(50)
  })
})

describe('whose hours they were', () => {
  it('splits a person total without losing any of it', () => {
    const rows = personTotals(WORKED, JARS, SLOTS, BASE)
    const atBase = rows.find((r) => r.personId === 'p-base')!
    const out = rows.find((r) => r.personId === 'p-out')!

    expect(atBase.hours).toBe(1)
    expect(atBase.baseHours).toBe(1)
    // The hour is still theirs. It just did not earn anything, and the row says so.
    expect(atBase.revenue).toBe(0)

    expect(out.hours).toBe(1)
    expect(out.baseHours).toBe(0)
  })

  it('splits the section figures the same way', () => {
    const people = [person('p-out', 'cubs'), person('p-base', 'scouters')]
    const result = sectionParticipation(people, WORKED, SLOTS, DEFAULT_SECTIONS, BASE)

    expect(result.totalHours).toBe(2)
    expect(result.baseHours).toBe(1)
    expect(result.rows.find((r) => r.section === 'scouters')!.baseHours).toBe(1)
    expect(result.rows.find((r) => r.section === 'cubs')!.baseHours).toBe(0)
    // Youth hours are unchanged: this splits where an hour was spent, not who gave it.
    expect(result.youthHours).toBe(1)
  })
})
