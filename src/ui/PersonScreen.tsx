import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { requestSummary } from '../domain/requests'
import { DAY_LABEL } from '../domain/slots'
import { DAYS, fullName, isCounted, isNumbered } from '../domain/types'
import type { Day } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import { runsTheEvent, useSession } from '../lib/session'
import {
  useAssignments,
  useJars,
  useLocations,
  usePasses,
  usePeople,
  useSignups,
  useVolunteerRequests,
} from '../lib/repo'
import { ErrorNote, Loading, Money, SectionPill, Stat } from './Bits'
import { PersonLink } from './PersonLink'
import { PassCard } from './PassCard'
import { PersonEditor } from './PersonEditor'

/**
 * Everything about one person, in one place.
 *
 * Every other screen answers a question about the event — who is at this location, what came
 * in this hour. This answers a question about a person, which is what somebody at the table
 * is actually holding when a parent rings up: what did they offer, what were they given, are
 * they out right now, and have they done this before.
 *
 * Contact details are on it. That is the point — an organizer needs the number — and it is
 * why this screen is organizer-only and why nothing here is ever denormalized onto a pass.
 *
 * Everything here is about *this* event. People are stored under the event they took part
 * in, so there is no identity spanning years and no record of what somebody did last time —
 * deliberately: a register of children outliving the event it was collected for is a
 * liability rather than a convenience. Year-over-year lives on locations, which have a
 * shared identity because a shop is not a child.
 */
export function PersonScreen(): ReactNode {
  /* A viewer opens somebody's page from the board and changes nothing on it. */
  const canEdit = runsTheEvent(useSession().role)
  const { personId } = useParams<{ personId: string }>()
  const [editing, setEditing] = useState(false)
  const { slots } = useEvent()
  const people = usePeople()
  const signups = useSignups()
  const assignments = useAssignments()
  const jars = useJars()
  const locations = useLocations()
  const passes = usePasses()
  const requests = useVolunteerRequests()

  const person = useMemo(
    () => people.data.find((p) => p.id === personId) ?? null,
    [people.data, personId],
  )

  const partner = useMemo(
    () =>
      person?.pairWithPersonId
        ? (people.data.find((p) => p.id === person.pairWithPersonId) ?? null)
        : null,
    [people.data, person],
  )

  const signup = useMemo(
    () => signups.data.find((s) => s.personId === personId) ?? null,
    [signups.data, personId],
  )

  const eventDays = useMemo(
    () => DAYS.filter((d) => slots.some((s) => s.day === d)),
    [slots],
  )

  /** Their shifts this event, in the order the weekend runs. */
  const shifts = useMemo(() => {
    const slotById = new Map(slots.map((s) => [s.id, s]))
    const locationById = new Map(locations.data.map((l) => [l.id, l]))
    return assignments.data
      .filter((a) => a.personId === personId && a.status !== 'swapped')
      .map((a) => ({
        assignment: a,
        slot: slotById.get(a.slotId),
        locationName: locationById.get(a.locationId)?.name ?? a.locationId,
        jars: jars.data.filter((j) => j.assignmentIds.includes(a.id)),
      }))
      .sort(
        (x, y) =>
          DAYS.indexOf(x.slot?.day ?? 'sun') - DAYS.indexOf(y.slot?.day ?? 'sun') ||
          (x.slot?.startMin ?? 0) - (y.slot?.startMin ?? 0),
      )
  }, [assignments.data, jars.data, locations.data, slots, personId])

  /** Money against their name this event — jars they carried, counted. */
  const raised = useMemo(
    () =>
      jars.data
        .filter((j) => j.personId === personId)
        .filter(isCounted)
        .reduce((sum, j) => Math.round((sum + j.amount) * 100) / 100, 0),
    [jars.data, personId],
  )

  /*
    Their pass, if the schedule has been published.

    This screen already had the tokens — it used them to find that person's requests — and
    then said nothing about them. So the one place set up to answer questions about a
    volunteer could not answer "what link did we send them?", which is what somebody
    reaches for when a parent rings to say the link does not work.
  */
  const theirPass = useMemo(
    () => passes.data.find((p) => p.personId === personId) ?? null,
    [passes.data, personId],
  )

  const theirRequests = useMemo(() => {
    const tokens = new Set(
      passes.data.filter((p) => p.personId === personId).map((p) => p.token),
    )
    return requests.data
      .filter((r) => tokens.has(r.passToken))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [passes.data, requests.data, personId])

  if (people.loading) return <Loading what="Looking them up" />

  if (!person) {
    return (
      <div className="card">
        <h1>Not found</h1>
        <p className="muted">
          No youth or leader with that id. They may have been deleted since the link was made.
        </p>
      </div>
    )
  }

  /** Which slots they said they could do, per day. */
  const offered = (day: Day): string[] => signup?.availability[day] ?? []
  const bookedSlotIds = new Set(shifts.map((s) => s.assignment.slotId))

  return (
    <>
      <ErrorNote
        error={assignments.error ?? jars.error ?? signups.error ?? people.error}
      />

      {editing && <PersonEditor person={person} onClose={() => setEditing(false)} />}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ marginBottom: '0.2rem' }}>
              {fullName(person)} <SectionPill section={person.section} />
            </h1>
            {/* The pill above already names the section; repeating it here said nothing. */}
            {partner && (
              <p className="small muted" style={{ margin: 0 }}>
                {/*
                  Built by hand until now, which pinned the URL to the event's id — so
                  following it from an event reached by its link name jumped you to a
                  different shape of URL. `pathFor` is what knows the difference.
                */}
                Works alongside <PersonLink person={partner} className="" />
              </p>
            )}
          </div>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="stats">
              <Stat label="shifts" value={shifts.length} />
              <Stat label="raised" value={<Money value={raised} />} />
            </div>
            {/*
              The same editor the roster uses, not a second one.

              This is the screen an organizer is on when a parent rings up, so it is where a
              misspelled name or a wrong number gets noticed, and it should be where it gets
              fixed — not back on the roster, hunting for the row again.
            */}
            {canEdit && <button onClick={() => setEditing(true)}>Edit details</button>}
          </div>
        </div>

        {/* Contact details, which is what somebody reaches for when a parent rings up. */}
        <div className="row" style={{ marginTop: '0.5rem' }}>
          {person.parentName && <span className="small">{person.parentName}</span>}
          {person.parentPhone && (
            <a className="small" href={`tel:${person.parentPhone}`}>
              {person.parentPhone}
            </a>
          )}
          {person.parentEmail && (
            <a className="small" href={`mailto:${person.parentEmail}`}>
              {person.parentEmail}
            </a>
          )}
          {/* The warning is the button: noticing it and fixing it are one press. */}
          {canEdit && !person.parentName && !person.parentPhone && !person.parentEmail && (
            <button className="tiny" onClick={() => setEditing(true)}>
              <span style={{ color: 'var(--warn)' }}>
                No contact details on file — they cannot be reached on the day. Add them.
              </span>
            </button>
          )}
        </div>
      </div>

      {theirPass && <PassCard token={theirPass.token} name={fullName(person)} />}

      <div className="card">
        <h2>This event</h2>
        {shifts.length === 0 ? (
          <p className="muted">Not on the board.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Where</th>
                  <th>State</th>
                  <th>Jars</th>
                </tr>
              </thead>
              <tbody>
                {shifts.map(({ assignment, slot, locationName, jars: held }) => (
                  <tr key={assignment.id}>
                    <td className="small nowrap">
                      {slot ? `${DAY_LABEL[slot.day]} ${slot.label}` : assignment.slotId}
                    </td>
                    <td className="small">{locationName}</td>
                    <td className="small nowrap">
                      {assignment.status === 'checkedIn' && (
                        <span className="pill tone-amber">checked in</span>
                      )}
                      {assignment.status === 'noShow' && (
                        <span className="pill tone-red">no-show</span>
                      )}
                      {assignment.whereabouts === 'out' && (
                        <span className="pill tone-green">out collecting</span>
                      )}
                      {assignment.whereabouts === 'back' && (
                        <span className="pill tone-blue">back</span>
                      )}
                      {assignment.status !== 'checkedIn' &&
                        assignment.status !== 'noShow' &&
                        assignment.whereabouts === 'here' && (
                          <span className="muted">expected</span>
                        )}
                    </td>
                    <td className="small">
                      {held.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        held.map((j) => (
                          <span key={j.id} className="nowrap">
                            {isNumbered(j) ? `#${j.jarNumber}` : 'jar'}
                            {isCounted(j) ? (
                              <>
                                {' '}
                                <Money value={j.amount} />
                              </>
                            ) : (
                              <span className="muted"> still out</span>
                            )}{' '}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2>What they offered</h2>
        {signup === null ? (
          <p className="muted">
            No signup for this event — they were added to the board by hand.
          </p>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              From the form. An hour they were given but did not offer is marked, because
              that is somebody the board is relying on who never said yes to it.
            </p>
            {eventDays.map((day) => {
              const daySlots = slots.filter((s) => s.day === day)
              return (
                <div className="row" key={day} style={{ marginTop: '0.3rem' }}>
                  <strong className="small" style={{ minWidth: '5rem' }}>
                    {DAY_LABEL[day]}
                  </strong>
                  {daySlots.length === 0 ? (
                    <span className="small muted">no hours</span>
                  ) : (
                    daySlots.map((slot) => {
                      const said = offered(day).includes(slot.id)
                      const booked = bookedSlotIds.has(slot.id)
                      return (
                        <span
                          key={slot.id}
                          className={`pill ${
                            booked && !said
                              ? 'tone-red'
                              : booked
                                ? 'tone-green'
                                : said
                                  ? 'tone-blue'
                                  : ''
                          }`}
                          title={
                            booked && !said
                              ? 'Given this hour, but never offered it'
                              : booked
                                ? 'Offered and working'
                                : said
                                  ? 'Offered, not used'
                                  : 'Not offered'
                          }
                        >
                          {slot.label.replace(/:00/g, '')}
                        </span>
                      )
                    })
                  )}
                </div>
              )
            })}
            {signup.notes && <p className="small">“{signup.notes}”</p>}
          </>
        )}
      </div>

      {theirRequests.length > 0 && (
        <div className="card">
          <h2>What they have asked for</h2>
          <ul className="issue-list">
            {theirRequests.map((r) => (
              <li key={r.id}>
                <div>
                  <strong className="small">{requestSummary(r.kind)}</strong>
                  {r.message && <div className="small">“{r.message}”</div>}
                  <div className="small muted">
                    {new Date(r.createdAt).toLocaleString('en-CA', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {r.handledAt === null ? ' · still waiting' : ' · dealt with'}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

    </>
  )
}
