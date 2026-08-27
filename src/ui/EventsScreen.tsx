import { useMemo, useRef, useState } from 'react'
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
import {
  closingCost,
  confirmsClosing,
  describeClosing,
  isFinished,
  worthFinishing,
} from '../domain/closing'
import type { ClosingCost } from '../domain/closing'
import {
  describeTransfer,
  readTransfer,
  restoreProblem,
} from '../domain/eventTransfer'
import type { EventTransfer } from '../domain/eventTransfer'
import { finishEvent, gatherClosing, reopenEvent } from '../lib/closing'
import { downloadFile } from '../lib/csv'
import { exportEvent, restoreEvent } from '../lib/eventTransfer'
import { PROJECT_ID } from '../lib/firebase'
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
  const fileInput = useRef<HTMLInputElement>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const [restoring, setRestoring] = useState<{ file: EventTransfer; what: string[] } | null>(null)

  /**
   * A year in a file, for putting back later or carrying to another project.
   *
   * Named for the event and the day it was taken, because the question asked of a folder of
   * these is always "which one is the good one".
   */
  const download = async (event: AppleDayEvent): Promise<void> => {
    setExporting(event.id)
    setNote(null)
    try {
      const file = await exportEvent(event, PROJECT_ID)
      const day = new Date().toISOString().slice(0, 10)
      downloadFile(
        `apple-day-${event.id}-${day}.json`,
        JSON.stringify(file, null, 2),
        'application/json',
      )
      setNote(`Exported ${event.name || event.id}. Keep it somewhere safe — it has names and contact details in it.`)
    } catch (error) {
      setNote((error as Error).message)
    } finally {
      setExporting(null)
    }
  }

  const chooseFile = async (chosen: File | undefined): Promise<void> => {
    if (!chosen) return
    setNote(null)
    const read = readTransfer(await chosen.text())
    if ('problem' in read) {
      setNote(read.problem)
      return
    }
    const stop = restoreProblem(read.file, events.map((e) => e.id))
    if (stop) {
      setNote(stop)
      return
    }
    setRestoring({ file: read.file, what: describeTransfer(read.file) })
  }

  const doRestore = async (): Promise<void> => {
    if (!restoring) return
    setBusy(true)
    try {
      await restoreEvent(restoring.file)
      setNote(`Restored ${restoring.file.event.name || restoring.file.event.id}.`)
      setRestoring(null)
    } catch (error) {
      setNote((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

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
  /**
   * The year somebody is being asked to close out, once what it holds has been counted.
   *
   * Separate from `removing` rather than one dialog with a mode: the two are different
   * decisions — one ends a year, the other erases it — and sharing the state is how a
   * confirmation ends up wired to the wrong verb.
   */
  const [finishing, setFinishing] = useState<
    { event: AppleDayEvent; cost: ClosingCost; gathered: Awaited<ReturnType<typeof gatherClosing>> } | null
  >(null)
  const [reopening, setReopening] = useState<AppleDayEvent | null>(null)
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
  /*
    Closing out a year.

    Counted before it is offered, for the same reason a removal is: "38 links and 52
    parents' contact details" is what makes somebody check they took the export first, and
    "this cannot be undone" on its own is a sentence people click past.
  */
  const askFinish = async (target: AppleDayEvent): Promise<void> => {
    setNote(null)
    setTyped('')
    setBusy(true)
    try {
      const gathered = await gatherClosing(target.id)
      setFinishing({
        event: target,
        cost: closingCost(gathered.passTokens, gathered.people),
        gathered,
      })
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doFinish = async (): Promise<void> => {
    if (!finishing) return
    setBusy(true)
    try {
      const cost = await finishEvent(
        finishing.event,
        finishing.gathered.people,
        finishing.gathered.passTokens,
      )
      setNote(
        `Finished ${finishing.event.name || finishing.event.id}. ${describeClosing(cost).join(' and ') || 'Nothing was left to clear'} — gone.`,
      )
      setFinishing(null)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const doReopen = async (): Promise<void> => {
    if (!reopening) return
    setBusy(true)
    try {
      await reopenEvent(reopening)
      setNote(`Reopened ${reopening.name || reopening.id}. The passes and contact details stay gone.`)
      setReopening(null)
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
            /*
              Both real buttons, the same size, grouped to one side. Restoring is the rarer
              of the two, so it takes the plain weight and the ellipsis that means it opens
              something — but it is still the same kind of control, and dressing it as a
              smaller one made the row read as a heading with two unrelated bits stuck to it.
            */
            <div className="row">
              <button onClick={() => fileInput.current?.click()}>Restore from a file…</button>
              {/*
                A real button opening a hidden input. A `<label>` dressed as one cannot be
                reached by keyboard and is not announced as a button by a screen reader.
              */}
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  void chooseFile(e.target.files?.[0])
                  // Cleared so choosing the same file twice still fires.
                  e.target.value = ''
                }}
              />
              <button
                className="primary"
                onClick={() => {
                  setCopyFrom('')
                  setDraft(blankEvent(nextUp.name, nextUp.year, nextUp.template ?? undefined))
                }}
              >
                New event
              </button>
            </div>
          )}
        </div>
        {mayAdd && (
          <p className="small muted" style={{ marginTop: 0 }}>
            {/*
              Said once, near the buttons, rather than in a card further down the page — which
              is where it goes out of sight the moment a group has run four Apple Days.
            */}
            <strong>Export</strong> beside a year writes it to a file, with the shops and
            sections it names, so it can be put back or carried into another project. On the
            free plan it is the only backup there is — and it holds children&apos;s names and
            their parents&apos; numbers, so keep it accordingly.
          </p>
        )}
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
                      {/* Said on the row, because it changes what the year will do: no
                          publishing, no links, and no way to reach a parent. */}
                      {isFinished(e) && (
                        <span className="pill" style={{ marginLeft: '0.4rem' }}>
                          finished
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
                        {/*
                          The only way back from a mistake. An admin pressing Delete takes
                          this year's people, shifts and jars with it, and the free plan has
                          no scheduled export to fall back on — so the backup is the one
                          somebody takes.
                        */}
                        {mayAdd && (
                          <button
                            className="tiny"
                            disabled={exporting === e.id}
                            onClick={() => void download(e)}
                          >
                            {exporting === e.id ? 'Gathering…' : 'Export'}
                          </button>
                        )}
                        {/*
                          Ending the year, which is a different thing from deleting it: the
                          record stays and what the record does not need goes. Offered while
                          there is something left to clear, and then replaced by the way back
                          — which returns the stamp and nothing else.
                        */}
                        {mayAdd && !isFinished(e) && (
                          <button
                            className="tiny"
                            disabled={busy}
                            onClick={() => void askFinish(e)}
                          >
                            Finish
                          </button>
                        )}
                        {mayAdd && isFinished(e) && (
                          <button className="tiny" disabled={busy} onClick={() => setReopening(e)}>
                            Reopen
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

      {restoring && (
        <Modal
          title={`Restore ${restoring.file.event.name || restoring.file.event.id}?`}
          onClose={() => setRestoring(null)}
          footer={
            <>
              <button onClick={() => setRestoring(null)} disabled={busy}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={() => void doRestore()}>
                {busy ? 'Restoring…' : 'Restore it'}
              </button>
            </>
          }
        >
          {/*
            What is in the file, in the words somebody deciding whether to trust it would
            use. "412 documents" tells nobody whether this is the right one.
          */}
          <p>
            {restoring.what.length > 0 ? restoring.what.join(' · ') : 'Nothing but the event itself.'}
          </p>
          <p className="small muted">
            Taken from <strong>{restoring.file.fromProject || 'an unnamed project'}</strong> on{' '}
            {new Date(restoring.file.exportedAt).toLocaleDateString('en-CA', {
              dateStyle: 'medium',
            })}
            .
          </p>
          <p className="small muted">
            Shops and sections it names are written too, so the board is not full of unknown
            places. Nothing already here is removed.
          </p>
        </Modal>
      )}

      {finishing && (
        /*
          What the year stops holding, counted, and typed back before any of it goes.

          The same gesture as a removal because it is the same kind of decision — nothing
          here can undo it — and a different colour, because this one is the responsible
          thing to do at the end of a year rather than the drastic one.
        */
        <Modal
          title={`Finish ${finishing.event.name || finishing.event.id}?`}
          onClose={() => setFinishing(null)}
          footer={
            <>
              <button onClick={() => setFinishing(null)} disabled={busy}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={busy || !confirmsClosing(typed, finishing.event.name)}
                onClick={() => void doFinish()}
              >
                {busy ? 'Finishing…' : 'Finish it'}
              </button>
            </>
          }
        >
          <div className="stack">
            {worthFinishing(finishing.cost) ? (
              <div>
                <strong className="small">This clears</strong>
                <ul className="shift-list">
                  {describeClosing(finishing.cost).map((line) => (
                    <li key={line}>
                      <span className="small">{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="small" style={{ margin: 0 }}>
                There is nothing left to clear — no volunteer links, and no contact details
                on anybody. Finishing it only records that the year is over.
              </p>
            )}

            {/*
              What stays, said as plainly as what goes. Somebody deciding whether to press
              this is deciding whether they can still answer a question about the year in
              three years' time, and the answer is yes.
            */}
            <p className="small" style={{ margin: 0 }}>
              Everything the year was worth stays: the shifts, the jars, the money, and every
              volunteer's name and section — so this year's Calvin is still tellable from the
              last three. What goes is what was only ever there to run the day.
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              A volunteer link is readable by anybody holding it, with no account, and nothing
              expired one — so a page forwarded to a family group chat answers for as long as
              it exists. The schedule cannot be published again afterwards, since publishing
              would write a fresh set of them.
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              Take the export first if you want a copy. Nothing here can put any of this back.
            </p>

            <label>
              Type <strong>{finishing.event.name}</strong> to confirm
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={finishing.event.name}
                aria-label="Type the event name to confirm"
              />
            </label>
          </div>
        </Modal>
      )}

      {reopening && (
        <Modal
          title={`Reopen ${reopening.name || reopening.id}?`}
          onClose={() => setReopening(null)}
          footer={
            <>
              <button onClick={() => setReopening(null)} disabled={busy}>
                Cancel
              </button>
              <button className="primary" disabled={busy} onClick={() => void doReopen()}>
                {busy ? 'Reopening…' : 'Reopen it'}
              </button>
            </>
          }
        >
          <div className="stack">
            <p className="small" style={{ margin: 0 }}>
              The year can be published again, which will hand out new links.
            </p>
            {/*
              The half that does not come back, said before rather than found out after: the
              reason somebody reaches for this is usually that they did not mean to finish it.
            */}
            <p className="small muted" style={{ margin: 0 }}>
              The links that were deleted stay deleted, and the parents' names, emails and
              phone numbers stay cleared. Reopening returns nothing but the ability to publish
              — reminders have no addresses left to send to.
            </p>
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
