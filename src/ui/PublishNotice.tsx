import { useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { mapLink } from '../domain/maps'
import { publishStatus, publishedFingerprint } from '../domain/publishing'
import type { PublishInput, PublishStatus } from '../domain/publishing'
import { useEvent } from '../lib/eventContext'
import {
  recordPublishFingerprint,
  useAssignments,
  useBaseLocation,
  useLocations,
  usePeople,
  usePublishState,
} from '../lib/repo'

/**
 * Everything a publish would write, assembled once.
 *
 * One function, used both to publish and to decide whether what was published still
 * matches — because the two have to agree exactly and there is no way to notice that they
 * do not. They already did not, twice: publishing passed `event.slug` where the comparison
 * passed `eventLinkFor(event)`, and publishing derived the base's map link from its address
 * where the comparison read the raw field. Either alone made the two hashes differ on every
 * comparison, so the board reported itself out of date the instant it was published.
 *
 * A screen that needs extras — the existing tokens, say — spreads them over this rather
 * than building its own.
 */
export function usePublishInput(): PublishInput {
  const { event, slots } = useEvent()
  const locations = useLocations()
  const people = usePeople()
  const assignments = useAssignments()
  const base = useBaseLocation()

  return useMemo(
    () => ({
      locations: locations.data,
      people: people.data,
      assignments: assignments.data,
      slots,
      support: event?.support ?? [],
      supportNote: event?.supportNote ?? '',
      arrivalNote: event?.arrivalNote ?? '',
      base: base.data
        ? {
            name: base.data.name,
            address: base.data.address,
            /*
              Derived, not the raw field — a location with an address and no map link still
              gets one. Publishing already did this and the comparison did not, which was a
              second way for the two to disagree for ever.
            */
            mapsUrl: mapLink(base.data),
          }
        : null,
    }),
    [locations.data, people.data, assignments.data, slots, event, base.data],
  )
}

/**
 * Whether the published schedule still matches the board.
 *
 * One document. It used to be four subscriptions — every location, every person, every
 * assignment — because it worked the fingerprint out on the spot. That is fine on the
 * board, which holds all of it anyway; it was not fine in the bar, which is on all
 * seventeen screens. Opening the checklist read a few hundred documents to decide whether
 * to draw one small link.
 *
 * The board records the hash instead (see `PublishWatch`), so this compares two strings.
 */
export function usePublishStatus(): { status: PublishStatus; publishedAt: number } {
  const state = usePublishState()

  /*
    Nothing is claimed while it is still arriving.

    A half-read document would say "never published" for a moment, so a notice would flash
    on every page load and then withdraw itself — which teaches people to disregard it.
  */
  return {
    status: state.loading
      ? 'unknown'
      : publishStatus(state.data, state.data?.currentFingerprint ?? ''),
    publishedAt: state.data?.publishedAt ?? 0,
  }
}

/**
 * Records what the board currently hashes to, beside a screen that already holds the data.
 *
 * Mounted alongside the screens that subscribe to locations, people and assignments for their
 * own reasons — the board, the roster, the money, the day-of, a person, a location. That
 * is deliberate: computing the hash costs nothing extra there, and doing it anywhere else
 * would mean loading all of it just to keep a flag honest, which is the thing this is
 * getting rid of.
 *
 * It has to be more than the board alone. What a volunteer reads can be changed from a
 * corrected surname on the roster or an address in the library, and somebody who fixes a
 * phone number and goes home would never have passed the board on the way.
 */
export function PublishWatch(): ReactNode {
  const { eventId } = useEvent()
  const locations = useLocations()
  const people = usePeople()
  const assignments = useAssignments()
  const base = useBaseLocation()
  const state = usePublishState()
  const input = usePublishInput()

  const current = useMemo(() => publishedFingerprint(input), [input])

  const settled =
    !locations.loading &&
    !people.loading &&
    !assignments.loading &&
    !base.loading &&
    !state.loading

  useEffect(() => {
    // Never over half-read data: that hash is not the board's, and storing it would put a
    // re-publish notice on every other screen until somebody came back here.
    if (!settled || !eventId) return
    if (state.data?.currentFingerprint === current) return
    void recordPublishFingerprint(eventId, current).catch(() => {
      /* Bookkeeping for a flag. A screen must not fail because this did. */
    })
  }, [settled, eventId, current, state.data?.currentFingerprint])

  return null
}

const when = (at: number): string =>
  new Date(at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })

/**
 * The banner saying the board has moved on since it was published.
 *
 * Only ever appears when there is something to do about it. A schedule that has never been
 * published says nothing here — that is what the Publish screen is for — and one that
 * matches says nothing either, because a permanent "all good" is a line of screen nobody
 * reads after the first day.
 */
export function RepublishNotice({ showLink = true }: { showLink?: boolean }): ReactNode {
  const { pathFor } = useEvent()
  const { status, publishedAt } = usePublishStatus()
  if (status !== 'stale') return null

  return (
    <div className="note warning">
      <strong>What is on the passes has changed since they were published.</strong>{' '}
      Volunteers opening the link they were sent are still seeing the {when(publishedAt)}{' '}
      version. Publish again to bring them up to date — the links themselves keep working.
      {showLink && (
        <>
          {' '}
          <a className="btn tiny" href={pathFor('schedule-board')}>
            Go to the board
          </a>
        </>
      )}
    </div>
  )
}

/**
 * The same fact, in the bar, so it is not confined to the two screens that mention it.
 *
 * What a volunteer reads can be changed from more places than the board: a corrected
 * surname on the roster, an address in the library, the contacts or the arrival note on
 * the event. Somebody who fixes a phone number and goes home has changed every pass and
 * would never have passed the board on the way.
 *
 * Only ever rendered when there is something to do, so it stays worth reading — the same
 * reason the bell has no dot when nothing is waiting.
 */
export function RepublishFlag(): ReactNode {
  const { pathFor } = useEvent()
  const { status } = usePublishStatus()
  if (status !== 'stale') return null

  return (
    <NavLink
      // Publishing lives at the foot of the board now, so that is where this goes.
      to={pathFor('schedule-board')}
      className="republish-flag"
      title="What is on the passes has changed since they were published"
    >
      Re-publish
    </NavLink>
  )
}
