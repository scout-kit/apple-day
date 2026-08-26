// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Accepting an invitation.
 *
 * The link is open to anybody, like a volunteer's pass, and the page has one job before it
 * asks for anything: say what the invitation is, or say it cannot be used. Somebody asked
 * for a Google account first and told "no access" afterwards has been given no way to tell a
 * dead link from a refusal.
 */

const rememberInvite = vi.fn()
let session: { user: unknown; role: string; loading: boolean }
let invite: { exists: boolean; level?: string; invitedAt?: number } | 'refused'

vi.mock('../src/lib/session', () => ({ useSession: () => session }))

vi.mock('../src/lib/pendingInvite', () => ({
  rememberInvite: (...a: unknown[]) => rememberInvite(...a),
}))

vi.mock('../src/lib/firebase', () => ({ signInWithGoogle: vi.fn(), missingConfig: [], db: {} }))
vi.mock('../src/lib/paths', () => ({ paths: { invite: (code: string) => ({ code }) } }))

vi.mock('firebase/firestore', () => ({
  getDoc: async () => {
    const answer = invite
    if (answer === 'refused') throw new Error('permission denied')
    return {
      exists: () => answer.exists,
      data: () => ({ level: answer.level, invitedAt: answer.invitedAt }),
    }
  },
}))

const { JoinPage } = await import('../src/ui/JoinPage')

const show = (code = 'abcdefghijklmnopqrstuv'): void => {
  render(
    <MemoryRouter initialEntries={[`/join/${code}`]}>
      <Routes>
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="/" element={<div>the app</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  rememberInvite.mockReset()
  session = { user: null, role: 'none', loading: false }
  invite = { exists: true, level: 'organizer', invitedAt: Date.now() }
})

afterEach(cleanup)

describe('arriving with a live invitation', () => {
  it('says what it is an invitation to, before asking for an account', async () => {
    show()
    await waitFor(() => expect(screen.getByText(/You have been invited/)).toBeTruthy())
    expect(screen.getByRole('button', { name: /Sign in and accept/ })).toBeTruthy()
  })

  it('says any Google account will do', async () => {
    // The thing people get wrong, and the reason invitations are codes rather than addresses.
    show()
    await waitFor(() => expect(screen.getByText(/does not have to match/)).toBeTruthy())
  })

  it('puts the code aside, because signing in leaves the page', async () => {
    /*
      Google takes over the tab and hands it back to the app's own route, not this one — so a
      code that lives only in the address bar is gone by the time anything can claim it.
    */
    show()
    await waitFor(() => expect(rememberInvite).toHaveBeenCalledWith('abcdefghijklmnopqrstuv'))
  })
})

describe('arriving with one that cannot be used', () => {
  it('says so for a link already spent or withdrawn', async () => {
    invite = { exists: false }
    show()
    await waitFor(() => expect(screen.getByText(/cannot be used/)).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Sign in and accept/ })).toBeNull()
  })

  it('says expired when it is expired, which is a different thing to fix', async () => {
    invite = {
      exists: true,
      level: 'organizer',
      invitedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
    }
    show()
    await waitFor(() => expect(screen.getByText(/It has expired/)).toBeTruthy())
  })

  it('says nothing is wrong with the account, because that is the worry', async () => {
    invite = { exists: false }
    show()
    await waitFor(() => expect(screen.getByText(/Nothing is wrong with your account/)).toBeTruthy())
  })

  it('reads a refusal as gone, which is all it can honestly say', async () => {
    invite = 'refused'
    show()
    await waitFor(() => expect(screen.getByText(/cannot be used/)).toBeTruthy())
  })
})

describe('arriving already signed in with access', () => {
  /*
    The end of the ordinary path, not an edge case: the claim lands, the session reports the
    tier, and this page is still the one on screen. Sending them anywhere but the app strands
    somebody on a page about getting in at the moment they got in.

    It is also where an admin lands after opening a link to check it, and where anybody signed
    in as the wrong account lands.
  */
  it('does not put the code aside, which would arm it for the next sign-in', async () => {
    /*
      The hole this closes, and it was reachable by accident: an admin opens a link to check
      it, gets sent to the app, and the code stays in the tab. Sign out, sign in as anybody
      else, and that account silently takes the invitation and its tier.

      Nothing to store for an account that already has access — there is nothing for it to
      claim.
    */
    session = { user: { uid: 'u1' }, role: 'admin', loading: false }
    show()
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy())
    expect(rememberInvite).not.toHaveBeenCalled()
  })

  it('goes to the app rather than explaining itself', async () => {
    session = { user: { uid: 'u1' }, role: 'organizer', loading: false }
    show()
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy())
  })

  it('does not sit on a dead end saying they already have access', async () => {
    session = { user: { uid: 'u1' }, role: 'admin', loading: false }
    show()
    await waitFor(() => expect(screen.getByText('the app')).toBeTruthy())
    expect(screen.queryByText(/already have access/)).toBeNull()
  })

  it('stores nothing while the roster is still being read', async () => {
    // The tier is not known yet, so whether there is anything to claim is not known either.
    session = { user: { uid: 'u1' }, role: 'none', loading: true }
    show()
    expect(rememberInvite).not.toHaveBeenCalled()
  })

  it('waits for the roster before deciding, rather than flashing the invitation', async () => {
    // Mid-read the tier is not known yet, and `none` is not the answer — it is the absence
    // of one. Acting on it would show the invitation to somebody who is already in.
    session = { user: { uid: 'u1' }, role: 'none', loading: true }
    show()
    expect(screen.queryByText(/You have been invited/)).toBeNull()
  })
})

describe('signed in, and still nobody', () => {
  it('says the claim is happening, rather than spinning forever', async () => {
    // The claim has been attempted by the session and did not resolve into a roster entry.
    session = { user: { uid: 'u1' }, role: 'none', loading: false }
    show()
    await waitFor(() => expect(screen.getByText(/Accepting it now/)).toBeTruthy())
    expect(screen.getByText(/may have been used already/)).toBeTruthy()
  })
})
