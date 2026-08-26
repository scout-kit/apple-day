import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { getDoc } from 'firebase/firestore'
import { paths } from '../lib/paths'
import { signInWithGoogle } from '../lib/firebase'
import { rememberInvite, useSession } from '../lib/session'
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
    Held before sign-in, not after.

    Signing in with Google leaves the page and comes back, and what it comes back to is the
    app's own route rather than this one — so a code only in the URL is a code that is gone
    by the time anybody can use it.
  */
  useEffect(() => {
    if (code) rememberInvite(code)
  }, [code])

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

  // Already in, whether they arrived here by accident or came back to a spent link.
  if (!loading && role !== 'none') {
    return (
      <div className="card">
        <h1>You already have access</h1>
        <p>
          Nothing to accept. Open the app from the link you were given, or from wherever you
          keep it.
        </p>
      </div>
    )
  }

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
