// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Knowing which account you are in.
 *
 * An invitation names no address — whoever opens the link gets in, whatever they sign in
 * with — so nothing about the app implies which account you are in. Being in the wrong one
 * of your own Google accounts does not announce itself: it looks like being told you have no
 * access, or like working somewhere you did not mean to.
 */

const signOutEverywhere = vi.fn()
let session: { user: { uid: string; email?: string; displayName?: string } | null; role: string }

vi.mock('../src/lib/session', () => ({
  useSession: () => session,
  runsTheEvent: () => false,
}))

vi.mock('../src/lib/firebase', () => ({
  missingConfig: [],
  auth: {},
  db: {},
  signInWithGoogle: vi.fn(),
  signOutEverywhere: (...a: unknown[]) => signOutEverywhere(...a),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({ events: [], event: null, eventId: null, slots: [], loading: false,
    pathFor: (s: string) => `/${s}` }),
  EventProvider: ({ children }: { children: unknown }) => children,
}))

const { AccountButton } = await import('../src/App')

beforeEach(() => {
  signOutEverywhere.mockReset()
  session = { user: { uid: 'u1', email: 'devin.personal@example.org' }, role: 'admin' }
})

afterEach(cleanup)

const open = async (): Promise<void> => {
  render(<AccountButton />)
  await userEvent.click(screen.getByRole('button', { name: 'devin.personal@example.org' }))
}

/** The panel, or null when it is closed. Scoped, because the button says the same thing. */
const panel = (): HTMLElement | null => document.querySelector('.account-panel')

describe('the button in the topbar', () => {
  it('shows the name Google gave, which is what somebody recognises', () => {
    session = {
      user: { uid: 'u1', email: 'devin.personal@example.org', displayName: 'A Leader' },
      role: 'admin',
    }
    render(<AccountButton />)
    expect(screen.getByRole('button', { name: 'A Leader' })).toBeTruthy()
  })

  it('shows the whole address when there is no name', () => {
    /*
      All of it, not the part before the @. Two accounts differing only after it — a work and
      a personal address at the same name — are exactly the pair people mix up, and cutting
      there hides the half that tells them apart.
    */
    render(<AccountButton />)
    expect(screen.getByRole('button', { name: 'devin.personal@example.org' })).toBeTruthy()
  })

  it('carries the address as a tooltip, for when the row trims it', () => {
    // Trimmed by the stylesheet against the space actually there, so the full text has to be
    // reachable some other way.
    render(<AccountButton />)
    expect(
      screen.getByRole('button', { name: 'devin.personal@example.org' }).getAttribute('title'),
    ).toBe('devin.personal@example.org')
  })

  it('offers sign-in instead when nobody is signed in', () => {
    session = { user: null, role: 'none' }
    render(<AccountButton />)
    expect(screen.getByRole('button', { name: 'Organizer sign in' })).toBeTruthy()
  })

  it('says Account when there is neither a name nor an address', () => {
    session = { user: { uid: 'u1' }, role: 'organizer' }
    render(<AccountButton />)
    expect(screen.getByRole('button', { name: 'Account' })).toBeTruthy()
  })
})

describe('what the panel answers', () => {
  it('gives the whole address, which is the question being asked', async () => {
    await open()
    expect(within(panel()!).getByText('devin.personal@example.org')).toBeTruthy()
  })

  it('says what the account can do, not just its tier', async () => {
    // "organizer" is a word this app made up; what somebody wants to know is whether they
    // are the person who can change who has access.
    await open()
    expect(screen.getByText(/change who has access/)).toBeTruthy()
  })

  it('says so plainly when the account has no access', async () => {
    session = { user: { uid: 'u1', email: 'stranger@example.org' }, role: 'none' }
    render(<AccountButton />)
    await userEvent.click(screen.getByRole('button', { name: 'stranger@example.org' }))
    expect(screen.getByText(/no access yet/)).toBeTruthy()
  })

  it('says the account has no address rather than showing a blank', async () => {
    /*
      A real case now that the rules allow it: an account with no address claims an
      invitation and its roster entry records an empty string. A panel headed "Signed in as"
      with nothing under it reads as broken.
    */
    session = { user: { uid: 'u1' }, role: 'organizer' }
    render(<AccountButton />)
    await userEvent.click(screen.getByRole('button', { name: 'Account' }))
    expect(screen.getByText(/no email address/)).toBeTruthy()
  })

  it('is where signing out is', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOutEverywhere).toHaveBeenCalled()
  })

  it('closes on Escape, and on a click outside it', async () => {
    await open()
    await userEvent.keyboard('{Escape}')
    expect(panel()).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'devin.personal@example.org' }))
    expect(panel()).toBeTruthy()
    await userEvent.click(document.body)
    expect(panel()).toBeNull()
  })
})
