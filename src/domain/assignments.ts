import { ATTENDANCE_VALUES, WHEREABOUTS_VALUES } from './types'
import type { Assignment, AssignmentStatus, Whereabouts } from './types'

/**
 * Read a stored shift.
 *
 * Pure, and in the domain layer, because the bug it covers lived in exactly this
 * translation and was invisible from anywhere it could be tested. The old converter
 * validated the incoming status against a hand-written list of permitted values, and that
 * list had drifted from the type: `out` was missing from it. So issuing a jar wrote
 * `status: 'out'` to Firestore perfectly correctly, and reading it back silently produced
 * `planned` — the youth on the street reappeared on the board as "to come". The write was
 * never at fault, which is why it survived a rules test and a UI test.
 *
 * Two defences against a repeat: the permitted values are the same arrays the types are
 * derived from, so a new state reaches this function for free; and anything unrecognised
 * lands on a documented default rather than being passed through.
 *
 * It also translates the documents written before attendance and whereabouts were split,
 * where `out` and `returned` were statuses. Translating on read rather than migrating the
 * collection keeps last year's data correct and leaves no migration to remember.
 */
export function readAssignment(
  id: string,
  d: Record<string, unknown>,
): Assignment {
  const raw = d.status
  const legacyOut = raw === 'out'
  const legacyBack = raw === 'returned'

  const status: AssignmentStatus =
    legacyOut || legacyBack
      ? // Whatever else was true of them, they had turned up: a jar was in their hands.
        'checkedIn'
      : (ATTENDANCE_VALUES as readonly string[]).includes(raw as string)
        ? (raw as AssignmentStatus)
        : 'planned'

  const stored = d.whereabouts
  const whereabouts: Whereabouts = (
    WHEREABOUTS_VALUES as readonly string[]
  ).includes(stored as string)
    ? (stored as Whereabouts)
    : legacyOut
      ? 'out'
      : legacyBack
        ? 'back'
        : 'here'

  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  const stamp = (v: unknown): number | null => (typeof v === 'number' ? v : null)

  return {
    id,
    slotId: text(d.slotId),
    locationId: text(d.locationId),
    personId: text(d.personId),
    status,
    whereabouts,
    checkedInAt: stamp(d.checkedInAt),
    checkedOutAt: stamp(d.checkedOutAt),
  }
}
