// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VolunteerRequest } from '../src/domain/requests'

/**
 * The alert on the working screens.
 *
 * It says that something needs dealing with and where to go. It does not deal with it:
 * answering a volunteer means reading what they said and usually ringing a parent, which is
 * not a thing to start doing over the top of a jar being counted.
 */

let requests: VolunteerRequest[] = []
let role = 'admin'

vi.mock('../src/lib/repo', () => ({
  useVolunteerRequests: () => ({ data: requests, loading: false, error: null }),
  usePasses: () => ({ data: [], loading: false, error: null }),
  usePeople: () => ({ data: [], loading: false, error: null }),
  useAssignments: () => ({ data: [], loading: false, error: null }),
  useLocations: () => ({ data: [], loading: false, error: null }),
  markRequestHandled: vi.fn(),
  setAssignmentStatusMany: vi.fn(),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026' },
    pathFor: (screen: string) => `/e/2026/${screen}`,
    slots: [],
  }),
}))

vi.mock('../src/lib/session', () => ({
  useSession: () => ({ user: { uid: 'organizer' }, role }),
  runsTheEvent: (r: string) => r === 'admin' || r === 'organizer',
  canEditSetup: (r: string) => r === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
}))

const { RequestsInbox } = await import('../src/ui/RequestsInbox')

const request = (over: Partial<VolunteerRequest> = {}): VolunteerRequest => ({
  id: 'r1', passToken: 'tok-one', kind: 'cancel', slotId: '',
  message: 'soccer runs late', createdAt: Date.UTC(2026, 9, 1, 12), handledAt: null,
  handledBy: '', handledByEmail: '', ...over,
})

beforeEach(() => {
  requests = []
  role = 'admin'
})

describe('when something is waiting', () => {
  it('says how many, and points at the notifications page', () => {
    requests = [request({ id: 'a' }), request({ id: 'b' })]
    render(<RequestsInbox />)

    expect(screen.getByText(/2 requests waiting for an answer/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open notifications' }).getAttribute('href')).toBe(
      '/e/2026/notifications',
    )
  })

  it('counts one properly', () => {
    requests = [request()]
    render(<RequestsInbox />)
    expect(screen.getByText(/1 request waiting for an answer/)).toBeTruthy()
  })

  it('says how long the oldest has been waiting', () => {
    // Two requests an hour apart read very differently from two a week apart.
    requests = [request({ id: 'old', createdAt: Date.UTC(2026, 8, 28, 9) })]
    render(<RequestsInbox />)
    expect(screen.getByText(/The oldest came in/)).toBeTruthy()
  })

  it('offers nothing to act on here', () => {
    /*
      Deliberate. Answering somebody properly means reading what they said and ringing a
      parent; doing that over the top of a jar being counted is how half an answer happens.
    */
    requests = [request()]
    render(<RequestsInbox />)

    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Off/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'No-show, and done' })).toBeNull()
  })
})

describe('when nothing is waiting', () => {
  it('renders nothing at all', () => {
    const { container } = render(<RequestsInbox />)
    expect(container.textContent).toBe('')
  })

  it('renders nothing even when there is a history', () => {
    // It used to say "No requests waiting · 4 already dealt with", which is a permanent box
    // telling somebody there is nothing to do.
    requests = [request({ id: 'done', handledAt: 5, handledBy: 'organizer' })]
    const { container } = render(<RequestsInbox />)
    expect(container.textContent).toBe('')
  })
})

describe('who sees it', () => {
  it('is not shown to base ops, who cannot read requests at all', () => {
    // The rules refuse them, so the listener is not even started.
    role = 'counter'
    requests = [request()]
    const { container } = render(<RequestsInbox />)
    expect(container.textContent).toBe('')
  })
})
