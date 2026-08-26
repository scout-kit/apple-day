import { useMemo, useState } from 'react'
import { countGaps } from '../domain/contact'
import { eventLabel } from '../domain/events'
import { useUrlState } from '../lib/urlState'
import type { ReactNode } from 'react'
import { DAY_LABEL, DAY_SHORT } from '../domain/slots'
import { DAYS, fullName } from '../domain/types'
import type { Person, Section, Slot } from '../domain/types'
import { downloadFile, toCsv } from '../lib/csv'
import { useEvent } from '../lib/eventContext'
import {
  deletePerson,
  removeFromEvent,
  saveAvailability,
  useAssignments,
  useLocations,
  usePeople,
  useSignups,
} from '../lib/repo'
import { useSections } from '../lib/sections'
import { ErrorNote, Loading, SectionPill, Stat } from './Bits'
import { ContactFlag } from './ContactFlag'
import { PersonLink } from './PersonLink'
import { Modal } from './Modal'
import { PersonEditor } from './PersonEditor'

/**
 * Who signed up, when they can work, and whether they have a shift.
 *
 * The workbook's answer to this was a hidden sheet of form responses with availability as
 * comma-joined text, so the only way to know who was free at 6pm was to read down a
 * column. Here availability is a grid: every hour the event runs, marked offered, booked,
 * or unavailable — which is what you actually need when filling a gap on the board.
 *
 * Contact details are editable because the review has asked for them three years running
 * and the form still does not collect them; this is where the gaps get filled by hand.
 */

/**
 * What one hour looks like for one person.
 *
 * `booked` and `offered` are independent: an organizer can schedule someone outside the
 * hours they offered (the board warns, it does not block), and can withdraw availability
 * from an hour already booked. `bookedUnoffered` is that disagreement made visible.
 */
type Availability = 'booked' | 'bookedUnoffered' | 'offered' | 'no'

interface Row {
  person: Person
  /** Slot id -> what that hour looks like for this person. Display only. */
  byslot: Map<string, Availability>
  /**
   * The hours actually offered, exactly as stored.
   *
   * Kept separate from {@link byslot} because a write has to be built from what was
   * offered, not from what is drawn: `bookedUnoffered` renders like a booked hour but
   * means the opposite for availability, and reconstructing from the display would quietly
   * grant availability for an hour the person never offered.
   */
  offeredSlots: Set<string>
  offered: number
  booked: number
  hasSignup: boolean
}

export function PeopleScreen(): ReactNode {
  const { event, slots } = useEvent()
  const { sections } = useSections()
  const people = usePeople()
  const signups = useSignups()
  const assignments = useAssignments()
  const locations = useLocations()

  // In the address bar: this is the screen somebody searches, opens a person from, and
  // comes straight back to.
  const [search, setSearch] = useUrlState('find')
  const [sectionParam, setSection] = useUrlState('section', 'all')
  const [onlySlot, setOnlySlot] = useUrlState('slot')
  const section = sectionParam as Section | 'all'
  /**
   * Everyone by default.
   *
   * Availability is now set here, not only imported, so the roster is where somebody who
   * has not signed up gets their hours entered — filtering them out by default hid exactly
   * the people most likely to need attention.
   */
  const [showParam, setShow] = useUrlState('show', 'everyone')
  const show = showParam as 'everyone' | 'signedUp' | 'unscheduled'
  /*
    Held for adding somebody, and nothing else.

    It used to open for editing too, from a button on the row. That is gone — a person is
    edited on their own page — so the separate `adding` flag it was paired with went with
    it: if this is set, somebody is being added.
  */
  const [newPerson, setNewPerson] = useState<Person | null>(null)
  const [writeError, setWriteError] = useState<Error | null>(null)
  const [removing, setRemoving] = useState<Row | null>(null)
  /** Anchor for the pairing picker, when it is open. */

  const eventDays = useMemo(
    () => DAYS.filter((d) => slots.some((s) => s.day === d)),
    [slots],
  )
  const locationById = useMemo(
    () => new Map(locations.data.map((l) => [l.id, l])),
    [locations.data],
  )

  const rows = useMemo((): Row[] => {
    const signupByPerson = new Map(signups.data.map((s) => [s.personId, s]))
    const assignedByPerson = new Map<string, Set<string>>()
    for (const a of assignments.data) {
      if (a.status === 'swapped') continue
      const set = assignedByPerson.get(a.personId)
      if (set) set.add(a.slotId)
      else assignedByPerson.set(a.personId, new Set([a.slotId]))
    }

    return people.data
      .map((person) => {
        const signup = signupByPerson.get(person.id)
        const booked = assignedByPerson.get(person.id) ?? new Set<string>()
        const byslot = new Map<string, Availability>()
        const offeredSlots = new Set<string>()

        for (const slot of slots) {
          const offered = (signup?.availability[slot.day] ?? []).includes(slot.id)
          if (offered) offeredSlots.add(slot.id)
          byslot.set(
            slot.id,
            booked.has(slot.id)
              ? offered
                ? 'booked'
                : 'bookedUnoffered'
              : offered
                ? 'offered'
                : 'no',
          )
        }

        return {
          person,
          byslot,
          offeredSlots,
          offered: offeredSlots.size,
          booked: booked.size,
          hasSignup: signup !== undefined,
        }
      })
      .sort((a, b) => fullName(a.person).localeCompare(fullName(b.person)))
  }, [people.data, signups.data, assignments.data, slots])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (show === 'signedUp' && !row.hasSignup) return false
      if (show === 'unscheduled' && (row.booked > 0 || !row.hasSignup)) return false
      if (section !== 'all' && row.person.section !== section) return false
      if (onlySlot && !row.offeredSlots.has(onlySlot)) return false
      if (!q) return true
      return (
        fullName(row.person).toLowerCase().includes(q) ||
        row.person.parentName.toLowerCase().includes(q) ||
        row.person.parentEmail.toLowerCase().includes(q)
      )
    })
  }, [rows, search, section, onlySlot, show])

  const summary = useMemo(() => {
    const signedUp = rows.filter((r) => r.hasSignup)
    return {
      signedUp: signedUp.length,
      unscheduled: signedUp.filter((r) => r.booked === 0).length,
      // Counted apart, because they go wrong at different times and are fixed for
      // different reasons — see `domain/contact`.
      gaps: countGaps(signedUp.map((r) => r.person)),
      hoursOffered: signedUp.reduce((sum, r) => sum + r.offered, 0),
      hoursBooked: signedUp.reduce((sum, r) => sum + r.booked, 0),
    }
  }, [rows])

  /** Take someone out of this year, shifts included. */
  const removeFromYear = (row: Row): void => {
    if (!event) return
    const theirs = assignments.data
      .filter((a) => a.personId === row.person.id && a.status !== 'swapped')
      .map((a) => a.id)

    setWriteError(null)
    setRemoving(null)
    void removeFromEvent(event.id, row.person.id, theirs).catch((error: Error) =>
      setWriteError(error),
    )
  }

  /**
   * Delete them from this event outright.
   *
   * People belong to the event rather than to the app, so this is the whole of it: their
   * record, their signup and their shifts. Nothing is kept afterwards — which is the point,
   * since a register of children that outlives the event it was collected for is a liability
   * rather than a convenience.
   */
  const deleteOutright = (row: Row): void => {
    if (!event) return
    const theirs = assignments.data
      .filter((a) => a.personId === row.person.id && a.status !== 'swapped')
      .map((a) => a.id)

    setWriteError(null)
    setRemoving(null)
    void removeFromEvent(event.id, row.person.id, theirs)
      .then(() => deletePerson(event.id, row.person.id))
      .catch((error: Error) => setWriteError(error))
  }

  /** Where this person is booked in a given hour, for the cell tooltip. */
  const bookedAt = (personId: string, slotId: string): string => {
    const match = assignments.data.find(
      (a) => a.personId === personId && a.slotId === slotId && a.status !== 'swapped',
    )
    return match ? (locationById.get(match.locationId)?.name ?? match.locationId) : ''
  }

  const exportCsv = (): void => {
    downloadFile(
      `apple-day-${(event ? eventLabel(event) : 'roster')}-signups.csv`,
      toCsv(
        visible.map((row) => ({
          Name: fullName(row.person),
          Section: row.person.section,
          Parent: row.person.parentName,
          Email: row.person.parentEmail,
          Phone: row.person.parentPhone,
          'Hours offered': String(row.offered),
          'Shifts booked': String(row.booked),
          ...Object.fromEntries(
            eventDays.map((day) => [
              DAY_LABEL[day],
              slots
                .filter((s) => s.day === day && row.offeredSlots.has(s.id))
                .map((s) => s.label)
                .join(' | '),
            ]),
          ),
        })),
      ),
    )
  }

  /**
   * Toggle one hour of one person's availability.
   *
   * Fired without waiting for the server, like every other write in the app: the local
   * cache applies it immediately so the cell flips at once, and gating the grid on a
   * server acknowledgement would freeze it on a weak connection.
   */
  const toggleHour = (row: Row, slot: Slot): void => {
    if (!event) return
    setWriteError(null)

    const current: Partial<Record<typeof slot.day, string[]>> = {}
    for (const day of eventDays) {
      current[day] = slots
        .filter((s) => s.day === day && row.offeredSlots.has(s.id))
        .map((s) => s.id)
    }

    const offeredNow = row.offeredSlots.has(slot.id)
    current[slot.day] = offeredNow
      ? (current[slot.day] ?? []).filter((id) => id !== slot.id)
      : [...(current[slot.day] ?? []), slot.id]

    void saveAvailability(event.id, row.person.id, current).catch((error: Error) =>
      setWriteError(error),
    )
  }

  /** Offer, or withdraw, a whole day for one person. */
  const setWholeDay = (row: Row, day: (typeof eventDays)[number], offer: boolean): void => {
    if (!event) return
    setWriteError(null)

    const next: Partial<Record<typeof day, string[]>> = {}
    for (const d of eventDays) {
      next[d] =
        d === day
          ? offer
            ? slots.filter((s) => s.day === d).map((s) => s.id)
            : []
          : slots.filter((s) => s.day === d && row.offeredSlots.has(s.id)).map((s) => s.id)
    }

    void saveAvailability(event.id, row.person.id, next).catch((error: Error) =>
      setWriteError(error),
    )
  }

  if (people.loading || signups.loading) return <Loading what="Loading the roster" />

  const MARK: Record<Availability, string> = {
    booked: '●',
    bookedUnoffered: '●',
    offered: '○',
    no: '·',
  }

  const cellStyle = (state: Availability): React.CSSProperties => ({
    textAlign: 'center',
    padding: 0,
    background:
      state === 'booked'
        ? 'var(--good-soft)'
        : state === 'bookedUnoffered'
          ? 'var(--bad-soft)'
          : state === 'offered'
            ? 'var(--warn-soft)'
            : 'transparent',
    color:
      state === 'booked'
        ? 'var(--good)'
        : state === 'bookedUnoffered'
          ? 'var(--bad)'
          : state === 'offered'
            ? 'var(--warn)'
            : 'var(--border)',
    fontWeight: state === 'booked' || state === 'bookedUnoffered' ? 700 : 400,
  })

  return (
    <div className="fill">
      <ErrorNote
        error={writeError ?? people.error ?? signups.error ?? assignments.error}
      />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>{event ? `${eventLabel(event)} signups` : 'Signups'}</h1>
            <p className="small muted" style={{ margin: 0 }}>
              Click an hour to set whether someone is available for it.
            </p>
            {/* The swatches are coloured the same way the grid is. Describing the colours
                in muted body text rendered the marks grey, which said the opposite. */}
            <div className="legend small">
              <span>
                <b style={{ color: 'var(--good)', background: 'var(--good-soft)' }}>●</b>
                booked
              </span>
              <span>
                <b style={{ color: 'var(--warn)', background: 'var(--warn-soft)' }}>○</b>
                offered, free
              </span>
              <span>
                <b style={{ color: 'var(--bad)', background: 'var(--bad-soft)' }}>●</b>
                booked but not offered
              </span>
              <span>
                <b style={{ color: 'var(--border)' }}>·</b>
                not available
              </span>
            </div>
          </div>
          <div className="stats">
            <Stat label="signed up" value={summary.signedUp} />
            <Stat
              label="no shift yet"
              value={summary.unscheduled}
              {...(summary.unscheduled > 0 ? { tone: 'warn' as const } : {})}
            />
            <Stat label="hours offered" value={summary.hoursOffered} />
            <Stat label="shifts booked" value={summary.hoursBooked} />
          </div>
        </div>

        {/*
          A line each, and no more than the count.

          They are two problems with two deadlines — an address is wanted the week before,
          when schedules go out, and a number is wanted on the day — so lumping them into
          one sentence hid whichever was smaller. Which people is a question the marks in
          the list below answer, so the banner does not try to.
        */}
        {summary.gaps.phone > 0 && (
          <div className="note warning">
            {summary.gaps.phone} of {summary.signedUp} have no phone number.
          </div>
        )}
        {summary.gaps.email > 0 && (
          <div className="note warning">
            {summary.gaps.email} of {summary.signedUp} have no email address.
          </div>
        )}

        <div className="row" style={{ marginTop: '0.6rem' }}>
          <input
            placeholder="Search name, parent or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: '1 1 14rem' }}
          />
          <select
            aria-label="Filter by section"
            value={section}
            onChange={(e) => setSection(e.target.value as Section | 'all')}
          >
            <option value="all">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by availability"
            value={onlySlot}
            onChange={(e) => setOnlySlot(e.target.value)}
          >
            <option value="">Any hour</option>
            {slots.map((slot: Slot) => (
              <option key={slot.id} value={slot.id}>
                Free at {DAY_SHORT[slot.day]} {slot.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Who to show"
            value={show}
            onChange={(e) => setShow(e.target.value as typeof show)}
          >
            <option value="everyone">Everyone on record</option>
            <option value="signedUp">Signed up</option>
            <option value="unscheduled">Signed up, no shift</option>
          </select>
          <button className="tiny" onClick={exportCsv} disabled={visible.length === 0}>
            Export
          </button>
          <button
            className="primary tiny"
            onClick={() => {
              setNewPerson({
                id: '', firstName: '', lastName: '',
                section: sections[0]?.id ?? 'cubs',
                parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
              })
            }}
          >
            Add person
          </button>
        </div>
      </div>

      <div className="card table-card">
        {visible.length === 0 ? (
          <p className="muted">
            {rows.length === 0
              ? 'Nobody on record yet. Import the form responses on the Import screen.'
              : 'Nobody matches those filters.'}
          </p>
        ) : (
          <div className="table-wrap sticky-first">
            <table>
              <thead>
                <tr>
                  {/*
                    No Contact column. Parents' addresses and phone numbers were on a screen
                    that is open all day on a table in a shop doorway, in a column nobody
                    read — the mark beside a name says when one is *missing*, which is the
                    part that needs acting on, and the person's own page has the details.
                  */}
                  <th>Name</th>
                  {eventDays.map((day) => (
                    <th
                      key={day}
                      colSpan={slots.filter((s) => s.day === day).length}
                      style={{ textAlign: 'center', borderLeft: '1px solid var(--border)' }}
                    >
                      {DAY_LABEL[day]}
                    </th>
                  ))}
                  <th className="right">Booked</th>
                  <th />
                </tr>
                <tr>
                  <th />
                  {slots.map((slot, i) => (
                    <th
                      key={slot.id}
                      title={slot.label}
                      style={{
                        textAlign: 'center',
                        fontWeight: 400,
                        borderLeft:
                          i > 0 && slots[i - 1]!.day !== slot.day
                            ? '1px solid var(--border)'
                            : undefined,
                      }}
                    >
                      {/* Minutes matter once shifts overlap: 5:00 and 5:45 would
                          otherwise both read as 5. */}
                      {slot.startMin % 60 === 0
                        ? Math.floor(slot.startMin / 60) % 12 || 12
                        : `${Math.floor(slot.startMin / 60) % 12 || 12}:${String(
                            slot.startMin % 60,
                          ).padStart(2, '0')}`}
                    </th>
                  ))}
                  <th />
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.person.id}>
                    <td>
                      <div className="nowrap">
                        {/*
                          The same mark as the day-of table, ahead of the name for the same
                          reason: in the margin the eye already runs down, so a list of
                          ninety can be scanned for the handful that carry one. Here it
                          covers a missing address as well — this is the screen where the
                          gap gets filled, and a schedule cannot be sent without one.
                        */}
                        <ContactFlag person={row.person} scope="signup" />
                        <PersonLink person={row.person} />{' '}
                        <SectionPill section={row.person.section} />
                      </div>
                      <div className="row small" style={{ gap: '0.2rem', marginTop: '0.15rem' }}>
                        {eventDays.map((day) => {
                          const daySlots = slots.filter((s) => s.day === day)
                          const all =
                            daySlots.length > 0 &&
                            daySlots.every((s) => row.offeredSlots.has(s.id))
                          return (
                            <button
                              key={day}
                              className="tiny"
                              title={
                                all
                                  ? `Withdraw all of ${DAY_LABEL[day]}`
                                  : `Offer all of ${DAY_LABEL[day]}`
                              }
                              onClick={() => setWholeDay(row, day, !all)}
                            >
                              {all ? `−${DAY_SHORT[day]}` : `+${DAY_SHORT[day]}`}
                            </button>
                          )
                        })}
                      </div>
                      {row.person.pairWithPersonId && (
                        <div className="small muted">
                          pairs with{' '}
                          <PersonLink
                            person={people.data.find(
                              (p) => p.id === row.person.pairWithPersonId,
                            )}
                            personId={row.person.pairWithPersonId}
                            className=""
                          />
                        </div>
                      )}
                    </td>
                    {slots.map((slot) => {
                      const state = row.byslot.get(slot.id) ?? 'no'
                      const booked = state === 'booked' || state === 'bookedUnoffered'
                      const where = booked ? bookedAt(row.person.id, slot.id) : ''
                      const when = `${DAY_SHORT[slot.day]} ${slot.label}`
                      const title = booked
                        ? state === 'bookedUnoffered'
                          ? `${when} — working ${where}, though this hour was not offered. Click to mark available.`
                          : `${when} — working ${where}. Click to withdraw this hour.`
                        : state === 'offered'
                          ? `${when} — available. Click to withdraw.`
                          : `${when} — not available. Click to offer.`
                      return (
                        <td key={slot.id} style={cellStyle(state)}>
                          <button
                            aria-label={`${fullName(row.person)} ${when}`}
                            aria-pressed={state === 'offered' || state === 'booked'}
                            title={title}
                            onClick={() => toggleHour(row, slot)}
                            style={{
                              border: 0,
                              background: 'transparent',
                              color: 'inherit',
                              font: 'inherit',
                              width: '100%',
                              padding: '0.25rem 0.1rem',
                              cursor: 'pointer',
                            }}
                          >
                            {MARK[state]}
                          </button>
                        </td>
                      )
                    })}
                    <td className="right">
                      {row.booked}
                      <span className="muted">/{row.offered}</span>
                    </td>
                    <td>
                      {/*
                        No Edit here: a name in this list links to that person's own page,
                        which is where their details are changed. Removing them from the
                        year stays, because it is about this list rather than about them.
                      */}
                      <button
                        className="tiny"
                        title={`Remove ${fullName(row.person)} from ${(event ? eventLabel(event) : 'this year')}`}
                        onClick={() => setRemoving(row)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          Showing {visible.length} of {rows.length}. Hover an hour to see where someone is
          booked. Availability comes from the form import — the schedule board is where
          shifts are assigned.
        </p>
      </div>

      {removing && (
        <Modal
          title={`Remove ${fullName(removing.person)}?`}
          onClose={() => setRemoving(null)}
          footer={
            <>
              <button onClick={() => setRemoving(null)}>Cancel</button>
              <button className="danger" onClick={() => removeFromYear(removing)}>
                Remove from {event && eventLabel(event)}
              </button>
            </>
          }
        >
          <div className="stack">
            <p>
              This takes {removing.person.firstName} out of {event && eventLabel(event)}: their
              availability and{' '}
              {removing.booked === 0
                ? 'no booked shifts'
                : `${removing.booked} booked shift${removing.booked === 1 ? '' : 's'}`}
              .
            </p>
            {removing.booked > 0 && (
              <div className="note warning">
                The {removing.booked} shift{removing.booked === 1 ? '' : 's'} go too. Leaving
                them behind would put someone on the published schedule who is no longer
                signed up. Republish afterwards so the shared schedule matches.
              </div>
            )}
            <p className="small muted">
              They stay on the roster and in previous years, so their history and totals are
              unaffected. Re-importing the form will bring them back if they are still in it.
            </p>
            <details>
              <summary className="small muted">Delete them from the roster entirely</summary>
              <div className="stack" style={{ marginTop: '0.5rem' }}>
                <div className="note error">
                  For a duplicate or a typo only. Past years reference people by id, so
                  deleting someone with history leaves those years showing an unknown
                  person. This cannot be undone.
                </div>
                <div>
                  <button className="danger" onClick={() => deleteOutright(removing)}>
                    Delete {fullName(removing.person)} permanently
                  </button>
                </div>
              </div>
            </details>
          </div>
        </Modal>
      )}

      {newPerson && (
        <PersonEditor person={newPerson} adding onClose={() => setNewPerson(null)} />
      )}
    </div>
  )
}
