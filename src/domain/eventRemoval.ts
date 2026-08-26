/**
 * What removing an event takes with it.
 *
 * Firestore does not cascade — a subcollection is an independent path that merely shares a
 * prefix — so a recursive delete is a client walking this list. It lives here, apart from
 * the walk, because a subcollection missing from it is data that silently stays.
 */

/** Everything stored under `events/{id}/…`. */
export const EVENT_SUBCOLLECTIONS = [
  'people',
  'assignments',
  'jars',
  'signups',
  'swapRequests',
  'eventLocations',
  'meta',
  'reconciliation',
  'reminders',
] as const

export type EventSubcollection = (typeof EVENT_SUBCOLLECTIONS)[number]

/**
 * Stored elsewhere, but belonging to one event.
 *
 * Passes are top-level because the token is the credential and a parent does not know an
 * event id. One outliving its event is a working link into nothing.
 */
export const EVENT_SCOPED_ELSEWHERE = ['passes'] as const

/** How many of each thing a removal would take. */
export type EventTally = Partial<Record<string, number>>

/** Named rather than totalled: "113 people, 75 shifts" stops somebody, "413 documents" does not. */
const SPOKEN: { key: string; one: string; many: string }[] = [
  { key: 'people', one: 'person', many: 'people' },
  { key: 'assignments', one: 'shift', many: 'shifts' },
  { key: 'jars', one: 'jar', many: 'jars' },
  { key: 'signups', one: 'signup', many: 'signups' },
  { key: 'passes', one: 'pass link', many: 'pass links' },
  { key: 'swapRequests', one: 'request', many: 'requests' },
]

export function describeRemoval(tally: EventTally): string[] {
  return SPOKEN.flatMap(({ key, one, many }) => {
    const n = tally[key] ?? 0
    return n > 0 ? [`${n} ${n === 1 ? one : many}`] : []
  })
}

/** Whether there is anything at all to lose. */
export const holdsAnything = (tally: EventTally): boolean =>
  Object.values(tally).some((n) => (n ?? 0) > 0)

/** Typing the name rather than pressing a red button. Nothing else here is irreversible. */
export const confirmsRemoval = (typed: string, name: string): boolean =>
  typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== ''
