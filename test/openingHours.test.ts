import { describe, expect, it } from 'vitest'
import { DEFAULT_OPEN, hoursForNewDay } from '../src/domain/slots'
import type { Day, OpenRange } from '../src/domain/types'

/**
 * What a day gets when it is switched on.
 *
 * Recording a shop's opening hours is seven switches and fourteen dropdowns, to say a thing
 * that is usually one sentence: "nine to nine, every day". Copying the nearest day already
 * open makes the second day onwards free, and the ones that differ are still edited by hand.
 */

const hours = (openMin: number, closeMin: number): OpenRange => ({ openMin, closeMin })

const at = (...days: [Day, OpenRange | null][]): Partial<Record<Day, OpenRange | null>> =>
  Object.fromEntries(days)

describe('copying from the day above', () => {
  it('takes the hours of the day before it', () => {
    const found = hoursForNewDay(at(['sun', hours(7 * 60, 23 * 60)]), 'mon')
    expect(found).toEqual(hours(7 * 60, 23 * 60))
  })

  it('reaches past a day that is shut', () => {
    /*
      The case that makes this worth writing down. Sunday 7am–11pm, Monday closed, and
      Tuesday should still open at seven — Monday being shut says nothing about Tuesday, and
      stopping at it would hand back the generic default instead.
    */
    const found = hoursForNewDay(at(['sun', hours(7 * 60, 23 * 60)], ['mon', null]), 'tue')
    expect(found).toEqual(hours(7 * 60, 23 * 60))
  })

  it('takes the nearest one, not the first', () => {
    // Hours that change midweek should carry forward from the change, not from Sunday.
    const found = hoursForNewDay(
      at(['sun', hours(7 * 60, 23 * 60)], ['wed', hours(9 * 60, 17 * 60)]),
      'thu',
    )
    expect(found).toEqual(hours(9 * 60, 17 * 60))
  })

  it('reaches past a day nobody has said anything about', () => {
    // Absent and explicitly closed look different in the data and mean the same here.
    const found = hoursForNewDay(at(['sun', hours(7 * 60, 23 * 60)]), 'wed')
    expect(found).toEqual(hours(7 * 60, 23 * 60))
  })

  it('ignores a backwards range, which is not open hours', () => {
    // A half-typed range where closing is before opening. Copying it spreads the mistake.
    const found = hoursForNewDay(
      at(['sun', hours(7 * 60, 23 * 60)], ['mon', hours(18 * 60, 9 * 60)]),
      'tue',
    )
    expect(found).toEqual(hours(7 * 60, 23 * 60))
  })
})

describe('when there is nothing above', () => {
  it('looks downwards instead', () => {
    // Somebody who filled in Saturday first. Reaching down is more use than a guess.
    const found = hoursForNewDay(at(['sat', hours(9 * 60, 17 * 60)]), 'sun')
    expect(found).toEqual(hours(9 * 60, 17 * 60))
  })

  it('prefers the day above to the day below', () => {
    const found = hoursForNewDay(
      at(['mon', hours(7 * 60, 23 * 60)], ['fri', hours(9 * 60, 17 * 60)]),
      'wed',
    )
    expect(found).toEqual(hours(7 * 60, 23 * 60))
  })

  it('falls back to a plain long day when the whole week is empty', () => {
    expect(hoursForNewDay({}, 'sun')).toEqual(DEFAULT_OPEN)
  })

  it('falls back when every other day is shut', () => {
    const week = at(['sun', null], ['mon', null], ['tue', null])
    expect(hoursForNewDay(week, 'wed')).toEqual(DEFAULT_OPEN)
  })
})

describe('what it hands back', () => {
  it('is a copy, so editing the new day does not edit the old one', () => {
    /*
      They are separate days that happen to agree. Handing back the same object makes them
      one: changing Tuesday's closing time would silently move Sunday's too.
    */
    const week = at(['sun', hours(7 * 60, 23 * 60)])
    const found = hoursForNewDay(week, 'tue')
    found.closeMin = 12 * 60
    expect(week.sun).toEqual(hours(7 * 60, 23 * 60))
  })

  it('does not hand back the shared default object either', () => {
    const first = hoursForNewDay({}, 'sun')
    first.openMin = 5 * 60
    expect(DEFAULT_OPEN.openMin).toBe(8 * 60)
  })
})
