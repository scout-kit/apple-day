import { DAYS } from './types'
import type { Day, OpenRange, SchedulingWindow, Slot } from './types'

/**
 * Canonical slot definitions, and a parser for the messy time labels a Google Form and past
 * workbooks produce.
 *
 * Every slot is `${day}-${HHMM}` in 24-hour form. The parser resolves a 12-hour label by
 * asking which reading falls inside that day's window: with Friday running 17:00–21:00 and
 * Saturday 07:00–15:00, `5:00` on Friday can only be 17:00 and `1:00` on Saturday can only
 * be 13:00.
 *
 * Without that, a Friday-evening `8:00 - 9:00` and a Saturday-morning `8:00 - 9:00` are
 * the same string.
 */

/** The window a new event starts with. Every event stores its own, editable on Events. */
export const DEFAULT_SCHEDULE: Partial<Record<Day, SchedulingWindow>> = {
  fri: { startMin: 17 * 60, endMin: 21 * 60 },
  sat: { startMin: 7 * 60, endMin: 15 * 60 },
}

/** The fallback for code with no event in hand. Prefer passing the event's own window. */
export const DAY_WINDOW = DEFAULT_SCHEDULE

/**
 * How long a shift is, and how much it overlaps the one before it.
 *
 * Overlap is a handover: the next pair arrive while the current ones are still there. It
 * shortens the gap between shift starts without shortening a shift, so 60 minute shifts
 * overlapping by 15 start 45 minutes apart.
 */
export interface SlotShape {
  /** `wholeDay` collapses each day to one slot spanning its whole window. */
  shiftMode?: 'shifts' | 'wholeDay'
  shiftMinutes: number
  overlapMinutes: number
}

export const DEFAULT_SHAPE: SlotShape = {
  shiftMode: 'shifts',
  shiftMinutes: 60,
  overlapMinutes: 0,
}

/** Minutes between one shift starting and the next. Never less than 5. */
export function stepMinutes(shape: SlotShape): number {
  return Math.max(5, shape.shiftMinutes - shape.overlapMinutes)
}

/** How early and late a location's opening hours may be set. */
export const HOURS_RANGE = { earliestMin: 0, latestMin: 24 * 60 }

export const DAY_LABEL: Record<Day, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
}

/** Three-letter form, for tight headers and day toggles. */
export const DAY_SHORT: Record<Day, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
}

/** The days an event runs, in week order. */
export function activeDays(
  schedule: Partial<Record<Day, SchedulingWindow>>,
): Day[] {
  return DAYS.filter((d) => {
    const w = schedule[d]
    return w !== undefined && w.endMin > w.startMin
  })
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

export function slotId(day: Day, startMin: number): string {
  return `${day}-${pad(Math.floor(startMin / 60))}${pad(startMin % 60)}`
}

/**
 * `1020` -> `"5:00 PM"`. Display only, never a key.
 *
 * 24:00 is the end of the day, not noon: without the wrap, a shop open until midnight
 * renders as "12:00 PM", which reads as lunchtime.
 */
export function formatTime(min: number): string {
  const h24 = Math.floor(min / 60) % 24
  const m = min % 60
  const suffix = h24 >= 12 ? 'PM' : 'AM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${pad(m)} ${suffix}`
}

export function formatSlotLabel(startMin: number, endMin: number): string {
  return `${formatTime(startMin)} – ${formatTime(endMin)}`
}

/**
 * Build the slots covering a day's scheduling window.
 *
 * Ids stay `${day}-${HHMM}`, so widening an event's window adds columns without renaming
 * the ones already assigned, and shortening it leaves out-of-range assignments addressable
 * rather than orphaned.
 */
export function buildSlots(
  day: Day,
  schedule: Partial<Record<Day, SchedulingWindow>> = DEFAULT_SCHEDULE,
  shape: SlotShape = DEFAULT_SHAPE,
): Slot[] {
  const window = schedule[day]
  // A day the event does not run has no slots, rather than a zero-length window.
  if (!window) return []

  const { startMin, endMin } = window

  // One slot for the whole day: people come for the duration, not for an hour of it.
  if (shape.shiftMode === 'wholeDay') {
    if (endMin <= startMin) return []
    return [
      {
        id: slotId(day, startMin),
        day,
        startMin,
        endMin,
        label: formatSlotLabel(startMin, endMin),
      },
    ]
  }

  const length = Math.max(5, shape.shiftMinutes)
  const step = stepMinutes(shape)

  const slots: Slot[] = []
  // A shift has to finish inside the window: a trailing part-shift would send somebody out
  // after the event has packed up.
  for (let t = startMin; t + length <= endMin; t += step) {
    slots.push({
      id: slotId(day, t),
      day,
      startMin: t,
      endMin: t + length,
      label: formatSlotLabel(t, t + length),
    })
  }

  // A window shorter than one shift still gets a single clipped shift, rather than no way
  // to staff the day at all.
  if (slots.length === 0 && endMin > startMin) {
    slots.push({
      id: slotId(day, startMin),
      day,
      startMin,
      endMin,
      label: formatSlotLabel(startMin, endMin),
    })
  }
  return slots
}

export function buildAllSlots(
  schedule: Partial<Record<Day, SchedulingWindow>> = DEFAULT_SCHEDULE,
  shape: SlotShape = DEFAULT_SHAPE,
): Slot[] {
  return DAYS.flatMap((day) => buildSlots(day, schedule, shape))
}

/**
 * Is a location open for the whole of this slot?
 *
 * The slot must sit entirely inside the opening hours. A shop that opens at 09:30 is not
 * staffable for the 09:00 hour, and treating it as available puts a youth at a locked door.
 */
export function isOpenDuring(range: OpenRange | null | undefined, slot: Slot): boolean {
  if (!range) return false
  return range.openMin <= slot.startMin && range.closeMin >= slot.endMin
}

/**
 * Are real opening hours recorded for this day?
 *
 * `openHours` is a partial record, so a day can be absent, explicitly null, or hold a
 * backwards range. A plain `!== null` is true for the first of those, which shows an "open"
 * switch above the word "Closed".
 */
export function isOpenOn(
  openHours: Partial<Record<Day, OpenRange | null>>,
  day: Day,
): boolean {
  const range = openHours[day]
  return Boolean(range && range.closeMin > range.openMin)
}

/**
 * Has anyone made a decision about this day, either way?
 *
 * Three states, two of which look identical on screen: a valid range (open for those
 * hours), an explicit null (marked closed all day), and the key being absent (nobody has
 * said).
 *
 * Only the first two are a recorded decision, and only they justify stopping an organizer
 * from scheduling. Refusing on the third makes a location whose hours were never captured
 * impossible to staff.
 */
export function isHoursRecorded(
  openHours: Partial<Record<Day, OpenRange | null>>,
  day: Day,
): boolean {
  return Object.prototype.hasOwnProperty.call(openHours, day)
}

/**
 * `{openMin: 420, closeMin: 1260}` -> `"7:00 AM – 9:00 PM"`.
 *
 * Answers the same question as {@link isOpenOn}, so the text under a day switch cannot
 * disagree with the switch itself.
 */
export function formatOpenRange(range: OpenRange | null | undefined): string {
  if (!range || range.closeMin <= range.openMin) return 'Closed'
  if (range.openMin === 0 && range.closeMin >= 24 * 60) return 'Open 24 hours'
  const close = range.closeMin >= 24 * 60 ? 'midnight' : formatTime(range.closeMin)
  return `${formatTime(range.openMin)} – ${close}`
}

/**
 * Minutes from midnight as an `<input type="time">` value.
 *
 * Times are stored as minutes because that is what the slot maths needs; a time input
 * speaks `HH:MM`.
 */
export function minutesToTimeValue(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)))
  return `${pad(Math.floor(clamped / 60))}:${pad(clamped % 60)}`
}

/**
 * An `HH:MM` value back to minutes, or null if it is not a usable time.
 *
 * Null rather than zero: a half-typed or cleared field must leave the stored time alone,
 * not reset the day to midnight.
 */
export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Every quarter-hour on the clock, for the open/close dropdowns. */
export function hourOptions(stepMin = 15): { min: number; label: string }[] {
  const out: { min: number; label: string }[] = []
  for (let t = HOURS_RANGE.earliestMin; t <= HOURS_RANGE.latestMin; t += stepMin) {
    out.push({ min: t, label: t === 24 * 60 ? 'midnight' : formatTime(t) })
  }
  return out
}

export function slotDurationHours(slot: Slot): number {
  return (slot.endMin - slot.startMin) / 60
}

export interface SlotParseSuccess {
  ok: true
  slotId: string
  startMin: number
}

export interface SlotParseFailure {
  ok: false
  reason: 'empty' | 'unparseable' | 'outsideWindow' | 'ambiguous'
  input: string
}

export type SlotParse = SlotParseSuccess | SlotParseFailure

/**
 * Parse a bare clock token, tolerating the forms that actually appear in sheets and form
 * exports: `5`, `5:00`, `5.00`, and the missing-colon `500` / `1700`.
 */
interface Clock {
  hour: number
  minute: number
  /**
   * Whether the hour is already the 24-hour one.
   *
   * True when the label said am or pm. Nothing then has to be guessed from the day's
   * window, and "7:00 PM" on a Saturday running 9–3 is out of hours rather than 7am.
   */
  exact: boolean
}

function parseClock(token: string): Clock | null {
  if (!token) return null

  /*
    An am or pm suffix settles the hour outright, and this app writes its own shift labels
    that way — "5:00 PM – 6:00 PM" is what the schedule shows and what a form built from it
    would offer back. Without this every one of them is unreadable.
  */
  const meridiem = /^(.*?)\s*([ap])\.?\s*m\.?$/i.exec(token)
  const body = (meridiem ? meridiem[1] ?? '' : token).trim()

  const digits = readDigits(body)
  if (!digits) return null
  if (!meridiem) return { ...digits, exact: false }

  const { hour, minute } = digits
  /*
    Past twelve, the suffix is noise rather than information: somebody has written "17:00
    PM", and seventeen o'clock is seventeen o'clock whichever half of the day they thought
    it was in. Taking the hour and ignoring the suffix cannot be wrong; refusing the label
    would drop availability somebody really did offer.
  */
  if (hour > 12) return { hour, minute, exact: true }

  const afternoon = (meridiem[2] ?? '').toLowerCase() === 'p'
  const noonOrMidnight = hour === 12
  return {
    hour: afternoon ? (noonOrMidnight ? 12 : hour + 12) : noonOrMidnight ? 0 : hour,
    minute,
    exact: true,
  }
}

/** The digits of a clock time, in whichever of the written forms it arrived in. */
function readDigits(token: string): { hour: number; minute: number } | null {
  const withSeparator = /^(\d{1,2})[:.](\d{1,2})$/.exec(token)
  if (withSeparator) {
    const hour = Number(withSeparator[1])
    const minute = Number(withSeparator[2])
    return minute < 60 ? { hour, minute } : null
  }

  const bare = /^(\d{1,4})$/.exec(token)
  if (!bare || bare[1] === undefined) return null
  const digits = bare[1]

  // 3 or 4 digits are HMM / HHMM; 1 or 2 digits are a whole hour.
  if (digits.length >= 3) {
    const hour = Number(digits.slice(0, digits.length - 2))
    const minute = Number(digits.slice(-2))
    return minute < 60 ? { hour, minute } : null
  }
  return { hour: Number(digits), minute: 0 }
}

/**
 * Resolve one time label for a given day into a canonical slot id.
 *
 * Accepts the shapes that turn up in practice: `5:00 - 6:00`, `500 - 6:00`, `8:00 - 9;00`,
 * `12:00 - 1:00`, en- and em-dash separators, 24-hour labels, and `5:00 PM – 6:00 PM` —
 * which is how this app writes its own shift labels, and so how a form built from them
 * would offer them back.
 */
export function parseSlotLabel(
  day: Day,
  raw: string,
  schedule: Partial<Record<Day, SchedulingWindow>> = DEFAULT_SCHEDULE,
  shape: SlotShape = DEFAULT_SHAPE,
): SlotParse {
  const input = raw.trim()
  if (!input) return { ok: false, reason: 'empty', input: raw }

  // Only the start time matters — the end is implied by the grid. Split on the range
  // separator first, so a malformed start like `500` cannot swallow digits from the end.
  const startToken = input.replace(/;/g, ':').split(/[-\u2013\u2014]/)[0]?.trim() ?? ''
  const clock = parseClock(startToken)
  if (!clock) return { ok: false, reason: 'unparseable', input: raw }
  const { hour, minute } = clock

  const window = schedule[day]
  if (!window) return { ok: false, reason: 'outsideWindow', input: raw }
  const { startMin: windowStart, endMin: windowEnd } = window

  /*
    Which reading of this clock time lands inside the day's operating window?

    Only asked of a label that did not say. One that wrote am or pm has already answered,
    and second-guessing it would turn a 7pm answer on a morning-only Saturday into 7am —
    an hour somebody never offered, quietly added to the board.
  */
  const readings = clock.exact ? [hour] : [...new Set([hour, hour + 12, hour - 12])]
  const candidates = readings
    .map((h) => h * 60 + minute)
    .filter((t) => t >= windowStart && t < windowEnd)

  if (candidates.length === 0) return { ok: false, reason: 'outsideWindow', input: raw }
  if (candidates.length > 1) return { ok: false, reason: 'ambiguous', input: raw }

  const wanted = candidates[0]!

  /*
   * Snap to a real shift rather than trusting the clock time.
   *
   * Once shifts overlap they no longer start on the hour: 60 minute shifts overlapping by
   * 15 start at 5:00, 5:45, 6:30. A form still offering "6:00 – 7:00" would otherwise give
   * a slot id that does not exist, and the availability would read as "not free".
   */
  const daySlots = buildSlots(day, schedule, shape)
  if (daySlots.length === 0) return { ok: false, reason: 'outsideWindow', input: raw }

  let nearest: Slot = daySlots[0]!
  for (const slot of daySlots) {
    if (Math.abs(slot.startMin - wanted) < Math.abs(nearest.startMin - wanted)) nearest = slot
  }

  // A form answer is normally a shift label, so its start time identifies the shift.
  const tolerance = Math.max(30, Math.floor(shape.shiftMinutes / 2))
  if (Math.abs(nearest.startMin - wanted) <= tolerance) {
    return { ok: true, slotId: nearest.id, startMin: nearest.startMin }
  }

  /*
   * Otherwise fall back to whichever slot the time falls inside. This is what makes a
   * whole-day event work: its single slot starts at the beginning of the day, so "8:00 PM"
   * is hours from that start but plainly inside the day.
   */
  const containing = daySlots.find(
    (slot) => wanted >= slot.startMin && wanted < slot.endMin,
  )
  if (containing) return { ok: true, slotId: containing.id, startMin: containing.startMin }

  return { ok: false, reason: 'outsideWindow', input: raw }
}

/**
 * Parse a Google Form multi-select answer — a comma-joined list of time labels — into
 * canonical slot ids.
 *
 * Unparseable entries come back separately rather than being dropped, which is how
 * availability goes quietly missing.
 */
export function parseAvailability(
  day: Day,
  raw: string | null | undefined,
  schedule: Partial<Record<Day, SchedulingWindow>> = DEFAULT_SCHEDULE,
  shape: SlotShape = DEFAULT_SHAPE,
): { slotIds: string[]; problems: SlotParseFailure[] } {
  if (!raw || !raw.trim()) return { slotIds: [], problems: [] }

  const slotIds: string[] = []
  const problems: SlotParseFailure[] = []

  for (const part of raw.split(',')) {
    if (!part.trim()) continue
    const parsed = parseSlotLabel(day, part, schedule, shape)
    if (parsed.ok) {
      if (!slotIds.includes(parsed.slotId)) slotIds.push(parsed.slotId)
    } else {
      problems.push(parsed)
    }
  }

  return { slotIds, problems }
}
