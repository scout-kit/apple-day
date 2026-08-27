// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Invitation, RosterEntry } from '../src/domain/access'

/**
 * Managing access from the app.
 *
 * The screen exists so that granting somebody access is not a trip to the Firebase console:
 * find them under Authentication, copy a uid, create a document by hand.
 */

const inviteToTier = vi.fn()
const cancelInvitation = vi.fn()
const setTier = vi.fn()
const removeAccess = vi.fn()

let roster: RosterEntry[] = []
let invites: Invitation[] = []

vi.mock('../src/lib/repo', () => ({
  useRoster: () => ({ data: roster, loading: false, error: null }),
  useInvitations: () => ({ data: invites, loading: false, error: null }),
  inviteToTier: (...a: unknown[]) => inviteToTier(...a),
  cancelInvitation: (...a: unknown[]) => cancelInvitation(...a),
  setTier: (...a: unknown[]) => setTier(...a),
  removeAccess: (...a: unknown[]) => removeAccess(...a),
}))

vi.mock('../src/lib/session', () => ({
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canSeeTheEvent: (r: string) => r === 'admin' || r === 'organizer' || r === 'viewer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
  useSession: () => ({
    user: { uid: 'me', email: 'devin@example.org' },
    role: 'admin',
  }),
}))

const { AccessScreen } = await import('../src/ui/AccessScreen')

const entry = (
  uid: string,
  email: string,
  tier: 'admin' | 'organizer',
): RosterEntry => ({ uid, email, tier, addedAt: Date.UTC(2026, 8, 1), addedBy: 'devin@example.org' })

beforeEach(() => {
  for (const fn of [inviteToTier, cancelInvitation, setTier, removeAccess]) {
    fn.mockReset()
    fn.mockResolvedValue(undefined)
  }
  roster = [entry('me', 'devin@example.org', 'admin'), entry('them', 'sam@example.org', 'organizer')]
  invites = []
})

describe('who has access', () => {
  /**
   * The row for one person.
   *
   * Matched on the first cell, because an address also appears in the "who granted this"
   * column — including your own, on your own row.
   */
  const rosterRow = (email: string): HTMLElement =>
    screen
      .getAllByRole('row')
      .find((r) => r.querySelector('td')?.textContent?.startsWith(email))!

  it('lists everybody and their tier', () => {
    render(<AccessScreen />)
    expect(rosterRow('devin@example.org')).toBeTruthy()
    expect(
      (screen.getByLabelText('Tier for sam@example.org') as HTMLSelectElement).value,
    ).toBe('organizer')
  })

  it('moves somebody between tiers', async () => {
    render(<AccessScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Tier for sam@example.org'), 'admin')
    expect(setTier).toHaveBeenCalledWith('them', 'admin')
  })

  it('offers no way to change your own access', () => {
    /*
      The invariant: an admin may remove any other admin, so with two either can remove the
      other — but neither can remove themselves, so one always remains. Offering the control
      and then refusing the write would be worse than not offering it.
    */
    render(<AccessScreen />)
    expect(screen.queryByLabelText('Tier for devin@example.org')).toBeNull()
    const yourRow = rosterRow('devin@example.org')
    expect(within(yourRow).queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(yourRow.textContent).toContain('you')
  })

  it('warns what removing somebody means before doing it', async () => {
    render(<AccessScreen />)
    const theirRow = screen
      .getAllByRole('row')
      .find((r) => r.querySelector('td')?.textContent?.startsWith('sam@example.org'))!
    await userEvent.click(within(theirRow).getByRole('button', { name: 'Remove' }))

    /*
      Nothing to chase afterwards, and the dialog says so. An invitation is spent the moment
      it is claimed, so anybody on the roster has none outstanding — removing the entry is the
      whole job, and there is no leftover link to go and find.
    */
    expect(screen.getByText(/no old link that still works/)).toBeTruthy()
    expect(removeAccess).not.toHaveBeenCalled()

    const dialog = screen.getByText(/Remove their access\?/).closest('.modal') as HTMLElement
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))
    expect(removeAccess).toHaveBeenCalledWith('them')
  })
})

describe('inviting somebody', () => {
  const emailField = (): HTMLInputElement =>
    screen.getByLabelText('Their email address') as HTMLInputElement

  it('takes an address and a tier, and needs no uid', async () => {
    /*
      Which is the point: a uid does not exist until their first sign-in, so there is nothing
      to look up and nothing to paste. The address is who it is for and where the link goes —
      it is not what they sign in with.
    */
    render(<AccessScreen />)
    await userEvent.type(emailField(), 'new@example.org')
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }))

    expect(inviteToTier).toHaveBeenCalledWith(
      'new@example.org',
      'organizer',
      'devin@example.org',
      '',
    )
  })

  it('defaults to the lesser tier', () => {
    render(<AccessScreen />)
    expect((screen.getByLabelText('Tier') as HTMLSelectElement).value).toBe('organizer')
  })

  it('carries a note, so a list of invitations stays readable later', async () => {
    render(<AccessScreen />)
    await userEvent.type(emailField(), 'new@example.org')
    await userEvent.type(screen.getByLabelText('Note'), 'Cub leader')
    await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }))
    expect(inviteToTier.mock.calls[0]![3]).toBe('Cub leader')
  })

  it('refuses somebody who already has access', async () => {
    render(<AccessScreen />)
    await userEvent.type(emailField(), 'SAM@example.org')
    expect(screen.getByText(/already have access/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Create invitation' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says nothing while the field is empty', () => {
    render(<AccessScreen />)
    expect(screen.queryByText(/does not look like/)).toBeNull()
    expect((screen.getByRole('button', { name: 'Create invitation' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains what each tier can do', async () => {
    render(<AccessScreen />)
    expect(screen.getByText(/Runs the event/)).toBeTruthy()
    await userEvent.selectOptions(screen.getByLabelText('Tier'), 'admin')
    expect(screen.getByText(/including the library/)).toBeTruthy()
  })
})

describe('invitations waiting to be claimed', () => {
  it('lists them with who invited them and why', () => {
    invites = [
      { code: 'c-new', email: 'new@example.org', tier: 'organizer', invitedAt: Date.now(), invitedBy: 'devin@example.org', note: 'Cub leader' },
    ]
    render(<AccessScreen />)
    expect(screen.getByText('new@example.org')).toBeTruthy()
    expect(screen.getByText(/Cub leader/)).toBeTruthy()
  })

  it('marks one that has gone stale', () => {
    invites = [
      {
        code: 'c-old', email: 'old@example.org', tier: 'organizer',
        invitedAt: Date.now() - 40 * 86_400_000, invitedBy: 'devin@example.org', note: '',
      },
    ]
    render(<AccessScreen />)
    expect(screen.getByText(/Expired/)).toBeTruthy()
  })

  it('revokes one, which is the only way to take a sent link back', async () => {
    invites = [
      { code: 'c-new', email: 'new@example.org', tier: 'admin', invitedAt: Date.now(), invitedBy: 'devin@example.org', note: '' },
    ]
    render(<AccessScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(cancelInvitation).toHaveBeenCalledWith('c-new'))
  })

  it('shows nothing at all when nobody is waiting', () => {
    render(<AccessScreen />)
    expect(screen.queryByText(/Waiting to sign in/)).toBeNull()
  })
})

describe('the link an invitation is', () => {
  /*
    The invitation is a code now, not an address. Claiming deletes it, so there is no such
    thing as one that has been used and is still listed — what there is, is a link that has
    to be copied and sent, and revoked if it should not have been.
  */
  it('shows the link, so it can be sent', () => {
    invites = [
      {
        code: 'k3Ns8pQ2', email: 'Jo Bailey', tier: 'organizer',
        invitedAt: Date.now(), invitedBy: 'devin@example.org', note: '',
      },
    ]
    render(<AccessScreen />)
    expect(screen.getByText(/\/join\/k3Ns8pQ2/)).toBeTruthy()
  })

  it('offers to copy it rather than making somebody select it', () => {
    invites = [
      {
        code: 'k3Ns8pQ2', email: 'Jo Bailey', tier: 'organizer',
        invitedAt: Date.now(), invitedBy: 'devin@example.org', note: '',
      },
    ]
    render(<AccessScreen />)
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('says how long is left, so a stale one is obvious before it expires', () => {
    invites = [
      {
        code: 'k3Ns8pQ2', email: 'Jo Bailey', tier: 'organizer',
        invitedAt: Date.now() - 29 * 86_400_000, invitedBy: 'devin@example.org', note: '',
      },
    ]
    render(<AccessScreen />)
    expect(screen.getByText(/Expires tomorrow/)).toBeTruthy()
  })

  it('offers no link for an expired one, since sending it would be pointless', () => {
    invites = [
      {
        code: 'k3Ns8pQ2', email: 'Jo Bailey', tier: 'organizer',
        invitedAt: Date.now() - 40 * 86_400_000, invitedBy: 'devin@example.org', note: '',
      },
    ]
    render(<AccessScreen />)
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeTruthy()
  })
})
