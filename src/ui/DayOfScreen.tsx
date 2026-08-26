import { useMemo, useState } from 'react'
import { useUrlState } from '../lib/urlState'
import type { ReactNode } from 'react'
import { DAY_LABEL, formatTime } from '../domain/slots'
import { currentSlot, todaysEventDay } from '../domain/today'
import { shiftsCoveredBy } from '../domain/jars'
import { groupIntoRuns, runControls, runState, runTouches } from '../domain/shiftRuns'
import type { ShiftRun } from '../domain/shiftRuns'
import { DAYS, fullName, isNumbered } from '../domain/types'
import type {
  Assignment,
  Day,
  Jar,
  Person,
  ScheduledLocation,
  Slot,
  Whereabouts,
} from '../domain/types'
import { useEvent } from '../lib/eventContext'
import {
  issueJar,
  revealPassShifts,
  setAssignmentStatusMany,
  setWhereaboutsMany,
  swapAssignments,
  unissueJar,
  useAssignments,
  useJars,
  useBaseLocation,
  useLocations,
  usePasses,
  usePeople,
} from '../lib/repo'
import { useSession } from '../lib/session'
import { ErrorNote, Loading, SectionPill, Stat } from './Bits'
import { ContactFlag } from './ContactFlag'
import { PersonLink } from './PersonLink'
import { IssueJarDialog } from './IssueJarDialog'
import { RequestsInbox } from './RequestsInbox'
import { MapModal } from './MapModal'

/**
 * Running the event on the day.
 *
 * Organised by person, because that is who walks up to the table. An earlier version listed
 * everything by location, which meant finding somebody meant knowing where they were going —
 * backwards from how the desk actually works: a youth arrives, you find their name, check
 * them in, hand them a jar, send them out.
 *
 * The whole day is visible at once by default. Shifts overlap and people arrive early, so
 * showing a single hour hid the person standing in front of you if they were early or late.
 */

type Scope = 'day' | 'hour'

interface ShiftRow {
  assignment: Assignment
  slot: Slot | undefined
  locationName: string
  /** The library record, for the map. Null for an id with nothing behind it. */
  location: ScheduledLocation | null
  jars: Jar[]
}

/** A shift carrying the times {@link groupIntoRuns} needs to see it join up with the next. */
type RunShift = ShiftRow & {
  locationId: string
  startMin: number | null
  endMin: number | null
}

interface PersonRow {
  person: Person
  /** Consecutive shifts at one location, grouped: one stretch of work, one set of buttons. */
  runs: ShiftRun<RunShift>[]
  /** Earliest shift, for ordering the list the way people turn up. */
  firstStart: number
}

export function DayOfScreen(): ReactNode {
  const { event, pathFor, slots: allSlots } = useEvent()
  const { user } = useSession()
  const locations = useLocations()
  // For revealing a volunteer's location on their own pass when they check in.
  const passes = usePasses()
  // Above the loading return: a hook after it runs on some renders and not others, which
  // React counts and throws on.
  const base = useBaseLocation().data
  const people = usePeople()
  const assignments = useAssignments()
  const jars = useJars()

  /*
    Null until somebody picks a day, so the default can follow the date.

    Hardcoding 'fri' meant the first thing anybody did on Saturday morning was reach for the
    day switch — a wrong screen shown to somebody in a hurry on the busiest morning of the
    year. A choice, once made, sticks: the organizer looking at Friday's numbers on the
    Saturday is not second-guessed.
  */
  /*
    In the address bar, not in React state.

    Otherwise opening somebody from the Saturday table and pressing Back lands on Friday
    with the filters cleared — four button presses from where you were, on the morning you
    can least spare them.
  */
  const [dayParam, setDayParam] = useUrlState('day')
  const [scopeParam, setScope] = useUrlState('scope', 'day')
  const [slotId, setSlotId] = useUrlState('slot')
  const [search, setSearch] = useUrlState('find')

  const selectedDay = (dayParam || null) as Day | null
  const setSelectedDay = (d: Day | null): void => setDayParam(d ?? '')
  const scope = scopeParam as Scope
  const [issuing, setIssuing] = useState<ShiftRun<RunShift> | null>(null)
  const [mapFor, setMapFor] = useState<ScheduledLocation | null>(null)
  const [swapFrom, setSwapFrom] = useState<Assignment | null>(null)
  const [writeError, setWriteError] = useState<Error | null>(null)

  const eventDays = useMemo(
    () => DAYS.filter((d) => allSlots.some((s) => s.day === d)),
    [allSlots],
  )
  /** Today, when today is a day of this event; otherwise the first day it runs. */
  const defaultDay = useMemo(
    () => (event ? todaysEventDay(event, new Date()) : null),
    [event],
  )
  const day =
    selectedDay && eventDays.includes(selectedDay)
      ? selectedDay
      : (defaultDay ?? eventDays[0] ?? 'sat')
  const daySlots = useMemo(() => allSlots.filter((s) => s.day === day), [allSlots, day])
  /*
    The hour showing, when the screen is narrowed to one.

    Defaults to the hour actually happening — or the next one, since the gap before a shift
    is when it is being got ready — rather than the first hour of the day, which by three in
    the afternoon is nobody's question. Only when today is this day of the event: on any
    other date there is no "now" to point at.
  */
  const nowSlotId = useMemo(() => {
    if (!event || todaysEventDay(event, new Date()) !== day) return ''
    return currentSlot(daySlots, day, new Date())?.id ?? ''
  }, [event, day, daySlots])

  const activeSlotId = slotId || nowSlotId || daySlots[0]?.id || ''

  const personById = useMemo(
    () => new Map(people.data.map((p) => [p.id, p])),
    [people.data],
  )
  const locationById = useMemo(
    () => new Map(locations.data.map((l) => [l.id, l])),
    [locations.data],
  )
  const slotById = useMemo(() => new Map(daySlots.map((s) => [s.id, s])), [daySlots])

  const jarsByAssignment = useMemo(() => {
    const map = new Map<string, Jar[]>()
    for (const jar of jars.data) {
      if (!jar.assignmentId) continue
      const list = map.get(jar.assignmentId)
      if (list) list.push(jar)
      else map.set(jar.assignmentId, [jar])
    }
    return map
  }, [jars.data])

  const jarsOutToday = useMemo(
    () => jars.data.filter((j) => j.day === day && j.status === 'out'),
    [jars.data, day],
  )

  /** The lowest number not currently out. A counted jar is empty and reusable. */
  const suggestedJarNumber = useMemo(() => {
    const taken = new Set(jarsOutToday.filter(isNumbered).map((j) => j.jarNumber))
    let n = 1
    while (taken.has(n)) n += 1
    return n
  }, [jarsOutToday])

  /**
   * One row per person, carrying their runs of work for the day.
   *
   * A run is consecutive shifts at one location — 5–6 and 6–7 at the same store is one
   * stretch, not two, and the person doing it does not come back to the table in between.
   * Grouping happens over the *whole day* even when the screen shows a single hour: the
   * reason to show it is to say "this carries on past this hour", and filtering to the hour
   * first would make exactly that invisible.
   */
  const rows = useMemo((): PersonRow[] => {
    const window =
      scope === 'hour' ? daySlots.find((s) => s.id === activeSlotId) ?? null : null
    const dayIds = new Set(daySlots.map((s) => s.id))

    const byPerson = new Map<string, RunShift[]>()
    for (const a of assignments.data) {
      if (a.status === 'swapped' || !dayIds.has(a.slotId)) continue
      const slot = slotById.get(a.slotId)
      const shift: RunShift = {
        assignment: a,
        slot,
        locationName: locationById.get(a.locationId)?.name ?? a.locationId,
        location: locationById.get(a.locationId) ?? null,
        jars: jarsByAssignment.get(a.id) ?? [],
        locationId: a.locationId,
        startMin: slot?.startMin ?? null,
        endMin: slot?.endMin ?? null,
      }
      const list = byPerson.get(a.personId)
      if (list) list.push(shift)
      else byPerson.set(a.personId, [shift])
    }

    const query = search.trim().toLowerCase()
    return [...byPerson.entries()]
      .flatMap(([personId, shifts]) => {
        const person = personById.get(personId)
        if (!person) return []
        if (query && !fullName(person).toLowerCase().includes(query)) return []

        const runs = groupIntoRuns(shifts)
        const visible = window ? runs.filter((r) => runTouches(r, window)) : runs
        if (visible.length === 0) return []

        return [
          {
            person,
            runs: visible,
            firstStart: visible[0]?.startMin ?? 0,
          },
        ]
      })
      // Earliest first, so the list reads in the order people turn up.
      .sort(
        (a, b) =>
          a.firstStart - b.firstStart ||
          fullName(a.person).localeCompare(fullName(b.person)),
      )
  }, [
    assignments.data,
    scope,
    activeSlotId,
    daySlots,
    slotById,
    locationById,
    jarsByAssignment,
    personById,
    search,
  ])

  const counts = useMemo(() => {
    const shifts = rows.flatMap((r) => r.runs.flatMap((run) => run.items))
    return {
      shifts: shifts.length,
      expected: shifts.filter(
        (s) => s.assignment.status === 'planned' || s.assignment.status === 'confirmed',
      ).length,
      // Attendance and whereabouts are separate, so "here" means checked in and not
      // currently out — otherwise somebody at a location would be counted at base too.
      here: shifts.filter(
        (s) => s.assignment.status === 'checkedIn' && s.assignment.whereabouts === 'here',
      ).length,
      out: shifts.filter((s) => s.assignment.whereabouts === 'out').length,
      back: shifts.filter((s) => s.assignment.whereabouts === 'back').length,
      noShows: shifts.filter((s) => s.assignment.status === 'noShow').length,
    }
  }, [rows])

  /**
   * Anyone out collecting with no jar in their hands.
   *
   * Either they were sent out manually and the jar was never recorded, or their jar was
   * taken back and nobody brought them in. Both mean the money coming back has nothing to
   * attach to.
   */
  const outWithoutJar = useMemo(
    () =>
      rows.flatMap((r) =>
        // Per run, not per shift: two hours back to back on one jar is one person out with
        // one jar, and warning twice about it would be noise at the busiest moment.
        r.runs
          .filter(
            (run) =>
              run.items.some((s) => s.assignment.whereabouts === 'out') &&
              run.items.every((s) => s.jars.filter((j) => j.status === 'out').length === 0),
          )
          .map((run) => ({ person: r.person, run })),
      ),
    [rows],
  )

  /** Every shift in a stretch moves together — one decision, one set of buttons. */
  const idsOf = (run: ShiftRun<RunShift>): string[] =>
    run.items.map((sh) => sh.assignment.id)

  const setStatus = (run: ShiftRun<RunShift>, status: Assignment['status']): void => {
    if (!event) return
    setWriteError(null)
    void setAssignmentStatusMany(event.id, idsOf(run), status).catch((error: Error) =>
      setWriteError(error),
    )

    /*
      Their check-in is what tells them where they are going — and taking it back takes that
      away again.

      Somebody checked in by mistake, or marked absent, should not be left holding a page
      that still names a location: everybody reports to base first, and a reveal that
      outlives its check-in quietly undoes that.

      Separate and unawaited: a pass that fails to update must never stop a check-in at a
      busy table.
    */
    const token = passes.data.find(
      (p) => p.personId === run.items[0]!.assignment.personId,
    )?.token
    if (token) void revealPassShifts(token, status === 'checkedIn').catch(() => {})
  }

  const setWhere = (run: ShiftRun<RunShift>, whereabouts: Whereabouts): void => {
    if (!event) return
    setWriteError(null)
    void setWhereaboutsMany(event.id, idsOf(run), whereabouts).catch((error: Error) =>
      setWriteError(error),
    )
  }

  const doIssue = (run: ShiftRun<RunShift>, jarNumber: number): void => {
    if (!event) return
    const assignment = run.items[0]!.assignment
    setWriteError(null)
    setIssuing(null)
    // The jar hangs off the first shift of the stretch, because a jar record points at one
    // shift and that is the one they are leaving on. `issueJar` sends that shift out; the
    // rest of the stretch follows, so the row and the headcount agree.
    void issueJar(
      event.id,
      {
        jarNumber,
        day,
        locationId: assignment.locationId,
        personId: assignment.personId,
        assignmentId: assignment.id,
        // The whole stretch, so its takings divide across the hours it was actually out.
        assignmentIds: idsOf(run),
      },
      user?.uid ?? 'unknown',
    )
      // `issueJar` sends out every shift the jar covers, which is the whole stretch, so
      // there is nothing left to move.

      .catch((error: Error) => setWriteError(error))
  }

  const takeBack = (run: ShiftRun<RunShift>, jar: Jar): void => {
    if (!event) return
    // Across the whole stretch: a jar held against the second hour still means they are out.
    const stillHolding = run.items
      .flatMap((sh) => jarsByAssignment.get(sh.assignment.id) ?? [])
      .filter((j) => j.status === 'out' && j.id !== jar.id)
    // `unissueJar` reverts every shift the jar covered, so the extra write below is only
    // for the rest of the stretch when this jar covered less than all of it.
    const covered = new Set(shiftsCoveredBy(jar))
    const outsideJar = run.items.some((sh) => !covered.has(sh.assignment.id))
    setWriteError(null)
    void unissueJar(event.id, jar, stillHolding.length === 0)
      .then(() =>
        stillHolding.length === 0 && outsideJar
          ? setWhereaboutsMany(event.id, idsOf(run), 'here')
          : undefined,
      )
      .catch((error: Error) => setWriteError(error))
  }

  const handleSwapClick = (assignment: Assignment): void => {
    if (!swapFrom) {
      setSwapFrom(assignment)
      return
    }
    if (swapFrom.id === assignment.id) {
      setSwapFrom(null)
      return
    }
    if (!event) return
    setWriteError(null)
    const from = swapFrom
    setSwapFrom(null)
    void swapAssignments(event.id, from, assignment).catch((error: Error) =>
      setWriteError(error),
    )
  }

  if (locations.loading || assignments.loading) return <Loading what="Loading the day" />

  return (
    /*
      A normal scrolling page, not a viewport-filling one with the table as its own scroll
      region.

      Filling the viewport gives the table whatever is left after the day switch, the base
      line, the warnings and the requests inbox — which on a phone, on a busy evening when
      those are all showing, is one or two rows. The header sticking is worth less than
      being able to see the list: the columns are Who, Shift, Where, Jars, State, and by the
      third row nobody is looking at the header anyway.
    */
    <>
      <ErrorNote error={writeError ?? assignments.error ?? locations.error} />

      {/* First, as on the board: a volunteer asking for something is a thing to deal with
          before working down the table, not a note tucked between two sections of it. */}
      <RequestsInbox />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            {eventDays.map((d) => (
              <button
                key={d}
                className={day === d ? 'primary' : ''}
                onClick={() => {
                  setSelectedDay(d)
                  setSlotId('')
                  setSwapFrom(null)
                }}
              >
                {DAY_LABEL[d]}
              </button>
            ))}
          </div>
          <div className="stats">
            <Stat label="to come" value={counts.expected} />
            <Stat label="here" value={counts.here} />
            <Stat label="out" value={counts.out} tone="good" />
            <Stat label="back" value={counts.back} />
            <Stat
              label="no-shows"
              value={counts.noShows}
              {...(counts.noShows > 0 ? { tone: 'bad' as const } : {})}
            />
            <Stat label="jars out" value={jarsOutToday.length} />
          </div>
        </div>

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button
            className={scope === 'day' ? 'primary' : ''}
            onClick={() => setScope('day')}
          >
            Whole day
          </button>
          <button
            className={scope === 'hour' ? 'primary' : ''}
            onClick={() => setScope('hour')}
          >
            One shift
          </button>
          {scope === 'hour' &&
            daySlots.map((slot) => (
              <button
                key={slot.id}
                className={activeSlotId === slot.id ? 'primary' : ''}
                onClick={() => setSlotId(slot.id)}
              >
                {slot.label.replace(/:00/g, '').replace(/ /g, '')}
              </button>
            ))}
          <input
            placeholder="Find a name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 10rem', minWidth: '8rem' }}
          />
        </div>

        {base && (
          <p className="small muted" style={{ marginTop: '0.5rem' }}>
            Base: <strong>{base.name}</strong>
            {base.address && ` · ${base.address}`}
            {base.siteContact?.phone && (
              <>
                {' · '}
                <a href={`tel:${base.siteContact.phone}`}>{base.siteContact.phone}</a>
              </>
            )}
          </p>
        )}
      </div>

      {outWithoutJar.length > 0 && (
        <div className="note warning">
          <strong>
            {outWithoutJar.length} out collecting with no jar
          </strong>
          <div className="small">
            Money coming back has nothing to attach to. Issue a jar, or bring them in.
          </div>
          <ul className="issue-list">
            {outWithoutJar.map(({ person, run }) => (
              <li key={run.items[0]!.assignment.id}>
                <PersonLink person={person} /> — {run.items[0]!.locationName}{' '}
                <button
                  className="tiny"
                  onClick={() => setIssuing(run)}
                >
                  Issue jar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {swapFrom && (
        <div className="note info">
          Swapping{' '}
          <strong>
            {fullName(
              personById.get(swapFrom.personId) ?? { firstName: 'someone', lastName: '' },
            )}
          </strong>{' '}
          — now pick who they trade places with.{' '}
          <button className="tiny" onClick={() => setSwapFrom(null)}>
            Cancel
          </button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted">
            {search
              ? `Nobody matching “${search}”.`
              : scope === 'hour'
                ? 'Nobody is scheduled for this shift.'
                : `Nobody is scheduled for ${DAY_LABEL[day]}.`}
          </p>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Shift</th>
                  <th>Where</th>
                  <th>Jars</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.flatMap((row) =>
                  row.runs.map((run, i) => {
                    const shifts = run.items
                    const first = shifts[0]!
                    const a = first.assignment
                    const held = shifts.flatMap((sh) =>
                      sh.jars.filter((j) => j.status === 'out'),
                    )
                    const counted = shifts.flatMap((sh) =>
                      sh.jars.filter((j) => j.status === 'counted'),
                    )

                    /*
                      One state for the run, and the buttons that state offers.

                      Both come from `shiftRuns`, and neither is decided here. The eight
                      booleans this replaced were derived per-button, so nothing checked
                      that every state a row could reach had a control that could leave it
                      — and three times it did not.
                    */
                    const state = runState(shifts.map((sh) => sh.assignment))
                    const can = runControls(state)
                    const arrived = state.attendance === 'arrived'
                    const absent = state.attendance === 'absent'
                    const away = state.place === 'out'
                    const done = state.place === 'back'

                    return (
                      <tr key={a.id}>
                        <td>
                          {i === 0 ? (
                            <>
                              <div className="nowrap">
                                {/*
                                  Before the name, not after it.

                                  Ahead of the name it is in the margin the eye already runs
                                  down, so a table of ninety rows can be scanned for the
                                  handful that carry one. After the name it moves with the
                                  length of the name and has to be hunted for.
                                */}
                                <ContactFlag person={row.person} />
                                {/* Their own page: what they offered, what they have been
                                    given, and whether they have done this before. */}
                                <a
                                  className="strong-link"
                                  href={pathFor(`person/${row.person.id}`)}
                                >
                                  {fullName(row.person)}
                                </a>{' '}
                                <SectionPill section={row.person.section} />
                              </div>
                              {row.runs.flatMap((r) => r.items).length > 1 && (
                                <div className="small muted">
                                  {row.runs.flatMap((r) => r.items).length} shifts today
                                </div>
                              )}
                            </>
                          ) : (
                            <span className="small muted">↳ same person</span>
                          )}
                        </td>
                        <td className="small nowrap">
                          {shifts.length === 1 ? (
                            first.slot?.label ?? a.slotId
                          ) : (
                            <>
                              {/* One stretch, so one span — and said out loud, because in
                                  the one-hour view the row would otherwise look like an
                                  ordinary single shift. */}
                              <div>
                                {run.startMin !== null && run.endMin !== null
                                  ? `${formatTime(run.startMin)}–${formatTime(run.endMin)}`
                                  : (first.slot?.label ?? a.slotId)}
                              </div>
                              <div className="muted">
                                {shifts.length} shifts, back to back
                              </div>
                            </>
                          )}
                        </td>
                        <td className="small">
                          {/* Clickable when there is something to show: at a shift change
                              the question is how to get there from base, and the answer
                              should not need a new tab and a retyped address. */}
                          {first.location ? (
                            <button
                              className="linkish"
                              title={`Where ${first.locationName} is${
                                base ? `, from ${base.name}` : ''
                              }`}
                              onClick={() => setMapFor(first.location)}
                            >
                              {first.locationName}
                            </button>
                          ) : (
                            first.locationName
                          )}
                        </td>
                        <td className="small">
                          {held.length === 0 && counted.length === 0 ? (
                            <span className="muted">—</span>
                          ) : (
                            <div className="row" style={{ gap: '0.2rem' }}>
                              {held.map((j) => (
                                <span
                                  key={j.id}
                                  className="chip"
                                  style={{ paddingLeft: '0.45rem' }}
                                >
                                  {isNumbered(j) ? j.jarNumber : 'jar'}
                                  <button
                                    className="x"
                                    aria-label={`Take jar ${
                                      isNumbered(j) ? j.jarNumber : ''
                                    } back from ${fullName(row.person)}`}
                                    title="Take this jar back"
                                    onClick={() => takeBack(run, j)}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                              {counted.length > 0 && (
                                <span className="muted">
                                  {counted.length} counted
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        <td className="small nowrap">
                          {/* Both facts, side by side. A shift can be checked in *and*
                              out collecting, and the day-of table has to show both. */}
                          {arrived && <span className="pill tone-amber">checked in</span>}
                          {absent && <span className="pill tone-red">no-show</span>}
                          {!arrived && !absent && <span className="muted">expected</span>}
                          {away && <span className="pill tone-green">out collecting</span>}
                          {done && <span className="pill tone-blue">back</span>}
                        </td>
                        <td>
                          {/*
                            Only the buttons this shift can actually use.
                            
                            A row at the table showed seven controls, five of which did
                            nothing yet, and the one that mattered was whichever came next
                            in a fixed order. So the set follows the state: check in or
                            mark absent, then send out, then bring back. The counterpart of
                            a decision stays on screen as the way to undo it, and nothing
                            else does.
                          */}
                          <div className="row" style={{ gap: '0.25rem' }}>
                            {can.checkIn && (
                              <button
                                className={`tiny${arrived ? ' primary' : ''}`}
                                title={
                                  arrived
                                    ? 'They are at the table — press to undo'
                                    : `${fullName(row.person)} has arrived${
                                        shifts.length > 1
                                          ? ` for all ${shifts.length} shifts`
                                          : ''
                                      }`
                                }
                                onClick={() => setStatus(run, arrived ? 'confirmed' : 'checkedIn')}
                              >
                                {arrived ? 'Here' : 'Check in'}
                              </button>
                            )}
                            {can.noShow && (
                              <button
                                className={`tiny${absent ? ' danger' : ''}`}
                                title={
                                  absent
                                    ? 'Marked absent — press to take that back'
                                    : 'They did not come'
                                }
                                onClick={() => setStatus(run, absent ? 'confirmed' : 'noShow')}
                              >
                                {/* Says what pressing it does. "No-show" on a row already
                                    marked absent reads as the thing to press to mark them
                                    absent, which is why it looked like there was no way back. */}
                                {absent ? 'Undo no-show' : 'No-show'}
                              </button>
                            )}
                            {can.issue && (
                              <button
                                className="tiny"
                                title={`Give ${fullName(row.person)} a jar and send them out`}
                                onClick={() => setIssuing(run)}
                              >
                                {held.length > 0 ? '+ jar' : 'Issue jar'}
                              </button>
                            )}
                            {/* Issuing and counting a jar normally move these. The buttons
                                are for the shift that goes out without one, or comes back
                                without the jar it left with. */}
                            {can.out && (
                              <button
                                className={`tiny${away ? ' primary' : ''}`}
                                title="Mark them out collecting without recording a jar"
                                onClick={() => setWhere(run, away ? 'here' : 'out')}
                              >
                                Out
                              </button>
                            )}
                            {can.back && (
                              <button
                                className={`tiny${done ? ' primary' : ''}`}
                                title={
                                  done
                                    ? 'Back at base — press to send out again'
                                    : 'Mark them back at base'
                                }
                                onClick={() => setWhere(run, done ? 'out' : 'back')}
                              >
                                Back
                              </button>
                            )}
                            {can.swap && shifts.length === 1 && (
                              <button
                                className={`tiny${swapFrom?.id === a.id ? ' primary' : ''}`}
                                onClick={() => handleSwapClick(a)}
                              >
                                Swap
                              </button>
                            )}
                            {can.swap && shifts.length > 1 && (
                              // Swapping trades one shift for one shift, so it has no
                              // meaning for a stretch of several — that is a change to the
                              // plan, and the board is where the plan lives.
                              <span className="small muted" title="Swap this on the schedule board">
                                on the board
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mapFor && (
        // On the day the question is how to get there from base, so a missing base is
        // worth saying — somebody is about to be sent out without directions.
        <MapModal
          place={mapFor}
          base={base ?? null}
          fromBase
          onClose={() => setMapFor(null)}
        />
      )}

      {issuing &&
        (() => {
          const first = issuing.items[0]!
          const person = personById.get(first.assignment.personId)
          if (!person) return null
          // The whole stretch, so the dialog says what they are going out for — "5:00–7:00
          // PM, 2 shifts" rather than the first hour alone.
          const label =
            issuing.items.length > 1 && issuing.startMin !== null && issuing.endMin !== null
              ? `${formatTime(issuing.startMin)}–${formatTime(issuing.endMin)} · ${
                  issuing.items.length
                } shifts`
              : (first.slot?.label ?? first.assignment.slotId)
          return (
            <IssueJarDialog
              person={person}
              locationName={first.locationName}
              slotLabel={label}
              jarsOut={jarsOutToday}
              suggestedNumber={suggestedJarNumber}
              onIssue={(jarNumber) => doIssue(issuing, jarNumber)}
              onClose={() => setIssuing(null)}
            />
          )
        })()}
    </>
  )
}
