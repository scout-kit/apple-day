// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Signing out takes the invitation with it.
 *
 * A code kept past a sign-out is a grant sitting there waiting for whoever signs in next on
 * that browser — which is how a brand-new account ends up an organizer having never been
 * sent a link. Signing out is the moment somebody hands the app to somebody else, so it is
 * the moment the code has to go.
 */

const signOut = vi.fn(async (): Promise<void> => undefined)

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }))
vi.mock('firebase/auth', () => ({
  getAuth: () => ({}),
  GoogleAuthProvider: class {},
  signInWithPopup: vi.fn(),
  signOut: () => signOut(),
  connectAuthEmulator: vi.fn(),
}))
vi.mock('firebase/firestore', () => ({
  initializeFirestore: () => ({}),
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
  connectFirestoreEmulator: vi.fn(),
}))

const { signOutEverywhere } = await import('../src/lib/firebase')

const KEY = 'apple-day:invite'

beforeEach(() => {
  sessionStorage.clear()
  signOut.mockReset()
  signOut.mockResolvedValue(undefined)
})

describe('what is left behind', () => {
  it('drops a held invitation code', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ code: 'abcdefghijklmnopqrstuv', at: Date.now() }))
    await signOutEverywhere()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('drops it even when signing out itself fails', async () => {
    // Offline, or a token already gone. The next account to sign in on this browser must not
    // inherit the invitation either way.
    signOut.mockRejectedValue(new Error('offline'))
    sessionStorage.setItem(KEY, JSON.stringify({ code: 'abcdefghijklmnopqrstuv', at: Date.now() }))

    await expect(signOutEverywhere()).rejects.toThrow('offline')
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('still signs out', async () => {
    await signOutEverywhere()
    expect(signOut).toHaveBeenCalled()
  })
})
