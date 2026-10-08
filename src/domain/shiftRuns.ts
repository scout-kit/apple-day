/**
 * Consecutive shifts at one location, treated as the single stretch of work they are.
 *
 * A youth doing 5–6 and 6–7 at the same shop does not come back to the table in between and
 * does not want checking in twice. On the board those are two rows, because that is how
 * hours are counted; at the table they are one person going out once.
 *
 * Grouping needs the times, not the slot ids: shifts are configured to overlap, so the next
 * one starts before the last ends and comparing ids would never see them as adjacent.
 */

import { formatSlotLabel } from './slots'
import type { AssignmentStatus, Whereabouts } from './types'

export interface RunnableShift {
  locationId: string
  /** Null when the shift's slot is unknown — a run of one, since it cannot be placed. */
  startMin: number | null
  endMin: number | null
}

export interface ShiftRun<T> {
  items: T[]
  locationId: string
  /** The whole stretch: the first start and the last end. */
  startMin: number | null
  endMin: number | null
}

/**
 * Group a person's shifts into runs.
 *
 * Two shifts continue each other when they share a location and the second starts no later
 * than the first ends — so an exact handover and a deliberate overlap both continue the
 * run, and a genuine gap does not. Input order does not matter; runs come back in time
 * order.
 */
export function groupIntoRuns<T extends RunnableShift>(shifts: T[]): ShiftRun<T>[] {
  const placed = shifts.filter((s) => s.startMin !== null && s.endMin !== null)
  const unplaced = shifts.filter((s) => s.startMin === null || s.endMin === null)

  const ordered = [...placed].sort((a, b) => a.startMin! - b.startMin!)
  const runs: ShiftRun<T>[] = []

  for (const shift of ordered) {
    const current = runs[runs.length - 1]
    const continues =
      current !== undefined &&
      current.locationId === shift.locationId &&
      current.endMin !== null &&
      shift.startMin! <= current.endMin

    if (continues) {
      current.items.push(shift)
      current.endMin = Math.max(current.endMin!, shift.endMin!)
    } else {
      runs.push({
        items: [shift],
        locationId: shift.locationId,
        startMin: shift.startMin,
        endMin: shift.endMin,
      })
    }
  }

  // A shift whose slot has gone cannot be placed in time, so it stands alone rather than
  // being folded into whichever run happens to be adjacent.
  for (const shift of unplaced) {
    runs.push({
      items: [shift],
      locationId: shift.locationId,
      startMin: null,
      endMin: null,
    })
  }

  return runs
}

/** Whether a run covers any part of a given window — used to decide what one hour shows. */
/**
 * A run as one line of time: "5:00 PM – 7:00 PM".
 *
 * Two shifts at one shop are one stretch of standing there, and reading them out as separate
 * lines makes a two-hour turn look like two jobs. The day-of table has always shown it this
 * way; a pass, a reminder and a location's page were still listing the hours one by one.
 *
 * Falls back to whatever the caller has when the times are not known — a shift whose slot
 * has been edited away still has to say something.
 */
export function runSpan(
  run: Pick<ShiftRun<RunnableShift>, 'startMin' | 'endMin'>,
  fallback: string,
): string {
  if (run.startMin === null || run.endMin === null) return fallback
  return formatSlotLabel(run.startMin, run.endMin)
}

export function runTouches(
  run: ShiftRun<unknown>,
  window: { startMin: number; endMin: number },
): boolean {
  if (run.startMin === null || run.endMin === null) return false
  return run.startMin < window.endMin && run.endMin > window.startMin
}

/*
 * ---------------------------------------------------------------------------
 * What a run's row can do.
 *
 * Here rather than in the day-of screen because it is a state machine, and deriving the
 * buttons one at a time from a handful of flags leaves combinations with no way out — a row
 * marked absent after its shift ended, or expected and out collecting at once.
 *
 * The rule that collapses it: whereabouts only means anything once somebody has arrived.
 * "Out collecting" is a fact about a person who is here. So a run has five states rather
 * than sixteen, and `runControls` is total over them.
 */

/** Where a run stands on the one question that has to be answered about everybody. */
export type Attendance = 'expected' | 'arrived' | 'absent'

/** And, once they have arrived, where they are. */
export type Place = 'atTable' | 'out' | 'back'

export interface RunState {
  attendance: Attendance
  place: Place
}

interface ShiftState {
  status: AssignmentStatus
  whereabouts: Whereabouts
}

/**
 * One state for a stretch of work, since a run is one thing to the person doing it.
 *
 * Whereabouts aggregates by "any" rather than "all": while any hour of the stretch still
 * has somebody out, the run is out.
 */
export function runState(shifts: ShiftState[]): RunState {
  if (shifts.length === 0) return { attendance: 'expected', place: 'atTable' }

  const attendance: Attendance = shifts.every((s) => s.status === 'noShow')
    ? 'absent'
    : shifts.some((s) => s.status === 'checkedIn')
      ? 'arrived'
      : 'expected'

  /*
    Nobody is out collecting who has not arrived. Read as well as written, so the rule holds
    for rows stored before it existed — "expected, out collecting" is a check-in that was
    taken back and a whereabouts nobody cleared, and it reads as expected.
  */
  if (attendance !== 'arrived') return { attendance, place: 'atTable' }

  const place: Place = shifts.some((s) => s.whereabouts === 'out')
    ? 'out'
    : shifts.some((s) => s.whereabouts === 'back')
      ? 'back'
      : 'atTable'

  return { attendance, place }
}

export interface RunControls {
  /** Check in, or — once they have — take that back. */
  checkIn: boolean
  /** Mark absent, or take that back. */
  noShow: boolean
  /** Hand them a jar. */
  issue: boolean
  /** Send them out without one, or bring them in. */
  out: boolean
  /** Mark them back at base, or send them out again. */
  back: boolean
  swap: boolean
}

/**
 * The buttons a row offers, given where it stands.
 *
 * Total over `RunState`, and every state offers at least one control that changes it.
 * `shiftRuns.test.ts` asserts that over the whole state space.
 */
export function runControls({ attendance, place }: RunState): RunControls {
  return {
    /*
      Attendance is one decision with two answers. Whichever was given stays on the row as
      the way to take it back, and the other disappears until it is.

      Not while they are out: nobody un-checks-in somebody standing at a shop, and the row
      already carries a one-press route home.
    */
    checkIn: attendance !== 'absent' && place !== 'out',
    noShow: attendance !== 'arrived',
    // A jar only goes to somebody who is at the table or already out with one.
    issue: attendance === 'arrived' && place !== 'back',
    out: attendance === 'arrived' && place !== 'back',
    back: attendance === 'arrived' && place !== 'atTable',
    // Nobody swaps a shift that is already out or finished.
    swap: place === 'atTable',
  }
}
