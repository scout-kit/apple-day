import { DAY_LABEL } from './slots'
import { DAYS, fullName } from './types'
import type { Assignment, Person, ScheduledLocation, Signup, Slot } from './types'

/**
 * Live validation for the schedule board.
 *
 * Every check here corresponds to something that had to be caught by eye in the
 * spreadsheet, or wasn't caught at all. Warnings never block an organizer — they
 * override deliberately all the time (a parent who says "put me anywhere", a location
 * that agreed to an early start). The rule is: surface it, don't prevent it.
 *
 * Three things are deliberately not reported, all at the organizers' request, and all for
 * the same reason: the point of this list is what you *cannot* see. An empty location is an
 * empty cell on the board. A young member alone at a location is normal here. And a shift at
 * a closed hour is already hatched on the board, which withholds its picker until somebody
 * deliberately overrides it — so saying it again adds nothing.
 */

export type IssueSeverity = 'error' | 'warning' | 'info'

export type IssueCode =
  | 'doubleBooked'
  | 'outsideAvailability'
  | 'splitPair'
  | 'noShifts'
  | 'unknownReference'

export interface ScheduleIssue {
  code: IssueCode
  severity: IssueSeverity
  message: string
  /** Ids the board should highlight when this issue is selected. */
  assignmentIds: string[]
  personIds: string[]
  locationIds: string[]
}

export interface ValidateInput {
  locations: ScheduledLocation[]
  people: Person[]
  signups: Signup[]
  assignments: Assignment[]
  slots: Slot[]
}

export function validateSchedule(input: ValidateInput): ScheduleIssue[] {
  const { locations, people, signups, assignments, slots } = input

  const issues: ScheduleIssue[] = []
  const slotById = new Map(slots.map((s) => [s.id, s]))
  const personById = new Map(people.map((p) => [p.id, p]))
  const locationById = new Map(locations.map((l) => [l.id, l]))
  const availabilityBySignup = new Map(signups.map((s) => [s.personId, s.availability]))

  const live = assignments.filter((a) => a.status !== 'swapped')

  const nameOf = (id: string): string => {
    const p = personById.get(id)
    return p ? fullName(p) : `(unknown person ${id})`
  }
  const placeOf = (id: string): string => locationById.get(id)?.name ?? `(unknown location ${id})`

  // ---- one person, two places, same hour -----------------------------------
  const bySlotAndPerson = new Map<string, Assignment[]>()
  for (const a of live) {
    const key = `${a.slotId}::${a.personId}`
    const list = bySlotAndPerson.get(key)
    if (list) list.push(a)
    else bySlotAndPerson.set(key, [a])
  }
  for (const [key, group] of bySlotAndPerson) {
    if (group.length < 2) continue
    const [slotId] = key.split('::')
    const slot = slotById.get(slotId!)
    const places = [...new Set(group.map((a) => placeOf(a.locationId)))]
    // Two rows for the same person, slot AND location is a duplicate, not a conflict.
    const severity: IssueSeverity = places.length > 1 ? 'error' : 'warning'
    issues.push({
      code: 'doubleBooked',
      severity,
      message:
        places.length > 1
          ? `${nameOf(group[0]!.personId)} is booked at ${places.length} locations during ${slot?.label ?? slotId} — ${places.join(' and ')}`
          : `${nameOf(group[0]!.personId)} is listed twice at ${places[0]} during ${slot?.label ?? slotId}`,
      assignmentIds: group.map((a) => a.id),
      personIds: [group[0]!.personId],
      locationIds: [...new Set(group.map((a) => a.locationId))],
    })
  }

  // ---- scheduled outside what they said they could do ----------------------
  /*
    Three cases, and two of them used to fall through in silence.

    Somebody who offered Friday hours and nothing on Saturday has an empty Saturday list,
    and the check read that as "nothing stated, so nothing to contradict" — so the clearest
    case there is, a Friday-only volunteer put on a Saturday shift, produced no warning at
    all. It is the strongest signal on the board, not the weakest.

    Somebody with no signup at all — added by hand, a walk-in, the 2025 archive, which has
    no signups whatsoever — is still skipped, and deliberately. They never stated anything
    to contradict, and reporting it puts a line on the board for every shift in an imported
    year. That was tried and it buried the warnings that matter.
  */
  for (const a of live) {
    const slot = slotById.get(a.slotId)
    if (!slot) continue

    const availability = availabilityBySignup.get(a.personId)
    if (!availability) continue

    const stated = availability[slot.day] ?? []
    if (stated.includes(slot.id)) continue

    const offeredThatDay = stated.length > 0
    const offeredAtAll = DAYS.some((d) => (availability[d] ?? []).length > 0)

    issues.push({
      code: 'outsideAvailability',
      severity: 'warning',
      message: offeredThatDay
        ? `${nameOf(a.personId)} did not sign up for ${slot.label} on ${DAY_LABEL[slot.day]}`
        : offeredAtAll
          ? `${nameOf(a.personId)} did not offer any ${DAY_LABEL[slot.day]} hours at all`
          : `${nameOf(a.personId)} signed up without offering any hours`,
      assignmentIds: [a.id],
      personIds: [a.personId],
      locationIds: [a.locationId],
    })
  }

  // ---- siblings and buddies split up --------------------------------------
  // Encoded as `(w/ Boyan please)` inside the name field in past years; now a real
  // reference, so it can actually be checked.
  //
  // Treated as undirected: a pairing recorded on only one person is still a pairing. An
  // earlier version reported each pair from the lower id and skipped the higher one, which
  // meant a one-sided pairing was checked or ignored purely according to how the two ids
  // happened to sort.
  const pairs = new Map<string, string>()
  for (const person of people) {
    const partnerId = person.pairWithPersonId
    if (!partnerId || partnerId === person.id) continue
    const [first, second] = [person.id, partnerId].sort() as [string, string]
    pairs.set(`${first}::${second}`, second)
  }

  for (const key of pairs.keys()) {
    const [firstId] = key.split('::') as [string, string]
    const person = personById.get(firstId)
    const partnerId = pairs.get(key)!
    if (!person) continue

    for (const a of live.filter((x) => x.personId === person.id)) {
      const slot = slotById.get(a.slotId)
      const partnerHere = live.some(
        (x) => x.personId === partnerId && x.slotId === a.slotId && x.locationId === a.locationId,
      )
      if (!partnerHere) {
        issues.push({
          code: 'splitPair',
          severity: 'warning',
          message: `${nameOf(person.id)} is paired with ${nameOf(partnerId)}, who is not at ${placeOf(a.locationId)} during ${slot?.label ?? a.slotId}`,
          assignmentIds: [a.id],
          personIds: [person.id, partnerId],
          locationIds: [a.locationId],
        })
      }
    }
  }

  // ---- signed up, never scheduled -----------------------------------------
  const assignedPeople = new Set(live.map((a) => a.personId))
  for (const signup of signups) {
    const offered = (signup.availability.fri?.length ?? 0) + (signup.availability.sat?.length ?? 0)
    if (offered > 0 && !assignedPeople.has(signup.personId)) {
      issues.push({
        code: 'noShifts',
        severity: 'warning',
        message: `${nameOf(signup.personId)} offered ${offered} slot${offered === 1 ? '' : 's'} and has no shift`,
        assignmentIds: [],
        personIds: [signup.personId],
        locationIds: [],
      })
    }
  }

  // ---- dangling references ------------------------------------------------
  for (const a of live) {
    const missing: string[] = []
    if (!slotById.has(a.slotId)) missing.push(`slot ${a.slotId}`)
    if (!locationById.has(a.locationId)) missing.push(`location ${a.locationId}`)
    if (!personById.has(a.personId)) missing.push(`person ${a.personId}`)
    if (missing.length > 0) {
      issues.push({
        code: 'unknownReference',
        severity: 'error',
        message: `Assignment ${a.id} points at ${missing.join(', ')}, which no longer exists`,
        assignmentIds: [a.id],
        personIds: [],
        locationIds: [],
      })
    }
  }

  const order: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 }
  return issues.sort((a, b) => order[a.severity] - order[b.severity])
}

export function summariseIssues(issues: ScheduleIssue[]): Record<IssueSeverity, number> {
  return issues.reduce(
    (acc, i) => ({ ...acc, [i.severity]: acc[i.severity] + 1 }),
    { error: 0, warning: 0, info: 0 } as Record<IssueSeverity, number>,
  )
}
