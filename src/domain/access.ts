/**
 * Who may use the app, and how that is decided.
 *
 * Granting access used to mean the Firebase console: find the person under Authentication,
 * copy their uid, create a document by hand. That is a job nobody wants at nine o'clock on
 * a Friday when a leader cannot get in.
 *
 * So there are two records. A **roster entry** is keyed by Firebase uid and is what actually
 * grants access. An **invitation** is keyed by a code nobody can guess, and holding that code
 * is the whole of the permission — whoever opens the link and signs in claims it, with
 * whatever account they have.
 *
 * A code rather than an address, because an address is a guess about somebody else's
 * arrangements. Plenty of people are reachable at one and sign in with a Google account at a
 * completely different one, and being invited at the first and refused at the second looks
 * exactly like being refused outright.
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
  /**
   * An unguessable string, and the document id.
   *
   * Twenty-two characters from an alphabet of fifty-eight, and holding it is the whole of the
   * permission — the same shape as a volunteer's pass, open to `get` and closed to `list` for
   * the same reason. Claiming it deletes it, so it is good once.
   */
  code: string
  /**
   * Who it was meant for, in the admin's own words — a name, an address, "Jo from Cubs".
   *
   * Who it was written for.
   *
   * Not an identity, and nothing about the claim is checked against it: whoever opens the
   * link gets in, with whatever account they sign in with. It is here so the pending list
   * reads as people rather than codes, and so the link can be sent again without anybody
   * typing the address a second time.
   *
   * It is on a document readable by whoever holds the code — which is the person whose
   * address it is, or somebody they forwarded the link to. Worth knowing, and a small thing
   * beside the link itself, which grants the access.
   */
  email: string
  tier: Tier
  invitedAt: number
  invitedBy: string
  note: string
}

/**
 * How long an invitation is good for.
 *
 * Bounded because an invitation is a standing grant to whoever holds the link. Thirty days
 * covers "I will set you up before Apple Day" without leaving a way in open for a year, in a
 * forwarded message nobody remembers sending. The rules enforce this too — a client cannot
 * claim a stale one.
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

/** The other way round, for lists that read "expired" rather than "live". */
export function inviteExpired(invite: Pick<Invitation, 'invitedAt'>, now: number): boolean {
  return !inviteIsLive(invite, now)
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

/**
 * Why an invitation cannot be created, or null when it can.
 *
 * An address is asked for because it is what an admin has: somebody says "add Jo", and Jo's
 * address is the thing they can look up. It also makes "they already have access" a question
 * worth asking, and lets the link be sent without the address being typed twice.
 *
 * It is not how the invitation is claimed. Whoever opens the link gets in with whatever
 * account they sign in with, which is the point — plenty of people are reachable at one
 * address and sign in with a Google account at another.
 */
export function inviteProblem(
  email: string,
  roster: Pick<RosterEntry, 'email'>[],
  invites: Pick<Invitation, 'email'>[],
): string | null {
  const value = normaliseEmail(email)
  if (!value) return null

  if (!looksLikeEmail(value)) return 'That does not look like an email address.'
  if (roster.some((r) => normaliseEmail(r.email) === value)) return 'They already have access.'
  if (invites.some((i) => normaliseEmail(i.email) === value)) {
    return 'There is already an invitation waiting for them.'
  }
  return null
}

/** Whether there is enough to create one at all. */
export function canInvite(email: string): boolean {
  return looksLikeEmail(email)
}

/** Roster entries, admins first, then by address — the order the list is read in. */
export function sortRoster(entries: RosterEntry[]): RosterEntry[] {
  return [...entries].sort(
    (a, b) =>
      (a.tier === b.tier ? 0 : a.tier === 'admin' ? -1 : 1) ||
      a.email.localeCompare(b.email),
  )
}



/** Where an invitation is claimed. One route, so nothing has to guess the shape. */
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/join/${code}`
}

/**
 * The invitation as an email, when there is an address to send it to.
 *
 * The link is the invitation, so the message around it has one job: make it obvious that
 * signing in with *any* Google account is fine. Somebody told "you have been invited" at a
 * work address reasonably assumes they must use that address to sign in, gets refused
 * because they have no Google account there, and gives up — which is the failure the codes
 * were meant to end, arriving by a different door.
 *
 * Plain text, and no name in the subject. It is read on a phone, and the admin's note about
 * somebody is not something to mail back to them.
 */
export function inviteMessage(link: string, tier: Tier, from: string): OutgoingInvite {
  const what =
    tier === 'admin'
      ? 'You will be able to run the event and change how it is set up.'
      : 'You will be able to build the schedule, run the day and record the money.'

  return {
    subject: 'Your Apple Day invitation',
    body: [
      `${from} has invited you to help run Apple Day.`,
      '',
      what,
      '',
      'Open this link and sign in:',
      link,
      '',
      'Any Google account will do — it does not have to match the address this was sent to.',
      '',
      `The link works once, and expires in ${INVITE_DAYS} days.`,
    ].join('\n'),
  }
}

export interface OutgoingInvite {
  subject: string
  body: string
}

/**
 * Whether an invitation can still be claimed.
 *
 * The same window the rules enforce. Checked here as well so the screen can say "expired"
 * rather than letting somebody follow a link and be refused with nothing to read.
 */
export function inviteIsLive(invitation: Pick<Invitation, 'invitedAt'>, now: number): boolean {
  return now - invitation.invitedAt < INVITE_DAYS * 24 * 60 * 60 * 1000
}

/** How long is left, in whole days, for a list somebody reads at a glance. */
export function inviteDaysLeft(
  invitation: Pick<Invitation, 'invitedAt'>,
  now: number,
): number {
  const msLeft = invitation.invitedAt + INVITE_DAYS * 24 * 60 * 60 * 1000 - now
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)))
}

/**
 * What the roster entry an invitation produces must look like.
 *
 * Written here rather than only in the rules so the two can be tested against each other:
 * the rules are the enforcement, and a client that builds something they will refuse is a
 * flow that fails at the last step for no reason a person can see.
 */
export function claimedEntry(
  code: string,
  tier: Tier,
  email: string,
  now: number,
): Record<string, unknown> {
  return {
    email,
    level: tier,
    addedAt: now,
    // Provenance it cannot forge into a name.
    addedBy: 'invitation',
    // Which invitation, so the rules can check the tier against it. Spent by the same batch.
    via: code,
  }
}
