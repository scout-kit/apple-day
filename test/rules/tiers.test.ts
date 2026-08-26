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
    await setDoc(doc(db, 'events', EVENT), { year: 2026, name: 'Apple Day 2026' })
    await setDoc(doc(db, 'locations', 'sobeys'), { name: 'Sobeys' })
    await setDoc(doc(db, 'sections', 'cubs'), { name: 'Cubs', order: 2 })
    await setDoc(doc(db, 'events', EVENT, 'people', 'p-one'), { firstName: 'Elliot', lastName: 'R' })
  })
})

const asAdmin = () => testEnv.authenticatedContext(ADMIN).firestore()
const asOrganizer = () => testEnv.authenticatedContext(ORGANIZER).firestore()

describe('an entry with no level is a full admin', () => {
  it('can still change the library', async () => {
    // The default that matters: reading a legacy entry as the lesser tier would have locked
    // the group out of its own setup screens.
    await assertSucceeds(
      setDoc(doc(asAdmin(), 'locations', 'sobeys'), { name: 'Sobeys Northfield' }),
    )
  })
})

describe('an organizer runs the event', () => {
  it('builds the schedule', async () => {
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'assignments', 'a1'), {
        slotId: 'fri-1700', locationId: 'sobeys', personId: 'p-one',
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
        jarNumber: 1, day: 'fri', locationId: 'sobeys', status: 'counted',
        amount: 100, method: 'cash',
      }),
    )
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'reconciliation', 'summary'), { deposit: 100 }),
    )
  })

  it('reads everything it needs to do any of that', async () => {
    for (const path of [
      ['locations', 'sobeys'],
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
    The line moved, deliberately.

    It used to be "shared between years", which put the wrong things on the wrong side of it:
    finding a shop's address is wrong happens standing outside the shop, and the person
    standing there could not fix it. What an admin keeps is not the wide work — it is the
    work that cannot be undone or noticed afterwards.
  */
  it('adds a shop and corrects an address', async () => {
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'locations', 'sobeys'), { name: 'Sobeys Northfield' }),
    )
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'locations', 'new-shop'), { name: 'The new one' }),
    )
  })

  it('cannot remove a shop from the library', async () => {
    // Three years of jars and assignments hang off a location id. A wrong address is
    // noticed and fixed; an orphaned year is not.
    await assertFails(deleteDoc(doc(asOrganizer(), 'locations', 'sobeys')))
  })

  it('sets which locations the year uses', async () => {
    // This year's shops are this year's schedule — the same decision as which hour somebody
    // works, made by the same person, often in the same sitting.
    await assertSucceeds(
      setDoc(doc(asOrganizer(), 'events', EVENT, 'eventLocations', 'sobeys'), {
        locationId: 'sobeys', active: true, priority: 1,
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
      This used to be admin-only, because a person was a system-wide record and removing one
      took every year's shifts with them. People are stored under their event now, so this is
      a decision about one Apple Day — exactly the sort somebody running the day should make.
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
    await assertSucceeds(setDoc(doc(asAdmin(), 'locations', 'sobeys'), { name: 'Renamed' }))
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
        slotId: 'fri-1700', locationId: 'sobeys', personId: 'p-one',
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
      Access used to be granted only out of band, which kept this collection out of reach of
      any signed-in session. Managing it in the app trades some of that away deliberately —
      the console at nine on a Friday was the worse problem — and what is left in its place
      is narrower: an admin may change anybody's entry except their own.

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
    await assertFails(getDoc(doc(asOrganizer(), 'invites', 'new@example.org')))
  })
})

describe('claiming an invitation', () => {
  const invite = (email: string, level: string, invitedAt = Date.now()) =>
    testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', email), {
        level, invitedAt, invitedBy: ADMIN, note: '',
      })
    })

  const signedInAs = (uid: string, email: string, verified = true) =>
    testEnv.authenticatedContext(uid, { email, email_verified: verified }).firestore()

  it('gets somebody in without anybody knowing their uid', async () => {
    // Which is the whole point: a uid does not exist until the first sign-in.
    await invite('new@example.org', 'organizer')
    await assertSucceeds(
      setDoc(doc(signedInAs('fresh-uid', 'new@example.org'), 'admins', 'fresh-uid'), {
        email: 'new@example.org', level: 'organizer', addedAt: 1, addedBy: 'invitation',
      }),
    )
  })

  it('cannot ask for a higher tier than it was invited to', async () => {
    await invite('new@example.org', 'organizer')
    await assertFails(
      setDoc(doc(signedInAs('fresh-uid', 'new@example.org'), 'admins', 'fresh-uid'), {
        email: 'new@example.org', level: 'admin', addedAt: 1, addedBy: 'invitation',
      }),
    )
  })

  it('cannot be claimed by somebody else’s account', async () => {
    await invite('new@example.org', 'admin')
    await assertFails(
      setDoc(doc(signedInAs('other-uid', 'other@example.org'), 'admins', 'other-uid'), {
        email: 'other@example.org', level: 'admin', addedAt: 1, addedBy: 'invitation',
      }),
    )
  })

  it('cannot be claimed into somebody else’s entry', async () => {
    await invite('new@example.org', 'admin')
    await assertFails(
      setDoc(doc(signedInAs('fresh-uid', 'new@example.org'), 'admins', 'someone-else'), {
        email: 'new@example.org', level: 'admin', addedAt: 1, addedBy: 'invitation',
      }),
    )
  })

  it('needs a verified address, so an unverified one cannot be asserted', async () => {
    await invite('new@example.org', 'admin')
    await assertFails(
      setDoc(
        doc(signedInAs('fresh-uid', 'new@example.org', false), 'admins', 'fresh-uid'),
        { email: 'new@example.org', level: 'admin', addedAt: 1, addedBy: 'invitation' },
      ),
    )
  })

  it('expires, because it is a standing grant to whoever holds that mailbox', async () => {
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000
    await invite('old@example.org', 'organizer', fortyDaysAgo)
    await assertFails(
      setDoc(doc(signedInAs('fresh-uid', 'old@example.org'), 'admins', 'fresh-uid'), {
        email: 'old@example.org', level: 'organizer', addedAt: 1, addedBy: 'invitation',
      }),
    )
  })

  it('does nothing for an address nobody invited', async () => {
    await assertFails(
      setDoc(doc(signedInAs('fresh-uid', 'stranger@example.org'), 'admins', 'fresh-uid'), {
        email: 'stranger@example.org', level: 'organizer', addedAt: 1, addedBy: 'invitation',
      }),
    )
  })
})

describe('an invitee reading their own invitation', () => {
  const signedInAs = (uid: string, email: string, verified = true) =>
    testEnv.authenticatedContext(uid, { email, email_verified: verified }).firestore()

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore()
      await setDoc(doc(db, 'invites', 'new@example.org'), {
        level: 'organizer', invitedAt: Date.now(), invitedBy: ADMIN, note: '',
      })
      await setDoc(doc(db, 'invites', 'other@example.org'), {
        level: 'admin', invitedAt: Date.now(), invitedBy: ADMIN, note: '',
      })
    })
  })

  it('can read it, which is how the app learns which tier to claim', async () => {
    /*
      The bug this covers made the whole invitation flow silently do nothing.

      The rules read the invitation on the claimant's behalf when it writes its roster entry,
      and that needs no read permission — so it looked fine. But the client has to learn the
      tier *before* it can write a matching entry, and asking was denied. The error was
      swallowed as "no invitation", which is the ordinary case, so nothing surfaced: an
      invited leader just kept seeing "no access yet".
    */
    await assertSucceeds(
      getDoc(doc(signedInAs('fresh-uid', 'new@example.org'), 'invites', 'new@example.org')),
    )
  })

  it('cannot read anybody else’s', async () => {
    await assertFails(
      getDoc(doc(signedInAs('fresh-uid', 'new@example.org'), 'invites', 'other@example.org')),
    )
  })

  it('cannot read one on an unverified address', async () => {
    await assertFails(
      getDoc(
        doc(signedInAs('fresh-uid', 'new@example.org', false), 'invites', 'new@example.org'),
      ),
    )
  })

  it('cannot walk the collection for addresses', async () => {
    const db = signedInAs('fresh-uid', 'new@example.org')
    await assertFails(getDocs(collection(db, 'invites')))
  })

  it('can use it up once it has been claimed', async () => {
    /*
      An invitation that outlives its claim is a job that never finishes: the person signed
      in, got their access, and stayed on the admin's "waiting to sign in" list — a list of
      people to chase that filled up with people already in.

      Only the address it names, and only verified, which is the same test that lets them
      read it and write themselves onto the roster.
    */
    await assertSucceeds(
      deleteDoc(doc(signedInAs('newbie', 'new@example.org'), 'invites', 'new@example.org')),
    )
  })

  it('cannot use up somebody else’s', async () => {
    await assertFails(
      deleteDoc(doc(signedInAs('newbie', 'new@example.org'), 'invites', 'other@example.org')),
    )
  })

  it('cannot use one up on an unverified address', async () => {
    // The same bar as claiming it: an address nobody has proved is not an identity.
    await assertFails(
      deleteDoc(
        doc(signedInAs('newbie', 'new@example.org', false), 'invites', 'new@example.org'),
      ),
    )
  })

  it('cannot change what it was invited to', async () => {
    await assertFails(
      setDoc(
        doc(signedInAs('fresh-uid', 'new@example.org'), 'invites', 'new@example.org'),
        { level: 'admin' },
        { merge: true },
      ),
    )
  })

  it('reads it and claims it, end to end', async () => {
    // The two halves together, which is the flow that was broken.
    const db = signedInAs('fresh-uid', 'new@example.org')
    const invite = await getDoc(doc(db, 'invites', 'new@example.org'))
    expect(invite.data()!.level).toBe('organizer')

    await assertSucceeds(
      setDoc(doc(db, 'admins', 'fresh-uid'), {
        email: 'new@example.org',
        level: invite.data()!.level,
        addedAt: Date.now(),
        addedBy: 'invitation',
      }),
    )
  })
})

describe('nothing in a claim is taken on trust', () => {
  const signedInAs = (uid: string, email: string) =>
    testEnv.authenticatedContext(uid, { email, email_verified: true }).firestore()

  const claim = (over: Record<string, unknown> = {}) => ({
    email: 'new@example.org',
    level: 'organizer',
    addedAt: Date.now(),
    addedBy: 'invitation',
    ...over,
  })

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'invites', 'new@example.org'), {
        level: 'organizer', invitedAt: Date.now(), invitedBy: ADMIN, note: '',
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

  it('cannot be re-claimed after an admin removes it, because the invitation goes too', async () => {
    await assertSucceeds(claiming())
    // What `removeAccess` does: the entry, then the invitation.
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'admins', 'fresh-uid')))
    await assertSucceeds(deleteDoc(doc(asAdmin(), 'invites', 'new@example.org')))
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
