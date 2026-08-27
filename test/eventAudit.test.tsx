// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { blankEvent } from '../src/domain/events'

/**
 * Who started a year, and who changed it.
 *
 * The event document holds the dates, the hours, the shift shape and the number printed on
 * every volunteer's pass — and none of it was recorded. That mattered more once editing it
 * stopped being an admin-only screen: the widest write path in the app was the one with no
 * line saying who had used it.
 */

interface Write { path: string; data: Record<string, unknown> }

let batches: { writes: Write[]; committed: boolean }[] = []

vi.mock('firebase/firestore', () => ({
  onSnapshot: () => () => {},
  getDoc: async () => ({ exists: () => true, data: () => EXISTING }),
  collection: (_db: unknown, name: string) => ({ path: name }),
  doc: (ref: { path?: string } | unknown, ...rest: string[]) => ({
    path: [(ref as { path?: string })?.path, ...rest].filter(Boolean).join('/'),
  }),
  writeBatch: () => {
    const self = {
      writes: [] as Write[],
      committed: false,
      set: (ref: { path: string }, data: Record<string, unknown>) => {
        self.writes.push({ path: ref.path, data })
        return self
      },
      update: () => self,
      delete: () => self,
      commit: async () => {
        self.committed = true
      },
    }
    batches.push(self)
    return self
  },
}))

vi.mock('../src/lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'u1', email: 'organizer@example.org' } } }))

vi.mock('../src/lib/session', () => ({
  runsTheEvent: () => true,
  canSeeTheEvent: (r: string) => r === 'admin' || r === 'organizer' || r === 'viewer',
  canEditSetup: () => true,
  canEditLibrary: () => true,
  canRemoveLibrary: () => true,
  canEditEvent: () => true,
  canAddEvent: () => true,
  useSession: () => ({ user: { uid: 'u1' }, role: 'admin', loading: false }),
}))

/*
  What the event looked like before an edit, for the diff.

  The whole document, not a few fields of it. A partial one makes every field it omits look
  newly filled in, so a save that changed nothing still produced a line — which is exactly
  what the last test in this file is here to catch, and it would have been catching the
  fixture rather than the code.
*/
const EXISTING: Record<string, unknown> = {
  name: 'Apple Day 2026',
  slug: '',
  year: 2026,
  fridayDate: '2026-10-02',
  saturdayDate: '2026-10-03',
  support: [],
  supportNote: 'Ring base first',
  arrivalNote: '',
  baseLocationId: null,
  finishedAt: null,
  shiftMode: 'shifts',
  shiftMinutes: 60,
  overlapMinutes: 0,
  schedule: { fri: { startMin: 1020, endMin: 1140 } },
}

const { EventProvider, useEvent } = await import('../src/lib/eventContext')

let api: ReturnType<typeof useEvent> | null = null
function Probe(): ReactNode {
  api = useEvent()
  return null
}

const mount = (): void => {
  render(
    <MemoryRouter>
      <EventProvider>
        <Probe />
      </EventProvider>
    </MemoryRouter>,
  )
}

/** Every audit line written, whatever batch it landed in. */
const entries = (): Record<string, unknown>[] =>
  batches.flatMap((b) => b.writes.filter((w) => w.path.startsWith('audit')).map((w) => w.data))

beforeEach(() => {
  batches = []
  api = null
})

describe('starting a year', () => {
  it('writes a line saying who did', async () => {
    mount()
    await waitFor(() => expect(api).not.toBeNull())
    await api!.createEvent(blankEvent('Apple Day 2027', 2027))

    const line = entries()[0]!
    expect(line.action).toBe('created')
    expect(line.entity).toBe('event')
    expect(line.by).toBe('u1')
    expect(String(line.summary)).toContain('Apple Day 2027')
  })

  it('files it against no event, because the event does not exist yet', async () => {
    /*
      The constraint that decides this. An entry may only name an event that exists, and
      that is checked against the database as it is *before* the write — so filing a
      creation under its own new id would be refused, and the refusal would take the event
      with it. Nobody could start a year at all.

      Which is the honest filing anyway: starting a year is a change to the set of years,
      the same kind of thing as adding a shop to the library.
    */
    mount()
    await waitFor(() => expect(api).not.toBeNull())
    await api!.createEvent(blankEvent('Apple Day 2027', 2027))

    expect(entries()[0]!.eventId).toBeNull()
  })

  it('puts the record in the same commit as the event', async () => {
    // Either both land or neither does, the same as every other change in the app.
    mount()
    await waitFor(() => expect(api).not.toBeNull())
    await api!.createEvent(blankEvent('Apple Day 2027', 2027))

    const committed = batches.filter((b) => b.committed)
    expect(committed).toHaveLength(1)
    expect(committed[0]!.writes.some((w) => w.path.startsWith('audit'))).toBe(true)
    expect(committed[0]!.writes.some((w) => w.path.startsWith('events'))).toBe(true)
  })
})

describe('changing a year', () => {
  const event = (over: Record<string, unknown> = {}) =>
    ({
      id: '2026', name: 'Apple Day 2026', slug: '', year: 2026,
      fridayDate: '2026-10-02', saturdayDate: '2026-10-03',
      support: [], supportNote: 'Ring base first', arrivalNote: '', baseLocationId: null,
      finishedAt: null,
      shiftMode: 'shifts', shiftMinutes: 60, overlapMinutes: 0,
      schedule: { fri: { startMin: 1020, endMin: 1140 } },
      ...over,
    }) as Parameters<NonNullable<typeof api>['saveEvent']>[0]

  it('says what changed, from what to what', async () => {
    mount()
    await waitFor(() => expect(api).not.toBeNull())
    await api!.saveEvent(event({ supportNote: 'Ring Devin first' }))

    const changes = entries()[0]!.changes as { field: string; from: string; to: string }[]
    const note = changes.find((c) => c.field === 'supportNote')!
    expect(note.from).toBe('Ring base first')
    expect(note.to).toBe('Ring Devin first')
  })

  it('files it against the event itself, unlike its creation', async () => {
    // It exists by now, and somebody reading what changed about this year wants it there.
    mount()
    await waitFor(() => expect(api).not.toBeNull())
    await api!.saveEvent(event({ shiftMinutes: 45 }))

    expect(entries()[0]!.eventId).toBe('2026')
  })

  it('says nothing when nothing moved', async () => {
    // Opening the editor and pressing save is not an event, and a log of those is unread.
    mount()
    await waitFor(() => expect(api).not.toBeNull())
    await api!.saveEvent(event())

    expect(entries()).toHaveLength(0)
  })
})
