import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Jar } from '../src/domain/types'

/**
 * A change and the record of it, in one write.
 *
 * The guarantee worth testing is not that a line gets written — it is that it cannot be
 * separated from the change. Two writes would eventually leave a corrected amount with no
 * record of the correction, on a dropped connection at a shop doorway, which is exactly when
 * somebody later wants to know what happened.
 */

interface Written {
  path: string
  data: Record<string, unknown>
}

/**
 * One object per `writeBatch()`, not one shared between them.
 *
 * A mock that hands the same batch to every caller cannot tell "both writes in one batch"
 * from "two batches that happen to both be written" — which is the only property here worth
 * testing. It has to be able to fail.
 */
interface Batch {
  writes: Written[]
  deletes: string[]
  committed: boolean
}

let batches: Batch[] = []

/** What a read-before-write finds. Null means the document is not there. */
let getDocData: Record<string, unknown> | null = null

const makeBatch = (): Batch & {
  set: (ref: { path: string }, data: Record<string, unknown>) => void
  update: (ref: { path: string }, data: Record<string, unknown>) => void
  delete: (ref: { path: string }) => void
  commit: () => Promise<void>
} => {
  const self = {
    writes: [] as Written[],
    deletes: [] as string[],
    committed: false,
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      self.writes.push({ path: ref.path, data })
    },
    update: (ref: { path: string }, data: Record<string, unknown>) => {
      self.writes.push({ path: ref.path, data })
    },
    delete: (ref: { path: string }) => {
      self.deletes.push(ref.path)
    },
    commit: async () => {
      self.committed = true
      await Promise.resolve()
    },
  }
  batches.push(self)
  return self
}

vi.mock('firebase/firestore', () => ({
  writeBatch: () => makeBatch(),
  collection: (_db: unknown, name: string) => ({ path: name }),
  /*
    Paths are built two ways here: doc(db, 'events', id, ...) and doc(collection(db, 'audit'),
    id). Keeping every segment — strings, and anything already carrying a path — is what lets
    a test tell a jar write from an audit write.
  */
  doc: (...args: unknown[]) => ({
    path: args
      .map((a) =>
        typeof a === 'string' ? a : ((a as { path?: string }).path ?? ''),
      )
      .filter(Boolean)
      .join('/'),
  }),
  setDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  getDoc: async () => ({
    exists: () => getDocData !== null,
    data: () => getDocData,
  }),
  getDocs: vi.fn(async () => ({ docs: [] })),
  onSnapshot: () => () => {},
  query: (q: unknown) => q,
  where: () => ({}),
  serverTimestamp: () => 0,
}))

vi.mock('../src/lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u-organizer', displayName: 'An Organizer', email: '' } },
  EVENT_ID: '2026',
}))

const { countJar, deleteJar, reopenJar, setAssignmentStatusMany } = await import(
  '../src/lib/repo',
)

const jar = (over: Partial<Jar> = {}): Jar => ({
  id: 'fri-12', jarNumber: 12, day: 'fri', locationId: 'sobeys', personId: 'y01',
  assignmentId: 'a1', assignmentIds: ['a1'], status: 'counted', issuedAt: 1, issuedBy: 'o',
  amount: 80, method: 'cash', note: '', countedBy: 'o', countedAt: 2,
  ...over,
})

/** The one batch that was actually sent. Anything left uncommitted never happened. */
const committed = (): Batch[] => batches.filter((b) => b.committed)

const auditEntries = (): Record<string, unknown>[] =>
  committed()
    .flatMap((b) => b.writes)
    .filter((w) => w.path.startsWith('audit'))
    .map((w) => w.data)

beforeEach(() => {
  batches = []
  getDocData = null
})

describe('correcting a jar amount', () => {
  it('writes the old number and the new one', async () => {
    await countJar('2026', jar({ amount: 80 }), {
      amount: 180, method: 'cash', locationId: 'sobeys', personId: 'y01', note: '',
    }, 'u-organizer')

    expect(auditEntries()[0]!.changes).toEqual([
      { field: 'amount', from: '80', to: '180' },
    ])
  })

  it('names who typed it', async () => {
    await countJar('2026', jar(), {
      amount: 180, method: 'cash', locationId: 'sobeys', personId: 'y01', note: '',
    }, 'u-organizer')

    const entry = auditEntries()[0]!
    // The uid is the part the rules can vouch for; the name is for whoever reads the log.
    expect(entry.by).toBe('u-organizer')
    expect(entry.byName).toBe('An Organizer')
  })

  it('puts the record in the same batch as the change, committed once', async () => {
    /*
      The guarantee. Not "a line is written" but "a line cannot be left behind": one commit,
      both writes, so either the money and its record land together or neither does.
    */
    await countJar('2026', jar(), {
      amount: 180, method: 'cash', locationId: 'sobeys', personId: 'y01', note: '',
    }, 'u-organizer')

    expect(committed()).toHaveLength(1)
    const only = committed()[0]!
    expect(only.writes.some((w) => w.path.includes('jars'))).toBe(true)
    expect(only.writes.some((w) => w.path.startsWith('audit'))).toBe(true)
  })

  it('says nothing when nothing moved', async () => {
    // Opening a jar and pressing save is not an event, and a log of non-events is unread.
    await countJar('2026', jar({ amount: 80 }), {
      amount: 80, method: 'cash', locationId: 'sobeys', personId: 'y01', note: '',
    }, 'u-organizer')

    expect(auditEntries()).toHaveLength(0)
  })
})

/**
 * A removal that says what was removed.
 *
 * Reported after the first version: "Removed a shift from the board" names no location, no
 * timeslot and no person — and once the document is gone there is no way back to any of it.
 */
describe('taking somebody off the schedule', () => {
  it('keeps who, where and when, on the way out', async () => {
    const { unassign } = await import('../src/lib/repo')
    getDocData = {
      personId: 'y01', locationId: 'sobeys', slotId: 'fri-1700', status: 'planned',
    }

    await unassign('2026', 'a1')

    const entry = auditEntries()[0]!
    const changes = entry.changes as { field: string; from: string; to: string }[]
    expect(changes).toContainEqual({ field: 'personId', from: 'y01', to: '—' })
    expect(changes).toContainEqual({ field: 'locationId', from: 'sobeys', to: '—' })
    expect(changes).toContainEqual({ field: 'slotId', from: 'fri-1700', to: '—' })
  })

  it('removes and records in one commit', async () => {
    const { unassign } = await import('../src/lib/repo')
    getDocData = { personId: 'y01', locationId: 'sobeys', slotId: 'fri-1700' }

    await unassign('2026', 'a1')

    expect(committed()).toHaveLength(1)
    expect(committed()[0]!.deletes).toHaveLength(1)
  })
})

describe('losing money that had been counted', () => {
  it('records what a deleted jar held', async () => {
    await deleteJar('2026', jar({ amount: 180 }))
    expect(auditEntries()[0]!.summary).toContain('$180.00')
    expect(auditEntries()[0]!.action).toBe('deleted')
  })

  it('records an amount being cleared when a jar is reopened', async () => {
    await reopenJar('2026', jar({ amount: 120 }))
    expect(auditEntries()[0]!.changes).toContainEqual({
      field: 'amount', from: '120', to: '—',
    })
  })

  it('deletes and records in one commit', async () => {
    await deleteJar('2026', jar())
    expect(committed()).toHaveLength(1)
    const only = committed()[0]!
    expect(only.deletes).toHaveLength(1)
    expect(only.writes.filter((w) => w.path.startsWith('audit'))).toHaveLength(1)
  })
})

/**
 * Coverage, checked mechanically rather than by memory.
 *
 * The ask was "all create, update and delete actions" — and the way that quietly stops being
 * true is somebody adding a thirty-first mutation next year and not knowing this exists.
 * This fails when they do.
 */
describe('every way the app changes something', () => {
  /*
    Every module that writes, not just the big one.

    `repo.ts` was the whole of it for a long time, so scanning that file alone was the same
    as scanning everything. It stopped being true the moment a feature grew its own
    repository — and a coverage check with a blind spot is worse than none, because it reads
    as a guarantee.
  */
  const SCANNED = ['src/lib/repo.ts', 'src/lib/reminders.ts']

  /*
    Written deliberately without a line of their own, and why.

    Keyed by file and name so an exemption cannot drift onto a different function that
    happens to share a name later.
  */
  const NOT_AUDITED: Record<string, string> = {
    // Derived state, written several times a day by whichever screen holds the schedule.
    // None of them are decisions, and a log full of them is one nobody reads.
    'src/lib/repo.ts:recordPublishFingerprint': 'derived state, not a decision',
    /*
      Same reasoning. A shop's position is looked up from its address, and the address is
      what carries a name on the log — sixteen lines saying a coordinate appeared would bury
      a day's real changes to answer a question nobody asks.
    */
    'src/lib/repo.ts:saveLocationPosition': 'derived from the address, not a decision',
    // Written by a volunteer, who has no account — the rules will not let them file an
    // entry, and the request document is itself the record of what they asked for.
    'src/lib/repo.ts:requestSwap': 'written by somebody with no account',
    /*
      The reminder ledger: one row per youth per message, written as the run goes.

      A line each would be eighteen entries saying the same thing on a screen read twice a
      year. `recordSendInLog` writes the one entry that covers the send, and the ledger is
      the per-person record — which is also the thing that has to be readable to stop a
      second click sending a second copy.
    */
    'src/lib/reminders.ts:recordSent': 'covered by the single entry recordSendInLog writes',
    // Reads only — it asks the ledger who has already been told. Nothing to record.
    'src/lib/reminders.ts:alreadySent': 'reads the ledger, changes nothing',
    // Counts what an event holds, so somebody can be told before they lose it. The removal
    // itself is \`removeEvent\`, and that does write a line naming everything that went.
    'src/lib/repo.ts:tallyEvent': 'counts before a removal, changes nothing',
  }

  const AUDITS = /recordInBatch|auditedSet|auditedDelete|auditedBatch/

  /** Every exported async function in a scanned file, with its body. */
  const scan = (source: string): { name: string; body: string }[] => {
    const found: { name: string; body: string }[] = []
    for (const match of source.matchAll(/^export async function (\w+)/gm)) {
      const start = match.index!
      const end = source.indexOf('\n}\n', start)
      found.push({ name: match[1]!, body: source.slice(start, end === -1 ? undefined : end) })
    }
    return found
  }

  it('writes a line, or is on the list of the ones that deliberately do not', async () => {
    /*
      Every exported async function, not only the ones that look like writes.

      Deciding first whether something writes needs a list of the ways it might, and a
      function that writes through a helper nobody thought to list would slip past — which
      is the exact failure this test exists to prevent. Erring towards flagging costs a line
      of exemption for the handful that only read.
    */
    const { readFileSync } = await import('node:fs')

    const unaudited: string[] = []
    for (const file of SCANNED) {
      for (const { name, body } of scan(readFileSync(file, 'utf8'))) {
        if (AUDITS.test(body)) continue
        if (`${file}:${name}` in NOT_AUDITED) continue
        unaudited.push(`${file}:${name}`)
      }
    }

    expect(unaudited).toEqual([])
  })

  it('still looks at the functions it is supposed to be looking at', async () => {
    /*
      The check above passes trivially if the pattern stops matching — a rename, a change of
      export style, a file moved. This asserts it is still finding what it knows about, so a
      scanner that has quietly stopped scanning fails rather than reassuring.
    */
    const { readFileSync } = await import('node:fs')
    const found = SCANNED.flatMap((file) =>
      scan(readFileSync(file, 'utf8')).map(({ name }) => `${file}:${name}`),
    )

    for (const exempt of Object.keys(NOT_AUDITED)) {
      expect(found, `${exempt} is exempt but no longer found`).toContain(exempt)
    }
    // The big one still has its thirty-odd mutations, not zero.
    expect(found.filter((f) => f.startsWith('src/lib/repo.ts')).length).toBeGreaterThan(20)
  })
})

describe('taking a check-in back', () => {
  /*
    Where somebody is only means anything once they have arrived.

    A check-in taken back used to leave "out collecting" behind it, which put a shift on the
    record as expected *and* out — a pair the day-of screen had no state for and so offered
    no button for, leaving a row that could only ever be brought back. The screen now reads
    such a pair as what it means, but the pair should not be written at all: it is read by
    more than one screen, and it is simply false.
  */
  const patch = (): Record<string, unknown> =>
    committed()[0]!.writes.find((w) => w.path.includes('assignments'))!.data

  it('brings the whereabouts home', async () => {
    await setAssignmentStatusMany('2026', ['a1'], 'confirmed', 1000)
    expect(patch()).toMatchObject({ whereabouts: 'here', checkedOutAt: null })
  })

  it('does the same when they are marked absent', async () => {
    await setAssignmentStatusMany('2026', ['a1'], 'noShow', 1000)
    expect(patch()).toMatchObject({ whereabouts: 'here', checkedInAt: null })
  })

  it('leaves it alone when they are checking in', async () => {
    // Checking somebody in says nothing about where they are; that is the next decision.
    await setAssignmentStatusMany('2026', ['a1'], 'checkedIn', 1000)
    expect(patch()).not.toHaveProperty('whereabouts')
  })
})
