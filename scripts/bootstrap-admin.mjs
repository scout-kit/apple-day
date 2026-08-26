#!/usr/bin/env node
/*
  Print an invitation to create by hand in the Firebase console.

  For the two cases the app cannot do itself: the very first admin on a fresh project, and
  getting back in when nobody can. Both are the same problem — the Access screen is the only
  route the app offers, and it needs somebody already inside.

  An invitation is the way in rather than a roster entry, because a roster entry is keyed by
  a Firebase account id and you cannot get one. Signing in without access deletes the account
  it just made, so there is no id to read and paste; and even if there were, the rules forbid
  writing your own roster entry, which is what stops anybody promoting themselves.

  An invitation needs none of that. It is two fields, it is claimed by whoever opens the
  link, and it works before any account exists.

  Prints, and touches nothing. Deliberately: reaching a deployed project from here would mean
  a service-account key on somebody's laptop, which is a far worse thing to have lying around
  than a link that expires in thirty days.
*/

import { randomInt } from 'node:crypto'

// The same alphabet and length as a volunteer's pass link: no look-alike characters, because
// these get read down a phone.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const code = Array.from({ length: 22 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

const now = Date.now()
const tier = process.env.TIER === 'organizer' ? 'organizer' : 'admin'
const origin = (process.env.ORIGIN ?? '').replace(/\/+$/, '')

const line = (label, value) => `  ${label.padEnd(11)} ${value}`

console.log(`
Create this one document in the Firebase console, then open the link.

  Firestore Database -> Start collection

${line('Collection', 'invites')}
${line('Document ID', code)}

Fields:

${line('level', `string   ${tier}`)}
${line('invitedAt', `number   ${now}`)}

Then open:

  ${origin || '<your site>'}/join/${code}

Sign in with whichever Google account should be the ${tier}. The invitation is spent as you
use it, so the document disappears on its own — there is nothing to go back and tidy up.

It expires in 30 days. Until it is used, anybody holding this link becomes ${
  tier === 'admin' ? 'an admin' : 'an organizer'
}, so do not paste it anywhere it will outlive the next few minutes.
`)

if (!origin) {
  console.log(`Tip: ORIGIN=https://your-project.web.app make bootstrap-admin prints the whole link.\n`)
}
