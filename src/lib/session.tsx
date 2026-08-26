import { deleteUser, onAuthStateChanged, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { getDoc, onSnapshot, writeBatch } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { recordInBatch } from './audit'
import { auth, db } from './firebase'
import { isFatalClientFailure } from '../domain/clientFailure'
import { recoverFromFatalFailure } from './recover'
import { toPass } from '../domain/passes'
import type { PassData } from '../domain/passes'
export type { PassData }
import { paths } from './paths'
import { forgetInvite, pendingInvite } from './pendingInvite'

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
  /**
   * An account was created by signing in, had no access, and was taken away again.
   *
   * Worth saying rather than leaving to be inferred. Without it the page flickers — signed
   * in, then signed out — and looks like sign-in failing, which is the one thing it did not
   * do. Held after the account is gone, so the message survives the `user` going null.
   */
  discarded: boolean
}

const SessionContext = createContext<Session>({
  user: null,
  role: 'none',
  loading: true,
  discarded: false,
})

/**
/**
 * Turn an invitation code into access, for the account that just signed in.
 *
 * The roster entry carries the code as `via`, which is what lets the rules read the
 * invitation and check the tier against it. They also check the code is fresh and that the
 * address written is the one on the token — so the worst this can do is fail.
 *
 * Whatever Google account they used. That is the whole point: an invitation addressed to an
 * email could only be claimed by an account carrying that address, which is a guess about
 * somebody else's arrangements and wrong often enough to matter.
 */
async function recordClaim(user: User, tier: 'admin' | 'organizer'): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'created',
    entity: 'access',
    // Never the code. An audit entry is read by admins and kept for years, and an invitation
    // code sitting in one would be a way in for anybody who could read the log.
    entityId: user.uid,
    eventId: null,
    summary: `Accepted an invitation as ${tier}`,
    changes: [{ field: 'level', from: '—', to: tier }],
  })
  await batch.commit()
}

async function claimInvite(user: User, code: string): Promise<boolean> {
  try {
    const invite = await getDoc(paths.invite(code))
    if (!invite.exists()) return false

    const tier =
      (invite.data() as { level?: string }).level === 'organizer' ? 'organizer' : 'admin'

    /*
      Granted and spent in one commit, which is what makes an invitation single-use.

      Both writes are permitted before either lands — the claim on the strength of the code,
      the delete on being signed in at all — so there is no ordering to get right and no
      window in between. Two writes with the delete second leaves the invitation standing
      whenever the second one fails, and it fails quietly: the account is in, the link still
      works, and the next person to sign in on that browser gets the tier too.
    */
    const batch = writeBatch(db)
    batch.set(paths.admin(user.uid), {
      email: user.email ?? '',
      level: tier,
      addedAt: Date.now(),
      addedBy: 'invitation',
      via: code,
    })
    batch.delete(paths.invite(code))
    await batch.commit()

    forgetInvite()

    /*
      The line saying so, afterwards and on its own.

      It cannot go in the batch above: writing to the log needs to be on the roster, and
      before that batch commits this account is nobody. Losing the line is a gap in the
      record and nothing worse — unlike losing the delete, which is a way in.
    */
    try {
      await recordClaim(user, tier)
    } catch {
      /* The access stands, and the invitation is spent. */
    }

    return true
  } catch {
    // No such invitation, expired, or refused. Either way there is no access, which the
    // roster listener has already reported.
    return false
  }
}

/**
 * Take away the account this sign-in just created.
 *
 * Signing in with Google creates a Firebase account whether or not the person is anybody
 * here, so a project collects one for every stranger who presses the button — and the ones
 * it collects count against what the project is allowed.
 *
 * Deleting is the only lever available without a server: blocking sign-up before it happens
 * needs Identity Platform and a Cloud Function, which the free plan has neither of. So the
 * account is made and then unmade, a second later, by itself. `delete()` needs a recent
 * login and has just had one.
 *
 * Only ever for somebody with no roster entry and no invitation in hand. Getting that wrong
 * would delete an organizer's account, so the caller checks both before asking.
 */
async function discardAccount(user: User): Promise<void> {
  try {
    await deleteUser(user)
  } catch {
    // Refused, or the token was too old. Signing out at least does not leave them looking at
    // a half-signed-in app; the account remains for an admin to clear.
    try {
      await signOut(auth)
    } catch {
      /* Nothing left to try. */
    }
  }
}

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [session, setSession] = useState<Session>({
    user: null,
    role: 'none',
    loading: true,
    discarded: false,
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
        // `discarded` is preserved across this transition on purpose: it is set as the
        // account is deleted, and deleting it is what brings us back through here.
        setSession((was) => ({
          user: null,
          role: 'none',
          loading: false,
          discarded: was.discarded,
        }))
        return
      }

      // Signed in but not yet known. Without this the session carries the signed-out answer
      // for as long as the roster read takes, and the app says "you are not an organizer"
      // to somebody who has just signed in as one.
      setSession({ user, role: 'none', loading: true, discarded: false })

      // Watched, not fetched once. Being made an organizer happens outside the app, so a
      // one-shot read makes the grant appear to do nothing until a manual reload.
      let rostered: Role | null = null
      let claimAttempted = false

      const applyRole = (): void => {
        setSession({ user, role: rostered ?? 'none', loading: false, discarded: false })
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
              No entry yet? See whether they arrived holding an invitation.

              The code was put aside before signing in, because signing in with Google leaves
              the page. The tier comes from the invitation and the rules check that it does.
              Attempted once and silently — a failure just means there was no invitation,
              which is the ordinary case.
            */
            if (!snap.exists() && !claimAttempted) {
              claimAttempted = true
              const code = pendingInvite()

              void (async () => {
                if (code && (await claimInvite(user, code))) {
                  // The roster listener sees the entry land and reports the role.
                  return
                }
                /*
                  Nobody here, and nothing in hand.

                  Signing in created an account regardless, and left there it counts against
                  what the project is allowed — for somebody who was never going to get in.
                  So it goes. Only ever in this branch: no roster entry, and no invitation
                  that resolved.
                */
                setSession((was) => ({ ...was, discarded: true }))
                await discardAccount(user)
              })()
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


