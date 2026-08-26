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
   * A label, not an identity. Nothing is checked against it; it exists so the pending list
   * reads as people rather than as a column of codes.
   */
  label: string
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

/**
 * Why an invitation cannot be created, or null when it can.
 *
 * Thin, because there is little to go on. An invitation is not addressed to anybody — it is
 * a code somebody will be handed — so what is typed here is a label, and a label cannot be
 * checked against reality.
 *
 * What it does catch is the honest mistake: nothing typed at all, which leaves a row of
 * codes nobody can tell apart, and inviting somebody plainly already here.
 */
export function inviteProblem(
  label: string,
  roster: Pick<RosterEntry, 'email'>[],
  invites: Pick<Invitation, 'label'>[],
): string | null {
  const value = label.trim()
  if (!value) return null

  const same = (a: string, b: string): boolean =>
    a.trim().toLowerCase() === b.trim().toLowerCase()

  if (roster.some((r) => same(r.email, value))) {
    return 'They already have access.'
  }
  if (invites.some((i) => same(i.label, value))) {
    return 'There is already an invitation waiting for them.'
  }
  return null
}

/** Whether there is enough to create one at all. */
export function canInvite(label: string): boolean {
  return label.trim().length > 0
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
 * A new invitation code.
 *
 * Twenty-two characters from an alphabet of sixty-four, which is the same shape as a
 * volunteer's pass token and for the same reason: holding it is the whole of the
 * permission, so guessing it must be out of the question.
 *
 * The generator is passed in rather than imported so this stays testable without a
 * randomness stub — and so the one place that decides what "unguessable" means is the
 * caller that already does it for passes.
 */
export function inviteCode(random: () => string): string {
  return random()
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
 * Plain text, and no name in the subject. It is read on a phone, and an admin's label for
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
