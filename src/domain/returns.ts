import { runState } from './shiftRuns'
import { formatTime } from './slots'
import type { AssignmentStatus, Whereabouts } from './types'

/**
 * How many people are due back at base, and when.
 *
 * Asked by whoever is cooking. Food has to be hot when a stretch ends and cold food for
 * fifteen is as wrong as hot food for three, so the question is not "how many are out" but
 * "how many walk through the door at half six".
 *
 * Counted from where people actually are rather than from the schedule, which is the whole
 * point: a roster says forty are due back at seven, and the eight who never turned up are
 * eight meals in the bin. Somebody enters the count when they check in and leaves it when
 * they come back, so it falls as the evening goes and is never a promise about somebody who
 * is not here.
 *
 * By the end of the *stretch*, not of each shift. Two hours at one shop is one trip and one
 * return, and counting the person at both ends feeds them twice.
 */

export interface ReturnBucket {
  /** Minutes from midnight — when this group is due in. */
  endMin: number
  /** "6:30 PM". */
  label: string
  /** How many people, not how many shifts. */
  people: number
}

interface CountableRun<T> {
  endMin: number | null
  shifts: T[]
}

type Placeable = { status: AssignmentStatus; whereabouts: Whereabouts }

/**
 * The runs still owed a return, bucketed by when they end.
 *
 * Everybody who has arrived and is not yet back: out at a shop, or at the table between
 * jobs. Both are at base when their stretch ends, and both eat.
 *
 * A no-show is not coming, somebody already back has been, and anybody who has not checked
 * in has not promised anything yet — none of the three is counted.
 */
export function expectedReturns<T extends Placeable>(
  runs: CountableRun<T>[],
): ReturnBucket[] {
  const byEnd = new Map<number, number>()

  for (const run of runs) {
    if (run.endMin === null) continue
    const state = runState(run.shifts)
    if (state.attendance !== 'arrived' || state.place === 'back') continue
    byEnd.set(run.endMin, (byEnd.get(run.endMin) ?? 0) + 1)
  }

  return [...byEnd.entries()]
    .map(([endMin, people]) => ({ endMin, label: formatTime(endMin), people }))
    .sort((a, b) => a.endMin - b.endMin)
}

/** Everybody still to come back, across every hour. */
export function totalExpected(buckets: ReturnBucket[]): number {
  return buckets.reduce((sum, b) => sum + b.people, 0)
}
