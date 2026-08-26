import { useMemo } from 'react'
import { useUrlState } from '../lib/urlState'
import type { CSSProperties, ReactNode } from 'react'
import { eventLabel } from '../domain/events'
import {
  ALL_EVENTS,
  changeFrom,
  eventLabels,
  hourlyTrends,
  hourlyTrendsSplit,
  locationTrends,
  lookbackIds,
  previousEvent,
  stackBands,
  stackTotals,
} from '../domain/history'
import { matchesTerms, searchTerms } from '../domain/search'
import type { TrendMeasure } from '../domain/history'
import type { EventTotals } from '../domain/history'
import { useEvent } from '../lib/eventContext'
import { useEventHistory, useLocationLibrary } from '../lib/repo'
import { DAY_SHORT, formatTime } from '../domain/slots'
import { Change, ErrorNote, Hours, Loading, Money } from './Bits'
import { GroupedBars } from './GroupedBars'
import { LocationLink } from './LocationLink'
import { LocationsField } from './LocationsField'

/**
 * Year over year.
 *
 * Last year's results are the evidence for this year's choices — the reason the app holds
 * several events rather than one — and until now nothing put them side by side. The workbook
 * could not do it either: it changed its model every year, and grouped locations by a
 * display string, so the same shop appeared as three different places.
 *
 * That problem does not exist here. The location library is global and its ids are stable,
 * so a location keeps its identity across years with no name matching at all.
 */

const MEASURES: { id: TrendMeasure; label: string; blurb: string }[] = [
  {
    id: 'revenue',
    label: 'Revenue',
    blurb: 'What each location brought in.',
  },
  {
    id: 'perHour',
    label: 'Per hour',
    blurb:
      'What an hour of somebody’s evening was worth there. The one to plan by: takings ' +
      'up by half is not a win if the hours behind them doubled.',
  },
]

/** Currency as text, for axis ticks and readouts inside the chart. */
const money = (n: number): string =>
  n >= 1000 ? `$${Math.round(n / 100) / 10}k` : `$${Math.round(n * 100) / 100}`

/** Bars, one per event. No running total: years do not accumulate into each other. */
function YearBars({
  events,
  labelFor,
}: {
  events: EventTotals[]
  labelFor: (e: EventTotals) => string
}): ReactNode {
  const peak = Math.max(1, ...events.map((e) => e.revenue))
  return (
    <div className="year-bars">
      {events.map((e) => (
        <div className="year-bar" key={e.eventId}>
          <div className="year-bar-value">
            <Money value={e.revenue} />
          </div>
          <div
            className="year-bar-fill"
            style={{ height: `${Math.max(2, (e.revenue / peak) * 100)}%` }}
            title={`${e.name}: ${e.revenue.toFixed(2)}`}
          />
          <div className="year-bar-label small">{labelFor(e)}</div>
        </div>
      ))}
    </div>
  )
}

export function HistoryScreen(): ReactNode {
  const library = useLocationLibrary()
  const { events: allYears, eventId } = useEvent()
  /*
    What this year is being held against.

    Every event at once was the wrong default. The question asked here is almost always "how
    are we doing against last year", and four extra series answer it worse than none — the
    table got wider every year and the chart harder to read. Empty means the event before
    this one; `all` is the old behaviour, still one click away.
  */
  const [against, setAgainst] = useUrlState('vs')

  /*
    Every event, for the chooser — narrowing is what the chooser is for.

    Built from the event list rather than from the loaded history, which is what lets the
    history itself be narrow: a chooser that had to be filled from the fetched years could
    only ever offer the years already fetched, so every year had to be fetched to offer any.
  */
  const allEvents = useMemo(
    () =>
      [...allYears]
        .map((e) => ({ eventId: e.id, name: e.name, year: e.year }))
        .sort((a, b) => b.year - a.year || a.name.localeCompare(b.name)),
    [allYears],
  )
  const allLabels = useMemo(() => eventLabels(allEvents), [allEvents])

  /*
    Which years to read, decided before anything is read.

    Two of them, normally: this one and the one before. `every year` is still a click away
    and still reads every year — the difference is that it now only does so when asked.
  */
  const wanted = useMemo(
    () => lookbackIds(allYears, eventId, against || null),
    [allYears, eventId, against],
  )
  const history = useEventHistory(wanted)
  // Already exactly the years asked for, already oldest first.
  const shownHistory = history.data

  /** Named in the chooser, so "last time" says which year that was. */
  const previousLabel = useMemo(() => {
    const before = previousEvent(allYears, eventId)
    return before ? ((allLabels.get(before.id) ?? eventLabel(before))) : ''
  }, [allYears, eventId, allLabels])
  /*
    One location, or all of them added together.

    Summing every combination answers "what is the shape of the evening across these six
    doors", which is not the question anybody asks. The question is "what does five o'clock
    at Braemar do, year on year", and a sum of six locations cannot be read that way.

    So several may be picked and they are kept apart — one set of bars per door, per year.
    Nothing picked still means every location added together, which is the shape of the
    whole evening and what this page opens on.
  */
  const [pickedParam, setPickedLocations] = useUrlState('at')
  /*
    In the address bar as a list, so a comparison can be sent to somebody.

    Filtered against the library on the way in: an id for a location that has since been
    removed would otherwise be a column of nothing with no name at its head.
  */
  const picked = useMemo(
    () => pickedParam.split(',').filter(Boolean),
    [pickedParam],
  )
  const setPicked = (ids: string[]): void => setPickedLocations(ids.join(','))

  const [measureParam, setMeasure] = useUrlState('measure', 'revenue')
  const measure = measureParam as TrendMeasure
  const [locationSearch, setLocationSearch] = useUrlState('find')

  const names = useMemo(
    () => new Map(library.data.map((l) => [l.id, l.name])),
    [library.data],
  )
  const { events, rows } = useMemo(
    () => locationTrends(shownHistory, names),
    [shownHistory, names],
  )

  /** Two events in one year would otherwise both read "2026", in the chart and the tables. */
  const labels = useMemo(() => eventLabels(events), [events])
  const labelFor = (e: EventTotals): string => (labels.get(e.eventId) ?? eventLabel({ id: e.eventId, name: e.name }))

  /*
    The rows a search is asking for.

    Twenty-one locations over four years is a wide table and a long one, and "how has Braemar
    done" was a question that could only be answered by reading down it. Same search as
    everywhere else: every word has to appear somewhere in the row.

    Only the table narrows. The chooser below it keeps every location, because picking which
    doors to compare is a different question from finding one.
  */
  const shownRows = useMemo(() => {
    const terms = searchTerms(locationSearch)
    return rows.filter((r) => matchesTerms(terms, [r.name]))
  }, [rows, locationSearch])

  /** Every location that has ever earned or been staffed, in the same order as the table. */
  const locationChoices = useMemo(
    () => rows.map((r) => ({ id: r.locationId, name: r.name })),
    [rows],
  )
  /** Only the ones the library still knows about, in the order the table lists them. */
  const live = useMemo(
    () => picked.filter((id) => locationChoices.some((c) => c.id === id)),
    [picked, locationChoices],
  )

  /*
    Two shapes, and which one is drawn follows what has been picked rather than a switch.

    Nothing or one location is a question about years — this hour here, against the same
    hour last year — which is the chart that was already here. Two or more is a question
    about doors, and answering it needs them apart, each still carrying its years.
  */
  const compare = live.length > 1 ? 'locations' : 'years'

  const byHour = useMemo(
    () => hourlyTrends(shownHistory, live.length === 1 ? live : null),
    [shownHistory, live],
  )
  const byLocation = useMemo(
    () => (compare === 'locations' ? hourlyTrendsSplit(shownHistory, live) : null),
    [compare, shownHistory, live],
  )

  const pickedName =
    live.length === 1 ? (locationChoices.find((c) => c.id === live[0])?.name ?? '') : ''


  /** Whether to caption each hour with its day. One day needs no caption. */
  const eventDaysShown = useMemo(
    () => new Set(byHour.rows.map((r) => r.day)).size,
    [byHour.rows],
  )
  const splitDaysShown = useMemo(
    () => new Set((byLocation?.rows ?? []).map((r) => r.day)).size,
    [byLocation],
  )

  if (history.loading) return <Loading what="Adding up every year" />

  return (
    <>
      <ErrorNote error={history.error ?? library.error} />

      {events.length === 0 && (
        <div className="card">
          <p className="muted">No events with any results yet.</p>
        </div>
      )}

      {events.length === 1 && (
        <div className="note info">
          <strong>Only one event so far</strong>
          <div className="small">
            There is nothing to compare it against yet. Next year this screen is the one that
            says whether a location is worth keeping.
          </div>
        </div>
      )}

      {events.length > 0 && (
        <>
          <div className="card">
            <div className="row between">
              <h1 style={{ margin: 0 }}>Year over year</h1>
              {/*
                Sits with the chart it governs, because it changes every table below it too.
                Only shown when there is a choice to make: one event has nothing to compare.
              */}
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
                      .filter((e) => e.eventId !== eventId)
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
            <YearBars events={events} labelFor={labelFor} />
          </div>

          <div className="card">
            <h2>Every event</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th className="right">Revenue</th>
                    <th className="right">vs before</th>
                    <th className="right">Hours</th>
                    <th className="right">Per hour</th>
                    <th className="right">vs before</th>
                    <th className="right">Volunteers</th>
                    <th className="right">Locations</th>
                  </tr>
                </thead>
                <tbody>
                  {/*
                    Newest first, but "vs before" still means the year before it.

                    Each row is compared with the one that came earlier, which the list
                    gives by position. Reversing first would silently make "before" the year
                    *after* — every change on the table flipped, and nothing on screen to say
                    so. So the pairing is worked out while the order still means what it
                    says, and only then turned round.
                  */}
                  {events
                    .map((e, i) => ({ e, before: i > 0 ? events[i - 1]! : null }))
                    .reverse()
                    .map(({ e, before }) => {
                    return (
                      <tr key={e.eventId}>
                        <td>
                          <div>{e.name}</div>
                          {e.startedAt && (
                            <div className="small muted">{e.startedAt}</div>
                          )}
                        </td>
                        <td className="right">
                          <Money value={e.revenue} />
                        </td>
                        <td className="right small">
                          <Change value={changeFrom(before?.revenue ?? null, e.revenue)} />
                        </td>
                        <td className="right">
                          <Hours value={e.staffedHours} />
                        </td>
                        <td className="right">
                          <strong>
                            <Money value={e.revenuePerHour} />
                          </strong>
                        </td>
                        <td className="right small">
                          <Change
                            value={changeFrom(
                              before?.revenuePerHour ?? null,
                              e.revenuePerHour,
                            )}
                          />
                        </td>
                        <td className="right">{e.volunteers}</td>
                        <td className="right">{e.earningLocations}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="small muted">
              Hours are hours somebody worked, as on the money screen — a shift nobody turned
              up for did not staff an hour. A blank rate means no recorded hours to divide by,
              which is what a year imported from the workbook looks like.
            </p>
          </div>

          <div className="card">
            <h2>Locations, year by year</h2>
            <div className="row" style={{ margin: '0.2rem 0 0.5rem' }}>
              {MEASURES.map((m) => (
                <button
                  key={m.id}
                  className={measure === m.id ? 'primary' : ''}
                  onClick={() => setMeasure(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>
              {MEASURES.find((m) => m.id === measure)!.blurb} One row per location, however
              its name was written down — the library is shared and its ids are stable. An
              empty cell is a year that location was not used, which is different from a year
              it earned nothing.
            </p>
            <div className="row" style={{ margin: '0 0 0.5rem' }}>
              <input
                style={{ flex: '1 1 12rem', maxWidth: '18rem' }}
                placeholder="Find a location…"
                aria-label="Find a location"
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
              />
            </div>

            <div className="table-wrap">
              {/* Every column after the frozen name: one per year, plus Latest change. */}
              <table
                className="grid-table"
                style={{ '--cols': events.length + 1 } as CSSProperties}
              >
                <thead>
                  <tr>
                    <th className="sticky-name">Location</th>
                    {events.map((e) => (
                      <th key={e.eventId} className="right nowrap">
                        {labelFor(e)}
                      </th>
                    ))}
                    <th className="right">Latest change</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.map((row) => (
                    <tr key={row.locationId}>
                      <td className="sticky-name small">
                        <LocationLink name={row.name} locationId={row.locationId} />
                      </td>
                      {row.cells.map((c) => (
                        <td
                          key={c.eventId}
                          className={`hour-cell small${
                            c.revenue === 0 && c.staffedHours === 0 ? ' hour-quiet' : ''
                          }`}
                          title={
                            c.staffedHours > 0
                              ? `${c.staffedHours} person-hours · ${
                                  c.revenuePerHour === null ? 'no rate' : `$${c.revenuePerHour}/hr`
                                }`
                              : 'not used that year'
                          }
                        >
                          {c.revenue === 0 && c.staffedHours === 0 ? (
                            '·'
                          ) : measure === 'perHour' ? (
                            <Money value={c.revenuePerHour} />
                          ) : (
                            <Money value={c.revenue} />
                          )}
                        </td>
                      ))}
                      <td className="right small">
                        <Change value={row.changes[measure]} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <h2>
              {compare === 'locations'
                ? `${live.length} locations, hour by hour`
                : pickedName
                  ? `${pickedName}, hour by hour`
                  : 'Hour by hour'}
            </h2>
            <p className="small muted" style={{ marginTop: 0 }}>
              What a given hour at a given door is worth, and whether that is changing —
              five o&apos;clock at one shop against five o&apos;clock there last year. Pick
              several and they sit beside each other, each still carrying its years. Leave it
              alone for the shape of the whole evening.
            </p>

            {/*
              Any number of them. One is the hours at that door, year on year; several puts
              those doors beside each other, each still carrying its years. None is every
              door added together — the shape of the whole evening, and where this starts.
            */}
            <div style={{ maxWidth: '24rem' }}>
              <LocationsField
                label="Locations"
                locations={library.data}
                value={picked}
                onChange={setPicked}
              />
            </div>

            <p className="small muted">
              Grouped by the clock rather than by shift, because a year that ran hourly
              shifts and one that overlapped them every 45 minutes do not share a single slot
              — a shift straddling two hours is divided between them by the minutes it spends
              in each. Money recorded by hand against a location has no shift behind it, so
              it belongs to no hour and is not counted.
            </p>

            {/* A cell a door was shut for is null, not zero — no bar rather than a flat
                one, because "not open" and "earned nothing" are different answers. */}
            {byLocation ? (
              /*
                One bar per year, each divided into a band per shop.

                Stacked by location and grouped by year, rather than the other way round,
                because only one of those adds up: the shops are parts of what an hour took,
                and two years are alternatives. A stack of 2025 on 2026 would be a total
                nothing ever earned.
              */
              <GroupedBars
                groups={byLocation.rows.map((row) => ({
                  label: formatTime(row.hour * 60),
                  ...(splitDaysShown > 1 ? { sub: DAY_SHORT[row.day] } : {}),
                  values: stackTotals(row, byLocation.series, events, measure),
                  stacks: stackBands(row, byLocation.series, events, measure),
                }))}
                series={events.map((e) => ({ id: e.eventId, label: labelFor(e) }))}
                bands={live.map((id) => ({ id, label: names.get(id) ?? id }))}
                format={(v) => money(v)}
                emptyNote="Nothing has been recorded at these locations."
              />
            ) : (
              <GroupedBars
                groups={byHour.rows.map((row) => ({
                  label: formatTime(row.hour * 60),
                  ...(eventDaysShown > 1 ? { sub: DAY_SHORT[row.day] } : {}),
                  values: row.cells.map((c) =>
                    !c.ran ? null : measure === 'perHour' ? c.revenuePerHour : c.revenue,
                  ),
                }))}
                series={events.map((e) => ({ id: e.eventId, label: labelFor(e) }))}
                format={(v) => money(v)}
                emptyNote="Nothing has been recorded at this location."
              />
            )}

            {byLocation && byLocation.rows.length > 0 && (
              <details style={{ marginTop: '0.6rem' }}>
                <summary className="small muted">The same figures as a table</summary>
                <div className="table-wrap" style={{ marginTop: '0.4rem' }}>
                  <table
                    className="grid-table"
                    style={{ '--cols': byLocation.series.length + 1 } as CSSProperties}
                  >
                    <thead>
                      <tr>
                        <th className="sticky-name">Hour</th>
                        {/*
                          Two lines, and wrapping.

                          A column here is a shop and a year — "Ashfield Farmers market
                          Loc.1 · Apple Day 2026" — against a column sized for "10:00 AM –
                          11:00 AM". On one unwrapped line it simply ran under its neighbour
                          and was lost. Stacked, the name has the width to itself and the
                          year sits under it.
                        */}
                        {byLocation.series.map((series) => (
                          <th key={series.key} className="right col-two-line">
                            <span>{names.get(series.locationId) ?? series.locationId}</span>
                            <span className="small muted">
                              {labels.get(series.eventId) ?? series.eventId}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {byLocation.rows.map((row) => (
                        <tr key={`${row.day}-${row.hour}`}>
                          <td className="sticky-name small nowrap">{row.label}</td>
                          {row.cells.map((c, i) => (
                            <td
                              key={byLocation.series[i]!.key}
                              className={`hour-cell small${c.ran ? '' : ' hour-quiet'}`}
                            >
                              {/* A door that was shut, rather than one that took nothing. */}
                              {!c.ran ? (
                                '·'
                              ) : measure === 'perHour' ? (
                                <Money value={c.revenuePerHour} />
                              ) : (
                                <Money value={c.revenue} />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            {!byLocation && byHour.rows.length > 0 && (
              <details style={{ marginTop: '0.6rem' }}>
                <summary className="small muted">The same figures as a table</summary>
                <div className="table-wrap" style={{ marginTop: '0.4rem' }}>
                  <table
                    className="grid-table"
                    style={{ '--cols': events.length + 1 } as CSSProperties}
                  >
                    <thead>
                      <tr>
                        <th className="sticky-name">Hour</th>
                        {events.map((e) => (
                          <th key={e.eventId} className="right nowrap">
                            {labelFor(e)}
                          </th>
                        ))}
                        <th className="right">Latest change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {byHour.rows.map((row) => (
                        <tr key={`${row.day}-${row.hour}`}>
                          <td className="sticky-name small nowrap">{row.label}</td>
                          {row.cells.map((c) => (
                            <td
                              key={c.eventId}
                              className={`hour-cell small${c.ran ? '' : ' hour-quiet'}`}
                            >
                              {!c.ran ? (
                                '·'
                              ) : measure === 'perHour' ? (
                                <Money value={c.revenuePerHour} />
                              ) : (
                                <Money value={c.revenue} />
                              )}
                            </td>
                          ))}
                          <td className="right small">
                            <Change value={row.changes[measure]} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </div>

        </>
      )}
    </>
  )
}
