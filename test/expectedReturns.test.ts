import { describe, expect, it } from 'vitest'
import { expectedReturns, totalExpected } from '../src/domain/returns'
import type { AssignmentStatus, Whereabouts } from '../src/domain/types'

/**
 * How many to expect back at base, and when.
 *
 * Asked by whoever is cooking: food has to be hot when a stretch ends, and cold food for
 * fifteen is as wrong as hot food for three.
 *
 * Counted from where people actually are rather than from the roster, which is the whole
 * point of it. A roster says forty are due back at seven; the eight who never turned up are
 * eight meals in the bin.
 */

const shift = (status: AssignmentStatus, whereabouts: Whereabouts) => ({
  status, whereabouts,
})

const out = shift('checkedIn', 'out')
const atTable = shift('checkedIn', 'here')
const home = shift('checkedIn', 'back')
const absent = shift('noShow', 'here')
const notYet = shift('confirmed', 'here')

const run = (endMin: number, ...shifts: { status: AssignmentStatus; whereabouts: Whereabouts }[]) => ({
  endMin, shifts,
})

describe('who is still owed a return', () => {
  it('counts the ones who are out, by when their stretch ends', () => {
    const buckets = expectedReturns([run(18 * 60, out), run(18 * 60, out), run(19 * 60, out)])
    expect(buckets).toEqual([
      { endMin: 18 * 60, label: '6:00 PM', people: 2 },
      { endMin: 19 * 60, label: '7:00 PM', people: 1 },
    ])
  })

  it('counts somebody checked in at the table, who also eats', () => {
    // They are at base when the stretch ends either way, and the question is how many
    // plates to have ready.
    expect(expectedReturns([run(18 * 60, atTable)])[0]!.people).toBe(1)
  })

  it('drops somebody once they are back', () => {
    // The count falling through the evening is the behaviour being bought here.
    expect(expectedReturns([run(18 * 60, home)])).toEqual([])
  })

  it('never counts a no-show', () => {
    expect(expectedReturns([run(18 * 60, absent)])).toEqual([])
  })

  it('never counts somebody who has not checked in', () => {
    /*
      The roster's own mistake. Until somebody is at the table they have promised nothing,
      and cooking for them is the waste this replaces.
    */
    expect(expectedReturns([run(18 * 60, notYet)])).toEqual([])
  })

  it('counts a two-hour stretch once, at the far end', () => {
    // Two hours at one shop is one trip and one return. Counting both ends feeds them twice.
    const buckets = expectedReturns([run(19 * 60, out, out)])
    expect(buckets).toEqual([{ endMin: 19 * 60, label: '7:00 PM', people: 1 }])
  })

  it('keeps a stretch whose last hour is still out', () => {
    // `runState` reads a run as out while any hour of it is, so handing back the first jar
    // does not take somebody off the list while they are still at a door.
    expect(expectedReturns([run(19 * 60, home, out)])[0]!.people).toBe(1)
  })

  it('ignores a run whose slot has gone', () => {
    // No end time is no hour to expect them in, and a guess here is a meal.
    expect(expectedReturns([{ endMin: null, shifts: [out] }])).toEqual([])
  })

  it('reads in time order whatever order it was given', () => {
    const buckets = expectedReturns([run(20 * 60, out), run(18 * 60, out), run(19 * 60, out)])
    expect(buckets.map((b) => b.label)).toEqual(['6:00 PM', '7:00 PM', '8:00 PM'])
  })

  it('adds up to everybody still to come in', () => {
    expect(totalExpected(expectedReturns([run(18 * 60, out), run(19 * 60, out, out)]))).toBe(2)
  })
})
