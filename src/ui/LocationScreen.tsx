import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  ALL_EVENTS,
  eventLabels,
  hourlyTrends,
  locationTrends,
  lookbackIds,
  newestFirst,
  previousEvent,
} from '../domain/history'
import { eventLabel } from '../domain/events'
import { mapLink } from '../domain/maps'
import { locationMetrics } from '../domain/metrics'
import { groupIntoRuns, runSpan, runState } from '../domain/shiftRuns'
import {
  DAY_LABEL,
  DAY_SHORT,
  formatOpenRange,
  formatTime,
  isHoursRecorded,
  isOpenOn,
} from '../domain/slots'
import { DAYS, isCounted } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import { canEditLibrary, useSession } from '../lib/session'
import { useUrlState } from '../lib/urlState'
import {
  useAssignments,
  useEventHistory,
  useJars,
  useLocationLibrary,
  useLocations,
  usePeople,
} from '../lib/repo'
import { Change, ErrorNote, Hours, Loading, Money, SectionPill, Stat } from './Bits'
import { GroupedBars } from './GroupedBars'
import { LocationEditor } from './LocationEditor'
import { MapModal } from './MapModal'
import { PersonLink } from './PersonLink'

/**
 * Everything about one location, in one place.
 *
 * The counterpart of the person page, and it exists for the same reason: the facts about a
 * shop were spread over six screens. Its address and site contact were in the library, its
 * priority in this year's list, its takings on the money screen, its best hour on another
 * tab of that screen, its year-on-year row on the history page, and its hour-by-hour
 * comparison behind a picker on that same page — which was the most interesting thing about
 * it and the hardest to reach.
 *
 * "Is this door worth standing at, and when" is a question about a location. Nothing
 * answered it in one place.
 */
export function LocationScreen(): ReactNode {
  const { locationId } = useParams<{ locationId: string }>()
  const { event, events: allYears, slots } = useEvent()
  const { role } = useSession()
  const library = useLocationLibrary()
  const locations = useLocations()
  const assignments = useAssignments()
  const jars = useJars()
  const people = usePeople()
  const [showMap, setShowMap] = useState(false)
  const [editing, setEditing] = useState(false)

  // In the address bar, so a link to this page carries which way you were reading it.
  const [shape, setShape] = useUrlState('as', 'chart')

  /*
    From the library, not from this year's list.

    A location dropped from this year still exists and still has a history worth reading —
    looking it up in the year-scoped list would report it missing, which is the same bug
    the base of operations had.
  */
  const location = useMemo(
    () => library.data.find((l) => l.id === locationId) ?? null,
    [library.data, locationId],
  )

  /** This year's settings for it, when it is being used this year. */
  const thisYear = useMemo(
    () => locations.data.find((l) => l.id === locationId) ?? null,
    [locations.data, locationId],
  )

  const shifts = useMemo(() => {
    const slotById = new Map(slots.map((s) => [s.id, s]))
    const personById = new Map(people.data.map((p) => [p.id, p]))
    return assignments.data
      .filter((a) => a.locationId === locationId && a.status !== 'swapped')
      .map((a) => ({
        assignment: a,
        slot: slotById.get(a.slotId),
        person: personById.get(a.personId) ?? null,
      }))
      .sort((a, b) => (a.slot?.startMin ?? 0) - (b.slot?.startMin ?? 0))
  }, [assignments.data, slots, people.data, locationId])

  /**
   * Those shifts as the turns people actually took here.
   *
   * Somebody down for three hours at this shop was three rows, which reads as three
   * different volunteers to anybody scanning the column, and made the count above wrong
   * in the way that matters — it counted hours and called them shifts.
   *
   * Grouped one person at a time rather than in a single pass, because runs continue only
   * against the previous run: at a shop where two people overlap, one list interleaves
   * them and neither stretch joins up.
   */
  const runs = useMemo(() => {
    const byPerson = new Map<string, typeof shifts>()
    for (const row of shifts) {
      const key = `${row.assignment.personId}|${row.slot?.day ?? '?'}`
      byPerson.set(key, [...(byPerson.get(key) ?? []), row])
    }

    return [...byPerson.values()]
      .flatMap((theirs) =>
        groupIntoRuns(
          theirs.map((row) => ({
            row,
            // Constant across this list — every shift here is here. The run boundary that
            // matters is the person and the day, which is what the buckets above are.
            locationId: locationId ?? '',
            startMin: row.slot?.startMin ?? null,
            endMin: row.slot?.endMin ?? null,
          })),
        ),
      )
      .sort(
        (a, b) =>
          DAYS.indexOf(a.items[0]!.row.slot?.day ?? 'sun') -
            DAYS.indexOf(b.items[0]!.row.slot?.day ?? 'sun') ||
          (a.startMin ?? 0) - (b.startMin ?? 0),
      )
  }, [shifts, locationId])

  /**
   * The jars counted here, each with the shift it was out for.
   *
   * A row saying "jar 4 · $100" cannot be placed: on a two-day event the useful question is
   * whether that was the Friday evening or the Saturday morning, and the answer is sitting
   * on the jar and on the shifts it was issued against.
   *
   * A jar that straddles two hours reads as the stretch it covered, because that is what
   * somebody carried it for. Money recorded by hand has no shift at all, so it gets the day
   * and nothing more — which is all that was ever known about it.
   */
  const theirJars = useMemo(() => {
    const slotById = new Map(slots.map((s) => [s.id, s]))
    const slotOf = new Map(assignments.data.map((a) => [a.id, slotById.get(a.slotId)]))
    const personById = new Map(people.data.map((p) => [p.id, p]))

    return jars.data
      .filter((j) => j.locationId === locationId)
      .map((jar) => {
        const covered = jar.assignmentIds
          .map((id) => slotOf.get(id))
          .filter((slot): slot is NonNullable<typeof slot> => Boolean(slot))
          .sort((a, b) => a.startMin - b.startMin)

        const first = covered[0]
        const last = covered.at(-1)
        const when = !first
          ? DAY_LABEL[jar.day]
          : first === last
            ? `${DAY_LABEL[jar.day]} · ${first.label}`
            : `${DAY_LABEL[jar.day]} · ${formatTime(first.startMin)} – ${formatTime(
                last!.endMin,
              )}`

        return { jar, when, holder: jar.personId ? personById.get(jar.personId) ?? null : null }
      })
      .sort((a, b) => b.jar.countedAt - a.jar.countedAt)
  }, [jars.data, assignments.data, people.data, slots, locationId])

  /** This event's takings and what an hour there was worth. */
  const metrics = useMemo(() => {
    if (!thisYear) return null
    const report = locationMetrics([thisYear], assignments.data, jars.data, slots)
    return [...report.ranked, ...report.revenueWithoutHours].find(
      (r) => r.locationId === locationId,
    ) ?? null
  }, [thisYear, assignments.data, jars.data, slots, locationId])

  const names = useMemo(
    () => new Map(library.data.map((l) => [l.id, l.name])),
    [library.data],
  )

  /*
    What this year is held against, same as the history screen and the same key in the URL.

    Every year at once made the chart harder to read with each one that passed, and the
    question asked at a shop door is nearly always about last year.
  */
  const [against, setAgainst] = useUrlState('vs')

  /* Built from the event list, not the loaded history — see the history screen. */
  const allEvents = useMemo(
    // Already newest first — the event list is sorted once, where it is loaded. Sorting it
    // again here is how the two came to disagree.
    () => allYears.map((e) => ({ eventId: e.id, name: e.name, year: e.year })),
    [allYears],
  )
  const allLabels = useMemo(() => eventLabels(allEvents), [allEvents])

  /*
    Two years, not every year.

    This page is reached by clicking a shop name from the board, the day-of table or the
    money screen, so it is opened far more often than the history screen is — and it was
    reading every year that had ever run, every time, to show the one before this.
  */
  const wanted = useMemo(
    () => lookbackIds(allYears, event?.id ?? null, against || null),
    [allYears, event?.id, against],
  )
  const history = useEventHistory(wanted)
  const shownHistory = history.data

  const previousLabel = useMemo(() => {
    const before = previousEvent(allYears, event?.id ?? null)
    return before ? ((allLabels.get(before.id) ?? eventLabel(before))) : ''
  }, [allYears, event?.id, allLabels])

  /** Every year it has been used, and the hours within them — this location only. */
  const trend = useMemo(() => {
    const { events, rows } = locationTrends(shownHistory, names)
    return { events, row: rows.find((r) => r.locationId === locationId) ?? null }
  }, [shownHistory, names, locationId])

  const byHour = useMemo(
    () => (locationId ? hourlyTrends(shownHistory, [locationId]) : { events: [], rows: [] }),
    [shownHistory, locationId],
  )

  /** Whether to caption each hour with its day. One day needs no caption. */
  const daysShown = useMemo(
    () => new Set(byHour.rows.map((r) => r.day)).size,
    [byHour.rows],
  )

  if (library.loading) return <Loading what="Looking it up" />

  if (!location) {
    return (
      <div className="card">
        <h1>Not found</h1>
        <p className="muted">
          No location with that id. It may have been deleted from the library, which past
          years still reference by id.
        </p>
      </div>
    )
  }

  // Counted over runs for the same reason the table lists them: an hourly count of
  // arrivals against a run count of shifts puts more people checked in than booked.
  const worked = runs.filter(
    (run) => runState(run.items.map((i) => i.row.assignment)).attendance === 'arrived',
  ).length
  const openDays = DAYS.filter((d) => isOpenOn(location.openHours, d))

  return (
    <>
      <ErrorNote
        error={assignments.error ?? jars.error ?? locations.error ?? library.error}
      />

      {editing && (
        <LocationEditor location={location} onClose={() => setEditing(false)} />
      )}

      {showMap && (
        // Just the pin: the question here is where this place is, not how to reach it from
        // anywhere in particular.
        <MapModal
          place={{
            name: location.name,
            address: location.address,
            mapsUrl: mapLink(location),
            comments: location.comments,
          }}
          base={null}
          onClose={() => setShowMap(false)}
        />
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ marginBottom: '0.2rem' }}>{location.name}</h1>
            {location.address && (
              <p className="small muted" style={{ margin: 0 }}>
                {location.address}{' '}
                <button className="tiny" onClick={() => setShowMap(true)}>
                  Map
                </button>
              </p>
            )}
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
          <div className="stats">
            <Stat label="shifts" value={shifts.length} />
            <Stat label="raised" value={<Money value={metrics?.revenue ?? 0} />} />
            <Stat label="per hour" value={<Money value={metrics?.revenuePerHour ?? null} />} />
          </div>
          {/*
            The same editor the library uses.

            An edit here is an edit to every year at once, which is why removing a location
            stays with an admin — but finding an address wrong happens standing outside the
            shop, and the person standing there should be able to fix it. Renames do not
            lose history: the roll-ups resolve old spellings through `aliases`.
          */}
          {canEditLibrary(role) && (
            <button onClick={() => setEditing(true)}>Edit details</button>
          )}
          </div>
        </div>

        <div className="row" style={{ marginTop: '0.5rem' }}>
          {thisYear ? (
            <span className="small">
              Used this year · priority {thisYear.priority}
              {thisYear.active ? '' : ' · switched off'}
            </span>
          ) : (
            <span className="small muted">Not used in {event ? eventLabel(event) : 'this year'}.</span>
          )}
          {location.groupCode && (
            <span className="small muted">
              Area {location.groupCode.trim().toUpperCase()} — shared with any other shop
              carrying it, so a pair can take a door each
            </span>
          )}
        </div>
      </div>

      {/*
        Everything else the record holds.

        The contact, the insurance and the notes, and also the opening hours and the past
        names. Those last two are easy to leave off and both matter: the hours decide whether
        a shift can be staffed at all, and the past names are what keep four years of takings
        on one row.
      */}
      <div className="card">
        <h2>Arranging it</h2>

        <div className="row" style={{ alignItems: 'flex-start', gap: '2rem' }}>
          <div>
            <strong className="small">When it is open</strong>
            {openDays.length > 0 ? (
              openDays.map((d) => (
                <div key={d} className="small nowrap">
                  {DAY_LABEL[d]} {formatOpenRange(location.openHours[d])}
                </div>
              ))
            ) : (
              <div className="small muted">
                {/* Never recorded and closed all week are different facts: one is a gap in
                    the library, the other is a decision. */}
                {DAYS.some((d) => isHoursRecorded(location.openHours, d))
                  ? 'Closed all week.'
                  : 'No hours recorded.'}
              </div>
            )}
          </div>

          {location.aliases.length > 0 && (
            <div>
              <strong className="small">Also known as</strong>
              <div className="small muted">{location.aliases.join(' · ')}</div>
              <div className="small muted">
                Past spellings, so every year lands on one row.
              </div>
            </div>
          )}
        </div>

          {location.siteContact && (
            <p className="small" style={{ margin: '0.6rem 0 0.3rem' }}>
              <strong>{location.siteContact.name}</strong>
              {location.siteContact.role && ` · ${location.siteContact.role}`}
              {location.siteContact.phone && (
                <>
                  {' · '}
                  <a href={`tel:${location.siteContact.phone}`}>
                    {location.siteContact.phone}
                  </a>
                </>
              )}
              {location.siteContact.email && (
                <>
                  {' · '}
                  <a href={`mailto:${location.siteContact.email}`}>
                    {location.siteContact.email}
                  </a>
                </>
              )}
            </p>
          )}
          {location.insurance && <p className="small muted">Insurance: {location.insurance}</p>}
          {location.comments && (
            <p className="small" style={{ whiteSpace: 'pre-line' }}>
              {location.comments}
            </p>
          )}

          {!location.siteContact && !location.insurance && !location.comments && (
            <p className="small muted">
              Nobody named here, and no notes. Whoever arranges it next has nothing to go on.
            </p>
          )}
      </div>

      {history.loading ? (
        <div className="card">
          <Loading what="Adding up every year" />
        </div>
      ) : (
        <>
          {trend.row && trend.events.length > 0 && (
            <div className="card">
              <div className="row between">
                <h2 style={{ margin: 0 }}>Year by year</h2>
                {/* Governs the table and the hour chart below it, so it sits above both. */}
                {allEvents.length > 1 && (
                  <label className="small muted">
                    Compared with{' '}
                    <select
                      value={against}
                      aria-label="Compare with"
                      onChange={(e) => setAgainst(e.target.value)}
                    >
                      <option value="">
                        {previousLabel ? `${previousLabel} (last time)` : 'the time before'}
                      </option>
                      {allEvents
                        .filter((e) => e.eventId !== event?.id)
                        .map((e) => (
                          <option key={e.eventId} value={e.eventId}>
                            {allLabels.get(e.eventId) ?? eventLabel({ id: e.eventId, name: e.name })}
                          </option>
                        ))}
                      <option value={ALL_EVENTS}>every year</option>
                    </select>
                  </label>
                )}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th className="right">Revenue</th>
                      <th className="right">Hours</th>
                      <th className="right">Per hour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {newestFirst(trend.events, trend.row!.cells).map(({ event: e, cell }) => {
                      return (
                        <tr key={e.eventId}>
                          <td>{allLabels.get(e.eventId) ?? eventLabel({ id: e.eventId, name: e.name })}</td>
                          <td className="right">
                            <Money value={cell.revenue} />
                          </td>
                          <td className="right">
                            <Hours value={cell.staffedHours} />
                          </td>
                          <td className="right">
                            <strong>
                              <Money value={cell.revenuePerHour} />
                            </strong>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="small muted">
                Latest change: <Change value={trend.row.changes.revenue} /> on takings,{' '}
                <Change value={trend.row.changes.perHour} /> on what an hour was worth.
              </p>
            </div>
          )}

          {byHour.rows.length > 0 && (
            <div className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2>Hour by hour, year on year</h2>
                {/*
                  One or the other, not both.

                  The chart is for the shape — which end of the evening this door is worth
                  standing at, and whether that has moved. The table is for the figure, when
                  somebody is about to make a decision on it. Showing both stacked makes the
                  card twice as long to say one thing twice.
                */}
                <div className="row" style={{ gap: '0.25rem' }}>
                  {(
                    [
                      ['chart', 'Chart'],
                      ['table', 'Table'],
                    ] as [string, string][]
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      className={shape === id ? 'primary' : ''}
                      onClick={() => setShape(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="small muted" style={{ marginTop: 0 }}>
                {/* The thing this page was worth building for: it lived behind a picker on
                    the history screen, which is the wrong place to ask a question about one
                    shop. */}
                What each hour at this door has been worth. Grouped by the clock rather than
                by shift, so a year that ran hourly shifts and one that overlapped them every
                45 minutes can still be compared.
              </p>

              {shape === 'chart' ? (
                <GroupedBars
                  groups={byHour.rows.map((row) => ({
                    label: formatTime(row.hour * 60),
                    ...(daysShown > 1 ? { sub: DAY_SHORT[row.day] } : {}),
                    values: row.cells.map((c) => (c.ran ? c.revenue : null)),
                  }))}
                  series={byHour.events.map((e) => ({
                    id: e.eventId,
                    label: allLabels.get(e.eventId) ?? eventLabel({ id: e.eventId, name: e.name }),
                  }))}
                  format={(v) => (v >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${v}`)}
                  emptyNote="Nothing has been recorded at this location."
                />
              ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Hour</th>
                      {byHour.events.map((e) => (
                        <th key={e.eventId} className="right nowrap">
                          {e.year > 0 ? e.year : e.name}
                        </th>
                      ))}
                      <th className="right">Latest change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byHour.rows.map((row) => (
                      <tr key={`${row.day}-${row.hour}`}>
                        <td className="small nowrap">
                          {DAY_LABEL[row.day]} {formatTime(row.hour * 60)}
                        </td>
                        {row.cells.map((c) => (
                          <td key={c.eventId} className="right small">
                            {c.ran ? <Money value={c.revenue} /> : <span className="muted">·</span>}
                          </td>
                        ))}
                        <td className="right small">
                          <Change value={row.changes.revenue} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="card">
        <h2>This event</h2>
        {shifts.length === 0 ? (
          <p className="muted">Nobody is on the board here.</p>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              {runs.length} shift{runs.length === 1 ? '' : 's'}, {worked} checked in.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => {
                    const { assignment, slot, person } = run.items[0]!.row
                    const state = runState(run.items.map((i) => i.row.assignment))
                    return (
                      <tr key={assignment.id}>
                        <td className="small nowrap">
                          {slot
                            ? `${DAY_SHORT[slot.day]} ${runSpan(run, slot.label)}`
                            : assignment.slotId}
                        </td>
                        <td>
                          <PersonLink person={person} personId={assignment.personId} />{' '}
                          {person && <SectionPill section={person.section} />}
                        </td>
                        {/*
                          One word for the stretch. Before the arrival there is nothing to
                          aggregate, so it keeps saying what the booking says.
                        */}
                        <td className="small muted">
                          {state.attendance === 'arrived'
                            ? 'checked in'
                            : state.attendance === 'absent'
                              ? 'no-show'
                              : assignment.status}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {theirJars.length > 0 && (
        <div className="card">
          <h2>Jars counted here</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Jar</th>
                  <th>When</th>
                  <th>Who</th>
                  <th className="right">Amount</th>
                  <th>Method</th>
                </tr>
              </thead>
              <tbody>
                {theirJars.map(({ jar, when, holder }) => (
                  <tr key={jar.id}>
                    <td className="small">
                      {jar.jarNumber === null ? (
                        <span className="muted">no jar</span>
                      ) : (
                        `Jar ${jar.jarNumber}`
                      )}
                      {/*
                        The note belongs with the row, not only on the Jars screen.

                        For money that never went through a jar it is the only thing saying
                        what it was — bushel sales, a donation at the door — so without it
                        this table has rows reading "no jar · $40" and no way to tell one
                        from another.
                      */}
                      {jar.note && <div className="muted">{jar.note}</div>}
                    </td>
                    <td className="small muted nowrap">{when}</td>
                    {/*
                      Who carried it. A row of takings with no name on it is the one thing
                      nobody can follow up: a jar $40 light needs the person who had it, and
                      the answer was already on the jar. Blank for money recorded by hand,
                      which belonged to the table rather than to anybody.
                    */}
                    <td className="small">
                      {jar.personId ? (
                        <>
                          <PersonLink person={holder} personId={jar.personId} />{' '}
                          {holder && <SectionPill section={holder.section} />}
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="right">
                      {isCounted(jar) ? (
                        <Money value={jar.amount} />
                      ) : (
                        <span className="muted small">still out</span>
                      )}
                    </td>
                    <td className="small muted">{jar.method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

    </>
  )
}
