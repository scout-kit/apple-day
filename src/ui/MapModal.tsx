import type { ReactNode } from 'react'
import { mapDirectionsUrl, mapEmbedUrl, safeMapUrl } from '../domain/maps'
import { Modal } from './Modal'

interface Place {
  name: string
  address: string
  mapsUrl: string
  /** The location's standing instructions, when the caller has them. */
  comments?: string
}

/**
 * Where a location is, and how to get there from base.
 *
 * Shown in a modal rather than opening a tab because the person asking is mid-shift-change
 * at the table with a queue behind them: they want to glance, point, and carry on. The
 * link out is there for the volunteer who wants it on their own phone.
 */
export function MapModal({
  place,
  base,
  onClose,
  fromBase = false,
}: {
  place: Place
  base: Place | null
  onClose: () => void
  /**
   * Whether this is being asked as "how do we get there from base".
   *
   * On the day it is: somebody is being sent out and the answer is a route. Everywhere
   * else the question is just "where is this", and a missing base is not a shortcoming —
   * it said "no base of operations is set for this event, so this is just the location" on
   * a location's own page, inside an event that has one, which is both untrue and beside
   * the point.
   */
  fromBase?: boolean
}): ReactNode {
  const embed = mapEmbedUrl(place, base)
  const out = mapDirectionsUrl(place, base)

  return (
    <Modal
      title={place.name}
      onClose={onClose}
      footer={
        <>
          {out && (
            <a className="btn" href={out} target="_blank" rel="noreferrer">
              Open in Google Maps
            </a>
          )}
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="stack">
        {place.address && <p className="small muted">{place.address}</p>}
        {/*
          The standing instructions, on the screen they are needed on.

          This modal is what an organizer opens while sending somebody out on the day, and
          "outside on the sidewalk, do not block the doors" is exactly what has to be said
          then. It was on the location's own page and on the volunteer's pass, neither of
          which is open at the table. Not muted, because it is an instruction.
        */}
        {place.comments && <p className="small">{place.comments}</p>}
        {base ? (
          <p className="small muted">
            Directions from <strong>{base.name}</strong>.
          </p>
        ) : (
          fromBase && (
            <p className="small muted">
              No base of operations is set for this event, so this is just the location. Set
              one on the event to get directions.
            </p>
          )
        )}
        {embed ? (
          <div className="map-frame">
            <iframe
              title={`Map of ${place.name}`}
              src={embed}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        ) : (
          <p className="muted">
            This location has no address recorded, so there is nothing to map.{' '}
            {/* The usable link, not the raw field: one that is not `https:` is not offered
                at all, rather than offered and then quietly swapped for something else. */}
            {safeMapUrl(place.mapsUrl) && (
              <a href={safeMapUrl(place.mapsUrl)} target="_blank" rel="noreferrer">
                It does have a saved link.
              </a>
            )}
          </p>
        )}
      </div>
    </Modal>
  )
}
