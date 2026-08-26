import { describe, expect, it } from 'vitest'
import { blankEvent, eventLabel, readEvent, yearFor } from '../src/domain/events'
import { activeDays, buildSlots } from '../src/domain/slots'

describe('what a new event starts as', () => {
  /*
    The create form and the write both take this, so there is one answer to "what are the
    defaults" rather than two that can drift. They had drifted: the form asked for a name
    and the write chose the rest, which is why every setting was a second dialog away.
  */
  it('is complete enough to be written without editing', () => {
    const e = blankEvent('Apple Day 2027')
    // Nothing undefined: a merged write does not delete what it is not given, so a missing
    // field is not a blank field, it is whatever happened to be there.
    for (const [key, value] of Object.entries(e)) {
      expect(value, key).not.toBeUndefined()
    }
    expect(activeDays(e.schedule).length).toBeGreaterThan(0)
    expect(buildSlots(activeDays(e.schedule)[0]!, e.schedule, e).length).toBeGreaterThan(0)
  })

  it('takes the year from the name, for ordering', () => {
    expect(blankEvent('Apple Day 2027').year).toBe(2027)
    expect(blankEvent('Apple Day, October 1–2 2027').year).toBe(2027)
  })

  it('leaves the year at zero when the name has none', () => {
    // An event is not obliged to be a year. "Spring bottle drive" sorts by whatever else.
    expect(blankEvent('Spring bottle drive').year).toBe(0)
  })

  it('dates itself to the first Friday of October of that year', () => {
    const e = blankEvent('Apple Day 2027')
    expect(e.fridayDate).toBe('2027-10-01')
    expect(e.saturdayDate).toBe('2027-10-02')
  })

  it('carries no id, because the id comes from the name when it is written', () => {
    expect(blankEvent('Apple Day 2027').id).toBe('')
  })

  it('reads back as itself', () => {
    // The form's draft and a stored event have to be the same shape, or editing a new
    // event would behave differently from editing an old one.
    const draft = blankEvent('Apple Day 2027')
    const { id: _id, ...stored } = draft
    expect(readEvent('apple-day-2027', stored)).toMatchObject({
      name: 'Apple Day 2027',
      year: 2027,
      fridayDate: '2027-10-01',
      shiftMode: draft.shiftMode,
      shiftMinutes: draft.shiftMinutes,
      schedule: draft.schedule,
    })
  })

  it('does not share its schedule with the next one', () => {
    // Copied, not referenced: turning off a day on one draft must not turn it off on the
    // defaults every later draft is built from.
    const a = blankEvent('Apple Day 2027')
    delete a.schedule.fri
    a.schedule.sat!.startMin = 3 * 60

    const b = blankEvent('Apple Day 2028')
    expect(b.schedule.fri).toBeDefined()
    // The windows too, not just the map holding them.
    expect(b.schedule.sat!.startMin).not.toBe(3 * 60)
  })
})

describe('what an event is called on screen', () => {
  const event = (name: string, id = 'e1') => ({ id, name })

  it('is its name, which is the thing somebody chose', () => {
    // Not the year. An event is a named thing, and the name is what appears on the form,
    // in the heading and on the bar of a chart.
    expect(eventLabel(event('Apple Day 2026'))).toBe('Apple Day 2026')
    expect(eventLabel(event('Apple Day, October 4–5 2026'))).toBe('Apple Day, October 4–5 2026')
  })

  it('names an event that is not a year at all', () => {
    expect(eventLabel(event('Spring bottle drive'))).toBe('Spring bottle drive')
  })

  it('cannot show a stored year that has drifted from the name', () => {
    /*
      `year` is written once at creation and nothing kept it in step with a rename, so an
      event called "Apple Day 2025" was labelled 2026 everywhere it appeared. Labelling by
      name removes the possibility rather than correcting it.
    */
    expect(eventLabel(event('Apple Day 2025'))).toBe('Apple Day 2025')
  })

  it('falls back to the id rather than showing nothing', () => {
    expect(eventLabel(event('  ', 'apple-day-2026'))).toBe('apple-day-2026')
  })
})

describe('keeping the ordering year in step with the name', () => {
  it('takes the year from a renamed event', () => {
    expect(yearFor('Apple Day 2025', 2026)).toBe(2025)
  })

  it('leaves it alone when the name says nothing about a year', () => {
    // Losing the ordering of "Spring bottle drive" because it has no digits would be worse
    // than keeping an old year.
    expect(yearFor('Spring bottle drive', 2026)).toBe(2026)
  })

  it('sets one where there was none', () => {
    expect(yearFor('Apple Day 2027', 0)).toBe(2027)
  })
})
