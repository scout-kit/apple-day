// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

/**
 * Reading a finished year once.
 *
 * Every year but the one being run is finished: its shifts happened, its jars were counted,
 * and nothing in the app will change either. Reading them again on every visit to a
 * location page bought nothing, and the location page is reached by clicking a shop name
 * from three different screens.
 *
 * The year being run is deliberately not held, because it changes all afternoon.
 */

/** Every collection path `getDocs` has been asked for. */
let reads: string[] = []

vi.mock('firebase/firestore', () => ({
  getDocs: async (ref: { path: string }) => {
    reads.push(ref.path)
    return { docs: [] }
  },
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  writeBatch: () => ({ set: () => {}, update: () => {}, delete: () => {}, commit: async () => {} }),
  onSnapshot: () => () => {},
  query: (ref: unknown) => ref,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  deleteDoc: async () => {},
  setDoc: async () => {},
  initializeFirestore: () => ({}),
  persistentLocalCache: () => ({}),
  persistentMultipleTabManager: () => ({}),
  connectFirestoreEmulator: () => {},
}))

vi.mock('../src/lib/firebase', () => ({ db: {}, auth: { currentUser: null } }))

const event = (id: string, year: number) => ({
  id, name: `Apple Day ${year}`, slug: '', year,
  fridayDate: `${year}-10-02`, saturdayDate: `${year}-10-03`,
  support: [], supportNote: '', arrivalNote: '', baseLocationId: null,
  shiftMode: 'shifts' as const, shiftMinutes: 60, overlapMinutes: 0,
  schedule: { fri: { startMin: 17 * 60, endMin: 19 * 60 } },
})

const EVENTS = [event('2025', 2025), event('2026', 2026)]

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({ events: EVENTS, eventId: '2026', loading: false, slots: [] }),
}))

const { useEventHistory, forgetEventHistory } = await import('../src/lib/repo')

function Probe({ ids }: { ids: string[] }): ReactNode {
  const history = useEventHistory(ids)
  return <div data-loaded={String(!history.loading)} />
}

/** Mount, wait for the fetch to settle, unmount — one visit to a screen. */
async function visit(ids: string[]): Promise<void> {
  const view = render(<Probe ids={ids} />)
  await waitFor(() => expect(view.container.firstElementChild!.getAttribute('data-loaded')).toBe('true'))
  view.unmount()
}

const readsOf = (id: string): number => reads.filter((p) => p.includes(`/${id}/`)).length

beforeEach(() => {
  reads = []
  forgetEventHistory()
})

describe('a year that is over', () => {
  it('is read once, however many times it is asked for', async () => {
    await visit(['2025', '2026'])
    expect(readsOf('2025')).toBe(2) // assignments and jars

    await visit(['2025', '2026'])
    await visit(['2025', '2026'])
    expect(readsOf('2025')).toBe(2)
  })
})

describe('the year being run', () => {
  it('is read again every time, because it changes all afternoon', async () => {
    /*
      The one that must not be cached. A history screen quoting this morning's totals would
      be worse than one that pauses to fetch them — the whole point of the screen is what
      the numbers are now.
    */
    await visit(['2025', '2026'])
    expect(readsOf('2026')).toBe(2)

    await visit(['2025', '2026'])
    expect(readsOf('2026')).toBe(4)
  })
})

describe('asking for fewer years', () => {
  it('reads only the ones asked for', async () => {
    await visit(['2026'])
    expect(readsOf('2025')).toBe(0)
  })
})
