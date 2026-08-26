import { attributeJarRevenue, splitByWeight } from './metrics'
import { DAY_SHORT, formatTime, slotDurationHours } from './slots'
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
  /** Person-hours worked. Two siblings for an hour is 2. */
  staffedHours: number
  revenuePerHour: number | null
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
  const volunteers = new Set<string>()
  for (const a of worked) {
    const slot = bySlot.get(a.slotId)
    if (!slot) continue
    staffedHours += slotDurationHours(slot)
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
  return {
    eventId: event.id,
    name: event.name,
    year: event.year,
    startedAt: event.fridayDate || String(event.year || ''),
    revenue,
    staffedHours,
    // Null rather than a fallback to the raw total, as everywhere else.
    revenuePerHour: staffedHours > 0 ? round2(revenue / staffedHours) : null,
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
 * list alone — three fields, already in context — and it used to be answered from the fully
 * loaded shifts and jars of every year that had ever run. That meant reading every year in
 * order to display two of them, which is the wrong way round: the selection has to come
 * first so that only the selected years are ever fetched.
 */
export interface EventLike {
  id: string
  year: number
  fridayDate: string
}

/** Where an event sits in the run: its date if it has one, its year otherwise. */
const startKey = (e: EventLike): string => e.fridayDate || String(e.year)

/** Oldest first, which is the direction a trend is read in. */
export function orderEvents<E extends EventLike>(all: E[]): E[] {
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
  staffedHours: number
  revenuePerHour: number | null
}

/**
 * What a cell is measuring.
 *
 * Three readings of the same row, because they answer different questions and can disagree.
 * Takings up by half sounds like a win until the hours behind them doubled — the location
 * did not get better, it got more people. `perHour` is the one that says whether a location
 * is worth somebody's evening.
 */
/*
  Two readings of a row, not three.

  Hours was one of them, and it answered a question about effort rather than about takings:
  it belongs to the money screen, where an hour is being planned, rather than to a history
  read to decide where to stand next year. Revenue and revenue-per-hour disagree often
  enough to be worth both — takings up by half is not a win if the hours behind them
  doubled — and hours on its own was read as neither.
*/
export type TrendMeasure = 'revenue' | 'perHour'

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

    for (const a of data.assignments.filter(wasWorked)) {
      const slot = bySlot.get(a.slotId)
      if (!slot) continue
      bump(hours, a.locationId, eventId, slotDurationHours(slot))
      used.set(a.locationId, (used.get(a.locationId) ?? new Set()).add(eventId))
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
        return {
          eventId,
          revenue: rev,
          staffedHours: hrs,
          revenuePerHour: hrs > 0 ? round2(rev / hrs) : null,
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
          perHour: changeFrom(before?.revenuePerHour ?? null, last?.revenuePerHour ?? null),
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
  revenuePerHour: number | null
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

    // Which hours this event ran at all, so an hour it never scheduled reads as absent
    // rather than as an hour that earned nothing.
    for (const slot of data.slots) {
      for (const hour of hoursSpanned(slot.startMin, slot.endMin)) {
        const key = keyOf(slot.day, hour)
        ran.set(key, (ran.get(key) ?? new Set()).add(eventId))
      }
    }

    // Hours worked at the selected locations, spread over the clock hours each shift covers.
    for (const a of data.assignments.filter(wasWorked)) {
      if (wanted !== null && !wanted.has(a.locationId)) continue
      const slot = bySlot.get(a.slotId)
      if (!slot) continue
      const spanned = hoursSpanned(slot.startMin, slot.endMin)
      for (const hour of spanned) {
        bump(
          hours,
          keyOf(slot.day, hour),
          eventId,
          overlapMinutes(slot.startMin, slot.endMin, hour * 60, hour * 60 + 60) / 60,
        )
      }
    }

    for (const share of attributeJarRevenue(data.assignments, data.jars, data.slots).shares) {
      if (wanted !== null && !wanted.has(share.locationId)) continue
      const slot = bySlot.get(share.slotId)
      if (!slot) continue

      const spanned = hoursSpanned(slot.startMin, slot.endMin)
      const weights = spanned.map((hour) =>
        overlapMinutes(slot.startMin, slot.endMin, hour * 60, hour * 60 + 60),
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
        return {
          eventId,
          revenue: rev,
          staffedHours: worked,
          revenuePerHour: worked > 0 ? round2(rev / worked) : null,
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
          perHour: changeFrom(before?.revenuePerHour ?? null, last?.revenuePerHour ?? null),
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
    revenuePerHour: null,
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
  const value = (cell: HourTrendCell): number | null => {
    if (!cell.ran) return null
    return measure === 'perHour' ? cell.revenuePerHour : cell.revenue
  }

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
