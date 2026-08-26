import { deleteUser, onAuthStateChanged, signOut } from 'firebase/auth'
import type { User } from 'firebase/auth'
import { getDoc, onSnapshot, setDoc } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { auditedDelete } from './audit'
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
 * Turn an invitation into access, for the account that just signed in.
 *
 * Reads the invitation for this account's own verified address and writes the roster entry
 * it describes. The rules check the address against the token, the tier against the
 * invitation, and that the invitation is fresh — so the worst this can do is fail.
 */
/**
 * The invitation code somebody arrived with, kept across signing in.
 *
 * Signing in with Google leaves the page and comes back, so the code cannot simply be held
 * in state. Session storage rather than local: an invitation is being accepted now, in this
 * tab, and a code still sitting there in a fortnight is a stale grant nobody meant to keep.
 */
const PENDING_INVITE = 'apple-day:invite'

export function rememberInvite(code: string): void {
  try {
    window.sessionStorage.setItem(PENDING_INVITE, code)
  } catch {
    /* Private browsing. The code is still in the address bar, which is the other copy. */
  }
}

export function pendingInvite(): string {
  try {
    return window.sessionStorage.getItem(PENDING_INVITE) ?? ''
  } catch {
    return ''
  }
}

function forgetInvite(): void {
  try {
    window.sessionStorage.removeItem(PENDING_INVITE)
  } catch {
    /* Nothing to do. */
  }
}

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
async function claimInvite(user: User, code: string): Promise<boolean> {
  try {
    const invite = await getDoc(paths.invite(code))
    if (!invite.exists()) return false

    const tier =
      (invite.data() as { level?: string }).level === 'organizer' ? 'organizer' : 'admin'

    await setDoc(paths.admin(user.uid), {
      email: user.email ?? '',
      level: tier,
      addedAt: Date.now(),
      addedBy: 'invitation',
      via: code,
    })

    /*
      Spent, in a separate write and after the roster entry.

      Batched with it, the delete would be evaluated against the database as it is before the
      batch — where this account is nobody — and the refusal would take the roster write with
      it. So access is granted first and the invitation cleared second. If the clear fails the
      access stands, which is the right way round: an admin can revoke a leftover link, and
      nobody is locked out by a failed tidy-up.
    */
    forgetInvite()
    try {
      await auditedDelete(paths.invite(code), {
        entity: 'access',
        // Never the code. An audit entry is read by admins and kept for years, and a live
        // invitation code sitting in one is a way in.
        entityId: user.uid,
        eventId: null,
        summary: `Accepted an invitation as ${tier}`,
        fields: ['level'],
      })
    } catch {
      /* The access stands. */
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


