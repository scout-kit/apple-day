import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppleDayEvent, Person } from '../src/domain/types'

/**
 * The writing half of finishing a year.
 *
 * Passes deleted, parents' contact details blanked, the year stamped, one line in the log.
 * The order matters: a pass needs no account to read, so it is the exposure worth closing
 * first, and a run that fails part-way should have done the important half.
 */

interface Written {
  path: string
  data: Record<string, unknown>
  merge: boolean
}

let writes: Written[] = []
let deletes: string[] = []
let commits = 0

vi.mock('firebase/firestore', () => ({
  doc: (first: unknown, ...segments: string[]) => {
    const prefix = (first as { path?: string })?.path
    return { path: [prefix, ...segments].filter(Boolean).join('/') }
  },
  collection: (first: unknown, ...segments: string[]) => {
    const prefix = (first as { path?: string })?.path
    return { path: [prefix, ...segments].filter(Boolean).join('/') }
  },
  getDocs: async () => ({ docs: [] }),
  query: (ref: unknown) => ref,
  where: () => ({}),
  writeBatch: () => ({
    set: (ref: { path: string }, data: Record<string, unknown>, options?: { merge?: boolean }) => {
      writes.push({ path: ref.path, data, merge: Boolean(options?.merge) })
    },
    update: () => {},
    delete: (ref: { path: string }) => {
      deletes.push(ref.path)
    },
    commit: async () => {
      commits += 1
    },
  }),
}))

vi.mock('../src/lib/firebase', () => ({
  db: {},
  missingConfig: [],
  auth: { currentUser: { uid: 'u-admin', displayName: 'An Admin', email: 'a@example.org' } },
}))

const { finishEvent, reopenEvent } = await import('../src/lib/closing')

const person = (id: string, over: Partial<Person> = {}): Person => ({
  id, firstName: 'Calvin', lastName: 'Osei', section: 'cubs',
  parentName: 'Ada Osei', parentEmail: 'ada@example.org', parentPhone: '519-555-0100',
  pairWithPersonId: null,
  ...over,
})

const event = { id: '2026', name: 'Apple Day 2026', finishedAt: null } as AppleDayEvent

const audit = (): Written | undefined => writes.find((w) => w.path.startsWith('audit/'))

beforeEach(() => {
  writes = []
  deletes = []
  commits = 0
})

describe('finishing a year', () => {
  it('deletes every pass', async () => {
    await finishEvent(event, [], ['tok-a', 'tok-b'])
    expect(deletes).toEqual(['passes/tok-a', 'passes/tok-b'])
  })

  it('blanks the contact fields, and writes every one of them', async () => {
    /*
      Explicitly empty rather than omitted: a merge does not remove what it is not given, so
      leaving one out would leave that field exactly where it was.
    */
    await finishEvent(event, [person('p1')], [])
    const written = writes.find((w) => w.path === 'events/2026/people/p1')!
    expect(written.data).toEqual({ parentName: '', parentEmail: '', parentPhone: '' })
    expect(written.merge).toBe(true)
  })

  it('leaves the youth’s own name where it is', async () => {
    // Merged, so nothing outside those three fields is touched — the surname included,
    // which is what tells this year's Calvin from the last three.
    await finishEvent(event, [person('p1')], [])
    const written = writes.find((w) => w.path === 'events/2026/people/p1')!
    expect(Object.keys(written.data)).not.toContain('firstName')
    expect(Object.keys(written.data)).not.toContain('lastName')
    expect(Object.keys(written.data)).not.toContain('section')
  })

  it('does not write to somebody whose details are already gone', async () => {
    // A second finish should be a no-op rather than sixty pointless writes.
    await finishEvent(event, [person('p1', { parentName: '', parentEmail: '', parentPhone: '' })], [])
    expect(writes.some((w) => w.path.startsWith('events/2026/people/'))).toBe(false)
  })

  it('stamps the year', async () => {
    await finishEvent(event, [], [])
    const stamp = writes.find((w) => w.path === 'events/2026')!
    expect(typeof stamp.data.finishedAt).toBe('number')
    expect(stamp.data.finishedAt as number).toBeGreaterThan(0)
    // Merged, or it would erase the event it is stamping.
    expect(stamp.merge).toBe(true)
  })

  it('reports what it cleared', async () => {
    const cost = await finishEvent(event, [person('p1'), person('p2')], ['tok-a'])
    expect(cost).toEqual({ passes: 1, contacts: 2 })
  })

  it('writes one line in the log, with the counts on it', async () => {
    /*
      Changes rather than a bare summary: an `updated` entry carrying none is dropped by
      `worthRecording`, and this is the last entry that will ever say how many families'
      details the year held.
    */
    await finishEvent(event, [person('p1')], ['tok-a', 'tok-b'])
    const entry = audit()!
    expect(entry.data.summary).toBe('Finished Apple Day 2026')
    expect(entry.data.changes).toEqual([
      { field: 'links deleted', from: '2', to: '0' },
      { field: 'contact details cleared', from: '1', to: '0' },
    ])
  })

  it('commits in batches, so a big year does not exceed the write limit', async () => {
    // Firestore takes 500 writes a batch. 300 passes and 300 people is 600 plus the stamp.
    const many = Array.from({ length: 300 }, (_, i) => person(`p${i}`))
    await finishEvent(event, many, Array.from({ length: 300 }, (_, i) => `tok-${i}`))
    expect(deletes).toHaveLength(300)
    expect(commits).toBeGreaterThan(1)
  })

  it('records the finish even for a year holding nothing', async () => {
    await finishEvent(event, [], [])
    expect(audit()).toBeTruthy()
    expect(writes.some((w) => w.path === 'events/2026')).toBe(true)
  })
})

describe('reopening one', () => {
  it('clears the stamp with a zero, since a merge cannot remove a field', async () => {
    await reopenEvent({ ...event, finishedAt: 1_700_000_000_000 })
    const stamp = writes.find((w) => w.path === 'events/2026')!
    expect(stamp.data).toEqual({ finishedAt: 0 })
    expect(stamp.merge).toBe(true)
  })

  it('puts nothing else back, and says so in the log', async () => {
    // The passes stay deleted and the contact details stay cleared. Only publishing returns.
    await reopenEvent({ ...event, finishedAt: 1_700_000_000_000 })
    expect(deletes).toEqual([])
    expect(writes.filter((w) => w.path.startsWith('events/2026/people/'))).toEqual([])
    expect(audit()!.data.summary).toBe('Reopened Apple Day 2026')
  })
})
