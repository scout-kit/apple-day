// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRoute } from './helpers/router'
import { describe, expect, it, vi } from 'vitest'

/**
 * Render smoke tests for the two pages a volunteer sees.
 *
 * These are the pages opened by someone standing outside a shop on a phone, and a
 * white screen there is the worst failure in the app — so they get asserted rather than
 * eyeballed. Firebase is mocked out; what is under test is that the components mount and
 * put the right words on screen.
 */

const readPass = vi.fn()
const requestSwap = vi.fn()

vi.mock('../src/lib/session', () => ({
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
  readPass: (...args: unknown[]) => readPass(...args),
  /*
    The page watches its pass rather than reading it once, so their location can appear the
    moment an organizer checks them in. The mock resolves the same promise and then holds
    the subscription open, which is what the real listener does.
  */
  watchPass: (
    token: string,
    onData: (p: unknown) => void,
    onError: () => void,
  ): (() => void) => {
    void readPass(token).then(onData).catch(onError)
    return () => {}
  },
}))

vi.mock('../src/lib/repo', () => ({
  requestSwap: (...args: unknown[]) => requestSwap(...args),
}))

const useDocumentData = vi.fn()
vi.mock('../src/lib/useData', () => ({
  useDocumentData: (...args: unknown[]) => useDocumentData(...args),
  useCollectionData: () => ({ data: [], loading: false, error: null }),
}))

vi.mock('../src/lib/paths', () => ({ paths: { publishState: () => ({}) } }))

const { PassPage } = await import('../src/ui/PassPage')

describe('a volunteer opening their pass', () => {
  it('shows their name, their shift and the support number', async () => {
    readPass.mockResolvedValue({
      personId: 'y01',
      role: 'volunteer',
      displayName: 'Alpha One',
      support: [{ name: '', phone: '519-555-0100', email: '' }],
      shifts: [
        {
          day: 'Friday',
          slotLabel: '5:00 PM – 6:00 PM',
          locationName: 'Braemar — 640 Linden Drive',
          address: '640 Linden Dr',
          mapsUrl: 'https://maps.example/braemar',
          comments: 'Outside on the sidewalk. Do not block the doors.',
        },
      ],
      // Checked in, so their location is on the pass. Until then it is withheld — see the
      // gating tests below.
      revealShifts: true,
      // The organizers' own words, not the app's.
      supportNote: 'Please arrive 15 minutes before your shift.',
    })

    render(<MemoryRoute path="/p/:token" url="/p/tok123"><PassPage /></MemoryRoute>)

    await waitFor(() => expect(screen.getByText('Alpha One')).toBeDefined())
    expect(screen.getByText(/Braemar/)).toBeDefined()
    expect(screen.getByText(/Do not block the doors/)).toBeDefined()
    expect(screen.getByText('519-555-0100')).toBeDefined()
    expect(screen.getByText(/15 minutes before/)).toBeDefined()
    expect(screen.getByText('Directions')).toBeDefined()
  })

  it('says so plainly when the link is stale rather than showing an empty page', async () => {
    readPass.mockResolvedValue(null)

    render(<MemoryRoute path="/p/:token" url="/p/expired"><PassPage /></MemoryRoute>)

    await waitFor(() => expect(screen.getByText(/link is not valid/)).toBeDefined())
    expect(screen.getByText(/ask an organizer to resend it/i)).toBeDefined()
  })

  it('handles a pass that exists but has no shifts yet', async () => {
    readPass.mockResolvedValue({
      personId: 'y02', role: 'volunteer', displayName: 'Beta Two',
      support: [], shifts: [],
    })

    render(<MemoryRoute path="/p/:token" url="/p/tok456"><PassPage /></MemoryRoute>)

    await waitFor(() => expect(screen.getByText('Beta Two')).toBeDefined())
    expect(screen.getByText(/No shifts on this pass yet/)).toBeDefined()
  })
})

describe('what is reachable without an account', () => {
  it('is a pass and an invitation, and nothing else', () => {
    /*
      Two, and both are the same idea: an unguessable string in a link, standing for one
      thing and reaching nothing else.

      A pass carries one person's own shifts. An invitation carries the offer of access and
      the tier it is for — it has to be readable before signing in, or somebody following a
      link would be asked for a Google account before being told what for, and told nothing
      at all if the link had expired.

      Read off the routes rather than asserted about a screen, because the claim is about what
      exists rather than what any page renders — a third public route added anywhere in the
      app fails this, which is the point of it.
    */
    const app = readFileSync('src/App.tsx', 'utf8')
    const publicRoutes = [...app.matchAll(/<Route path="(\/[^"]*)"/g)]
      .map((m) => m[1]!)
      .filter((path) => !path.startsWith('/e/') && path !== '/' && path !== '*')

    expect(publicRoutes.sort()).toEqual(['/join/:code', '/p/:token'])
    expect(app).not.toContain('PublicSchedulePage')
  })
})
