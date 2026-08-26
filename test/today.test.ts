import { describe, expect, it } from 'vitest'
import { currentSlot, datesForEventDays, localDate, todaysEventDay } from '../src/domain/today'
import type { Slot } from '../src/domain/types'

/**
 * Which day of the event today is.
 *
 * Every screen that runs the event opened on Friday whatever the date, so the first thing
 * anybody did on Saturday morning was reach for the day switch.
 */

/** Apple Day 2026: Friday 2 October and Saturday 3 October. */
const event = {
  fridayDate: '2026-10-02',
  saturdayDate: '2026-10-03',
  schedule: {
    fri: { startMin: 17 * 60, endMin: 21 * 60 },
    sat: { startMin: 8 * 60, endMin: 15 * 60 },
  },
}

/** Local noon, so the test is not measuring the runner's timezone. */
const at = (iso: string, hour = 12, minute = 0): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y!, m! - 1, d!, hour, minute)
}

describe('the date each event day falls on', () => {
  it('maps the configured days onto real dates', () => {
    expect([...datesForEventDays(event)]).toEqual([
      ['fri', '2026-10-02'],
      ['sat', '2026-10-03'],
    ])
  })

  it('handles a one-day event', () => {
    expect([
      ...datesForEventDays({
        fridayDate: '2026-10-03',
        saturdayDate: '2026-10-03',
        schedule: { sat: { startMin: 480, endMin: 900 } },
      }),
    ]).toEqual([['sat', '2026-10-03']])
  })

  it('handles days that are not Friday and Saturday at all', () => {
    // The schedule takes any day of the week; the two date fields are just the span.
    expect([
      ...datesForEventDays({
        fridayDate: '2026-10-04',
        saturdayDate: '2026-10-05',
        schedule: {
          sun: { startMin: 600, endMin: 900 },
          mon: { startMin: 600, endMin: 900 },
        },
      }),
    ]).toEqual([['sun', '2026-10-04'], ['mon', '2026-10-05']])
  })

  it('ignores a day the event does not run', () => {
    const dates = datesForEventDays({
      ...event,
      schedule: { sat: { startMin: 480, endMin: 900 } },
    })
    expect([...dates]).toEqual([['sat', '2026-10-03']])
  })

  it('is empty when the dates are missing or backwards', () => {
    expect(datesForEventDays({ ...event, fridayDate: '', saturdayDate: '' }).size).toBe(0)
    expect(
      datesForEventDays({ ...event, fridayDate: '2026-10-03', saturdayDate: '2026-10-02' })
        .size,
    ).toBe(0)
    expect(datesForEventDays({ ...event, fridayDate: 'October 2nd' }).size).toBe(0)
  })

  it('does not spin on a mistyped end date', () => {
    // A decade-long span is a typo, not an event.
    const dates = datesForEventDays({ ...event, saturdayDate: '2036-10-03' })
    expect(dates.size).toBeLessThanOrEqual(2)
  })
})

describe('todaysEventDay', () => {
  it('is Friday on the Friday', () => {
    expect(todaysEventDay(event, at('2026-10-02'))).toBe('fri')
  })

  it('is Saturday on the Saturday', () => {
    // The whole point: on the busiest morning of the year, the screens open on Saturday.
    expect(todaysEventDay(event, at('2026-10-03'))).toBe('sat')
  })

  it('is nothing on some other Saturday', () => {
    // Matching on the weekday alone would call a Saturday in March a day of the event.
    expect(todaysEventDay(event, at('2026-03-07'))).toBeNull()
  })

  it('is nothing the day before, or the day after', () => {
    expect(todaysEventDay(event, at('2026-10-01'))).toBeNull()
    expect(todaysEventDay(event, at('2026-10-04'))).toBeNull()
  })

  it('holds at the very start and the very end of the day', () => {
    expect(todaysEventDay(event, at('2026-10-03', 0, 0))).toBe('sat')
    expect(todaysEventDay(event, at('2026-10-03', 23, 59))).toBe('sat')
  })
})

describe('localDate', () => {
  it('is the viewer’s own calendar date, not a UTC one', () => {
    // Stored dates have no timezone, so "today" has to be read the way the person holding
    // the phone reads it.
    expect(localDate(new Date(2026, 9, 3, 23, 30))).toBe('2026-10-03')
    expect(localDate(new Date(2026, 0, 1, 0, 15))).toBe('2026-01-01')
  })
})

describe('the slot happening now', () => {
  const slots: Slot[] = [
    { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5 PM' },
    { id: 'fri-1800', day: 'fri', startMin: 18 * 60, endMin: 19 * 60, label: '6 PM' },
    { id: 'sat-0800', day: 'sat', startMin: 8 * 60, endMin: 9 * 60, label: '8 AM' },
  ]

  it('is the one covering the current time', () => {
    expect(currentSlot(slots, 'fri', at('2026-10-02', 18, 30))?.id).toBe('fri-1800')
  })

  it('is the next one before the day has started', () => {
    // The gap before a shift is exactly when somebody is getting it ready.
    expect(currentSlot(slots, 'fri', at('2026-10-02', 9, 0))?.id).toBe('fri-1700')
  })

  it('is nothing once the day is over', () => {
    expect(currentSlot(slots, 'fri', at('2026-10-02', 23, 0))).toBeNull()
  })

  it('only ever looks at the day asked for', () => {
    expect(currentSlot(slots, 'sat', at('2026-10-03', 8, 30))?.id).toBe('sat-0800')
  })

  it('is nothing for a day with no slots', () => {
    expect(currentSlot(slots, 'sun', at('2026-10-04', 12, 0))).toBeNull()
  })
})
