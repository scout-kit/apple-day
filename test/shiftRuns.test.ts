import { describe, expect, it } from 'vitest'
import { groupIntoRuns, runTouches } from '../src/domain/shiftRuns'

/**
 * Consecutive shifts at one location.
 *
 * The times do the work, not the slot ids: shifts are configured to overlap — a 60-minute
 * shift starting every 45 — so a run's second shift begins before its first has ended, and
 * anything comparing ids or labels would never notice they join up.
 */

const shift = (locationId: string, startMin: number, lengthMin = 60) => ({
  locationId,
  startMin,
  endMin: startMin + lengthMin,
  tag: `${locationId}@${startMin}`,
})

const H = (h: number): number => h * 60

describe('shifts that continue each other', () => {
  it('joins an exact handover at the same location', () => {
    const runs = groupIntoRuns([shift('braemar', H(17)), shift('braemar', H(18))])
    expect(runs).toHaveLength(1)
    expect(runs[0]!.items.map((s) => s.tag)).toEqual(['braemar@1020', 'braemar@1080'])
    expect(runs[0]!.startMin).toBe(H(17))
    expect(runs[0]!.endMin).toBe(H(19))
  })

  it('joins a deliberate overlap', () => {
    // 60-minute shifts every 45, so the relief arrives before the last person leaves.
    const runs = groupIntoRuns([shift('braemar', H(17)), shift('braemar', H(17) + 45)])
    expect(runs).toHaveLength(1)
    expect(runs[0]!.endMin).toBe(H(18) + 45)
  })

  it('does not join across a gap', () => {
    const runs = groupIntoRuns([shift('braemar', H(17)), shift('braemar', H(19))])
    expect(runs).toHaveLength(2)
  })

  it('does not join different locations, however tidy the times', () => {
    const runs = groupIntoRuns([shift('braemar', H(17)), shift('kelmont', H(18))])
    expect(runs).toHaveLength(2)
    expect(runs.map((r) => r.locationId)).toEqual(['braemar', 'kelmont'])
  })

  it('joins three in a row', () => {
    const runs = groupIntoRuns([
      shift('braemar', H(17)),
      shift('braemar', H(18)),
      shift('braemar', H(19)),
    ])
    expect(runs).toHaveLength(1)
    expect(runs[0]!.items).toHaveLength(3)
    expect(runs[0]!.endMin).toBe(H(20))
  })

  it('does not care what order they arrive in', () => {
    const runs = groupIntoRuns([shift('braemar', H(19)), shift('braemar', H(17)), shift('braemar', H(18))])
    expect(runs).toHaveLength(1)
    expect(runs[0]!.items.map((s) => s.startMin)).toEqual([H(17), H(18), H(19)])
  })

  it('handles a return to the same location later in the day', () => {
    const runs = groupIntoRuns([
      shift('braemar', H(17)),
      shift('braemar', H(18)),
      shift('braemar', H(21)),
    ])
    expect(runs).toHaveLength(2)
    expect(runs[0]!.items).toHaveLength(2)
    expect(runs[1]!.items).toHaveLength(1)
  })

  it('keeps a whole-day shift as one run', () => {
    const runs = groupIntoRuns([shift('braemar', H(8), 7 * 60)])
    expect(runs).toHaveLength(1)
    expect(runs[0]!.endMin).toBe(H(15))
  })

  it('never loses a shift', () => {
    const all = [
      shift('braemar', H(17)),
      shift('braemar', H(18)),
      shift('kelmont', H(18)),
      shift('braemar', H(21)),
    ]
    const runs = groupIntoRuns(all)
    expect(runs.flatMap((r) => r.items)).toHaveLength(all.length)
  })
})

describe('a shift whose slot has gone', () => {
  const unplaced = { locationId: 'braemar', startMin: null, endMin: null, tag: 'broken' }

  it('stands alone rather than joining a run it might not belong to', () => {
    const runs = groupIntoRuns([shift('braemar', H(17)), unplaced])
    expect(runs).toHaveLength(2)
    expect(runs[1]!.items[0]!.tag).toBe('broken')
  })

  it('is still returned, so nothing disappears from the table', () => {
    expect(groupIntoRuns([unplaced])).toHaveLength(1)
  })
})

describe('runTouches', () => {
  const run = groupIntoRuns([shift('braemar', H(17)), shift('braemar', H(18))])[0]!

  it('is true for an hour inside the run', () => {
    expect(runTouches(run, { startMin: H(18), endMin: H(19) })).toBe(true)
  })

  it('is true for the hour the run starts in', () => {
    expect(runTouches(run, { startMin: H(17), endMin: H(18) })).toBe(true)
  })

  it('is false for an hour after it ends', () => {
    // Touching end-to-start is not overlapping: a run finishing at 7 is not part of 7–8.
    expect(runTouches(run, { startMin: H(19), endMin: H(20) })).toBe(false)
  })

  it('is false for an hour before it starts', () => {
    expect(runTouches(run, { startMin: H(16), endMin: H(17) })).toBe(false)
  })

  it('is false for a run that cannot be placed in time', () => {
    const orphan = groupIntoRuns([{ locationId: 'x', startMin: null, endMin: null }])[0]!
    expect(runTouches(orphan, { startMin: H(17), endMin: H(18) })).toBe(false)
  })
})

/**
 * What callers have to do before they call this.
 *
 * A run continues only against the run before it, so two stretches that overlap in time
 * cannot both be built in one pass. That is fine for one person's own shifts — they cannot
 * be in two places at once — but a location's page lists everybody who stood there, and
 * those do overlap. It has to group one person at a time, and this says why.
 */
describe('two stretches running at the same time', () => {
  const interleaved = [
    { locationId: 'alex|braemar', startMin: H(9), endMin: H(10) },
    { locationId: 'sam|braemar', startMin: H(9), endMin: H(10) },
    { locationId: 'alex|braemar', startMin: H(10), endMin: H(11) },
    { locationId: 'sam|braemar', startMin: H(10), endMin: H(11) },
  ]

  it('does not join up when the two are passed together', () => {
    expect(groupIntoRuns(interleaved)).toHaveLength(4)
  })

  it('joins up when each is passed on its own', () => {
    const perPerson = ['alex|braemar', 'sam|braemar'].flatMap((who) =>
      groupIntoRuns(interleaved.filter((s) => s.locationId === who)),
    )

    expect(perPerson).toHaveLength(2)
    expect(perPerson.map((r) => [r.startMin, r.endMin])).toEqual([
      [H(9), H(11)],
      [H(9), H(11)],
    ])
  })
})
