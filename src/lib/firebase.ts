import { initializeApp } from 'firebase/app'
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

/**
 * Firebase client.
 *
 * Offline persistence is on deliberately, not as a nicety. St Jacobs Market and a couple
 * of the plazas have poor coverage, and jar entry has to keep working with no signal and
 * sync when it comes back.
 */

const useEmulator = import.meta.env.VITE_USE_EMULATOR === '1'

// Emulator mode needs no real credentials, so local development works with zero setup.
/*
  Which emulator, and which project inside it.

  Firestore keeps projects apart — the id is in the path, and a document written under one
  is invisible to another. Auth does not: every request reaches it without a project in the
  path, and the emulator answers them all from one set of accounts however the client is
  configured. Signing in against a second project therefore creates the account in the
  first, which is a fine way to write test users into the data you actually care about.

  So a sandbox is a whole second emulator, on its own ports, rather than another project id
  inside the one you are working in. `make firstrun` starts one. These three settings are
  what point the app at it; unset, everything is the ordinary local setup.
*/
const emulatorProject =
  (import.meta.env.VITE_EMULATOR_PROJECT as string | undefined) ?? 'apple-day-local'
const firestorePort = Number(import.meta.env.VITE_EMULATOR_FIRESTORE_PORT ?? 8080)
const authPort = Number(import.meta.env.VITE_EMULATOR_AUTH_PORT ?? 9099)

const config = useEmulator
  ? { projectId: emulatorProject, apiKey: 'emulator', authDomain: 'localhost' }
  : {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
      appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
    }

/**
 * What is missing from this build's Firebase config, if anything.
 *
 * Vite inlines these at build time, so a blank one is a literal `''` compiled into the
 * bundle rather than a setting to be supplied later. Firebase accepts that happily and then
 * refuses at sign-in with `auth/api-key-not-valid` — an error about a key, on a screen with
 * no keys on it, in an app that is already deployed.
 *
 * Exported so the sign-in screen can say what is actually wrong. `make deploy` checks the
 * same thing before building, which is where it should be caught; this is for a build that
 * got out anyway.
 */
export const missingConfig: string[] = useEmulator
  ? []
  : (
      [
        ['VITE_FIREBASE_API_KEY', config.apiKey],
        ['VITE_FIREBASE_AUTH_DOMAIN', config.authDomain],
        ['VITE_FIREBASE_PROJECT_ID', config.projectId],
        ['VITE_FIREBASE_APP_ID', (config as { appId?: string }).appId],
      ] as const
    )
      .filter(([, value]) => !value)
      .map(([name]) => name)

export const app = initializeApp(config)

export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})

export const auth = getAuth(app)

if (useEmulator) {
  connectFirestoreEmulator(db, '127.0.0.1', firestorePort)
  connectAuthEmulator(auth, `http://127.0.0.1:${authPort}`, { disableWarnings: true })
}

/** The event being worked on. One event per year; the id is the year. */
export const EVENT_ID = (import.meta.env.VITE_EVENT_ID as string | undefined) ?? '2026'

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(auth, new GoogleAuthProvider())
}

export async function signOutEverywhere(): Promise<void> {
  await signOut(auth)
}
