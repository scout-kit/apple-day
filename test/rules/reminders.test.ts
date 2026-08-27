import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { RULES_PROJECT_ID } from './projectId'

/**
 * The record of what has already been sent.
 *
 * Append-only, for the same reason the audit log is: it is what stops a second click
 * sending a parent a second copy, and that only works if the first record cannot be
 * removed or edited afterwards.
 */

const EVENT = '2026'
const ADMIN = 'admin-uid'
const ORGANIZER = 'organizer-uid'
const OUTSIDER = 'outsider-uid'

let testEnv: RulesTestEnvironment

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: RULES_PROJECT_ID,
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
    await setDoc(doc(db, 'admins', ADMIN), { addedAt: 0 })
    await setDoc(doc(db, 'admins', ORGANIZER), { addedAt: 0, level: 'organizer' })
    await setDoc(doc(db, 'events', EVENT), { year: 2026, name: 'Apple Day 2026' })
  })
})

const asAdmin = () => testEnv.authenticatedContext(ADMIN).firestore()
const asOrganizer = () => testEnv.authenticatedContext(ORGANIZER).firestore()
const asOutsider = () => testEnv.authenticatedContext(OUTSIDER).firestore()
const anon = () => testEnv.unauthenticatedContext().firestore()

const at = (db: ReturnType<typeof asOrganizer>, id = 'shift_upcoming__day-sat__p1') =>
  doc(db, 'events', EVENT, 'reminders', id)

const record = (over: Record<string, unknown> = {}) => ({
  templateId: 'shift_upcoming',
  selectionKey: 'day-sat',
  personId: 'p1',
  assignmentIds: ['a1'],
  sentAt: Date.now(),
  sentBy: ORGANIZER,
  sentByEmail: 'organizer@example.org',
  channel: 'gmail',
  ...over,
})

describe('writing down that a reminder went out', () => {
  it('is allowed for anybody running the event', async () => {
    // Sending is organizer work, so recording it has to be too.
    await assertSucceeds(setDoc(at(asOrganizer()), record()))
  })

  it('is refused for somebody not on the roster', async () => {
    await assertFails(setDoc(at(asOutsider()), record()))
    await assertFails(setDoc(at(anon()), record()))
  })

  it('is refused with wording the app does not have', async () => {
    await assertFails(setDoc(at(asOrganizer()), record({ templateId: 'whatever_i_like' })))
  })

  it('is refused through a channel the app does not send by', async () => {
    await assertFails(setDoc(at(asOrganizer()), record({ channel: 'carrier-pigeon' })))
  })

  it('is refused with anything extra on it', async () => {
    /*
      An allowlist rather than a denylist, and the field being kept out is the obvious one:
      the parent's address. The ledger is keyed by person, and contact details belong in
      `people`, which fewer screens read.
    */
    await assertFails(
      setDoc(at(asOrganizer()), record({ parentEmail: 'ada@example.org' })),
    )
  })

  it('is refused backdated, or dated next week', async () => {
    await assertFails(setDoc(at(asOrganizer()), record({ sentAt: 0 })))
    await assertFails(
      setDoc(at(asOrganizer()), record({ sentAt: Date.now() + 7 * 24 * 60 * 60 * 1000 })),
    )
  })

  it('is refused with a time that is not a time', async () => {
    await assertFails(setDoc(at(asOrganizer()), record({ sentAt: 'this morning' })))
  })

  it('is refused with a runaway list of shifts', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `a${i}`)
    await assertFails(setDoc(at(asOrganizer()), record({ assignmentIds: many })))
  })
})

describe('once it is written down', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), 'events', EVENT, 'reminders', 'shift_upcoming__day-sat__p1'),
        record(),
      )
    })
  })

  it('cannot be changed', async () => {
    // Including by whoever wrote it. The point of the record is that it is not negotiable.
    await assertFails(setDoc(at(asOrganizer()), record({ channel: 'csv' })))
  })

  it('cannot be removed by whoever sends from it', async () => {
    /*
      This is what stops a second click sending a second copy. A record that could be
      deleted would let somebody clear the way for a duplicate without meaning to — and
      would make "was this parent actually told" unanswerable by the people it is asked of.
    */
    await assertFails(deleteDoc(at(asOrganizer())))
  })

  it('goes when an admin removes the year it belongs to', async () => {
    /*
      Append-only is about the people who send from it, not about the year ceasing to exist.
      Removing an event takes every person these records name, is an admin's decision, and is
      on the audit log with a name against it.

      It also has to be possible: Firestore does not cascade, so the removal walks every
      subcollection, and one that would not let go failed the whole batch — "delete this
      event" stopped dead with a permissions error and nothing saying which collection
      refused.
    */
    await assertSucceeds(deleteDoc(at(asAdmin())))
  })

  it('can be read by anybody running the event', async () => {
    // The screen has to know who has already been told before it offers to tell them.
    await assertSucceeds(getDoc(at(asOrganizer())))
  })

  it('cannot be read by anybody else', async () => {
    await assertFails(getDoc(at(asOutsider())))
    await assertFails(getDoc(at(anon())))
  })
})
