import { describe, expect, it } from 'vitest'
import {
  locationMetrics,
  personTotals,
  revenueBySlot,
  sectionParticipation,
} from '../src/domain/metrics'
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

describe('the figures at the top of the money screen', () => {
  const LOCATIONS = [
    { id: 'braemar', name: 'Braemar', groupCode: '', priority: 1 },
    { id: BASE, name: 'Scout Hall', groupCode: '', priority: 2 },
  ] as never[]

  /** $100 from a doorstep, and $40 of apples sold at the table. */
  const APPLES: Jar = {
    ...jar('j2', 40, ''), id: 'j2', jarNumber: null, locationId: BASE,
    personId: null, assignmentId: null, assignmentIds: [], note: 'apples',
  } as Jar

  it('divides the per person-hour by the hours out collecting', () => {
    const report = locationMetrics(LOCATIONS, WORKED, [...JARS, APPLES], SLOTS, BASE)

    // Everything is still in the totals: the apples are revenue, the table is hours.
    expect(report.totalRevenue).toBe(140)
    expect(report.totalStaffedHours).toBe(2)
    // But the rate divides by the one hour somebody was out.
    expect(report.totalCollectingHours).toBe(1)
  })

  it('keeps base out of the ranking it would otherwise sit in', () => {
    const report = locationMetrics(LOCATIONS, WORKED, [...JARS, APPLES], SLOTS, BASE)

    expect(report.ranked.map((r) => r.locationId)).toEqual(['braemar'])
    // Its own row still carries both, for the line that explains the difference.
    expect(report.base?.revenue).toBe(40)
    expect(report.base?.staffedHours).toBe(1)
    expect(report.base?.revenuePerHour).toBeNull()
  })

  it('stops warning about base, which is doing neither thing wrong', () => {
    /*
      Base takes money with no hours behind it and holds hours that take no money. Both are
      what it is for, and neither is the data-entry mistake these lists exist to catch.
    */
    const report = locationMetrics(LOCATIONS, WORKED, [...JARS, APPLES], SLOTS, BASE)
    expect(report.revenueWithoutHours.map((r) => r.locationId)).not.toContain(BASE)
    expect(report.staffedWithoutRevenue.map((r) => r.locationId)).not.toContain(BASE)
  })

  it('was the bug: base hours dragged the per person-hour down', () => {
    const report = locationMetrics(LOCATIONS, WORKED, [...JARS, APPLES], SLOTS)
    // No base set, so $140 is divided by two hours instead of one.
    expect(report.totalCollectingHours).toBe(2)
    expect(report.ranked.map((r) => r.locationId)).toContain(BASE)
  })

  it('does not stretch the clock with an hour that was only ever base', () => {
    // An hour the table was open and the street was empty is not an hour of Apple Day to
    // divide the takings across.
    const onlyBase = revenueBySlot([shift('a-base', 'p-base', BASE)], [], SLOTS, BASE)
    expect(onlyBase.clockHours).toBe(0)
    expect(onlyBase.slotsWorked).toBe(0)
  })
})
