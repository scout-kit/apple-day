import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unpublishCaution, unpublishCost } from '../src/domain/unpublish'
import type { Assignment } from '../src/domain/types'

/**
 * Taking a published schedule back.
 *
 * Publishing is the one thing here that reaches outside the app: it puts a link in an inbox,
 * and nothing in this app can reach into one. So withdrawing it is not the inverse of a save
 * — the documents go, every link already sent dies with them, and publishing again mints new
 * tokens because the reuse it does is reading passes that are no longer there.
 *
 * Worth having anyway: a schedule published from the wrong draft is otherwise permanent.
 */

interface Written {
  path: string
  data?: Record<string, unknown>
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
  deleteField: () => ({ __deleted: true }),
  writeBatch: () => ({
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data })
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
  auth: { currentUser: { uid: 'u-admin', displayName: 'An Admin', email: '' } },
}))

const { unpublish } = await import('../src/lib/publish')

const shift = (over: Partial<Assignment>): Assignment => ({
  id: 'a1', slotId: 'sat-0900', locationId: 'braemar', personId: 'p1',
  status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
  ...over,
})

beforeEach(() => {
  writes = []
  deletes = []
  commits = 0
})

describe('what unpublishing costs', () => {
  it('counts the links that stop working', () => {
    const cost = unpublishCost([{ personId: 'p1' }, { personId: 'p2' }], [])
    expect(cost).toEqual({ passes: 2, arrived: 0 })
  })

  it('counts a volunteer once however many shifts they checked in for', () => {
    const cost = unpublishCost(
      [{ personId: 'p1' }],
      [
        shift({ id: 'a1', status: 'checkedIn' }),
        shift({ id: 'a2', slotId: 'sat-1000', status: 'checkedIn' }),
      ],
    )
    expect(cost.arrived).toBe(1)
  })

  it('ignores an arrival by somebody with no pass', () => {
    // Their link is not among the ones about to be broken, so it is not part of the cost.
    const cost = unpublishCost([{ personId: 'p1' }], [shift({ personId: 'p9', status: 'checkedIn' })])
    expect(cost.arrived).toBe(0)
  })

  it('ignores a shift that was swapped away', () => {
    const cost = unpublishCost([{ personId: 'p1' }], [shift({ status: 'swapped' })])
    expect(cost.arrived).toBe(0)
  })
})

describe('the warning before it happens', () => {
  it('says nothing when nobody has arrived', () => {
    expect(unpublishCaution({ passes: 12, arrived: 0 })).toBeNull()
  })

  it('says nothing when there was nothing published', () => {
    expect(unpublishCaution({ passes: 0, arrived: 0 })).toBeNull()
  })

  it('names how many are mid-shift, in the singular where it is one', () => {
    /*
      The number that decides whether this is a correction or an accident: a pass is what a
      youth at a shop door reads to find out where they are and who to ring.
    */
    expect(unpublishCaution({ passes: 12, arrived: 1 })).toContain('1 volunteer has')
    expect(unpublishCaution({ passes: 12, arrived: 4 })).toContain('4 volunteers have')
  })

  it('never refuses, whatever the cost', () => {
    // A rule that decided this for an organizer would be worked around by hand instead.
    expect(unpublishCaution({ passes: 300, arrived: 300 })).toBeTypeOf('string')
  })
})

describe('unpublishing', () => {
  it('deletes every pass it was given', async () => {
    await unpublish('2026', ['tok-a', 'tok-b'])
    expect(deletes).toEqual(['passes/tok-a', 'passes/tok-b'])
  })

  it('puts the event back to never published', async () => {
    await unpublish('2026', ['tok-a'])
    const state = writes.find((w) => w.path === 'events/2026/meta/publish')!
    expect(state.data!.publishedAt).toBe(0)
    // And the old hash goes, or a later comparison would call an unpublished event current.
    expect(state.data!.fingerprint).toEqual({ __deleted: true })
  })

  it('leaves the board’s own hash alone', async () => {
    /*
      It describes the schedule as it stands, which unpublishing does not touch. Clearing it
      would make the next publish look stale the moment it landed.
    */
    await unpublish('2026', ['tok-a'])
    const state = writes.find((w) => w.path === 'events/2026/meta/publish')!
    expect(Object.keys(state.data!)).not.toContain('currentFingerprint')
  })

  it('writes a line in the log saying what went', async () => {
    await unpublish('2026', ['tok-a', 'tok-b'])
    const entry = writes.find((w) => w.path.startsWith('audit/'))!
    expect(entry.data!.summary).toBe('Unpublished the schedule, withdrawing 2 passes')
  })

  it('says a single pass in the singular', async () => {
    await unpublish('2026', ['tok-a'])
    const entry = writes.find((w) => w.path.startsWith('audit/'))!
    expect(entry.data!.summary).toBe('Unpublished the schedule, withdrawing 1 pass')
  })

  it('commits in batches, so a big year does not exceed the write limit', async () => {
    // Firestore takes 500 writes a batch; this stops well short and then finishes the rest.
    await unpublish('2026', Array.from({ length: 460 }, (_, i) => `tok-${i}`))
    expect(deletes).toHaveLength(460)
    expect(commits).toBe(2)
  })

  it('still records the withdrawal when there was nothing to delete', async () => {
    await unpublish('2026', [])
    expect(deletes).toEqual([])
    expect(writes.some((w) => w.path === 'events/2026/meta/publish')).toBe(true)
  })
})
