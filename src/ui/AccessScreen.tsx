import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  INVITE_DAYS,
  inviteExpired,
  inviteSpent,
  inviteProblem,
  changeProblem,
  normaliseEmail,
  sortRoster,
} from '../domain/access'
import type { Invitation, RosterEntry, Tier } from '../domain/access'
import {
  cancelInvitation,
  inviteToTier,
  removeAccess,
  setTier,
  useInvitations,
  useRoster,
} from '../lib/repo'
import { useSession } from '../lib/session'
import { ErrorNote, Loading } from './Bits'
import { Modal } from './Modal'

/**
 * Who may use the app.
 *
 * This screen exists so that granting somebody access is not a trip to the Firebase console
 * at nine o'clock on a Friday: find them under Authentication, copy a uid, create a document
 * by hand. Here it is an email address and a tier.
 *
 * Two things are deliberately not possible. You cannot change your own access — that is what
 * makes locking the group out impossible, since an admin can remove any other admin but
 * never themselves, so one always remains. And an invitation does not last forever: it is a
 * standing grant to whoever controls that mailbox.
 */

const TIER_LABEL: Record<Tier, string> = {
  admin: 'Admin',
  organizer: 'Organizer',
}

const TIER_BLURB: Record<Tier, string> = {
  admin: 'Everything, including the library, the sections and the events themselves.',
  organizer: 'Runs the event: the schedule, the day, the jars, the money. Not the setup.',
}

export function AccessScreen(): ReactNode {
  const { user } = useSession()
  const roster = useRoster()
  const invites = useInvitations()

  const [email, setEmail] = useState('')
  const [tier, setTierChoice] = useState<Tier>('organizer')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<RosterEntry | null>(null)

  const entries = useMemo(() => sortRoster(roster.data), [roster.data])
  const problem = useMemo(
    () => inviteProblem(email, roster.data, invites.data),
    [email, roster.data, invites.data],
  )

  const invite = (): void => {
    if (!user || problem !== null || normaliseEmail(email) === '') return
    setBusy(true)
    setError(null)
    void inviteToTier(email, tier, user.email ?? user.uid, note)
      .then(() => {
        setEmail('')
        setNote('')
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const move = (entry: RosterEntry, to: Tier): void => {
    const stop = changeProblem(entry, user?.uid ?? '')
    if (stop) {
      setError(stop)
      return
    }
    setError(null)
    void setTier(entry.uid, to).catch((e: Error) => setError(e.message))
  }

  const remove = (): void => {
    const entry = confirmRemove
    if (!entry) return
    setConfirmRemove(null)
    setError(null)
    void removeAccess(entry.uid, entry.email).catch((e: Error) => setError(e.message))
  }

  if (roster.loading) return <Loading what="Reading who has access" />

  return (
    <>
      <ErrorNote error={roster.error ?? invites.error} />
      {error && <div className="note error">{error}</div>}

      <div className="card">
        <h1>Who has access</h1>
        <p className="small muted">
          Two tiers. An <strong>organizer</strong> runs the event; an <strong>admin</strong>{' '}
          also changes the things shared between years. You cannot change your own access —
          ask another admin — which is what stops the group locking itself out.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Who</th>
                <th>Tier</th>
                <th>Since</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isYou = entry.uid === user?.uid
                return (
                  <tr key={entry.uid}>
                    <td>
                      <div>{entry.email || <span className="muted">unknown address</span>}</div>
                      <div className="small muted mono">{entry.uid}</div>
                    </td>
                    <td className="small">
                      {isYou ? (
                        <span className="pill tone-amber">{TIER_LABEL[entry.tier]} · you</span>
                      ) : (
                        <select
                          aria-label={`Tier for ${entry.email || entry.uid}`}
                          value={entry.tier}
                          onChange={(e) => move(entry, e.target.value as Tier)}
                        >
                          <option value="organizer">Organizer</option>
                          <option value="admin">Admin</option>
                        </select>
                      )}
                    </td>
                    <td className="small muted nowrap">
                      {entry.addedAt > 0
                        ? new Date(entry.addedAt).toLocaleDateString('en-CA', {
                            dateStyle: 'medium',
                          })
                        : '—'}
                      {entry.addedBy && (
                        <div className="small">
                          {entry.addedBy === 'invitation' ? 'by invitation' : entry.addedBy}
                        </div>
                      )}
                    </td>
                    <td>
                      {!isYou && (
                        <button className="tiny danger" onClick={() => setConfirmRemove(entry)}>
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Invite somebody</h2>
        <p className="small muted" style={{ marginTop: 0 }}>
          By email, because that is all anyone knows about a person before they have signed in.
          They get access the first time they sign in with that address. An invitation lasts{' '}
          {INVITE_DAYS} days.
        </p>
        <div className="row">
          <label style={{ flex: '2 1 14rem' }}>
            Email
            <input
              type="email"
              inputMode="email"
              value={email}
              placeholder="name@example.org"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label style={{ flex: '1 1 9rem' }}>
            Tier
            <select value={tier} onChange={(e) => setTierChoice(e.target.value as Tier)}>
              <option value="organizer">Organizer</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label style={{ flex: '2 1 12rem' }}>
            Note
            <input
              value={note}
              placeholder="Cub leader, does Saturday"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>
        <p className="small muted">{TIER_BLURB[tier]}</p>
        {problem && (
          <p className="small" style={{ color: 'var(--bad)' }}>
            {problem}
          </p>
        )}
        <button
          className="primary"
          disabled={busy || problem !== null || normaliseEmail(email) === ''}
          onClick={invite}
        >
          {busy ? 'Inviting…' : 'Send invitation'}
        </button>
      </div>

      {invites.data.length > 0 && (
        <div className="card">
          <h2>Waiting to sign in</h2>
          <ul className="issue-list">
            {invites.data.map((i: Invitation) => {
              const stale = inviteExpired(i, Date.now())
              /*
                Claiming an invitation deletes it now. The ones left behind before that did
                are still here, and they are the reason this list needs to say so: it is a
                list of people to chase, and one that fills up with people already in stops
                being read.
              */
              const spent = inviteSpent(i, roster.data)
              return (
                <li key={i.email}>
                  <div>
                    <strong className="small">{i.email}</strong>
                    <div className="small muted">
                      {TIER_LABEL[i.tier]} · invited by {i.invitedBy}
                      {i.note && ` · ${i.note}`}
                    </div>
                    {spent ? (
                      <div className="small" style={{ color: 'var(--good)' }}>
                        Already signed in and on the roster — this invitation is spent.
                      </div>
                    ) : (
                      stale && (
                        <div className="small" style={{ color: 'var(--warn)' }}>
                          Expired — invite them again if they still need access.
                        </div>
                      )
                    )}
                  </div>
                  <button
                    className="tiny"
                    onClick={() => void cancelInvitation(i.email).catch((e: Error) => setError(e.message))}
                  >
                    {spent ? 'Clear' : 'Cancel'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {confirmRemove && (
        <Modal
          title="Remove their access?"
          onClose={() => setConfirmRemove(null)}
          footer={
            <>
              <button onClick={() => setConfirmRemove(null)}>Cancel</button>
              <button className="danger" onClick={remove}>
                Remove
              </button>
            </>
          }
        >
          <p>
            <strong>{confirmRemove.email || confirmRemove.uid}</strong> will not be able to
            open the app again.
          </p>
          <p className="small">
            Any invitation for that address goes too — otherwise they could sign in and claim
            their way straight back in.
          </p>
        </Modal>
      )}
    </>
  )
}
