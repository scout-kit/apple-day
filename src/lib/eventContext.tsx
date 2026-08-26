import { onSnapshot } from 'firebase/firestore'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  buildPathFor,
  eventIdFromPath,
  eventLinkFor,
  eventPath,
  resolveEventRef,
  screenFromPath,
  sanitiseEventLink,
  slugifyEventName,
} from '../domain/eventLinks'
import { readEvent, yearFor } from '../domain/events'
import { buildAllSlots } from '../domain/slots'
import { cleanSupport } from '../domain/support'
import type { AppleDayEvent, Day, Slot } from '../domain/types'
import { auditedBatch, auditedSet } from './audit'
import { paths } from './paths'
import { runsTheEvent, useSession } from './session'

/**
 * Which year is being worked on.
 *
 * Apple Day runs once a year and the app has to hold several: last year's results are the
 * evidence for this year's location choices. So the event is a runtime selection, not a
 * build-time constant, and every year-scoped read goes through the id this provides.
 *
 * The selection lives in the URL — `/e/<event-id>/schedule-board` — so a link can be sent
 * to somebody else and open the same event. It falls back to the last one used in this
 * browser, then to the most recent, so bare paths still land somewhere sensible.
 */

const STORAGE_KEY = 'apple-day-event'

export {
  eventIdFromPath,
  eventLinkFor,
  eventLinkProblem,
  sanitiseEventLink,
  screenFromPath,
  slugifyEventName,
} from '../domain/eventLinks'
import { isFatalClientFailure } from '../domain/clientFailure'
import { recoverFromFatalFailure } from './recover'

export interface EventContextValue {
  events: AppleDayEvent[]
  /** Build a path to a screen within an event, for links and navigation. */
  pathFor: (screen: string, eventId?: string) => string
  event: AppleDayEvent | null
  eventId: string | null
  /** Slots for the selected event's own scheduling window. */
  slots: Slot[]
  loading: boolean
  error: Error | null
  select: (eventId: string) => void
  createEvent: (draft: AppleDayEvent) => Promise<string>
  saveEvent: (event: AppleDayEvent) => Promise<void>
}

const EventContext = createContext<EventContextValue>({
  events: [],
  pathFor: (screen) => `/${screen}`,
  event: null,
  eventId: null,
  slots: [],
  loading: true,
  error: null,
  select: () => {},
  createEvent: async () => '',
  saveEvent: async () => {},
})

export function EventProvider({ children }: { children: ReactNode }): ReactNode {
  const { user, role, loading: sessionLoading } = useSession()
  const location = useLocation()
  const navigate = useNavigate()
  const [events, setEvents] = useState<AppleDayEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  /** Last one used in this browser, for bare paths that name no event. */
  const [remembered, setRemembered] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  })

  const urlEventId = eventIdFromPath(location.pathname)

  /**
   * Only somebody on the roster may list events, so this waits for the session before
   * subscribing, and re-subscribes whenever who-you-are changes.
   *
   * Both halves matter. A listener started before `onAuthStateChanged` resolves is
   * evaluated with no auth and denied — and a Firestore listener that errors is finished:
   * it does not retry when the credentials arrive a moment later. That combination showed
   * the Years screen a permanent permission error on every cold load, and left the list
   * dead after an organizer grant that happened while the app was open.
   */
  /*
    Anybody who works the event needs its list.

    This said `admin` only, which meant an organizer subscribed to nothing: the picker was
    empty, no event was ever selected, and every year-scoped screen came up blank. The whole
    tier was unusable rather than merely limited.
  */
  const canListEvents = runsTheEvent(role)

  useEffect(() => {
    if (sessionLoading) return

    if (!user || !canListEvents) {
      // Signed out, or signed in without a role yet. Not an error worth showing — the
      // screens behind the auth gate explain what to do.
      setEvents([])
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    /*
      Subscribing can throw, not just fail.

      Once the SDK's work queue has failed — a corrupt offline store, a broken invariant —
      `onSnapshot` throws where it would otherwise call back. Thrown from inside this effect
      it escapes React, and because this provider wraps the whole app and nothing catches it,
      the result was a white page immediately after signing in: no error, no shell, nothing.

      The same guard the data hooks and the session already had. It was missed here, which is
      the one place where missing it costs the entire screen.
    */
    try {
      return subscribe()
    } catch (thrown) {
      const failure = thrown instanceof Error ? thrown : new Error(String(thrown))
      setEvents([])
      setLoading(false)
      setError(failure)
      if (isFatalClientFailure(failure)) void recoverFromFatalFailure(failure)
      return
    }

    function subscribe(): () => void {
      return onSnapshot(
      paths.events(),
      (snap) => {
        const rows = snap.docs
          .map((d) => readEvent(d.id, d.data() as Record<string, unknown>))
          // Newest year first: that is the one being worked on.
          /*
            Newest first. The year decides, then the day it starts on — two events in one
            year are ordered by which came second, not alphabetically. An event with no date
            recorded sorts last of its year rather than first, since an empty string would
            otherwise beat every real date.
          */
          .sort(
            (a, b) =>
              b.year - a.year ||
              (b.fridayDate || '0').localeCompare(a.fridayDate || '0') ||
              a.name.localeCompare(b.name),
          )
        setEvents(rows)
        setLoading(false)
        setError(null)
      },
      (e) => {
        setEvents([])
        setLoading(false)
        setError(e)
        // A finished client will not recover by being asked again; see `clientFailure`.
        if (isFatalClientFailure(e)) void recoverFromFatalFailure(e)
      },
      )
    }
    // Keyed on identity and role: a sign-in, a sign-out, or a fresh organizer grant all
    // have to start a new listener, because the old one cannot recover on its own.
  }, [sessionLoading, user, canListEvents])

  /**
   * A link to a screen within an event.
   *
   * Resolved through the events list so the URL carries the event's chosen link rather
   * than its document id — the point of a custom link is that it appears in the address
   * bar and in anything copied out of it. A reference that resolves to nothing is passed
   * through untouched, so a stale id still produces a navigable path.
   */
  const pathFor = useCallback(
    (screen: string, eventId?: string) => {
      /*
        The newest event, when nothing else names one — see `buildPathFor` for why the
        alternative was an infinite redirect on a blank page.
      */
      return buildPathFor(events, urlEventId ?? undefined, remembered, screen, eventId)
    },
    [events, urlEventId, remembered],
  )

  /**
   * Switch events by navigating, staying on the same screen.
   *
   * The URL is the source of truth, so this both moves the app and makes the address bar
   * something worth copying. The remembered value is only a fallback for a path that names
   * no event.
   */
  const select = useCallback(
    (eventId: string) => {
      // Remembered by document id, not by link: the id cannot change, so a remembered
      // choice survives the link being edited.
      setRemembered(eventId)
      try {
        localStorage.setItem(STORAGE_KEY, eventId)
      } catch {
        // A browser that refuses storage still works; the choice just won't persist.
      }
      // A brand new event is not in the list yet, so this falls through to its id — which
      // is right: it has no custom link until somebody gives it one.
      const found = events.find((e) => e.id === eventId)
      navigate(
        eventPath(found ? eventLinkFor(found) : eventId, screenFromPath(location.pathname)),
      )
    },
    [navigate, location.pathname, events],
  )

  const createEvent = useCallback(
    async (draft: AppleDayEvent): Promise<string> => {
      const name = draft.name.trim()
      const id = slugifyEventName(name)

      /*
        Filed against no event, unlike an edit to one.

        An entry may only name an event that exists, and at the moment this runs the event
        does not — the check would be evaluated against the database as it is before the
        write, and refusing it would refuse the whole batch and with it the event. Which is
        the honest filing anyway: starting a year is a change to the set of years, the same
        kind of thing as adding a shop to the library, not a change within one.
      */
      const batch = auditedBatch({
        action: 'created',
        entity: 'event',
        entityId: id,
        eventId: null,
        summary: `Started ${name}`,
      })
      /*
        The whole event in one write.

        Defaults written first and edited into shape afterwards would be two entries in the
        audit log for one act, with a window in between where the event exists with hours
        nobody chose.
      */
      const { id: _ignored, ...rest } = draft
      batch.set(
        paths.event(id),
        {
          ...rest,
          name,
          slug: sanitiseEventLink(draft.slug),
          support: cleanSupport(draft.support),
          createdAt: Date.now(),
        },
        // merge, so re-running this on an existing id never wipes it.
        { merge: true },
      )
      await batch.commit()
      select(id)
      return id
    },
    [select],
  )

  const saveEvent = useCallback(async (event: AppleDayEvent): Promise<void> => {
    const { id, ...rest } = event
    // The link is normalised here rather than while it is being typed, so a trailing dash
    // mid-word survives the keystroke and is tidied away once.
    const data = {
      ...rest,
      slug: rest.slug.trim() ? slugifyEventName(rest.slug) : '',
      /*
        Kept in step with the name, which nothing else does.

        `year` orders the list and groups the history, and it is set once when an event is
        created. Rename "Apple Day 2026" to "Apple Day 2025" afterwards and it still says
        2026 — so the event sorts under the wrong year and every screen titled by it says so
        out loud. A name that states its year settles it; one that does not leaves it alone.
      */
      year: yearFor(rest.name, rest.year),
      // Half-typed rows from the editor are not contacts.
      support: cleanSupport(rest.support),
    }

    /*
      Filed against the event itself, unlike its creation — it exists by now, and somebody
      looking at what changed about this year wants this in that list.

      The dates, the hours and the shift shape decide what the whole board looks like, and
      the number on the passes is what a parent rings when a child is not where they should
      be. All of it was editable with no record of who changed it, which mattered more once
      it stopped being an admin-only screen.
    */
    await auditedSet(paths.event(id), data, {
      entity: 'event',
      entityId: id,
      eventId: id,
      action: 'updated',
      summary: `Changed ${rest.name || id}`,
      fields: [
        'name',
        'slug',
        'year',
        'fridayDate',
        'saturdayDate',
        'schedule',
        'shiftMode',
        'shiftMinutes',
        'overlapMinutes',
        'baseLocationId',
        'supportNote',
        'arrivalNote',
        /*
          The support contacts, values and all.

          A judgement, and not the same one as for a youth's parents — whose phone and email
          are deliberately never recorded here. These are the organizers' own details, they
          are printed on every volunteer's pass and every QR sheet already, and "who changed
          the number on the passes, and what was it before" is exactly the question this log
          is kept to answer.
        */
        'support',
      ],
    })
  }, [])

  /**
   * The URL wins, then whatever this browser used last, then the most recent event.
   *
   * An unknown id in the URL falls through rather than showing an empty app — a link to a
   * deleted event should still land somewhere usable.
   */
  const event = useMemo(() => {
    if (events.length === 0) return null
    return (
      resolveEventRef(events, urlEventId) ??
      resolveEventRef(events, remembered) ??
      events[0] ??
      null
    )
  }, [events, urlEventId, remembered])

  const slots = useMemo(
    () =>
      event
        ? buildAllSlots(event.schedule, {
            shiftMode: event.shiftMode,
            shiftMinutes: event.shiftMinutes,
            overlapMinutes: event.overlapMinutes,
          })
        : buildAllSlots(),
    [event],
  )

  const value = useMemo(
    () => ({
      events,
      pathFor,
      event,
      eventId: event?.id ?? null,
      slots,
      loading,
      error,
      select,
      createEvent,
      saveEvent,
    }),
    [events, pathFor, event, slots, loading, error, select, createEvent, saveEvent],
  )

  return <EventContext.Provider value={value}>{children}</EventContext.Provider>
}

export const useEvent = (): EventContextValue => useContext(EventContext)

/** Slots for one day of the selected event. */
export function useDaySlots(day: Day): Slot[] {
  const { slots } = useEvent()
  return useMemo(() => slots.filter((s) => s.day === day), [slots, day])
}
