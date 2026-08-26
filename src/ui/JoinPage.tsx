import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { getDoc } from 'firebase/firestore'
import { paths } from '../lib/paths'
import { signInWithGoogle } from '../lib/firebase'
import { useSession } from '../lib/session'
import { rememberInvite } from '../lib/pendingInvite'
import { inviteIsLive } from '../domain/access'
import { Loading } from './Bits'

/**
 * Accepting an invitation.
 *
 * The link carries a code, and holding it is the whole of the permission — so this page is
 * open to anybody, like a volunteer's pass. What it does is remember the code, get them
 * signed in, and let the session claim it.
 *
 * Reading the invitation before asking anybody to sign in is the point of the page. A link
 * that has expired, or been revoked, or was mistyped should say so on arrival rather than
 * after somebody has handed over a Google account and been told they have no access.
 */
export function JoinPage(): ReactNode {
  const { code = '' } = useParams()
  const { user, role, loading } = useSession()

  const [state, setState] = useState<'reading' | 'live' | 'gone' | 'expired'>('reading')
  const [tier, setTier] = useState<'admin' | 'organizer'>('organizer')

  /*
    Held before sign-in, not after, and only for somebody who could actually use it.

    Signing in with Google leaves the page and comes back to the app's own route rather than
    this one, so a code only in the URL is gone by the time anybody can claim it.

    Nothing is stored for an account that already has access. It has nothing to claim, and a
    code left in the tab is a grant waiting for whoever signs in next — an admin opening a
    link to check it should not be arming it for the next person to use that laptop.
  */
  useEffect(() => {
    if (code && !loading && role === 'none') rememberInvite(code)
  }, [code, loading, role])

  useEffect(() => {
    if (!code) {
      setState('gone')
      return
    }

    let cancelled = false
    void getDoc(paths.invite(code))
      .then((snap) => {
        if (cancelled) return
        if (!snap.exists()) {
          setState('gone')
          return
        }
        const data = snap.data() as { level?: string; invitedAt?: number }
        setTier(data.level === 'organizer' ? 'organizer' : 'admin')
        setState(
          inviteIsLive({ invitedAt: data.invitedAt ?? 0 }, Date.now()) ? 'live' : 'expired',
        )
      })
      .catch(() => {
        // Refused or unreachable. Indistinguishable from gone, from here, and the honest
        // thing to say is the same either way.
        if (!cancelled) setState('gone')
      })

    return () => {
      cancelled = true
    }
  }, [code])

  /*
    Signed in with access already: go to the app.

    This is the end of the ordinary path, not an edge case. The claim writes the roster entry,
    the session picks it up, and the tier arrives here — so somebody who has just accepted an
    invitation correctly lands on this branch a moment later. Anything other than sending them
    onward strands them on a page about getting in, at the exact moment they got in.

    It is also where an admin lands after opening a link to check it, and where anybody signed
    in as the wrong account lands. Both want the app, and the account menu in the topbar is
    what answers "which account am I". The invitation is untouched by any of this: claiming
    only ever runs for an account with no roster entry.
  */
  if (!loading && role !== 'none') return <Navigate to="/" replace />

  if (state === 'reading') return <Loading what="Checking the invitation" />

  if (state === 'gone' || state === 'expired') {
    return (
      <div className="card">
        <h1>This invitation cannot be used</h1>
        <p>
          {state === 'expired'
            ? 'It has expired.'
            : 'It has already been used, or it has been withdrawn.'}
        </p>
        <p className="small muted">
          Ask whoever sent it for a new link. Nothing is wrong with your account.
        </p>
      </div>
    )
  }

  return (
    <div className="card">
      <h1>You have been invited</h1>
      <p>
        As {tier === 'admin' ? 'an admin' : 'an organizer'}
        {tier === 'admin'
          ? ' — you will be able to change who has access, and what every year is shaped by.'
          : ' — you will be able to build the schedule, run the day and record the money.'}
      </p>

      {user ? (
        <>
          {/*
            Signed in and still not on the roster, with the claim already attempted. Saying
            so beats a spinner that never resolves.
          */}
          <p>Accepting it now…</p>
          <p className="small muted">
            If this does not move on, the link may have been used already. Ask for a new one.
          </p>
        </>
      ) : (
        <>
          <p>
            Sign in with any Google account. Whichever you use becomes the one you sign in
            with from now on — it does not have to match the address anybody sent this to.
          </p>
          <button className="primary" onClick={() => void signInWithGoogle()}>
            Sign in and accept
          </button>
        </>
      )}
    </div>
  )
}
