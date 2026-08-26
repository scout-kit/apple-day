import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { activeDays, DAY_SHORT, formatTime } from '../domain/slots'
import type { AppleDayEvent } from '../domain/types'
import {
  eventLinkFor,
  eventLinkProblem,
  slugifyEventName,
  useEvent,
} from '../lib/eventContext'
import {
  copyEventLocations,
  useEventLocations,
  useLocationLibrary,
  removeEvent,
  tallyEvent,
} from '../lib/repo'
import { ErrorNote, Loading } from './Bits'
import { blankEvent } from '../domain/events'
import { EventSettings } from './EventSettings'
import {
  confirmsRemoval,
  describeRemoval,
  holdsAnything,
} from '../domain/eventRemoval'
import type { EventTally } from '../domain/eventRemoval'
import { canAddEvent, canEditEvent, useSession } from '../lib/session'
import { Modal } from './Modal'

/**
 * Every Apple Day the group has run, and the one being worked on.
 *
 * Each year is its own event: its own signups, schedule, jars and money. Locations are
 * shared from the library, but which ones a year uses — and in what order — belongs to
 * the year, so setting up 2027 cannot rewrite what 2026 recorded.
 */
export function EventsScreen(): ReactNode {
  const { role } = useSession()
  /*
    An organizer reads this screen to see which events there are and which one they are in.
    Creating and editing one is an admin's: the dates, the hours and the shift shape decide
    what every other screen shows.
  */
  const mayEdit = canEditEvent(role)
  // Starting a year, and ending one, stay with whoever is accountable for the record.
  const mayAdd = canAddEvent(role)

  const { events, event, loading, error, createEvent, saveEvent } = useEvent()
  const library = useLocationLibrary()

  /** The event being filled in, before anything is written. Null when nobody is creating. */
  const [draft, setDraft] = useState<AppleDayEvent | null>(null)
  const [copyFrom, setCopyFrom] = useState<string>('')
  const [editing, setEditing] = useState<AppleDayEvent | null>(null)
  /** The event somebody is being asked to confirm losing, once its contents are counted. */
  const [removing, setRemoving] = useState<{ event: AppleDayEvent; tally: EventTally } | null>(
    null,
  )
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  /** Why the typed link cannot be used, or null. Blocks saving rather than warning. */
  const linkProblem = useMemo(
    () => (editing ? eventLinkProblem(editing.slug, editing, events) : null),
    [editing, events],
  )

  /** The id a draft's name would produce — its link, and what marks it as already taken. */
  const draftId = useMemo(
    () => (draft?.name.trim() ? slugifyEventName(draft.name) : ''),
    [draft],
  )
  const draftLinkProblem = useMemo(
    () => (draft ? eventLinkProblem(draft.slug, { id: draftId }, events) : null),
    [draft, draftId, events],
  )

  /*
    Why the draft cannot be created yet, in the order somebody would hit them.

    Checked while the form is open rather than on the button press, so the answer arrives
    while the dialog is still there to act on it.
  */
  const draftProblem = useMemo((): string | null => {
    if (!draft) return null
    if (!draft.name.trim()) return 'Give it a name.'

    /*
      Three ways a new event can collide with one that is already here, and all of them
      matter — the write merges onto its derived id, so a clash does not fail, it quietly
      joins two years into one.

      The id is the dangerous one. The name is the confusing one: two events called the
      same thing are indistinguishable in every list in the app. And an id another event
      already answers to by its link makes both unreachable, since resolution has two
      candidates and no way to choose. All three are checked, because a year named "Apple
      Day 2026" sits under the id "2026" and only one of those is what anybody typed.
    */
    const wanted = draft.name.trim().toLowerCase()
    const clash = events.find(
      (e) =>
        e.id === draftId ||
        e.name.trim().toLowerCase() === wanted ||
        (e.slug.trim() !== '' && e.slug.trim().toLowerCase() === draftId),
    )
    if (clash) {
      return `“${clash.name}” already exists — select it from the list instead.`
    }
    if (draftLinkProblem) return draftLinkProblem
    if (activeDays(draft.schedule).length === 0) {
      return 'Turn on at least one day, or there is nothing to schedule.'
    }
    if (draft.shiftMode === 'shifts' && draft.overlapMinutes >= draft.shiftMinutes) {
      return 'An overlap has to be shorter than the shift.'
    }
    return null
  }, [draft, draftId, draftLinkProblem, events])

  /*
    Counted before asking, not after.

    "This cannot be undone" is easy to click past. "113 people, 75 shifts, 64 jars" is the
    sentence that makes somebody stop and check which event they are on.
  */
  const askRemove = async (target: AppleDayEvent): Promise<void> => {
    setNote(null)
    setTyped('')
    setBusy(true)
    try {
      setRemoving({ event: target, tally: await tallyEvent(target.id) })
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doRemove = async (): Promise<void> => {
    if (!removing) return
    setBusy(true)
    try {
      await removeEvent(removing.event)
      setNote(`Removed ${removing.event.name || removing.event.id}.`)
      setRemoving(null)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const currentSettings = useEventLocations()

  /**
   * What to call the next one, and which year to start it from.
   *
   * The year after the latest on file, named plainly. The list is newest first, so the
   * event to copy is the one at the top — the hours, the shift shape, the base and the
   * day-of contacts all carry over, and only the dates are worked out afresh.
   */
  const nextUp = useMemo(() => {
    const years = events.map((e) => e.year).filter((y) => y > 0)
    const year = (years.length > 0 ? Math.max(...years) : new Date().getFullYear() - 1) + 1
    const template = events.find((e) => e.year === Math.max(...years, 0)) ?? events[0] ?? null
    return { year, name: `Apple Day ${year}`, template }
  }, [events])

  const create = async (): Promise<void> => {
    if (!draft || draftProblem) return
    setBusy(true)
    setNote(null)
    try {
      const name = draft.name.trim()
      // Written once, with everything on the form. Defaults first and edits after would put
      // two entries in the audit log for one act.
      const id = await createEvent(draft)

      // Copying last year's location list is the shortcut that makes setting up a new
      // year quick: mostly the same places, then toggle off what closed.
      if (copyFrom) {
        const source = copyFrom === event?.id ? currentSettings.data : []
        if (source.length > 0) {
          const n = await copyEventLocations(id, source)
          setNote(`Created “${name}” and copied ${n} locations.`)
        } else {
          setNote(
            `Created “${name}”. Could not copy locations — select the event you want to ` +
              'copy from first, then create, and its locations come across.',
          )
        }
      } else {
        setNote(`Created “${name}”. Add locations from the library next.`)
      }
      setDraft(null)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const saveWindow = async (): Promise<void> => {
    if (!editing) return
    setBusy(true)
    try {
      await saveEvent(editing)
      setEditing(null)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Loading what="Loading events" />

  return (
    <>
      <ErrorNote error={error ?? library.error} />
      {note && <div className="note info">{note}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>Events</h1>
          {mayAdd && (
            <button
              className="primary"
              onClick={() => {
                setCopyFrom('')
                setDraft(blankEvent(nextUp.name, nextUp.year, nextUp.template ?? undefined))
              }}
            >
              New event
            </button>
          )}
        </div>
        {events.length === 0 ? (
          <p className="muted">
            No events yet. Create one — each keeps its own signups, schedule and money.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Dates</th>
                  <th>Base</th>
                  <th>Days and hours</th>
                  <th>Shifts</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <strong>{e.name}</strong>
                      {event?.id === e.id && (
                        <span className="pill scouts" style={{ marginLeft: '0.4rem' }}>
                          open
                        </span>
                      )}
                      <div className="small muted mono">/e/{eventLinkFor(e)}</div>
                    </td>
                    <td className="small muted nowrap">
                      {e.fridayDate || '—'} / {e.saturdayDate || '—'}
                    </td>
                    <td className="small">
                      {e.baseLocationId ? (
                        library.data.find((l) => l.id === e.baseLocationId)?.name ?? (
                          <span className="muted">unknown</span>
                        )
                      ) : (
                        <span className="muted">not set</span>
                      )}
                    </td>
                    <td className="small">
                      {activeDays(e.schedule).length === 0 ? (
                        <span className="muted">no days set</span>
                      ) : (
                        activeDays(e.schedule).map((day) => (
                          <div key={day} className="nowrap">
                            {DAY_SHORT[day]} {formatTime(e.schedule[day]!.startMin)} –{' '}
                            {formatTime(e.schedule[day]!.endMin)}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="small nowrap">
                      {e.shiftMode === 'wholeDay' ? (
                        <span className="muted">whole day</span>
                      ) : (
                        <>
                          {e.shiftMinutes} min
                          {e.overlapMinutes > 0 && (
                            <div className="muted">{e.overlapMinutes} min overlap</div>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <div className="row">
                        {mayEdit && (
                          <button className="tiny" onClick={() => setEditing(e)}>
                            Edit
                          </button>
                        )}
                        {/* Admin only, and the only thing here that nothing else can undo. */}
                        {mayAdd && (
                          <button className="tiny danger" onClick={() => void askRemove(e)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          {events.length} year{events.length === 1 ? '' : 's'} stored. Locations live in the library and are shared by every year; each year picks which
          of them it uses.
        </p>
      </div>

      {draft && (
        <Modal
          title="New event"
          onClose={() => setDraft(null)}
          footer={
            <>
              <button onClick={() => setDraft(null)}>Cancel</button>
              <button
                className="primary"
                disabled={busy || draftProblem !== null}
                onClick={() => void create()}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
            </>
          }
        >
          <div className="stack">
            <EventSettings
              draft={draft}
              onChange={setDraft}
              library={library.data}
              eventId={draftId}
              linkProblem={draftLinkProblem}
              mode="new"
            />

            {/*
              The one field that belongs to creating and not to editing: which year's
              location list to start from. Afterwards there is nothing to copy — the event
              has its own list, and the library screen is where it is changed.
            */}
            <label>
              Start from another event&apos;s locations
              <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Start empty</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {event?.id === e.id ? ' (open)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <p className="small muted">
              Copying brings across the location list and its order, all switched on. Toggle
              off whatever is not happening.
            </p>
            {copyFrom && copyFrom !== event?.id && (
              <div className="note warning">
                Only the currently open event&apos;s locations can be copied. Open{' '}
                {events.find((e) => e.id === copyFrom)?.name} first, then create.
              </div>
            )}

            {draftProblem && <div className="note error">{draftProblem}</div>}
          </div>
        </Modal>
      )}

      {removing && (
        /*
          Named, counted, and typed back before anything goes.

          This is the one action here that no other screen can undo. The audit log will say
          who did it and what went, and will not bring any of it back — so the confirmation
          is the name of the event rather than a red button, which is the difference between
          meaning it and mis-clicking.
        */
        <Modal
          title={`Remove ${removing.event.name || removing.event.id}?`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button onClick={() => setRemoving(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="danger"
                disabled={busy || !confirmsRemoval(typed, removing.event.name)}
                onClick={() => void doRemove()}
              >
                {busy ? 'Removing…' : 'Remove it'}
              </button>
            </>
          }
        >
          <div className="stack">
            {holdsAnything(removing.tally) ? (
              <div>
                <strong className="small">This takes with it</strong>
                <ul className="shift-list">
                  {describeRemoval(removing.tally).map((line) => (
                    <li key={line}>
                      <span className="small">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="small" style={{ margin: 0 }}>
                This event holds nothing — no people, no shifts, no jars.
              </p>
            )}

            {/*
              Said plainly rather than left to be discovered. Audit entries cannot be
              deleted by anybody, by rule, which is the whole point of them — so a removal
              is never quite total, and pretending otherwise would be the wrong promise.
            */}
            <p className="small muted" style={{ margin: 0 }}>
              The audit log keeps its record of this event and of this removal. Nothing else
              survives it, and nothing here can put any of it back.
            </p>

            <label>
              Type <strong>{removing.event.name}</strong> to confirm
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={removing.event.name}
                aria-label="Type the event name to confirm"
              />
            </label>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal
          title={editing.name}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="primary"
                disabled={busy || linkProblem !== null}
                onClick={() => void saveWindow()}
              >
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="stack">
            <EventSettings
              draft={editing}
              onChange={setEditing}
              library={library.data}
              eventId={editing.id}
              linkProblem={linkProblem}
              mode="edit"
            />
            <p className="small muted">
              Changing the hours, the shift length or the overlap after people are scheduled
              does not delete their shifts. Shifts that no longer line up with a slot are
              flagged on the board so you can move them.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
