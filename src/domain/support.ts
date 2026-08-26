/**
 * Who a volunteer can reach on the day.
 *
 * One phone number was never enough. Apple Day runs from two places at once across a
 * Friday evening and a Saturday, base ops changes hands partway through, and a parent whose
 * child is not where the schedule says needs somebody who answers — not the one number that
 * happens to be in a meeting. Several contacts, each with a phone, an email, or both.
 *
 * A contact is named because "call 519-555-0100" is a worse instruction than "call Devin at
 * base ops": on a wet Saturday morning the volunteer wants to know who picks up.
 */
export interface SupportContact {
  /** Who to ask for: "Devin, base ops". */
  name: string
  phone: string
  email: string
}

export function blankContact(): SupportContact {
  return { name: '', phone: '', email: '' }
}

/** A contact worth publishing: it has some way of actually reaching somebody. */
export function isReachable(contact: SupportContact): boolean {
  return contact.phone.trim() !== '' || contact.email.trim() !== ''
}

/**
 * Read the support contacts off a stored document.
 *
 * Falls back to the single `supportPhone` string every event carried before this, so last
 * year's event and every pass already published keep working with no migration. An entry
 * with no phone and no email is dropped: an empty row in the editor is somebody who started
 * typing and stopped, not a contact.
 */
export function readSupport(raw: unknown, legacyPhone?: unknown): SupportContact[] {
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

  if (Array.isArray(raw)) {
    return raw
      .filter((v): v is Record<string, unknown> => typeof v === 'object' && v !== null)
      .map((v) => ({ name: text(v.name), phone: text(v.phone), email: text(v.email) }))
      .filter(isReachable)
  }

  const phone = text(legacyPhone)
  return phone ? [{ name: '', phone, email: '' }] : []
}

/** Tidy a list on its way to storage: trimmed, and without the half-typed rows. */
export function cleanSupport(contacts: SupportContact[]): SupportContact[] {
  return contacts
    .map((c) => ({ name: c.name.trim(), phone: c.phone.trim(), email: c.email.trim() }))
    .filter(isReachable)
}

/** How to introduce a contact when there is no name against it. */
export function contactLabel(contact: SupportContact): string {
  return contact.name.trim() || contact.phone.trim() || contact.email.trim()
}
