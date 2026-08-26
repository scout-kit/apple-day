// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What somebody sees when they sign in without access.
 *
 * Mostly people who should not be here at all, in a deployed app. So it says the fact and
 * nothing else. Spelling out the collection and fields an admin document needs is no use to a
 * volunteer and a description of the internals handed to a stranger.
 *
 * Granting the first account is a deployment step, done once by somebody holding the
 * console, and it lives in the README where they are.
 */

let session: { user: { uid: string; email?: string } | null; role: string; discarded: boolean } = {
  user: { uid: 'u-first', email: 'first@example.org' },
  role: 'none',
  discarded: false,
}

vi.mock('../src/lib/session', () => ({
  useSession: () => session,
  runsTheEvent: () => false,
  canEditSetup: () => false,
  canEditLibrary: () => false,
  canRemoveLibrary: () => false,
  canEditEvent: () => false,
  canAddEvent: () => false,
}))

vi.mock('../src/lib/firebase', () => ({
  // A build with its config present, which is every case but a broken deploy.
  missingConfig: [],
  auth: {},
  db: {},
  signInWithGoogle: vi.fn(),
  signOutEverywhere: vi.fn(),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({ events: [], event: null, eventId: null, slots: [], loading: false,
    pathFor: (s: string) => `/${s}` }),
  EventProvider: ({ children }: { children: unknown }) => children,
}))

const { SignInPrompt } = await import('../src/App')

beforeEach(() => {
  session = { user: { uid: 'u-first', email: 'first@example.org' }, role: 'none', discarded: false }
})

afterEach(cleanup)

describe('being told how to get in', () => {
  it('says the fact, and the one thing that changes it', () => {
    render(<SignInPrompt />)
    expect(screen.getByText(/Your account doesn't have access/)).toBeTruthy()
    expect(screen.getByText(/need an invitation link/)).toBeTruthy()
  })

  it('does not offer anything to work on, because there is nothing', () => {
    /*
      Mostly seen by people who should not be here at all, and for the rest there is no
      setting to check, no id to quote and no retry that helps. Anything beyond the fact and
      the fix reads as a problem to be solved from this screen.
    */
    render(<SignInPrompt />)
    const shown = document.body.textContent ?? ''
    expect(shown.length, 'two short sentences, not a troubleshooting guide').toBeLessThan(200)
  })

  it('does not describe the internals to whoever happens to sign in', () => {
    /*
      No collection names, no field names, no console steps. Rules stop a stranger acting on
      any of it, but there is no reason to tell them where to aim.
    */
    render(<SignInPrompt />)
    const after = document.body.textContent ?? ''
    for (const leak of ['admins', 'Firestore', 'console', 'collection', 'addedAt', 'level']) {
      expect(after, `mentions ${leak}`).not.toContain(leak)
    }
  })

  it('offers no account id, because it is about to stop existing', () => {
    /*
      An account that reaches this screen with no invitation is deleted a moment later, so its
      id is not something anybody can be given or asked to quote. The first admin is set up
      from an invitation instead, which needs no account to exist at all.
    */
    render(<SignInPrompt />)
    expect(screen.queryByText('u-first')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull()
  })
})

describe('when the account was taken away again', () => {
  /*
    What a stranger actually sees: press sign in, a flash, back to the sign-in page. Without
    a word about it the obvious reading is that signing in is broken, and the obvious
    response is to press it again — which does the same thing.
  */
  it('says so plainly, and what would get them in', () => {
    session = { user: null, role: 'none', discarded: true }
    render(<SignInPrompt />)
    expect(screen.getByText(/Your account doesn't have access/)).toBeTruthy()
    expect(screen.getByText(/need an invitation link/)).toBeTruthy()
  })

  it('says nothing of the sort to somebody who has simply not signed in', () => {
    session = { user: null, role: 'none', discarded: false }
    render(<SignInPrompt />)
    expect(screen.queryByText(/doesn't have access/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeTruthy()
  })
})
