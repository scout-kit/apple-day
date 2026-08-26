// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * When the event list subscribes, and when it re-subscribes.
 *
 * Only organizers and counters may list `/events`. A listener started before auth has
 * resolved is evaluated with no credentials and denied — and a Firestore listener that
 * errors is finished, it does not retry when the credentials turn up a moment later. That
 * pairing put a permanent "false for 'list'" on the Years screen, and left the list dead
 * after an organizer grant made while the app was open.
 *
 * So: no subscription until the session resolves, and a fresh one whenever identity or
 * role changes.
 */

const onSnapshot = vi.fn()
vi.mock('firebase/firestore', () => ({
  onSnapshot: (...args: unknown[]) => onSnapshot(...args),
  setDoc: vi.fn(),
  collection: vi.fn(() => ({ path: 'events' })),
  doc: vi.fn(() => ({ path: 'events/x' })),
}))

vi.mock('../src/lib/firebase', () => ({ db: {} }))

let session = { user: null as { uid: string } | null, role: 'none', loading: true }
vi.mock('../src/lib/session', () => ({
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
  useSession: () => session,
}))

const { EventProvider, useEvent } = await import('../src/lib/eventContext')

function Probe(): React.ReactNode {
  const { events, loading, error } = useEvent()
  return (
    <div>
      <span data-testid="count">{events.length}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="error">{error ? error.message : 'none'}</span>
    </div>
  )
}

/** The provider reads the event from the URL, so it needs a router around it. */
const renderProvider = (url = '/'): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <EventProvider>
        <Probe />
      </EventProvider>
    </MemoryRouter>,
  )

const rerenderProvider = (
  rerender: (ui: React.ReactElement) => void,
  url = '/',
): void =>
  rerender(
    <MemoryRouter initialEntries={[url]}>
      <EventProvider>
        <Probe />
      </EventProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  onSnapshot.mockReset()
  onSnapshot.mockReturnValue(() => {})
  localStorage.clear()
  session = { user: null, role: 'none', loading: true }
})

describe('subscribing', () => {
  it('does not subscribe while the session is still resolving', () => {
    renderProvider()
    // This is the bug: subscribing here is a guaranteed permission denial.
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('does not subscribe for a signed-out visitor', () => {
    session = { user: null, role: 'none', loading: false }
    renderProvider()
    expect(onSnapshot).not.toHaveBeenCalled()
    // And says nothing is loading, rather than spinning forever.
    expect(screen.getByTestId('loading').textContent).toBe('false')
    expect(screen.getByTestId('error').textContent).toBe('none')
  })

  it('does not subscribe for someone signed in without a role', () => {
    // Signed in but not yet granted organizer access — a denial here is expected, so
    // there is no point making the request or showing its error.
    session = { user: { uid: 'u1' }, role: 'none', loading: false }
    renderProvider()
    expect(onSnapshot).not.toHaveBeenCalled()
    expect(screen.getByTestId('error').textContent).toBe('none')
  })

  it('subscribes once the session resolves to an organizer', () => {
    session = { user: { uid: 'u1' }, role: 'admin', loading: false }
    renderProvider()
    expect(onSnapshot).toHaveBeenCalledTimes(1)
  })

  it('does not subscribe for somebody signed in with no access', () => {
    // A Google account that nobody has invited. The rules deny the list, and a denied
    // Firestore listener is finished — it does not retry — so asking at all would leave
    // the picker permanently dead if they were granted access a moment later.
    session = { user: { uid: 'u2' }, role: 'none', loading: false }
    renderProvider()
    expect(onSnapshot).not.toHaveBeenCalled()
  })
})

describe('re-subscribing', () => {
  it('starts a listener when the session resolves after mount', async () => {
    const { rerender } = renderProvider()
    expect(onSnapshot).not.toHaveBeenCalled()

    // Auth arrives a moment later, which is the normal cold-load sequence.
    session = { user: { uid: 'u1' }, role: 'admin', loading: false }
    rerenderProvider(rerender)
    await waitFor(() => expect(onSnapshot).toHaveBeenCalledTimes(1))
  })

  it('starts a new listener when a role is granted while the app is open', async () => {
    session = { user: { uid: 'u1' }, role: 'none', loading: false }
    const { rerender } = renderProvider()
    expect(onSnapshot).not.toHaveBeenCalled()

    // `make admin` lands; the session picks it up live. The old listener cannot recover,
    // so a new one has to start.
    session = { user: { uid: 'u1' }, role: 'admin', loading: false }
    rerenderProvider(rerender)
    await waitFor(() => expect(onSnapshot).toHaveBeenCalledTimes(1))
  })

  it('drops the listener and clears the list on sign-out', async () => {
    const unsubscribe = vi.fn()
    onSnapshot.mockReturnValue(unsubscribe)
    session = { user: { uid: 'u1' }, role: 'admin', loading: false }
    const { rerender } = renderProvider()
    expect(onSnapshot).toHaveBeenCalledTimes(1)

    session = { user: null, role: 'none', loading: false }
    rerenderProvider(rerender)
    await waitFor(() => expect(unsubscribe).toHaveBeenCalled())
    expect(screen.getByTestId('count').textContent).toBe('0')
  })

  it('surfaces a genuine denial once it is actually subscribed', async () => {
    session = { user: { uid: 'u1' }, role: 'admin', loading: false }
    onSnapshot.mockImplementation((_ref, _next, onError: (e: Error) => void) => {
      onError(new Error('Missing or insufficient permissions.'))
      return () => {}
    })
    renderProvider()
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toContain('insufficient permissions'),
    )
    expect(screen.getByTestId('loading').textContent).toBe('false')
  })
})

describe('an organizer gets the list of events', () => {
  it('subscribes for an organizer, not only an admin', async () => {
    /*
      This is how somebody knows which events they have access to: the picker in the top bar
      and the events screen both read this list.

      The gate said `admin` only, which meant an organizer subscribed to nothing — the picker
      was empty, no event was ever selected, and every year-scoped screen came up blank. The
      whole tier was unusable rather than merely limited.
    */
    session = { user: { uid: 'u1' }, role: 'organizer', loading: false }
    renderProvider()
    await waitFor(() => expect(onSnapshot).toHaveBeenCalled())
  })
})
