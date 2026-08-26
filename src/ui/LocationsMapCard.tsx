import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { describeUnplaced, planMap } from '../domain/geo'
import { LocationLink } from './LocationLink'
import type { Location, ScheduledLocation } from '../domain/types'
import { describeEstimate, lookupAll } from '../lib/geocode'
import { saveLocationPosition, useBaseLocation } from '../lib/repo'
import { useEvent } from '../lib/eventContext'
import { Modal } from './Modal'

/**
 * Where this year's shops actually are.
 *
 * The table answers "which shops, in what order"; this answers "and where are they in
 * relation to each other and to base" — the question behind whether one person can cover
 * two of them, and whether base is anywhere sensible.
 *
 * In a dialog rather than inline, for the same reason the single-location map is: the
 * locations screen gives its whole height to the table and scrolls it internally, so a tall
 * card above it takes space nothing can scroll past. A dialog also gives a map the room it
 * wants, and matches how looking at one place already works.
 *
 * The card left behind is the count and the way in. Nothing is fetched until it is opened —
 * tiles are a request to somebody else's servers, and they should not fire because a screen
 * was passed through on the way to another.
 */

// Leaflet and its stylesheet are ~45KB gzipped, for a view most visits never open. Kept out
// of the screen's own chunk so the cost lands on the press, not the page.
const LocationsMap = lazy(() =>
  import('./LocationsMap').then((m) => ({ default: m.LocationsMap })),
)

export function LocationsMapCard({
  locations,
  mayEdit,
}: {
  /** This year's locations, already narrowed to the ones it is using. */
  locations: ScheduledLocation[]
  mayEdit: boolean
}): ReactNode {
  const { pathFor } = useEvent()
  const base = useBaseLocation()

  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /*
    Which shop is being pointed at, in either view.

    Held here rather than in the map or the list, because it belongs to neither: it is the
    thread between them. A numbered pin only answers "which of these is Market Square" if
    you go hunting for the number, and a list of nineteen names says nothing about where
    any of them is.
  */
  const [pointedAt, setPointedAt] = useState<string | null>(null)

  /*
    Every way out of the dialog goes through here.

    There are four — the ✕, the button in the foot, Escape and the backdrop — and three of
    them arrive as the dialog's own `onClose`. The fourth used to set `open` directly and so
    skipped everything else this does, which meant closing by the button left a shop still
    lit and the dialog reopened highlighting something nobody was pointing at.
  */
  const close = (): void => {
    setPointedAt(null)
    setOpen(false)
  }
  // Read by the run rather than passed to it, so pressing Stop is felt on the next lookup
  // instead of only after the whole list.
  const stopped = useRef(false)

  const plan = useMemo(() => planMap(locations, base.data), [locations, base.data])

  const missing = describeUnplaced(plan)

  /**
   * Look up the shops that have an address and no position.
   *
   * Only those: a shop already placed is not asked about again, which is what keeps a
   * second press from being a second run against a free service.
   */
  const findThem = async (): Promise<void> => {
    const todo: Location[] = plan.lookupPending
    if (todo.length === 0) return

    stopped.current = false
    setRunning(true)
    setNote(null)
    setProgress({ done: 0, total: todo.length })

    const outcomes = await lookupAll(
      todo,
      async ({ location, found }) => {
        if (found) await saveLocationPosition(location.id, { lat: found.lat, lng: found.lng })
      },
      (done, total) => setProgress({ done, total }),
      () => stopped.current,
    )

    const placed = outcomes.filter((o) => o.found).length
    const failed = outcomes.filter((o) => !o.found)
    setRunning(false)
    setProgress(null)

    const said = [`Placed ${placed} of ${outcomes.length}.`]
    if (failed.length > 0) {
      said.push(
        `Not found: ${failed.map((o) => o.location.name).join(', ')}. Check the address ` +
          'on each, then look them up again.',
      )
    }
    if (stopped.current && outcomes.length < todo.length) {
      said.push(`Stopped — ${todo.length - outcomes.length} not tried.`)
    }
    setNote(said.join(' '))
  }

  return (
    <>
      <div className="card">
        <div
          className="row"
          style={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div>
            <strong>Map</strong>{' '}
            <span className="small muted">
              {plan.placed.length} of {locations.length} placed
              {missing.length > 0 && ` — ${missing.join(', ')}`}
            </span>
          </div>
          <button onClick={() => setOpen(true)}>Show the map</button>
        </div>
      </div>

      {open && (
        <Modal
          title={`${locations.length} locations`}
          onClose={close}
          footer={
            <>
              {mayEdit && plan.lookupPending.length > 0 && !running && (
                <button className="primary" onClick={() => void findThem()}>
                  {/*
                    The wait is said before the press, not discovered during it. Addresses go
                    one a second to OpenStreetMap's free geocoder, which is what its usage
                    policy asks — so a button that sits there for twenty seconds unannounced
                    reads as broken.
                  */}
                  Look up {plan.lookupPending.length} ({describeEstimate(
                    plan.lookupPending.length,
                  )})
                </button>
              )}
              {running && (
                <button
                  onClick={() => {
                    stopped.current = true
                  }}
                >
                  Stop
                </button>
              )}
              <button onClick={close}>Close</button>
            </>
          }
        >
          <div className="stack">
            {plan.bounds ? (
              <Suspense fallback={<div className="locations-map" aria-busy="true" />}>
                <LocationsMap
                  places={plan.placed}
                  base={plan.base}
                  bounds={plan.bounds}
                  hrefFor={(id) => pathFor(`location/${id}`)}
                  highlighted={pointedAt}
                  onHighlight={setPointedAt}
                />
              </Suspense>
            ) : (
              <p className="muted">
                None of this year&apos;s shops have been placed yet, so there is nothing to
                draw.
              </p>
            )}

            {running && (
              <p className="small muted" style={{ margin: 0 }}>
                Looking up {progress ? `${progress.done} of ${progress.total}` : '…'}, one a
                second.
              </p>
            )}

            {note && <p className="small">{note}</p>}

            {/*
              Base sits above the numbered list and outside it. It is where volunteers
              report and jars are counted, not somewhere anybody is scheduled — so it has a
              star on the map and a star here, and no number in either place.
            */}
            {plan.base && (
              <p
                className={`small map-key-base${pointedAt === plan.base.id ? ' on' : ''}`}
                onMouseEnter={() => setPointedAt(plan.base!.id)}
                onMouseLeave={() => setPointedAt(null)}
                onFocus={() => setPointedAt(plan.base!.id)}
                onBlur={() => setPointedAt(null)}
              >
                <span aria-hidden="true">★</span>{' '}
                <LocationLink name={plan.base.name} locationId={plan.base.id} />{' '}
                <span className="muted">— base of operations</span>
              </p>
            )}

            {plan.placed.length > 0 && (
              <ol className="small map-key">
                {plan.placed.map((place) => (
                  <li
                    key={place.id}
                    className={pointedAt === place.id ? 'on' : undefined}
                    onMouseEnter={() => setPointedAt(place.id)}
                    onMouseLeave={() => setPointedAt(null)}
                    /*
                      Focus as well as hover, and on the row rather than the link inside it.
                      Tabbing through nineteen shop names with the map staying still is the
                      same list it was before, and a touch screen has no hover at all — this
                      is the only way either of them reaches the map.
                    */
                    onFocus={() => setPointedAt(place.id)}
                    onBlur={() => setPointedAt(null)}
                  >
                    <LocationLink name={place.name} locationId={place.id} />
                  </li>
                ))}
              </ol>
            )}

            {missing.length > 0 && (
              <p className="small muted" style={{ margin: 0 }}>
                {missing.join(', ')}. A shop with no address needs one before it can be
                placed.
              </p>
            )}

            <p className="small muted" style={{ margin: 0 }}>
              Positions come from each shop&apos;s address, through OpenStreetMap. Only
              organizers see this — a volunteer&apos;s pass never names where anybody is
              going until they have reported to base.
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
