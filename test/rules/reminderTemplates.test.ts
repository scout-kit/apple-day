import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { RULES_PROJECT_ID } from './projectId'

/**
 * The wording of a reminder, where the group has changed it.
 *
 * Shared across years rather than per event, so it is written once — which also means an
 * edit changes what everybody sends. Organizer-writable, like sending itself: the person
 * who has to send a reminder is the one who knows how it should read.
 */

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
    await setDoc(doc(ctx.firestore(), 'admins', ORGANIZER), { addedAt: 0, level: 'organizer' })
  })
})

const asOrganizer = () => testEnv.authenticatedContext(ORGANIZER).firestore()
const asOutsider = () => testEnv.authenticatedContext(OUTSIDER).firestore()
const anon = () => testEnv.unauthenticatedContext().firestore()

const at = (db: ReturnType<typeof asOrganizer>) =>
  doc(db, 'reminderTemplates', 'event_schedule')

const wording = (over: Record<string, unknown> = {}) => ({
  subject: 'Your shifts for {{event}}',
  body: 'Hi {{parent}},\n\n{{shifts}}',
  updatedAt: Date.now(),
  updatedBy: 'organizer@example.org',
  ...over,
})

describe('changing how a reminder reads', () => {
  it('is allowed for anybody running the event', async () => {
    await assertSucceeds(setDoc(at(asOrganizer()), wording()))
  })

  it('can be changed again', async () => {
    await assertSucceeds(setDoc(at(asOrganizer()), wording()))
    await assertSucceeds(setDoc(at(asOrganizer()), wording({ subject: 'Something else' })))
  })

  it('can be put back to the built-in by removing it', async () => {
    // An absent record *is* the default, which is what makes reset a delete.
    await assertSucceeds(setDoc(at(asOrganizer()), wording()))
    await assertSucceeds(deleteDoc(at(asOrganizer())))
  })

  it('is refused for somebody not on the roster', async () => {
    await assertFails(setDoc(at(asOutsider()), wording()))
    await assertFails(setDoc(at(anon()), wording()))
    await assertFails(getDoc(at(anon())))
  })

  it('is refused empty, because that is not a message', async () => {
    await assertFails(setDoc(at(asOrganizer()), wording({ subject: '' })))
    await assertFails(setDoc(at(asOrganizer()), wording({ body: '' })))
  })

  it('is refused with anything extra on it', async () => {
    // An allowlist rather than a denylist, as everywhere else here.
    await assertFails(setDoc(at(asOrganizer()), wording({ sendTo: 'everyone' })))
  })

  it('is refused if it is not text', async () => {
    await assertFails(setDoc(at(asOrganizer()), wording({ body: 42 })))
  })

  it('is refused when it is longer than anything worth saying', async () => {
    /*
      Not a style rule — a paste accident. Somebody dropping a document into the box should
      not mail four thousand characters to sixty families.
    */
    await assertFails(setDoc(at(asOrganizer()), wording({ body: 'x'.repeat(4001) })))
    await assertSucceeds(setDoc(at(asOrganizer()), wording({ body: 'x'.repeat(3999) })))
  })

  it('can be read by anybody running the event, since they all send it', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reminderTemplates', 'event_schedule'), wording())
    })
    await assertSucceeds(getDoc(at(asOrganizer())))
  })
})
