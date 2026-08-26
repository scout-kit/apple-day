import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { RULES_PROJECT_ID } from './projectId'

/**
 * Issuing a jar, against the real Firestore emulator.
 *
 * This is a two-document atomic write — the jar, plus the shift it went out on moving to
 * `out` — and it is the write the whole day-of screen hangs off: the "out" headcount and
 * the "out with no jar" warning both read the *assignment*, not the jar. So the question
 * this file answers is not "did the jar save" but "did the person move".
 *
 * On the emulator rather than a mock, because both plausible failures are invisible to a
 * mock: rules evaluate each document in a batch separately (so a rule that forbids the
 * assignment half silently loses the status change along with the jar), and `batch.update`
 * on a document that does not exist rejects the entire commit.
 */

const PROJECT_ID = RULES_PROJECT_ID
const EVENT = '2026'
const ADMIN_UID = 'admin-uid'
const ASSIGNMENT = 'fri-1700_sobeys_p-one'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})

afterAll(async () => {
  await testEnv?.cleanup()
})

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'admins', ADMIN_UID), { addedAt: 0 })
    await setDoc(doc(db, 'events', EVENT), { year: 2026, name: 'Apple Day 2026' })
  })
})

const admin = () => testEnv.authenticatedContext(ADMIN_UID).firestore()

type Db = ReturnType<typeof admin>

async function checkIn(db: Db): Promise<void> {
  await setDoc(doc(db, 'events', EVENT, 'assignments', ASSIGNMENT), {
    slotId: 'fri-1700',
    locationId: 'sobeys',
    personId: 'p-one',
    status: 'checkedIn',
    whereabouts: 'here',
    checkedInAt: 1,
    checkedOutAt: 0,
  })
}

/** The production write from `issueJar`, document for document. */
async function issueJar(db: Db, jarId: string): Promise<void> {
  const batch = writeBatch(db)
  batch.set(doc(db, 'events', EVENT, 'jars', jarId), {
    jarNumber: 1,
    day: 'fri',
    locationId: 'sobeys',
    personId: 'p-one',
    assignmentId: ASSIGNMENT, assignmentIds: [ASSIGNMENT],
    status: 'out',
    issuedAt: 2,
    issuedBy: ADMIN_UID,
    amount: null,
    method: 'cash',
    note: '',
    countedBy: '',
    countedAt: 0,
  })
  batch.update(doc(db, 'events', EVENT, 'assignments', ASSIGNMENT), {
    whereabouts: 'out',
  })
  await batch.commit()
}

const shiftOf = async (db: Db): Promise<Record<string, unknown>> =>
  (await getDoc(doc(db, 'events', EVENT, 'assignments', ASSIGNMENT))).data() ?? {}

/** The production write from `countJar`, for the last jar of a shift. */
async function countJar(db: Db, jarId: string): Promise<void> {
  const batch = writeBatch(db)
  batch.set(
    doc(db, 'events', EVENT, 'jars', jarId),
    { status: 'counted', amount: 41.5, method: 'cash', countedBy: ADMIN_UID, countedAt: 9 },
    { merge: true },
  )
  batch.update(doc(db, 'events', EVENT, 'assignments', ASSIGNMENT), {
    whereabouts: 'back',
    checkedOutAt: 9,
  })
  await batch.commit()
}

describe('checking in, then issuing a jar', () => {
  it('sends them out without disturbing the check-in', async () => {
    const db = admin()
    await checkIn(db)
    expect((await shiftOf(db)).whereabouts).toBe('here')

    await assertSucceeds(issueJar(db, 'fri-jar-1-abc'))

    const shift = await shiftOf(db)
    // The headcount and the no-jar warning read whereabouts.
    expect(shift.whereabouts).toBe('out')
    // And attendance is untouched — writing it here is what used to erase the check-in.
    expect(shift.status).toBe('checkedIn')
    expect(shift.checkedInAt).toBe(1)
  })

  it('lands both halves of the write, or neither', async () => {
    const db = admin()
    await checkIn(db)
    await issueJar(db, 'fri-jar-1-abc')

    const jar = await getDoc(doc(db, 'events', EVENT, 'jars', 'fri-jar-1-abc'))
    expect(jar.exists()).toBe(true)
    expect(jar.data()!.assignmentId).toBe(ASSIGNMENT)
    expect((await shiftOf(db)).whereabouts).toBe('out')
  })

  it('keeps them out when a second jar goes out on the same shift', async () => {
    const db = admin()
    await checkIn(db)
    await issueJar(db, 'fri-jar-1-abc')
    await issueJar(db, 'fri-jar-2-def')

    expect((await shiftOf(db)).whereabouts).toBe('out')
  })

  it('brings them back when the jar is counted, still without touching attendance', async () => {
    const db = admin()
    await checkIn(db)
    await issueJar(db, 'fri-jar-1-abc')
    await assertSucceeds(countJar(db, 'fri-jar-1-abc'))

    const shift = await shiftOf(db)
    expect(shift.whereabouts).toBe('back')
    expect(shift.status).toBe('checkedIn')
  })

  it('refuses a whereabouts nothing knows how to render', async () => {
    // The two states are separate fields; both are checked. A typo would park the shift
    // somewhere the board cannot draw, and that person would drop off it.
    const db = admin()
    await checkIn(db)

    await assertFails(
      updateDoc(doc(db, 'events', EVENT, 'assignments', ASSIGNMENT), {
        whereabouts: 'somewhere-else',
      }),
    )
  })

  it('is closed to somebody signed in with no access', async () => {
    const outsider = testEnv.authenticatedContext('stranger-uid').firestore()
    await assertFails(
      updateDoc(doc(outsider, 'events', EVENT, 'assignments', ASSIGNMENT), {
        whereabouts: 'out',
      }),
    )
  })
})

describe('a jar carried through a stretch of shifts', () => {
  const SECOND = 'fri-1800_sobeys_p-one'

  async function twoShifts(db: Db): Promise<void> {
    for (const [id, slotId] of [[ASSIGNMENT, 'fri-1700'], [SECOND, 'fri-1800']]) {
      await setDoc(doc(db, 'events', EVENT, 'assignments', id!), {
        slotId,
        locationId: 'sobeys',
        personId: 'p-one',
        status: 'checkedIn',
        whereabouts: 'here',
        checkedInAt: 1,
        checkedOutAt: 0,
      })
    }
  }

  /** `issueJar`, for a jar covering both shifts. */
  async function issueForBoth(db: Db, jarId: string): Promise<void> {
    const batch = writeBatch(db)
    batch.set(doc(db, 'events', EVENT, 'jars', jarId), {
      jarNumber: 1,
      day: 'fri',
      locationId: 'sobeys',
      personId: 'p-one',
      assignmentId: ASSIGNMENT,
      assignmentIds: [ASSIGNMENT, SECOND],
      status: 'out',
      issuedAt: 2,
      issuedBy: ADMIN_UID,
      amount: null,
      method: 'cash',
      note: '',
      countedBy: '',
      countedAt: 0,
    })
    for (const id of [ASSIGNMENT, SECOND]) {
      batch.update(doc(db, 'events', EVENT, 'assignments', id), { whereabouts: 'out' })
    }
    await batch.commit()
  }

  /** `countJar`, which brings back every shift the jar covered. */
  async function countForBoth(db: Db, jarId: string): Promise<void> {
    const batch = writeBatch(db)
    batch.set(
      doc(db, 'events', EVENT, 'jars', jarId),
      { status: 'counted', amount: 200, method: 'cash', countedBy: ADMIN_UID, countedAt: 9 },
      { merge: true },
    )
    for (const id of [ASSIGNMENT, SECOND]) {
      batch.update(doc(db, 'events', EVENT, 'assignments', id), {
        whereabouts: 'back',
        checkedOutAt: 9,
      })
    }
    await batch.commit()
  }

  const whereabouts = async (db: Db, id: string): Promise<unknown> =>
    (await getDoc(doc(db, 'events', EVENT, 'assignments', id))).data()?.whereabouts

  it('sends every hour of the stretch out', async () => {
    const db = admin()
    await twoShifts(db)
    await assertSucceeds(issueForBoth(db, 'fri-jar-1-abc'))

    expect(await whereabouts(db, ASSIGNMENT)).toBe('out')
    expect(await whereabouts(db, SECOND)).toBe('out')
  })

  it('brings every hour of the stretch back when it is counted', async () => {
    // The reported bug: the money split correctly across the hours, but only the first
    // shift came back, so the youth stayed on the board as out collecting.
    const db = admin()
    await twoShifts(db)
    await issueForBoth(db, 'fri-jar-1-abc')
    await assertSucceeds(countForBoth(db, 'fri-jar-1-abc'))

    expect(await whereabouts(db, ASSIGNMENT)).toBe('back')
    expect(await whereabouts(db, SECOND)).toBe('back')
  })

  it('accepts the list of shifts a jar covered', async () => {
    const db = admin()
    await twoShifts(db)
    await issueForBoth(db, 'fri-jar-1-abc')

    const jar = await getDoc(doc(db, 'events', EVENT, 'jars', 'fri-jar-1-abc'))
    expect(jar.data()!.assignmentIds).toEqual([ASSIGNMENT, SECOND])
  })

  it('refuses a list long enough to smear one jar across the whole evening', async () => {
    const db = admin()
    await twoShifts(db)
    await assertFails(
      setDoc(doc(db, 'events', EVENT, 'jars', 'fri-jar-9-zzz'), {
        jarNumber: 9,
        day: 'fri',
        locationId: 'sobeys',
        personId: 'p-one',
        assignmentId: ASSIGNMENT,
        assignmentIds: Array.from({ length: 25 }, (_, i) => `shift-${i}`),
        status: 'out',
        issuedAt: 2,
        issuedBy: ADMIN_UID,
        amount: null,
        method: 'cash',
        note: '',
        countedBy: '',
        countedAt: 0,
      }),
    )
  })
})
