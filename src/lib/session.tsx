import { onAuthStateChanged } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { auditedBatch, auditedDelete } from './audit'
import { auth } from './firebase'
import { isFatalClientFailure } from '../domain/clientFailure'
import { recoverFromFatalFailure } from './recover'
import { toPass } from '../domain/passes'
import type { PassData } from '../domain/passes'
export type { PassData }
import { paths } from './paths'

/**
 * Who is using the app, and what they may do.
 *
 * There is no server to mint a token with a role in it, so a role is resolved by reading
 * the one document the rules already let you read about yourself: `admins/{uid}`.
 *
 * A volunteer has no session at all. Their pass link is the whole of their access.
 */

/**
 * What somebody may do.
 *
 * Both are real accounts on the roster. An organizer runs the event — builds the schedule,
 * checks people in, counts jars, publishes — but does not change its shape: the library,
 * the sections and the events are shared across years, so a wrong edit there is wrong for
 * every year at once.
 */
export type Role = 'admin' | 'organizer' | 'volunteer' | 'none'

/** Anybody on the roster, whichever tier. Used to gate the screens that run the event. */
export function runsTheEvent(role: Role): boolean {
  return role === 'admin' || role === 'organizer'
}

/*
 * What each tier may change.
 *
 * Each of these matches a rule in `firestore.rules`. Showing a control the rules will refuse
 * is worse than not showing it: the refusal arrives after the click, on something that
 * looked like it would work.
 *
 * The line is not "shared between years". What an admin keeps is the work that cannot be
 * undone or noticed later: who gets in, what every past year is read through, and anything
 * whose removal orphans records nothing in the app can put back.
 */

/** Add a shop, fix an address, correct a map link. */
export function canEditLibrary(role: Role): boolean {
  return runsTheEvent(role)
}

/**
 * Remove a shop from the library altogether.
 *
 * Three years of jars and assignments hang off a location, and unlike a wrong address an
 * orphaned year cannot be spotted and fixed afterwards.
 */
export function canRemoveLibrary(role: Role): boolean {
  return role === 'admin'
}

/** Change the year being run: its dates, its hours, the number to ring. */
export function canEditEvent(role: Role): boolean {
  return runsTheEvent(role)
}

/** Start a new year, or delete one — a year of jars, shifts and audit entries with it. */
export function canAddEvent(role: Role): boolean {
  return role === 'admin'
}

/**
 * Change the sections.
 *
 * Every past year's figures are grouped by these, so a rename quietly changes how all of
 * them read.
 */
export function canEditSetup(role: Role): boolean {
  return role === 'admin'
}

export interface Session {
  user: User | null
  role: Role
  loading: boolean
}

const SessionContext = createContext<Session>({
  user: null,
  role: 'none',
  loading: true,
})

/**
 * Turn an invitation into access, for the account that just signed in.
 *
 * Reads the invitation for this account's own verified address and writes the roster entry
 * it describes. The rules check the address against the token, the tier against the
 * invitation, and that the invitation is fresh — so the worst this can do is fail.
 */
/**
 * An invitation this account has already outlived.
 *
 * Only a first sign-in claims one; after that the roster entry exists and that branch is
 * never taken. So an invitation left behind by a sign-in that predates claiming sits on the
 * admin's "waiting to sign in" list for somebody already in, and a list of people to chase
 * that fills with people already here stops being read.
 *
 * Deliberately not a roster write: the tier on an old invitation may be one an admin has
 * since changed, and re-applying it would quietly undo them.
 */
async function discardSpentInvitation(user: User): Promise<void> {
  const email = user.email?.trim().toLowerCase()
  if (!email || !user.emailVerified) return

  try {
    // Read first: a blind delete costs a write on every sign-in to remove nothing.
    const invite = await getDoc(paths.invite(email))
    if (invite.exists()) {
      // Recorded, because "the invitation is gone and I never used it" is a thing somebody
      // says. The account is already on the roster here, so there is permission to write it.
      await auditedDelete(paths.invite(email), {
        entity: 'access',
        entityId: email,
        eventId: null,
        summary: `Cleared a spent invitation for ${email}`,
        fields: ['level'],
      })
    }
  } catch {
    // No permission to look, or it went while we were looking. Nothing owed either way.
  }
}

async function tryClaimInvitation(user: User): Promise<void> {
  const email = user.email?.trim().toLowerCase()
  if (!email || !user.emailVerified) return

  try {
    const invite = await getDoc(paths.invite(email))
    if (!invite.exists()) return
    const tier = (invite.data() as { level?: string }).level === 'organizer'
      ? 'organizer'
      : 'admin'
    await setDoc(paths.admin(user.uid), {
      email,
      level: tier,
      addedAt: Date.now(),
      addedBy: 'invitation',
    })

    /*
      After the roster write, and on its own — the one place the same-batch rule cannot hold.

      Writing an entry requires being on the roster, and the thing being recorded is getting
      onto the roster. Batched, the entry would be checked against the database as it is
      before the batch, and the refusal would take the roster write with it.

      So access is granted first and recorded second. A failed record leaves somebody in
      without a line saying so, which is the right way round to fail: the access screen still
      shows them, added `by invitation`.
    */
    try {
      const batch = auditedBatch({
        action: 'created',
        entity: 'access',
        entityId: user.uid,
        eventId: null,
        summary: `${email} accepted an invitation as ${tier}`,
        changes: [{ field: 'level', from: '—', to: tier }],
      })
      await batch.commit()
    } catch {
      // See above: the access stands either way.
    }

    /*
      Used up, so it stops being a job. The roster entry is what grants access; the
      invitation was only a way to name somebody before they had ever signed in.

      After the roster write, never before: the other order loses the invitation and grants
      nothing.
    */
    await auditedDelete(paths.invite(email), {
      entity: 'access',
      entityId: email,
      eventId: null,
      summary: `Used up the invitation for ${email}`,
      fields: ['level'],
    })
  } catch {
    // No invitation, or no permission to look: either way there is no access, which the
    // roster listener has already reported.
  }
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<Session>({
    user: null,
    role: 'none',
    loading: true,
  })

  useEffect(() => {
    // Listeners for the currently signed-in user, torn down whenever auth changes.
    let stopAdmin: (() => void) | null = null
    let retry: ReturnType<typeof setTimeout> | null = null

    const stopRoleListeners = (): void => {
      stopAdmin?.()
      stopAdmin = null
      if (retry !== null) clearTimeout(retry)
      retry = null
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      stopRoleListeners()

      if (!user) {
        setSession({ user: null, role: 'none', loading: false })
        return
      }

      // Signed in but not yet known. Without this the session carries the signed-out answer
      // for as long as the roster read takes, and the app says "you are not an organizer"
      // to somebody who has just signed in as one.
      setSession({ user, role: 'none', loading: true })

      // Watched, not fetched once. Being made an organizer happens outside the app, so a
      // one-shot read makes the grant appear to do nothing until a manual reload.
      let rostered: Role | null = null
      let claimAttempted = false

      const applyRole = (): void => {
        setSession({ user, role: rostered ?? 'none', loading: false })
      }

      const watchRoster = (attempt: number): void => {
        stopAdmin = onSnapshot(
          paths.admin(user.uid),
          (snap) => {
            // No level means a full admin. Reading such an entry as the lesser tier would
            // lock the group out of its own setup screens.
            const level = (snap.data() as { level?: string } | undefined)?.level
            rostered = snap.exists() ? (level === 'organizer' ? 'organizer' : 'admin') : null
            applyRole()
            /*
              No entry yet? See whether somebody invited this address.

              An invitation is keyed by email, which is all anyone knows about a person
              before they have signed in. The tier comes from the invitation and the rules
              check that it does. Attempted once and silently — a failure just means there
              was no invitation, which is the ordinary case.
            */
            if (!claimAttempted) {
              claimAttempted = true
              void (snap.exists() ? discardSpentInvitation(user) : tryClaimInvitation(user))
            }
          },
          /*
            A failure here is the read failing, not the answer being no. The rules let any
            signed-in user read their own roster entry, so somebody not on it gets a snapshot
            saying the document does not exist. An error means something else — usually the
            moment just after signing in, before the credential has reached Firestore.

            A Firestore listener that errors is finished: it does not retry when the token
            arrives. So one denied read on the way in would pin the role at `none` until a
            manual reload.

            Retried with a widening gap, and only a few times — still failing after a few
            seconds is not a race, and "no access" is then the honest answer. Unless the
            client itself is finished, where retrying only adds noise to a page that is
            already going to reload.
          */
          (error) => {
            stopAdmin = null
            if (isFatalClientFailure(error) || attempt >= 4) {
              rostered = null
              applyRole()
              if (isFatalClientFailure(error)) void recoverFromFatalFailure(error)
              return
            }
            retry = setTimeout(() => watchRoster(attempt + 1), 150 * 2 ** attempt)
          },
        )
      }

      watchRoster(0)
    })

    return () => {
      stopRoleListeners()
      unsubscribeAuth()
    }
  }, [])

  const value = useMemo(() => session, [session])
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export const useSession = (): Session => useContext(SessionContext)

/**
 * Read a pass by its token. Open to anyone — the 22-character token is the credential, and
 * `list` is closed so tokens cannot be harvested.
 */
/**
 * Watch a pass.
 *
 * A listener rather than a one-off read: the holder's location appears the moment an
 * organizer checks them in, and somebody standing at the table should not have to reload.
 * One document, so it is the same `get` the rules already allow.
 */
export function watchPass(
  token: string,
  onData: (pass: PassData | null) => void,
  onError: () => void,
): () => void {
  return onSnapshot(
    paths.pass(token),
    (snap) => onData(snap.exists() ? toPass(snap.data() as Record<string, unknown>) : null),
    onError,
  )
}


