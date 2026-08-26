import type { PassShift } from './publishing'
import { readSupport } from './support'
import type { SupportContact } from './support'

/**
 * What a volunteer's own page shows them.
 *
 * Denormalized onto the pass at publish time so opening the link is a single document
 * read — a volunteer has no rights to read locations, people or assignments, and should
 * not need any.
 */
export interface PassData {
  /** Which year this pass belongs to — a public visitor has no other way to know. */
  eventId: string
  /** Where to report, when the event has a base of operations. */
  base: { name: string; address: string; mapsUrl: string } | null
  personId: string
  displayName: string
  /** Who to contact on the day. Several, and each may be a phone, an email, or both. */
  support: SupportContact[]
  /** The organizers' own words, printed under the contacts. */
  supportNote: string
  /** What to do on reaching base. */
  arrivalNote: string
  /** Whether an organizer has checked them in, which is what names their location. */
  revealShifts: boolean
  shifts: PassShift[]
}

/**
 * Read a pass document.
 *
 * In the domain rather than beside the Firestore call because one of these defaults —
 * whether a missing `revealShifts` means shown or hidden — is a rule about who learns
 * where a youth is standing, and rules belong where they can be tested.
 */
export function toPass(d: Record<string, unknown>): PassData {
  return {
    eventId: typeof d.eventId === 'string' ? d.eventId : '',
    base:
      d.base && typeof d.base === 'object'
        ? {
            name: String((d.base as Record<string, unknown>).name ?? ''),
            address: String((d.base as Record<string, unknown>).address ?? ''),
            mapsUrl: String((d.base as Record<string, unknown>).mapsUrl ?? ''),
          }
        : null,
    personId: typeof d.personId === 'string' ? d.personId : '',
    displayName: typeof d.displayName === 'string' ? d.displayName : '',
    // Falls back to the single phone string passes carried before this.
    support: readSupport(d.support, d.supportPhone),
    supportNote: typeof d.supportNote === 'string' ? d.supportNote : '',
    arrivalNote: typeof d.arrivalNote === 'string' ? d.arrivalNote : '',
    // Absent means hidden. Nobody is told where they are going until they report to base,
    // and a missing field must not be a way past that.
    revealShifts: d.revealShifts === true,
    shifts: Array.isArray(d.shifts) ? (d.shifts as PassShift[]) : [],
  }
}
