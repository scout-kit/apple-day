import {
  attributeJarRevenue,
  coveredHoursByLocation,
  coveredSpansByLocation,
  isCollecting,
  splitByWeight,
  unionMinutes,
} from './metrics'
import { countedWindows } from './countedHours'
import { DAY_SHORT, formatTime } from './slots'
import { DAYS, isCounted, wasWorked } from './types'
import { eventLabel } from './events'
import type { AppleDayEvent, Assignment, Day, Jar, Slot } from './types'

/**
 * One event compared with the others.
 *
 * Last year's results are the evidence for this year's choices — that is the whole reason
 * the app holds several events rather than one — and until now nothing put them side by
 * side. The location library is shared and its ids are stable, so a location keeps its
 * identity across years without any name matching: "Braemar is down and Kelmont is up" is a
 * question the data can already answer.
 */

export interface EventTotals {
  eventId: string
  name: string
  year: number
  /** Sort key: the event's own start date, falling back to its year. */
  startedAt: string
  revenue: number
  /** Person-hours worked. Two siblings for an hour is 2. Base included. */
  staffedHours: number
  /**
   * Of those, the ones spent at base — check-in, apples, cooking, counting the money.
   *
   * Real hours somebody gave, and reported as such. Kept out of the rate below, because no
   * money came in against them.
   */
  baseHours: number
  /**
   * Clock hours the event was out collecting: the union of the blocks it staffed, per day.
   *
   * How long the evening ran, not how much of it people gave — a Friday staffed from five
   * till nine is four, whether two people were out or twenty. Blocks, not shifts, because
   * an event whose first block opens at a quarter to five was running then.
   */
  clockHours: number
  /**
   * Revenue divided by the hours spent out collecting. Per *person*-hour.
   *
   * What an hour of somebody's evening was worth, which moves with how thickly the event
   * was staffed. The money screen's headline calls this "per person-hour"; see
   * {@link revenuePerClockHour} for the one it calls "per hour".
   */
  revenuePerHour: number | null
  /**
   * Revenue divided by {@link clockHours}: what an hour of the event itself was worth.
   *
   * The same figure as the money screen's "per hour" headline for that event, and the one
   * to read year on year — it does not fall when a year turns out more volunteers.
   */
  revenuePerClockHour: number | null
  /** Distinct people who actually worked a shift. */
  volunteers: number
  /** Locations that took money. */
  earningLocations: number
}

/** What one event contributed, before it is compared with anything. */
export interface EventData {
  event: AppleDayEvent
  assignments: Assignment[]
  jars: Jar[]
  slots: Slot[]
}

const round2 = (n: number): number => Math.round(n * 100) / 100

export function eventTotals(data: EventData): EventTotals {
  const { event, assignments, jars, slots } = data
  const bySlot = new Map(slots.map((s) => [s.id, s]))
  // Only shifts somebody worked, so a year's rate is not divided by a board nobody turned
  // up for — the same basis the money screen defaults to.
  const worked = assignments.filter(wasWorked)

  let staffedHours = 0
  let baseHours = 0
  const volunteers = new Set<string>()
  // Which blocks the event actually had somebody out for. An hour staffed only at base is
  // an hour the table was open and the street was empty, so it is not time spent earning.
  const outAt = new Set<string>()
  const counted = countedWindows(worked, slots)
  for (const a of worked) {
    const slot = bySlot.get(a.slotId)
    if (!slot) continue
    const window = counted.get(a.id)
    const hours = window ? (window.to - window.from) / 60 : 0
    staffedHours += hours
    if (!isCollecting(a, event.baseLocationId)) baseHours += hours
    else if (hours > 0) outAt.add(slot.id)
    // A shift whose hours were all covered by the one before it is still somebody's turn
    // out, so they count as a volunteer either way.
    volunteers.add(a.personId)
  }

  /*
    How many jars an event used is not a fact about the event.

    It counted tins, which is a function of how many the group happens to own and how many
    times each went out — a year with forty jars going out twice reads as half a year with
    eighty going out once, for the same money and the same hours. It sat in the year-by-year
    table next to figures that do compare, which is what made it look like one of them.
  */
  let revenue = 0
  const earning = new Set<string>()
  for (const jar of jars) {
    if (!isCounted(jar)) continue
    revenue = round2(revenue + jar.amount)
    if (jar.amount > 0) earning.add(jar.locationId)
  }

  staffedHours = round2(staffedHours)
  baseHours = round2(baseHours)
  /*
    The hours the money actually came from.

    A group that puts four people on the table all day adds a working day to the denominator
    and nothing to the numerator, so its rate falls the better it is staffed. That is the
    opposite of what the figure is read for.
  */
  const collecting = round2(staffedHours - baseHours)

  /*
    How long the evening ran, as the clock saw it.

    The union of the blocks somebody was out for, merged per day — not their sum. Blocks
    overlap where a year ran a handover, and adding their durations counts the same quarter
    of an hour twice. Per day, because 5pm Friday and 5pm Saturday are not the same stretch.

    The shift, not the block: the quarter of an hour at the front is check-in, which happens
    at base, so no shop is being covered and no money can arrive during it. Counting it gave
    an evening of four hour-long shifts as 4.25 hours — a figure the schedule cannot produce
    and nobody can account for.

    Worked out the same way as the money screen's clock hours, so an event's row here and
    its own money screen agree about what an hour of it was worth.
  */
  const running = slots.filter((s) => outAt.has(s.id))
  const clockHours = round2(
    DAYS.reduce(
      (total, day) =>
        total +
        unionMinutes(
          running
            .filter((s) => s.day === day)
            .map((s) => [s.workStartMin, s.endMin] as const),
        ),
      0,
    ) / 60,
  )

  return {
    eventId: event.id,
    name: event.name,
    year: event.year,
    startedAt: event.fridayDate || String(event.year || ''),
    revenue,
    staffedHours,
    baseHours,
    clockHours,
    // Null rather than a fallback to the raw total, as everywhere else.
    revenuePerHour: collecting > 0 ? round2(revenue / collecting) : null,
    revenuePerClockHour: clockHours > 0 ? round2(revenue / clockHours) : null,
    volunteers: volunteers.size,
    earningLocations: earning.size,
  }
}

/** Every event, oldest first, which is the direction a trend is read in. */
export function buildHistory(events: EventData[]): EventTotals[] {
  return events
    .map(eventTotals)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.year - b.year)
}

/**
 * Which events a lookback holds side by side.
 *
 * Every year at once was the wrong default. The question being asked of this screen is
 * almost always "how are we doing against last year" — and a chart with five series, four
 * of which nobody asked about, answers it worse than a chart with two. Wider comparisons
 * are still a click away, because the year a location was worth double is a real question,
 * just not the first one.
 *
 * `against` names the event to compare with: `null` takes the one immediately before the
 * current, `ALL_EVENTS` keeps every one of them, and anything else is chosen by hand.
 * Always oldest first, the direction a trend is read in.
 */
export const ALL_EVENTS = 'all'

/**
 * The parts of an event that decide where it sits in a run of years.
 *
 * Deliberately not `EventData`. Which years a lookback covers is answerable from the event
 * list alone — three fields, already in context. Answering it from fully loaded shifts and
 * jars would mean reading every year that has ever run in order to display two of them. The
 * selection has to come first, so that only the selected years are ever fetched.
 */
export interface EventLike {
  id: string
  year: number
  fridayDate: string
}

/** Where an event sits in the run: its date if it has one, its year otherwise. */
const startKey = (e: EventLike): string => e.fridayDate || String(e.year)

/** Oldest first, which is the direction a trend is read in. */
function orderEvents<E extends EventLike>(all: E[]): E[] {
  return [...all].sort((a, b) => startKey(a).localeCompare(startKey(b)) || a.year - b.year)
}

export function lookbackEvents<E extends EventLike>(
  all: E[],
  currentId: string | null,
  against: string | null,
): E[] {
  const ordered = orderEvents(all)
  if (against === ALL_EVENTS) return ordered

  const current = ordered.find((e) => e.id === currentId)
  // No current event to anchor on — an archive opened on its own, say. Show the lot rather
  // than silently picking one, which would be a different screen than the one asked for.
  if (!current) return ordered

  const other = against
    ? ordered.find((e) => e.id === against && e.id !== currentId)
    : previousEvent(ordered, currentId)

  return other ? ordered.filter((e) => e === other || e === current) : [current]
}

/**
 * Which years a lookback needs, oldest first.
 *
 * The whole point of the split: this is answered from the event list, before anything is
 * read, so the fetch can be exactly as wide as the screen.
 */
export function lookbackIds<E extends EventLike>(
  all: E[],
  currentId: string | null,
  against: string | null,
): string[] {
  return lookbackEvents(all, currentId, against).map((e) => e.id)
}

/** The event immediately before this one, or null when it is the earliest there is. */
export function previousEvent<E extends EventLike>(
  all: E[],
  currentId: string | null,
): E | null {
  const ordered = orderEvents(all)
  const at = ordered.findIndex((e) => e.id === currentId)
  return at > 0 ? ordered[at - 1]! : null
}


/**
 * What to call each event, when they are shown together.
 *
 * Their names, through {@link eventLabel} — one rule, so a bar in a chart, the column above
 * it and the heading over the page all say the same thing.
 *
 * A map rather than a function call at each site because these are read inside render
 * loops, and because a screen showing several events should resolve them all the same way.
 */
export function eventLabels(
  events: { eventId: string; name: string; year: number }[],
): Map<string, string> {
  return new Map(
    events.map((e) => [e.eventId, eventLabel({ id: e.eventId, name: e.name })]),
  )
}

/** The change from one event to the next, as a signed fraction, or null when it is new. */
export function changeFrom(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null || previous === 0) return null
  return round2((current - previous) / previous)
}

export interface LocationTrendCell {
  eventId: string
  revenue: number
  /** Person-hours worked there that year. Two youth on one shift is 2. */
  staffedHours: number
  /** Clock hours the door was covered that year. Two youth on one shift is 1. */
  coveredHours: number
  /** Revenue per person-hour: what an hour of somebody's evening there was worth. */
  revenuePerHour: number | null
  /** Revenue per hour the door was covered: what the door itself was worth. */
  revenuePerCoveredHour: number | null
}

/*
  What a cell is measuring. Three readings of a row, and each answers a different question.

  Hours itself was once a fourth, and it answered a question about effort rather than about
  takings: it belongs to the money screen, where an hour is being planned, rather than to a
  history read to decide where to stand next year.

  The two rates disagree exactly where people doubled up. `perHour` divides by the time the
  door was covered, so it says what the door was worth whoever was sent to it; `perPersonHour`
  divides by the time people gave, so it halves when two go instead of one. Sending a pair is
  a staffing decision, and reading it as a fact about the shop is how a busy door ends up
  looking like a poor one.
*/
export type TrendMeasure = 'revenue' | 'perHour' | 'perPersonHour'

/** The three readings a trend cell can be shown under. */
export interface TrendValues {
  revenue: number
  revenuePerHour: number | null
  revenuePerCoveredHour: number | null
}

/**
 * The number a cell shows under the chosen measure.
 *
 * One place, because three tables and two charts pick it, and a measure that means the
 * door's rate in one of them and somebody's evening in another is the defect this whole
 * split exists to remove.
 */
export function trendValue(cell: TrendValues, measure: TrendMeasure): number | null {
  if (measure === 'revenue') return cell.revenue
  return measure === 'perHour' ? cell.revenuePerCoveredHour : cell.revenuePerHour
}

export interface LocationTrendRow {
  locationId: string
  name: string
  cells: LocationTrendCell[]
  /** Total across every event, for ordering the table by what matters most. */
  revenue: number
  /** Change between the two most recent events it appeared in, per measure. */
  changes: Record<TrendMeasure, number | null>
}

/**
 * Each location's takings, event by event.
 *
 * Grouped by location id, which is why the library is global: a location written three ways
 * across two years is still one row, without the fuzzy name matching the workbook needed.
 * A location with no row in a given event was not used that year, which is different from
 * earning nothing — the cell is empty rather than zero.
 */
export function locationTrends(
  events: EventData[],
  names: Map<string, string>,
): { events: EventTotals[]; rows: LocationTrendRow[] } {
  const history = buildHistory(events)
  const order = history.map((h) => h.eventId)
  const byId = new Map(events.map((e) => [e.event.id, e]))

  const revenue = new Map<string, Map<string, number>>()
  const hours = new Map<string, Map<string, number>>()
  const covered = new Map<string, Map<string, number>>()
  const used = new Map<string, Set<string>>()

  const bump = (
    into: Map<string, Map<string, number>>,
    locationId: string,
    eventId: string,
    amount: number,
  ): void => {
    const row = into.get(locationId) ?? new Map<string, number>()
    row.set(eventId, round2((row.get(eventId) ?? 0) + amount))
    into.set(locationId, row)
  }

  for (const eventId of order) {
    const data = byId.get(eventId)
    if (!data) continue
    const bySlot = new Map(data.slots.map((s) => [s.id, s]))

    /*
      Base is left out of this table entirely.

      It is a comparison of places to send people, and base is not one of them: it has hours
      every year and takes nothing, so a row for it is a permanent $0/hr at the bottom of a
      ranking read for where to go next year.
    */
    const worked = data.assignments
      .filter(wasWorked)
      .filter((a) => isCollecting(a, data.event.baseLocationId))
    const counted = countedWindows(worked, data.slots)
    for (const a of worked) {
      const slot = bySlot.get(a.slotId)
      if (!slot) continue
      const window = counted.get(a.id)
      bump(hours, a.locationId, eventId, window ? (window.to - window.from) / 60 : 0)
      used.set(a.locationId, (used.get(a.locationId) ?? new Set()).add(eventId))
    }

    // The other kind of hour: how long each door was worked, counting a pair once.
    for (const [locationId, hrs] of coveredHoursByLocation(worked, data.slots)) {
      bump(covered, locationId, eventId, hrs)
    }

    for (const jar of data.jars) {
      if (!isCounted(jar)) continue
      bump(revenue, jar.locationId, eventId, jar.amount)
      used.set(jar.locationId, (used.get(jar.locationId) ?? new Set()).add(eventId))
    }
  }

  const rows: LocationTrendRow[] = [...used.keys()]
    .map((locationId) => {
      const cells = order.map((eventId) => {
        const rev = revenue.get(locationId)?.get(eventId) ?? 0
        const hrs = round2(hours.get(locationId)?.get(eventId) ?? 0)
        const door = round2(covered.get(locationId)?.get(eventId) ?? 0)
        return {
          eventId,
          revenue: rev,
          staffedHours: hrs,
          coveredHours: door,
          revenuePerHour: hrs > 0 ? round2(rev / hrs) : null,
          revenuePerCoveredHour: door > 0 ? round2(rev / door) : null,
        }
      })
      // The two most recent events this location was actually used in, so a year off does
      // not read as a collapse to zero.
      const appeared = order.filter((eventId) => used.get(locationId)?.has(eventId))
      const at = (eventId: string | undefined): LocationTrendCell | null =>
        eventId === undefined ? null : (cells.find((c) => c.eventId === eventId) ?? null)
      const last = at(appeared[appeared.length - 1])
      const before = at(appeared[appeared.length - 2])

      return {
        locationId,
        name: names.get(locationId) ?? locationId,
        cells,
        revenue: round2(cells.reduce((n, c) => n + c.revenue, 0)),
        changes: {
          revenue: changeFrom(before?.revenue ?? null, last?.revenue ?? null),
          perHour: changeFrom(
            before?.revenuePerCoveredHour ?? null,
            last?.revenuePerCoveredHour ?? null,
          ),
          perPersonHour: changeFrom(
            before?.revenuePerHour ?? null,
            last?.revenuePerHour ?? null,
          ),
        },
      }
    })
    .sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name))

  return { events: history, rows }
}

/**
 * One clock hour of one day: "Friday, the 5pm hour".
 *
 * Events do not share their slots. One year runs 60-minute shifts on the hour; the next
 * overlaps them by fifteen and starts every 45 minutes, so its slot ids are different
 * strings covering different spans. Comparing "by hour" across years therefore cannot use
 * slots at all — it needs a bucket that exists independently of how any year chose to cut
 * the evening up, and the clock is the only one there is.
 */
export interface HourKey {
  day: Day
  /** 0–23, the hour the money is being attributed to. */
  hour: number
}

export interface HourTrendCell {
  eventId: string
  revenue: number
  /** Person-hours worked in this hour, at the locations being counted. */
  staffedHours: number
  /**
   * Door-hours covered in this hour: how many of those doors had somebody at them.
   *
   * Three shops worked for the whole hour is 3, however many youth were sent to each.
   */
  coveredHours: number
  /** Revenue per person-hour — what an hour of somebody's evening was worth. */
  revenuePerHour: number | null
  /** Revenue per door-hour — what an hour at one of those doors was worth. */
  revenuePerCoveredHour: number | null
  /** False when this event did not run at this hour at all — different from earning zero. */
  ran: boolean
}

export interface HourTrendRow extends HourKey {
  label: string
  cells: HourTrendCell[]
  revenue: number
  /** Change between the two most recent events that ran this hour, per measure. */
  changes: Record<TrendMeasure, number | null>
}

/**
 * Takings by clock hour, event by event, for one location or for all of them.
 *
 * A shift that straddles two hours has its takings divided between them in proportion to
 * the minutes it spends in each — a 5:45 to 6:45 shift is a quarter in the 5pm hour and
 * three quarters in the 6pm one. Rounding it to whichever hour it started in would put a
 * whole evening of overlapped shifts an hour earlier than it happened.
 */
export function hourlyTrends(
  events: EventData[],
  /** Which locations to add together. Null means every one of them. */
  locationIds: string[] | null,
): { events: EventTotals[]; rows: HourTrendRow[] } {
  const wanted = locationIds === null ? null : new Set(locationIds)
  const history = buildHistory(events)
  const order = history.map((h) => h.eventId)
  const byId = new Map(events.map((e) => [e.event.id, e]))

  const revenue = new Map<string, Map<string, number>>()
  const hours = new Map<string, Map<string, number>>()
  const covered = new Map<string, Map<string, number>>()
  const ran = new Map<string, Set<string>>()
  const keyOf = (day: Day, hour: number): string => `${day}-${hour}`
  const bump = (
    into: Map<string, Map<string, number>>,
    key: string,
    eventId: string,
    amount: number,
  ): void => {
    const row = into.get(key) ?? new Map<string, number>()
    row.set(eventId, round2((row.get(eventId) ?? 0) + amount))
    into.set(key, row)
  }

  for (const eventId of order) {
    const data = byId.get(eventId)
    if (!data) continue
    const bySlot = new Map(data.slots.map((s) => [s.id, s]))

    /*
      Which hours this event could earn in, so an hour it never scheduled reads as absent
      rather than as an hour that earned nothing.

      The shift, not the block it sits in. An event whose first block opens at a quarter to
      five was indeed running then, but those fifteen minutes are check-in at base: no door
      is being worked and no jar can take anything. Counting the block opened a four o'clock
      row that could only ever read as an hour the event earned nothing in.
    */
    for (const slot of data.slots) {
      for (const hour of hoursSpanned(slot.workStartMin, slot.endMin)) {
        const key = keyOf(slot.day, hour)
        ran.set(key, (ran.get(key) ?? new Set()).add(eventId))
      }
    }

    /*
      Hours worked at the selected locations, spread over the clock hours each shift covers.

      Spread over the stretch the shift is credited with rather than its whole window, so
      the quarter of an hour a back-to-back pair share lands in one of them and the column
      totals still add up to the figure on every other screen.
    */
    /*
      Collecting hours only, because the measure this feeds is money per hour. Four people
      at base from nine till three would otherwise add six hours to every column they touch
      and nothing to the takings beside them.
    */
    const workedHere = data.assignments
      .filter(wasWorked)
      .filter((a) => isCollecting(a, data.event.baseLocationId))
    const countedHere = countedWindows(workedHere, data.slots)
    for (const a of workedHere) {
      if (wanted !== null && !wanted.has(a.locationId)) continue
      const window = countedHere.get(a.id)
      if (!window) continue
      for (const hour of hoursSpanned(window.from, window.to)) {
        bump(
          hours,
          keyOf(window.day, hour),
          eventId,
          overlapMinutes(window.from, window.to, hour * 60, hour * 60 + 60) / 60,
        )
      }
    }

    /*
      The same hours again, counting doors rather than people.

      One stretch per door per day, overlaps already merged, so a shop worked by a pair adds
      the hour once. Spread across the clock hours it touches the same way the person-hours
      above are, which is what lets the two rates in a cell be read against each other.
    */
    for (const [locationId, byDay] of coveredSpansByLocation(workedHere, data.slots)) {
      if (wanted !== null && !wanted.has(locationId)) continue
      for (const [day, spans] of byDay) {
        for (const [from, to] of spans) {
          for (const hour of hoursSpanned(from, to)) {
            bump(
              covered,
              keyOf(day, hour),
              eventId,
              overlapMinutes(from, to, hour * 60, hour * 60 + 60) / 60,
            )
          }
        }
      }
    }

    /*
      Money spreads over the shift itself, not over the check-in lead in front of it. A jar
      collects nothing while its holder is queuing at the table for it, and crediting the
      quarter-hour before five with a share of the evening's takings would invent an earning
      hour the event never had.
    */
    for (const share of attributeJarRevenue(data.assignments, data.jars, data.slots).shares) {
      if (wanted !== null && !wanted.has(share.locationId)) continue
      const slot = bySlot.get(share.slotId)
      if (!slot) continue

      const spanned = hoursSpanned(slot.workStartMin, slot.endMin)
      const weights = spanned.map((hour) =>
        overlapMinutes(slot.workStartMin, slot.endMin, hour * 60, hour * 60 + 60),
      )
      const parts = splitByWeight(share.amount, weights)

      spanned.forEach((hour, i) => bump(revenue, keyOf(slot.day, hour), eventId, parts[i]!))
    }
  }

  const rows: HourTrendRow[] = [...ran.keys()]
    .map((key) => {
      const [day, hour] = splitKey(key)
      const cells = order.map((eventId) => {
        const rev = round2(revenue.get(key)?.get(eventId) ?? 0)
        const worked = round2(hours.get(key)?.get(eventId) ?? 0)
        const doors = round2(covered.get(key)?.get(eventId) ?? 0)
        return {
          eventId,
          revenue: rev,
          staffedHours: worked,
          coveredHours: doors,
          revenuePerHour: worked > 0 ? round2(rev / worked) : null,
          revenuePerCoveredHour: doors > 0 ? round2(rev / doors) : null,
          ran: ran.get(key)?.has(eventId) ?? false,
        }
      })
      // The two most recent events that ran this hour, so a year the hour was not scheduled
      // does not read as a collapse to zero.
      const appeared = cells.filter((c) => c.ran)
      const last = appeared[appeared.length - 1]
      const before = appeared[appeared.length - 2]
      return {
        day,
        hour,
        label: `${DAY_SHORT[day]} ${formatTime(hour * 60)}`,
        cells,
        revenue: round2(cells.reduce((n, c) => n + c.revenue, 0)),
        changes: {
          revenue: changeFrom(before?.revenue ?? null, last?.revenue ?? null),
          perHour: changeFrom(
            before?.revenuePerCoveredHour ?? null,
            last?.revenuePerCoveredHour ?? null,
          ),
          perPersonHour: changeFrom(
            before?.revenuePerHour ?? null,
            last?.revenuePerHour ?? null,
          ),
        },
      }
    })
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.hour - b.hour)

  return { events: history, rows }
}

/** Every clock hour a span touches, so a straddling shift reaches both. */
function hoursSpanned(startMin: number, endMin: number): number[] {
  const first = Math.floor(startMin / 60)
  // An exact finish on the hour belongs to the hour before it, not to the one it touches.
  const last = Math.floor(Math.max(startMin, endMin - 1) / 60)
  const hours: number[] = []
  for (let hour = first; hour <= last; hour += 1) hours.push(hour)
  return hours
}

function overlapMinutes(aFrom: number, aTo: number, bFrom: number, bTo: number): number {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom))
}

function splitKey(key: string): [Day, number] {
  const at = key.lastIndexOf('-')
  return [key.slice(0, at) as Day, Number(key.slice(at + 1))]
}

/**
 * Event columns and the cells that belong to them, newest first.
 *
 * A trend row holds one cell per event, matched by position and nothing else. So reversing
 * the events on their own is not a reordering — it is a reassignment, quietly pairing every
 * year with a different year's figures. Pairing them first is what makes the reversal safe,
 * and having one function do it is why it cannot be got right in one table and wrong in the
 * next.
 *
 * Tables only. A chart of years reads left to right as time passing, so its columns stay
 * oldest first.
 */
export function newestFirst<E, C>(events: E[], cells: C[]): { event: E; cell: C }[] {
  return events
    .map((event, index) => ({ event, cell: cells[index]! }))
    .filter((pair) => pair.cell !== undefined)
    .reverse()
}

/**
 * One column of the split hour chart: a location, in a year.
 *
 * Two dimensions at once, because both halves are the question. "Which door is worth
 * staffing at five" needs the doors side by side; "and is that changing" needs the years
 * beside them. Answering one at a time means holding the other in your head.
 */
export interface HourSeries {
  /** Unique per column and stable, so a chart can key on it. */
  key: string
  eventId: string
  locationId: string
}

export interface SplitHourRow extends HourKey {
  label: string
  /** In `series` order, one cell per column. */
  cells: HourTrendCell[]
}

/** The key a location and an event share. Built in one place so nothing has to guess it. */
export const seriesKey = (locationId: string, eventId: string): string =>
  locationId + " " + eventId

/**
 * Takings by clock hour, kept apart per location rather than added together.
 *
 * {@link hourlyTrends} sums whatever locations it is given, which answers "what is this hour
 * worth across these doors". This answers the other question — which door, and whether it is
 * changing — by running that same sum once per location and setting the results side by
 * side.
 *
 * Reusing it rather than writing a second traversal is deliberate: the rule that divides a
 * shift straddling two hours between them is subtle enough that a second copy would
 * eventually disagree with the first.
 *
 * Hours are the union across every location, so a door that opens late still lines up with
 * one that does not — and an hour it did not run reads as such rather than as nothing
 * earned.
 */
export function hourlyTrendsSplit(
  events: EventData[],
  locationIds: string[],
): { series: HourSeries[]; rows: SplitHourRow[] } {
  if (locationIds.length === 0) return { series: [], rows: [] }

  const perLocation = locationIds.map((locationId) => ({
    locationId,
    trend: hourlyTrends(events, [locationId]),
  }))

  const series: HourSeries[] = perLocation.flatMap(({ locationId, trend }) =>
    trend.events.map((e) => ({
      key: seriesKey(locationId, e.eventId),
      eventId: e.eventId,
      locationId,
    })),
  )

  /*
    Every hour any of them ran, in the order they were already given.

    Taking one location's hours would drop an hour only another worked, and sorting the
    union afresh would re-derive an order `hourlyTrends` has already worked out.
  */
  const rows = new Map<string, SplitHourRow>()
  for (const { trend } of perLocation) {
    for (const row of trend.rows) {
      const at = row.day + " " + row.hour
      if (!rows.has(at)) {
        rows.set(at, { day: row.day, hour: row.hour, label: row.label, cells: [] })
      }
    }
  }

  // Not "earned nothing": this door was not open at this hour.
  const missing = (eventId: string): HourTrendCell => ({
    eventId,
    revenue: 0,
    staffedHours: 0,
    coveredHours: 0,
    revenuePerHour: null,
    revenuePerCoveredHour: null,
    ran: false,
  })

  for (const [at, row] of rows) {
    for (const { trend } of perLocation) {
      const found = trend.rows.find((r) => r.day + " " + r.hour === at)
      for (const [index, event] of trend.events.entries()) {
        const cell = found?.cells[index]
        if (!cell) {
          row.cells.push(missing(event.eventId))
          continue
        }
        /*
          `ran` is narrowed from the event to this door.

          On a summed trend it means the event was running that hour, which is the right
          question when the bar is the whole evening. Here each bar is one shop, and a shop
          nobody was standing at is not a shop that earned nothing — drawing it as zero
          reads as a door worth dropping.
        */
        row.cells.push({
          ...cell,
          ran: cell.ran && (cell.staffedHours > 0 || cell.revenue > 0),
        })
      }
    }
  }

  return { series, rows: [...rows.values()] }
}

/**
 * A split row rearranged for a stacked chart: one stack per event, one band per location.
 *
 * {@link hourlyTrendsSplit} lays its cells out location-major, because that is the order the
 * columns of a table read in. A stacked chart wants the other grouping — the bar is a year,
 * and the bands within it are the shops. Turning it here rather than in the screen keeps the
 * indexing, which is positional and easy to get silently wrong, next to the function whose
 * order it depends on.
 *
 * A band is null when that shop was shut that hour, and null is not zero: it draws nothing
 * rather than a stripe against a door nobody stood at.
 */
export function stackBands(
  row: SplitHourRow,
  series: HourSeries[],
  events: { eventId: string }[],
  measure: TrendMeasure,
): (number | null)[][] {
  const value = (cell: HourTrendCell): number | null =>
    cell.ran ? trendValue(cell, measure) : null

  return events.map((event) =>
    series.flatMap((s, index) =>
      s.eventId === event.eventId ? [value(row.cells[index]!)] : [],
    ),
  )
}

/**
 * The height of each stack, which is what the axis has to reach.
 *
 * Null when no shop was open that hour in that year — so the chart marks it as not run
 * rather than drawing a bar of nothing, which is the same distinction the bands keep.
 *
 * Per-hour rates are summed like the money is. Two shops each taking $80 an hour are worth
 * $160 of somebody's hour between them, which is the figure being compared.
 */
export function stackTotals(
  row: SplitHourRow,
  series: HourSeries[],
  events: { eventId: string }[],
  measure: TrendMeasure,
): (number | null)[] {
  return stackBands(row, series, events, measure).map((bands) => {
    const real = bands.filter((b): b is number => b !== null)
    return real.length === 0 ? null : round2(real.reduce((a, b) => a + b, 0))
  })
}
