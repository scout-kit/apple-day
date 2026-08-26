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
}))

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
  const { role, loading } = useSession()
  return <span data-testid="state">{loading ? 'loading' : role}</span>
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

  it('clears an invitation left behind for that address', async () => {
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ level: 'admin' }) })
    signIn()
    act(() => snapCallback?.(entry('admin')))
    await settle()
    expect(deleteDoc).toHaveBeenCalledWith({ email: 'a@example.org' })
  })

  it('records that it cleared it', async () => {
    /*
      "The invitation is gone and I never used it" is a thing somebody says, and until now
      nothing in the log could answer it either way. Safe to batch here, unlike the claim
      itself: this account is already on the roster, so it has permission to write the line
      alongside the delete.
    */
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ level: 'admin' }) })
    signIn()
    act(() => snapCallback?.(entry('admin')))
    await settle()

    const logged = batchWrites.map((w) => w.data as { summary?: string; entity?: string })
    expect(logged.some((d) => d.entity === 'access' && /invitation/i.test(d.summary ?? ''))).toBe(
      true,
    )
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
