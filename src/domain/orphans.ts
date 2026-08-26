import type { Assignment, Jar, Person, Location, Slot } from './types'

/**
 * Records whose references have gone.
 *
 * Deleting a youth removes the person, not the shifts they were on, so a schedule can end
 * up holding rows that point at nobody. The money screen has always *counted* these — the
 * warning is real — but it printed raw document ids and offered nothing to do about them,
 * which is not a report, it is a riddle.
 *
 * So each issue carries what the record claims to point at, whether each of those things
 * still exists, and whether the record can be put right. Shift ids are built as
 * `slotId_locationId_personId`, which means a shift that lost its fields can often be
 * rebuilt from its own name — but only when everything the name mentions is still there.
 */

export type OrphanKind = 'assignment' | 'jar'

export interface OrphanReference {
  /** "Shift", "Location", "Youth" — what this reference is. */
  label: string
  /** What the record points at. Empty when the field is missing entirely. */
  value: string
  /** How to show it to somebody who does not think in ids. */
  display: string
  exists: boolean
}

/** Fields that would put a shift right, recovered from its own document id. */
export interface OrphanRepair {
  slotId: string
  locationId: string
  personId: string
}

export interface OrphanIssue {
  kind: OrphanKind
  id: string
  /** One sentence naming what is wrong. */
  problem: string
  references: OrphanReference[]
  /** Set when the record can be rebuilt from its id. */
  repair: OrphanRepair | null
  /** Set when it cannot, saying which reference is beyond recovery. */
  blocked: string | null
}

/**
 * Split a shift id back into the three things it was built from.
 *
 * `fri-1700_sobeys-640-parkside-drive_p-alan-turing-cubs`. Slugs use dashes and never
 * underscores, so the three parts are unambiguous — but an id that was supplied by hand
 * rather than generated may not follow the shape at all, hence the null.
 */
export function parseAssignmentId(id: string): OrphanRepair | null {
  const parts = id.split('_')
  if (parts.length !== 3) return null
  const [slotId, locationId, personId] = parts
  if (!slotId || !locationId || !personId) return null
  return { slotId, locationId, personId }
}

export interface KnownThings {
  locations: Location[]
  people: Person[]
  slots: Slot[]
}

/**
 * Find every record whose references no longer resolve.
 *
 * Locations are checked against the whole library, not against the locations this year
 * staffs. A location dropped from this year's list still exists, and calling that "no
 * longer exists" would raise an alarm about a schedule that is perfectly intact.
 */
export function findOrphanedRecords(
  known: KnownThings,
  assignments: Assignment[],
  jars: Jar[],
): OrphanIssue[] {
  const locationName = new Map(known.locations.map((l) => [l.id, l.name]))
  const personName = new Map(
    known.people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim() || p.id]),
  )
  const slotLabel = new Map(known.slots.map((s) => [s.id, s.label]))

  const describe = (
    label: string,
    value: string | null,
    names: Map<string, string>,
  ): OrphanReference => {
    const id = value ?? ''
    const known = id !== '' && names.has(id)
    return {
      label,
      value: id,
      display: known ? names.get(id)! : id === '' ? 'missing' : id,
      exists: known,
    }
  }

  const issues: OrphanIssue[] = []

  for (const a of assignments) {
    const refs = [
      describe('Shift', a.slotId, slotLabel),
      describe('Location', a.locationId, locationName),
      describe('Youth', a.personId, personName),
    ]
    const broken = refs.filter((r) => !r.exists)
    if (broken.length === 0) continue

    const fromId = parseAssignmentId(a.id)
    // Only a repair if the id names things that are all still there. Restoring a reference
    // to something else that is missing just moves the problem.
    const recoverable =
      fromId !== null &&
      slotLabel.has(fromId.slotId) &&
      locationName.has(fromId.locationId) &&
      personName.has(fromId.personId)

    issues.push({
      kind: 'assignment',
      id: a.id,
      problem: `Shift with no ${broken.map((r) => r.label.toLowerCase()).join(', no ')}`,
      references: refs,
      repair: recoverable ? fromId : null,
      blocked: recoverable
        ? null
        : fromId === null
          ? 'Its name does not say what it was for, so there is nothing to rebuild it from.'
          : gone(fromId, slotLabel, locationName, personName),
    })
  }

  for (const jar of jars) {
    const refs = [describe('Location', jar.locationId, locationName)]
    // A jar with no youth is ordinary — money handed in at the table. Only a *named* youth
    // who has since gone is a problem.
    if (jar.personId) refs.push(describe('Youth', jar.personId, personName))
    const broken = refs.filter((r) => !r.exists)
    if (broken.length === 0) continue

    issues.push({
      kind: 'jar',
      id: jar.id,
      problem: `Jar pointing at a ${broken.map((r) => r.label.toLowerCase()).join(' and a ')} that is gone`,
      references: refs,
      // Jar ids carry the day and the jar number, never the location or the youth, so
      // there is nothing in the name to rebuild from.
      repair: null,
      blocked:
        'A jar holds money, so nothing here is guessed. Move it to the right location, or ' +
        'delete it if it was never real.',
    })
  }

  return issues
}

/** Which of the things a shift id names has gone. */
function gone(
  parsed: OrphanRepair,
  slots: Map<string, string>,
  locations: Map<string, string>,
  people: Map<string, string>,
): string {
  const missing: string[] = []
  if (!slots.has(parsed.slotId)) missing.push(`the shift ${parsed.slotId}`)
  if (!locations.has(parsed.locationId)) missing.push(`the location ${parsed.locationId}`)
  if (!people.has(parsed.personId)) missing.push(`the youth ${parsed.personId}`)
  return `Its name says it was for ${missing.join(' and ')}, which no longer exists.`
}
