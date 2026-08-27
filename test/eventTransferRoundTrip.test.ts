import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EVENT_SUBCOLLECTIONS } from '../src/domain/eventRemoval'
import type { AppleDayEvent } from '../src/domain/types'

/**
 * Taking a year out and putting it back.
 *
 * The part worth testing is not that documents move — it is what the file has to carry
 * besides the event's own records. A year points at shops and sections that live outside it
 * because they are shared between years, which is exactly why a project that never ran this
 * year will not have them. Leave those out and a restore is a board full of rows reading
 * "unknown location", which is not a restore.
 */

interface Written {
  path: string
  data: Record<string, unknown>
}

/** What the fake database holds, by collection path. */
let stored: Record<string, Record<string, Record<string, unknown>>> = {}
let writes: Written[] = []
let commits = 0

const at = (path: string): Record<string, Record<string, unknown>> => stored[path] ?? {}

vi.mock('firebase/firestore', () => ({
  doc: (first: unknown, ...segments: string[]) => {
    const prefix = (first as { path?: string })?.path
    return { path: [prefix, ...segments].filter(Boolean).join('/') }
  },
  collection: (first: unknown, ...segments: string[]) => {
    const prefix = (first as { path?: string })?.path
    return { path: [prefix, ...segments].filter(Boolean).join('/') }
  },
  getDoc: async (ref: { path: string }) => {
    const cut = ref.path.lastIndexOf('/')
    const data = at(ref.path.slice(0, cut))[ref.path.slice(cut + 1)]
    return { exists: () => data !== undefined, data: () => data }
  },
  getDocs: async (ref: { path: string }) => ({
    docs: Object.entries(at(ref.path)).map(([id, data]) => ({ id, data: () => data })),
  }),
  query: (ref: unknown) => ref,
  where: () => ({}),
  writeBatch: () => ({
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data })
    },
    update: () => {},
    delete: () => {},
    commit: async () => {
      commits += 1
    },
  }),
}))

vi.mock('../src/lib/firebase', () => ({
  db: {},
  missingConfig: [],
  PROJECT_ID: 'apple-day-live',
  auth: { currentUser: { uid: 'u-admin', displayName: 'An Admin', email: 'a@example.org' } },
}))

const { exportEvent, restoreEvent } = await import('../src/lib/eventTransfer')

const event = {
  id: '2025', name: 'Apple Day 2025', year: 2025, baseLocationId: 'hall',
} as AppleDayEvent

beforeEach(() => {
  writes = []
  commits = 0
  stored = {
    'events/2025/people': { 'p-1': { firstName: 'Alex', section: 'cubs' } },
    'events/2025/assignments': { a1: { personId: 'p-1', locationId: 'braemar' } },
    'events/2025/jars': { j1: { locationId: 'kelmont', amount: 40 } },
    'events/2025/eventLocations': { braemar: { active: true, priority: 1 } },
    locations: {
      braemar: { name: 'Braemar' },
      kelmont: { name: 'Kelmont' },
      hall: { name: 'The hall' },
      unused: { name: 'A shop this year never called on' },
    },
    sections: { cubs: { name: 'Cubs' }, scouts: { name: 'Scouts' } },
    passes: {
      tok1: { personId: 'p-1', eventId: '2025' },
    },
  }
})

describe('what the file carries', () => {
  it('takes every subcollection the event has', async () => {
    const file = await exportEvent(event, 'apple-day-live')
    expect(Object.keys(file.records).sort()).toEqual(
      ['people', 'assignments', 'jars', 'eventLocations'].sort(),
    )
  })

  it('walks the same list a removal does, so nothing is exported that a delete would miss', async () => {
    // Two lists that disagree is how a year comes back short.
    const file = await exportEvent(event, 'apple-day-live')
    for (const name of Object.keys(file.records)) {
      expect(EVENT_SUBCOLLECTIONS, `${name} is not in the removal walk`).toContain(name)
    }
  })

  it('carries the shops the year actually points at', async () => {
    const file = await exportEvent(event, 'apple-day-live')
    // From a shift, from a jar, and the base — three different ways to be referenced.
    expect(Object.keys(file.locations).sort()).toEqual(['braemar', 'hall', 'kelmont'])
  })

  it('leaves the rest of the library alone', async () => {
    /*
      A library holds every shop the group has ever called on, most of them nothing to do
      with this year. Carrying the lot would make a restore quietly rewrite shops the
      destination has its own record of.
    */
    const file = await exportEvent(event, 'apple-day-live')
    expect(Object.keys(file.locations)).not.toContain('unused')
  })

  it('carries only the sections its people are in', async () => {
    const file = await exportEvent(event, 'apple-day-live')
    expect(Object.keys(file.sections)).toEqual(['cubs'])
  })

  it('carries the passes, so links already given out still work', async () => {
    const file = await exportEvent(event, 'apple-day-live')
    expect(Object.keys(file.passes)).toEqual(['tok1'])
  })

  it('says which project it came out of', async () => {
    // So a restore into the wrong one is noticeable before it happens.
    const file = await exportEvent(event, 'apple-day-live')
    expect(file.fromProject).toBe('apple-day-live')
  })
})

describe('putting it back', () => {
  it('writes the shops and sections before the records that name them', async () => {
    /*
      Order, so at no point is there an event on screen whose rows name places the library
      has not heard of.
    */
    const file = await exportEvent(event, 'apple-day-live')
    await restoreEvent(file)

    const order = writes.map((w) => w.path)
    expect(order.indexOf('locations/braemar')).toBeLessThan(order.indexOf('events/2025'))
    expect(order.indexOf('sections/cubs')).toBeLessThan(order.indexOf('events/2025'))
    expect(order.indexOf('events/2025')).toBeLessThan(
      order.indexOf('events/2025/assignments/a1'),
    )
  })

  it('puts every record back where it came from', async () => {
    const file = await exportEvent(event, 'apple-day-live')
    await restoreEvent(file)

    const paths = writes.map((w) => w.path)
    for (const path of [
      'events/2025',
      'events/2025/people/p-1',
      'events/2025/assignments/a1',
      'events/2025/jars/j1',
      'events/2025/eventLocations/braemar',
      'passes/tok1',
    ]) {
      expect(paths, path).toContain(path)
    }
  })

  it('does not write the id into the event document', async () => {
    // It is the document's name, not a field, and writing it back as one leaves a record
    // that disagrees with itself the first time an id is changed.
    const file = await exportEvent(event, 'apple-day-live')
    await restoreEvent(file)

    const written = writes.find((w) => w.path === 'events/2025')!.data
    expect(written.id).toBeUndefined()
    expect(written.name).toBe('Apple Day 2025')
  })

  it('says in the log where it came from', async () => {
    const file = await exportEvent(event, 'apple-day-live')
    await restoreEvent(file)

    const line = writes.find((w) => w.path.startsWith('audit'))!.data
    expect(String(line.summary)).toMatch(/Restored Apple Day 2025/)
    expect(JSON.stringify(line.changes)).toContain('apple-day-live')
  })

  it('commits in batches, so a big year does not exceed the write limit', async () => {
    stored['events/2025/people'] = Object.fromEntries(
      Array.from({ length: 900 }, (_, i) => [`p-${i}`, { firstName: `Youth ${i}` }]),
    )
    const file = await exportEvent(event, 'apple-day-live')
    await restoreEvent(file)

    // Firestore refuses a batch over 500 writes; 900 people cannot be one commit.
    expect(commits).toBeGreaterThan(2)
  })
})
