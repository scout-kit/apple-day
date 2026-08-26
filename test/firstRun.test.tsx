// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * What somebody sees when they sign in without access.
 *
 * Mostly people who should not be here at all, in a deployed app. So it says who to ask and
 * nothing else: it used to spell out the collection and fields an admin document needs,
 * which is no use to a volunteer and a description of the internals handed to a stranger.
 *
 * Granting the first account is a deployment step, done once by somebody holding the
 * console, and it lives in the README where they are.
 */

vi.mock('../src/lib/session', () => ({
  useSession: () => ({ user: { uid: 'u-first', email: 'first@example.org' }, role: 'none' }),
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

describe('being told how to get in', () => {
  it('says who to ask, and nothing about how access is granted', () => {
    render(<SignInPrompt />)
    expect(screen.getByText(/Ask an organizer to add you/)).toBeTruthy()
  })

  it('does not describe the internals to whoever happens to sign in', () => {
    /*
      No collection names, no field names, no console steps. Rules stop a stranger acting on
      any of it, but there is no reason to tell them where to aim.
    */
    const shown = document.body.textContent ?? ''
    render(<SignInPrompt />)
    const after = document.body.textContent ?? ''
    for (const leak of ['admins', 'Firestore', 'console', 'collection', 'addedAt', 'level']) {
      expect(after, `mentions ${leak}`).not.toContain(leak)
    }
    expect(shown).not.toContain('admins')
  })

  it('still gives the account id, which is what somebody quotes when stuck', () => {
    render(<SignInPrompt />)
    expect(screen.getByText('u-first')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })

  it('says the page notices on its own, so nobody signs in twice', () => {
    // The roster is a listener, so access arrives without another sign-in. Worth saying,
    // because the instinct after being added is to reload and try again.
    render(<SignInPrompt />)
    expect(screen.getByText(/without signing in again/)).toBeTruthy()
  })
})
