#!/usr/bin/env node
/**
 * Check a group's `.env` before building against it.
 *
 * Vite inlines these at build time, so a blank one is not a missing setting at runtime — it
 * is a string literal `''` compiled into the bundle. Firebase then refuses at sign-in with
 * `auth/api-key-not-valid`, which says nothing about the file that caused it, and the app is
 * already deployed by the time anybody finds out.
 *
 * The deploy used to check only that the file existed. Copying `.env.example` and forgetting
 * to fill it in passed that check exactly as well as a real one.
 */

import { readFileSync, existsSync } from 'node:fs'

const group = process.argv[2]
if (!group) {
  console.error('Which group? node scripts/check-env.mjs <alias>')
  process.exit(1)
}

const path = `.env.${group}`
if (!existsSync(path)) {
  console.error(`Missing ${path}. Copy .env.example and fill it in.`)
  process.exit(1)
}

/** `KEY=value` lines, ignoring comments and blanks. Quotes are Vite's to strip, not ours. */
const values = new Map()
for (const line of readFileSync(path, 'utf8').split('\n')) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
  if (match) values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''))
}

// Everything `src/lib/firebase.ts` reads. Without all four there is no usable app.
const required = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
]

const missing = required.filter((key) => !values.get(key))
const problems = []

if (missing.length > 0) {
  problems.push(
    `${path} has no value for:\n` +
      missing.map((k) => `    ${k}`).join('\n') +
      '\n  Firebase refuses these at sign-in, not at build, so the site would deploy and\n' +
      '  then fail with "api-key-not-valid" for everybody.',
  )
}

/*
  A key that is present but not shaped like one.

  Catches the copy that took a line break, a stray quote, or the surrounding JSON from the
  console snippet — all of which produce the same "api-key-not-valid" as a blank, and none
  of which are visible when you glance at the file.

  A warning rather than a failure: this is a guess about Google's format, and being wrong
  about it must not stop a deploy.
*/
const key = values.get('VITE_FIREBASE_API_KEY')
if (key && !/^AIza[A-Za-z0-9_-]{35}$/.test(key)) {
  console.warn(
    `  Note: VITE_FIREBASE_API_KEY does not look like a Firebase web key, which is 39\n` +
      `  characters beginning "AIza". Yours is ${key.length}. Check for a stray quote,\n` +
      '  a line break, or the rest of the config snippet coming along with it.',
  )
}

/*
  The one that is worse than a blank.

  `.env` is loaded for every mode, so a copied line here points a deployed site at a
  developer's laptop. It looks entirely normal until somebody tries to sign in.
*/
if (values.get('VITE_USE_EMULATOR')) {
  problems.push(
    `${path} sets VITE_USE_EMULATOR, which would build a site that talks to localhost.\n` +
      '  Remove it — `make up` passes it as a shell variable and needs it in no file.',
  )
}

// Not fatal: reminders fall back to the address the page is served from, which is right in
// production and wrong only when testing locally.
if (!values.get('VITE_PUBLIC_ORIGIN')) {
  console.warn(
    `  Note: ${path} has no VITE_PUBLIC_ORIGIN, so volunteer links use whatever address\n` +
      '  the page is served from. Fine in production; wrong if you ever send from a laptop.',
  )
}

/*
  Not fatal either, and said once rather than every build.

  App Check is the difference between "the rules allow this request" and "this request came
  from our app". A group can run an Apple Day without it, so this is a note; but a deploy
  that has never heard of it is worth telling, because the setting has to be shipped and seen
  working before enforcement can be switched on.
*/
if (!values.get('VITE_APPCHECK_SITE_KEY')) {
  console.warn(
    `  Note: ${path} has no VITE_APPCHECK_SITE_KEY, so App Check is off. Anybody who reads\n` +
      '  the config out of the built site can reach the project with their own script,\n' +
      '  bound only by the rules. docs/deploying.html has the four-step setup.',
  )
}

if (problems.length > 0) {
  console.error(`\n${problems.join('\n\n')}\n`)
  process.exit(1)
}

console.log(`  ${path} has the Firebase config it needs.`)
