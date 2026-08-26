import { useMemo, useState } from 'react'
import { useUrlState } from '../lib/urlState'
import type { CSSProperties, ReactNode } from 'react'
import {
  locationHourGrid,
  locationMetrics,
  personTotals,
  revenueBySlot,
  sectionParticipation,
  workedShifts,
} from '../domain/metrics'
import type { HoursBasis } from '../domain/metrics'
import { findOrphanedRecords } from '../domain/orphans'
import type { OrphanIssue, OrphanRepair } from '../domain/orphans'
import { DAY_LABEL, formatTime } from '../domain/slots'
import { DAYS, fullName } from '../domain/types'
import type { Day } from '../domain/types'
import { matchesTerms, searchTerms } from '../domain/search'
import { toCsv, downloadFile } from '../lib/csv'
import { useEvent } from '../lib/eventContext'
import { useSections } from '../lib/sections'
import {
  relocateJar,
  repairAssignment,
  unassign,
  useAssignments,
  useJars,
  useLocationLibrary,
  useLocations,
  usePeople,
} from '../lib/repo'
import { deleteJar } from '../lib/repo'
import { ErrorNote, Hours, Loading, Money, SectionPill, Stat } from './Bits'
import { LocationLink } from './LocationLink'
import { PersonLink } from './PersonLink'
import { HourChart } from './HourChart'
import { LocationField } from './PickerField'
import { Modal } from './Modal'

type Scope = 'all' | Day

type View = 'locations' | 'hours' | 'people'

/**
 * What this screen shows, one question at a time.
 *
 * It grew to four tables, three warnings and a headline on one page, which meant the thing
 * somebody had come to look at was always below something else. The headline and the
 * warnings stay put — those are what you need whether you asked for them or not — and the
 * detail is behind a choice.
 */
const VIEWS: { id: View; label: string; blurb: string }[] = [
  {
    id: 'locations',
    label: 'Locations',
    blurb: 'Where the money came from, ranked by what an hour there was worth.',
  },
  {
    id: 'hours',
    label: 'Hours',
    blurb: 'When the money came in, and which location was earning it at the time.',
  },
  {
    id: 'people',
    label: 'People',
    blurb: 'Who was out, by section and by youth.',
  },
]

/** A grid cell: quiet when nothing came in, highlighted when it was the location's best. */
const cellClass = (
  cell: { revenue: number; slotId: string },
  bestSlotId: string | null,
): string =>
  `hour-cell small${cell.revenue === 0 ? ' hour-quiet' : ''}${
    bestSlotId === cell.slotId ? ' hour-best' : ''
  }`

/**
 * Where the money came from, per staffed hour.
 *
 * This screen is the reason the rest of the app exists. The spreadsheet's version of it
 * was wrong in three compounding ways: it split six locations into twelve rows by
 * grouping on a display string, it divided by filled cells instead of people, and when a
 * location had no recorded hours it quietly reported the raw total as an hourly rate —
 * which put a staff-room jar with nobody rostered in 4th place.
 *
 * So the anomalies get their own section here rather than being ranked alongside real
 * results.
 */
export function MoneyScreen(): ReactNode {
  const { event, slots: allSlots } = useEvent()
  const { sections: sectionDefs } = useSections()
  const eventDays = useMemo(
    () => DAYS.filter((d) => allSlots.some((s) => s.day === d)),
    [allSlots],
  )
  const locations = useLocations()
  // The whole library, for judging whether a reference still exists at all.
  const library = useLocationLibrary()
  const people = usePeople()
  const assignments = useAssignments()
  const jars = useJars()
  const [scopeParam, setScope] = useUrlState('scope', 'all')
  /**
   * Whether hours mean "somebody turned up" or "the board said so".
   *
   * Worked is the default because that is what revenue per hour is supposed to divide by.
   * Scheduled stays reachable for a year imported from the workbook, where no check-ins
   * were ever recorded and worked hours are therefore zero everywhere.
   */
  const [basisParam, setBasis] = useUrlState('hours', 'worked')
  const [viewParam, setView] = useUrlState('view', 'locations')

  /*
    Which tab, which scope, which lookup — all in the address bar, so a figure can be sent
    to somebody as the screen that shows it rather than as a description of where to click.
  */
  const scope = scopeParam as Scope
  const basis = basisParam as HoursBasis
  const view = viewParam as View
  const [locationSearch, setLocationSearch] = useUrlState('find')
  const [personSearch, setPersonSearch] = useUrlState('who')
  const [section, setSection] = useUrlState('section', 'all')
  const [confirmDelete, setConfirmDelete] = useState<OrphanIssue | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)

  const scoped = useMemo(() => {
    const inScope =
      scope === 'all'
        ? { assignments: assignments.data, jars: jars.data, slots: allSlots }
        : {
            assignments: assignments.data.filter((a) => a.slotId.startsWith(`${scope}-`)),
            jars: jars.data.filter((j) => j.day === scope),
            slots: allSlots.filter((s) => s.day === scope),
          }
    // Filtered once, here, so the location table, the section breakdown and the per-person
    // list cannot end up counting different shifts and disagreeing with each other.
    return { ...inScope, counted: workedShifts(inScope.assignments, basis) }
  }, [scope, basis, assignments.data, jars.data, allSlots])

  const report = useMemo(
    () => locationMetrics(locations.data, scoped.counted, scoped.jars, scoped.slots),
    [locations.data, scoped],
  )

  const byHour = useMemo(
    () => revenueBySlot(scoped.counted, scoped.jars, scoped.slots),
    [scoped],
  )

  const grid = useMemo(
    () => locationHourGrid(locations.data, scoped.counted, scoped.jars, scoped.slots),
    [locations.data, scoped],
  )

  /*
    The grid narrowed to the same search as the table above it.

    One box for the whole screen rather than one per table: it is the same question — which
    location am I looking at — and two boxes that filter different tables by the same word
    is a way to be told two different things at once.
  */
  const shownGridRows = useMemo(() => {
    const terms = searchTerms(locationSearch)
    return grid.rows.filter((row) => matchesTerms(terms, [row.name]))
  }, [grid.rows, locationSearch])

  const chartPoints = useMemo(
    () =>
      byHour.rows.map((r) => ({
        label: r.label,
        // Just the start time on the axis; the full range is in the hover readout.
        axisLabel: formatTime(r.startMin).replace(':00', ''),
        // Only when both days are in view, or the caption says nothing.
        ...(scope === 'all' ? { dayLabel: DAY_LABEL[r.day] } : {}),
        revenue: r.revenue,
      })),
    [byHour.rows, scope],
  )

  const sections = useMemo(
    () => sectionParticipation(people.data, scoped.counted, scoped.slots, sectionDefs),
    [people.data, scoped, sectionDefs],
  )

  const perPerson = useMemo(
    () => personTotals(scoped.counted, scoped.jars, scoped.slots),
    [scoped],
  )

  /**
   * Every location that saw money or hours, ranked ones first.
   *
   * The table used to render only the ranked rows, so a location with money but no staffed
   * hours appeared in the warning above and nowhere else — its total was inside the figure
   * at the top of the screen but missing from the list that is supposed to explain it.
   * Unrankable rows now sit at the end with no rate rather than being dropped.
   */
  const allTableRows = useMemo(
    () => [...report.ranked, ...report.revenueWithoutHours],
    [report],
  )

  /*
    Looking one up, rather than reading down twenty-one of them.

    "Which of these did Sobeys take?" was a question this screen could only answer by
    scrolling, and the ranking means a location is never where you last saw it. Same search
    everywhere: every word has to appear somewhere in the row.
  */
  const tableRows = useMemo(() => {
    const terms = searchTerms(locationSearch)
    return allTableRows.filter((r) => matchesTerms(terms, [r.name]))
  }, [allTableRows, locationSearch])

  const orphans = useMemo(
    () =>
      // Deliberately every scheduled shift, not just the worked ones: money at a location
      // somebody was rostered to is not orphaned money just because nobody checked them in.
      // Locations come from the library rather than this year's list — a location dropped
      // from the year still exists, and calling that missing would raise a false alarm.
      findOrphanedRecords(
        { locations: library.data, people: people.data, slots: scoped.slots },
        scoped.assignments,
        scoped.jars,
      ),
    [library.data, people.data, scoped],
  )

  const personById = useMemo(
    () => new Map(people.data.map((p) => [p.id, p])),
    [people.data],
  )

  /** Youth, filtered by name and by section — the two ways somebody is looked up. */
  const shownPeople = useMemo(() => {
    const terms = searchTerms(personSearch)
    return perPerson.filter((row) => {
      const person = personById.get(row.personId)
      if (section !== 'all' && person?.section !== section) return false
      return matchesTerms(terms, [person ? fullName(person) : row.personId])
    })
  }, [perPerson, personSearch, section, personById])


  const fixIt = (id: string, fields: OrphanRepair): void => {
    if (!event) return
    setRepairError(null)
    void repairAssignment(event.id, id, fields).catch((error: Error) =>
      setRepairError(`Could not repair ${id}: ${error.message}`),
    )
  }

  const moveJar = (id: string, locationId: string): void => {
    if (!event) return
    setRepairError(null)
    void relocateJar(event.id, id, locationId).catch((error: Error) =>
      setRepairError(`Could not move ${id}: ${error.message}`),
    )
  }

  const reallyDelete = (): void => {
    const target = confirmDelete
    if (!event || !target) return
    setRepairError(null)
    setConfirmDelete(null)
    /*
      The jar itself, not just its id: deleting it writes a line saying what it held, and
      "deleted jar 12, which held $180" is the one somebody comes looking for.
    */
    const orphan = jars.data.find((j) => j.id === target.id)
    const removing =
      target.kind === 'assignment'
        ? unassign(event.id, target.id)
        : orphan
          ? deleteJar(event.id, orphan)
          : Promise.reject(new Error('That jar is no longer here.'))
    void removing.catch((error: Error) =>
      setRepairError(`Could not delete ${target.id}: ${error.message}`),
    )
  }

  const exportGridCsv = (): void => {
    downloadFile(
      `apple-day-location-by-hour-${scope}.csv`,
      toCsv(
        grid.rows.map((row) => ({
          Location: row.name,
          ...Object.fromEntries(
            grid.slots.map((slot, i) => [
              `${DAY_LABEL[slot.day]} ${slot.label}`,
              row.cells[i]!.revenue.toFixed(2),
            ]),
          ),
          Total: row.revenue.toFixed(2),
          'Staffed hours': String(row.staffedHours),
          'Best hour':
            grid.slots.find((s) => s.id === row.bestSlotId)?.label ?? '',
        })),
      ),
    )
  }

  const exportCsv = (): void => {
    downloadFile(
      `apple-day-locations-${scope}.csv`,
      toCsv(
        tableRows.map((r) => ({
          Rank: String(r.rank ?? ''),
          Location: r.name,
          Revenue: r.revenue.toFixed(2),
          'Staffed hours': String(r.staffedHours),
          'Revenue per hour': r.revenuePerHour === null ? '' : r.revenuePerHour.toFixed(2),
          Jars: String(r.jarCount),
        })),
      ),
    )
  }

  if (locations.loading || jars.loading) return <Loading what="Adding up" />

  return (
    <>
      <ErrorNote error={jars.error ?? locations.error ?? assignments.error} />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            {(['all', ...eventDays] as Scope[]).map((s) => (
              <button key={s} className={scope === s ? 'primary' : ''} onClick={() => setScope(s)}>
                {s === 'all' ? 'Both days' : DAY_LABEL[s]}
              </button>
            ))}
            <span className="muted small" style={{ marginLeft: '0.5rem' }}>
              Hours
            </span>
            <button
              className={basis === 'worked' ? 'primary' : ''}
              title="Only shifts somebody turned up for"
              onClick={() => setBasis('worked')}
            >
              Worked
            </button>
            <button
              className={basis === 'scheduled' ? 'primary' : ''}
              title="Every shift on the board, whether or not anybody came"
              onClick={() => setBasis('scheduled')}
            >
              Scheduled
            </button>
          </div>
          <div className="stats">
            <Stat label="revenue" value={<Money value={report.totalRevenue} />} />
            <Stat label="staffed hours" value={<Hours value={report.totalStaffedHours} />} />
            {/* Two rates, because they answer different questions. Per hour is what an
                hour of Apple Day is worth however many people it took — the one to watch
                on the night. Per person-hour is whether an individual's time was well
                spent, which is what the location ranking divides by. */}
            <Stat
              label="per hour"
              value={<Money value={byHour.revenuePerClockHour} />}
            />
            <Stat
              label="per person-hour"
              value={
                <Money
                  value={
                    report.totalStaffedHours > 0
                      ? Math.round((report.totalRevenue / report.totalStaffedHours) * 100) / 100
                      : null
                  }
                />
              }
            />
          </div>
        </div>
      </div>

      {basis === 'worked' &&
        scoped.counted.length === 0 &&
        scoped.assignments.length > 0 && (
          <div className="note info">
            <strong>No shift here has anybody checked in against it</strong>
            <div className="small">
              So worked hours are zero and there is no rate to rank by. That is expected for
              a year imported from the workbook, where check-ins were never recorded — switch
              Hours to <strong>Scheduled</strong> to divide by the board instead.
            </div>
          </div>
        )}

      {(() => {
        const stillOut = scoped.jars.filter((j) => j.status === 'out').length
        return stillOut > 0 ? (
          <div className="note warning">
            <strong>
              {stillOut} jar{stillOut === 1 ? '' : 's'} still out
            </strong>
            <div className="small">
              These have no amount yet, so every figure here is provisional until they are
              counted in.
            </div>
          </div>
        ) : null
      })()}

      {report.revenueWithoutHours.length > 0 && (
        <div className="note warning">
          <strong>
            Revenue with no staffed hours — {report.revenueWithoutHours.length}{' '}
            location{report.revenueWithoutHours.length === 1 ? '' : 's'}
          </strong>
          <div className="small">
            Either the schedule was never filled in, or a jar is attributed to the wrong
            location. These are excluded from the ranking rather than given an hourly rate.
          </div>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
            {report.revenueWithoutHours.map((r) => (
              <li key={r.locationId}>
                {r.name} — <Money value={r.revenue} /> across {r.jarCount} jar
                {r.jarCount === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {orphans.length > 0 && (
        <div className="note error">
          <strong>
            {orphans.length} record{orphans.length === 1 ? ' points' : 's point'} at
            something that no longer exists
          </strong>
          <div className="small">
            Usually a youth who was deleted after being put on the schedule. Each one says
            what it was for, so it can be put right or thrown away — a shift is how a
            location's staffed hours are counted, so deleting one changes its revenue per
            hour.
          </div>
          <ul className="issue-list">
            {orphans.map((o) => (
              <li key={`${o.kind}-${o.id}`}>
                <div>
                  <strong className="small">{o.problem}</strong>
                  <div className="small">
                    {o.references.map((r, i) => (
                      <span key={r.label}>
                        {i > 0 && ' · '}
                        {r.label}:{' '}
                        <span
                          className={r.exists ? '' : 'mono'}
                          style={r.exists ? undefined : { color: 'var(--bad)' }}
                        >
                          {r.display}
                        </span>
                      </span>
                    ))}
                  </div>
                  {o.blocked && <div className="small muted">{o.blocked}</div>}
                </div>
                <div className="row" style={{ gap: '0.25rem' }}>
                  {o.kind === 'jar' && (
                    <div style={{ minWidth: '11rem' }}>
                      <LocationField
                        label={`Location for ${o.id}`}
                        empty="Move to…"
                        locations={library.data}
                        value=""
                        onChange={(locationId) => void moveJar(o.id, locationId)}
                      />
                    </div>
                  )}
                  {o.repair && (
                    <button
                      className="tiny primary"
                      title="Put the missing details back from the record's own name"
                      onClick={() => void fixIt(o.id, o.repair!)}
                    >
                      Fix
                    </button>
                  )}
                  <button
                    className="tiny danger"
                    onClick={() => setConfirmDelete(o)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {repairError && (
            <p className="small" style={{ color: 'var(--bad)' }}>
              {repairError}
            </p>
          )}
        </div>
      )}

      {confirmDelete && (
        <Modal
          title="Delete this record?"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="danger" onClick={() => void reallyDelete()}>
                Delete
              </button>
            </>
          }
        >
          <p>{confirmDelete.problem}</p>
          <p className="small mono muted">{confirmDelete.id}</p>
          {confirmDelete.kind === 'assignment' ? (
            <p className="small">
              This is an hour of staffing at a location. Deleting it raises that location's
              revenue per hour, because the same money will be divided by less time.
            </p>
          ) : (
            <p className="small">
              This is a jar. If it holds money that was really collected, deleting it removes
              that money from every total on this screen.
            </p>
          )}
        </Modal>
      )}

      <div className="card">
        <div className="row" role="tablist" aria-label="What to show">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              className={view === v.id ? 'primary' : ''}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="small muted" style={{ margin: '0.4rem 0 0' }}>
          {VIEWS.find((v) => v.id === view)!.blurb}
        </p>
      </div>

      {view === 'locations' && (
        <>
      <div className="card">
        {/*
          Export belongs with the heading, not with the search.

          All three were in one row and the button wrapped underneath, which read as though
          it belonged to the search box — as if it exported what had been found. It exports
          the table. Beside the title it is what it is: something you do to this card.
        */}
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>By location</h2>
          <button className="tiny" onClick={exportCsv}>
            Export CSV
          </button>
        </div>
        {/* The ranking means a location is never where you last saw it, so finding one by
            reading down the table is the wrong instrument. */}
        <input
          style={{ width: '100%', maxWidth: '20rem', marginBottom: '0.5rem' }}
          placeholder="Find a location…"
          aria-label="Find a location"
          value={locationSearch}
          onChange={(e) => setLocationSearch(e.target.value)}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Location</th>
                <th className="right">Revenue</th>
                <th className="right">Staffed hours</th>
                <th className="right">Per hour</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((r) => (
                <tr key={r.locationId}>
                  <td className="mono">
                    {r.rank ?? <span className="muted">—</span>}
                  </td>
                  <td>
                    <LocationLink name={r.name} locationId={r.locationId} />
                  </td>
                  <td className="right">
                    <Money value={r.revenue} />
                  </td>
                  <td className="right">
                    <Hours value={r.staffedHours} />
                  </td>
                  <td className="right">
                    <strong>
                      <Money value={r.revenuePerHour} />
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th />
                <th>Total</th>
                <th className="right">
                  <Money value={report.totalRevenue} />
                </th>
                <th className="right">
                  <Hours value={report.totalStaffedHours} />
                </th>
                <th className="right">
                  <Money
                    value={
                      report.totalStaffedHours > 0
                        ? Math.round(
                            (report.totalRevenue / report.totalStaffedHours) * 100,
                          ) / 100
                        : null
                    }
                  />
                </th>
              </tr>
            </tfoot>
          </table>
        </div>
        {report.staffedWithoutRevenue.length > 0 && (
          <p className="small muted" style={{ marginTop: '0.5rem' }}>
            Staffed but took nothing:{' '}
            {report.staffedWithoutRevenue.map((r) => r.name).join(', ')}. Worth a
            conversation before booking them again.
          </p>
        )}
      </div>
        </>
      )}

      {view === 'hours' && (
        <>
          <div className="card">
            <h2>Through the evening</h2>
            <HourChart points={chartPoints} />
            {byHour.unattributed > 0 && (
              <p className="small muted">
                This chart covers the <Money value={report.totalRevenue - byHour.unattributed} />{' '}
                that can be placed in an hour. A further{' '}
                <Money value={byHour.unattributed} /> was recorded against a location with no
                shift behind it, so it belongs to no hour and is not drawn — which is why the
                line ends below the figure at the top of the screen.
              </p>
            )}
          </div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>By hour</h2>
          {byHour.best && (
            <p className="small muted" style={{ margin: 0 }}>
              Best hour: <strong>{DAY_LABEL[byHour.best.day]} {byHour.best.label}</strong>{' '}
              at <Money value={byHour.best.revenue} />
            </p>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 0 }}>
          Which hours are worth being out — the breakdown behind the per-hour figure above,
          which is {byHour.slotsWorked === 0 ? 'no hours' : <Hours value={byHour.clockHours} />}
          {' '}of Apple Day so far. Revenue reaches an hour through the shift its jar went out
          on, so money entered by hand against a location has no hour and is listed below the
          table.
        </p>
        {byHour.rows.length === 0 ? (
          <p className="muted">No hours are set for this event yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Hour</th>
                  <th className="right">Revenue</th>
                  <th className="right">Staffed hours</th>
                  <th className="right">Per person-hour</th>
                  <th className="right">Jars</th>
                </tr>
              </thead>
              <tbody>
                {byHour.rows.map((row) => (
                  <tr key={row.slotId}>
                    <td className="nowrap">
                      {scope === 'all' && (
                        <span className="muted small">{DAY_LABEL[row.day]} </span>
                      )}
                      {row.label}
                    </td>
                    <td className="right">
                      <Money value={row.revenue} />
                    </td>
                    <td className="right">
                      <Hours value={row.staffedHours} />
                    </td>
                    <td className="right">
                      <Money value={row.revenuePerHour} />
                    </td>
                    <td className="right muted">
                      {row.jarCount}
                      {row.jarsOut > 0 && (
                        <span title={`${row.jarsOut} still out`}> +{row.jarsOut} out</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="right">
                    <Money
                      value={byHour.rows.reduce((n, r) => n + r.revenue, 0) +
                        byHour.unattributed}
                    />
                  </th>
                  <th className="right">
                    <Hours value={byHour.rows.reduce((n, r) => n + r.staffedHours, 0)} />
                  </th>
                  <th />
                  <th />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {byHour.unattributed > 0 && (
          <p className="small muted">
            Plus <Money value={byHour.unattributed} /> recorded against a location with no
            shift behind it, so there is nothing to say which hour it came in.
          </p>
        )}
      </div>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2>Location by hour</h2>
              <button className="tiny" onClick={exportGridCsv}>
                Export CSV
              </button>
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>
              Which door to stand at, and when. Each location&apos;s best hour is
              highlighted; an empty cell is an hour nobody was there, which is where next
              year&apos;s experiment goes.
            </p>
            <input
              style={{ width: '100%', maxWidth: '20rem', marginBottom: '0.5rem' }}
              placeholder="Find a location…"
              aria-label="Find a location by hour"
              value={locationSearch}
              onChange={(e) => setLocationSearch(e.target.value)}
            />
            {grid.rows.length === 0 ? (
              <p className="muted">No locations to compare yet.</p>
            ) : shownGridRows.length === 0 ? (
              <p className="muted">No location matches that.</p>
            ) : (
              <div className="table-wrap">
                {/* Every column after the frozen name: the hours, plus Total. */}
                <table
                  className="grid-table"
                  style={{ '--cols': grid.slots.length + 1 } as CSSProperties}
                >
                  <thead>
                    <tr>
                      <th className="sticky-name">Location</th>
                      {grid.slots.map((slot) => (
                        <th key={slot.id} className="right nowrap">
                          {/* Centred over the column it labels: the day belongs to the whole
                              hour beneath it, not to the right-hand edge the figures line
                              up against. */}
                          {scope === 'all' && (
                            <div className="small muted hour-day">{DAY_LABEL[slot.day]}</div>
                          )}
                          {slot.label}
                        </th>
                      ))}
                      <th className="right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shownGridRows.map((row) => (
                      <tr key={row.locationId}>
                        <td className="sticky-name small">
                          <LocationLink name={row.name} locationId={row.locationId} />
                        </td>
                        {row.cells.map((c) => (
                          <td
                            key={c.slotId}
                            className={cellClass(c, row.bestSlotId)}
                            title={
                              c.staffedHours > 0
                                ? `${c.staffedHours} person-hours`
                                : 'nobody there'
                            }
                          >
                            {c.revenue > 0 ? (
                              <Money value={c.revenue} />
                            ) : c.staffedHours > 0 ? (
                              '$0'
                            ) : (
                              '·'
                            )}
                          </td>
                        ))}
                        <td className="right">
                          <Money value={row.revenue} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th className="sticky-name">All locations</th>
                      {grid.totals.map((t) => (
                        <th key={t.slotId} className="right small">
                          <Money value={t.revenue} />
                        </th>
                      ))}
                      <th className="right">
                        <Money value={report.totalRevenue} />
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {view === 'people' && (
        <>
      <div className="card">
        <h2>By section</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th className="right">People</th>
                <th className="right">Hours</th>
                <th className="right">Share</th>
              </tr>
            </thead>
            <tbody>
              {sections.rows.map((row) => (
                <tr key={row.section}>
                  <td>
                    <SectionPill section={row.section} />
                  </td>
                  <td className="right">{row.people}</td>
                  <td className="right">
                    <Hours value={row.hours} />
                  </td>
                  <td className="right">{(row.share * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          Youth hours: <Hours value={sections.youthHours} /> of{' '}
          <Hours value={sections.totalHours} /> total. Scouters are counted separately, not
          folded in with Scouts.
        </p>
      </div>
      <div className="card">
        <h2>By youth</h2>
        <div className="row" style={{ marginBottom: '0.5rem' }}>
          <input
            style={{ flex: '1 1 10rem', maxWidth: '16rem' }}
            placeholder="Find a name…"
            aria-label="Find a youth"
            value={personSearch}
            onChange={(e) => setPersonSearch(e.target.value)}
          />
          {/* Sections are configuration, so the list comes from them rather than a fixed
              set of options here. */}
          <select
            aria-label="Section"
            value={section}
            onChange={(e) => setSection(e.target.value)}
          >
            <option value="all">Every section</option>
            {sectionDefs.map((sec) => (
              <option key={sec.id} value={sec.id}>
                {sec.name}
              </option>
            ))}
          </select>
        </div>
        {perPerson.length === 0 ? (
          <p className="muted">No jars have been attributed to a person yet.</p>
        ) : shownPeople.length === 0 ? (
          <p className="muted">Nobody matches that.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Youth</th>
                  <th className="right">Revenue</th>
                  <th className="right">Hours</th>
                </tr>
              </thead>
              <tbody>
                {shownPeople.slice(0, 25).map((row) => {
                  const person = personById.get(row.personId)
                  return (
                    <tr key={row.personId}>
                      <td>
                        <PersonLink person={person} personId={row.personId} />{' '}
                        {person && <SectionPill section={person.section} />}
                      </td>
                      <td className="right">
                        <Money value={row.revenue} />
                      </td>
                      <td className="right">
                        <Hours value={row.hours} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
        </>
      )}
    </>
  )
}
