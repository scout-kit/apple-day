import { readFileSync } from 'node:fs'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { RULES_PROJECT_ID } from './projectId'
import { DAYS, completeAvailability } from '../../src/domain/types'

/**
 * Availability writes, against the real Firestore emulator.
 *
 * This runs on the emulator rather than a mock on purpose: the bug it covers was a
 * *semantic* one. `setDoc` with `{merge: true}` does not delete fields it is not given,
 * and a nested map merges key by key — so omitting a cleared day left the old hours in
 * place and clearing was silently a no-op. Only the real implementation proves that.
 */

const PROJECT_ID = RULES_PROJECT_ID
const EVENT = '2026'
const PERSON = 'p-alpha-one-cubs'
const SIGNUP = `su-${PERSON}`

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
})

/**
 * The production write, over the test client's db handle.
 *
 * The document shape comes from the same `completeAvailability` the app uses — the point
 * is to test that function's output against real Firestore merge semantics, not a
 * paraphrase of it.
 */
async function saveAvailability(
  db: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>,
  availability: Parameters<typeof completeAvailability>[0],
): Promise<void> {
  await setDoc(
    doc(db, 'events', EVENT, 'signups', SIGNUP),
    {
      personId: PERSON,
      availability: completeAvailability(availability),
      updatedAt: 1,
    },
    { merge: true },
  )
}

async function read(
  db: ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>,
): Promise<Record<string, unknown>> {
  const snap = await getDoc(doc(db, 'events', EVENT, 'signups', SIGNUP))
  return (snap.data() ?? {}) as Record<string, unknown>
}

describe('clearing availability actually clears it', () => {
  it('removes a single day', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()

      await saveAvailability(db, { fri: ['fri-1700', 'fri-1800'], sat: ['sat-0900'] })
      let data = await read(db)
      expect((data.availability as Record<string, string[]>).fri).toHaveLength(2)

      // Clear Friday only.
      await saveAvailability(db, { sat: ['sat-0900'] })
      data = await read(db)
      const availability = data.availability as Record<string, string[]>

      // This is the assertion that failed before: the old Friday hours survived the merge.
      expect(availability.fri).toEqual([])
      expect(availability.sat).toEqual(['sat-0900'])
    })
  })

  it('removes every day', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()

      await saveAvailability(db, { fri: ['fri-1700'], sat: ['sat-0900', 'sat-1000'] })
      await saveAvailability(db, {})

      const availability = (await read(db)).availability as Record<string, string[]>
      for (const day of DAYS) expect(availability[day]).toEqual([])
    })
  })

  it('clears a day the event no longer runs', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()

      // Availability stored while the event still ran on Sunday.
      await saveAvailability(db, { sun: ['sun-1000'], sat: ['sat-0900'] })
      // Sunday is dropped from the event, so it is no longer passed.
      await saveAvailability(db, { sat: ['sat-0900'] })

      const availability = (await read(db)).availability as Record<string, string[]>
      expect(availability.sun).toEqual([])
    })
  })

  it('keeps the fields an import set, which is why merge is used at all', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()

      await setDoc(doc(db, 'events', EVENT, 'signups', SIGNUP), {
        personId: PERSON,
        availability: { fri: ['fri-1700'] },
        attendingWithYouth: true,
        notes: 'near a bathroom please',
        sourceRow: 42,
        importedAt: 99,
      })

      await saveAvailability(db, {})
      const data = await read(db)

      expect(data.notes).toBe('near a bathroom please')
      expect(data.attendingWithYouth).toBe(true)
      expect(data.sourceRow).toBe(42)
      expect((data.availability as Record<string, string[]>).fri).toEqual([])
    })
  })

  it('round-trips through the reader as no availability at all', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await saveAvailability(db, { fri: ['fri-1700'] })
      await saveAvailability(db, {})

      const raw = (await read(db)).availability as Record<string, string[]>
      // The app's converter drops empty arrays, so downstream this reads as "offered
      // nothing" rather than "offered zero hours on seven days".
      const asRead = Object.fromEntries(
        Object.entries(raw).filter(([, slots]) => slots.length > 0),
      )
      expect(asRead).toEqual({})
    })
  })
})

describe('a location marked closed for a day stays closed', () => {
  it('survives the write and read round trip', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()

      // What the library editor writes: every day explicit, null where closed. Sunday
      // through Thursday are closed decisions; Friday has hours.
      await setDoc(
        doc(db, 'locations', 'jacks'),
        {
          name: "Jack's",
          openHours: {
            sun: null, mon: null, tue: null, wed: null, thu: null,
            fri: { openMin: 17 * 60, closeMin: 21 * 60 },
            sat: null,
          },
        },
        { merge: true },
      )

      const snap = await getDoc(doc(db, 'locations', 'jacks'))
      const openHours = (snap.data()!.openHours ?? {}) as Record<string, unknown>

      // The null must be present as a key, not missing: absent means "nobody said", and
      // the board would offer to schedule there.
      expect(Object.prototype.hasOwnProperty.call(openHours, 'sat')).toBe(true)
      expect(openHours.sat).toBeNull()
      expect(openHours.fri).toEqual({ openMin: 1020, closeMin: 1260 })
    })
  })

  it('is not silently reopened by a later merge that omits it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()

      await setDoc(doc(db, 'locations', 'jacks'), {
        name: "Jack's",
        openHours: { fri: { openMin: 1020, closeMin: 1260 }, sat: null },
      })

      // Editing only the address, written the way saveLocation does — all seven days.
      await setDoc(
        doc(db, 'locations', 'jacks'),
        {
          address: '200 Benjamin Road',
          openHours: {
            sun: null, mon: null, tue: null, wed: null, thu: null,
            fri: { openMin: 1020, closeMin: 1260 }, sat: null,
          },
        },
        { merge: true },
      )

      const openHours = (await getDoc(doc(db, 'locations', 'jacks'))).data()!
        .openHours as Record<string, unknown>
      expect(openHours.sat).toBeNull()
      expect(openHours.fri).toEqual({ openMin: 1020, closeMin: 1260 })
    })
  })
})
