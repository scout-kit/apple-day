import { areaOf, sameArea } from './areas'
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
    Three cases, and an empty list is not one of them.

    Somebody who offered Friday hours and nothing on Saturday has an empty Saturday list.
    Reading that as "nothing stated, so nothing to contradict" loses the clearest case there
    is — a Friday-only volunteer put on a Saturday shift. It is the strongest signal on the
    board, not the weakest.

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

  /** Did they say they could work this hour? Nothing stated is not a yes. */
  const offeredSlot = (personId: string, slot: Slot): boolean =>
    (availabilityBySignup.get(personId)?.[slot.day] ?? []).includes(slot.id)

  for (const key of pairs.keys()) {
    const [firstId] = key.split('::') as [string, string]
    const partnerId = pairs.get(key)!
    if (!personById.has(firstId)) continue

    const shiftsOf = new Map<string, Assignment[]>()
    for (const id of [firstId, partnerId]) {
      shiftsOf.set(id, live.filter((x) => x.personId === id))
    }

    /*
      The hours either of them is out in, and only those.

      A pairing is a request about the hours they work: put them together. An hour neither
      of them is out in has nothing to put right, and an hour only one of them could ever
      have worked has nothing either — the usual reason the other is missing from a shift is
      that they never offered it, and asking an organizer to fix an hour somebody is not
      available for is asking for nothing. Reporting it anyway put a line against every
      shift the sibling who was free had been given, naming the one who was not, and there
      were enough of those to bury the warnings worth reading.
    */
    const slotIds = new Set(
      [...shiftsOf.get(firstId)!, ...shiftsOf.get(partnerId)!].map((x) => x.slotId),
    )

    for (const slotId of slotIds) {
      const slot = slotById.get(slotId)
      const when = slot?.label ?? slotId

      /*
        Read from whichever of them is out, so the warning is about a shift on the board.

        The lower id first when they both are, which keeps one split to one warning rather
        than one from each end. When only one of them is out, that one is the subject and
        the question is whether the other could have been beside them.
      */
      const [subjectId, otherId] = shiftsOf.get(firstId)!.some((x) => x.slotId === slotId)
        ? [firstId, partnerId]
        : [partnerId, firstId]

      const mine = shiftsOf.get(subjectId)!.filter((x) => x.slotId === slotId)
      const theirs = shiftsOf.get(otherId)!.filter((x) => x.slotId === slotId)

      /*
        Together, not identical.

        Two siblings asked to stay together do not have to be at the same door. A plaza with
        a grocer at one end and a chemist at the other is one place to the parent dropping
        them off, and putting them at both ends covers twice the footfall — which is the
        point of sending two. So a shared area counts, and the warning is for a pair actually
        split across the town.
      */
      if (theirs.some((x) => mine.some((y) => sameArea(x.locationId, y.locationId, locationById)))) {
        continue
      }

      /*
        Not out this hour, and free to have been: a pairing waiting to be honoured.

        Said in the data rather than guessed from the board — they put their name against
        this hour and have been left off it, which is something an organizer can act on by
        giving them the shift beside their sibling. Somebody who never offered the hour is
        the case above, and stays quiet.
      */
      const freeToJoin = theirs.length === 0 && slot !== undefined && offeredSlot(otherId, slot)
      if (theirs.length === 0 && !freeToJoin) continue

      const here = mine[0]!
      const area = areaOf(locationById.get(here.locationId))
      // Named by the area when there is one: "not at Linden Plaza" is the thing to fix,
      // and it says that any shop in it will do.
      const where = area ? `at ${area}` : `at ${placeOf(here.locationId)}`

      issues.push({
        code: 'splitPair',
        severity: 'warning',
        message: freeToJoin
          ? `${nameOf(subjectId)} is paired with ${nameOf(otherId)}, who is free during ${when} and has no shift ${where}`
          : `${nameOf(subjectId)} is paired with ${nameOf(otherId)}, who is not ${where} during ${when}`,
        assignmentIds: mine.map((x) => x.id),
        personIds: [subjectId, otherId],
        locationIds: [here.locationId],
      })
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
