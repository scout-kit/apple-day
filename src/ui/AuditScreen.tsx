import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  actorOf,
  fieldLabel,
  groupByDay,
  readableValue,
  sortEntries,
  subjectOf,
  visibleChanges,
} from '../domain/audit'
import type { AuditEntry, AuditNames } from '../domain/audit'
import { fullName } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import { AUDIT_PAGE } from '../domain/paging'
import { matchesTerms, searchTerms } from '../domain/search'
import { useAuditLog, useLocationLibrary, usePeople, useRoster } from '../lib/repo'
import type { AuditScope } from '../lib/repo'
import { useUrlState } from '../lib/urlState'
import { Empty, ErrorNote, Loading } from './Bits'

/**
 * Who changed what, in the order it happened.
 *
 * Built for one conversation: the shop says they handed over $180 and the sheet says $80.
 * Until this existed the honest answer was a shrug — an amount is typed once, by whoever is
 * at the table, and a correction afterwards looked exactly like the original.
 *
 * A card apiece rather than a run of bullets, and a page at a time rather than all of it.
 * The log has no end — nothing is ever removed from it, by rule — so "render the lot" was
 * only ever going to work while it was new.
 */
const time = (at: number): string =>
  new Date(at).toLocaleTimeString('en-CA', { timeStyle: 'short' })

const dayHeading = (at: number): string =>
  new Date(at).toLocaleDateString('en-CA', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

const ACTION_LABEL: Record<AuditEntry['action'], string> = {
  created: 'Added',
  updated: 'Changed',
  deleted: 'Removed',
}

function Entry({
  entry,
  names,
  here,
}: {
  entry: AuditEntry
  names: AuditNames
  /** The event being looked at, so an entry from elsewhere can say so. */
  here: string | null
}): ReactNode {
  const subject = subjectOf(entry, names)
  const changes = visibleChanges(entry)
  return (
    <li className={`log-card is-${entry.action}`}>
      <div className="log-top">
        <span className="log-what">
          <span className={`log-action is-${entry.action}`}>{ACTION_LABEL[entry.action]}</span>
          <strong className="small">{entry.summary || `${entry.entity} ${entry.entityId}`}</strong>
        </span>
        <span className="small muted nowrap">
          {/*
            Which event, when it is not the one on screen. Without it a list covering every
            year reads as though it all happened to this one — and the shared setup, which
            happened to no year in particular, reads as though it happened to this one too.
          */}
          {entry.eventId !== here && (
            <span className="pill" style={{ marginRight: '0.3rem' }}>
              {entry.eventId ?? 'shared setup'}
            </span>
          )}
          {time(entry.at)}
        </span>
      </div>

      {/* Who, where and when — the three things "removed a shift" never said. */}
      {subject && <div className="small">{subject}</div>}

      {changes.length > 0 && (
        <div className="log-changes small">
          {changes.map((c) => (
            <div key={c.field}>
              <span className="muted">{fieldLabel(c.field)}: </span>
              <span className="mono">{readableValue(c.field, c.from, names)}</span>
              {c.from === c.to ? null : (
                <>
                  {' → '}
                  <span className="mono">{readableValue(c.field, c.to, names)}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="small muted">by {actorOf(entry, names)}</div>
    </li>
  )
}

export function AuditScreen(): ReactNode {
  /*
    One control, not two.

    The window is what is asked of Firestore and what is rendered, both. Paging the fetch
    separately from the display would mean two "show more" buttons that disagree, and the
    second one would be lying about how much there is.
  */
  const [window, setWindow] = useState(AUDIT_PAGE)
  /*
    Everything by default.

    The log used to read only this event's entries, and the library, the sections and the
    access list are written with no event against them — so a shop being renamed, or
    somebody being let in, was on the record and on no screen. Narrowing is offered; it is
    not the starting point, because you cannot narrow to something you do not know is there.
  */
  const [scope, setScope] = useUrlState('scope')
  const shown: AuditScope =
    scope === 'event' || scope === 'shared' ? (scope as AuditScope) : 'all'
  const log = useAuditLog(window, shown)
  const library = useLocationLibrary()
  const people = usePeople()
  const roster = useRoster()
  const { eventId, slots } = useEvent()
  const [search, setSearch] = useUrlState('find')

  /*
    Names, looked up when the log is read rather than stored on the entry.

    The entry keeps ids because they are exact and still mean something in three years. What
    a reader wants is "Sobeys · Fri 5:00 PM · Elliot R", and where a location has since been
    renamed or a person removed, the id shows through — which is the honest answer, and more
    use than a blank.
  */
  const names = useMemo<AuditNames>(() => {
    const locations = new Map(library.data.map((l) => [l.id, l.name]))
    const persons = new Map(people.data.map((p) => [p.id, fullName(p)]))
    const slotLabels = new Map(slots.map((sl) => [sl.id, `${sl.label}`]))
    /*
      Organizers by address, not by display name.

      A log read years later in an argument needs to name somebody in a way that can be
      acted on, and a Google display name is whatever they set it to — two Scouters called
      Dave read as the same line. The address is the same string that appears on the access
      list and in the invitation that granted it.
    */
    const users = new Map(roster.data.map((r) => [r.uid, r.email]))
    return {
      location: (id) => locations.get(id),
      person: (id) => persons.get(id),
      slot: (id) => slotLabels.get(id),
      user: (uid) => users.get(uid),
    }
  }, [library.data, people.data, roster.data, slots])

  const rows = useMemo(() => {
    const terms = searchTerms(search)
    return sortEntries(log.data).filter((e) =>
      /*
        Searchable by what is on screen, not by what is stored. Somebody looks up a youth by
        name or a shop by name; neither appears in the entry, only their ids — so the
        resolved forms go into the haystack too.
      */
      matchesTerms(terms, [
        e.summary,
        actorOf(e, names),
        e.entity,
        e.entityId,
        subjectOf(e, names),
        ...e.changes.flatMap((c) => [
          fieldLabel(c.field),
          readableValue(c.field, c.from, names),
          readableValue(c.field, c.to, names),
        ]),
      ]),
    )
  }, [log.data, search, names])

  const days = useMemo(() => groupByDay(rows), [rows])

  /*
    Fewer back than were asked for means there is no more to have. Anything else and there
    may be — including the exact case where the last page happens to be full, which is why
    the button stays until a short page proves otherwise rather than guessing at a total.
  */
  const mayBeMore = log.data.length >= window

  if (log.loading && log.data.length === 0) return <Loading what="Reading the log" />

  return (
    <>
      <ErrorNote error={log.error} />

      <div className="card">
        <h1>Audit log</h1>
        <p className="muted small">
          Every change to the money, the shifts and the totals, with who made it. Entries
          cannot be edited or removed by anybody, including whoever wrote them.
        </p>
        <div className="row">
          <label style={{ flex: '0 1 14rem' }}>
            Showing
            <select
              value={shown}
              onChange={(e) => {
                setScope(e.target.value)
                // Back to the first page: the old window is a count of different entries.
                setWindow(AUDIT_PAGE)
              }}
            >
              <option value="all">Everything</option>
              <option value="event">This event only</option>
              <option value="shared">Shared setup only</option>
            </select>
          </label>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {shown === 'shared'
            ? 'The location library, the sections and the access list — shared between every year.'
            : shown === 'event'
              ? 'Only what was changed about this Apple Day. Changes to the library, the sections and the access list are not tied to an event and are not shown here.'
              : 'Every change to every year, and to the library, the sections and the access list.'}
        </p>
        <input
          type="search"
          placeholder="Find a jar, a person, an amount…"
          value={search}
          aria-label="Search the log"
          onChange={(e) => setSearch(e.target.value)}
        />
        {/*
          Said plainly, because otherwise it is a trap: a search that comes back empty looks
          like an answer, and here it may only mean the entry is further back than has been
          fetched.
        */}
        {search.trim() !== '' && mayBeMore && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Searching the {log.data.length} most recent changes. Show older ones below to
            search further back.
          </p>
        )}
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <Empty>
            {log.data.length === 0
              ? 'Nothing has been changed yet this event.'
              : 'Nothing here matches that.'}
          </Empty>
        ) : (
          days.map((day) => (
            <section key={day.key} className="log-day">
              <h2 className="log-date">{dayHeading(day.entries[0]!.at)}</h2>
              <ul className="log-list">
                {day.entries.map((e) => (
                  <Entry key={e.id} entry={e} names={names} here={eventId} />
                ))}
              </ul>
            </section>
          ))
        )}

        {mayBeMore && (
          <div className="row center" style={{ marginTop: '0.8rem' }}>
            <button
              disabled={log.loading}
              onClick={() => setWindow((w) => w + AUDIT_PAGE)}
            >
              {log.loading ? 'Reading…' : `Show ${AUDIT_PAGE} older changes`}
            </button>
          </div>
        )}
      </div>
    </>
  )
}
