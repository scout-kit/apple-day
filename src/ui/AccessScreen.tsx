import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  INVITE_DAYS,
  canInvite,
  changeProblem,
  inviteDaysLeft,
  inviteExpired,
  inviteLink,
  inviteMessage,
  inviteProblem,
  looksLikeEmail,
  normaliseEmail,
  sortRoster,
} from '../domain/access'
import { GOOGLE_CLIENT_ID, originLooksPublic, publicOrigin } from '../lib/mail/config'
import { gmailSender } from '../lib/mail/gmail'
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
import { CopyButton, ErrorNote, Loading } from './Bits'
import { Modal } from './Modal'

/**
 * Who may use the app.
 *
 * This screen exists so that granting somebody access is not a trip to the Firebase console
 * at nine o'clock on a Friday: find them under Authentication, copy a uid, create a document
 * by hand. Here it is a name, a tier, and a link to send them.
 *
 * Two things are deliberately not possible. You cannot change your own access — that is what
 * makes locking the group out impossible, since an admin can remove any other admin but
 * never themselves, so one always remains. And an invitation does not last forever: it is a
 * standing grant to whoever holds the link.
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

  /*
    The invitation just made, held so it can be copied or sent.

    Shown once, here, because there is nowhere else the link can come from: the code is the
    permission, and an admin who closes this screen without copying it has to make another.
  */
  const [made, setMade] = useState<{ code: string; link: string; email: string; tier: Tier } | null>(
    null,
  )
  const [sent, setSent] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  /*
    Sending is a separate press, and only when Gmail is set up.

    Making the invitation and sending it are two things: one needs nothing, the other needs
    an OAuth client id and opens a consent popup — and a popup that appears without being
    asked for is one a browser blocks. Plenty of invitations go by text or in person anyway,
    so the link is always the deliverable and the mail is an offer.
  */
  const canEmail = GOOGLE_CLIENT_ID !== ''

  /*
    Offered against the emulator too, and warned about rather than withheld.

    The same call the reminders screen makes. Sending is worth being able to try before a
    real Apple Day depends on it — the consent screen, the scope, whether the message reads
    properly on a phone. What a local link cannot do is work for anybody else, so that is
    said plainly beside it.
  */
  const origin = publicOrigin()
  const originSafe = originLooksPublic(origin)

  /** One way of sending, wherever it is sent from. */
  const emailIt = async (link: string, to: string, forTier: Tier): Promise<void> => {
    const sender = gmailSender(GOOGLE_CLIENT_ID)
    await sender.connect()
    const { subject, body } = inviteMessage(link, forTier, user?.email ?? 'An organizer')
    await sender.send({ to, subject, body })
  }

  const sendNow = (invitation: { link: string; email: string; tier: Tier }): void => {
    if (!looksLikeEmail(invitation.email)) return
    setSending(true)
    setError(null)

    void emailIt(invitation.link, invitation.email, invitation.tier)
      .then(() => setSent(invitation.email))
      .catch((e: Error) =>
        setError(
          `Could not email it to ${invitation.email}: ${e.message}. The link is still good — ` +
            'copy it and send it yourself.',
        ),
      )
      .finally(() => setSending(false))
  }

  /*
    Sending one that already exists, from the list below.

    A message that went astray, one that never arrived, one sent before somebody mentioned
    which account they use. The link does not change — it is the same invitation — so this is
    another copy of the same thing rather than a new grant, and the address is the one the
    invitation was written for, so there is nothing to type.
  */
  const [resending, setResending] = useState<string | null>(null)
  const [resent, setResent] = useState<Record<string, string>>({})

  const resend = (invitation: Invitation): void => {
    if (!looksLikeEmail(invitation.email)) return
    setResending(invitation.code)
    setError(null)

    void emailIt(inviteLink(origin, invitation.code), invitation.email, invitation.tier)
      .then(() => setResent((was) => ({ ...was, [invitation.code]: invitation.email })))
      .catch((e: Error) =>
        setError(
          `Could not email it to ${invitation.email}: ${e.message}. The link itself still works.`,
        ),
      )
      .finally(() => setResending(null))
  }

  const invite = (): void => {
    if (!user || problem !== null || !canInvite(email)) return
    setBusy(true)
    setError(null)
    setMade(null)
    setSent(null)

    const who = normaliseEmail(email)
    void inviteToTier(who, tier, user.email ?? user.uid, note)
      .then((code) => {
        setMade({ code, link: inviteLink(origin, code), email: who, tier })
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
    void removeAccess(entry.uid).catch((e: Error) => setError(e.message))
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
          Add them by address, then send them the link — or copy it and send it however you
          like. Whoever opens it and signs in gets the access, with whatever Google account
          they have. Lasts {INVITE_DAYS} days, and works once.
        </p>
        <div className="row">
          <label style={{ flex: '2 1 14rem' }}>
            Their email address
            <input
              type="email"
              value={email}
              placeholder="jo@example.org"
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
        {canEmail && !originSafe && (
          <div className="note warning" style={{ marginTop: '0.5rem' }}>
            The link would point at <span className="mono">{origin}</span>, which nobody
            outside this machine can open. Fine for trying the sending out; set{' '}
            <span className="mono">VITE_PUBLIC_ORIGIN</span> before inviting anybody real.
          </div>
        )}
        <p className="small muted">{TIER_BLURB[tier]}</p>
        {problem && (
          <p className="small" style={{ color: 'var(--bad)' }}>
            {problem}
          </p>
        )}
        <p className="small muted">
          The address is how you send them the link and how this list stays readable. It is
          not how they sign in — whichever Google account opens the link is the one that gets
          the access, and it does not have to match.
        </p>
        <button
          className="primary"
          disabled={busy || problem !== null || !canInvite(email)}
          onClick={invite}
        >
          {busy ? 'Creating…' : 'Create invitation'}
        </button>

        {made && (
          <div className="note info" style={{ marginTop: '0.6rem' }}>
            <p style={{ margin: 0 }}>
              <strong>{sent ? `Emailed to ${sent}.` : 'Invitation ready.'}</strong>
            </p>
            <p className="small mono" style={{ margin: '0.3rem 0', overflowWrap: 'anywhere' }}>
              {made.link}
            </p>
            <div className="row" style={{ gap: '0.4rem' }}>
              <CopyButton text={made.link} label="Copy link" />
              {/*
                Offered, not done automatically. Sending opens a Google consent popup, and one
                that appears without being asked for is one a browser blocks — and plenty of
                invitations go by text or in person anyway.
              */}
              {canEmail && !sent && (
                <button
                  className="tiny primary"
                  disabled={sending}
                  onClick={() => sendNow(made)}
                >
                  {sending ? 'Sending…' : `Email it to ${made.email}`}
                </button>
              )}
            </div>
            <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
              It is also in the list below until it is used. Holding the link is the whole of
              the permission, so treat it like a password and do not post it anywhere public.
            </p>
            <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
              {/* Where an admin's first instinct goes, and it looks like the link is broken:
                  an account that already has access is sent straight to the app. */}
              Opening it yourself just takes you into the app, because this account already
              has access. To try it as they will see it, sign out first — the invitation is
              not used up by looking at it.
            </p>
          </div>
        )}
      </div>

      {invites.data.length > 0 && (
        <div className="card">
          <h2>Waiting to sign in</h2>
          <ul className="issue-list">
            {invites.data.map((i: Invitation) => {
              const stale = inviteExpired(i, Date.now())
              const left = inviteDaysLeft(i, Date.now())
              const link = inviteLink(publicOrigin(), i.code)
              return (
                <li key={i.code}>
                  <div style={{ minWidth: 0 }}>
                    <strong className="small">
                      {i.email || <span className="muted">no address</span>}
                    </strong>
                    <div className="small muted">
                      {TIER_LABEL[i.tier]} · invited by {i.invitedBy}
                      {i.note && ` · ${i.note}`}
                    </div>
                    {stale ? (
                      <div className="small" style={{ color: 'var(--warn)' }}>
                        Expired — make another if they still need access.
                      </div>
                    ) : (
                      <>
                        <div className="small muted mono" style={{ overflowWrap: 'anywhere' }}>
                          {link}
                        </div>
                        <div className="small muted">
                          {left === 1 ? 'Expires tomorrow' : `Expires in ${left} days`}
                        </div>
                      </>
                    )}

                    {resent[i.code] && (
                      <div className="small" style={{ color: 'var(--good)' }}>
                        Emailed to {resent[i.code]}
                      </div>
                    )}

                  </div>
                  <div className="row" style={{ gap: '0.3rem' }}>
                    {!stale && <CopyButton text={link} label="Copy link" />}
                    {/*
                      One press, because the invitation knows who it is for. Sending it again
                      is the ordinary fix for a message that went astray, and having to type
                      the address back in is what made it feel like a new invitation.
                    */}
                    {!stale && canEmail && i.email && (
                      <button
                        className="tiny"
                        disabled={resending === i.code}
                        onClick={() => resend(i)}
                      >
                        {resending === i.code
                          ? 'Sending…'
                          : resent[i.code]
                            ? 'Send again'
                            : 'Email it'}
                      </button>
                    )}
                    {/*
                      Revoking is the only way to take a link back. It is a bearer token:
                      once sent, nothing stops whoever holds it but deleting it here.
                    */}
                    <button
                      className="tiny danger"
                      onClick={() =>
                        void cancelInvitation(i.code).catch((e: Error) => setError(e.message))
                      }
                    >
                      Revoke
                    </button>
                  </div>
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
            They can be invited again later. The invitation they used is long spent, so
            removing this is enough — there is no old link that still works.
          </p>
        </Modal>
      )}
    </>
  )
}
