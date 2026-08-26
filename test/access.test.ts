import { describe, expect, it } from 'vitest'
import {
  INVITE_DAYS,
  changeProblem,
  inviteExpired,
  inviteSpent,
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
  const roster = [entry('a', 'devin@example.org', 'admin')]
  const invites = [{ email: 'pending@example.org' }]

  it('accepts a fresh address', () => {
    expect(inviteProblem('new@example.org', roster, invites)).toBeNull()
  })

  it('says nothing while the field is still empty', () => {
    // A red message under a box somebody has not typed in yet is noise.
    expect(inviteProblem('', roster, invites)).toBeNull()
    expect(inviteProblem('   ', roster, invites)).toBeNull()
  })

  it('refuses something that is not an address', () => {
    expect(inviteProblem('devin', roster, invites)).toMatch(/does not look like/)
  })

  it('refuses somebody who already has access, whatever the case', () => {
    expect(inviteProblem('DEVIN@example.org', roster, invites)).toMatch(/already have access/)
  })

  it('refuses somebody already invited', () => {
    expect(inviteProblem('pending@example.org', roster, invites)).toMatch(/already been invited/)
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

describe('an invitation that has already been used', () => {
  /*
    Reported from the running app: somebody signs in with their invitation and stays on the
    "waiting to sign in" list. Claiming now deletes the invitation, but the ones left behind
    before that are still there — and a list of people to chase that fills up with people
    already in stops being read.
  */

  const rostered = (email: string): RosterEntry => ({
    uid: 'u1', email, tier: 'organizer', addedAt: 1, addedBy: 'invitation',
  })

  it('is spent once that address is on the roster', () => {
    expect(inviteSpent({ email: 'new@example.org' }, [rostered('new@example.org')])).toBe(true)
  })

  it('is still waiting when nobody has signed in with it', () => {
    expect(inviteSpent({ email: 'new@example.org' }, [rostered('other@example.org')])).toBe(
      false,
    )
  })

  it('does not care how the address was typed', () => {
    // Roster entries record whatever the account reported; invitations are keyed lowercased.
    expect(inviteSpent({ email: 'new@example.org' }, [rostered('  New@Example.ORG ')])).toBe(
      true,
    )
  })

  it('is waiting when the roster is empty', () => {
    expect(inviteSpent({ email: 'new@example.org' }, [])).toBe(false)
  })
})
