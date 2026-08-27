import { sanitiseEventLink } from './eventLinks'
import { DEFAULT_SCHEDULE, DEFAULT_SHAPE } from './slots'
import { readSupport } from './support'
import { DAYS } from './types'
import type { AppleDayEvent, SchedulingWindow } from './types'

/**
 * Read a stored event.
 *
 * Pure and in the domain layer because this is the third time a converter has been the bug
 * and the first two were unreachable from any test: a status list that had drifted from its
 * type, a jar's shifts read from the wrong field, and an unset link that came back as
 * `event-0`. Every one of them was a correct write read back wrong, and every one of them
 * lived in a module that boots Firebase on import.
 */

/** A day is part of the event only if it has a sane window stored. */
function toWindow(raw: unknown): SchedulingWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const { startMin, endMin } = v
  if (typeof startMin !== 'number' || typeof endMin !== 'number') return null
  // A window that ends before it starts would render zero columns and no explanation.
  return endMin > startMin ? { startMin, endMin } : null
}

export function readEvent(id: string, d: Record<string, unknown>): AppleDayEvent {
  const schedule = (d.schedule ?? {}) as Record<string, unknown>

  /*
    The name settles the year when it says one.

    `year` is written once, when the event is created, so nothing else keeps it in step with
    a name edited afterwards. Left alone, an event renamed to "Apple Day 2025" goes on saying
    2026 — sorting under the wrong year and titling every screen that shows it. Reading it
    from the name corrects that on sight rather than waiting for somebody to save the event.

    Only when the name says: "Spring bottle drive" keeps whatever ordering it was given.
  */
  const stored = typeof d.year === 'number' ? d.year : Number(id) || 0
  const named = typeof d.name === 'string' ? yearFromName(d.name) : 0
  const year = named || stored

  return {
    id,
    // Events created before names existed fall back to their year, then their id.
    name:
      typeof d.name === 'string' && d.name.trim()
        ? d.name.trim()
        : year > 0
          ? `Apple Day ${year}`
          : id,
    year,
    /*
      Only ever what somebody deliberately chose. Defaulting it to the id would make every
      event look like it had a custom link and put the id in two places to keep in step.

      Sanitised, not slugified. `slugifyEventName` falls back to `event-<hash>` for input it
      cannot turn into a slug — right when naming a new event called "!!!", and catastrophic
      here: an unset link is stored as an empty string, whose hash is zero, so clearing the
      field read back as `event-0` and the link could not be unset at all.
    */
    slug: sanitiseEventLink(typeof d.slug === 'string' ? d.slug : ''),
    fridayDate: typeof d.fridayDate === 'string' ? d.fridayDate : '',
    saturdayDate: typeof d.saturdayDate === 'string' ? d.saturdayDate : '',
    // Reads the single `supportPhone` string every event carried before this.
    support: readSupport(d.support, d.supportPhone),
    supportNote: typeof d.supportNote === 'string' ? d.supportNote.trim() : '',
    arrivalNote: typeof d.arrivalNote === 'string' ? d.arrivalNote.trim() : '',
    baseLocationId: typeof d.baseLocationId === 'string' ? d.baseLocationId : null,
    // Absent on every event written before finishing existed, which is what "still running"
    // reads as — and the right answer for all of them.
    finishedAt: typeof d.finishedAt === 'number' && d.finishedAt > 0 ? d.finishedAt : null,
    shiftMode: d.shiftMode === 'wholeDay' ? 'wholeDay' : 'shifts',
    shiftMinutes:
      typeof d.shiftMinutes === 'number' && d.shiftMinutes >= 5
        ? d.shiftMinutes
        : DEFAULT_SHAPE.shiftMinutes,
    // Clamped below the shift length: an overlap as long as the shift would step nowhere.
    overlapMinutes:
      typeof d.overlapMinutes === 'number' && d.overlapMinutes >= 0
        ? Math.min(
            d.overlapMinutes,
            (typeof d.shiftMinutes === 'number' ? d.shiftMinutes : 60) - 5,
          )
        : DEFAULT_SHAPE.overlapMinutes,
    schedule: Object.fromEntries(
      DAYS.flatMap((day) => {
        const window = toWindow(schedule[day])
        return window ? [[day, window] as const] : []
      }),
    ),
  }
}

/** First Friday of October, which is how Apple Day has always been scheduled. */
export function defaultDatesFor(year: number): { fridayDate: string; saturdayDate: string } {
  const first = new Date(Date.UTC(year, 9, 1))
  const offsetToFriday = (5 - first.getUTCDay() + 7) % 7
  const friday = new Date(Date.UTC(year, 9, 1 + offsetToFriday))
  const saturday = new Date(friday.getTime() + 86_400_000)
  const iso = (d: Date): string => d.toISOString().slice(0, 10)
  return { fridayDate: iso(friday), saturdayDate: iso(saturday) }
}

/**
 * The year in an event's name, or 0.
 *
 * Only ever used for ordering and grouping, which is why an event named "Spring bottle
 * drive" is perfectly allowed to have none.
 */
function yearFromName(name: string): number {
  const found = /\b(20\d{2})\b/.exec(name)
  return found ? Number(found[1]) : 0
}

/**
 * A new event, filled in with what it would have defaulted to anyway.
 *
 * This exists so that creating an event and editing one are the same form over the same
 * shape. They were not: creating asked for a name and offered to copy last year's
 * locations, and everything else — the dates, the hours, the shift length, the base, the
 * contacts printed on every pass — could only be reached by creating the event first and
 * then opening it again in the editor. Nothing said so, so the ordinary path was to create
 * a year, look at a board built from defaults nobody chose, and work out that the settings
 * were behind a second button.
 *
 * Defaults rather than blanks, deliberately. An event with no days switched on has nothing
 * to schedule and no board to look at, so starting from the usual Friday evening and
 * Saturday means the form can be accepted as it stands — and every one of those defaults is
 * on screen where it can be changed before anything is written, rather than discovered
 * afterwards.
 */
export function blankEvent(
  name: string,
  year?: number,
  /**
   * The year to start from, usually the most recent one.
   *
   * How a group runs its Apple Day barely changes: the same hours, the same shift length,
   * the same hall, the same people to ring. Only the dates move. Starting from last year
   * means the form opens already describing this group rather than a generic one, and
   * every part of it is on screen to change before anything is written.
   *
   * The dates are never copied — they are the one thing that is certainly different.
   */
  from?: AppleDayEvent,
): AppleDayEvent {
  const trimmed = name.trim()
  const derived = year ?? yearFromName(trimmed)
  const dates = defaultDatesFor(derived || new Date().getUTCFullYear())

  if (from) {
    return {
      ...from,
      id: '',
      slug: '',
      name: trimmed,
      year: derived,
      fridayDate: dates.fridayDate,
      saturdayDate: dates.saturdayDate,
      // Copied a level down, for the same reason the defaults are.
      schedule: Object.fromEntries(
        Object.entries(from.schedule).map(([day, w]) => [day, { ...w }]),
      ),
      support: from.support.map((contact) => ({ ...contact })),
    }
  }

  return {
    id: '',
    slug: '',
    name: trimmed,
    year: derived,
    fridayDate: dates.fridayDate,
    saturdayDate: dates.saturdayDate,
    support: [],
    supportNote: '',
    arrivalNote: '',
    baseLocationId: null,
    finishedAt: null,
    /*
      Copied a level down, not spread. The windows are objects, and a shallow copy hands
      every draft the same ones — so editing Saturday's hours on a new event would edit the
      defaults that every later new event is built from.
    */
    schedule: Object.fromEntries(
      Object.entries(DEFAULT_SCHEDULE).map(([day, w]) => [day, { ...w }]),
    ),
    shiftMode: DEFAULT_SHAPE.shiftMode ?? 'shifts',
    shiftMinutes: DEFAULT_SHAPE.shiftMinutes,
    overlapMinutes: DEFAULT_SHAPE.overlapMinutes,
  }
}

/**
 * What to call an event on screen.
 *
 * Its name, which is the thing somebody chose and the thing they recognise. Charts and
 * tables label events with this, so a bar and the heading above it cannot disagree.
 *
 * Deliberately not the year. `year` is for ordering: it is written once when an event is
 * created and nothing keeps it in step with a name edited afterwards, so an event renamed
 * to "Apple Day 2025" went on being labelled 2026 everywhere it appeared. Beyond being
 * wrong it was never enough — an event is a named thing, and "Spring bottle drive" has no
 * year to be called by.
 *
 * The id only when there is no name at all, which is a record that should not exist. It at
 * least says which one is being looked at.
 */
export function eventLabel(event: Pick<AppleDayEvent, 'id' | 'name'>): string {
  return (event.name ?? '').trim() || event.id
}

/**
 * The year to store for an event, given what it is now called.
 *
 * A name that says which year it is settles it, so renaming an event fixes an ordering year
 * that had drifted from it. A name that says nothing leaves whatever was there — losing the
 * ordering of "Spring bottle drive" because its name has no digits in it would be a worse
 * answer than an old one.
 */
export function yearFor(name: string, current: number): number {
  return yearFromName(name) || current
}
