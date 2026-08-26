import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { locationMetrics } from '../domain/metrics'
import { eventLabel } from '../domain/events'
import { nudgeItem, reorderByDrop } from '../domain/ordering'
import { DAY_SHORT, formatOpenRange, isHoursRecorded, isOpenDuring } from '../domain/slots'
import { DAYS } from '../domain/types'
import type { ScheduledLocation } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import { canEditLibrary, useSession } from '../lib/session'
import {
  addLocationsToEvent,
  removeEventLocation,
  reorderEventLocations,
  saveEventLocation,
  useAssignments,
  useEventLocations,
  useJars,
  useLocationLibrary,
  useLocations,
} from '../lib/repo'
import { LocationLink } from './LocationLink'
import { ErrorNote, Hours, Loading, Money } from './Bits'
import { LocationsMapCard } from './LocationsMapCard'
import { Modal } from './Modal'

/**
 * This year's locations: which of the library's places we are using, in what order.
 *
 * The active switch is right on the row because that is the actual job when a new year
 * starts — copy last year's list, then run down it turning off whatever closed or is not
 * worth it. Making that a trip through an edit form each time is what made it tedious.
 */
export function LocationsScreen(): ReactNode {
  const { role } = useSession()
  // An organizer reads this screen; changing which locations the year uses is an admin's.
  // Which shops this year uses is this year's schedule, made by whoever builds it.
  const mayEdit = canEditLibrary(role)
  const { event, slots } = useEvent()
  const library = useLocationLibrary()
  const settings = useEventLocations()
  const locations = useLocations()
  const assignments = useAssignments()
  const jars = useJars()

  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; below: boolean } | null>(null)
  const [writeError, setWriteError] = useState<Error | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<ScheduledLocation | null>(null)

  const eventDays = useMemo(
    () => DAYS.filter((d) => slots.some((s) => s.day === d)),
    [slots],
  )

  const metrics = useMemo(
    () => locationMetrics(locations.data, assignments.data, jars.data, slots),
    [locations.data, assignments.data, jars.data, slots],
  )
  const metricsById = useMemo(() => {
    const map = new Map<string, { revenue: number; hours: number; perHour: number | null }>()
    for (const row of [...metrics.ranked, ...metrics.revenueWithoutHours]) {
      map.set(row.locationId, {
        revenue: row.revenue,
        hours: row.staffedHours,
        perHour: row.revenuePerHour,
      })
    }
    return map
  }, [metrics])

  const inYearIds = useMemo(
    () => new Set(settings.data.map((s) => s.locationId)),
    [settings.data],
  )

  const available = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return library.data
      .filter((l) => !inYearIds.has(l.id))
      .filter((l) => !q || l.name.toLowerCase().includes(q) || l.address.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [library.data, inYearIds, filter])

  const nextPriority = useMemo(
    () => settings.data.reduce((max, s) => Math.max(max, s.priority), 0) + 1,
    [settings.data],
  )

  const setActive = async (locationId: string, active: boolean): Promise<void> => {
    if (!event) return
    const current = settings.data.find((s) => s.locationId === locationId)
    setBusy(locationId)
    try {
      await saveEventLocation(event.id, locationId, {
        active,
        priority: current?.priority ?? nextPriority,
      })
    } finally {
      setBusy(null)
    }
  }

  /**
   * Move a location to a new position and renumber the whole list.
   *
   * Order is the working order for the day, so it gets dragged around a lot; renumbering
   * from the resulting sequence keeps it dense instead of accumulating ties and gaps.
   */
  const applyOrder = (order: string[]): void => {
    if (!event) return
    const current = locations.data.map((l) => l.id)
    if (order.join() === current.join()) return

    setWriteError(null)
    void reorderEventLocations(event.id, order).catch((error: Error) =>
      setWriteError(error),
    )
  }

  const nudge = (locationId: string, delta: number): void =>
    applyOrder(nudgeItem(locations.data.map((l) => l.id), locationId, delta))

  /** Drop the dragged row above or below the row it was released on. */
  const completeDrop = (targetId: string, below: boolean): void => {
    const dragged = dragId
    setDragId(null)
    setDropTarget(null)
    if (!dragged) return
    applyOrder(reorderByDrop(locations.data.map((l) => l.id), dragged, targetId, below))
  }

  const remove = (locationId: string): void => {
    if (!event) return
    setConfirmRemove(null)
    setWriteError(null)
    void removeEventLocation(event.id, locationId).catch((error: Error) =>
      setWriteError(error),
    )
  }

  /** What removing a location from this year would leave behind. */
  const strandedBy = (locationId: string): { shifts: number; jars: number } => ({
    shifts: assignments.data.filter(
      (a) => a.locationId === locationId && a.status !== 'swapped',
    ).length,
    jars: jars.data.filter((j) => j.locationId === locationId).length,
  })

  const addPicked = async (): Promise<void> => {
    if (!event || picked.size === 0) return
    await addLocationsToEvent(event.id, [...picked], nextPriority)
    setPicked(new Set())
    setAdding(false)
  }

  if (!event) {
    return (
      <div className="card">
        <h1>No year selected</h1>
        <p>Create or select an Apple Day on the Years screen first.</p>
      </div>
    )
  }

  if (library.loading || settings.loading) return <Loading what="Loading locations" />

  const activeCount = locations.data.filter((l) => l.active).length

  return (
    <div className="fill">
      <ErrorNote error={writeError ?? library.error ?? settings.error} />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>{eventLabel(event)} locations</h1>
            <p className="small muted" style={{ margin: 0 }}>
              {activeCount} on, {locations.data.length - activeCount} off, out of{' '}
              {library.data.length} in the library.
            </p>
          </div>
          {mayEdit && (
            <button className="primary" onClick={() => setAdding(true)}>
              Add from library
            </button>
          )}
        </div>
      </div>

      {/*
        Under the header and above the table, because it answers a question about the list
        as a whole rather than about any row in it. Only when there is a list.
      */}
      {locations.data.length > 0 && (
        <LocationsMapCard
          locations={locations.data.filter((l) => l.active)}
          mayEdit={mayEdit}
        />
      )}

      {locations.data.length === 0 ? (
        <div className="card">
          <p className="muted">
            No locations in {eventLabel(event)} yet. Add them from the library — or when creating a
            year, copy the previous year's list and switch off what is not happening.
          </p>
        </div>
      ) : (
        <div className="card table-card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '3rem' }}>On</th>
                  <th style={{ width: '5.5rem' }}>Order</th>
                  <th>Location</th>
                  <th>Open</th>
                  <th className="right">Revenue</th>
                  <th className="right">Hours</th>
                  <th className="right">Per hour</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {locations.data.map((loc, index) => {
                  const m = metricsById.get(loc.id)
                  // How many of this year's slots the location is actually open for —
                  // a location that is open for none of them can never be staffed.
                  const staffable = slots.filter((s) =>
                    isOpenDuring(loc.openHours[s.day], s),
                  ).length
                  return (
                    <tr
                      key={loc.id}
                      className={[
                        loc.active ? '' : 'inactive',
                        dragId === loc.id ? 'dragging' : '',
                        dropTarget?.id === loc.id
                          ? dropTarget.below
                            ? 'drop-below'
                            : 'drop-above'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onDragOver={(e) => {
                        if (!dragId) return
                        // Without this the browser refuses the drop.
                        e.preventDefault()
                        const box = e.currentTarget.getBoundingClientRect()
                        setDropTarget({
                          id: loc.id,
                          below: e.clientY > box.top + box.height / 2,
                        })
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        // Read the side from this event rather than from the state the
                        // last dragOver set: that state may be a render behind, which
                        // silently drops the row on the wrong side of the target.
                        const box = e.currentTarget.getBoundingClientRect()
                        completeDrop(loc.id, e.clientY > box.top + box.height / 2)
                      }}
                    >
                      <td>
                        <input
                          type="checkbox"
                          className="switch"
                          checked={loc.active}
                          disabled={!mayEdit || busy === loc.id}
                          aria-label={`Use ${loc.name} in ${eventLabel(event)}`}
                          onChange={(e) => void setActive(loc.id, e.target.checked)}
                        />
                      </td>
                      <td className="order-cell">
                        {mayEdit && (
                          <button
                            className="drag-handle"
                            draggable
                          aria-label={`Reorder ${loc.name}`}
                          title="Drag to reorder"
                          onDragStart={(e) => {
                            setDragId(loc.id)
                            e.dataTransfer.effectAllowed = 'move'
                            // Firefox will not start a drag without payload.
                            e.dataTransfer.setData('text/plain', loc.id)
                          }}
                          onDragEnd={() => {
                            setDragId(null)
                            setDropTarget(null)
                          }}
                          >
                            ⠿
                          </button>
                        )}
                        <span className="pos">{loc.priority}</span>
                        {/* Dragging works with neither a keyboard nor a touchscreen, so
                            the same move is always available as a pair of buttons. */}
                        {mayEdit && (
                          <>
                            <button
                              className="nudge"
                              aria-label={`Move ${loc.name} up`}
                              disabled={index === 0}
                              onClick={() => nudge(loc.id, -1)}
                            >
                              ▲
                            </button>
                            <button
                              className="nudge"
                              aria-label={`Move ${loc.name} down`}
                              disabled={index === locations.data.length - 1}
                              onClick={() => nudge(loc.id, 1)}
                            >
                              ▼
                            </button>
                          </>
                        )}
                      </td>
                      <td>
                        <div>
                          <LocationLink name={loc.name} locationId={loc.id} />
                        </div>
                        <div className="small muted">
                          {loc.address}
                          {staffable === 0 && (
                            <span style={{ color: 'var(--warn)' }}>
                              {loc.address ? ' · ' : ''}open for none of this year's hours
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="small">
                        {/* Only the days this year runs — the rest are noise here. */}
                        {eventDays.length === 0 ? (
                          <span className="muted">no days set</span>
                        ) : (
                          eventDays.map((d) => (
                            <div key={d} className="nowrap">
                              {DAY_SHORT[d]}{' '}
                              {isHoursRecorded(loc.openHours, d) ? (
                                formatOpenRange(loc.openHours[d])
                              ) : (
                                <span className="muted">not set</span>
                              )}
                            </div>
                          ))
                        )}
                      </td>
                      <td className="right">
                        <Money value={m?.revenue ?? 0} />
                      </td>
                      <td className="right">
                        <Hours value={m?.hours ?? 0} />
                      </td>
                      <td className="right">
                        <Money value={m?.perHour ?? null} />
                      </td>
                      <td>
                        {mayEdit && (
                          <button
                            className="tiny"
                            disabled={busy === loc.id}
                            title={`Remove from ${eventLabel(event)} (keeps it in the library)`}
                            onClick={() => setConfirmRemove(loc)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: '0.5rem' }}>
            {mayEdit && 'Drag the handle to reorder, or use the arrows. '}
            Order is this year&apos;s working priority — the board and the day-of view follow
            it.{' '}
            {mayEdit &&
              "Switching a location off leaves its history intact and takes it off this " +
                "year's board. Edit a location's address, hours or contact in the library — " +
                'those are shared by every year.'}
          </p>
        </div>
      )}

      {confirmRemove &&
        (() => {
          const { shifts, jars: jarCount } = strandedBy(confirmRemove.id)
          return (
            <Modal
              title={`Remove ${confirmRemove.name} from ${eventLabel(event)}?`}
              onClose={() => setConfirmRemove(null)}
              footer={
                <>
                  <button onClick={() => setConfirmRemove(null)}>Cancel</button>
                  <button className="danger" onClick={() => remove(confirmRemove.id)}>
                    Remove from {eventLabel(event)}
                  </button>
                </>
              }
            >
              <div className="stack">
                <p>
                  It stays in the library with its address, hours and contact, and every past
                  year keeps its records. This only takes it out of {eventLabel(event)}.
                </p>

                {shifts > 0 || jarCount > 0 ? (
                  <div className="note warning">
                    {shifts > 0 && (
                      <div>
                        {shifts} shift{shifts === 1 ? '' : 's'} {shifts === 1 ? 'is' : 'are'}{' '}
                        scheduled here. {shifts === 1 ? 'It' : 'They'} will not be deleted, but
                        with the location gone from the year the board flags{' '}
                        {shifts === 1 ? 'it' : 'them'} as pointing at something missing.
                      </div>
                    )}
                    {jarCount > 0 && (
                      <div>
                        {jarCount} jar{jarCount === 1 ? '' : 's'} recorded here. The money stays
                        recorded but stops appearing under a named location.
                      </div>
                    )}
                    <div className="small" style={{ marginTop: '0.3rem' }}>
                      Switching it off instead keeps all of that intact and takes it off the
                      board.
                    </div>
                  </div>
                ) : (
                  <p className="small muted">
                    Nothing is scheduled or recorded here, so nothing is left behind.
                  </p>
                )}
              </div>
            </Modal>
          )
        })()}

      {adding && (
        <Modal
          title={`Add locations to ${eventLabel(event)}`}
          onClose={() => setAdding(false)}
          footer={
            <>
              <button onClick={() => setAdding(false)}>Cancel</button>
              <button
                className="primary"
                disabled={picked.size === 0}
                onClick={() => void addPicked()}
              >
                Add {picked.size > 0 ? picked.size : ''}
              </button>
            </>
          }
        >
          <input
            placeholder="Search the library…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ width: '100%', marginBottom: '0.6rem' }}
          />
          {available.length === 0 ? (
            <p className="muted">
              {library.data.length === inYearIds.size
                ? 'Every library location is already in this year.'
                : 'Nothing matches that search.'}
            </p>
          ) : (
            <div className="stack">
              {available.map((loc) => (
                <label key={loc.id} className="row" style={{ gap: '0.5rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={picked.has(loc.id)}
                    style={{ width: 'auto' }}
                    onChange={() =>
                      setPicked((current) => {
                        const next = new Set(current)
                        if (next.has(loc.id)) next.delete(loc.id)
                        else next.add(loc.id)
                        return next
                      })
                    }
                  />
                  <span style={{ flex: 1 }}>
                    {loc.name}
                    <span className="small muted">
                      {loc.address ? ` · ${loc.address}` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
