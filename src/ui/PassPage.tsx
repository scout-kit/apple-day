import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { groupIntoRuns, runSpan } from '../domain/shiftRuns'
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
    What happened to the last request, shown where the button is.

    A pass is long, and a confirmation at the top of it while the button sits at the bottom
    reads as nothing happening — the request is recorded and the volunteer cannot tell.
  */
  /** What is being asked for. The list is short and the wording is the volunteer's. */
  const [kind, setKind] = useState<RequestKind>('swap')
  /** Which shift the request is about. Empty means all of them. */
  const [aboutSlot, setAboutSlot] = useState('')
  const [sending, setSending] = useState(false)
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null)

  /*
    Consecutive shifts at one shop, read as the stretch they are.

    Two hours at the same door is one turn, not two jobs, and listing them separately made a
    five-till-seven look like being sent out twice. The day-of table has always grouped them;
    a pass was still reading them out one by one.

    Keyed on the day as well as the place, because the times are minutes from midnight —
    without it, five o'clock on the Friday and five o'clock on the Saturday look adjacent.
  */
  const runs = useMemo(
    () =>
      groupIntoRuns(
        pass?.shifts.map((shift) => ({
          shift,
          locationId: `${shift.day}|${shift.locationName}|${shift.address}`,
          startMin: shift.startMin ?? null,
          endMin: shift.endMin ?? null,
        })) ?? [],
      ),
    [pass?.shifts],
  )

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
        runs.map((run, i) => {
          // Everything shown comes off the run's first shift: they are all the same shop, and
          // the time is the whole stretch.
          const shift = run.items[0]!.shift
          const when = runSpan(run, shift.slotLabel)
          return (
          <div className="shift" key={i}>
            <div className="when">
              {shift.day} · {when}
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
          )
        })
      )}

      <SupportCard contacts={pass.support} note={pass.supportNote} />

      <div className="card">
        {asking ? (
          /*
            One thing being asked, then send.

            Not a message box above a row of buttons — "Ask to swap", "Can't make it",
            "Cancel" — where what you send depends on which one you press at the end, and the
            way out of the form reads as one of the things you might be asking for.
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
            {needsShift(kind) && runs.length > 1 && (
              <label>
                Which shift?
                <select value={aboutSlot} onChange={(e) => setAboutSlot(e.target.value)}>
                  <option value="">All of my shifts</option>
                  {/*
                    One entry per run, matching the list above. Offering the hours separately
                    when the pass shows them as one stretch asks about something the volunteer
                    cannot see.

                    The value is the run's first slot. An organizer acting on it works on the
                    whole person anyway — the requests screen offers "no-show for all of
                    them" — so this is which turn they mean, not a contract about one hour.
                  */}
                  {runs.map((run) => {
                    const first = run.items[0]!.shift
                    return (
                      <option key={first.slotId} value={first.slotId}>
                        {first.day} · {runSpan(run, first.slotLabel)}
                      </option>
                    )
                  })}
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
