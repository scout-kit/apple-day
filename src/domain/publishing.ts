import { customAlphabet } from 'nanoid'
import { mapLink } from './maps'
import type { SupportContact } from './support'
import { DAY_LABEL } from './slots'
import { fullName } from './types'
import type { Assignment, Person, ScheduledLocation, Slot } from './types'

/**
 * What a volunteer is handed.
 *
 * These are pure functions and they live in the domain layer on purpose: a pass is the only
 * document reachable without an account, so what goes onto one has to be testable without
 * standing up Firebase. A bug here is a privacy incident rather than a display glitch.
 *
 * Nothing here is served to somebody holding no link: a pass reaches exactly one person's
 * own shifts, and there is no public listing to redact.
 *
 * The Firestore writes that consume these live in `src/lib/publish.ts`.
 */

/** One shift on a volunteer's pass, denormalized so their page costs a single read. */
export interface PassShift {
  /** Which slot this is, so a volunteer can say *which* shift they cannot make. */
  slotId: string
  day: string
  slotLabel: string
  locationName: string
  address: string
  mapsUrl: string
  comments: string
}

export interface PublishedPass {
  token: string
  personId: string
  displayName: string
  shiftCount: number
}

/** Where volunteers report, denormalized so a pass needs no second lookup. */
export interface BaseOfOperations {
  name: string
  address: string
  mapsUrl: string
}

export interface PublishInput {
  locations: ScheduledLocation[]
  people: Person[]
  assignments: Assignment[]
  slots: Slot[]
  /** Who a volunteer can reach on the day. Copied onto every pass. */
  support: SupportContact[]
  /** Anything else they should be told, in the organizers' own words. */
  supportNote: string
  /** What to tell them when they reach base. */
  arrivalNote: string
  base?: BaseOfOperations | null
  /** Reuse existing tokens so already-distributed links keep working. */
  existingTokens?: Map<string, string>
}

/**
 * 22 characters from a 58-character alphabet ≈ 129 bits. This id is the credential for a
 * pass, so it has to be unguessable; the alphabet omits look-alike characters because
 * these get printed on paper and read by humans.
 */
const makeToken = customAlphabet(
  '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz',
  22,
)

export const generateToken = (): string => makeToken()

/** One person's own shifts, denormalized so their page costs a single read. */
export function buildPassShifts(
  personId: string,
  input: Pick<PublishInput, 'locations' | 'assignments' | 'slots'>,
): PassShift[] {
  const locationById = new Map(input.locations.map((l) => [l.id, l]))
  const slotById = new Map(input.slots.map((s) => [s.id, s]))
  const slotOrder = new Map(input.slots.map((s, i) => [s.id, i]))

  return input.assignments
    .filter((a) => a.personId === personId && a.status !== 'swapped')
    .sort((a, b) => (slotOrder.get(a.slotId) ?? 0) - (slotOrder.get(b.slotId) ?? 0))
    .flatMap((a) => {
      const slot = slotById.get(a.slotId)
      const location = locationById.get(a.locationId)
      if (!slot || !location) return []
      return [{
        slotId: slot.id,
        day: DAY_LABEL[slot.day],
        slotLabel: slot.label,
        locationName: location.name,
        address: location.address,
        mapsUrl: mapLink(location),
        comments: location.comments,
      }]
    })
}

/** Rows for the mail-merge CSV that replaces server-side sending. */
/*
  No caller in the app at the moment.

  The button that downloaded this was removed on request. The function is kept, with its
  tests: it is the only thing that turns passes into something a mailing tool can send, and
  on the free plan there is no other route from here to a parent's inbox. Rebuilding it
  later should be a button, not a rewrite.
*/
export function buildMailMergeRows(
  passes: PublishedPass[],
  people: Person[],
  baseUrl: string,
  input: Pick<PublishInput, 'locations' | 'assignments' | 'slots'>,
): Record<string, string>[] {
  const personById = new Map(people.map((p) => [p.id, p]))

  return passes.map((pass) => {
    const person = personById.get(pass.personId)
    const shifts = buildPassShifts(pass.personId, input)
    return {
      'Parent Name': person?.parentName ?? '',
      'Parent Email': person?.parentEmail ?? '',
      'Parent Phone': person?.parentPhone ?? '',
      'Youth Name': pass.displayName,
      Section: person?.section ?? '',
      Shifts: shifts
        .map((s) => `${s.day} ${s.slotLabel} — ${s.locationName}`)
        .join(' | '),
      'Schedule Link': `${baseUrl}/p/${pass.token}`,
    }
  })
}

/**
 * A fingerprint of everything a publish would put in front of a volunteer.
 *
 * The problem it solves: a schedule is published, somebody then fills a gap or swaps two
 * people, and the links already in parents' inboxes quietly stop matching the board.
 * Nothing said so.
 *
 * A timestamp would not do. Assignments are written all day Saturday — check-ins,
 * whereabouts, jars — and none of that changes what a pass says. Comparing "last edited"
 * against "last published" would put a re-publish notice on the screen for the whole
 * event and teach everyone to ignore it. This hashes the published *content* instead, so
 * it moves when, and only when, somebody would read something different.
 *
 * Deliberately not included: tokens, which are reused across publishes and would otherwise
 * make a fresh publish look like a change; and `publishedAt`, for the same reason.
 */
export function publishedFingerprint(input: PublishInput): string {
  const people = new Map(input.people.map((p) => [p.id, p]))

  const passes = [
    ...new Set(
      input.assignments.filter((a) => a.status !== 'swapped').map((a) => a.personId),
    ),
  ]
    .filter((id) => people.has(id))
    .sort()
    .map((id) => ({
      id,
      // On the pass itself, so a corrected surname is a change worth republishing for.
      name: fullName(people.get(id)!),
      shifts: buildPassShifts(id, input),
    }))

  /*
    Passes and what is printed on them, and nothing else.

    A pass is the only thing a volunteer ever reads, so it is the only thing worth noticing a
    change in. The event's link names the event inside the app and reaches nobody outside it.
  */
  return hash(
    JSON.stringify({
      passes,
      support: input.support,
      supportNote: input.supportNote,
      arrivalNote: input.arrivalNote,
      base: input.base ?? null,
    }),
  )
}

/**
 * FNV-1a, twice, over different starting values.
 *
 * Two 32-bit passes rather than one because a single 32-bit hash collides at odds worth
 * thinking about once a value is compared over and over, and a collision here means the
 * app saying a published schedule is current when it is not — the exact failure this is
 * meant to catch. Not a cryptographic hash and not trying to be: nothing is defended by
 * it, and it never leaves the client except as an opaque string.
 */
function hash(text: string): string {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b + c, 0x85ebca6b) ^ (b >>> 13)
  }
  const hex = (n: number): string => (n >>> 0).toString(16).padStart(8, '0')
  return `${hex(a)}${hex(b)}`
}

/** Where a published schedule stands against the board as it is now. */
export type PublishStatus = 'never' | 'current' | 'stale' | 'unknown'

/**
 * Whether the links already in people's inboxes still match the board.
 *
 * `unknown` is its own answer rather than being folded into either of the others. A
 * schedule published before fingerprints existed has nothing to compare, and guessing
 * would be wrong in both directions: call it current and a real change goes unmentioned;
 * call it stale and every event carries a re-publish notice it may not need.
 *
 * The same applies to `current` being empty, which is how a board that nobody has opened
 * since fingerprints started being recorded looks. It is recorded by the screens that hold
 * the data anyway, so the first visit to one of them settles it.
 */
export function publishStatus(
  published: { publishedAt: number; fingerprint: string } | null,
  current: string,
): PublishStatus {
  if (!published || published.publishedAt === 0) return 'never'
  if (!published.fingerprint || !current) return 'unknown'
  return published.fingerprint === current ? 'current' : 'stale'
}
