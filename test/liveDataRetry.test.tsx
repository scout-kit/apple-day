// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A subscription that fails on the way in.
 *
 * Reported from the running app: a first sign-in gets you in, and then every screen errors
 * loading its data — and sometimes a reload fixes it.
 *
 * The cause is the same one that pinned the role at "no access": a Firestore listener that
 * errors is finished. It does not retry when the credential arrives a moment later. On a
 * first sign-in every screen subscribes against a roster entry written seconds earlier, so
 * one denied read left the page showing an error until it was reloaded by hand.
 */

let onNext: ((snap: unknown) => void) | null = null
let onError: ((e: Error) => void) | null = null
let attaches = 0
let unsubscribes = 0
/** Set to make subscribing throw, the way a client whose work queue has failed does. */
let throwOnAttach: Error | null = null

vi.mock('firebase/firestore', () => ({
  onSnapshot: (_q: unknown, next: (s: unknown) => void, err: (e: Error) => void) => {
    attaches += 1
    if (throwOnAttach) throw throwOnAttach
    onNext = next
    onError = err
    return () => {
      unsubscribes += 1
    }
  },
}))

const recover = vi.fn()
vi.mock('../src/lib/recover', () => ({
  recoverFromFatalFailure: (error: unknown) => {
    recover(error)
  },
}))

const { useCollectionData } = await import('../src/lib/useData')

function Probe(): React.ReactElement {
  const { data, loading, error } = useCollectionData({} as never, (id) => id, [])
  return (
    <span data-testid="state">
      {loading ? 'loading' : error ? `error:${error.message}` : `rows:${data.length}`}
    </span>
  )
}

const state = (): string => screen.getByTestId('state').textContent ?? ''
const rows = (ids: string[]): unknown => ({ docs: ids.map((id) => ({ id, data: () => ({}) })) })

beforeEach(() => {
  onNext = null
  onError = null
  attaches = 0
  unsubscribes = 0
  throwOnAttach = null
  recover.mockClear()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  render(<Probe />)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a listener that is denied on the way in', () => {
  it('keeps saying it is loading, rather than flashing an error', () => {
    // A screen that shows an error it is about to withdraw teaches people to reload.
    act(() => onError?.(new Error('permission-denied')))
    expect(state()).toBe('loading')
  })

  it('attaches again, because the first one is dead', () => {
    expect(attaches).toBe(1)
    act(() => onError?.(new Error('permission-denied')))
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(attaches).toBe(2)
  })

  it('shows the data once a retry succeeds', () => {
    act(() => onError?.(new Error('permission-denied')))
    act(() => {
      vi.advanceTimersByTime(200)
    })
    act(() => onNext?.(rows(['a', 'b'])))
    expect(state()).toBe('rows:2')
  })

  it('gives up eventually, because a refusal that persists is the answer', () => {
    /*
      An organizer opening something admin-only is denied and always will be. Retrying for
      ever would spin, and never showing the error would leave them with a screen that says
      "loading" until they leave it.
    */
    for (let i = 0; i < 6; i += 1) {
      act(() => onError?.(new Error('nope')))
      act(() => {
        vi.advanceTimersByTime(5000)
      })
    }
    expect(state()).toBe('error:nope')
  })

  it('stops retrying when the screen goes away', () => {
    act(() => onError?.(new Error('permission-denied')))
    const { unmount } = render(<Probe />)
    unmount()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    // No listener left behind billing reads against a screen nobody is looking at.
    expect(unsubscribes).toBeGreaterThan(0)
  })
})

describe('a listener that works first time', () => {
  it('is attached once and shows what it got', () => {
    act(() => onNext?.(rows(['a'])))
    expect(state()).toBe('rows:1')
    expect(attaches).toBe(1)
  })
})

/**
 * The other kind of failure, reported later the same evening as a console full of
 * identical errors: the offline store refusing to open, and then the SDK's own invariant
 * breaking. Neither recovers by being asked again — but the retry above asked anyway,
 * four times, from every subscription on the page.
 */
describe('a client that is finished', () => {
  const FATAL = new Error(
    'FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9) ' +
      'CONTEXT: {"ve":-1}',
  )

  it('does not attach again, because asking again cannot work', () => {
    act(() => onError?.(FATAL))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    // One subscription, one error. Not one error multiplied by four attempts, on every
    // screen at once, which is what filled the console.
    expect(attaches).toBe(1)
  })

  it('says so straight away rather than sitting on "loading"', () => {
    act(() => onError?.(FATAL))
    expect(state()).toContain('error:')
  })

  it('asks to be recovered from', () => {
    act(() => onError?.(FATAL))
    expect(recover).toHaveBeenCalledWith(FATAL)
  })

  it('survives subscribing itself throwing', () => {
    /*
      Once the work queue has failed, onSnapshot throws instead of calling back. Inside a
      React effect that escapes the render, so the page dies rather than showing why.
    */
    throwOnAttach = new Error(
      'FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)',
    )
    expect(() => render(<Probe />)).not.toThrow()
    expect(recover).toHaveBeenCalled()
  })
})
