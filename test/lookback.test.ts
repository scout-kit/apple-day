import { describe, expect, it } from 'vitest'
import {
  ALL_EVENTS,
  eventLabels,
  lookbackEvents,
  lookbackIds,
  previousEvent,
} from '../src/domain/history'
import type { EventLike } from '../src/domain/history'

/**
 * Which years a lookback puts side by side.
 *
 * Every event at once was the wrong default. The question asked of these screens is almost
 * always "how are we doing against last year", and four extra series answer it worse than
 * none. Wider comparisons stay available, because "the year Braemar doubled" is a real
 * question — just not the first one.
 */

/*
  Three fields, not a loaded year.

  Which years a lookback covers is answerable from the event list alone, and that is the
  whole point of it being answerable that way: the selection is made before anything is
  read, so only the selected years are ever fetched. It used to take fully loaded shifts and
  jars, which meant reading every year in order to decide which two to show.
*/
const event = (id: string, year: number, fridayDate = ''): EventLike => ({
  id,
  year,
  fridayDate,
})

const ALL = [event('2024', 2024), event('2026', 2026), event('2025', 2025)]
const ids = (events: EventLike[]): string[] => events.map((e) => e.id)

describe('choosing what to compare against', () => {
  it('defaults to the event before this one', () => {
    expect(ids(lookbackEvents(ALL, '2026', null))).toEqual(['2025', '2026'])
  })

  it('reads oldest first, the direction a trend runs', () => {
    // A chart with this year on the left and last year on the right reads backwards.
    expect(ids(lookbackEvents(ALL, '2026', null))).toEqual(['2025', '2026'])
    expect(ids(lookbackEvents(ALL, '2025', null))).toEqual(['2024', '2025'])
  })

  it('compares against any other event when asked', () => {
    expect(ids(lookbackEvents(ALL, '2026', '2024'))).toEqual(['2024', '2026'])
  })

  it('still offers every event at once', () => {
    // The wide sweep is a click away rather than gone.
    expect(ids(lookbackEvents(ALL, '2026', ALL_EVENTS))).toEqual(['2024', '2025', '2026'])
  })

  it('shows the current one alone when there is nothing before it', () => {
    // The first year the app was used. Not an error, just no comparison to draw.
    expect(ids(lookbackEvents(ALL, '2024', null))).toEqual(['2024'])
  })

  it('ignores being asked to compare an event with itself', () => {
    expect(ids(lookbackEvents(ALL, '2026', '2026'))).toEqual(['2026'])
  })

  it('falls back to everything when the current event is not among them', () => {
    // An archive opened on its own. Better the lot than silently picking one.
    expect(ids(lookbackEvents(ALL, 'nope', null))).toEqual(['2024', '2025', '2026'])
  })

  it('orders by the event date when years cannot separate them', () => {
    const twice = [
      event('b', 2026, '2026-10-02'),
      event('a', 2026, '2026-04-10'),
    ]
    expect(ids(lookbackEvents(twice, 'b', null))).toEqual(['a', 'b'])
  })
})

describe('the previous event', () => {
  it('is the one immediately before, not the earliest', () => {
    expect(previousEvent(ALL, '2026')?.id).toBe('2025')
  })

  it('is nothing at the start of the record', () => {
    expect(previousEvent(ALL, '2024')).toBeNull()
  })
})

describe('naming events that are shown together', () => {
  it('uses the name, which is what somebody chose to call it', () => {
    const labels = eventLabels([
      { eventId: '2025', name: 'Apple Day 2025', year: 2025 },
      { eventId: '2026', name: 'Apple Day 2026', year: 2026 },
    ])
    expect(labels.get('2026')).toBe('Apple Day 2026')
  })

  it('keeps two events in one year apart, because their names differ', () => {
    /*
      Reported from the running app as a React warning: two chart series both keyed `2026`.
      A rehearsal beside the real thing. Two bars with the same label is not a chart anybody
      can read, whatever React thinks of the keys.
    */
    const labels = eventLabels([
      { eventId: 'real', name: 'Apple Day 2026', year: 2026 },
      { eventId: 'test', name: 'Practice run', year: 2026 },
    ])
    expect(labels.get('real')).toBe('Apple Day 2026')
    expect(labels.get('test')).toBe('Practice run')
    expect(new Set(labels.values()).size).toBe(2)
  })

  it('falls back to the id for an event with neither a name nor a year', () => {
    // Not "0". A bar labelled zero says nothing about which event it is; the id at least
    // names the thing being looked at.
    const labels = eventLabels([{ eventId: 'x', name: '', year: 0 }])
    expect(labels.get('x')).toBe('x')
  })
})

describe('which years get read at all', () => {
  /*
    The reason the selection moved onto the light event list.

    Both screens that compare years used to read every year that had ever run, whatever
    they went on to show — and the location page, which shows one year against the one
    before, is reached by clicking a shop name from the board, the day-of table or the
    money screen.
  */
  it('names two years for the default comparison, however many there are', () => {
    expect(lookbackIds(ALL, '2026', null)).toEqual(['2025', '2026'])
  })

  it('names every year only when every year is asked for', () => {
    expect(lookbackIds(ALL, '2026', ALL_EVENTS)).toEqual(['2024', '2025', '2026'])
  })

  it('names one when there is nothing before it', () => {
    expect(lookbackIds(ALL, '2024', null)).toEqual(['2024'])
  })

  it('names them oldest first, which is the order they are read in', () => {
    expect(lookbackIds(ALL, '2026', '2024')).toEqual(['2024', '2026'])
  })

  it('agrees with the events it selects', () => {
    // Two ways of asking the same question; they must not drift apart.
    for (const against of [null, ALL_EVENTS, '2024']) {
      expect(lookbackIds(ALL, '2026', against)).toEqual(ids(lookbackEvents(ALL, '2026', against)))
    }
  })
})
