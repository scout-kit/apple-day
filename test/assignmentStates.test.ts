import { describe, expect, it } from 'vitest'
import { readAssignment } from '../src/domain/assignments'
import { readJar } from '../src/domain/jars'
import { ATTENDANCE_VALUES, WHEREABOUTS_VALUES, wasWorked } from '../src/domain/types'

/**
 * Reading a shift back out of Firestore.
 *
 * This is the test that was missing when a jar could be issued and the person stayed on
 * the board as "to come": the converter's list of permitted statuses had drifted from the
 * type, so a correct write came back wrong. Every value of both enums is asserted to
 * survive the round trip, driven off the same arrays the types are derived from — so a new
 * state cannot be added without this test covering it.
 */

const stored = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  slotId: 'fri-1700',
  locationId: 'braemar',
  personId: 'p-one',
  status: 'checkedIn',
  whereabouts: 'here',
  checkedInAt: 1,
  checkedOutAt: 0,
  ...over,
})

describe('every state survives the round trip', () => {
  it.each(ATTENDANCE_VALUES)('keeps attendance %s', (status) => {
    expect(readAssignment('a1', stored({ status })).status).toBe(status)
  })

  it.each(WHEREABOUTS_VALUES)('keeps whereabouts %s', (whereabouts) => {
    expect(readAssignment('a1', stored({ whereabouts })).whereabouts).toBe(whereabouts)
  })

  it('keeps the two independent of each other', () => {
    // Two facts, so both can be true at once: turned up *and* out collecting.
    const a = readAssignment('a1', stored({ status: 'checkedIn', whereabouts: 'out' }))
    expect(a.status).toBe('checkedIn')
    expect(a.whereabouts).toBe('out')
  })
})

describe('defaults for what is not there', () => {
  it('starts a shift at base', () => {
    expect(readAssignment('a1', stored({ whereabouts: undefined })).whereabouts).toBe('here')
  })

  it('falls back to planned for an unrecognised attendance', () => {
    expect(readAssignment('a1', stored({ status: 'sitting-down' })).status).toBe('planned')
  })

  it('falls back to here for an unrecognised whereabouts', () => {
    expect(readAssignment('a1', stored({ whereabouts: 'lost' })).whereabouts).toBe('here')
  })

  it('reads a missing timestamp as null rather than zero', () => {
    const a = readAssignment('a1', { slotId: 'fri-1700' })
    expect(a.checkedInAt).toBeNull()
    expect(a.checkedOutAt).toBeNull()
  })
})

describe('documents written before the two states were split', () => {
  it('reads a legacy out as checked in and out collecting', () => {
    // No `whereabouts` field at all and `status: 'out'` — a shape that is really sitting in
    // the database, and must not read back as `planned`.
    const a = readAssignment('a1', {
      slotId: 'fri-1700',
      locationId: 'braemar',
      personId: 'p-one',
      status: 'out',
      checkedInAt: 5,
    })
    expect(a.status).toBe('checkedIn')
    expect(a.whereabouts).toBe('out')
    expect(a.checkedInAt).toBe(5)
  })

  it('reads a legacy returned as checked in and back', () => {
    const a = readAssignment('a1', { status: 'returned' })
    expect(a.status).toBe('checkedIn')
    expect(a.whereabouts).toBe('back')
  })

  it('prefers a stored whereabouts over the legacy reading', () => {
    // A document touched by both versions: the new field wins.
    const a = readAssignment('a1', { status: 'out', whereabouts: 'back' })
    expect(a.whereabouts).toBe('back')
  })
})

describe('wasWorked', () => {
  it('counts somebody checked in at base', () => {
    expect(wasWorked({ status: 'checkedIn', whereabouts: 'here' })).toBe(true)
  })

  it('counts somebody out, even if nobody checked them in by hand', () => {
    expect(wasWorked({ status: 'confirmed', whereabouts: 'out' })).toBe(true)
  })

  it('counts somebody back', () => {
    expect(wasWorked({ status: 'confirmed', whereabouts: 'back' })).toBe(true)
  })

  it('does not count somebody who never turned up', () => {
    expect(wasWorked({ status: 'noShow', whereabouts: 'here' })).toBe(false)
    expect(wasWorked({ status: 'planned', whereabouts: 'here' })).toBe(false)
  })
})

describe('a jar written before it could span a stretch', () => {
  it('reads as a stretch of one, so nothing needs migrating', () => {
    // Every jar in the database predates `assignmentIds`. Reading the single shift it does
    // carry as a one-shift stretch keeps the by-hour split working on last year's data.
    expect(readJar('fri-jar-1-abc', { assignmentId: 'a1' }).assignmentIds).toEqual(['a1'])
  })

  it('reads money recorded against no shift as belonging to no hour', () => {
    expect(readJar('fri-extra-1', {}).assignmentIds).toEqual([])
  })

  it('keeps a recorded stretch as it was recorded', () => {
    expect(
      readJar('fri-jar-1-abc', { assignmentId: 'a1', assignmentIds: ['a1', 'a2'] })
        .assignmentIds,
    ).toEqual(['a1', 'a2'])
  })

  it('discards anything in the list that is not an id', () => {
    expect(
      readJar('fri-jar-1-abc', { assignmentIds: ['a1', 7, null, 'a2'] }).assignmentIds,
    ).toEqual(['a1', 'a2'])
  })
})
