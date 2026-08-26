import { useMemo, useState } from 'react'

import { requestSummary, waiting } from '../domain/requests'
import type { VolunteerRequest } from '../domain/requests'
import { DAY_LABEL } from '../domain/slots'
import { DAYS, fullName } from '../domain/types'
import type { Person } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import {
  markRequestHandled,
  setAssignmentStatusMany,
  useAssignments,
  useLocations,
  usePasses,
  usePeople,
  useVolunteerRequests,
} from '../lib/repo'
import type { RequestSubject } from '../lib/repo'
import { useSession } from '../lib/session'

/**
 * What a volunteer asked for, and what to do about it.
 *
 * The single place that knows how to read a request, show it and act on one. Three screens
 * point at these and a fourth works through them; two copies of "take them off every shift
 * they have left" would be two chances to get it wrong.
 *
 * A request is closed, never deleted. Somebody who wrote in and was told "sorry, we could
 * not cover it" should still be findable afterwards.
 */

export interface RequestShift {
  assignment: { id: string; slotId: string; status: string }
  when: string
  locationName: string
  /** Already marked absent, so there is nothing to take them off. */
  absent: boolean
  /** The shift the volunteer named, when they named one. */
  named: boolean
}

export interface RequestDetail {
  request: VolunteerRequest
  person: Person | null
  shifts: RequestShift[]
  /** Shifts they are still expected on — what "mark them off" would act on. */
  standing: RequestShift[]
  /** The one they named, written out. */
  namedWhen: string | null
}

export interface RequestActions {
  loading: boolean
  /** Still waiting on somebody, oldest first. */
  open: VolunteerRequest[]
  /** Dealt with, most recent first. */
  closed: VolunteerRequest[]
  error: string | null
  busy: string | null
  /** Everything needed to show one request in full. */
  detail: (request: VolunteerRequest) => RequestDetail
  /** Take somebody off some of their shifts; `alsoClose` finishes the request too. */
  markAbsent: (request: VolunteerRequest, assignmentIds: string[], alsoClose: boolean) => void
  /** Mark it dealt with, without changing the board. */
  close: (request: VolunteerRequest) => void
}

export function useRequestActions(): RequestActions {
  const { event, slots } = useEvent()
  const { user } = useSession()
  const requests = useVolunteerRequests()
  const passes = usePasses()
  const people = usePeople()
  const assignments = useAssignments()
  const locations = useLocations()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = useMemo(() => waiting(requests.data), [requests.data])
  const closed = useMemo(
    () =>
      requests.data
        .filter((r) => r.handledAt !== null)
        .sort((a, b) => (b.handledAt ?? 0) - (a.handledAt ?? 0)),
    [requests.data],
  )

  const detail = (request: VolunteerRequest): RequestDetail => {
    // Who sent it, joined through the pass the volunteer holds.
    const personId = passes.data.find((p) => p.token === request.passToken)?.personId
    const person = personId ? (people.data.find((p) => p.id === personId) ?? null) : null

    const slotById = new Map(slots.map((slot) => [slot.id, slot]))
    const locationById = new Map(locations.data.map((l) => [l.id, l]))

    /*
      Every shift they are on, named the way the board names them.

      "2 shifts on the board" was not enough to act on: an organizer could not tell whether
      the Friday evening or the Saturday morning was the problem, or which location would be
      left short.
    */
    const shifts: RequestShift[] = !person
      ? []
      : assignments.data
          .filter((a) => a.personId === person.id && a.status !== 'swapped')
          .map((a) => {
            const slot = slotById.get(a.slotId)
            return {
              assignment: { id: a.id, slotId: a.slotId, status: a.status },
              when: slot ? `${DAY_LABEL[slot.day]} ${slot.label}` : a.slotId,
              locationName: locationById.get(a.locationId)?.name ?? a.locationId,
              absent: a.status === 'noShow',
              named: a.slotId === request.slotId,
              sortDay: DAYS.indexOf(slot?.day ?? 'sun'),
              sortMin: slot?.startMin ?? 0,
            }
          })
          .sort((x, y) => x.sortDay - y.sortDay || x.sortMin - y.sortMin)
          .map(({ sortDay: _d, sortMin: _m, ...rest }) => rest)

    return {
      request,
      person,
      shifts,
      standing: shifts.filter((sh) => !sh.absent),
      namedWhen: shifts.find((sh) => sh.named)?.when ?? null,
    }
  }

  /*
    What the log has to say about a request, which the request document cannot say itself:
    it holds a pass token, not a person. The screen has already resolved that to show the
    card, so it is passed down rather than read a second time.
  */
  const subjectOf = (request: VolunteerRequest): RequestSubject => {
    const d = detail(request)
    return {
      personId: d.person?.id ?? '',
      slotId: request.slotId,
      what: requestHeadline(d),
    }
  }

  const close = (request: VolunteerRequest): void => {
    if (!event) return
    setError(null)
    setBusy(request.id)
    void markRequestHandled(event.id, request.id, user?.uid ?? 'unknown', subjectOf(request))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null))
  }

  const markAbsent = (
    request: VolunteerRequest,
    assignmentIds: string[],
    alsoClose: boolean,
  ): void => {
    if (!event || assignmentIds.length === 0) return
    setError(null)
    setBusy(request.id)
    // The board write comes first: if it fails the request stays in the queue, rather than
    // disappearing while the person is still on the schedule.
    void setAssignmentStatusMany(event.id, assignmentIds, 'noShow')
      .then(() =>
        alsoClose
          ? markRequestHandled(event.id, request.id, user?.uid ?? 'unknown', subjectOf(request))
          : undefined,
      )
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null))
  }

  return { loading: requests.loading, open, closed, error, busy, detail, markAbsent, close }
}

/** How a request reads in one line: "Edsger Dijkstra cannot make it — Sat 9:00 AM". */
export function requestHeadline(detail: RequestDetail): string {
  const who = detail.person ? fullName(detail.person) : 'Somebody'
  const what = requestSummary(detail.request.kind)
  if (detail.namedWhen) return `${who} ${what} — ${detail.namedWhen}`
  if (detail.request.slotId === '' && detail.shifts.length > 1) {
    return `${who} ${what} — all their shifts`
  }
  return `${who} ${what}`
}
