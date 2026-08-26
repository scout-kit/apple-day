import { describe, expect, it } from 'vitest'
import { runControls, runState } from '../src/domain/shiftRuns'
import type { Attendance, Place, RunState } from '../src/domain/shiftRuns'
import { ATTENDANCE_VALUES, WHEREABOUTS_VALUES } from '../src/domain/types'
import type { AssignmentStatus, Whereabouts } from '../src/domain/types'

/**
 * What a row at the table can do, in every state it can be in.
 *
 * Written after the third dead end, not the first. Each one was a different combination of
 * flags that left a row with nothing on it that could change the row — and each one was
 * fixed by adding a term to the guard that had hidden the button, which is how there came
 * to be a third.
 *
 * So the test is over the whole state space rather than over remembered cases.
 */

const STATES: RunState[] = (['expected', 'arrived', 'absent'] as Attendance[]).flatMap((a) =>
  (['atTable', 'out', 'back'] as Place[]).map((place) => ({ attendance: a, place })),
)

/** The states a run can actually be in — whereabouts means nothing until somebody arrives. */
const REAL = STATES.filter((s) => s.attendance === 'arrived' || s.place === 'atTable')

const shift = (status: AssignmentStatus, whereabouts: Whereabouts) => ({ status, whereabouts })

describe('reading a run into one state', () => {
  it('has no opinion about where somebody is until they have arrived', () => {
    /*
      The reported state: expected, and out collecting. It is not a state — it is a check-in
      that was taken back and a whereabouts nobody cleared. Stored rows still say it, so it
      is read back as what it means rather than rendered as what it says.
    */
    expect(runState([shift('confirmed', 'out')])).toEqual({
      attendance: 'expected',
      place: 'atTable',
    })
    expect(runState([shift('noShow', 'back')])).toEqual({
      attendance: 'absent',
      place: 'atTable',
    })
  })

  it('is out while any hour of the stretch still has somebody out', () => {
    // Nobody is at the table, so the run is out — even though one shift says otherwise.
    const state = runState([shift('checkedIn', 'back'), shift('checkedIn', 'out')])
    expect(state).toEqual({ attendance: 'arrived', place: 'out' })
  })

  it('is absent only when every shift in the stretch is', () => {
    expect(runState([shift('noShow', 'here'), shift('confirmed', 'here')]).attendance).toBe(
      'expected',
    )
    expect(runState([shift('noShow', 'here'), shift('noShow', 'here')]).attendance).toBe('absent')
  })

  it('never reads a stored pair as a state that has no way out of it', () => {
    // Every combination that could be sitting in Firestore, including the ones written
    // before whereabouts was tied to arrival.
    for (const status of ATTENDANCE_VALUES) {
      for (const whereabouts of WHEREABOUTS_VALUES) {
        const state = runState([shift(status, whereabouts)])
        expect(REAL).toContainEqual(state)
      }
    }
  })
})

describe('the controls on a run', () => {
  it('always offers something that changes the row', () => {
    for (const state of STATES) {
      const c = runControls(state)
      const changesTheRow = c.checkIn || c.noShow || c.out || c.back
      expect({ ...state, changesTheRow }).toEqual({ ...state, changesTheRow: true })
    }
  })

  it('can get from any state to any other', () => {
    /*
      The property the eight booleans never had. "At least one button" is not enough — a row
      that can only be sent out and brought back, forever, satisfies that and is exactly the
      trap that was reported. What matters is that every state is reachable from every other.
    */
    const key = (s: RunState): string => `${s.attendance}/${s.place}`

    /** Where each button leaves the row. Leaving `arrived` takes the whereabouts with it. */
    const moves = (s: RunState): RunState[] => {
      const c = runControls(s)
      const next: RunState[] = []
      if (c.checkIn)
        next.push({
          attendance: s.attendance === 'arrived' ? 'expected' : 'arrived',
          place: 'atTable',
        })
      if (c.noShow)
        next.push({
          attendance: s.attendance === 'absent' ? 'expected' : 'absent',
          place: 'atTable',
        })
      if (c.out && s.attendance === 'arrived')
        next.push({ ...s, place: s.place === 'out' ? 'atTable' : 'out' })
      if (c.back && s.attendance === 'arrived')
        next.push({ ...s, place: s.place === 'back' ? 'out' : 'back' })
      return next
    }

    for (const from of REAL) {
      const seen = new Set([key(from)])
      const queue = [from]
      while (queue.length > 0) {
        for (const to of moves(queue.shift()!)) {
          if (seen.has(key(to))) continue
          seen.add(key(to))
          queue.push(to)
        }
      }
      expect({ from: key(from), reached: seen.size }).toEqual({
        from: key(from),
        reached: REAL.length,
      })
    }
  })

  it('offers both answers to somebody who is expected, and neither twice', () => {
    const c = runControls({ attendance: 'expected', place: 'atTable' })
    expect(c.checkIn && c.noShow).toBe(true)
    expect(c.issue || c.out || c.back).toBe(false)
  })

  it('keeps the undo on whichever answer was given', () => {
    expect(runControls({ attendance: 'arrived', place: 'atTable' }).checkIn).toBe(true)
    expect(runControls({ attendance: 'arrived', place: 'atTable' }).noShow).toBe(false)
    expect(runControls({ attendance: 'absent', place: 'atTable' }).noShow).toBe(true)
    expect(runControls({ attendance: 'absent', place: 'atTable' }).checkIn).toBe(false)
  })

  it('takes a check-in back on a shift that has already finished', () => {
    // The first dead end: `done` hid everything but "Back".
    const c = runControls({ attendance: 'arrived', place: 'back' })
    expect(c.checkIn).toBe(true)
    expect(c.back).toBe(true)
  })

  it('does not un-check-in somebody standing at a location', () => {
    // Held from the old logic, and safe to hold: "Out" brings them in in one press, and
    // the reachability test above proves nothing is stranded by it.
    const c = runControls({ attendance: 'arrived', place: 'out' })
    expect(c.checkIn).toBe(false)
    expect(c.out).toBe(true)
    expect(c.back).toBe(true)
  })

  it('does not swap a shift that is out or finished', () => {
    expect(runControls({ attendance: 'arrived', place: 'out' }).swap).toBe(false)
    expect(runControls({ attendance: 'arrived', place: 'back' }).swap).toBe(false)
    expect(runControls({ attendance: 'expected', place: 'atTable' }).swap).toBe(true)
  })
})
