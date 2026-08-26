#!/usr/bin/env node
/**
 * Load local data into the Firestore emulator.
 *
 * Talks to the emulator's REST API rather than pulling in firebase-admin — there is no
 * service account involved locally, and one less dependency to keep current.
 *
 * Reads two files, neither of them committed and both optional:
 *
 *   data/locations.seed.json   the shops to start with
 *   data/local/people.json     a roster, which is minors' names and so never shared
 *
 * They are yours to write. Nothing here ships with anybody's data in it, and `make firstrun`
 * exists for the other way round — an empty database, to see what a new group sees.
 */

import { randomInt } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT = process.env.GCLOUD_PROJECT ?? 'apple-day-local'
const FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099'
const EVENT_ID = process.env.EVENT_ID ?? '2026'
const APP = process.env.APP_ORIGIN ?? 'http://localhost:5173'

const base = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`

/** Encode a plain JS value in Firestore's REST value format. */
function encode(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value }
  }
  if (typeof value === 'string') return { stringValue: value }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encode) } }
  }
  return { mapValue: { fields: encodeFields(value) } }
}

function encodeFields(object) {
  return Object.fromEntries(
    Object.entries(object)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, encode(v)]),
  )
}

async function put(path, data) {
  const response = await fetch(`${base}/${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer owner',
    },
    body: JSON.stringify({ fields: encodeFields(data) }),
  })
  if (!response.ok) {
    throw new Error(`${path}: ${response.status} ${await response.text()}`)
  }
}

/**
 * Does this document already exist?
 *
 * The seed runs on every `make up`, against an emulator that keeps its data between runs.
 * Anything a human may have edited therefore has to be created only, never rewritten: a
 * REST PATCH without an update mask replaces the whole document, so re-seeding was
 * silently reverting availability edits, hand-entered contact details, library hours and
 * the Years screen's settings on every app start.
 */
async function exists(path) {
  const response = await fetch(`${base}/${path}`, {
    headers: { Authorization: 'Bearer owner' },
  })
  return response.ok
}

/** Write only if absent. Returns whether it wrote. `SEED_FORCE=1` overrides. */
async function create(path, data) {
  if (process.env.SEED_FORCE !== '1' && (await exists(path))) return false
  await put(path, data)
  return true
}

async function emulatorReachable() {
  try {
    const response = await fetch(`http://${FIRESTORE}/`)
    return response.status < 500
  } catch {
    return false
  }
}

/**
 * List the accounts in the Auth emulator.
 *
 * Note the endpoint: `POST .../accounts:query`, the Admin API's list call. The
 * emulator-specific `/emulator/v1/projects/{p}/accounts` path accepts DELETE only and
 * answers a GET with 405 — an earlier version of this script used it and silently
 * reported "no accounts" no matter who had signed in, so admin was never granted.
 * Failures here are thrown rather than swallowed for exactly that reason.
 */
async function listAccounts() {
  const response = await fetch(
    `http://${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:query`,
    {
      method: 'POST',
      headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
      body: '{}',
    },
  )
  if (!response.ok) {
    throw new Error(
      `Could not list Auth emulator accounts (${response.status}): ${await response.text()}`,
    )
  }
  const { userInfo = [] } = await response.json()
  return userInfo
}

/**
 * Write an invitation and return the link that claims it.
 *
 * The way in from a cold start, and the only one there is. Granting rights needs an account
 * id, and there is no way to get one: signing in without access deletes the account it just
 * made, so "sign in, be refused, be granted" is not a sequence that can happen.
 *
 * An invitation runs the other way round. It exists before any account does, and whoever
 * opens the link is who it lets in. Two fields, the same as the console route a real
 * deployment uses, so what works here is what works there.
 */
async function createInvitation(level) {
  // The same alphabet as a volunteer's pass link, with the look-alike characters left out.
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const code = Array.from({ length: 22 }, () => alphabet[randomInt(alphabet.length)]).join('')

  await put(`invites/${code}`, {
    label: 'Local development',
    level,
    invitedAt: Date.now(),
    invitedBy: 'make admin',
    note: '',
  })

  return `${APP.replace(/\/+$/, '')}/join/${code}`
}

/**
 * Grant organizer rights to an account that already exists.
 *
 * Only useful for changing the tier of somebody already in — an organizer who should be an
 * admin. Nobody reaches this from a cold start, because an account with no access does not
 * survive its own sign-in.
 */
async function grantAdmins(only) {
  const accounts = await listAccounts()
  const wanted = only
    ? accounts.filter((u) => u.email === only || u.localId === only)
    : accounts

  if (only && wanted.length === 0) {
    /*
      Nobody has signed in yet is a different problem from the wrong address, and it is the
      one somebody hits first.

      There is no uid to grant until an account exists, which is the same order production
      works in: sign in, be refused, and be added by somebody who can see the id. Saying
      only "accounts: none" reads as though something is broken, when the next step is
      simply to go and sign in.
    */
    if (accounts.length === 0) return []
    const known = accounts.map((u) => u.email || u.localId).join(', ')
    throw new Error(
      `No account matching "${only}" in ${PROJECT}. Signed in there: ${known}`,
    )
  }

  for (const user of wanted) {
    // `level` is only written for the lesser tier. An entry with no level is a full admin,
    // which is what every entry written before the two tiers existed is.
    const level = process.env.ROLE === 'organizer' ? { level: 'organizer' } : {}
    await put(`admins/${user.localId}`, {
      addedAt: Date.now(),
      email: user.email ?? '',
      ...level,
    })
  }
  return wanted.map((u) => ({
    label: u.email || u.localId,
    uid: u.localId,
    level: process.env.ROLE === 'organizer' ? 'organizer' : 'admin',
  }))
}

/** "created 3 of 18 locations (15 already there, left alone)" */
function report(what, created, total) {
  const kept = total - created
  console.log(
    kept === 0
      ? `created ${created} ${what}`
      : `created ${created} of ${total} ${what} (${kept} already there, left alone)`,
  )
}

async function main() {
  if (!(await emulatorReachable())) {
    console.error(
      `Cannot reach the Firestore emulator at ${FIRESTORE}.\n` +
        'Start it first:  npm run emulators',
    )
    process.exit(1)
  }

  // `make admin` sets this: skip the data load and only touch the admin roster.
  const adminOnly = process.env.ADMIN_ONLY === '1'
  if (adminOnly) {
    const level = process.env.ROLE === 'organizer' ? 'organizer' : 'admin'

    /*
      Promote whoever is already in, if anybody is. Otherwise hand out an invitation.

      Both are wanted, and which one applies is not worth asking about: from an empty
      emulator there is no account to promote, and once you are in there is no invitation to
      claim. Checking is quicker than choosing.
    */
    const granted = await grantAdmins(process.env.ADMIN_EMAIL || undefined)
    if (granted.length > 0) {
      console.log('granted access to:')
      for (const { label, uid, level: got } of granted) {
        console.log(`  ${label}  (${uid})  ${got}`)
      }
      console.log('\nThe app picks this up on its own — no reload, no signing in again.')
      return
    }

    const link = await createInvitation(level)
    console.log(
      `Nobody has signed in yet, so here is an invitation instead.\n\n` +
        `  ${link}\n\n` +
        `Open it and sign in — any account will do — and you are ${
          level === 'admin' ? 'an admin' : 'an organizer'
        }.\n` +
        `Signing in without one of these gets you nothing: the account it creates is\n` +
        `deleted straight away, which is what stops a real project filling up with\n` +
        `strangers. Same on a deployed site, where the link comes from the console.`,
    )
    return
  }

  const locationsPath = join(ROOT, 'data', 'locations.seed.json')
  if (!existsSync(locationsPath)) {
    console.error(
      'data/locations.seed.json is missing.\n\n' +
        'It is your own data, so it is not in this repository. Create it as a JSON array:\n' +
        '  [{ "id": "corner-grocers", "name": "Corner Grocers",\n' +
        '     "address": "640 Parkside Drive", "groupCode": "CG" }]\n\n' +
        'Or skip it entirely and add locations on the Locations screen — `make firstrun`\n' +
        'starts an empty emulator for exactly that.',
    )
    process.exit(1)
  }

  const locations = JSON.parse(readFileSync(locationsPath, 'utf8'))
  let newLocations = 0
  for (const { id, _eventSettings, ...fields } of locations) {
    if (await create(`locations/${id}`, fields)) newLocations += 1
  }
  report('locations in the shared library', newLocations, locations.length)

  // Which of them this year uses, and in what order. Per-year, so setting up the next
  // Apple Day cannot rewrite what a previous one recorded — and create-only, so it cannot
  // undo an organizer's on/off switches or their ordering either.
  let newSettings = 0
  for (const { id, _eventSettings } of locations) {
    const settings = _eventSettings ?? { active: true, priority: 99 }
    if (await create(`events/${EVENT_ID}/eventLocations/${id}`, settings)) newSettings += 1
  }
  report(`location settings for ${EVENT_ID}`, newSettings, locations.length)

  // The group's sections. Create-only, like everything else: renaming one here must not
  // be undone by the next `make up`.
  const SECTIONS = [
    { id: 'beavers', name: 'Beavers', youth: true, order: 1, tone: 'amber', aliases: ['beaver'] },
    { id: 'cubs', name: 'Cubs', youth: true, order: 2, tone: 'green', aliases: ['cub'] },
    { id: 'scouts', name: 'Scouts', youth: true, order: 3, tone: 'red', aliases: ['scout'] },
    {
      id: 'venturers', name: 'Venturers', youth: true, order: 4, tone: 'blue',
      aliases: ['venturer', 'venture', 'ventures'],
    },
    {
      id: 'scouters', name: 'Scouters', youth: false, order: 5, tone: 'grey',
      aliases: ['scouter', 'leader', 'parent', 'adult'],
    },
  ]
  let newSections = 0
  for (const { id, ...fields } of SECTIONS) {
    if (await create(`sections/${id}`, fields)) newSections += 1
  }
  report('sections', newSections, SECTIONS.length)

  const peoplePath = join(ROOT, 'data', 'local', 'people.json')
  let people = []
  if (existsSync(peoplePath)) {
    people = JSON.parse(readFileSync(peoplePath, 'utf8'))
    let newPeople = 0
    for (const { id, pairWithPersonId, ...fields } of people) {
      // Under the event: people belong to the Apple Day they took part in, not to the app.
      const created = await create(`events/${EVENT_ID}/people/${id}`, {
        ...fields,
        pairWithPersonId: pairWithPersonId || null,
      })
      if (created) newPeople += 1
    }
    report('people (from data/local/people.json)', newPeople, people.length)
  } else {
    console.log('no data/local/people.json — skipping people')
  }

  // Give everyone full availability so the board is usable straight away. Real
  // availability arrives through the CSV import.
  const FRI = ['fri-1700', 'fri-1800', 'fri-1900', 'fri-2000']
  const SAT = [
    'sat-0700', 'sat-0800', 'sat-0900', 'sat-1000',
    'sat-1100', 'sat-1200', 'sat-1300', 'sat-1400',
  ]
  let newSignups = 0
  for (const person of people) {
    const created = await create(`events/${EVENT_ID}/signups/su-${person.id}`, {
      personId: person.id,
      availability: { fri: FRI, sat: SAT },
      attendingWithYouth: true,
      notes: '',
      sourceRow: 0,
      importedAt: Date.now(),
    })
    if (created) newSignups += 1
  }
  if (people.length > 0) report('placeholder signups', newSignups, people.length)

  // The hours this event staffs. Editable per year on the Years screen — these are only
  // the starting values, taken from how 2025 actually ran.
  const createdEvent = await create(`events/${EVENT_ID}`, {
    // A free-text name: an event is not necessarily a year.
    name: `Apple Day ${EVENT_ID}`,
    year: Number(EVENT_ID),
    fridayDate: `${EVENT_ID}-10-02`,
    saturdayDate: `${EVENT_ID}-10-03`,
    support: [],
    supportNote: '',
    arrivalNote: '',
    // Where the event runs from. Set on the Events screen, from the location library.
    baseLocationId: null,
    status: 'draft',
    schedule: {
      fri: { startMin: 17 * 60, endMin: 21 * 60 },
      sat: { startMin: 7 * 60, endMin: 15 * 60 },
    },
    // One hour shifts, no handover overlap. All editable on the Events screen, including
    // a whole-day mode for events where nobody is rostered to an hour.
    shiftMode: 'shifts',
    shiftMinutes: 60,
    overlapMinutes: 0,
  })
  console.log(
    createdEvent
      ? `created event ${EVENT_ID}`
      : `event ${EVENT_ID} already exists, left as it is`,
  )

  console.log(
    '\nExisting documents are never rewritten — set SEED_FORCE=1 to overwrite them.',
  )

  const granted = await grantAdmins(process.env.ADMIN_EMAIL)
  if (granted.length > 0) {
    console.log('\ngranted organizer access to:')
    for (const { label, uid } of granted) console.log(`  ${label}  (${uid})`)
    console.log('\nThe app picks this up on its own — no reload, no signing in again.')
  } else {
    console.log(
      '\nNobody has signed in yet, so there is no account to make an organizer.\n' +
        'Open the app, click "Organizer sign in", then run this again.',
    )
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
