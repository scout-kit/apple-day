import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DAY_SHORT, formatOpenRange, isHoursRecorded, isOpenOn } from '../domain/slots'
import { eventLabel } from '../domain/events'
import { DAYS } from '../domain/types'
import type { Day, Location } from '../domain/types'
import { useEventLocations, useLocationLibrary } from '../lib/repo'
import { useEvent } from '../lib/eventContext'
import { addLocationsToEvent } from '../lib/repo'
import { LocationLink } from './LocationLink'
import { ErrorNote, Loading } from './Bits'
import { LocationEditor } from './LocationEditor'

const blank = (): Location => ({
  id: '',
  name: '',
  address: '',
  mapsUrl: '',
  lat: null,
  lng: null,
  groupCode: '',
  siteContact: null,
  insurance: '',
  comments: '',
  openHours: {},
  aliases: [],
})

/** The days a place opens, in week order — what the list is asked to show. */
const openDays = (loc: Location): Day[] =>
  DAYS.filter((d) => isOpenOn(loc.openHours, d))


/**
 * The global location library — every place the group has ever used.
 *
 * These records are facts about real places and are shared by every year: the address, the
 * store's actual opening hours, who to ask for, and every historical spelling of the name
 * so year-over-year totals collapse onto one row instead of splitting.
 *
 * Whether a year is *using* a location, and in what order, is not here — that belongs to
 * the year, on the Locations screen.
 */
export function LibraryScreen(): ReactNode {
  const { event } = useEvent()
  const library = useLocationLibrary()
  const inYear = useEventLocations()

  /*
    Held for adding only.

    A location that already exists is edited on its own page, reached by its name in the
    list. Two ways in meant two places to keep the same form working, and the list was the
    one that could not show what the edit affected — the year it is used in, the hours, the
    history — while you were editing it.
  */
  const [adding, setAdding] = useState<Location | null>(null)
  const [filter, setFilter] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const inYearIds = useMemo(
    () => new Set(inYear.data.map((s) => s.locationId)),
    [inYear.data],
  )

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return library.data
      .filter(
        (l) =>
          !q ||
          l.name.toLowerCase().includes(q) ||
          l.address.toLowerCase().includes(q) ||
          l.aliases.some((a) => a.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [library.data, filter])

  const addPicked = async (): Promise<void> => {
    if (!event || picked.size === 0) return
    const nextPriority =
      inYear.data.reduce((max, s) => Math.max(max, s.priority), 0) + 1
    await addLocationsToEvent(event.id, [...picked], nextPriority)
    setPicked(new Set())
  }

  const togglePick = (id: string): void => {
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (library.loading) return <Loading what="Loading the library" />


  return (
    <div className="fill">
      <ErrorNote error={library.error} />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>Location library</h1>
            <p className="small muted" style={{ margin: 0 }}>
              Shared by every year. {library.data.length} location
              {library.data.length === 1 ? '' : 's'}.
            </p>
          </div>
          <button className="primary" onClick={() => setAdding(blank())}>
            Add location
          </button>
        </div>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <input
            placeholder="Search name, address or past name…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: '1 1 16rem' }}
          />
          {picked.size > 0 && event && (
            <button className="primary" onClick={() => void addPicked()}>
              Add {picked.size} to {eventLabel(event)}
            </button>
          )}
        </div>
      </div>

      <div className="card table-card">
        {visible.length === 0 ? (
          <p className="muted">
            {library.data.length === 0
              ? 'The library is empty. Add a location, or run the workbook extract to import them.'
              : 'Nothing matches that search.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '2rem' }} />
                  <th>Location</th>
                  <th>Open</th>
                  <th>{event ? `In ${eventLabel(event)}` : 'In year'}</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((loc) => (
                  <tr key={loc.id}>
                    <td>
                      {!inYearIds.has(loc.id) && (
                        <input
                          type="checkbox"
                          checked={picked.has(loc.id)}
                          onChange={() => togglePick(loc.id)}
                          aria-label={`Select ${loc.name}`}
                          style={{ width: 'auto' }}
                        />
                      )}
                    </td>
                    <td>
                      <div>
                        <LocationLink name={loc.name} locationId={loc.id} />
                      </div>
                      {loc.address && <div className="small muted">{loc.address}</div>}
                      {loc.aliases.length > 0 && (
                        <div className="small muted">
                          also known as {loc.aliases.join('; ')}
                        </div>
                      )}
                    </td>
                    <td className="small">
                      {/* Only the days it opens. A closed day is still stored as an
                          explicit null — the schedule board needs to tell "shut" from
                          "nobody asked" — but listing seven rows of "closed" here buries
                          the one line somebody came to read. */}
                      {openDays(loc).length > 0 ? (
                        openDays(loc).map((d) => (
                          <div key={d} className="nowrap">
                            {DAY_SHORT[d]} {formatOpenRange(loc.openHours[d])}
                          </div>
                        ))
                      ) : (
                        <span className="muted">
                          {DAYS.some((d) => isHoursRecorded(loc.openHours, d))
                            ? 'closed all week'
                            : 'not set'}
                        </span>
                      )}
                    </td>
                    <td className="small">
                      {inYearIds.has(loc.id) ? (
                        <span style={{ color: 'var(--good)' }}>yes</span>
                      ) : (
                        <span className="muted">no</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {adding && <LocationEditor location={adding} onClose={() => setAdding(null)} />}
    </div>
  )
}
