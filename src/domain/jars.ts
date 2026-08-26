import { DAYS } from './types'
import type { Day, Jar, Whereabouts } from './types'

/**
 * Read a stored jar.
 *
 * Pure and in the domain layer for the same reason {@link readAssignment} is: the
 * interesting part is a fallback, and a fallback that cannot be tested is a guess. Every
 * jar already in the database was written before one jar could span a stretch of shifts, so
 * it carries a single `assignmentId` and no list. Reading that as a stretch of one keeps
 * the by-hour split correct on last year's data with no migration to run.
 */
export function readJar(id: string, d: Record<string, unknown>): Jar {
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  const count = (v: unknown): number => (typeof v === 'number' ? v : 0)
  const assignmentId = typeof d.assignmentId === 'string' ? d.assignmentId : null

  return {
    id,
    jarNumber: typeof d.jarNumber === 'number' ? d.jarNumber : null,
    day: DAYS.includes(d.day as Day) ? (d.day as Day) : 'sat',
    locationId: text(d.locationId),
    personId: typeof d.personId === 'string' ? d.personId : null,
    assignmentId,
    assignmentIds: Array.isArray(d.assignmentIds)
      ? d.assignmentIds.filter((v): v is string => typeof v === 'string')
      : assignmentId
        ? [assignmentId]
        : [],
    // Anything with an amount is counted, so jars written before the lifecycle existed read
    // correctly rather than appearing to be out on the street.
    status: d.status === 'out' ? 'out' : 'counted',
    issuedAt: count(d.issuedAt),
    issuedBy: text(d.issuedBy),
    amount: typeof d.amount === 'number' ? d.amount : null,
    method: d.method === 'square' ? 'square' : 'cash',
    note: text(d.note),
    countedBy: text(d.countedBy),
    countedAt: count(d.countedAt),
  }
}

/**
 * The shifts a jar was out for.
 *
 * `assignmentIds` for anything issued since a jar could span a stretch, falling back to the
 * single shift older jars carry. Everything that reasons about a jar and a shift goes
 * through this: moving only the first shift of a stretch is what left a youth showing as
 * still out after their jar had been counted.
 */
export function shiftsCoveredBy(
  jar: Pick<Jar, 'assignmentId' | 'assignmentIds'>,
): string[] {
  if (jar.assignmentIds.length > 0) return jar.assignmentIds
  return jar.assignmentId ? [jar.assignmentId] : []
}

/** Whether two jars were out for any of the same shifts — the same trip, in other words. */
export function sharesShiftWith(
  a: Pick<Jar, 'assignmentId' | 'assignmentIds'>,
  b: Pick<Jar, 'assignmentId' | 'assignmentIds'>,
): boolean {
  const mine = new Set(shiftsCoveredBy(a))
  return shiftsCoveredBy(b).some((id) => mine.has(id))
}

/**
 * A shift to move, and where to.
 *
 * The three jar writes — issuing, counting in, taking back — all move shifts, and each one
 * used to decide *which* shifts inside Firebase code that no test could reach. That is how
 * counting in a jar came to move only the first hour of a two-hour trip, leaving a youth on
 * the board as still out with their money already banked. The decision lives here now; the
 * repository only applies it.
 */
export interface ShiftMove {
  assignmentId: string
  whereabouts: Whereabouts
  /** Stamped only when the trip is over. */
  checkedOutAt?: number
}

/** Handing the jar over sends out every hour it covers: a stretch is one trip. */
export function shiftsOnIssue(
  jar: Pick<Jar, 'assignmentId' | 'assignmentIds'>,
): ShiftMove[] {
  return shiftsCoveredBy(jar).map((assignmentId) => ({ assignmentId, whereabouts: 'out' }))
}

/**
 * Counting it in brings them back — every hour of the trip, and only once the last jar is
 * in. Somebody who took three jars and has handed in one is still out there.
 */
export function shiftsOnCount(
  jar: Pick<Jar, 'assignmentId' | 'assignmentIds'>,
  options: { at: number; wasTheirLastJar: boolean },
): ShiftMove[] {
  if (!options.wasTheirLastJar) return []
  return shiftsCoveredBy(jar).map((assignmentId) => ({
    assignmentId,
    whereabouts: 'back',
    checkedOutAt: options.at,
  }))
}

/**
 * Taking an uncounted jar back undoes the trip rather than completing it, so the shifts go
 * to `here` — they never went anywhere.
 */
export function shiftsOnUnissue(
  jar: Pick<Jar, 'assignmentId' | 'assignmentIds'>,
  options: { wasTheirLastJar: boolean },
): ShiftMove[] {
  if (!options.wasTheirLastJar) return []
  return shiftsCoveredBy(jar).map((assignmentId) => ({ assignmentId, whereabouts: 'here' }))
}
