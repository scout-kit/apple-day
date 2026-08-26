import type { ReactNode } from 'react'
import {
  activeDays,
  buildSlots,
  DAY_LABEL,
  minutesToTimeValue,
  stepMinutes,
  timeValueToMinutes,
} from '../domain/slots'
import { DAYS } from '../domain/types'
import type { AppleDayEvent, Location } from '../domain/types'
import { sanitiseEventLink } from '../domain/eventLinks'
import { blankContact, isReachable } from '../domain/support'
import type { SupportContact } from '../domain/support'
import { LocationField } from './PickerField'

/**
 * Everything that makes an event what it is: its dates, its hours, its shift shape, where
 * volunteers report and who they can ring.
 *
 * One component for both creating and editing, which is the point of it existing. Creating
 * used to ask for a name and offer to copy last year's locations, and nothing else — every
 * other setting could only be reached by creating the event, then opening it again in a
 * second, much larger dialog. Two forms over one shape is also two forms to keep in step,
 * and the smaller one had already fallen a long way behind.
 *
 * It holds no state. The draft lives with whoever opened the form, so creating can throw it
 * away and editing can compare it against what was stored.
 */
export interface EventSettingsProps {
  draft: AppleDayEvent
  onChange: (next: AppleDayEvent) => void
  /**
   * The location library, for choosing a base from.
   *
   * The library and not the year's list, deliberately: the base is a real place with an
   * address and a contact, and it is not one of the year's staffed locations. Nothing here
   * resolves the id — it only offers the names to pick from.
   */
  library: Location[]
  /**
   * The id this event lives under — shown as the link's placeholder and in the explanation
   * beneath it. For an event being created, the id its name would produce.
   */
  eventId: string
  /** Why the typed link cannot be used, or null. */
  linkProblem: string | null
  mode: 'new' | 'edit'
}

export function EventSettings({
  draft,
  onChange,
  library,
  eventId,
  linkProblem,
  mode,
}: EventSettingsProps): ReactNode {
  const setContact = (index: number, contact: SupportContact): void => {
    onChange({
      ...draft,
      support: draft.support.map((c, i) => (i === index ? contact : c)),
    })
  }

  return (
    <>
      <label>
        Name
        <input
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
      </label>
      <div>
        {/* Explicitly associated rather than wrapping: the row also holds the "/e/"
            prefix and a Reset button, so a wrapping label would name the field after
            all three. */}
        <label htmlFor="event-link">Link</label>
        <div className="row" style={{ gap: '0.25rem', alignItems: 'center' }}>
          <span className="mono muted small">/e/</span>
          <input
            id="event-link"
            className="mono"
            value={draft.slug}
            placeholder={eventId}
            onChange={(e) =>
              onChange({ ...draft, slug: sanitiseEventLink(e.target.value) })
            }
            style={{ flex: '1 1 12rem' }}
          />
          {draft.slug && (
            <button
              className="tiny"
              title="Go back to the generated link"
              onClick={() => onChange({ ...draft, slug: '' })}
            >
              Reset
            </button>
          )}
        </div>
      </div>
      {linkProblem ? (
        <p className="small" style={{ color: 'var(--bad)' }}>
          {linkProblem}
        </p>
      ) : mode === 'new' ? (
        <p className="small muted">
          It will be at <span className="mono">/e/{draft.slug || eventId}</span>.
          Leave this alone to use the link made from the name.
        </p>
      ) : (
        <p className="small muted">
          This event is at{' '}
          <span className="mono">/e/{draft.slug || eventId}</span>. Its original
          link <span className="mono">/e/{eventId}</span> keeps working either way,
          so changing this never breaks a link somebody has already been sent.
        </p>
      )}

      <div className="row">
        <label style={{ flex: '1 1 10rem' }}>
          First day
          <input
            type="date"
            value={draft.fridayDate}
            onChange={(e) => onChange({ ...draft, fridayDate: e.target.value })}
          />
        </label>
        <label style={{ flex: '1 1 10rem' }}>
          Last day
          <input
            type="date"
            value={draft.saturdayDate}
            onChange={(e) => onChange({ ...draft, saturdayDate: e.target.value })}
          />
        </label>
      </div>

      <div>
        <div className="small muted">
          Whether the day is split into shifts at all.
        </div>
        <div className="row" style={{ marginTop: '0.35rem' }}>
          <label style={{ flex: '0 1 14rem' }}>
            Scheduling
            <select
              value={draft.shiftMode}
              onChange={(e) =>
                onChange({
                  ...draft,
                  shiftMode: e.target.value === 'wholeDay' ? 'wholeDay' : 'shifts',
                })
              }
            >
              <option value="shifts">Shifts through the day</option>
              <option value="wholeDay">Whole day — no shifts</option>
            </select>
          </label>
          {draft.shiftMode === 'wholeDay' && (
            <span className="small muted">
              Each day is one slot; people are scheduled for the duration.
            </span>
          )}
        </div>

        {draft.shiftMode === 'shifts' && (
        <>
        <div className="small muted" style={{ marginTop: '0.5rem' }}>
          How long a shift is, and how much it overlaps the one before it. An overlap
          is a handover: the next pair arrive while the current ones are still there,
          pick up supplies and head out together.
        </div>
        <div className="row" style={{ marginTop: '0.35rem' }}>
          <label style={{ flex: '0 1 9rem' }}>
            Shift length
            <select
              value={draft.shiftMinutes}
              onChange={(e) =>
                onChange({ ...draft, shiftMinutes: Number(e.target.value) })
              }
            >
              {[30, 45, 60, 75, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <label style={{ flex: '0 1 9rem' }}>
            Overlap
            <select
              value={draft.overlapMinutes}
              onChange={(e) =>
                onChange({ ...draft, overlapMinutes: Number(e.target.value) })
              }
            >
              {[0, 5, 10, 15, 20, 30].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'none' : `${m} min`}
                </option>
              ))}
            </select>
          </label>
          <span className="small muted">
            starts {stepMinutes(draft)} min apart
          </span>
        </div>
        {draft.overlapMinutes >= draft.shiftMinutes && (
          <div className="note error">
            An overlap has to be shorter than the shift, or every shift would start at
            the same time.
          </div>
        )}

        </>
        )}

        {/* The shape is hard to picture from two numbers, so show the result. */}
        {activeDays(draft.schedule)[0] &&
          (() => {
            const day = activeDays(draft.schedule)[0]!
            const preview = buildSlots(day, draft.schedule, draft)
            return (
              <p className="small muted" style={{ marginTop: '0.35rem' }}>
                {draft.shiftMode === 'wholeDay'
                  ? `${DAY_LABEL[day]} is one slot: ${preview[0]?.label ?? '—'}`
                  : `${DAY_LABEL[day]} would run ${preview.length} shift${
                      preview.length === 1 ? '' : 's'
                    }: ${preview
                      .slice(0, 4)
                      .map((slot) => slot.label)
                      .join(', ')}${
                      preview.length > 4 ? ` … ${preview.at(-1)!.label}` : ''
                    }`}
              </p>
            )
          })()}

        <div className="small muted" style={{ marginTop: '0.6rem' }}>
          Which days this Apple Day runs, and the hours staffed on each. These become
          the columns on the schedule board — a location's own opening hours are
          recorded separately in the library.
        </div>
        {DAYS.map((day) => {
          const window = draft.schedule[day]
          const setWindow = (next: typeof window): void =>
            onChange({
              ...draft,
              schedule: (() => {
                const schedule = { ...draft.schedule }
                if (next) schedule[day] = next
                else delete schedule[day]
                return schedule
              })(),
            })
          return (
            <div className="row" key={day} style={{ marginTop: '0.35rem' }}>
              <input
                type="checkbox"
                className="switch"
                checked={Boolean(window)}
                aria-label={`Run on ${DAY_LABEL[day]}`}
                onChange={(e) =>
                  setWindow(
                    e.target.checked
                      ? { startMin: 9 * 60, endMin: 15 * 60 }
                      : undefined,
                  )
                }
              />
              <strong
                className="small"
                style={{ minWidth: '5rem', opacity: window ? 1 : 0.55 }}
              >
                {DAY_LABEL[day]}
              </strong>
              {window ? (
                <>
                  {/* A clock rather than a list of hours: quarter-hour steps in the
                      picker, and any time can still be typed. */}
                  <input
                    type="time"
                    step={15 * 60}
                    aria-label={`${DAY_LABEL[day]} start`}
                    value={minutesToTimeValue(window.startMin)}
                    onChange={(e) => {
                      const startMin = timeValueToMinutes(e.target.value)
                      // A cleared or half-typed field leaves the stored time alone.
                      if (startMin !== null) setWindow({ ...window, startMin })
                    }}
                  />
                  <span className="muted">to</span>
                  <input
                    type="time"
                    step={15 * 60}
                    aria-label={`${DAY_LABEL[day]} end`}
                    value={minutesToTimeValue(window.endMin)}
                    onChange={(e) => {
                      const endMin = timeValueToMinutes(e.target.value)
                      if (endMin !== null) setWindow({ ...window, endMin })
                    }}
                  />
                  {window.endMin > window.startMin ? (
                    <span className="small muted">
                      {draft.shiftMode === 'wholeDay'
                        ? 'whole day'
                        : `${buildSlots(day, draft.schedule, draft).length} shift${
                            buildSlots(day, draft.schedule, draft).length === 1
                              ? ''
                              : 's'
                          }`}
                    </span>
                  ) : (
                    <span className="small" style={{ color: 'var(--bad)' }}>
                      must end after it starts
                    </span>
                  )}
                </>
              ) : (
                <span className="small muted">not running</span>
              )}
            </div>
          )
        })}
        {activeDays(draft.schedule).length === 0 && (
          <div className="note error">
            Turn on at least one day, or there is nothing to schedule.
          </div>
        )}
      </div>

      <label>
        Base of operations{' '}
        <span className="muted">(where volunteers report and jars are counted)</span>
        <LocationField
          label="Base of operations"
          empty="Not set"
          locations={library}
          value={draft.baseLocationId ?? ''}
          onChange={(id) => onChange({ ...draft, baseLocationId: id || null })}
        />
      </label>
      <p className="small muted">
        Chosen from the location library, so its address, map link and contact come
        with it. It is not one of the year's staffed locations — it will not appear on
        the board or in the revenue ranking. Volunteers see it on their pass as where
        to report.
        {library.length === 0 &&
          ' Add it to the library first if it is not there yet.'}
      </p>

      <label>
        When they arrive at base
        <textarea
          rows={2}
          value={draft.arrivalNote}
          placeholder="Come here first to collect a jar and your apples."
          onChange={(e) => onChange({ ...draft, arrivalNote: e.target.value })}
        />
      </label>
      <p className="small muted" style={{ margin: '0 0 0.4rem' }}>
        Shown beside the address on every pass, once the schedule is published. Editing
        it here does not change a pass anybody is already holding — publish again and it
        does.
      </p>
      <p className="small muted" style={{ margin: '0 0 0.4rem' }}>
        Where a volunteer is going is not on their pass until an organizer checks them in.
        Everyone reports to base first, and a link that gets forwarded should not say where
        a named child will be standing.
      </p>

      <div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong className="small">Day-of contacts</strong>
          <button
            className="tiny"
            onClick={() =>
              onChange({
                ...draft,
                support: [...draft.support, blankContact()],
              })
            }
          >
            Add contact
          </button>
        </div>
        <p className="small muted" style={{ margin: '0.2rem 0' }}>
          Printed on every volunteer&apos;s pass. More than
          one, because base ops changes hands and a parent whose child is not where the
          schedule says needs somebody who answers.
        </p>
        {draft.support.length === 0 && (
          <p className="small muted">
            None yet. A pass with no way to reach anybody is a pass that sends a parent
            looking for the hall.
          </p>
        )}
        {draft.support.map((contact, i) => (
          <div key={i}>
          <div className="row" style={{ marginTop: '0.3rem' }}>
            <input
              aria-label={`Contact ${i + 1} name`}
              placeholder="Who to ask for"
              value={contact.name}
              style={{ flex: '1 1 9rem' }}
              onChange={(e) => setContact(i, { ...contact, name: e.target.value })}
            />
            <input
              aria-label={`Contact ${i + 1} phone`}
              placeholder="519-555-0100"
              inputMode="tel"
              value={contact.phone}
              style={{ flex: '1 1 8rem' }}
              onChange={(e) => setContact(i, { ...contact, phone: e.target.value })}
            />
            <input
              aria-label={`Contact ${i + 1} email`}
              placeholder="name@example.org"
              inputMode="email"
              value={contact.email}
              style={{ flex: '1 1 10rem' }}
              onChange={(e) => setContact(i, { ...contact, email: e.target.value })}
            />
            <button
              className="tiny danger"
              aria-label={`Remove contact ${i + 1}`}
              onClick={() =>
                onChange({
                  ...draft,
                  support: draft.support.filter((_, j) => j !== i),
                })
              }
            >
              Remove
            </button>
          </div>

          {/*
            Said here rather than discovered afterwards.

            A contact with no phone and no email is dropped on save — rightly, since
            this is printed on a pass as who to ring and a name on its own tells a
            parent nothing. But it used to be dropped in silence: you typed a name,
            pressed save, and it was simply gone with no word about why.
          */}
          {contact.name.trim() !== '' && !isReachable(contact) && (
            <p className="small" style={{ margin: '0.15rem 0 0', color: 'var(--warn)' }}>
              Add a phone number or an email, or this one will not be kept — a pass
              can only say to ring somebody if it can say how.
            </p>
          )}
          </div>
        ))}
        <label style={{ display: 'block', marginTop: '0.5rem' }}>
          Anything else to tell them
          <textarea
            rows={2}
            value={draft.supportNote}
            placeholder="Please arrive 15 minutes before your shift."
            onChange={(e) => onChange({ ...draft, supportNote: e.target.value })}
          />
        </label>
        <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
          Printed under the contacts on every pass, once the schedule is published. Editing
          it here does not change a pass anybody is already holding — publish again and it
          does.
        </p>
      </div>
    </>
  )
}
