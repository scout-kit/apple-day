/**
 * Who may use the app, and how that is decided.
 *
 * Granting access used to mean the Firebase console: find the person under Authentication,
 * copy their uid, create a document by hand. That is a job nobody wants at nine o'clock on
 * a Friday when a leader cannot get in.
 *
 * So there are two records. A **roster entry** is keyed by Firebase uid and is what actually
 * grants access. An **invitation** is keyed by email address, which is the only thing you
 * know about somebody before they have ever signed in — a uid does not exist until then.
 * Signing in with an invited address claims it.
 */

export type Tier = 'admin' | 'organizer'

export interface RosterEntry {
  /** The Firebase uid. This is the document id and cannot be chosen. */
  uid: string
  email: string
  tier: Tier
  addedAt: number
  /** Who granted it, for the question "who let them in". */
  addedBy: string
}

export interface Invitation {
  /** The lowercased email address, which is the document id. */
  email: string
  tier: Tier
  invitedAt: number
  invitedBy: string
  note: string
}

/**
 * How long an invitation is good for.
 *
 * Bounded because an invitation is a standing grant to whoever controls that mailbox. Thirty
 * days covers "I will set you up before Apple Day" without leaving a way in open for a year.
 * The rules enforce this too — a client cannot claim a stale one.
 */
export const INVITE_DAYS = 30

/** Addresses are compared lowercased, because that is how people type them. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Something that looks enough like an address to be worth writing down. */
export function looksLikeEmail(email: string): boolean {
  const value = normaliseEmail(email)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function inviteExpired(invite: Pick<Invitation, 'invitedAt'>, now: number): boolean {
  return now - invite.invitedAt > INVITE_DAYS * 86_400_000
}

/**
 * Why an entry cannot be changed, or null when it can.
 *
 * Nobody may change their own entry. That is not politeness — it is what guarantees the
 * group can never lock itself out. An admin can demote or remove any *other* admin, so
 * with two admins either can remove the other; but neither can remove themselves, so one
 * always remains. Take that rule away and two admins can leave zero, and the only way back
 * in is the console this screen exists to avoid.
 */
export function changeProblem(entry: Pick<RosterEntry, 'uid'>, actingUid: string): string | null {
  if (entry.uid === actingUid) {
    return 'You cannot change your own access. Ask another admin to do it.'
  }
  return null
}

/** Why an address cannot be invited, or null when it can. */
export function inviteProblem(
  email: string,
  roster: Pick<RosterEntry, 'email'>[],
  invites: Pick<Invitation, 'email'>[],
): string | null {
  const value = normaliseEmail(email)
  if (!value) return null
  if (!looksLikeEmail(value)) return 'That does not look like an email address.'
  if (roster.some((r) => normaliseEmail(r.email) === value)) {
    return 'They already have access.'
  }
  if (invites.some((i) => normaliseEmail(i.email) === value)) {
    return 'They have already been invited.'
  }
  return null
}

/** Roster entries, admins first, then by address — the order the list is read in. */
export function sortRoster(entries: RosterEntry[]): RosterEntry[] {
  return [...entries].sort(
    (a, b) =>
      (a.tier === b.tier ? 0 : a.tier === 'admin' ? -1 : 1) ||
      a.email.localeCompare(b.email),
  )
}

/**
 * An invitation for somebody who is already on the roster has been used.
 *
 * It is spent whether the claim deleted it or not — the roster entry is what grants access,
 * and the invitation was only ever the way to name somebody before they had signed in. It
 * matters because those invitations were left behind before claiming cleared them up, and
 * an admin's "waiting to sign in" list is a list of people to chase: one that fills with
 * people already in stops being read.
 */
export function inviteSpent(invite: { email: string }, roster: RosterEntry[]): boolean {
  const on = new Set(roster.map((r) => normaliseEmail(r.email)))
  return on.has(normaliseEmail(invite.email))
}
