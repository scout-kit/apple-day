import { describe, expect, it } from 'vitest'
import {
  INVITE_DAYS,
  canInvite,
  changeProblem,
  inviteDaysLeft,
  inviteExpired,
  inviteIsLive,
  inviteLink,
  inviteProblem,
  looksLikeEmail,
  normaliseEmail,
  sortRoster,
} from '../src/domain/access'
import type { RosterEntry } from '../src/domain/access'

/**
 * Who may use the app.
 *
 * Two records, because they answer different questions. A roster entry is keyed by uid and
 * grants access; an invitation is keyed by email, which is all anyone knows about somebody
 * before they have ever signed in.
 */

const entry = (uid: string, email: string, tier: 'admin' | 'organizer'): RosterEntry => ({
  uid, email, tier, addedAt: 1, addedBy: 'someone',
})

describe('addresses', () => {
  it('are compared lowercased, because that is how people type them', () => {
    expect(normaliseEmail('  Devin@Example.ORG ')).toBe('devin@example.org')
  })

  it('have to look like an address to be worth writing down', () => {
    expect(looksLikeEmail('devin@example.org')).toBe(true)
    expect(looksLikeEmail('devin')).toBe(false)
    expect(looksLikeEmail('devin@example')).toBe(false)
    expect(looksLikeEmail('devin @example.org')).toBe(false)
    expect(looksLikeEmail('')).toBe(false)
  })
})

describe('nobody may change their own access', () => {
  it('refuses your own entry', () => {
    /*
      This is the invariant that makes locking the group out impossible. An admin may remove
      any *other* admin, so with two either can remove the other — but neither can remove
      themselves, so one always remains.
    */
    expect(changeProblem(entry('me', 'me@example.org', 'admin'), 'me')).toMatch(
      /cannot change your own access/,
    )
  })

  it('allows anybody else’s', () => {
    expect(changeProblem(entry('them', 'them@example.org', 'admin'), 'me')).toBeNull()
  })
})

describe('inviting somebody', () => {
  /*
    There is less to validate than there was. An invitation is no longer addressed to
    anybody — it is a code somebody will be handed — so what is typed is a label, and a
    label cannot be checked against reality.
  */
  const roster = [entry('a', 'devin@example.org', 'admin')]
  const invites = [{ label: 'Jo Bailey' }]

  it('accepts anything that names a person', () => {
    expect(inviteProblem('Sam from Cubs', roster, invites)).toBeNull()
    expect(inviteProblem('new@example.org', roster, invites)).toBeNull()
  })

  it('says nothing while the field is still empty', () => {
    // Not a complaint about a form nobody has filled in yet.
    expect(inviteProblem('', roster, invites)).toBeNull()
    expect(canInvite('')).toBe(false)
    expect(canInvite('   ')).toBe(false)
  })

  it('does not complain about an address that is not one', () => {
    /*
      It used to refuse anything that did not look like an email, which was right when the
      address was the identity. It is a label now, and "Jo from Cubs" is a perfectly good
      one.
    */
    expect(inviteProblem('Jo from Cubs', roster, invites)).toBeNull()
  })

  it('catches somebody who plainly already has access', () => {
    expect(inviteProblem('devin@example.org', roster, invites)).toMatch(/already have access/)
    expect(inviteProblem('DEVIN@example.org', roster, invites)).toMatch(/already have access/)
  })

  it('catches a label already waiting', () => {
    expect(inviteProblem('Jo Bailey', roster, invites)).toMatch(/already been invited|already an invitation/)
    expect(inviteProblem('jo bailey', roster, invites)).toMatch(/already an invitation|already been invited/)
  })
})

describe('an invitation does not last forever', () => {
  const now = Date.UTC(2026, 9, 1)

  it('is good for a month', () => {
    // A standing grant to whoever controls that mailbox, so it is bounded.
    expect(inviteExpired({ invitedAt: now - 5 * 86_400_000 }, now)).toBe(false)
    expect(inviteExpired({ invitedAt: now - (INVITE_DAYS - 1) * 86_400_000 }, now)).toBe(false)
  })

  it('goes stale after that', () => {
    expect(inviteExpired({ invitedAt: now - (INVITE_DAYS + 1) * 86_400_000 }, now)).toBe(true)
  })
})

describe('the roster reads admins first', () => {
  it('groups by tier, then by address', () => {
    const sorted = sortRoster([
      entry('c', 'zoe@example.org', 'organizer'),
      entry('a', 'devin@example.org', 'organizer'),
      entry('b', 'sam@example.org', 'admin'),
    ])
    expect(sorted.map((e) => e.email)).toEqual([
      'sam@example.org',
      'devin@example.org',
      'zoe@example.org',
    ])
  })
})

describe('an invitation, while it is waiting', () => {
  const invited = (agoDays: number) => ({
    invitedAt: Date.now() - agoDays * 24 * 60 * 60 * 1000,
  })

  it('is live inside the window', () => {
    expect(inviteIsLive(invited(1), Date.now())).toBe(true)
    expect(inviteIsLive(invited(INVITE_DAYS - 1), Date.now())).toBe(true)
  })

  it('is not, past it', () => {
    // A link that has sat in an inbox for a year is not a standing grant.
    expect(inviteIsLive(invited(INVITE_DAYS + 1), Date.now())).toBe(false)
  })

  it('says how long is left, in days somebody can read', () => {
    expect(inviteDaysLeft(invited(0), Date.now())).toBe(INVITE_DAYS)
    expect(inviteDaysLeft(invited(INVITE_DAYS - 1), Date.now())).toBe(1)
    expect(inviteDaysLeft(invited(INVITE_DAYS + 5), Date.now())).toBe(0)
  })

  it('makes a link that carries the code and nothing else', () => {
    expect(inviteLink('https://apple.web.app', 'k3Ns8pQ2')).toBe(
      'https://apple.web.app/join/k3Ns8pQ2',
    )
    // A trailing slash on the origin must not become a double one in the link.
    expect(inviteLink('https://apple.web.app/', 'k3Ns8pQ2')).toBe(
      'https://apple.web.app/join/k3Ns8pQ2',
    )
  })
})

