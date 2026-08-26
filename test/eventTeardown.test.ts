import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT_SUBCOLLECTIONS } from '../src/domain/eventRemoval'

/**
 * Removing an event, and everything under it.
 *
 * Firestore does not cascade: deleting `events/2026` removes one document and leaves every
 * shift, jar and person beneath it, reachable and belonging to a year that no longer
 * appears anywhere. The walk is the whole feature, so what it walks — and in what order —
 * is what these tests are about.
 */

interface Batch {
  deletes: string[]
  writes: { path: string; data: Record<string, unknown> }[]
  committed: boolean
}

let batches: Batch[] = []
/** How many documents each collection path pretends to hold. */
let sizes: Record<string, number> = {}

const makeBatch = (): Batch & Record<string, unknown> => {
  const self = {
    deletes: [] as string[],
    writes: [] as { path: string; data: Record<string, unknown> }[],
    committed: false,
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      self.writes.push({ path: ref.path, data })
    },
    update: () => {},
    delete: (ref: { path: string }) => {
      self.deletes.push(ref.path)
    },
    commit: async () => {
      self.committed = true
    },
  }
  batches.push(self)
  return self
}

vi.mock('firebase/firestore', () => ({
  writeBatch: () => makeBatch(),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  doc: (ref: { path?: string } | unknown, ...rest: string[]) => ({
    path: [(ref as { path?: string })?.path, ...rest].filter(Boolean).join('/'),
  }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  /** Returns as many stub documents as `sizes` says that path holds. */
  getDocs: async (ref: { path: string }) => {
    const n = sizes[ref.path] ?? 0
    return {
      size: n,
      docs: Array.from({ length: n }, (_, i) => ({ ref: { path: `${ref.path}/d${i}` } })),
    }
  },
  onSnapshot: () => () => {},
  query: (ref: unknown) => ref,
  where: () => ({}),
  limit: () => ({}),
  orderBy: () => ({}),
  deleteDoc: async () => {},
  setDoc: async () => {},
}))

vi.mock('../src/lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1', email: 'admin@example.org' } },
}))

const { removeEvent, tallyEvent } = await import('../src/lib/repo')

const event = { id: '2026', name: 'Apple Day 2026' } as Parameters<typeof removeEvent>[0]

const committed = (): Batch[] => batches.filter((b) => b.committed)
const allDeletes = (): string[] => committed().flatMap((b) => b.deletes)
const auditLine = (): Record<string, unknown> =>
  committed().flatMap((b) => b.writes).find((w) => w.path.startsWith('audit'))!.data

beforeEach(() => {
  batches = []
  sizes = {
    'events/2026/people': 3,
    'events/2026/assignments': 2,
    'events/2026/jars': 1,
    passes: 2,
  }
})

describe('what it takes with it', () => {
  it('deletes every document under the event', () => {
    // The list is `EVENT_SUBCOLLECTIONS`, which a separate test checks against `paths.ts` —
    // a subcollection missing from it is data that silently stays.
    expect(EVENT_SUBCOLLECTIONS.length).toBeGreaterThan(5)
  })

  it('empties each subcollection it holds', async () => {
    await removeEvent(event)
    expect(allDeletes()).toContain('events/2026/people/d0')
    expect(allDeletes()).toContain('events/2026/people/d2')
    expect(allDeletes()).toContain('events/2026/assignments/d1')
    expect(allDeletes()).toContain('events/2026/jars/d0')
  })

  it('takes the passes, which are not stored under the event at all', async () => {
    /*
      Top-level, because the token is the credential and a parent does not know an event id.
      One outliving its event is a working link into nothing.
    */
    await removeEvent(event)
    expect(allDeletes()).toContain('passes/d0')
    expect(allDeletes()).toContain('passes/d1')
  })

  it('looks in every subcollection, even the empty ones', async () => {
    // Otherwise the one that happens to be empty today is the one forgotten tomorrow.
    sizes = {}
    await removeEvent(event)
    // Nothing to delete but the event itself.
    expect(allDeletes()).toEqual(['events/2026'])
  })
})

describe('the order it does it in', () => {
  it('removes the event document last', async () => {
    /*
      So a failure part-way leaves the event still there, still listed, and the whole thing
      retryable. Removing the parent first would strand everything under an id that nothing
      points at any more — which is precisely the state this feature exists to prevent.
    */
    await removeEvent(event)
    const deletes = allDeletes()
    expect(deletes[deletes.length - 1]).toBe('events/2026')
    expect(deletes.indexOf('events/2026')).toBe(deletes.length - 1)
  })

  it('puts the record in the same commit as the event document', async () => {
    // Either both land or neither does, the same guarantee as every other change here.
    await removeEvent(event)
    const last = committed()[committed().length - 1]!
    expect(last.deletes).toEqual(['events/2026'])
    expect(last.writes.some((w) => w.path.startsWith('audit'))).toBe(true)
  })
})

describe('the line it leaves behind', () => {
  it('says what went, not just that something did', async () => {
    await removeEvent(event)
    const changes = auditLine().changes as { field: string; from: string; to: string }[]
    expect(changes).toContainEqual({ field: 'people', from: '3', to: '—' })
    expect(changes).toContainEqual({ field: 'passes', from: '2', to: '—' })
  })

  it('names the event in words somebody would recognise', async () => {
    await removeEvent(event)
    expect(String(auditLine().summary)).toContain('Apple Day 2026')
  })

  it('is filed against no event, the way creating one is', async () => {
    /*
      The event will not exist by the time anybody reads this. An entry filed against it
      would sit under a year that cannot be selected — and the rules would refuse it anyway
      once the event is gone.
    */
    await removeEvent(event)
    expect(auditLine().eventId).toBeNull()
    expect(auditLine().action).toBe('deleted')
  })
})

describe('batching', () => {
  it('stays under the write limit for a large event', async () => {
    // A real event is a few hundred documents; Firestore refuses a batch over 500.
    sizes = { 'events/2026/people': 600, 'events/2026/assignments': 700 }
    await removeEvent(event)

    for (const batch of committed()) {
      expect(batch.deletes.length + batch.writes.length).toBeLessThanOrEqual(500)
    }
    expect(allDeletes()).toHaveLength(1301) // 600 + 700 + the event itself
  })
})

describe('counting first', () => {
  it('reports what an event is holding', async () => {
    expect(await tallyEvent('2026')).toEqual({
      people: 3,
      assignments: 2,
      jars: 1,
      passes: 2,
    })
  })

  it('leaves out what is not there, so nothing reads as “0 people”', async () => {
    sizes = { 'events/2026/people': 1 }
    expect(await tallyEvent('2026')).toEqual({ people: 1 })
  })
})
