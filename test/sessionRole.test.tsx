// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Working out what somebody is allowed to do, the moment after they sign in.
 *
 * Reported from the running app: sign in with an account that has access, get told there is
 * none, reload and be let straight in. Two separate defects, both in the window between
 * "signed in" and "roster read came back".
 */

type Snap = { exists: () => boolean; data: () => unknown }

let authCallback: ((user: unknown) => void) | null = null
let snapCallback: ((snap: Snap) => void) | null = null
let errorCallback: ((e: unknown) => void) | null = null
let unsubscribes = 0

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    authCallback = cb
    return () => {}
  },
  deleteUser: (user: unknown) => deleteUser(user),
  signOut: (auth: unknown) => signOutFallback(auth),
}))

const deleteUser = vi.fn(async (_user: unknown) => undefined)
const signOutFallback = vi.fn(async (_auth: unknown) => undefined)

vi.mock('firebase/firestore', () => ({
  onSnapshot: (_ref: unknown, onNext: (s: Snap) => void, onError: (e: unknown) => void) => {
    snapCallback = onNext
    errorCallback = onError
    return () => {
      unsubscribes += 1
    }
  },
  getDoc: (ref: unknown) => getDoc(ref),
  setDoc: (ref: unknown, data: unknown) => setDoc(ref, data),
  deleteDoc: (ref: unknown) => deleteDoc(ref),
  /*
    Real enough to run the audit path.

    Clearing an invitation goes through `auditedDelete` now, which batches the delete with
    the line recording it. Stubbing the batch out would leave the test asserting a delete
    that no longer happens the way it says it does.
  */
  writeBatch: () => {
    const batch = {
      set: (ref: unknown, data: unknown) => {
        batchWrites.push({ ref, data })
        return batch
      },
      update: () => batch,
      delete: (ref: unknown) => {
        deleteDoc(ref)
        return batch
      },
      commit: async () => undefined,
    }
    return batch
  },
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (ref: { path?: string }, id: string) => ({ path: `${ref.path ?? ''}/${id}` }),
}))

const getDoc = vi.fn(async (_ref: unknown): Promise<Snap> => ({
  exists: () => false,
  data: () => ({}),
}))
const setDoc = vi.fn(async (_ref: unknown, _data: unknown) => undefined)
const deleteDoc = vi.fn(async (_ref: unknown) => undefined)
/** Everything written through a batch — the audit entries, in practice. */
let batchWrites: { ref: unknown; data: unknown }[] = []

vi.mock('../src/lib/firebase', () => ({
  // A build with its config present, which is every case but a broken deploy.
  missingConfig: [],
  auth: {},
  // `db` is what the audit helpers hand to `writeBatch`. Absent, the batch threw inside the
  // clean-up's own try/catch and swallowed the delete with it.
  db: {},
  signInWithGoogle: vi.fn(),
  signOutEverywhere: vi.fn(),
}))
vi.mock('../src/lib/paths', () => ({
  paths: {
    admin: (uid: string) => ({ uid }),
    invite: (email: string) => ({ email }),
    auditEntry: (id: string) => ({ path: `audit/${id}` }),
  },
}))

const { SessionProvider, useSession } = await import('../src/lib/session')

function Probe(): React.ReactElement {
  const { role, loading, discarded } = useSession()
  return (
    <>
      <span data-testid="state">{loading ? 'loading' : role}</span>
      <span data-testid="discarded">{discarded ? 'discarded' : ''}</span>
    </>
  )
}

const state = (): string => screen.getByTestId('state').textContent ?? ''

const entry = (level?: string): Snap => ({
  exists: () => true,
  data: () => (level ? { level } : {}),
})

/*
  The real path in, and the reason the first defect was invisible to a simpler test.

  The app loads, resolves "nobody is signed in" — which sets loading to false — shows the
  prompt, and only then does auth fire again with a user. A test that signs in from the
  initial loading state never leaves it, so it cannot tell whether signing in restores it.
*/
const signIn = (): void => {
  act(() => authCallback?.(null))
  act(() => {
    authCallback?.({ uid: 'u1', email: 'a@example.org', emailVerified: true })
  })
}

beforeEach(() => {
  authCallback = null
  snapCallback = null
  errorCallback = null
  unsubscribes = 0
  getDoc.mockReset()
  getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) })

  setDoc.mockReset()
  deleteDoc.mockReset()
  deleteUser.mockReset()
  deleteUser.mockResolvedValue(undefined)
  signOutFallback.mockReset()
  signOutFallback.mockResolvedValue(undefined)
  sessionStorage.clear()
  batchWrites = []
  vi.useFakeTimers({ shouldAdvanceTime: true })
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  )
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the window between signing in and knowing the role', () => {
  it('says it is still working it out, rather than saying no', () => {
    /*
      The first defect. On sign-in the session still carried the signed-out answer — role
      `none`, and not loading — so for as long as the roster read took, somebody who had
      just signed in successfully was shown "you are not an organizer".
    */
    signIn()
    expect(state()).toBe('loading')
  })

  it('settles on the tier the roster gives them', () => {
    signIn()
    act(() => snapCallback?.(entry('organizer')))
    expect(state()).toBe('organizer')
  })

  it('treats an entry with no tier as a full admin', () => {
    // Every entry written before the two tiers existed is one of these.
    signIn()
    act(() => snapCallback?.(entry()))
    expect(state()).toBe('admin')
  })

  it('says no when the roster says there is no entry', () => {
    // Not an error: the rules let anyone read their own entry, so this is the real answer.
    signIn()
    act(() => snapCallback?.({ exists: () => false, data: () => ({}) }))
    expect(state()).toBe('none')
  })
})

describe('a roster read that fails on the way in', () => {
  /*
    The second defect, and the one that made a reload look like the fix.

    A Firestore listener that errors is finished — it does not retry when the credential
    arrives a moment later. So one failed read in the moment after signing in pinned the
    role at `none` until the page was reloaded by hand.
  */

  it('does not conclude "no access" from a failure', () => {
    signIn()
    act(() => errorCallback?.(new Error('permission-denied')))
    expect(state()).toBe('loading')
  })

  it('tries again, and takes the answer when it arrives', () => {
    signIn()
    act(() => errorCallback?.(new Error('permission-denied')))

    act(() => {
      vi.advanceTimersByTime(200)
    })
    // A fresh listener, which the first error had killed.
    act(() => snapCallback?.(entry('admin')))
    expect(state()).toBe('admin')
  })

  it('gives up eventually, because a failure that persists is not a race', () => {
    signIn()
    for (let i = 0; i < 6; i += 1) {
      act(() => errorCallback?.(new Error('permission-denied')))
      act(() => {
        vi.advanceTimersByTime(5000)
      })
    }
    expect(state()).toBe('none')
  })

  it('stops retrying once somebody signs out', () => {
    // Otherwise a timer fires against an account that is no longer there.
    signIn()
    act(() => errorCallback?.(new Error('permission-denied')))
    act(() => authCallback?.(null))

    expect(state()).toBe('none')
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(state()).toBe('none')
  })
})

/**
 * An invitation that has outlived its purpose.
 *
 * Reported from the running app: "the invitation is still not removed". Claiming one
 * deletes it, but only a first sign-in ever claims — after that the roster entry exists
 * and that branch is never taken again. So anyone who signed in before claiming deleted
 * them, or whose delete failed once, stayed on the admin's "waiting to sign in" list for
 * good: a list of people to chase, filling up with people already here.
 */
describe('signing in when already on the roster', () => {
  const settle = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('does not touch invitations at all', async () => {
    /*
      There is nothing to tidy. An invitation is a code somebody was handed, not a record
      filed under their address, and claiming one deletes it — so nothing is ever left behind
      to find and clear.

      What this pins down is that being already on the roster is a quiet path: no reads, no
      writes, nothing to go wrong for somebody who simply opened the app.
    */
    signIn()
    act(() => snapCallback?.(entry('admin')))
    await settle()
    expect(deleteDoc).not.toHaveBeenCalled()
  })

  it('does not rewrite the roster from it', async () => {
    /*
      The tier on an old invitation may be one an admin has since changed. Re-applying it
      on the next sign-in would quietly undo them — a demotion that keeps coming back.
    */
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ level: 'admin' }) })
    signIn()
    act(() => snapCallback?.(entry('organizer')))
    await settle()
    expect(setDoc).not.toHaveBeenCalled()
    expect(state()).toBe('organizer')
  })

  it('writes nothing when there is no invitation to clear', async () => {
    // The ordinary case, on every sign-in from then on. One read, no write.
    signIn()
    act(() => snapCallback?.(entry('admin')))
    await settle()
    expect(deleteDoc).not.toHaveBeenCalled()
  })
})

describe('an account nobody invited', () => {
  /*
    Signing in with Google creates a Firebase account whether or not the person is anybody
    here, and a free project is allowed a hundred of them in total. Left alone, every
    stranger who ever pressed the button holds one for good — so an account that turns out to
    be nobody is unmade a second later.

    Deleting is the only lever there is without a server: refusing the sign-up before it
    happens needs Identity Platform and a Cloud Function, and the free plan has neither.
  */
  const settle = async (): Promise<void> => {
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('is deleted when there is no entry and nothing in hand', async () => {
    signIn()
    act(() => snapCallback?.({ exists: () => false, data: () => ({}) }))
    await settle()
    expect(deleteUser).toHaveBeenCalled()
  })

  it('says so, so the page does not just flicker', async () => {
    // What is left on screen once the account is gone: a sign-in page, again. Unexplained,
    // that reads as sign-in being broken rather than as being turned away.
    signIn()
    act(() => snapCallback?.({ exists: () => false, data: () => ({}) }))
    await settle()
    expect(screen.getByTestId('discarded').textContent).toBe('discarded')
  })

  it('is left alone when the roster has them', async () => {
    // The case that must never be got wrong: this would delete an organizer's account.
    signIn()
    act(() => snapCallback?.(entry('organizer')))
    await settle()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('is left alone while the roster read is merely failing', async () => {
    /*
      An error is the read failing, not the answer being no. Treating it as "nobody" would
      delete the account of an organizer whose token had not reached Firestore yet — from a
      transient failure the code already retries.
    */
    signIn()
    act(() => errorCallback?.({ code: 'permission-denied' }))
    await settle()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('signs out instead when the delete is refused', async () => {
    /*
      `delete()` needs a recent login, and has just had one — but a refusal has to leave
      somebody somewhere sensible rather than half signed in to an app they cannot use. The
      account stays for an admin to clear.
    */
    deleteUser.mockRejectedValue(new Error('requires-recent-login'))
    signIn()
    act(() => snapCallback?.({ exists: () => false, data: () => ({}) }))
    await settle()
    expect(signOutFallback).toHaveBeenCalled()
  })

  it('is kept when they arrived holding an invitation that works', async () => {
    sessionStorage.setItem('apple-day:invite', 'abcdefghijklmnopqrstuv')
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ level: 'organizer' }) })

    signIn()
    act(() => snapCallback?.({ exists: () => false, data: () => ({}) }))
    await settle()

    expect(setDoc).toHaveBeenCalled()
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it('is discarded when the invitation they arrived with is gone', async () => {
    // A link already used, or revoked. There is nothing to claim, so there is nothing to keep.
    sessionStorage.setItem('apple-day:invite', 'abcdefghijklmnopqrstuv')
    getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) })

    signIn()
    act(() => snapCallback?.({ exists: () => false, data: () => ({}) }))
    await settle()

    expect(deleteUser).toHaveBeenCalled()
  })
})
