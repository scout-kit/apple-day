import { initializeApp } from 'firebase/app'
import { ReCaptchaV3Provider, initializeAppCheck } from 'firebase/app-check'
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
import { forgetInvite } from './pendingInvite'

/**
 * Firebase client.
 *
 * Offline persistence is on deliberately, not as a nicety. Ashfield Market and a couple
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

/*
  App Check, when a site key has been configured.

  It answers a question the rules cannot: they say what a *request* may do, and App Check
  says whether the request came from this app at all. Without it, anybody who reads the
  Firebase config out of the bundle — it is in there, by design — can talk to the project
  with their own script and is bound only by the rules.

  What it costs is worth knowing before switching it on, because it is not a detail: on the
  web the only providers are reCAPTCHA v3 and reCAPTCHA Enterprise, so this loads Google's
  reCAPTCHA and lets it score every visitor. This module is reached from a volunteer's pass
  page too, so that includes a fourteen-year-old opening a link on a borrowed phone. Weigh
  that against what it protects: rules that already gate every write behind the roster and
  serve nothing publicly but one pass at a time.

  So it is off unless VITE_APPCHECK_SITE_KEY is set, and never against the emulator. The
  ordering matters on the way in: the client has to be sending tokens *before* enforcement is
  switched on in the console, or the app locks itself out the moment it is.

  Tokens refresh themselves. A failure here is not worth taking the app down for — with
  enforcement off nothing depends on it, and with enforcement on the rejection says so.
*/
const appCheckSiteKey = (import.meta.env.VITE_APPCHECK_SITE_KEY as string | undefined) ?? ''

export const appCheckOn = !useEmulator && appCheckSiteKey !== ''

if (appCheckOn) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    })
  } catch {
    /* Already initialised, or the provider refused. Nothing here depends on it yet. */
  }
}

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
  /*
    The invitation goes with them.

    A code kept past a sign-out is a grant waiting for whoever signs in next on this browser
    — which is how a brand-new account ends up an organizer with no link ever given to it.
    Dropped before signing out, so it is gone even if that fails.
  */
  forgetInvite()
  await signOut(auth)
}
