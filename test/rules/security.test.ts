import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { RULES_PROJECT_ID } from './projectId'

/**
 * Security-rules tests.
 *
 * On the Spark plan there are no Cloud Functions, so `firestore.rules` is the entire
 * authorization layer. Two properties are load-bearing and are asserted here:
 *
 *  1. Minors' names and parent contact details are unreachable without an admin account.
 *  2. A client cannot assert a role. Anybody who works a screen holds an account on the
 *     roster, which only an admin can add them to. A volunteer holds an unguessable pass
 *     token, and it reaches exactly one document: their own pass.
 */

const PROJECT_ID = RULES_PROJECT_ID
const EVENT = '2026'

const ADMIN_UID = 'organizer-uid'

const VOLUNTEER_TOKEN = 'tok_volunteer_bbbbbbbbbb'

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

  // Seed as though an organizer had already published.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'admins', ADMIN_UID), { addedAt: 0 })
    await setDoc(doc(db, 'events', EVENT, 'people', 'p-alpha-one-cubs'), {
      firstName: 'Alpha', lastName: 'One', section: 'cubs',
      parentName: 'Parent One', parentEmail: 'parent@example.org',
      parentPhone: '519-555-0100', pairWithPersonId: null,
    })
    await setDoc(doc(db, 'locations', 'braemar-640'), { name: 'Braemar', priority: 1 })
    await setDoc(doc(db, 'events', EVENT), { year: 2026, status: 'published' })
    await setDoc(doc(db, 'passes', VOLUNTEER_TOKEN), {
      eventId: EVENT, personId: 'p-alpha-one-cubs', shifts: [],
    })
    await setDoc(doc(db, 'events', EVENT, 'assignments', 'a1'), {
      slotId: 'fri-1700', locationId: 'braemar-640', personId: 'p-alpha-one-cubs',
      status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
    })
    await setDoc(doc(db, 'events', EVENT, 'jars', 'fri-jar-1'), {
      jarNumber: 1, day: 'fri', locationId: 'braemar-640', personId: 'p-alpha-one-cubs',
      assignmentId: 'a1', assignmentIds: ['a1'], status: 'counted', issuedAt: 0, issuedBy: ADMIN_UID,
      amount: 19.95, method: 'cash', countedBy: ADMIN_UID, countedAt: 0,
    })
  })
})

const anon = () => testEnv.unauthenticatedContext().firestore()
const admin = () => testEnv.authenticatedContext(ADMIN_UID).firestore()
/**
 * Signed in with a real Google account, and on nobody's roster.
 *
 * This is what a volunteer's phone is, and what a base-ops device is: having an account
 * grants nothing at all by itself. Every "may they?" below is asked of this context.
 */
const stranger = () => testEnv.authenticatedContext('stranger-uid').firestore()

describe('PII is not reachable without an organizer account', () => {
  /** People live under the event they took part in, not in a system-wide register. */
  const person = (db: ReturnType<typeof anon>) =>
    doc(db, 'events', EVENT, 'people', 'p-alpha-one-cubs')

  it('blocks the public from reading people', async () => {
    await assertFails(getDoc(person(anon())))
    await assertFails(getDocs(collection(anon(), 'events', EVENT, 'people')))
  })

  it('blocks a signed-in stranger and a volunteer', async () => {
    await assertFails(getDoc(person(stranger())))
    await assertFails(getDoc(person(stranger())))
  })


  it('lets an organizer read them', async () => {
    await assertSucceeds(getDoc(person(admin())))
  })

  it('keeps signups private', async () => {
    await assertFails(getDocs(collection(anon(), 'events', EVENT, 'signups')))
  })
})

describe('nothing is publicly readable any more', () => {
  /*
    There is no public collection at all — no redacted schedule, nothing served to somebody
    holding no link. That takes a whole class of exposure off the table: the only thing
    reachable without an account is a single pass, by a token nobody can guess.

    Pinned shut here so it cannot reappear by accident.
  */

  it('refuses a world-readable collection', async () => {
    await assertFails(getDoc(doc(anon(), 'public', 'schedule')))
    await assertFails(setDoc(doc(anon(), 'public', 'schedule'), { rows: [] }))
  })

  it('refuses it to an organizer too, so nothing writes there by habit', async () => {
    await assertFails(setDoc(doc(admin(), 'public', 'schedule'), { rows: [] }))
  })
})

describe('what the last publish wrote', () => {
  it('is readable and writable by an organizer, and by nobody else', async () => {
    // It replaced a field on the public document. Publishing is organizer work, so this
    // must not need the admin tier — and it must not be readable without an account.
    await assertSucceeds(
      setDoc(doc(admin(), 'events', EVENT, 'meta', 'publish'), {
        publishedAt: 1, fingerprint: 'abc',
      }),
    )
    await assertSucceeds(getDoc(doc(admin(), 'events', EVENT, 'meta', 'publish')))
    await assertFails(getDoc(doc(anon(), 'events', EVENT, 'meta', 'publish')))
    await assertFails(getDoc(doc(stranger(), 'events', EVENT, 'meta', 'publish')))
  })
})

describe('passes are capability documents', () => {
  it('can be fetched by exact id without signing in — the QR is the credential', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'passes', VOLUNTEER_TOKEN)))
  })

  it('cannot be enumerated, so tokens cannot be harvested', async () => {
    await assertFails(getDocs(collection(anon(), 'passes')))
    await assertFails(getDocs(collection(stranger(), 'passes')))
  })

  it('cannot be minted by anybody but an organizer', async () => {
    // Holding one pass must not let you write another. The token is a credential for
    // exactly one document.
    await assertFails(
      setDoc(doc(stranger(), 'passes', 'tok_forged'), {
        eventId: EVENT, personId: 'p-alpha-one-cubs', shifts: [],
      }),
    )
    await assertFails(
      setDoc(doc(anon(), 'passes', 'tok_forged'), {
        eventId: EVENT, personId: 'p-alpha-one-cubs', shifts: [],
      }),
    )
  })
})

describe('a device cannot give itself a role', () => {
  /*
    Anybody who works a screen holds an account on the roster, and the roster is
    admin-written. There is no `claims` collection — no device naming a pass token to write
    itself a role. These pin it shut so it cannot appear by accident.
  */

  it('cannot write a claim naming a real pass', async () => {
    const db = testEnv.authenticatedContext('fresh-device').firestore()
    await assertFails(
      setDoc(doc(db, 'claims', 'fresh-device'), {
        eventId: EVENT, token: VOLUNTEER_TOKEN,
        personId: 'p-alpha-one-cubs', role: 'volunteer', createdAt: 0,
      }),
    )
  })

  it('cannot read one either, not even its own', async () => {
    await assertFails(getDoc(doc(stranger(), 'claims', 'stranger-uid')))
    await assertFails(getDoc(doc(admin(), 'claims', 'stranger-uid')))
  })
})

describe('nobody can promote themselves', () => {
  it('refuses a self-written admin record', async () => {
    await assertFails(setDoc(doc(stranger(), 'admins', 'stranger-uid'), { addedAt: 0 }))
    await assertFails(setDoc(doc(stranger(), 'admins', 'stranger-uid'), { addedAt: 0 }))
  })

  it('refuses to list the admin roster', async () => {
    await assertFails(getDocs(collection(stranger(), 'admins')))
  })
})

describe('jars — who may touch the money', () => {
  const validJar = {
    jarNumber: 2, day: 'fri', locationId: 'braemar-640', personId: 'p-alpha-one-cubs',
    assignmentId: 'a1', assignmentIds: ['a1'], status: 'counted', issuedAt: 0, issuedBy: ADMIN_UID,
    amount: 42.5, method: 'cash', countedBy: ADMIN_UID, countedAt: 0,
  }

  it('lets an organizer record and correct an amount', async () => {
    await assertSucceeds(setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-2'), validJar))
    await assertSucceeds(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-2'), { ...validJar, amount: 43 }),
    )
  })

  it('lets an organizer take a jar back', async () => {
    // A mis-issued number, the wrong person, a miscount. Correcting money is organizers'
    // work, whole rather than split by whether the jar is still out.
    const { deleteDoc } = await import('firebase/firestore')
    await assertSucceeds(deleteDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-1')))
  })

  it('blocks the public and a stranger from taking one back', async () => {
    const { deleteDoc } = await import('firebase/firestore')
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'jars', 'fri-jar-13'), {
        jarNumber: 13, day: 'fri', locationId: 'braemar-640', personId: 'p-alpha-one-cubs',
        assignmentId: 'a1', assignmentIds: ['a1'], status: 'out', issuedAt: 1, issuedBy: ADMIN_UID,
        amount: null, method: 'cash', countedBy: '', countedAt: 0,
      })
    })
    await assertFails(deleteDoc(doc(stranger(), 'events', EVENT, 'jars', 'fri-jar-13')))
    await assertFails(deleteDoc(doc(anon(), 'events', EVENT, 'jars', 'fri-jar-13')))
  })

  it('blocks a stranger and the public entirely', async () => {
    await assertFails(setDoc(doc(stranger(), 'events', EVENT, 'jars', 'fri-jar-3'), validJar))
    await assertFails(setDoc(doc(anon(), 'events', EVENT, 'jars', 'fri-jar-3'), validJar))
    await assertFails(getDoc(doc(anon(), 'events', EVENT, 'jars', 'fri-jar-1')))
  })

  it('lets an organizer issue a jar with no amount yet', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-9'), {
        jarNumber: 9, day: 'fri', locationId: 'braemar-640', personId: 'p-alpha-one-cubs',
        assignmentId: 'a1', assignmentIds: ['a1'], status: 'out', issuedAt: 1, issuedBy: ADMIN_UID,
        amount: null, method: 'cash', countedBy: '', countedAt: 0,
      }),
    )
  })

  it('refuses an issued jar that claims an amount', async () => {
    // A jar still out with somebody cannot already have a total.
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-10'), {
        ...validJar, jarNumber: 10, status: 'out', amount: 5,
      }),
    )
  })

  it('refuses a counted jar with no amount', async () => {
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-11'), {
        ...validJar, jarNumber: 11, status: 'counted', amount: null,
      }),
    )
  })

  it('refuses an unknown status', async () => {
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-12'), {
        ...validJar, jarNumber: 12, status: 'lost',
      }),
    )
  })

  it('sends a shift out and brings it back', async () => {
    // Issuing a jar sets whereabouts to `out`; counting it in sets `back`. Attendance is a
    // separate field and neither write touches it.
    await assertSucceeds(
      updateDoc(doc(admin(), 'events', EVENT, 'assignments', 'a1'), {
        whereabouts: 'out',
      }),
    )
    await assertSucceeds(
      updateDoc(doc(admin(), 'events', EVENT, 'assignments', 'a1'), {
        whereabouts: 'back', checkedOutAt: 2,
      }),
    )
  })

  it('checks somebody in without moving them off a location', async () => {
    await assertSucceeds(
      updateDoc(doc(admin(), 'events', EVENT, 'assignments', 'a1'), {
        whereabouts: 'out',
      }),
    )
    await assertSucceeds(
      updateDoc(doc(admin(), 'events', EVENT, 'assignments', 'a1'), {
        status: 'checkedIn', checkedInAt: 3,
      }),
    )
  })

  it('refuses statuses that would double as whereabouts', async () => {
    // `out` and `returned` are not attendance values. A client writing them there parks two
    // facts in one field.
    for (const status of ['out', 'returned']) {
      await assertFails(
        updateDoc(doc(admin(), 'events', EVENT, 'assignments', 'a1'), { status }),
      )
    }
  })

  it('lets an organizer record money with no jar number', async () => {
    // Bushel sales at a location, a donation, a tap away from the table. Refusing it because
    // there is no jar is how money goes unrecorded.
    await assertSucceeds(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-extra-abc123'), {
        ...validJar, jarNumber: null, note: 'bushel sales',
      }),
    )
  })

  it('still rejects a nonsense jar number', async () => {
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-0'), {
        ...validJar, jarNumber: 0,
      }),
    )
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'fri-jar-x'), {
        ...validJar, jarNumber: 'seven',
      }),
    )
  })

  it('rejects impossible amounts and days', async () => {
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'bad-1'), { ...validJar, amount: -5 }),
    )
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'bad-2'), { ...validJar, amount: 99999 }),
    )
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'bad-3'), { ...validJar, day: 'sunday' }),
    )
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'bad-4'), { ...validJar, amount: '42.50' }),
    )
    await assertFails(
      setDoc(doc(admin(), 'events', EVENT, 'jars', 'bad-5'), { ...validJar, method: 'etransfer' }),
    )
  })
})

describe('assignments', () => {
  it('lets an organizer move the status', async () => {
    await assertSucceeds(
      updateDoc(doc(admin(), 'events', EVENT, 'assignments', 'a1'), {
        status: 'checkedIn', whereabouts: 'here', checkedInAt: 1,
      }),
    )
  })

  it('lets an organizer reassign who works where, which is the swap tool', async () => {
    await assertSucceeds(
      updateDoc(doc(admin(), 'events', EVENT, 'assignments', 'a1'), {
        personId: 'p-somebody-else',
      }),
    )
  })

  it('refuses a status no screen knows how to render', async () => {
    // Not about trust — a typo in a client would park the shift in a state the board
    // cannot draw, and that person would simply stop appearing on it.
    await assertFails(
      updateDoc(doc(admin(), 'events', EVENT, 'assignments', 'a1'), { status: 'paid' }),
    )
  })

  it('is closed to everybody else', async () => {
    await assertFails(
      updateDoc(doc(stranger(), 'events', EVENT, 'assignments', 'a1'), { status: 'checkedIn' }),
    )
    await assertFails(getDoc(doc(anon(), 'events', EVENT, 'assignments', 'a1')))
  })

  it('keeps locations off the public internet', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'locations', 'braemar-640')))
    await assertFails(getDoc(doc(stranger(), 'locations', 'braemar-640')))
    await assertFails(getDoc(doc(anon(), 'locations', 'braemar-640')))
  })
})

describe('swap requests from the public page', () => {
  it('accepts one that names a real pass', async () => {
    await assertSucceeds(
      setDoc(doc(anon(), 'events', EVENT, 'swapRequests', 'sr1'), {
        passToken: VOLUNTEER_TOKEN, kind: 'swap',
        message: 'Soccer ran late, can we move to 7pm?', createdAt: Date.now(),
      }),
    )
  })

  it('rejects one with an invented pass token', async () => {
    await assertFails(
      setDoc(doc(anon(), 'events', EVENT, 'swapRequests', 'sr2'), {
        passToken: 'tok_made_up_cccccccccccc', kind: 'swap', createdAt: Date.now(),
      }),
    )
  })

  it('rejects an unknown kind and an oversized message', async () => {
    await assertFails(
      setDoc(doc(anon(), 'events', EVENT, 'swapRequests', 'sr3'), {
        passToken: VOLUNTEER_TOKEN, kind: 'spam', createdAt: Date.now(),
      }),
    )
    await assertFails(
      setDoc(doc(anon(), 'events', EVENT, 'swapRequests', 'sr4'), {
        passToken: VOLUNTEER_TOKEN, kind: 'swap', message: 'x'.repeat(501), createdAt: Date.now(),
      }),
    )
  })

  it('is never readable by the public', async () => {
    await assertFails(getDocs(collection(anon(), 'events', EVENT, 'swapRequests')))
    await assertFails(getDocs(collection(stranger(), 'events', EVENT, 'swapRequests')))
    await assertSucceeds(getDocs(collection(admin(), 'events', EVENT, 'swapRequests')))
  })

  it('refuses one backdated to the front of the queue', async () => {
    /*
      The queue is worked oldest-first, on purpose: somebody who wrote in on the Wednesday
      should not end up behind somebody from an hour ago. `createdAt` was allowed through
      unchecked, so sending 0 put you at the head of it — ahead of everybody, for ever.
    */
    await assertFails(
      setDoc(doc(anon(), 'events', EVENT, 'swapRequests', 'jump'), {
        passToken: VOLUNTEER_TOKEN, kind: 'swap', message: 'me first', createdAt: 0,
      }),
    )
  })

  it('refuses a createdAt that is not a time at all', async () => {
    // A string read back as 0, which jumped the queue by accident rather than by design.
    await assertFails(
      setDoc(doc(anon(), 'events', EVENT, 'swapRequests', 'junk'), {
        passToken: VOLUNTEER_TOKEN, kind: 'swap', message: 'x', createdAt: 'not a time',
      }),
    )
  })

  it('refuses one dated next week', async () => {
    await assertFails(
      setDoc(doc(anon(), 'events', EVENT, 'swapRequests', 'later'), {
        passToken: VOLUNTEER_TOKEN, kind: 'swap', message: 'x',
        createdAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      }),
    )
  })

  it('refuses one with no time on it', async () => {
    await assertFails(
      setDoc(doc(anon(), 'events', EVENT, 'swapRequests', 'none'), {
        passToken: VOLUNTEER_TOKEN, kind: 'swap', message: 'x',
      }),
    )
  })
})

describe('listing the events themselves', () => {
  it('lets an organizer list every year', async () => {
    // The Years screen lists this collection; if this fails the screen cannot load.
    await assertSucceeds(getDocs(collection(admin(), 'events')))
  })


  it('refuses the public and a signed-in stranger', async () => {
    await assertFails(getDocs(collection(anon(), 'events')))
    await assertFails(getDocs(collection(stranger(), 'events')))
  })

  it('lets an organizer create a new year', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'events', '2027'), {
        year: 2027,
        schedule: { fri: { startMin: 1020, endMin: 1260 }, sat: { startMin: 420, endMin: 900 } },
      }),
    )
  })
})

describe('the group’s sections', () => {
  it('are readable by anybody running the event, so a name and colour can be shown', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'sections', 'rovers'), {
        name: 'Rovers', youth: true, order: 6, tone: 'purple', aliases: ['rover'],
      }),
    )
    await assertSucceeds(getDocs(collection(admin(), 'sections')))
  })

  it('are not changed by somebody signed in with no access', async () => {
    // Which tier may change them is tiers.test.ts's subject; this is only that an
    // account by itself is worth nothing.
    await assertFails(
      setDoc(doc(stranger(), 'sections', 'rovers'), { name: 'Rovers', youth: true }),
    )
  })

  it('are not public', async () => {
    await assertFails(getDocs(collection(anon(), 'sections')))
  })
})

describe('per-year location settings', () => {
  it('are readable by organizers and closed to everybody else', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'events', EVENT, 'eventLocations', 'braemar-640'), {
        active: true, priority: 1,
      }),
    )
    await assertSucceeds(
      getDoc(doc(admin(), 'events', EVENT, 'eventLocations', 'braemar-640')),
    )
    await assertFails(
      getDoc(doc(stranger(), 'events', EVENT, 'eventLocations', 'braemar-640')),
    )
    await assertFails(
      getDoc(doc(anon(), 'events', EVENT, 'eventLocations', 'braemar-640')),
    )
  })

  it('keeps the library itself away from the public', async () => {
    await assertFails(getDocs(collection(anon(), 'locations')))
  })
})

describe('everything else is denied by default', () => {
  it('refuses an unknown collection', async () => {
    await assertFails(setDoc(doc(admin(), 'random', 'x'), { a: 1 }))
    await assertFails(getDoc(doc(anon(), 'random', 'x')))
  })
})

describe('revealing a location on a pass', () => {
  /*
    A pass names a location only once an organizer has checked that person in — everybody
    reports to base first. The reveal follows the check-in in both directions.

    The whole pass is organizer-written. There is no narrower rule letting somebody flip
    `revealShifts` alone, because there is nobody left who needs one.
  */

  const seedPass = async (): Promise<void> => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'passes', 'tok-reveal'), {
        eventId: EVENT, personId: 'p-one', revealShifts: false,
      })
    })
  }

  it('lets an organizer flip it, and flip it back', async () => {
    await seedPass()
    await assertSucceeds(
      updateDoc(doc(admin(), 'passes', 'tok-reveal'), { revealShifts: true }),
    )
    await assertSucceeds(
      updateDoc(doc(admin(), 'passes', 'tok-reveal'), { revealShifts: false }),
    )
  })

  it('refuses the holder of the pass', async () => {
    // The token reads the document. It does not write it — otherwise a volunteer could
    // reveal their own location without ever reporting to base, which is the one thing
    // the whole arrangement exists to prevent.
    await seedPass()
    await assertFails(
      updateDoc(doc(anon(), 'passes', 'tok-reveal'), { revealShifts: true }),
    )
    await assertFails(
      updateDoc(doc(stranger(), 'passes', 'tok-reveal'), { revealShifts: true }),
    )
  })
})
