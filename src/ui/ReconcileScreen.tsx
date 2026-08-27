import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { summariseMoney } from '../domain/metrics'
import { DAY_LABEL } from '../domain/slots'
import type { EventNote } from '../domain/types'
import { toCsv, downloadFile } from '../lib/csv'
import { useEvent } from '../lib/eventContext'
import { deleteEventNote, saveEventNote, useEventNotes, useJars } from '../lib/repo'
import { runsTheEvent, useSession } from '../lib/session'
import { ErrorNote, Loading, Money, Stat } from './Bits'

/**
 * What the event raised.
 *
 * Every figure here comes from the jars, each counted once with its location and youth
 * already attached from when it was issued. There is nothing to type in and nothing to
 * reconcile against — which is the point: the workbook kept a second, hand-assembled set of
 * totals, and the two being $86.55 apart went unnoticed because neither was obviously the
 * truth.
 *
 * Money that never went through a jar goes in as a jar without a number, on the Jars screen,
 * so it arrives here with its day and its location like everything else. Typing it in as a
 * lump sum here would put it back where it came from: a figure with nothing attached, and
 * nothing to check it against.
 *
 * What is left to write down is the things a figure cannot say — a jar found on the Monday,
 * a float that went out and came back, a count nobody trusts.
 */
export function ReconcileScreen(): ReactNode {
  const { event } = useEvent()
  const { user, role } = useSession()
  const jars = useJars()
  const notes = useEventNotes()

  /* A viewer reads the notes and the figures, and writes neither. */
  const canEdit = runsTheEvent(role)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<EventNote | null>(null)
  const [busy, setBusy] = useState(false)
  const [writeError, setWriteError] = useState<Error | null>(null)

  const summary = useMemo(() => summariseMoney(jars.data), [jars.data])

  /** Newest first: on the day, the thing that just happened is what you came to read. */
  const ordered = useMemo(
    () => [...notes.data].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id)),
    [notes.data],
  )

  const write = async (): Promise<void> => {
    if (!event || !draft.trim()) return
    setBusy(true)
    setWriteError(null)
    try {
      await saveEventNote(
        event.id,
        { id: editing?.id ?? '', text: draft },
        user?.email ?? user?.uid ?? '',
      )
      setDraft('')
      setEditing(null)
    } catch (error) {
      setWriteError(error as Error)
    } finally {
      setBusy(false)
    }
  }

  const remove = (note: EventNote): void => {
    if (!event) return
    setWriteError(null)
    if (editing?.id === note.id) {
      setEditing(null)
      setDraft('')
    }
    void deleteEventNote(event.id, note).catch((error: Error) => setWriteError(error))
  }

  const exportNotes = (): void => {
    downloadFile(
      `apple-day-notes-${event?.id ?? 'event'}.csv`,
      toCsv(
        ordered.map((n) => ({
          When: n.at ? new Date(n.at).toLocaleString('en-CA') : '',
          Who: n.by,
          Note: n.text,
        })),
      ),
    )
  }

  if (jars.loading || notes.loading) return <Loading what="Adding up the jars" />

  return (
    <>
      <ErrorNote error={jars.error ?? notes.error ?? writeError} />

      {summary.stillOut > 0 && (
        <div className="note warning">
          <strong>
            {summary.stillOut} jar{summary.stillOut === 1 ? '' : 's'} still out
          </strong>
          <div className="small">
            Money nobody has counted yet, so these are running totals rather than a result.
            Count them in on the Jars screen.
          </div>
        </div>
      )}

      <div className="card">
        <div className="stats">
          <Stat label="raised in total" value={<Money value={summary.jarTotal} />} />
          <Stat label="cash" value={<Money value={summary.cash} />} />
          <Stat label="card" value={<Money value={summary.card} />} />
          <Stat label="jars counted" value={summary.days.reduce((n, d) => n + d.jarCount, 0)} />
        </div>
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          Cash and card come from how each jar was counted, so they always add up to the jar
          total. Card takings are already inside it and are never added again — double
          counting them is what made the old spreadsheet's grand total look like $6,089.06.
        </p>
      </div>

      <div className="card">
        <h2>By day</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="right">Jars</th>
                <th className="right">Cash</th>
                <th className="right">Card</th>
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.days.map((row) => (
                <tr key={row.day}>
                  <td>
                    <strong>{DAY_LABEL[row.day]}</strong>
                    {row.stillOut > 0 && (
                      <div className="small" style={{ color: 'var(--warn)' }}>
                        {row.stillOut} still out
                      </div>
                    )}
                  </td>
                  <td className="right muted">{row.jarCount}</td>
                  <td className="right">
                    <Money value={row.cash} />
                  </td>
                  <td className="right">
                    <Money value={row.card} />
                  </td>
                  <td className="right">
                    <strong>
                      <Money value={row.jarTotal} />
                    </strong>
                  </td>
                </tr>
              ))}
              {summary.days.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No jars counted yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Notes</h2>
          {ordered.length > 0 && (
            <button className="tiny" onClick={exportNotes}>
              Export CSV
            </button>
          )}
        </div>
        <p className="small muted">
          The things a figure cannot say. A jar found on the Monday, a float that went out and
          came back, a count nobody trusts.
        </p>

        {canEdit && (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <textarea
            rows={2}
            aria-label={editing ? 'Change this note' : 'Write a note'}
            style={{ flex: '1 1 20rem' }}
            value={draft}
            placeholder="Found jar 14 behind the till — counted it in on the Monday."
            onChange={(e) => setDraft(e.target.value)}
          />
          <button className="primary" disabled={busy || !draft.trim()} onClick={() => void write()}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Add note'}
          </button>
          {editing && (
            <button
              onClick={() => {
                setEditing(null)
                setDraft('')
              }}
            >
              Cancel
            </button>
          )}
        </div>
        )}

        {ordered.length === 0 ? (
          <p className="small muted" style={{ marginTop: '0.75rem' }}>
            Nothing written down yet.
          </p>
        ) : (
          <ul className="issue-list" style={{ marginTop: '0.75rem' }}>
            {ordered.map((note) => (
              <li key={note.id}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {note.text}
                  </div>
                  <div className="small muted">
                    {note.at
                      ? new Date(note.at).toLocaleString('en-CA', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : 'undated'}
                    {note.by && ` · ${note.by}`}
                  </div>
                </div>
                {canEdit && (
                  <div className="row" style={{ gap: '0.3rem' }}>
                    <button
                      className="tiny"
                      onClick={() => {
                        setEditing(note)
                        setDraft(note.text)
                      }}
                    >
                      Edit
                    </button>
                    <button className="tiny danger" onClick={() => remove(note)}>
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}
