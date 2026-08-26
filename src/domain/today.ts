import { DAYS } from './types'
import type { AppleDayEvent, Day, Slot } from './types'

/**
 * Which day of the event today is.
 *
 * The screens that run the event — the board, the day-of table, the jar count — all opened
 * on Friday whatever the date was, so on the Saturday morning the first thing anybody did
 * was reach for the day switch. On the busiest morning of the year that is a wrong screen
 * shown to somebody in a hurry.
 *
 * The event stores a start and an end date, so the day each configured weekday falls on is
 * known exactly. Nothing is guessed from the weekday alone: on some *other* Saturday in
 * March, "today" is not a day of the event and the screens open where they always did.
 */

/** The viewer's own calendar date as `YYYY-MM-DD`, which is how event dates are stored. */
export function localDate(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** A `YYYY-MM-DD` string as a UTC date, or null if it is not one. */
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The date each of the event's days falls on.
 *
 * Walked from the start date to the end so a Sunday event, or a one-day event, works the
 * same as the usual Friday-and-Saturday. Capped at a fortnight: a mistyped end date should
 * not spin, and no Apple Day runs longer than that.
 */
export function datesForEventDays(
  event: Pick<AppleDayEvent, 'fridayDate' | 'saturdayDate' | 'schedule'>,
): Map<Day, string> {
  const start = parseDate(event.fridayDate)
  const end = parseDate(event.saturdayDate) ?? start
  const dates = new Map<Day, string>()
  if (!start || !end || end.getTime() < start.getTime()) return dates

  const runs = new Set(Object.keys(event.schedule) as Day[])
  for (let i = 0; i < 14; i += 1) {
    const at = new Date(start.getTime() + i * 86_400_000)
    if (at.getTime() > end.getTime()) break
    const day = DAYS[at.getUTCDay()]!
    // First occurrence wins, so a fortnight-long span cannot overwrite the real first day.
    if (runs.has(day) && !dates.has(day)) dates.set(day, localDate(atUtcNoon(at)))
  }
  return dates
}

/** Midday UTC, so formatting the date locally cannot roll it back a day. */
function atUtcNoon(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12),
  )
}

/** Which of the event's days is today, or null when today is not one of them. */
export function todaysEventDay(
  event: Pick<AppleDayEvent, 'fridayDate' | 'saturdayDate' | 'schedule'>,
  now: Date,
): Day | null {
  const today = localDate(now)
  for (const [day, date] of datesForEventDays(event)) {
    if (date === today) return day
  }
  return null
}

/**
 * The slot happening right now, or the next one to come.
 *
 * The next one rather than nothing, because the gap between shifts is exactly when somebody
 * is getting the following hour ready. Null once the day is over.
 */
export function currentSlot(slots: Slot[], day: Day, now: Date): Slot | null {
  const minutes = now.getHours() * 60 + now.getMinutes()
  const today = slots
    .filter((s) => s.day === day)
    .sort((a, b) => a.startMin - b.startMin)

  return (
    today.find((s) => minutes >= s.startMin && minutes < s.endMin) ??
    today.find((s) => s.startMin > minutes) ??
    null
  )
}
