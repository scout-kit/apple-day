import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SECTIONS } from '../src/domain/sections'

/**
 * The first change a new group makes to its sections.
 *
 * Until they configure their own, every screen shows the built-in set. It is a fallback for
 * an empty collection rather than data, which makes the first edit destructive in a way
 * nothing on screen suggests: save one renamed section, the collection stops being empty, the
 * fallback stops applying, and the other four vanish along with the figures grouped by them.
 *
 * So the first change of any kind writes the whole set first.
 */

interface Written {
  path: string
  data: Record<string, unknown>
}

let writes: Written[] = []
let deletes: string[] = []
let commits = 0
/** What the sections collection already holds. Empty is the case under test. */
let existing: string[] = []

const makeBatch = () => ({
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
})

vi.mock('firebase/firestore', () => ({
  /*
    `doc()` is called both ways here: with `db` and a full path, and with a collection
    reference and an id. Ignoring the first argument loses the collection, and every audit
    entry lands at a bare id — which reads as "nothing was logged".
  */
  doc: (first: unknown, ...segments: string[]) => {
    const prefix = (first as { path?: string })?.path
    return { path: [prefix, ...segments].filter(Boolean).join('/') }
  },
  collection: (first: unknown, ...segments: string[]) => {
    const prefix = (first as { path?: string })?.path
    return { path: [prefix, ...segments].filter(Boolean).join('/') }
  },
  getDocs: async () => ({ docs: existing.map((id) => ({ id })) }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  writeBatch: () => makeBatch(),
  setDoc: async () => undefined,
  deleteDoc: async () => undefined,
  updateDoc: async () => undefined,
  onSnapshot: () => () => {},
  query: (ref: unknown) => ref,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  serverTimestamp: () => 0,
}))

vi.mock('../src/lib/firebase', () => ({
  missingConfig: [],
  db: {},
  auth: { currentUser: { uid: 'u-admin', displayName: 'An Admin', email: 'a@example.org' } },
}))

const { saveSection, deleteSection, reorderSections } = await import('../src/lib/repo')

const sectionWrites = (): Written[] => writes.filter((w) => w.path.startsWith('sections/'))
const idsWritten = (): string[] => sectionWrites().map((w) => w.path.split('/')[1]!)

beforeEach(() => {
  writes = []
  deletes = []
  commits = 0
  existing = []
})

describe('editing one while none are stored', () => {
  it('writes all of them, not just the one edited', async () => {
    await saveSection({ ...DEFAULT_SECTIONS[1]!, name: 'Wolf Cubs' })

    for (const section of DEFAULT_SECTIONS) {
      expect(idsWritten(), `${section.id} was written`).toContain(section.id)
    }
  })

  it('keeps the edit, rather than the default it was made from', async () => {
    await saveSection({ ...DEFAULT_SECTIONS[1]!, name: 'Wolf Cubs' })

    const edited = sectionWrites().filter((w) => w.path === `sections/${DEFAULT_SECTIONS[1]!.id}`)
    // Adopted first, then edited: the last write to that document is the one that stands.
    expect(edited.at(-1)!.data.name).toBe('Wolf Cubs')
  })

  it('says so in the log, because five sections appearing at once needs explaining', async () => {
    await saveSection({ ...DEFAULT_SECTIONS[1]!, name: 'Wolf Cubs' })

    const audit = writes.filter((w) => w.path.startsWith('audit'))
    expect(audit.some((w) => /built-in sections/i.test(String(w.data.summary)))).toBe(true)
  })

  it('carries every section forward, including the ones nobody touched', async () => {
    // The point of the whole thing: Scouters must still exist afterwards.
    await saveSection({ ...DEFAULT_SECTIONS[0]!, name: 'Renamed' })
    const names = sectionWrites().map((w) => w.data.name)
    expect(names).toContain(DEFAULT_SECTIONS.at(-1)!.name)
  })
})

describe('the other two ways to change them', () => {
  it('reordering writes the sections first, so it does not leave orders with no names', async () => {
    /*
      Setting `order` on ids that do not exist creates documents holding an order and nothing
      else, which read back as a section named after its own id.
    */
    await reorderSections(DEFAULT_SECTIONS.map((s) => s.id).reverse())
    expect(sectionWrites().some((w) => typeof w.data.name === 'string')).toBe(true)
  })

  it('deleting one makes the rest real, so it does not come straight back', async () => {
    // Deleting from an empty collection succeeds and changes nothing; the fallback then
    // renders the section again, and it looks like the delete was ignored.
    await deleteSection(DEFAULT_SECTIONS[0]!.id)

    expect(idsWritten()).toContain(DEFAULT_SECTIONS[1]!.id)
    expect(deletes.some((path) => path === `sections/${DEFAULT_SECTIONS[0]!.id}`)).toBe(true)
  })
})

describe('once they are stored', () => {
  beforeEach(() => {
    existing = DEFAULT_SECTIONS.map((s) => s.id)
  })

  it('writes only what was edited', async () => {
    await saveSection({ ...DEFAULT_SECTIONS[1]!, name: 'Wolf Cubs' })
    expect(idsWritten()).toEqual([DEFAULT_SECTIONS[1]!.id])
  })

  it('does not put back a section the group deleted', async () => {
    /*
      The reason this adopts them once rather than merging defaults in on every read: a group
      that removes a section it does not run means it, and a fallback that keeps topping the
      list back up would never let them.
    */
    existing = DEFAULT_SECTIONS.filter((s) => s.id !== 'venturers').map((s) => s.id)
    await saveSection({ ...DEFAULT_SECTIONS[0]!, name: 'Renamed' })
    expect(idsWritten()).not.toContain('venturers')
  })
})
