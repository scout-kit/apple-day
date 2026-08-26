import { useMemo, useState } from 'react'
import { useUrlState } from '../lib/urlState'
import type { CSSProperties, ReactNode } from 'react'
import { DAY_LABEL, isHoursRecorded, isOpenDuring } from '../domain/slots'
import { todaysEventDay } from '../domain/today'
import { DAYS } from '../domain/types'
import { fullName } from '../domain/types'
import type { Assignment, Day, Person, Slot } from '../domain/types'
import { validateSchedule } from '../domain/validation'
import type { ScheduleIssue } from '../domain/validation'
import { useEvent } from '../lib/eventContext'
import {
  assign,
  unassign,
  useAssignments,
  useLocations,
  usePeople,
  useSignups,
} from '../lib/repo'
import { LocationLink } from './LocationLink'
import { ErrorNote, IssueBanner, Loading, SectionPill, Stat } from './Bits'
import { PublishActions } from './PublishActions'
import { PersonLink } from './PersonLink'
import { RequestsInbox } from './RequestsInbox'
import { PersonPicker } from './PersonPicker'

/**
 * The schedule board — location × slot, one day at a time.
 *
 * Replaces `Friday Schedule` and `Saturday Schedule`, which were two sheets with
 * different column layouts, names typed free-hand into cells (sometimes two people per
 * cell), and a lookup column that read `NOT FOUND` for two locations all event.
 *
 * Validation runs on every change and never blocks. Organizers override constantly and
 * for good reasons; the job here is to make sure nothing is missed by accident.
 */
export function ScheduleScreen(): ReactNode {
  /*
    Null until somebody picks a day, so the default can follow the date.

    Hardcoding 'fri' meant the first thing anybody did on Saturday morning was reach for the
    day switch — a wrong screen shown to somebody in a hurry on the busiest morning of the
    year. A choice, once made, sticks: the organizer looking at Friday's numbers on the
    Saturday is not second-guessed.
  */
  // In the address bar, so following a link and coming back keeps the day. See useUrlState.
  const [dayParam, setDayParam] = useUrlState('day')
  const selectedDay = (dayParam || null) as Day | null
  const setSelectedDay = (d: Day | null): void => setDayParam(d ?? '')
  const [highlight, setHighlight] = useState<ScheduleIssue | null>(null)
  const [writeError, setWriteError] = useState<Error | null>(null)
  /**
   * Cells where the organizer has deliberately chosen to staff a closed hour.
   *
   * Closed hours do not offer a picker — the hatching should mean something — but the
   * decision is still theirs: a shop that agreed to open early for us, or hours that turn
   * out to be wrong. Overriding is per cell and per session, so it cannot quietly become
   * the default for the whole board.
   */
  const [overrides, setOverrides] = useState<Set<string>>(new Set())
  /** Reveal the locations that are shut, or have no hours, for the day being viewed. */
  const [showAllLocations, setShowAllLocations] = useState(false)
  /** The cell whose picker is open, with the rect to anchor it to. */
  const [picking, setPicking] = useState<{
    slot: Slot
    locationId: string
    anchor: DOMRect
  } | null>(null)

  const allowClosed = (slotId: string, locationId: string): void =>
    setOverrides((current) => new Set(current).add(`${slotId}::${locationId}`))

  const { event, slots: allSlots } = useEvent()
  const locations = useLocations()
  const people = usePeople()
  const signups = useSignups()
  const assignments = useAssignments()

  // Only the days this year actually runs.
  const eventDays = useMemo(
    () => DAYS.filter((d) => allSlots.some((s) => s.day === d)),
    [allSlots],
  )
  // Fall back to the year's first day when the selection is not one it runs.
  /** Today, when today is a day of this event; otherwise the first day it runs. */
  const defaultDay = useMemo(
    () => (event ? todaysEventDay(event, new Date()) : null),
    [event],
  )
  const day =
    selectedDay && eventDays.includes(selectedDay)
      ? selectedDay
      : (defaultDay ?? eventDays[0] ?? 'sat')
  const slots = useMemo(() => allSlots.filter((s) => s.day === day), [allSlots, day])
  const personById = useMemo(
    () => new Map(people.data.map((p) => [p.id, p])),
    [people.data],
  )

  const issues = useMemo(
    () =>
      validateSchedule({
        locations: locations.data,
        people: people.data,
        signups: signups.data,
        assignments: assignments.data,
        slots: allSlots,
      }),
    [locations.data, people.data, signups.data, assignments.data, allSlots],
  )

  const dayIssues = useMemo(() => {
    const slotIds = new Set(slots.map((s) => s.id))
    const assignmentById = new Map(assignments.data.map((a) => [a.id, a]))
    return issues.filter((issue) => {
      // Whole-event issues (somebody with no shift at all) always show; the rest are kept
      // only when they touch the day being viewed.
      if (issue.assignmentIds.length === 0) return true
      return issue.assignmentIds.some((id) => {
        const a = assignmentById.get(id)
        return a ? slotIds.has(a.slotId) : false
      })
    })
  }, [issues, slots, assignments.data])

  const activeLocations = useMemo(
    () => locations.data.filter((l) => l.active),
    [locations.data],
  )

  /**
   * Locations worth a row on the day being viewed.
   *
   * A place that is shut, or whose hours nobody has recorded, is not part of this day — a
   * row of hatching for it is just noise. One exception: if somebody is already scheduled
   * there, the row stays, or the shift would be hidden and impossible to move.
   */
  const { shownLocations, hiddenLocations } = useMemo(() => {
    const daySlotIds = new Set(slots.map((s) => s.id))
    const worked = new Set(
      assignments.data
        .filter((a) => a.status !== 'swapped' && daySlotIds.has(a.slotId))
        .map((a) => a.locationId),
    )

    const shown: typeof activeLocations = []
    const hidden: typeof activeLocations = []
    for (const location of activeLocations) {
      const openSomeHour = slots.some((slot) =>
        isOpenDuring(location.openHours[day], slot),
      )
      if (openSomeHour || worked.has(location.id)) shown.push(location)
      else hidden.push(location)
    }
    return { shownLocations: shown, hiddenLocations: hidden }
  }, [activeLocations, slots, assignments.data, day])

  const visibleLocations = showAllLocations
    ? [...shownLocations, ...hiddenLocations].sort(
        (a, b) => a.priority - b.priority || a.name.localeCompare(b.name),
      )
    : shownLocations

  const bySlotAndLocation = useMemo(() => {
    const map = new Map<string, Assignment[]>()
    for (const a of assignments.data) {
      if (a.status === 'swapped') continue
      const key = `${a.slotId}::${a.locationId}`
      const list = map.get(key)
      if (list) list.push(a)
      else map.set(key, [a])
    }
    return map
  }, [assignments.data])

  const assignedBySlot = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const a of assignments.data) {
      if (a.status === 'swapped') continue
      const set = map.get(a.slotId)
      if (set) set.add(a.personId)
      else map.set(a.slotId, new Set([a.personId]))
    }
    return map
  }, [assignments.data])

  /**
   * How many people are free for each hour, for the cell tooltips.
   *
   * Counted once per day rather than per cell. `candidatesFor` sorts ninety people, and
   * calling it for all seventy-odd cells on every render was work the tooltip did not
   * justify — the picker itself builds the real list when it opens.
   */
  const freeBySlot = useMemo(() => {
    const counts = new Map<string, number>()
    for (const slot of slots) {
      const taken = assignedBySlot.get(slot.id) ?? new Set<string>()
      const offered = signups.data.filter((s) =>
        (s.availability[slot.day] ?? []).includes(slot.id),
      )
      counts.set(slot.id, offered.filter((s) => !taken.has(s.personId)).length)
    }
    return counts
  }, [slots, signups.data, assignedBySlot])

  /** People who said they could do this slot and are not already placed in it. */
  const candidatesFor = (slot: Slot): { available: Person[]; other: Person[] } => {
    const taken = assignedBySlot.get(slot.id) ?? new Set<string>()
    const availableIds = new Set(
      signups.data
        .filter((s) => (s.availability[slot.day] ?? []).includes(slot.id))
        .map((s) => s.personId),
    )

    const available: Person[] = []
    const other: Person[] = []
    for (const person of people.data) {
      if (taken.has(person.id)) continue
      ;(availableIds.has(person.id) ? available : other).push(person)
    }
    const byName = (a: Person, b: Person): number =>
      fullName(a).localeCompare(fullName(b))
    return { available: available.sort(byName), other: other.sort(byName) }
  }

  const highlightedAssignments = new Set(highlight?.assignmentIds ?? [])
  const highlightedLocations = new Set(highlight?.locationIds ?? [])

  /**
   * Both of these fire the write and return immediately, rather than awaiting it.
   *
   * Firestore applies the change to the local cache straight away and the snapshot
   * listener re-renders with it, so the chip appears at once. The promise, however, only
   * settles when the *server* acknowledges — which on a weak connection is much later, and
   * offline is never. Waiting on it to re-enable the board meant a single add froze all 72
   * cells with the person already visibly added.
   *
   * Errors still surface: a rejection is reported rather than swallowed, and the board
   * stays usable so the organizer can retry or undo.
   */
  const add = (slot: Slot, locationId: string, personId: string): void => {
    if (!personId || !event) return
    setWriteError(null)
    void assign(event.id, {
      slotId: slot.id,
      locationId,
      personId,
      status: 'planned',
      whereabouts: 'here',
      checkedInAt: null,
      checkedOutAt: null,
    }).catch((error: Error) => setWriteError(error))
  }

  const remove = (assignmentId: string): void => {
    if (!event) return
    setWriteError(null)
    void unassign(event.id, assignmentId).catch((error: Error) => setWriteError(error))
  }

  if (locations.loading || people.loading || assignments.loading) {
    return <Loading what="Loading the schedule" />
  }

  const staffedCount = assignments.data.filter((a) =>
    slots.some((s) => s.id === a.slotId),
  ).length

  return (
    <div className="fill">
      <ErrorNote
        error={writeError ?? locations.error ?? people.error ?? assignments.error}
      />

      {/* Requests arrive before the day as well as on it, and this is where the plan can
          still be changed in response to one. */}
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
                  setHighlight(null)
                }}
              >
                {DAY_LABEL[d]}
              </button>
            ))}
          </div>
          <div className="stats">
            <Stat label="shifts placed" value={staffedCount} />
            <Stat
              label="people scheduled"
              value={new Set(assignments.data.map((a) => a.personId)).size}
            />
            <Stat label="signed up" value={signups.data.length} />
          </div>
        </div>

        {/* Publishing belongs with the day switch and the counts: it is part of what this
            card says about the state of the schedule, not a separate errand. */}
        <PublishActions />
      </div>

      <IssueBanner issues={dayIssues} onSelect={setHighlight} />
      {picking &&
        (() => {
          const { available, other } = candidatesFor(picking.slot)
          const location = locations.data.find((l) => l.id === picking.locationId)
          return (
            <PersonPicker
              anchor={picking.anchor}
              title={`${location?.name ?? ''} · ${DAY_LABEL[picking.slot.day]} ${picking.slot.label}`}
              groups={[
                { label: 'Signed up for this hour', people: available },
                {
                  label: 'Not signed up for this hour',
                  people: other,
                  hint: 'not available',
                },
              ]}
              onPick={(personId) => {
                add(picking.slot, picking.locationId, personId)
                // Closing keeps a run of additions honest: each one is a deliberate act,
                // and the cell's chips update behind the panel anyway.
                setPicking(null)
              }}
              onClose={() => setPicking(null)}
            />
          )
        })()}

      {highlight && (
        <div className="row small">
          <button className="tiny" onClick={() => setHighlight(null)}>
            Clear highlight
          </button>
        </div>
      )}

      {visibleLocations.length === 0 ? (
        <div className="card">
          <p>
            {activeLocations.length === 0
              ? 'No locations yet. Add them on the Locations screen first.'
              : `Nothing is open on ${DAY_LABEL[day]}. Set their opening hours in the library.`}
          </p>
        </div>
      ) : (
        <div className="card table-card">
          {/* The scroll container must not be the padded card, or rows scroll through
              its padding above the sticky header. */}
          <div className="table-wrap board">
          {/*
            How many columns follow the frozen location column, so the stylesheet can size
            the table from the grid.

            The columns are fixed widths, not content-driven: a location column that grew
            for one long shop name, or an hour column that widened because three people
            were in it, made every other column shift underneath the frozen header as you
            worked. Sizing has to be a property of the grid, not of what is in it.
          */}
          <table style={{ '--cols': slots.length } as CSSProperties}>
            <thead>
              <tr>
                <th className="loc">Location</th>
                {slots.map((slot) => (
                  <th className="slot" key={slot.id}>
                    {slot.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleLocations.map((location) => (
                <tr
                  key={location.id}
                  style={
                    highlightedLocations.has(location.id)
                      ? { outline: '2px solid var(--accent)' }
                      : undefined
                  }
                >
                  <td>
                    <div className="locname">
                      <LocationLink name={location.name} locationId={location.id} />
                    </div>
                    <div className="small muted">
                      priority {location.priority}
                      {location.comments ? ` · ${location.comments}` : ''}
                    </div>
                  </td>
                  {slots.map((slot) => {
                    const open = isOpenDuring(location.openHours[day], slot)
                    // "Closed" and "nobody recorded it" look the same on screen but are
                    // not the same fact. Only a recorded decision — a range this hour falls
                    // outside of, or an explicit closed-all-day — withholds the picker;
                    // blocking a location whose hours were never entered would make it
                    // unschedulable for no good reason.
                    const hoursKnown = isHoursRecorded(location.openHours, day)
                    const overridden = overrides.has(`${slot.id}::${location.id}`)
                    const blocked = !open && hoursKnown && !overridden
                    const placed = bySlotAndLocation.get(`${slot.id}::${location.id}`) ?? []
                    const free = freeBySlot.get(slot.id) ?? 0

                    return (
                      <td
                        key={slot.id}
                        className={`cell${open ? '' : ' closed'}`}
                        title={
                          open
                            ? undefined
                            : hoursKnown
                              ? `${location.name} is closed at this hour`
                              : `No opening hours recorded for ${location.name} on ${DAY_LABEL[day]}`
                        }
                      >
                        {placed.map((a) => {
                          const person = personById.get(a.personId)
                          return (
                            <div
                              key={a.id}
                              className={`chip ${a.status}`}
                              style={
                                highlightedAssignments.has(a.id)
                                  ? { outline: '2px solid var(--accent)' }
                                  : undefined
                              }
                            >
                              <span>
                                {/* The board is where a name is read most, so it is where
                                    somebody most often wants the rest of the story. */}
                                <PersonLink person={person} personId={a.personId} />{' '}
                                {person && <SectionPill section={person.section} />}
                              </span>
                              <button
                                className="x"
                                title="Remove from this shift"
                                onClick={() => remove(a.id)}
                              >
                                ×
                              </button>
                            </div>
                          )
                        })}
                        {blocked ? (
                          <button
                            className="tiny ghost"
                            style={{ width: '100%', color: 'var(--muted)' }}
                            title={`${location.name} is closed at this hour. Staff it anyway?`}
                            onClick={() => allowClosed(slot.id, location.id)}
                          >
                            closed · staff anyway
                          </button>
                        ) : (
                          <button
                            className="cell-add"
                            aria-label={`Add someone to ${location.name} at ${slot.label}`}
                            aria-haspopup="dialog"
                            title={`${free} signed up and free for this hour`}
                            onClick={(e) =>
                              setPicking({
                                slot,
                                locationId: location.id,
                                anchor: e.currentTarget.getBoundingClientRect(),
                              })
                            }
                          >
                            {overridden ? '+ add (closed)…' : '+ add…'}
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {hiddenLocations.length > 0 && (
        // Not a warning — a closed location is unremarkable. Just the way back, for a
        // location whose hours have not been recorded yet and cannot otherwise be staffed
        // from here. Outside the table branch on purpose: with every location hidden there
        // is no table, and the control would be unreachable exactly when it is needed most.
        <p className="small muted">
          {hiddenLocations.length} closed or unset for {DAY_LABEL[day]}.{' '}
          <button className="tiny" onClick={() => setShowAllLocations((v) => !v)}>
            {showAllLocations ? 'Hide them' : 'Show them'}
          </button>
        </p>
      )}

    </div>
  )
}
