import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { RULES_PROJECT_ID } from './projectId'

/**
 * An audit trail that cannot be tidied away.
 *
 * The whole value of the log is that the person who typed the wrong number cannot go back
 * and remove the line saying so. Everything else about it — who can read it, what shape an
 * entry takes — is secondary to that one property, which is why it is the first thing here.
 */

const ADMIN = 'admin-uid'
const ORGANIZER = 'organizer-uid'
const OUTSIDER = 'nobody-uid'

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

const ENTRY = {
  // A real time: an entry may no longer be filed under one that never happened.
  at: Date.now(),
  by: ORGANIZER,
  byName: 'An Organizer',
  action: 'updated',
  entity: 'jar',
  entityId: 'jar-12',
  eventId: '2026',
  summary: 'Counted jar 12 at Braemar',
  changes: [{ field: 'amount', from: '80', to: '180' }],
}

beforeEach(async () => {
  await testEnv.clearFirestore()
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'admins', ADMIN), { addedAt: 0 })
    await setDoc(doc(db, 'admins', ORGANIZER), { addedAt: 0, level: 'organizer' })
    // The event an entry names has to exist, so the seed has to have one.
    await setDoc(doc(db, 'events', '2026'), { year: 2026, name: 'Apple Day 2026' })
    await setDoc(doc(db, 'audit', 'existing'), ENTRY)
  })
})

const asAdmin = () => testEnv.authenticatedContext(ADMIN).firestore()
const asOrganizer = () => testEnv.authenticatedContext(ORGANIZER).firestore()
const asOutsider = () => testEnv.authenticatedContext(OUTSIDER).firestore()

describe('an entry, once written', () => {
  it('cannot be changed by the person who wrote it', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'audit', 'existing'), { ...ENTRY, summary: 'nothing happened' }),
    )
  })

  it('cannot be deleted by the person who wrote it', async () => {
    // The failure this exists to prevent: type 80, notice, delete the evidence.
    await assertFails(deleteDoc(doc(asOrganizer(), 'audit', 'existing')))
  })

  it('cannot be changed or deleted by an admin either', async () => {
    /*
      Admins can change everything else in the app, including the roster. Not this. A log the
      most senior person can edit answers no question that anybody would ask it.
    */
    await assertFails(setDoc(doc(asAdmin(), 'audit', 'existing'), { ...ENTRY, summary: 'x' }))
    await assertFails(deleteDoc(doc(asAdmin(), 'audit', 'existing')))
  })
})

describe('writing an entry', () => {
  it('is allowed for anybody running the event', async () => {
    await assertSucceeds(setDoc(doc(asOrganizer(), 'audit', 'fresh'), ENTRY))
  })

  it("cannot be written in somebody else's name", async () => {
    // Otherwise the log names whoever the writer felt like naming.
    await assertFails(setDoc(doc(asOrganizer(), 'audit', 'fresh'), { ...ENTRY, by: ADMIN }))
  })

  it('is refused from somebody not on the roster', async () => {
    await assertFails(setDoc(doc(asOutsider(), 'audit', 'fresh'), { ...ENTRY, by: OUTSIDER }))
  })

  it('has to say what happened', async () => {
    const { action: _action, ...noAction } = ENTRY
    await assertFails(setDoc(doc(asOrganizer(), 'audit', 'fresh'), noAction))
    await assertFails(
      setDoc(doc(asOrganizer(), 'audit', 'fresh'), { ...ENTRY, action: 'tidied' }),
    )
  })
})

describe('reading the log', () => {
  it('is for admins, who are answerable for the event', async () => {
    await assertSucceeds(getDoc(doc(asAdmin(), 'audit', 'existing')))
  })

  it('is closed to the organizers who write to it', async () => {
    /*
      Everyone running the event writes here; only admins read it. It records who marked
      which child a no-show and who corrected whose jar — a record about the organizers, not
      a working screen for them.
    */
    await assertFails(getDoc(doc(asOrganizer(), 'audit', 'existing')))
  })

  it('is closed to everybody else', async () => {
    await assertFails(getDoc(doc(asOutsider(), 'audit', 'existing')))
  })
})

describe('an entry cannot be filed where it did not happen', () => {
  const now = (): number => Date.now()

  it('refuses one dated years ahead', async () => {
    /*
      `at is int` on its own let this through. The log is read newest-first and cut into
      days, so an entry dated 2100 pins itself to the top of it for ever and files itself
      under a day nobody worked — in a record whose whole purpose is the order things
      happened in.
    */
    await assertFails(
      setDoc(doc(asOrganizer(), 'audit', 'future'), {
        ...ENTRY, at: Date.UTC(2100, 0, 1),
      }),
    )
  })

  it('refuses one backdated into a previous year', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'audit', 'past'), { ...ENTRY, at: Date.UTC(2019, 0, 1) }),
    )
  })

  it('allows a clock that is a little out', async () => {
    // The stamp is the client's, and a phone in a shop doorway is not a time server.
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'audit', 'skewed'), { ...ENTRY, at: now() - 60 * 60 * 1000 }),
    )
  })

  it('refuses one naming an event that does not exist', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'audit', 'ghost'), { ...ENTRY, at: now(), eventId: '2019' }),
    )
  })

  it('allows one belonging to no event at all', async () => {
    // The shared setup — the library, the sections, the access list — belongs to no single
    // Apple Day, and its entries are exactly the ones that were invisible until today.
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'audit', 'shared'), { ...ENTRY, at: now(), eventId: null }),
    )
  })
})
