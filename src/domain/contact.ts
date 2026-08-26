import type { Person } from './types'

/**
 * Whether somebody can be reached, and how they cannot.
 *
 * Counted apart because the two details do different jobs: an address is how a schedule
 * goes out a week before, a phone number is how somebody is found at ten past nine. A
 * single "no contact details" count hides whichever one is missing.
 */

/** Which of the two is missing. */
export type ContactGap = 'none' | 'phone' | 'email' | 'both'

export function contactGap(person: Person): ContactGap {
  const phone = person.parentPhone.trim() !== ''
  const email = person.parentEmail.trim() !== ''
  if (phone && email) return 'none'
  if (phone) return 'email'
  if (email) return 'phone'
  return 'both'
}

/**
 * What to say about it.
 *
 * A missing address is not worth flagging at a table on the day — nobody emails somebody
 * who is late, and a mark against half the names is a mark nobody reads. On the signup
 * list it is, because that is where the gap gets filled.
 */
export function contactProblem(person: Person, scope: 'today' | 'signup'): string | null {
  const gap = contactGap(person)
  if (gap === 'both') return 'No phone number or email address on file'
  if (gap === 'phone') return 'No phone number on file'
  if (gap === 'email') return scope === 'signup' ? 'No email address on file' : null
  return null
}

/** What to say about it at a table on the day. */
export function todayProblem(person: Person): string | null {
  return contactProblem(person, 'today')
}

export interface ContactGaps {
  /** How many have no phone number, counting those with neither. */
  phone: number
  /** How many have no address, counting those with neither. */
  email: number
  /** How many have neither, and so appear in both counts above. */
  both: number
  /** How many were looked at. */
  of: number
}

export function countGaps(people: Person[]): ContactGaps {
  const gaps = people.map(contactGap)
  return {
    phone: gaps.filter((g) => g === 'phone' || g === 'both').length,
    email: gaps.filter((g) => g === 'email' || g === 'both').length,
    both: gaps.filter((g) => g === 'both').length,
    of: people.length,
  }
}
