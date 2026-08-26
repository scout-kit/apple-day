import { describe, expect, it } from 'vitest'
import { findOrphanedRecords, parseAssignmentId } from '../src/domain/orphans'
import type { Assignment, Jar, Location, Person, Slot } from '../src/domain/types'

/**
 * Records whose references have gone.
 *
 * The warning about these was accurate and useless: it printed a document id and a phrase
 * like "unknown personId p-test" and offered nothing to do about it. The point of these
 * tests is that an issue now says what the record was for, whether it can be put right, and
 * why not when it cannot.
 */

const slots: Slot[] = [
  { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00 PM' },
  { id: 'fri-1800', day: 'fri', startMin: 18 * 60, endMin: 19 * 60, label: '6:00 PM' },
]

const location = (id: string, name: string): Location => ({
  id, name, address: '', mapsUrl: '', lat: null, lng: null, groupCode: '',
  siteContact: null, insurance: '', comments: '', openHours: {}, aliases: [],
})

const person = (id: string, first: string): Person => ({
  id, firstName: first, lastName: 'Dijkstra', section: 'cubs',
  parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
})

const known = {
  locations: [location('sobeys', 'Sobeys'), location('walmart', 'Walmart')],
  people: [person('p-edsger', 'Edsger')],
  slots,
}

const shift = (over: Partial<Assignment> & { id: string }): Assignment => ({
  slotId: 'fri-1700',
  locationId: 'sobeys',
  personId: 'p-edsger',
  status: 'planned',
  whereabouts: 'here',
  checkedInAt: null,
  checkedOutAt: null,
  ...over,
})

const jar = (over: Partial<Jar> & { id: string }): Jar => ({
  jarNumber: 1, day: 'fri', locationId: 'sobeys', personId: null, assignmentId: null, assignmentIds: [],
  status: 'counted', issuedAt: 1, issuedBy: 'o', amount: 40, method: 'cash',
  note: '', countedBy: 'o', countedAt: 2,
  ...over,
})

describe('parseAssignmentId', () => {
  it('splits a generated id back into its three parts', () => {
    expect(parseAssignmentId('fri-1700_sobeys-640-parkside-drive_p-alan-turing-cubs')).toEqual({
      slotId: 'fri-1700',
      locationId: 'sobeys-640-parkside-drive',
      personId: 'p-alan-turing-cubs',
    })
  })

  it('refuses an id that is not that shape', () => {
    // Dashes are everywhere in these slugs; underscores separate the three fields and
    // appear nowhere else, so anything with the wrong count is not a generated id.
    expect(parseAssignmentId('orphan-1')).toBeNull()
    expect(parseAssignmentId('fri-1700_sobeys')).toBeNull()
    expect(parseAssignmentId('a_b_c_d')).toBeNull()
    expect(parseAssignmentId('fri-1700__p-edsger')).toBeNull()
  })
})

describe('a healthy schedule raises nothing', () => {
  it('is quiet', () => {
    expect(findOrphanedRecords(known, [shift({ id: 'fri-1700_sobeys_p-edsger' })], [])).toEqual([])
  })

  it('says nothing about a jar with no youth against it', () => {
    // Money handed in at the table has no youth. That is ordinary, not a dangling
    // reference.
    expect(findOrphanedRecords(known, [], [jar({ id: 'j1', personId: null })])).toEqual([])
  })
})

describe('a shift whose youth has been deleted', () => {
  const orphan = shift({ id: 'fri-1700_sobeys_p-test', personId: 'p-test' })

  it('names what is wrong in words', () => {
    const [issue] = findOrphanedRecords(known, [orphan], [])
    expect(issue!.problem).toBe('Shift with no youth')
  })

  it('shows what survives beside what does not', () => {
    const [issue] = findOrphanedRecords(known, [orphan], [])
    const byLabel = new Map(issue!.references.map((r) => [r.label, r]))
    // The parts that are fine are named, so it is clear what is being decided about.
    expect(byLabel.get('Location')!.display).toBe('Sobeys')
    expect(byLabel.get('Location')!.exists).toBe(true)
    expect(byLabel.get('Shift')!.display).toBe('5:00 PM')
    expect(byLabel.get('Youth')!.exists).toBe(false)
  })

  it('cannot be repaired, and says why', () => {
    // The id names p-test, but p-test is exactly what is gone — restoring it would put the
    // record straight back where it is.
    const [issue] = findOrphanedRecords(known, [orphan], [])
    expect(issue!.repair).toBeNull()
    expect(issue!.blocked).toContain('p-test')
    expect(issue!.blocked).toContain('no longer exists')
  })
})

describe('a shift that lost its fields but kept its name', () => {
  // What a half-finished write leaves behind: a document holding a status and nothing else.
  const stripped = shift({
    id: 'fri-1700_sobeys_p-edsger',
    slotId: '',
    locationId: '',
    personId: '',
  })

  it('can be rebuilt from its own id', () => {
    const [issue] = findOrphanedRecords(known, [stripped], [])
    expect(issue!.repair).toEqual({
      slotId: 'fri-1700',
      locationId: 'sobeys',
      personId: 'p-edsger',
    })
    expect(issue!.blocked).toBeNull()
  })

  it('lists every missing field, not just the first', () => {
    const [issue] = findOrphanedRecords(known, [stripped], [])
    expect(issue!.problem).toBe('Shift with no shift, no location, no youth')
    expect(issue!.references.every((r) => !r.exists)).toBe(true)
    expect(issue!.references.every((r) => r.display === 'missing')).toBe(true)
  })

  it('is not repairable when its name points somewhere that is also gone', () => {
    const elsewhere = shift({ id: 'fri-1700_gone-away_p-edsger', locationId: '' })
    const [issue] = findOrphanedRecords(known, [elsewhere], [])
    expect(issue!.repair).toBeNull()
    expect(issue!.blocked).toContain('gone-away')
  })

  it('is not repairable when its id was never generated', () => {
    const handmade = shift({ id: 'orphan-1', personId: 'nobody' })
    const [issue] = findOrphanedRecords(known, [handmade], [])
    expect(issue!.repair).toBeNull()
    expect(issue!.blocked).toContain('nothing to rebuild it from')
  })
})

describe('a shift at a location dropped from this year', () => {
  it('is not an orphan, because the location still exists', () => {
    // The check is against the library. A location taken off this year's list is a choice,
    // not a broken reference, and reporting it would raise an alarm about an intact
    // schedule.
    const issues = findOrphanedRecords(
      known,
      [shift({ id: 'fri-1700_walmart_p-edsger', locationId: 'walmart' })],
      [],
    )
    expect(issues).toEqual([])
  })
})

describe('a jar pointing at nothing', () => {
  it('is reported for a location that has gone', () => {
    const [issue] = findOrphanedRecords(known, [], [jar({ id: 'j1', locationId: 'gone' })])
    expect(issue!.kind).toBe('jar')
    expect(issue!.problem).toContain('location')
  })

  it('is never repaired by guessing, because it holds money', () => {
    const [issue] = findOrphanedRecords(known, [], [jar({ id: 'j1', locationId: 'gone' })])
    expect(issue!.repair).toBeNull()
    expect(issue!.blocked).toContain('Move it to the right location')
  })

  it('is reported for a youth who has gone', () => {
    const [issue] = findOrphanedRecords(
      known,
      [],
      [jar({ id: 'j1', personId: 'p-test' })],
    )
    expect(issue!.problem).toContain('youth')
  })
})
