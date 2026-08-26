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
import { ErrorNote, Loading } from './Bits'
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

  const [label, setLabel] = useState('')
  const [sendTo, setSendTo] = useState('')
  const [tier, setTierChoice] = useState<Tier>('organizer')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<RosterEntry | null>(null)

  const entries = useMemo(() => sortRoster(roster.data), [roster.data])
  const problem = useMemo(
    () => inviteProblem(label, roster.data, invites.data),
    [label, roster.data, invites.data],
  )

  /*
    The link the last invitation produced, held so it can be copied.

    Shown once, here, because there is nowhere else it can come from: the code is the
    permission, and an admin who closes this screen without copying it has to make another.
  */
  const [madeLink, setMadeLink] = useState<string | null>(null)

  /*
    Emailing it is an extra, and the link is the thing.

    Sending needs an OAuth client id and a consent screen; copying a link needs nothing. So
    the address is asked for only when Gmail is set up, it is optional even then, and it is
    never stored — an invitation records no address, which is the point of a code. Whether
    the mail arrives or not, the link is on screen and in the list below.
  */
  const canEmail = GOOGLE_CLIENT_ID !== ''
  const [sent, setSent] = useState<string | null>(null)

  /*
    Offered against the emulator too, and warned about rather than withheld.

    The same call the reminders screen makes. Sending is the part worth being able to try
    before a real Apple Day depends on it — the consent screen, the scope, whether the
    message reads properly on a phone — and none of that can be rehearsed if the field is
    not there. What a local link cannot do is work for anybody else, so that is said plainly
    beside it.
  */
  const origin = publicOrigin()
  const originSafe = originLooksPublic(origin)

  const emailIt = async (link: string, to: string, forTier: Tier): Promise<void> => {
    const sender = gmailSender(GOOGLE_CLIENT_ID)
    await sender.connect()
    const { subject, body } = inviteMessage(link, forTier, user?.email ?? 'An organizer')
    await sender.send({ to, subject, body })
  }

  /*
    Sending an invitation that already exists, to an address typed now.

    Needed often enough to be a button: a message that went to the wrong address, one that
    never arrived, one sent before somebody mentioned which account they actually use. The
    link does not change — the invitation is the same invitation — so this is only ever
    another copy of the same thing.

    Asked for each time rather than remembered, because the invitation stores no address to
    remember it in. It is readable by anyone holding the code, so an address written on it
    would be one more thing a forwarded link gives away.
  */
  const [resendFor, setResendFor] = useState<string | null>(null)
  const [resendTo, setResendTo] = useState('')
  const [resendBusy, setResendBusy] = useState(false)
  const [resent, setResent] = useState<Record<string, string>>({})

  const openResend = (code: string): void => {
    setResendFor(resendFor === code ? null : code)
    setResendTo('')
    setError(null)
  }

  const resend = (invitation: Invitation): void => {
    const to = resendTo.trim()
    if (!looksLikeEmail(to)) return
    setResendBusy(true)
    setError(null)

    void emailIt(inviteLink(origin, invitation.code), to, invitation.tier)
      .then(() => {
        setResent((was) => ({ ...was, [invitation.code]: to }))
        setResendFor(null)
        setResendTo('')
      })
      .catch((e: Error) =>
        setError(`Could not email it to ${to}: ${e.message}. The link itself still works.`),
      )
      .finally(() => setResendBusy(false))
  }

  const invite = (): void => {
    if (!user || problem !== null || !canInvite(label)) return
    setBusy(true)
    setError(null)
    setMadeLink(null)
    setSent(null)

    const to = sendTo.trim()
    void inviteToTier(label, tier, user.email ?? user.uid, note)
      .then(async (code) => {
        const link = inviteLink(origin, code)
        setMadeLink(link)
        setLabel('')
        setNote('')
        setSendTo('')

        if (!canEmail || !looksLikeEmail(to)) return
        /*
          The invitation exists either way. A send that fails is worth saying so about, not
          worth undoing anything over — the admin can copy the link and send it themselves,
          which is what they would have done anyway.
        */
        try {
          await emailIt(link, to, tier)
          setSent(to)
        } catch (e) {
          setError(
            `The invitation was created, but emailing it to ${to} failed: ${
              e instanceof Error ? e.message : String(e)
            }. Copy the link below and send it yourself.`,
          )
        }
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
          An invitation is a link. Send it however you like — whoever opens it and signs in
          gets the access, with whatever Google account they have. It does not have to match
          the address you know them by. Lasts {INVITE_DAYS} days, and works once.
        </p>
        <div className="row">
          <label style={{ flex: '2 1 14rem' }}>
            Who it is for
            <input
              value={label}
              placeholder="Jo Bailey, or jo@example.org"
              onChange={(e) => setLabel(e.target.value)}
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
        {canEmail && (
          <label style={{ display: 'block', marginTop: '0.5rem' }}>
            Email the link to (optional)
            <input
              type="email"
              value={sendTo}
              placeholder="jo@example.org"
              onChange={(e) => setSendTo(e.target.value)}
            />
            <span className="small muted">
              Only used to send this one message. Leave it blank and copy the link instead.
            </span>
          </label>
        )}

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
          A label for your own list — nothing is checked against it, and the person is not
          told what you typed.
        </p>
        <button
          className="primary"
          disabled={busy || problem !== null || !canInvite(label)}
          onClick={invite}
        >
          {busy ? 'Creating…' : 'Create invitation'}
        </button>

        {madeLink && (
          <div className="note info" style={{ marginTop: '0.6rem' }}>
            <p style={{ margin: 0 }}>
              <strong>{sent ? `Emailed to ${sent}.` : 'Send them this link.'}</strong>
            </p>
            <p className="small mono" style={{ margin: '0.3rem 0', overflowWrap: 'anywhere' }}>
              {madeLink}
            </p>
            <div className="row" style={{ gap: '0.4rem' }}>
              <button
                className="tiny"
                onClick={() => void navigator.clipboard?.writeText(madeLink)}
              >
                Copy link
              </button>
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
                    <strong className="small">{i.label}</strong>
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

                    {resendFor === i.code && (
                      <div className="row" style={{ gap: '0.3rem', marginTop: '0.35rem' }}>
                        <input
                          type="email"
                          autoFocus
                          value={resendTo}
                          placeholder="jo@example.org"
                          style={{ flex: '1 1 12rem' }}
                          // Enter sends it. A one-field form where Enter does nothing is a
                          // form people fill in and then wonder about.
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') resend(i)
                            if (e.key === 'Escape') setResendFor(null)
                          }}
                          onChange={(e) => setResendTo(e.target.value)}
                        />
                        <button
                          className="tiny primary"
                          disabled={resendBusy || !looksLikeEmail(resendTo)}
                          onClick={() => resend(i)}
                        >
                          {resendBusy ? 'Sending…' : 'Send'}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: '0.3rem' }}>
                    {!stale && (
                      <button
                        className="tiny"
                        onClick={() => void navigator.clipboard?.writeText(link)}
                      >
                        Copy link
                      </button>
                    )}
                    {!stale && canEmail && (
                      <button
                        className="tiny"
                        aria-expanded={resendFor === i.code}
                        onClick={() => openResend(i.code)}
                      >
                        Email it
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
