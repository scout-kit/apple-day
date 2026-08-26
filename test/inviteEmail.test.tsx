// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
/** The client id each sender was built with — what actually carries it. */
let madeWith: string[] = []
const send = vi.fn()
let clientId = 'client-123'
let origin = 'https://appleday.example.org'

let invites: Invitation[] = []

vi.mock('../src/lib/repo', () => ({
  useRoster: () => ({ data: [] as RosterEntry[], loading: false, error: null }),
  useInvitations: () => ({ data: invites, loading: false, error: null }),
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
  gmailSender: (id: string) => ({
    ...(madeWith.push(id), {}),
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
  invites = []
  inviteToTier.mockReset()
  inviteToTier.mockResolvedValue('abcdefghijklmnopqrstuv')
  madeWith = []
  connect.mockReset()
  connect.mockResolvedValue(undefined)
  send.mockReset()
  send.mockResolvedValue(undefined)
})

afterEach(cleanup)

/** Add somebody by address, which is now the whole of the form. */
const inviteSomebody = async (address = 'jo@example.org'): Promise<void> => {
  render(<AccessScreen />)
  await userEvent.type(screen.getByLabelText('Their email address'), address)
  await userEvent.click(screen.getByRole('button', { name: 'Create invitation' }))
}

describe('the message itself', () => {
  it('says any Google account will do, which is the thing people get wrong', () => {
    /*
      The failure the codes were meant to end, arriving by another door: somebody invited at
      a work address assumes they must sign in with that address, has no Google account
      there, and gives up. It is not obvious unless the message says it.
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

  it('never repeats the admin’s note about them back to them', () => {
    // "Cub leader, does Saturday" is for the admin's own list, not for the person it is about.
    const { subject, body } = inviteMessage('https://x/join/a', 'organizer', 'Devin')
    expect(subject).not.toMatch(/Cub leader/)
    expect(body).not.toMatch(/Cub leader/)
  })
})

describe('making one', () => {
  it('takes an address and nothing else', async () => {
    /*
      One field, because it was one thing all along. Asking who it is for and then asking
      again where to send it read as two separate jobs, and made sending look like part of
      creating rather than the next thing you do.
    */
    render(<AccessScreen />)
    expect(screen.getByLabelText('Their email address')).toBeTruthy()
    expect(screen.queryByLabelText(/Email the link to/)).toBeNull()
  })

  it('does not send anything by itself', async () => {
    // Sending opens a consent popup, and one that appears without being asked for is one a
    // browser blocks.
    await inviteSomebody()
    await waitFor(() => expect(inviteToTier).toHaveBeenCalled())
    expect(send).not.toHaveBeenCalled()
  })

  it('records the address on the invitation, so it can be sent later', async () => {
    await inviteSomebody()
    await waitFor(() => expect(inviteToTier).toHaveBeenCalled())
    expect(inviteToTier.mock.calls[0]![0]).toBe('jo@example.org')
  })

  it('will not create one for something that is not an address', async () => {
    render(<AccessScreen />)
    await userEvent.type(screen.getByLabelText('Their email address'), 'Jo from Cubs')
    expect(
      (screen.getByRole('button', { name: 'Create invitation' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(screen.getByText(/not look like an email/)).toBeTruthy()
  })

  it('offers the link straight away, whatever else happens', async () => {
    // The deliverable. Plenty of invitations go by text or in person.
    await inviteSomebody()
    await waitFor(() =>
      expect(
        screen.getByText('https://appleday.example.org/join/abcdefghijklmnopqrstuv'),
      ).toBeTruthy(),
    )
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })
})

describe('then sending it', () => {
  const emailButton = (): HTMLElement =>
    screen.getByRole('button', { name: /Email it to jo@example.org/ })

  it('offers to send it to the address it was made for', async () => {
    await inviteSomebody()
    await waitFor(() => expect(emailButton()).toBeTruthy())
  })

  it('asks for consent before composing anything', async () => {
    /*
      Two calls, in that order. Consent opens while somebody is looking at a button they
      pressed — asking for it mid-run is where a popup blocker strands it.
    */
    await inviteSomebody()
    await waitFor(() => expect(emailButton()).toBeTruthy())
    await userEvent.click(emailButton())

    await waitFor(() => expect(send).toHaveBeenCalled())
    expect(madeWith).toContain('client-123')
    expect(connect).toHaveBeenCalled()
    expect(connect.mock.invocationCallOrder[0]!).toBeLessThan(send.mock.invocationCallOrder[0]!)
  })

  it('sends the link it just made, to that address', async () => {
    await inviteSomebody()
    await waitFor(() => expect(emailButton()).toBeTruthy())
    await userEvent.click(emailButton())

    await waitFor(() => expect(send).toHaveBeenCalled())
    const message = send.mock.calls[0]![0] as { to: string; body: string }
    expect(message.to).toBe('jo@example.org')
    expect(message.body).toContain('https://appleday.example.org/join/abcdefghijklmnopqrstuv')
  })

  it('says where it went, and stops offering to send it again', async () => {
    await inviteSomebody()
    await waitFor(() => expect(emailButton()).toBeTruthy())
    await userEvent.click(emailButton())

    await waitFor(() => expect(screen.getByText(/Emailed to jo@example.org/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Email it to/ })).toBeNull()
  })

  it('keeps the invitation and the link when the send fails', async () => {
    // Only a message failed. The link is on screen and in the list, and it still works.
    send.mockRejectedValue(new Error('Gmail said no'))
    await inviteSomebody()
    await waitFor(() => expect(emailButton()).toBeTruthy())
    await userEvent.click(emailButton())

    await waitFor(() => expect(screen.getByText(/Gmail said no/)).toBeTruthy())
    expect(screen.getByText(/copy it and send it yourself/)).toBeTruthy()
    expect(
      screen.getByText('https://appleday.example.org/join/abcdefghijklmnopqrstuv'),
    ).toBeTruthy()
  })

  it('is not offered when sending is not set up', async () => {
    clientId = ''
    await inviteSomebody()
    await waitFor(() => expect(inviteToTier).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: /Email it to/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })
})

describe('against the emulator', () => {
  /*
    Offered, and warned about. The same call the reminders screen makes.

    Sending is worth trying before a real Apple Day depends on it — the consent screen, the
    scope, whether the message reads properly on a phone. What a local link cannot do is
    work for anybody else, so that is what gets said.
  */
  beforeEach(() => {
    origin = 'http://localhost:5173'
  })

  it('still offers to send, so the whole path can be tried', async () => {
    await inviteSomebody()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Email it to jo@example.org/ })).toBeTruthy(),
    )
  })

  it('says the link only works on this machine, and names the setting', () => {
    render(<AccessScreen />)
    expect(screen.getByText(/nobody\s+outside this machine can open/)).toBeTruthy()
    expect(screen.getByText('VITE_PUBLIC_ORIGIN')).toBeTruthy()
  })

  it('sends the local link as it is, rather than inventing a public one', async () => {
    // Guessing at a real origin would send a link to somewhere that may not be this app.
    await inviteSomebody()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Email it to/ })).toBeTruthy(),
    )
    await userEvent.click(screen.getByRole('button', { name: /Email it to/ }))

    await waitFor(() => expect(send).toHaveBeenCalled())
    const message = send.mock.calls[0]![0] as { body: string }
    expect(message.body).toContain('http://localhost:5173/join/abcdefghijklmnopqrstuv')
  })

  it('says nothing about origins when the link is a real one', () => {
    origin = 'https://appleday.example.org'
    render(<AccessScreen />)
    expect(screen.queryByText(/outside this machine/)).toBeNull()
  })
})

describe('sending one that is already waiting', () => {
  /*
    A message that went astray, one that never arrived, one sent before somebody mentioned
    which account they use. The link does not change — it is the same invitation — so this is
    another copy of the same thing rather than a new grant.
  */
  const pending: Invitation = {
    code: 'abcdefghijklmnopqrstuv',
    email: 'jo@example.org',
    tier: 'organizer',
    invitedAt: Date.now(),
    invitedBy: 'devin@example.org',
    note: '',
  }

  beforeEach(() => {
    invites = [pending]
  })

  const waiting = (): HTMLElement => document.querySelector('.issue-list') as HTMLElement

  it('is one press, with nothing to type', async () => {
    /*
      The invitation knows who it is for. Asking for the address again is what made resending
      feel like making a new invitation.
    */
    render(<AccessScreen />)
    await userEvent.click(within(waiting()).getByRole('button', { name: 'Email it' }))

    await waitFor(() => expect(send).toHaveBeenCalled())
    const message = send.mock.calls[0]![0] as { to: string; body: string }
    expect(message.to).toBe('jo@example.org')
    expect(message.body).toContain('/join/abcdefghijklmnopqrstuv')
    expect(inviteToTier, 'no second invitation was created').not.toHaveBeenCalled()
  })

  it('sends it at the tier that invitation actually grants', async () => {
    // Not whatever the create form happens to be set to, which is a different question.
    render(<AccessScreen />)
    await userEvent.click(within(waiting()).getByRole('button', { name: 'Email it' }))

    await waitFor(() => expect(send).toHaveBeenCalled())
    expect((send.mock.calls[0]![0] as { body: string }).body).toMatch(/build the schedule/)
  })

  it('says where it went, and offers to do it again', async () => {
    render(<AccessScreen />)
    await userEvent.click(within(waiting()).getByRole('button', { name: 'Email it' }))

    await waitFor(() => expect(screen.getByText(/Emailed to jo@example.org/)).toBeTruthy())
    expect(within(waiting()).getByRole('button', { name: 'Send again' })).toBeTruthy()
  })

  it('keeps the link working when the send fails', async () => {
    send.mockRejectedValue(new Error('Gmail said no'))
    render(<AccessScreen />)
    await userEvent.click(within(waiting()).getByRole('button', { name: 'Email it' }))

    await waitFor(() => expect(screen.getByText(/Gmail said no/)).toBeTruthy())
    expect(screen.getByText(/link itself still works/)).toBeTruthy()
  })

  it('is not offered when sending is not set up', () => {
    clientId = ''
    render(<AccessScreen />)
    expect(within(waiting()).queryByRole('button', { name: 'Email it' })).toBeNull()
    // Copying it is always there, and needs nothing.
    expect(within(waiting()).getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('is not offered for one that has expired', () => {
    // Nothing worth sending: following it would only say it cannot be used.
    invites = [{ ...pending, invitedAt: Date.now() - 40 * 24 * 60 * 60 * 1000 }]
    render(<AccessScreen />)
    expect(within(waiting()).queryByRole('button', { name: 'Email it' })).toBeNull()
  })

  it('is not offered for one made by hand, which names nobody to send to', () => {
    // The console route types a tier and a date and no address at all.
    invites = [{ ...pending, email: '' }]
    render(<AccessScreen />)
    expect(within(waiting()).queryByRole('button', { name: 'Email it' })).toBeNull()
    expect(within(waiting()).getByText('no address')).toBeTruthy()
  })
})
