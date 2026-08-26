// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { inviteMessage } from '../src/domain/access'
import type { Invitation, RosterEntry } from '../src/domain/access'

/**
 * Emailing an invitation, when there is a mailbox set up to send it from.
 *
 * An extra, and it has to stay one. Sending needs an OAuth client id and a consent screen;
 * copying a link needs nothing, and a group that never touches the Google Cloud console
 * still has to be able to invite people. So the address is asked for only when sending is
 * configured, it is optional even then, and a failed send costs the mail and not the
 * invitation.
 */

const inviteToTier = vi.fn()
const connect = vi.fn()
const send = vi.fn()
let clientId = 'client-123'
let origin = 'https://appleday.example.org'

vi.mock('../src/lib/repo', () => ({
  useRoster: () => ({ data: [] as RosterEntry[], loading: false, error: null }),
  useInvitations: () => ({ data: [] as Invitation[], loading: false, error: null }),
  inviteToTier: (...a: unknown[]) => inviteToTier(...a),
  cancelInvitation: vi.fn(),
  setTier: vi.fn(),
  removeAccess: vi.fn(),
}))

vi.mock('../src/lib/mail/config', () => ({
  get GOOGLE_CLIENT_ID() {
    return clientId
  },
  publicOrigin: () => origin,
  originLooksPublic: (o: string) => !/localhost|127\.0\.0\.1/.test(o),
}))

vi.mock('../src/lib/mail/gmail', () => ({
  gmailSender: () => ({
    channel: 'gmail',
    label: 'Gmail',
    connect: (...a: unknown[]) => connect(...a),
    isConnected: () => true,
    sendingAs: () => 'devin@example.org',
    send: (...a: unknown[]) => send(...a),
  }),
}))

vi.mock('../src/lib/session', () => ({
  runsTheEvent: () => true,
  canEditSetup: () => true,
  canEditLibrary: () => true,
  canRemoveLibrary: () => true,
  canEditEvent: () => true,
  canAddEvent: () => true,
  useSession: () => ({ user: { uid: 'me', email: 'devin@example.org' }, role: 'admin' }),
}))

const { AccessScreen } = await import('../src/ui/AccessScreen')

beforeEach(() => {
  clientId = 'client-123'
  origin = 'https://appleday.example.org'
  inviteToTier.mockReset()
  inviteToTier.mockResolvedValue('abcdefghijklmnopqrstuv')
  connect.mockReset()
  connect.mockResolvedValue(undefined)
  send.mockReset()
  send.mockResolvedValue(undefined)
})

afterEach(cleanup)

const inviteSomebody = async (to?: string): Promise<void> => {
  render(<AccessScreen />)
  await userEvent.type(screen.getByLabelText('Who it is for'), 'Jo Bailey')
  if (to) await userEvent.type(screen.getByLabelText(/Email the link to/), to)
  await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }))
}

describe('the message itself', () => {
  it('says any Google account will do, which is the thing people get wrong', () => {
    /*
      The failure this whole change was meant to end, arriving by another door: somebody
      invited at a work address assumes they must sign in with that address, has no Google
      account there, and gives up. It is not obvious unless the message says it.
    */
    const { body } = inviteMessage('https://x.example/join/abc', 'organizer', 'Devin')
    expect(body).toMatch(/[Aa]ny Google account/)
    expect(body).toMatch(/does not have to match the address/)
  })

  it('carries the link, and says the link is spent once used', () => {
    const { body } = inviteMessage('https://x.example/join/abc', 'organizer', 'Devin')
    expect(body).toContain('https://x.example/join/abc')
    expect(body).toMatch(/works once/)
    expect(body).toMatch(/30 days/)
  })

  it('says what the tier lets them do, differently for each', () => {
    const asAdmin = inviteMessage('https://x/join/a', 'admin', 'Devin').body
    const asOrganizer = inviteMessage('https://x/join/a', 'organizer', 'Devin').body
    expect(asAdmin).toMatch(/change how it is set up/)
    expect(asOrganizer).toMatch(/build the schedule/)
  })

  it('never repeats the admin’s label for them back to them', () => {
    // "Cub leader, does Saturday" is a note for the admin's own list, not something to mail
    // to the person it is about.
    const { subject, body } = inviteMessage('https://x/join/a', 'organizer', 'Devin')
    expect(subject).not.toMatch(/Jo Bailey/)
    expect(body).not.toMatch(/Jo Bailey/)
  })
})

describe('sending it', () => {
  it('asks for consent before composing anything', async () => {
    await inviteSomebody('jo@example.org')
    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(connect.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[0]!)
  })

  it('sends the link it just made, to the address given', async () => {
    await inviteSomebody('jo@example.org')
    await waitFor(() => expect(send).toHaveBeenCalled())
    const message = send.mock.calls[0]![0] as { to: string; body: string }
    expect(message.to).toBe('jo@example.org')
    expect(message.body).toContain(
      'https://appleday.example.org/join/abcdefghijklmnopqrstuv',
    )
  })

  it('says where it went', async () => {
    await inviteSomebody('jo@example.org')
    await waitFor(() => expect(screen.getByText(/Emailed to jo@example.org/)).toBeTruthy())
  })

  it('does not send the address anywhere near the invitation', async () => {
    /*
      The invitation records a label, a tier and a note — no address. Writing one would
      quietly put back the thing the codes replaced, and would mean an address stored for
      somebody who has not agreed to anything yet.
    */
    await inviteSomebody('jo@example.org')
    await waitFor(() => expect(inviteToTier).toHaveBeenCalled())
    expect(inviteToTier.mock.calls[0]).not.toContain('jo@example.org')
  })

  it('creates the invitation anyway when the send fails, and says to copy the link', async () => {
    send.mockRejectedValue(new Error('Gmail said no'))
    await inviteSomebody('jo@example.org')

    await waitFor(() => expect(screen.getByText(/Gmail said no/)).toBeTruthy())
    expect(screen.getByText(/Copy the link below and send it yourself/)).toBeTruthy()
    // Still there to copy, which is the point of not undoing anything.
    expect(
      screen.getByText('https://appleday.example.org/join/abcdefghijklmnopqrstuv'),
    ).toBeTruthy()
  })

  it('sends nothing when the address is left blank', async () => {
    await inviteSomebody('')
    await waitFor(() => expect(inviteToTier).toHaveBeenCalled())
    expect(send).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('sends nothing for something that is not an address', async () => {
    // Rather than opening a consent popup and failing behind it.
    await inviteSomebody('jo at example dot org')
    await waitFor(() => expect(inviteToTier).toHaveBeenCalled())
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('when sending is not set up', () => {
  it('does not ask for an address it cannot use', () => {
    clientId = ''
    render(<AccessScreen />)
    expect(screen.queryByLabelText(/Email the link to/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Create invitation' })).toBeTruthy()
  })

  it('does not offer to mail a link to localhost', () => {
    /*
      Testing against the emulator, every link points at a machine nobody else can reach.
      Mailing one out is worse than not offering to: it looks like it worked.
    */
    origin = 'http://localhost:5173'
    render(<AccessScreen />)
    expect(screen.queryByLabelText(/Email the link to/)).toBeNull()
  })
})
