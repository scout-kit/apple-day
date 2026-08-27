import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { RULES_PROJECT_ID } from './projectId'

/**
 * Two tiers on one roster.
 *
 * An organizer runs the event: builds the schedule, checks people in, counts jars,
 * publishes. An admin also looks after what is shared between years — the location library,
 * the sections, the events themselves — where a wrong edit is a wrong edit to every year at
 * once.
 *
 * The rules are the real gate. The navigation hiding a link is a courtesy; this is the part
 * that holds if somebody types the URL.
 */

const EVENT = '2026'
const ADMIN = 'admin-uid'
const ORGANIZER = 'organizer-uid'
const VIEWER = 'viewer-uid'
/** A level nobody has thought of: a typo, or a tier added later than this test. */
const STRANGE = 'strange-uid'

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
    // No level: a full admin. This is what every entry written before the tiers looked like.
    await setDoc(doc(db, 'admins', ADMIN), { addedAt: 0 })
    await setDoc(doc(db, 'admins', ORGANIZER), { addedAt: 0, level: 'organizer' })
    await setDoc(doc(db, 'admins', VIEWER), { addedAt: 0, level: 'viewer' })
    await setDoc(doc(db, 'admins', STRANGE), { addedAt: 0, level: 'treasurer' })
    await setDoc(doc(db, 'events', EVENT), { year: 2026, name: 'Apple Day 2026' })
    await setDoc(doc(db, 'locations', 'braemar'), { name: 'Braemar' })
    await setDoc(doc(db, 'sections', 'cubs'), { name: 'Cubs', order: 2 })
    await setDoc(doc(db, 'events', EVENT, 'people', 'p-one'), { firstName: 'Elliot', lastName: 'R' })
  })
})

const asAdmin = () => testEnv.authenticatedContext(ADMIN).firestore()
const asOrganizer = () => testEnv.authenticatedContext(ORGANIZER).firestore()
const asViewer = () => testEnv.authenticatedContext(VIEWER).firestore()
const asStranger = () => testEnv.authenticatedContext(STRANGE).firestore()

describe('an entry with no level is a full admin', () => {
  it('can still change the library', async () => {
    // The default that matters: reading a legacy entry as the lesser tier would have locked
    // the group out of its own setup screens.
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'locations', 'braemar'), { name: 'Braemar Aldergrove' }),
    )
  })
})

describe('an organizer runs the event', () => {
  it('builds the schedule', async () => {
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'assignments', 'a1'), {
        slotId: 'fri-1700', locationId: 'braemar', personId: 'p-one',
        status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: 0,
      }),
    )
  })

  it('corrects somebody’s availability while building it', async () => {
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'signups', 'su-1'), {
        personId: 'p-one', availability: { fri: ['fri-1700'] },
      }),
    )
  })

  it('adds a walk-in and fixes a phone number', async () => {
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'people', 'p-two'), { firstName: 'Boyan', lastName: 'K' }),
    )
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'people', 'p-one'), { parentPhone: '519-555-0100' }, { merge: true }),
    )
  })

  it('publishes the schedule and the passes', async () => {
    // The publish record moved off the public schedule document, which is gone. It has to
    // stay organizer-writable: publishing is not an admin job.
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'meta', 'publish'), {
        publishedAt: 1, fingerprint: 'abc',
      }),
    )
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'passes', 'tok-one'), {
        eventId: EVENT, personId: 'p-one', role: 'volunteer', revealShifts: false,
      }),
    )
  })

  it('counts the money', async () => {
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'jars', 'fri-jar-1-a'), {
        jarNumber: 1, day: 'fri', locationId: 'braemar', status: 'counted',
        amount: 100, method: 'cash',
      }),
    )
    // And writes down what a figure cannot say. There is nothing else to type here: the
    // totals are the jars, so there is no second set of numbers to reconcile against.
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'notes', 'n1'), {
        text: 'Found jar 14 behind the till.', at: Date.now(), by: 'o@example.org',
      }),
    )
  })

  it('cannot write a note that would not load, or one with passengers', async () => {
    /*
      Free text typed from a phone at the end of a long day. An accident with a paste should
      not become a document every organizer's screen then has to render.
    */
    await assertFails(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'notes', 'n2'), {
        text: 'x'.repeat(2001), at: Date.now(), by: 'o@example.org',
      }),
    )
    await assertFails(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'notes', 'n3'), {
        text: '', at: Date.now(), by: 'o@example.org',
      }),
    )
    await assertFails(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'notes', 'n4'), {
        text: 'fine', at: Date.now(), by: 'o@example.org', level: 'admin',
      }),
    )
  })

  it('cannot date a note to the top of the list', async () => {
    // The list is read in order, so a note dated next year pins itself above everything.
    await assertFails(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'notes', 'n5'), {
        text: 'fine', at: Date.now() + 40 * 24 * 60 * 60 * 1000, by: 'o@example.org',
      }),
    )
  })

  it('reads everything it needs to do any of that', async () => {
    for (const path of [
      ['locations', 'braemar'],
      ['sections', 'cubs'],
      // people are event-scoped now
      ['events', EVENT, 'people', 'p-one'] as unknown as [string, string],
      ['events', EVENT],
    ] as [string, string][]) {
      await assertSucceeds(getDoc(doc(asOrganizer(), ...path)))
    }
  })

  it('works the volunteer request queue', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'events', EVENT, 'swapRequests', 'r1'), {
        passToken: 'tok-one', kind: 'cancel', createdAt: Date.now(),
      })
    })
    await assertSucceeds(
      setDoc(
        doc(asOrganizer(), 'events', EVENT, 'swapRequests', 'r1'),
        { handledAt: 2, handledBy: ORGANIZER },
        { merge: true },
      ),
    )
  })
})

describe('an organizer fixes what needs fixing on the day', () => {
  /*
    The line is drawn deliberately, and not at "shared between years".

    That would put the wrong things on the wrong side of it: finding a shop's address is wrong
    happens standing outside the shop, and the person standing there should be able to fix it.
    What an admin keeps is not the wide work — it is the work that cannot be undone or noticed
    afterwards.
  */
  it('adds a shop and corrects an address', async () => {
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'locations', 'braemar'), { name: 'Braemar Aldergrove' }),
    )
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'locations', 'new-shop'), { name: 'The new one' }),
    )
  })

  it('cannot remove a shop from the library', async () => {
    // Three years of jars and assignments hang off a location id. A wrong address is
    // noticed and fixed; an orphaned year is not.
    await assertFails(deleteDoc(doc(asOrganizer(), 'locations', 'braemar')))
  })

  it('sets which locations the year uses', async () => {
    // This year's shops are this year's schedule — the same decision as which hour somebody
    // works, made by the same person, often in the same sitting.
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'eventLocations', 'braemar'), {
        locationId: 'braemar', active: true, priority: 1,
      }),
    )
  })

  it('changes the year it is running', async () => {
    // Wanting the support number changed at 8am on the Saturday is not unreasonable.
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT), { supportPhone: '519-555-0100' }, { merge: true }),
    )
  })
})

describe('an organizer does not undo what cannot be undone', () => {
  it('cannot change the sections', async () => {
    // Never needed in the moment, and every past year's figures are grouped by them — so a
    // rename quietly changes how all of them read.
    await assertFails(setDoc(doc(asOrganizer(), 'sections', 'cubs'), { name: 'Kubs' }))
  })

  it('cannot start a year or delete one', async () => {
    /*
      Deleting an event is the most destructive act available here: a year of jars, shifts
      and audit entries hang off it and go with it, and nothing in the app puts them back.
    */
    await assertFails(
      setDoc(doc(asOrganizer(), 'events', '2027'), { year: 2027, name: 'Apple Day 2027' }),
    )
    await assertFails(deleteDoc(doc(asOrganizer(), 'events', EVENT)))
  })

  it('cannot read the audit log', async () => {
    // It is a record about the organizers themselves.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit', 'e1'), {
        at: 1, by: ADMIN, action: 'updated', entity: 'jar', entityId: 'j1', eventId: EVENT,
      })
    })
    await assertFails(getDoc(doc(asOrganizer(), 'audit', 'e1')))
  })

  it('can delete somebody from this event, which is all that deleting them is now', async () => {
    /*
      People are stored under their event, so removing one is a decision about a single Apple
      Day rather than something that takes every year's shifts with it — exactly the sort of
      call somebody running the day should be able to make.
    */
    await assertSucceeds(deleteDoc(doc(asOrganizer(), 'events', EVENT, 'people', 'p-one')))
  })

  it('cannot promote itself', async () => {
    // The tier would be decoration if it could. Note this holds for a stronger reason than
    // the tier check: the roster is not writable from the app at all — see below.
    await assertFails(setDoc(doc(asOrganizer(), 'admins', ORGANIZER), { addedAt: 0 }))
    await assertFails(
      setDoc(doc(asOrganizer(), 'admins', ORGANIZER), { addedAt: 0, level: 'admin' }),
    )
  })
})

describe('an admin does all of it', () => {
  it('changes the library, the sections and the event', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), 'locations', 'braemar'), { name: 'Renamed' }))
    await assertSucceeds(setDoc(doc(asAdmin(), 'sections', 'cubs'), { name: 'Cubs', order: 2 }))
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'events', EVENT), { name: 'Renamed' }, { merge: true }),
    )
  })

  it('deletes somebody from an event', async () => {
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'events', EVENT, 'people', 'p-one')))
  })

  it('runs the event as well', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'events', EVENT, 'assignments', 'a1'), {
        slotId: 'fri-1700', locationId: 'braemar', personId: 'p-one',
        status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: 0,
      }),
    )
  })
})

describe('somebody not on the roster at all', () => {
  it('gets nothing, whichever tier they claim', async () => {
    const stranger = testEnv.authenticatedContext('stranger').firestore()
    await assertFails(getDoc(doc(stranger, 'events', EVENT, 'people', 'p-one')))
    await assertFails(
      setDoc(doc(stranger, 'events', EVENT, 'assignments', 'a1'), { personId: 'p-one' }),
    )
  })
})


describe('the roster itself', () => {
  it('is writable by an admin, but never for their own entry', async () => {
    /*
      Managing access in the app rather than out of band trades something away deliberately:
      the collection is reachable from a signed-in session. The console at nine on a Friday is
      the worse problem. What guards it instead is narrower and holds: an admin may change
      anybody's entry except their own.

      That is what bounds the damage. An account taken over can add accomplices, which is
      bad; it cannot quietly remove every other admin and keep itself, because it cannot
      touch itself and the others can still remove it.
    */
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'admins', 'someone-new'), { addedAt: 0, level: 'organizer' }),
    )
    await assertFails(
      setDoc(doc(asAdmin(), 'admins', ADMIN), { level: 'organizer' }, { merge: true }),
    )
  })

  it('lets somebody read only their own entry', async () => {
    // Which is how the app knows which tier it is showing.
    await assertSucceeds(getDoc(doc(asOrganizer(), 'admins', ORGANIZER)))
    await assertFails(getDoc(doc(asOrganizer(), 'admins', ADMIN)))
  })
})

describe('managing access from the app', () => {
  it('lets an admin put somebody else on the roster', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'admins', 'new-uid'), {
        email: 'new@example.org', level: 'organizer', addedAt: 1, addedBy: ADMIN,
      }),
    )
  })

  it('lets an admin move somebody between tiers, and remove them', async () => {
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'admins', ORGANIZER), { level: 'admin' }, { merge: true }),
    )
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'admins', ORGANIZER)))
  })

  it('refuses to let anybody change their own entry', async () => {
    /*
      The invariant that makes locking the group out impossible.

      An admin may remove any *other* admin, so with two either can remove the other — but
      neither can remove themselves, so one always remains. Without this, two admins can
      leave zero, and the only way back in is the console this screen exists to avoid.
    */
    await assertFails(
      setDoc(doc(asAdmin(), 'admins', ADMIN), { level: 'organizer' }, { merge: true }),
    )
    await assertFails(deleteDoc(doc(asAdmin(), 'admins', ADMIN)))
  })

  it('refuses an organizer the whole roster', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'admins', 'new-uid'), { level: 'admin', addedAt: 1 }),
    )
    await assertFails(getDocs(collection(asOrganizer(), 'invites')))
  })
})

describe('claiming an invitation', () => {
  /*
    An invitation is a code in a link, and holding it is the whole of the permission.

    Keyed by email, this could not work for the people it most needed to. An admin invites
    the address their group has for somebody; that person signs in with a Google account at
    a different address, and is refused — which looks exactly like not being invited. So an
    invitation names no address, and whoever opens the link is who it lets in.
  */
  const CODE = 'abcdefghijklmnopqrstuv'

  const invite = (code: string, level: string, invitedAt = Date.now()) =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', code), {
        label: 'Somebody', level, invitedAt, invitedBy: ADMIN, note: '',
      })
    })

  const signedInAs = (uid: string, email?: string) =>
    testEnv
      .authenticatedContext(uid, email == null ? {} : { email, email_verified: true })
      .firestore()

  const claim = (code: string, level: string, email: string) => ({
    email, level, addedAt: Date.now(), addedBy: 'invitation', via: code,
  })

  it('gets somebody in whatever address they sign in with', async () => {
    await invite(CODE, 'organizer')
    await assertSucceeds(
      setDoc(
        doc(signedInAs('fresh-uid', 'nothing.like.it@example.org'), 'admins', 'fresh-uid'),
        claim(CODE, 'organizer', 'nothing.like.it@example.org'),
      ),
    )
  })

  it('gets in an account with no address at all', async () => {
    /*
      An address is a thing the entry records, not a thing it is keyed by, so an account
      without one is not a special case — it writes an empty string and the roster shows a
      blank where the address goes.
    */
    await invite(CODE, 'organizer')
    await assertSucceeds(
      setDoc(doc(signedInAs('fresh-uid'), 'admins', 'fresh-uid'), claim(CODE, 'organizer', '')),
    )
  })

  it('cannot ask for a higher tier than the invitation grants', async () => {
    await invite(CODE, 'organizer')
    await assertFails(
      setDoc(
        doc(signedInAs('fresh-uid', 'new@example.org'), 'admins', 'fresh-uid'),
        claim(CODE, 'admin', 'new@example.org'),
      ),
    )
  })

  it('cannot be claimed into somebody else’s entry', async () => {
    await invite(CODE, 'admin')
    await assertFails(
      setDoc(
        doc(signedInAs('fresh-uid', 'new@example.org'), 'admins', 'someone-else'),
        claim(CODE, 'admin', 'new@example.org'),
      ),
    )
  })

  it('expires, because a link in an inbox is not a standing grant', async () => {
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000
    await invite(CODE, 'organizer', fortyDaysAgo)
    await assertFails(
      setDoc(
        doc(signedInAs('fresh-uid', 'new@example.org'), 'admins', 'fresh-uid'),
        claim(CODE, 'organizer', 'new@example.org'),
      ),
    )
  })

  it('claims a bare invitation made by hand in the console', async () => {
    /*
      How a project gets its first admin, and how anybody gets back in after a lockout.

      There is no other way in. The Access screen is the only route the app offers and it
      needs somebody already inside; a roster entry cannot be written by its own account, by
      design; and signing in without access deletes the account it just made, so there is no
      account id to read out of the console and paste either.

      An invitation needs none of that, and the console route is two fields typed by hand —
      so the claim has to work against an invitation carrying *only* those two, with no label,
      no note and no `invitedBy`. A rule that starts requiring one of them makes the project
      impossible to set up, and this is the test that says so.
    */
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', CODE), {
        level: 'admin', invitedAt: Date.now(),
      })
    })

    await assertSucceeds(
      setDoc(
        doc(signedInAs('founder', 'founder@example.org'), 'admins', 'founder'),
        claim(CODE, 'admin', 'founder@example.org'),
      ),
    )
  })

  it('does nothing for a code nobody issued', async () => {
    /*
      Which is what stops the change from opening the door: an account signing in with no
      code, or a guessed one, writes nothing. Twenty-two characters from an alphabet of
      fifty-eight, and the collection cannot be listed.
    */
    await assertFails(
      setDoc(
        doc(signedInAs('fresh-uid', 'stranger@example.org'), 'admins', 'fresh-uid'),
        claim('made-up-code-aaaaaaaaa', 'organizer', 'stranger@example.org'),
      ),
    )
  })
})

describe('reading an invitation by its code', () => {
  const CODE = 'abcdefghijklmnopqrstuv'
  const OTHER = 'zyxwvutsrqponmlkjihgfe'

  const signedInAs = (uid: string, email: string) =>
    testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore()

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'invites', CODE), {
        label: 'A new organizer', level: 'organizer', invitedAt: Date.now(),
        invitedBy: ADMIN, note: '',
      })
      await setDoc(doc(db, 'invites', OTHER), {
        label: 'Somebody else', level: 'admin', invitedAt: Date.now(),
        invitedBy: ADMIN, note: '',
      })
    })
  })

  it('can be read without signing in at all', async () => {
    /*
      The join page's whole job, and it has to happen first. Asked for a Google account
      before being told what for, somebody hands one over and — if the link has expired or
      been withdrawn — is told they have no access, with nothing saying why. Reading it up
      front means the page can say "this invitation cannot be used" to a stranger.
    */
    await assertSucceeds(
      getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'invites', CODE)),
    )
  })

  it('cannot walk the collection for codes', async () => {
    // Open to `get` and closed to `list`, the same shape as a volunteer's pass: guessing one
    // is hopeless, and there is no way to be handed the list.
    await assertFails(getDocs(collection(testEnv.unauthenticatedContext().firestore(), 'invites')))
  })

  it('cannot change what it was invited to', async () => {
    await assertFails(
      setDoc(
        doc(signedInAs('fresh-uid', 'new@example.org'), 'invites', CODE),
        { level: 'admin' },
        { merge: true },
      ),
    )
  })

  it('is spent by whoever claims it', async () => {
    /*
      Single-use, and that is what deleting it means. The app deletes it in the same batch
      that writes the roster entry, so the two land together or not at all — there is no
      state where somebody is in and the link still works.
    */
    await assertSucceeds(deleteDoc(doc(signedInAs('newbie', 'new@example.org'), 'invites', CODE)))
  })

  it('can be revoked by an admin, which is how a sent link is taken back', async () => {
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'invites', CODE)))
  })

  it('reads it and claims it, end to end', async () => {
    const db = signedInAs('fresh-uid', 'nothing.like.it@example.org')
    const invite = await getDoc(doc(db, 'invites', CODE))
    expect(invite.data()!.level).toBe('organizer')

    await assertSucceeds(
      setDoc(doc(db, 'admins', 'fresh-uid'), {
        email: 'nothing.like.it@example.org',
        level: invite.data()!.level,
        addedAt: Date.now(),
        addedBy: 'invitation',
        via: CODE,
      }),
    )
  })
})

describe('nothing in a claim is taken on trust', () => {
  const CODE = 'abcdefghijklmnopqrstuv'

  const signedInAs = (uid: string, email: string) =>
    testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore()

  const claim = (over: Record<string, unknown> = {}) => ({
    email: 'new@example.org',
    level: 'organizer',
    addedAt: Date.now(),
    addedBy: 'invitation',
    via: CODE,
    ...over,
  })

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', CODE), {
        label: 'Somebody', level: 'organizer', invitedAt: Date.now(),
        invitedBy: ADMIN, note: '',
      })
    })
  })

  const claiming = (over?: Record<string, unknown>) =>
    setDoc(doc(signedInAs('fresh-uid', 'new@example.org'), 'admins', 'fresh-uid'), claim(over))

  it('accepts the claim the app actually writes', async () => {
    await assertSucceeds(claiming())
  })

  it('refuses a tier the invitation did not grant', async () => {
    // The only field that grants anything, so the only one that could escalate.
    await assertFails(claiming({ level: 'admin' }))
  })

  it('refuses an address other than the one it signed in with', async () => {
    /*
      Not an escalation, but a lie the access screen would repeat: it shows each entry's
      address, and a record of who was let in is worth nothing if the person let in wrote it.
    */
    await assertFails(claiming({ email: 'someone.else@example.org' }))
  })

  it('refuses forged provenance', async () => {
    await assertFails(claiming({ addedBy: 'devin@example.org' }))
  })

  it('refuses a claim naming no invitation', async () => {
    // The field the whole check hangs off: without a code that exists, there is nothing
    // granting the tier, and an entry is what a tier is.
    await assertFails(claiming({ via: 'not-a-real-code-aaaaaa' }))
    await assertFails(claiming({ via: '' }))
  })

  it('refuses an entry carrying passengers', async () => {
    await assertFails(claiming({ note: 'anything at all' }))
  })

  it('refuses a claim with a field missing', async () => {
    await assertFails(
      setDoc(doc(signedInAs('fresh-uid', 'new@example.org'), 'admins', 'fresh-uid'), {
        level: 'organizer',
      }),
    )
  })

  it('cannot be edited afterwards, by its owner or by itself', async () => {
    await assertSucceeds(claiming())
    const db = signedInAs('fresh-uid', 'new@example.org')
    // An organizer may not write the roster at all, so the entry is frozen once claimed.
    await assertFails(setDoc(doc(db, 'admins', 'fresh-uid'), { level: 'admin' }, { merge: true }))
    await assertFails(deleteDoc(doc(db, 'admins', 'fresh-uid')))
  })

  it('cannot be re-claimed after an admin removes it, because the code is spent', async () => {
    await assertSucceeds(claiming())
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'admins', 'fresh-uid')))
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'invites', CODE)))
    await assertFails(claiming())
  })
})

describe('people belong to their event', () => {
  const signedInAs = (uid: string) => testEnv.authenticatedContext(uid).firestore()

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'events', '2027'), { year: 2027, name: 'Apple Day 2027' })
      await setDoc(doc(db, 'events', '2027', 'people', 'p-one'), {
        firstName: 'Elliot', lastName: 'R', section: 'cubs',
      })
    })
  })

  it('is a separate record in each event, sharing only an id if somebody reuses one', async () => {
    /*
      There is no system-wide register any more. Two events may both hold somebody called
      Elliot; nothing links them, and nothing has to. That is the trade: no per-person
      history, and no children's contact details outliving the Apple Day they were collected
      for.
    */
    const db = asAdmin()
    await assertSucceeds(getDoc(doc(db, 'events', EVENT, 'people', 'p-one')))
    await assertSucceeds(getDoc(doc(db, 'events', '2027', 'people', 'p-one')))
  })

  it('deleting from one event leaves the other alone', async () => {
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'events', EVENT, 'people', 'p-one')))
    const survivor = await getDoc(doc(asAdmin(), 'events', '2027', 'people', 'p-one'))
    expect(survivor.exists()).toBe(true)
  })

  it('is not readable at the old top-level path by anybody', async () => {
    // The shared collection is no longer part of the model; nothing should be able to read
    // or write it, whatever is left sitting there.
    await assertFails(getDoc(doc(asAdmin(), 'people', 'p-one')))
    await assertFails(
      setDoc(doc(asAdmin(), 'people', 'p-new'), { firstName: 'Nobody', lastName: '' }),
    )
    await assertFails(getDoc(doc(signedInAs('stranger'), 'people', 'p-one')))
  })
})

describe('the kinds of request a pass may send', () => {
  it('accepts every one the form offers', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'passes', 'tok-req'), {
        eventId: EVENT, personId: 'p-one', role: 'volunteer',
      })
    })
    const anon = testEnv.unauthenticatedContext().firestore()

    // "Need a hand" was added to the form; the rules cap the field to a list, so a kind the
    // form can send but the rules do not know is a request that silently fails to send.
    for (const kind of ['swap', 'cancel', 'help', 'question']) {
      await assertSucceeds(
        setDoc(doc(anon, 'events', EVENT, 'swapRequests', `r-${kind}`), {
          passToken: 'tok-req', kind, slotId: '', message: '', createdAt: Date.now(),
        }),
      )
    }
  })

  it('still refuses a kind nothing can render', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'passes', 'tok-req'), {
        eventId: EVENT, personId: 'p-one', role: 'volunteer',
      })
    })
    const anon = testEnv.unauthenticatedContext().firestore()
    await assertFails(
      setDoc(doc(anon, 'events', EVENT, 'swapRequests', 'r-bad'), {
        passToken: 'tok-req', kind: 'refund', slotId: '', message: '', createdAt: Date.now(),
      }),
    )
  })
})

describe('removing an event', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'events', EVENT, 'people', 'p-gone'), { firstName: 'Elliot' })
      await setDoc(doc(db, 'passes', 'tok-gone'), { eventId: EVENT, personId: 'p-gone' })
    })
  })

  it('is an admin’s, not an organizer’s', async () => {
    /*
      The one action in the app that nothing else can undo: Firestore does not cascade, so
      the app walks the tree itself, and what it removes is a year of records.
    */
    await assertFails(deleteDoc(doc(asOrganizer(), 'events', EVENT)))
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'events', EVENT)))
  })

  it('lets an admin empty what is under it', async () => {
    // The walk deletes children first; every one of those needs to be permitted too.
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'events', EVENT, 'people', 'p-gone')))
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'passes', 'tok-gone')))
  })

  it('cannot take the audit trail with it', async () => {
    /*
      Create-only by rule, for anybody. "Who removed 2025" is exactly what a log is for, so
      a removal is deliberately never quite total — and the screen says so rather than
      implying otherwise.
    */
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'audit', 'e-keep'), {
        at: Date.now(), by: ADMIN, action: 'deleted', entity: 'event',
        entityId: EVENT, eventId: null, summary: 'Removed it',
      })
    })
    await assertFails(deleteDoc(doc(asAdmin(), 'audit', 'e-keep')))
  })
})

describe('a read-only account', () => {
  /*
    Somebody asked how the day went rather than running it — a treasurer, a committee member.
    Without this they get an organizer's account, which is how read-only people end up able
    to edit the board, or they get screenshots.

    The rules are the guarantee. The menu offers a viewer fewer screens and the screens offer
    them nothing to press, but neither of those is a defence: both live in a bundle anybody
    can read.
  */
  it('reads the schedule, the people and the money', async () => {
    const db = asViewer()
    await assertSucceeds(getDoc(doc(db, 'events', EVENT)))
    await assertSucceeds(getDoc(doc(db, 'events', EVENT, 'people', 'p-one')))
    await assertSucceeds(getDocs(collection(db, 'events', EVENT, 'assignments')))
    await assertSucceeds(getDocs(collection(db, 'events', EVENT, 'jars')))
    await assertSucceeds(getDoc(doc(db, 'locations', 'braemar')))
    await assertSucceeds(getDoc(doc(db, 'sections', 'cubs')))
  })

  it('cannot move anybody on the board', async () => {
    await assertFails(
      setDoc(doc(asViewer(), 'events', EVENT, 'assignments', 'a1'), {
        slotId: 'fri-1700', locationId: 'braemar', personId: 'p-one', status: 'planned',
      }),
    )
  })

  it('cannot touch the money', async () => {
    await assertFails(
      setDoc(doc(asViewer(), 'events', EVENT, 'jars', 'fri-jar-1'), {
        jarNumber: 1, day: 'fri', locationId: 'braemar', status: 'counted',
        amount: 100, method: 'cash',
      }),
    )
    await assertFails(
      setDoc(doc(asViewer(), 'events', EVENT, 'notes', 'n1'), {
        text: 'anything', at: Date.now(), by: 'v@example.org',
      }),
    )
  })

  it('cannot change a person, a location or a section', async () => {
    await assertFails(
      setDoc(doc(asViewer(), 'events', EVENT, 'people', 'p-one'), { firstName: 'Renamed' },
        { merge: true }),
    )
    await assertFails(
      setDoc(doc(asViewer(), 'locations', 'braemar'), { name: 'Renamed' }, { merge: true }),
    )
    await assertFails(
      setDoc(doc(asViewer(), 'sections', 'cubs'), { name: 'Renamed' }, { merge: true }),
    )
  })

  it('cannot let itself or anybody else in', async () => {
    // The one that would make the tier pointless.
    await assertFails(
      setDoc(doc(asViewer(), 'admins', VIEWER), { level: 'admin' }, { merge: true }),
    )
    await assertFails(
      setDoc(doc(asViewer(), 'admins', 'somebody-new'), { level: 'admin', addedAt: 1 }),
    )
    await assertFails(getDocs(collection(asViewer(), 'admins')))
  })

  it('is kept out of the reminders and the requests', async () => {
    // Sending is an action, and both hold contact details for people they are not chasing.
    await assertFails(getDocs(collection(asViewer(), 'events', EVENT, 'reminders')))
    await assertFails(getDocs(collection(asViewer(), 'events', EVENT, 'swapRequests')))
    await assertFails(getDocs(collection(asViewer(), 'reminderTemplates')))
  })

  it('cannot read the audit log, which is admin work', async () => {
    await assertFails(getDocs(collection(asViewer(), 'audit')))
  })
})

describe('a level nobody recognises', () => {
  /*
    The trapdoor this replaced: `isAdmin` was "on the roster and not an organizer", so a
    level added later — or mistyped — was a full admin. Asked positively, an unrecognised
    level reads and nothing more, which is the way round this should fail.
  */
  it('can read, because being on the roster is what reading needs', async () => {
    await assertSucceeds(getDoc(doc(asStranger(), 'events', EVENT)))
  })

  it('is not an admin', async () => {
    await assertFails(
      setDoc(doc(asStranger(), 'admins', 'somebody-new'), { level: 'admin', addedAt: 1 }),
    )
    await assertFails(
      setDoc(doc(asStranger(), 'sections', 'cubs'), { name: 'Renamed' }, { merge: true }),
    )
  })

  it('is not an organizer either', async () => {
    await assertFails(
      setDoc(doc(asStranger(), 'events', EVENT, 'jars', 'j1'), {
        jarNumber: 1, day: 'fri', locationId: 'braemar', status: 'counted',
        amount: 10, method: 'cash',
      }),
    )
  })
})

describe('money going out', () => {
  /*
    A float sent to a shop, apples bought out of the takings, a payment handed back. Real
    movements against the day's total, and the only honest way to record one is as what it
    is — otherwise it goes in a note and the figure stays wrong.

    The line follows the jar number. Where there is one, somebody is counting coins and a
    minus sign can only be a typo; where there is not, it is a direction.
  */
  const money = (over: Record<string, unknown>) => ({
    jarNumber: null, day: 'fri', locationId: 'braemar', status: 'counted',
    method: 'cash', ...over,
  })

  it('records a negative amount with no jar number', async () => {
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'jars', 'float-out'), money({ amount: -50 })),
    )
  })

  it('refuses a negative amount on a numbered jar', async () => {
    await assertFails(
      setDoc(
        doc(asOrganizer(), 'events', EVENT, 'jars', 'jar-7'),
        money({ jarNumber: 7, amount: -50 }),
      ),
    )
  })

  it('still bounds it, so a typo cannot swallow the year', async () => {
    await assertFails(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'jars', 'silly'), money({ amount: -10001 })),
    )
  })

  it('leaves a jar that is still out with no amount at all', async () => {
    // Null, not zero: a jar on the street is not a jar that came back empty.
    await assertFails(
      setDoc(
        doc(asOrganizer(), 'events', EVENT, 'jars', 'out-1'),
        money({ jarNumber: 3, status: 'out', amount: 0 }),
      ),
    )
  })
})

describe('restoring a year from a file', () => {
  /*
    The only way back from a mistake on the free plan, so it is worth knowing the rules do
    not stop half of it. A restore writes the shops and sections the year names, the event
    itself, its records, and the passes so links already handed out still work — and those
    sit behind four different rules.
  */
  it('lets an admin write every part of one', async () => {
    const db = asAdmin()
    await assertSucceeds(setDoc(doc(db, 'sections', 'cubs'), { name: 'Cubs', order: 2 }))
    await assertSucceeds(setDoc(doc(db, 'locations', 'restored'), { name: 'A shop' }))
    await assertSucceeds(setDoc(doc(db, 'events', '2024'), { year: 2024, name: 'Apple Day 2024' }))
    await assertSucceeds(
      setDoc(doc(db, 'events', '2024', 'people', 'p-1'), { firstName: 'Alex' }),
    )
    await assertSucceeds(
      setDoc(doc(db, 'passes', 'tok-restored'), { eventId: '2024', personId: 'p-1' }),
    )
  })

  it('refuses an organizer the parts that are an admin’s', async () => {
    // Creating a year and touching the sections are admin work, so a restore is too.
    await assertFails(
      setDoc(doc(asOrganizer(), 'events', '2024'), { year: 2024, name: 'Apple Day 2024' }),
    )
    await assertFails(
      setDoc(doc(asOrganizer(), 'sections', 'cubs'), { name: 'Renamed' }, { merge: true }),
    )
  })

  it('refuses a viewer all of it', async () => {
    await assertFails(
      setDoc(doc(asViewer(), 'events', '2024'), { year: 2024, name: 'Apple Day 2024' }),
    )
    await assertFails(
      setDoc(doc(asViewer(), 'passes', 'tok-restored'), { eventId: '2024', personId: 'p-1' }),
    )
  })
})
