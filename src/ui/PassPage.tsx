import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { needsShift, REQUEST_CHOICES } from '../domain/requests'
import type { RequestKind } from '../domain/requests'
import { requestSwap } from '../lib/repo'
import { watchPass } from '../lib/session'
import type { PassData } from '../lib/session'
import { Loading } from './Bits'
import { SupportCard } from './SupportCard'
import { ThemeButton } from './ThemeButton'

/**
 * A volunteer's own page, opened from their QR code or link.
 *
 * No account, and exactly one document read: the pass carries a denormalized copy of that
 * person's shifts, so this loads instantly on a phone with one bar of signal in a car
 * park. It shows only their own shifts and the support number — nothing about anyone else.
 */
export function PassPage(): ReactNode {
  const { token } = useParams<{ token: string }>()
  const [pass, setPass] = useState<PassData | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [asking, setAsking] = useState(false)
  const [message, setMessage] = useState('')
  /*
    What happened to the last request, shown where the button was.

    The confirmation used to render in a note at the top of the page while the button sat at
    the bottom of a long pass, so sending one looked exactly like nothing happening — the
    request was recorded and the volunteer had no way to know.
  */
  /** What is being asked for. The list is short and the wording is the volunteer's. */
  const [kind, setKind] = useState<RequestKind>('swap')
  /** Which shift the request is about. Empty means all of them. */
  const [aboutSlot, setAboutSlot] = useState('')
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (!token) {
      setState('missing')
      return
    }
    // Watched, not read once: their location appears the moment an organizer checks them
    // in, and somebody standing at the table should not have to reload to see it.
    return watchPass(
      token,
      (data) => {
        if (!data) {
          setState('missing')
          return
        }
        setPass(data)
        setState('ready')
      },
      () => setState('missing'),
    )
  }, [token])

  if (state === 'loading') return <Loading what="Finding your shifts" />

  if (state === 'missing' || !pass || !token) {
    return (
      <div className="pass">
        <div className="row end">
          <ThemeButton />
        </div>
        <div className="note error">
          This link is not valid. It may have been replaced by a newer one — ask an
          organizer to resend it.
        </div>
      </div>
    )
  }

  const submitRequest = async (kind: RequestKind): Promise<void> => {
    setSending(true)
    setOutcome(null)
    try {
      // Guarded here as well as in the form: whatever the state says, a request that is
      // not about a shift is not sent naming one.
      await requestSwap(pass.eventId, token, kind, message, needsShift(kind) ? aboutSlot : '')
      setOutcome({
        ok: true,
        text:
          kind === 'cancel'
            ? 'Sent — an organizer knows you cannot make it. Please phone them too if it is today.'
            : kind === 'help'
              ? 'Sent — an organizer knows you need a hand. Please phone them too if it is urgent.'
              : 'Sent. An organizer will pick this up — please phone them too if it is today.',
      })
      setMessage('')
      setAboutSlot('')
      setKind('swap')
      setAsking(false)
    } catch {
      setOutcome({
        ok: false,
        text: 'Could not send that. Please phone one of the contacts above instead.',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="pass">
      {/*
        A volunteer gets the same say over this as an organizer does. There is no bar on this
        page to hang it off, so it sits with the name — the one thing already at the top.
      */}
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 0 }}>{pass.displayName}</h1>
          <p className="muted small">Apple Day</p>
        </div>
        <ThemeButton />
      </div>

      {pass.base && (
        <div className="card">
          <strong>Report to {pass.base.name}</strong>
          {pass.base.address && <div className="small muted">{pass.base.address}</div>}
          {pass.base.mapsUrl && (
            <a
              className="btn tiny"
              href={pass.base.mapsUrl}
              target="_blank"
              rel="noreferrer"
              style={{ marginTop: '0.35rem', display: 'inline-block' }}
            >
              Directions
            </a>
          )}
          {pass.arrivalNote && (
            <p className="small" style={{ marginTop: '0.35rem', whiteSpace: 'pre-line' }}>
              {pass.arrivalNote}
            </p>
          )}
        </div>
      )}

      {pass.shifts.length === 0 ? (
        <div className="note info">
          No shifts on this pass yet. If you signed up and expected one, contact an
          organizer.
        </div>
      ) : (
        pass.shifts.map((shift, i) => (
          <div className="shift" key={i}>
            <div className="when">
              {shift.day} · {shift.slotLabel}
            </div>
            {/* Where they are going appears once an organizer has checked them in. Everyone
                reports to base first — that is where the jars and apples are — so naming a
                location here invites a youth to go straight there instead. */}
            {pass.revealShifts ? (
              <>
                <div className="where">{shift.locationName}</div>
                {shift.address && <div className="small muted">{shift.address}</div>}
                {shift.comments && <div className="small">{shift.comments}</div>}
                {shift.mapsUrl && (
                  <a className="btn tiny" href={shift.mapsUrl} target="_blank" rel="noreferrer"
                     style={{ marginTop: '0.35rem', display: 'inline-block' }}>
                    Directions
                  </a>
                )}
              </>
            ) : (
              <div className="small muted">
                {pass.base
                  ? `Where you are going is given out at ${pass.base.name} when you check in.`
                  : 'Where you are going is given out when you check in.'}
              </div>
            )}
          </div>
        ))
      )}

      <SupportCard contacts={pass.support} note={pass.supportNote} />

      <div className="card">
        {asking ? (
          /*
            One thing being asked, then send.

            This used to be a message box above two buttons — "Ask to swap" and "Can't make
            it" — so what you were sending depended on which button you happened to press at
            the end, and a third button beside them said "Cancel", which reads as one of the
            things you might be asking for rather than a way out of the form.
          */
          <div className="stack">
            <label>
              What do you need?
              <select
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as RequestKind
                  setKind(next)
                  // Chosen a shift, then switched to something that is not about one: the
                  // choice is no longer on screen, so it must not still be held.
                  if (!needsShift(next)) setAboutSlot('')
                }}
              >
                {REQUEST_CHOICES.map((choice) => (
                  <option key={choice.kind} value={choice.kind}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>

            {/*
              Which shift, for the two requests that are about one, and only when there is
              more than one to choose between. "Need a hand" and "something else" are not
              about a shift, and asking anyway invites an answer that is not true.
            */}
            {needsShift(kind) && pass.shifts.length > 1 && (
              <label>
                Which shift?
                <select value={aboutSlot} onChange={(e) => setAboutSlot(e.target.value)}>
                  <option value="">All of my shifts</option>
                  {pass.shifts.map((shift) => (
                    <option key={shift.slotId} value={shift.slotId}>
                      {shift.day} · {shift.slotLabel}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              Anything to add <span className="muted">(optional)</span>
              <textarea
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="e.g. soccer runs late, could we move to the 7pm slot?"
              />
            </label>

            <div className="row">
              <button
                className="primary"
                disabled={sending}
                onClick={() => void submitRequest(kind)}
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
              <button className="ghost" disabled={sending} onClick={() => setAsking(false)}>
                Never mind
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button
              onClick={() => {
                setOutcome(null)
                setAsking(true)
              }}
            >
              Send a request
            </button>
          </div>
        )}
        {outcome && (
          <div
            className={`note ${outcome.ok ? 'good' : 'error'}`}
            role="status"
            style={{ marginTop: '0.5rem' }}
          >
            {outcome.text}
          </div>
        )}
      </div>

      <p className="small muted">
        Keep this link private — it shows your shifts.
      </p>
    </div>
  )
}
