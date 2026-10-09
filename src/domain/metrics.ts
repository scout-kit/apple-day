import { countedHours } from './countedHours'
import { DEFAULT_SECTIONS, sortSections } from './sections'
import type { SectionDef } from './sections'
import { DAYS, isCounted, isNumbered, wasWorked } from './types'
import type {
  Assignment,
  Day,
  Jar,
  Person,
  ScheduledLocation,
  Section,
  Slot,
} from './types'

/**
 * Every derived number the event is judged on, as pure functions over plain objects.
 *
 * Three of them are easy to get subtly wrong, and all three were wrong in the spreadsheet
 * this replaces:
 *
 *  - Hours must be summed from assignment rows, each holding exactly one person. Counting
 *    filled cells makes two siblings sharing a cell into one hour.
 *  - Revenue per hour is undefined when no hours were staffed, not equal to the raw total.
 *    A location with $86.55 and no scheduled hours otherwise reports $86.55/hour and ranks
 *    fourth of twelve. Here it is surfaced as an anomaly rather than ranked.
 *  - "Per hour" is two questions, and dividing by person-hours only answers one of them.
 *    Send a pair to a shop and the person-hours double while the door is covered for just
 *    as long, so the shop's rate halves for a reason that is nothing to do with the shop.
 *    Both hours are kept, both rates are given, and either may rank.
 */

const round2 = (n: number): number => Math.round(n * 100) / 100

export interface LocationMetrics {
  locationId: string
  name: string
  groupCode: string
  priority: number
  revenue: number
  /** Person-hours actually staffed. Two people for one hour is 2. */
  staffedHours: number
  /**
   * Clock hours the door was covered for. Two people for one hour is 1.
   *
   * Never more than {@link staffedHours} and equal to it where nobody doubled up.
   */
  coveredHours: number
  /**
   * Revenue per person-hour. Null when nothing was staffed — never a silent fallback to
   * `revenue`.
   *
   * What an hour of somebody's evening was worth, which is the figure for deciding how
   * thickly to staff a place. Doubling up halves it, and that is the point of it.
   */
  revenuePerHour: number | null
  /**
   * Revenue per hour the door was covered. Null on the same rows as {@link revenuePerHour}.
   *
   * What the door itself was worth, which is the figure for deciding whether to go back.
   * Unmoved by how many people were sent, so a shop worked by a pair is comparable with one
   * worked alone.
   */
  revenuePerCoveredHour: number | null
  /** Competition rank over locations with a non-null ratio. Null when unranked. */
  rank: number | null
  /**
   * The base of operations, which is not a place anybody collects.
   *
   * It keeps its revenue — apples sold, a donation at the door, the Square total all land
   * against it — and it keeps its hours. It is not ranked against shops and it earns no
   * rate of its own, because the money there did not come from the hours there.
   */
  isBase: boolean
  jarCount: number
  /** Jars handed out here and not yet counted — revenue still unaccounted for. */
  jarsOut: number
}

export interface LocationMetricsReport {
  ranked: LocationMetrics[]
  /**
   * Locations that took money with no staffed hours recorded. Always a data-entry problem:
   * either the schedule was never filled in, or the jar is against the wrong location.
   */
  revenueWithoutHours: LocationMetrics[]
  /**
   * Staffed but took nothing. Candidates for dropping next year.
   *
   * Drawn from {@link ranked} rather than being a separate bucket — these rows have a ratio
   * of 0, so they appear in both. Only `ranked` and `revenueWithoutHours` partition the data.
   */
  staffedWithoutRevenue: LocationMetrics[]
  totalRevenue: number
  /** Every person-hour, base included. The figure labelled "staffed hours". */
  totalStaffedHours: number
  /**
   * Every covered hour, base included — door-hours, summed across locations.
   *
   * Not the same thing as {@link SlotMoneyReport.clockHours}, which is how long the event
   * itself ran: six doors covered for an hour is six here and one there.
   */
  totalCoveredHours: number
  /**
   * Of those, the ones spent out at a shop.
   *
   * What a per-hour rate divides by. See {@link isCollecting} for why the base ones cannot.
   */
  totalCollectingHours: number
  /** The same, in covered hours: door-hours out at the shops. */
  totalCollectingCoveredHours: number
  /** The base's own row, when the event has one and anything landed against it. */
  base: LocationMetrics | null
}

function slotIndex(slots: Slot[]): Map<string, Slot> {
  return new Map(slots.map((s) => [s.id, s]))
}

/**
 * How many minutes a set of stretches covers between them, counting an overlap once.
 *
 * Spans are half-open and may be given in any order. Two people out from five to six is
 * one hour of cover, not two; a handover from half past five to half past six adds the
 * half hour on the end and nothing in the middle.
 *
 * Callers must keep separate days apart before calling: the numbers are minutes from
 * midnight, so five o'clock on the Friday and five o'clock on the Saturday are the same
 * stretch as far as this is concerned.
 */
export function unionMinutes(spans: readonly Span[]): number {
  return mergeSpans(spans).reduce((total, [from, to]) => total + (to - from), 0)
}

/** A stretch of one day. Minutes from midnight, half-open. */
export type Span = readonly [number, number]

/**
 * The same stretches, overlaps resolved: the fewest spans covering the same minutes.
 *
 * What {@link unionMinutes} counts, kept as spans for the callers that need to know *when*
 * rather than how long — spreading a door's cover across the clock hours it touches, say.
 * Touching spans join, so back-to-back shifts are one stretch rather than two.
 */
export function mergeSpans(spans: readonly Span[]): [number, number][] {
  const merged: [number, number][] = []
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}

/**
 * Did this row staff anything at all?
 *
 * A no-show staffed nothing and a swapped row was handed to somebody else, so neither earns
 * hours — and neither may take part in the overlap maths in `countedHours`, or it would
 * absorb the credit for the shift that really was worked.
 */
function staffed(a: Assignment): boolean {
  return a.status !== 'noShow' && a.status !== 'swapped'
}

/**
 * Was this shift out at a shop, or holding the fort at base?
 *
 * Three or four people are on at base all day — check-in, apples, cooking, counting the
 * money — and those are real hours somebody gave. They are not hours anybody was out
 * collecting, though, and every rate in this app divides money by hours. Counting them in
 * the denominator makes a good evening look like a poor one, and the more people a group
 * puts on the table the worse its apparent rate.
 *
 * So the hours are still counted, and still shown. They are kept out of the division.
 *
 * An event with no base set has nowhere for this to be true of, and reads exactly as it did.
 */
export function isCollecting(
  a: Pick<Assignment, 'locationId'>,
  baseLocationId?: string | null,
): boolean {
  return !baseLocationId || a.locationId !== baseLocationId
}

/**
 * Person-hours per location, summed from assignments and weighted by each slot's real
 * duration. An assignment whose slot is unknown contributes nothing and is reported by
 * {@link findOrphanedRecords} rather than silently counted as an hour.
 */
/**
 * The shifts that count towards hours.
 *
 * `worked` means somebody turned up — checked in, or a jar went out against the shift.
 * `scheduled` is what the board said would happen, which is the only basis available for a
 * year imported from a spreadsheet, where nobody recorded check-ins.
 *
 * Revenue per hour divides by this, so getting it wrong is not cosmetic: counting a shift
 * nobody worked understates every location's rate, and understates it most where turnout
 * was worst — exactly the locations the ranking exists to find.
 */
export type HoursBasis = 'worked' | 'scheduled'

export function workedShifts(
  assignments: Assignment[],
  basis: HoursBasis,
): Assignment[] {
  if (basis === 'scheduled') return assignments
  return assignments.filter(wasWorked)
}

export function staffedHoursByLocation(
  assignments: Assignment[],
  slots: Slot[],
): Map<string, number> {
  const totals = new Map<string, number>()
  // A no-show staffed nothing; counting it would understate revenue per hour.
  const counted = countedHours(assignments.filter(staffed), slots)

  for (const a of assignments) {
    const hours = counted.get(a.id)
    if (hours === undefined) continue
    totals.set(a.locationId, (totals.get(a.locationId) ?? 0) + hours)
  }

  return totals
}

/**
 * Clock hours each location was covered for, counting an overlap once.
 *
 * The companion to {@link staffedHoursByLocation}, and the answer to a different question.
 * Person-hours ask what the event spent on a door; this asks how long the door was worked.
 * Put two siblings on the same shift at the same shop and the person-hours double while the
 * door is covered for exactly as long — so the one rate halves and the other does not move.
 *
 * Overlap is resolved per location per day rather than per person, which is what separates
 * this from `countedHours`. That one asks what one person is owed for their evening and can
 * only credit a minute once; here the same minute at two different shops is two doors being
 * worked, and both count it.
 *
 * The worked part of the block, not the whole of it: the quarter hour at the front is spent
 * queuing for a jar at base, and no shop is being covered during it.
 */
export function coveredHoursByLocation(
  assignments: Assignment[],
  slots: Slot[],
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const [locationId, byDay] of coveredSpansByLocation(assignments, slots)) {
    let minutes = 0
    for (const spans of byDay.values()) {
      for (const [from, to] of spans) minutes += to - from
    }
    totals.set(locationId, minutes / 60)
  }
  return totals
}

/**
 * The same cover, as the stretches themselves: by location, by day, overlaps merged.
 *
 * {@link coveredHoursByLocation} is this added up. The spans are kept for the callers that
 * need to know when a door was worked and not only for how long — spreading its cover
 * across the clock hours it touches, which is how a year-on-year "by hour" table counts
 * doors rather than people.
 *
 * Days are separate keys because the numbers are minutes from midnight: without that, five
 * o'clock on the Friday and five o'clock on the Saturday are the same stretch.
 */
export function coveredSpansByLocation(
  assignments: Assignment[],
  slots: Slot[],
): Map<string, Map<Day, [number, number][]>> {
  const bySlot = slotIndex(slots)
  const raw = new Map<string, Map<Day, Span[]>>()

  for (const a of assignments) {
    // A no-show covered nothing, and a swapped row was somebody else's shift.
    if (!staffed(a)) continue
    const slot = bySlot.get(a.slotId)
    // No slot, no time to place — reported by `findOrphanedRecords`, not counted as an hour.
    if (!slot) continue

    const byDay = raw.get(a.locationId) ?? new Map<Day, Span[]>()
    byDay.set(slot.day, [...(byDay.get(slot.day) ?? []), [slot.workStartMin, slot.endMin]])
    raw.set(a.locationId, byDay)
  }

  const out = new Map<string, Map<Day, [number, number][]>>()
  for (const [locationId, byDay] of raw) {
    const merged = new Map<Day, [number, number][]>()
    for (const [day, spans] of byDay) merged.set(day, mergeSpans(spans))
    out.set(locationId, merged)
  }

  return out
}

/**
 * Money in, per location — from counted jars only.
 *
 * A jar still out has no amount yet. Treating it as zero drags a location's revenue per
 * hour down mid-event and makes the ranking meaningless until everything is back.
 */
export function revenueByLocation(jars: Jar[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const jar of jars) {
    if (!isCounted(jar)) continue
    totals.set(jar.locationId, (totals.get(jar.locationId) ?? 0) + jar.amount)
  }
  return totals
}

/** Jars handed out and not yet back, per location. */
export function outstandingByLocation(jars: Jar[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const jar of jars) {
    if (jar.status !== 'out') continue
    counts.set(jar.locationId, (counts.get(jar.locationId) ?? 0) + 1)
  }
  return counts
}

export interface SlotMoney {
  slotId: string
  day: Day
  label: string
  /** The block, check-in included. What somebody was asked to turn up for. */
  startMin: number
  /**
   * When the shift proper starts, which is when money can begin arriving.
   *
   * What a chart of takings puts on its axis: a bar labelled "4:45" for the hour that ran
   * from five says the money came in a quarter of an hour before anybody was at a door.
   */
  workStartMin: number
  revenue: number
  /** Person-hours worked in this slot — two siblings for an hour is 2, not 1. */
  staffedHours: number
  /** Of those, the ones spent at base rather than out at a shop. */
  baseHours: number
  /**
   * Revenue divided by the hours spent collecting, or null when nobody was out.
   *
   * `staffedHours` less `baseHours`, because the money came from the doorsteps and not from
   * the table. See {@link isCollecting}.
   */
  revenuePerHour: number | null
  jarCount: number
  /** Jars issued in this slot that have not come back, so a low figure can be read right. */
  jarsOut: number
}

export interface SlotMoneyReport {
  rows: SlotMoney[]
  /** The busiest slot by money taken, or null when nothing has been counted. */
  best: SlotMoney | null
  /**
   * Counted money that belongs to no shift, and therefore to no hour.
   *
   * Hand-recorded takings are entered against a location with no assignment, so nothing
   * says which hour they arrived in. Reported separately rather than spread or dropped, so
   * this table still reconciles with the total at the top of the screen.
   */
  unattributed: number
  /** Distinct slots that somebody actually worked. */
  slotsWorked: number
  /**
   * Clock time the event has actually been running, in hours.
   *
   * The union of the worked slots, not their sum: shifts overlap, so adding durations counts
   * the same quarter-hour twice. Merged per day, because 5pm Friday and 5pm Saturday are not
   * the same stretch of time.
   */
  clockHours: number
  /**
   * Everything taken, over the clock hours it was taken in.
   *
   * A different question from revenue per person-hour: person-hours say whether an
   * individual's time was well spent, this says whether the hour was.
   */
  revenuePerClockHour: number | null
}

/**
 * Money in, hour by hour.
 *
 * The question that decides next year's plan: when is it worth being out there. The
 * location table answers where, and a location only ever staffed at 5pm cannot tell you
 * whether 5pm was the reason.
 *
 * Revenue reaches an hour through the shift the jar was issued against. That is the only
 * honest link: a jar records where and who, not what time the coins went in, so a jar with
 * no shift behind it stays in `unattributed` rather than being attributed to a guess.
 *
 * Both figures are given per slot. Raw revenue finds the hour worth staffing; revenue per
 * person-hour finds the hour worth staffing thinly.
 */
/**
 * Divide an amount into equal parts that still add up to it.
 *
 * Whole cents, with the remainder going to the earliest parts, so a $100 jar over three
 * hours is 33.34 / 33.33 / 33.33. The by-hour table has to reconcile with the total at the
 * top of the screen.
 */
/**
 * Divide an amount in proportion to some weights, without losing a cent.
 *
 * Same discipline as {@link splitAmount}. Used where a shift straddles two clock hours.
 */
export function splitByWeight(amount: number, weights: number[]): number[] {
  const total = weights.reduce((n, w) => n + Math.max(0, w), 0)
  if (weights.length === 0) return []
  if (total <= 0) return splitAmount(amount, weights.length)

  const cents = Math.round(amount * 100)
  const raw = weights.map((w) => (Math.max(0, w) / total) * cents)
  const floors = raw.map(Math.floor)
  let remainder = cents - floors.reduce((n, f) => n + f, 0)

  // The remainder lands on the parts with most claim to it, biggest fractional part first,
  // so a straddled shift does not systematically favour whichever hour came first.
  const order = raw
    .map((value, i) => ({ i, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction)
  for (const { i } of order) {
    if (remainder <= 0) break
    floors[i] = floors[i]! + 1
    remainder -= 1
  }

  return floors.map((c) => c / 100)
}

export function splitAmount(amount: number, parts: number): number[] {
  if (parts <= 0) return []
  const cents = Math.round(amount * 100)
  const each = Math.trunc(cents / parts)
  let remainder = cents - each * parts
  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : remainder < 0 ? -1 : 0
    remainder -= extra
    return (each + extra) / 100
  })
}

/** One jar's money, landing in one hour at one location. */
export interface RevenueShare {
  slotId: string
  locationId: string
  amount: number
  /** True for the hour the jar went out in — where the jar itself is counted. */
  isFirstHour: boolean
  isNumberedJar: boolean
}

export interface AttributedRevenue {
  shares: RevenueShare[]
  /** A jar still out, against the hour it left in. One jar, not one per hour. */
  stillOutBySlot: Map<string, number>
  /** Counted money with no shift behind it, and therefore no hour. */
  unattributed: number
}

/**
 * Walk every jar once, deciding which hours its money belongs to.
 *
 * Shared by the by-hour breakdown and the location-by-hour grid, so the rule that splits a
 * trip's takings across its hours exists in one place.
 */
export function attributeJarRevenue(
  assignments: Assignment[],
  jars: Jar[],
  slots: Slot[],
): AttributedRevenue {
  const bySlot = slotIndex(slots)
  const shiftById = new Map(assignments.map((a) => [a.id, a]))
  const shares: RevenueShare[] = []
  const stillOutBySlot = new Map<string, number>()
  let unattributed = 0

  for (const jar of jars) {
    // Every shift the jar was out for, in board order, keeping only the ones this scope
    // knows about — a jar spanning two hours where one is in view credits that hour with
    // its share, not with the lot.
    const covered = jar.assignmentIds
      .map((id) => shiftById.get(id))
      .filter((a): a is Assignment => a !== undefined && bySlot.has(a.slotId))
      .sort((a, b) => bySlot.get(a.slotId)!.startMin - bySlot.get(b.slotId)!.startMin)

    const first = covered[0]

    if (jar.status === 'out') {
      if (first !== undefined) {
        stillOutBySlot.set(first.slotId, (stillOutBySlot.get(first.slotId) ?? 0) + 1)
      }
      continue
    }
    if (!isCounted(jar)) continue

    if (covered.length === 0) {
      unattributed = round2(unattributed + jar.amount)
      continue
    }

    // Split equally: nobody records what came in during which hour of a trip, so an even
    // division is the only honest reading.
    const amounts = splitAmount(jar.amount, covered.length)
    covered.forEach((shift, i) => {
      shares.push({
        slotId: shift.slotId,
        // The jar's own location, not the shift's: they agree in practice, and the jar is
        // where the money was actually recorded.
        locationId: jar.locationId,
        amount: amounts[i]!,
        isFirstHour: i === 0,
        isNumberedJar: isNumbered(jar),
      })
    })
  }

  return { shares, stillOutBySlot, unattributed }
}

export function revenueBySlot(
  assignments: Assignment[],
  jars: Jar[],
  slots: Slot[],
  baseLocationId?: string | null,
): SlotMoneyReport {
  const attributed = attributeJarRevenue(assignments, jars, slots)

  const revenue = new Map<string, number>()
  const jarCounts = new Map<string, number>()
  const outCounts = attributed.stillOutBySlot
  const hours = new Map<string, number>()
  const unattributed = attributed.unattributed

  const countedBySlot = countedHours(assignments.filter(staffed), slots)
  const atBase = new Map<string, number>()
  for (const a of assignments) {
    const worked = countedBySlot.get(a.id)
    if (worked === undefined) continue
    hours.set(a.slotId, (hours.get(a.slotId) ?? 0) + worked)
    if (!isCollecting(a, baseLocationId)) {
      atBase.set(a.slotId, (atBase.get(a.slotId) ?? 0) + worked)
    }
  }

  for (const share of attributed.shares) {
    revenue.set(share.slotId, round2((revenue.get(share.slotId) ?? 0) + share.amount))
    // The jar itself is counted once, where it went out.
    if (share.isFirstHour && share.isNumberedJar) {
      jarCounts.set(share.slotId, (jarCounts.get(share.slotId) ?? 0) + 1)
    }
  }

  const rows: SlotMoney[] = slots
    .map((slot) => {
      const staffedHours = round2(hours.get(slot.id) ?? 0)
      const baseHours = round2(atBase.get(slot.id) ?? 0)
      const collecting = round2(staffedHours - baseHours)
      const rev = round2(revenue.get(slot.id) ?? 0)
      return {
        slotId: slot.id,
        day: slot.day,
        label: slot.label,
        startMin: slot.startMin,
        workStartMin: slot.workStartMin,
        revenue: rev,
        staffedHours,
        baseHours,
        /*
          Divided by the hours out collecting, not by every hour worked. Null rather than
          falling back to the raw total — the spreadsheet's mistake, which put a jar with no
          rostered hours in fourth place — and null too for an hour that was all base, where
          money came in against nobody who was out.
        */
        revenuePerHour: collecting > 0 ? round2(rev / collecting) : null,
        jarCount: jarCounts.get(slot.id) ?? 0,
        jarsOut: outCounts.get(slot.id) ?? 0,
      }
    })
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startMin - b.startMin)

  const earning = rows.filter((r) => r.revenue > 0)
  const best = earning.length === 0
    ? null
    : earning.reduce((top, r) => (r.revenue > top.revenue ? r : top))

  /*
    Only the slots somebody was out for: an hour nobody was rostered for is not an hour the
    event was running, and counting it would report a rate for time nobody was out.

    Out, specifically — an hour staffed only at base is an hour the table was open and the
    street was empty, and adding it to the clock stretches the day the takings are divided
    across.
  */
  const worked = slots.filter(
    (slot) => (hours.get(slot.id) ?? 0) - (atBase.get(slot.id) ?? 0) > 0,
  )
  /*
    The shift, not the block. The quarter of an hour at the front is spent queuing for a jar
    at base and no money can arrive during it, so counting it stretches the time the takings
    are divided across and reports a worse hour than the event had.

    It also puts a figure on screen that cannot be read: four hour-long shifts come to four
    hours, and 4.25 is not a number anybody can account for.
  */
  const clockMinutes = DAYS.reduce(
    (total, day) =>
      total +
      unionMinutes(
        worked
          .filter((slot) => slot.day === day)
          .map((slot) => [slot.workStartMin, slot.endMin] as const),
      ),
    0,
  )

  const clockHours = round2(clockMinutes / 60)
  const takings = round2(rows.reduce((n, r) => n + r.revenue, 0) + unattributed)

  return {
    rows,
    best,
    unattributed,
    slotsWorked: worked.length,
    clockHours,
    revenuePerClockHour: clockHours > 0 ? round2(takings / clockHours) : null,
  }
}

/**
 * Which of the two rates a location is ranked on.
 *
 * `personHour` is the long-standing one and stays the default: it asks what an hour of
 * somebody's evening bought. `coveredHour` asks what the door was worth however many people
 * were sent to it, which is the fairer comparison when some shops were worked in pairs and
 * others alone — and the one to judge next year's list on.
 */
export type RateBasis = 'personHour' | 'coveredHour'

export function rateOf(row: LocationMetrics, basis: RateBasis): number | null {
  return basis === 'coveredHour' ? row.revenuePerCoveredHour : row.revenuePerHour
}

/**
 * Revenue and hours for every location, ranked by what an hour there was worth.
 *
 * Hours come in two kinds and so do the rates over them. Person-hours are what the event
 * spent; covered hours are how long the door was worked. They part company exactly where
 * people doubled up — a shop worked by two siblings for one shift is two person-hours and
 * one covered hour — and that is the difference between asking whether the people were well
 * spent and asking whether the shop was worth standing at.
 *
 * Both are given on every row. `rankBy` decides which one orders them; see {@link RateBasis}.
 *
 * Locations are keyed by id, so a location that was written three different ways across
 * two days collapses to one row instead of appearing three times.
 */
export function locationMetrics(
  locations: ScheduledLocation[],
  assignments: Assignment[],
  jars: Jar[],
  slots: Slot[],
  baseLocationId?: string | null,
  rankBy: RateBasis = 'personHour',
): LocationMetricsReport {
  const hours = staffedHoursByLocation(assignments, slots)
  const covered = coveredHoursByLocation(assignments, slots)
  const revenue = revenueByLocation(jars)
  // Counts actual jars, so a location with only hand-recorded money reads as 0 jars with
  // revenue rather than claiming a jar that never existed.
  const jarCounts = new Map<string, number>()
  for (const jar of jars) {
    if (!isCounted(jar) || !isNumbered(jar)) continue
    jarCounts.set(jar.locationId, (jarCounts.get(jar.locationId) ?? 0) + 1)
  }
  const outstanding = outstandingByLocation(jars)

  // Include any location id seen in the data even if it is missing from the master
  // list, so nothing can hide from the totals.
  const ids = new Set<string>([
    ...locations.map((l) => l.id),
    ...revenue.keys(),
    ...hours.keys(),
    ...covered.keys(),
  ])
  const byId = new Map(locations.map((l) => [l.id, l]))

  const rows: LocationMetrics[] = [...ids].map((id) => {
    const loc = byId.get(id)
    const staffedHours = round2(hours.get(id) ?? 0)
    const coveredHours = round2(covered.get(id) ?? 0)
    const rev = round2(revenue.get(id) ?? 0)
    const isBase = Boolean(baseLocationId) && id === baseLocationId
    // The two go to zero together — an hour staffed is an hour covered — so no row is
    // rankable on one rate and an anomaly on the other, whichever basis is chosen below.
    const rateless = isBase || staffedHours === 0
    return {
      locationId: id,
      name: loc?.name ?? `(unknown location: ${id})`,
      groupCode: loc?.groupCode ?? '',
      priority: loc?.priority ?? Number.MAX_SAFE_INTEGER,
      revenue: rev,
      staffedHours,
      coveredHours,
      /*
        No rate for base. Apples sold and a tap at the table are real money, and the hours
        there are real hours, but the one did not come from the other — a rate over them is
        a number with no meaning that would sit in a ranking of shops.
      */
      revenuePerHour: rateless ? null : round2(rev / staffedHours),
      revenuePerCoveredHour: rateless ? null : round2(rev / coveredHours),
      rank: null,
      isBase,
      jarCount: jarCounts.get(id) ?? 0,
      jarsOut: outstanding.get(id) ?? 0,
    }
  })

  // Competition ranking (equal ratios share a rank) over rankable rows only.
  const rankable = rows
    .filter((r) => rateOf(r, rankBy) !== null)
    .sort((a, b) => rateOf(b, rankBy)! - rateOf(a, rankBy)!)

  let lastValue: number | null = null
  let lastRank = 0
  rankable.forEach((row, i) => {
    const rate = rateOf(row, rankBy)
    if (lastValue !== null && rate === lastValue) {
      row.rank = lastRank
    } else {
      row.rank = i + 1
      lastRank = i + 1
      lastValue = rate
    }
  })

  const base = rows.find((r) => r.isBase) ?? null

  return {
    ranked: rankable,
    /*
      Base is kept out of both warning lists. It takes money with no hours behind it and
      holds hours that take no money — which is what it is for, and neither is the
      data-entry mistake these lists exist to catch.
    */
    revenueWithoutHours: rows
      .filter((r) => !r.isBase && r.revenuePerHour === null && r.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue),
    staffedWithoutRevenue: rows
      .filter((r) => !r.isBase && r.staffedHours > 0 && r.revenue === 0)
      .sort((a, b) => b.staffedHours - a.staffedHours),
    totalRevenue: round2(rows.reduce((sum, r) => sum + r.revenue, 0)),
    totalStaffedHours: round2(rows.reduce((sum, r) => sum + r.staffedHours, 0)),
    totalCoveredHours: round2(rows.reduce((sum, r) => sum + r.coveredHours, 0)),
    totalCollectingHours: round2(
      rows.filter((r) => !r.isBase).reduce((sum, r) => sum + r.staffedHours, 0),
    ),
    totalCollectingCoveredHours: round2(
      rows.filter((r) => !r.isBase).reduce((sum, r) => sum + r.coveredHours, 0),
    ),
    base,
  }
}

export interface LocationHourCell {
  slotId: string
  revenue: number
  /** Person-hours worked at this location in this hour. */
  staffedHours: number
  revenuePerHour: number | null
}

export interface LocationHourRow {
  locationId: string
  name: string
  cells: LocationHourCell[]
  revenue: number
  staffedHours: number
  /** The hour this location took the most in, or null if it took nothing. */
  bestSlotId: string | null
}

export interface LocationHourGrid {
  slots: Slot[]
  rows: LocationHourRow[]
  /** Column totals, so the grid can be read down as well as across. */
  totals: LocationHourCell[]
}

/**
 * Money and hours for every location, hour by hour.
 *
 * The two existing tables each answer half a question. "By location" says Braemar did well
 * without saying when; "by hour" says 5pm did well without saying where. Next year's plan
 * needs both at once — which door to stand at, at what time — and that is a grid, not two
 * lists.
 *
 * The empty cells matter as much as the full ones: a location only ever staffed at 5pm
 * cannot tell you whether 5pm was the reason, and the gaps are where next year's experiment
 * goes.
 */
export function locationHourGrid(
  locations: ScheduledLocation[],
  assignments: Assignment[],
  jars: Jar[],
  slots: Slot[],
): LocationHourGrid {
  const ordered = [...slots].sort(
    (a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startMin - b.startMin,
  )
  const attributed = attributeJarRevenue(assignments, jars, slots)

  const key = (locationId: string, slotId: string): string => `${locationId}\u0000${slotId}`
  const revenue = new Map<string, number>()
  const hours = new Map<string, number>()
  const seen = new Set<string>()

  for (const share of attributed.shares) {
    seen.add(share.locationId)
    const k = key(share.locationId, share.slotId)
    revenue.set(k, round2((revenue.get(k) ?? 0) + share.amount))
  }

  const countedInGrid = countedHours(assignments.filter(staffed), slots)
  for (const a of assignments) {
    const worked = countedInGrid.get(a.id)
    if (worked === undefined) continue
    seen.add(a.locationId)
    const k = key(a.locationId, a.slotId)
    hours.set(k, round2((hours.get(k) ?? 0) + worked))
  }

  /*
    Rows keep the order they were given.

    That is the year's own running order — the priority the organizers set by dragging the
    Locations list about — so the grid reads down in the same sequence as the schedule board
    and every other list in the app. Sorting by takings instead would make the one screen you
    compare against the board the one that disagrees with it about the order of locations.

    Anything that appears only in the data follows at the end: a jar recorded against a
    location dropped from this year still has to show up, or the grid stops matching the
    total above it.
  */
  const names = new Map(locations.map((l) => [l.id, l.name]))
  const ids = [...new Set([...locations.map((l) => l.id), ...seen])]

  const rows: LocationHourRow[] = ids
    .map((locationId) => {
      const cells = ordered.map((slot) => {
        const k = key(locationId, slot.id)
        const rev = round2(revenue.get(k) ?? 0)
        const staffedHours = round2(hours.get(k) ?? 0)
        return {
          slotId: slot.id,
          revenue: rev,
          staffedHours,
          // Null rather than a fallback to the raw total — the spreadsheet's mistake.
          revenuePerHour: staffedHours > 0 ? round2(rev / staffedHours) : null,
        }
      })
      const earning = cells.filter((c) => c.revenue > 0)
      return {
        locationId,
        name: names.get(locationId) ?? locationId,
        cells,
        revenue: round2(cells.reduce((n, c) => n + c.revenue, 0)),
        staffedHours: round2(cells.reduce((n, c) => n + c.staffedHours, 0)),
        bestSlotId:
          earning.length === 0
            ? null
            : earning.reduce((top, c) => (c.revenue > top.revenue ? c : top)).slotId,
      }
    })

  const totals = ordered.map((slot, i) => {
    const rev = round2(rows.reduce((n, r) => n + r.cells[i]!.revenue, 0))
    const staffedHours = round2(rows.reduce((n, r) => n + r.cells[i]!.staffedHours, 0))
    return {
      slotId: slot.id,
      revenue: rev,
      staffedHours,
      revenuePerHour: staffedHours > 0 ? round2(rev / staffedHours) : null,
    }
  })

  return { slots: ordered, rows, totals }
}

export interface SectionParticipation {
  section: Section
  people: number
  /** Every hour the section gave, base included. */
  hours: number
  /** Of those, the ones at base rather than out at a shop. */
  baseHours: number
  /** Share of total staffed hours, 0–1. */
  share: number
}

/**
 * Hours and headcount by section.
 *
 * `scouters` is a distinct value here. The workbook counted sections by substring —
 * `LEN(...) - LEN(SUBSTITUTE(..., "Scout", ""))` — so every `Scouter` was also counted
 * as a `Scout`, and its four section rows read from ranges staggered one row apart
 * (`G2:K`, `G3:K`, `G4:K`, `G5:K`), so each section missed a different slice of data.
 */
export function sectionParticipation(
  people: Person[],
  assignments: Assignment[],
  slots: Slot[],
  /** The group's sections. Defaults to the built-in set when none are configured. */
  sections: SectionDef[] = DEFAULT_SECTIONS,
  baseLocationId?: string | null,
): {
  rows: SectionParticipation[]
  totalHours: number
  youthHours: number
  /** Of `totalHours`, the ones at base. Shown so the two figures still add up on screen. */
  baseHours: number
} {
  const personSection = new Map(people.map((p) => [p.id, p.section]))

  const hours = new Map<Section, number>()
  const baseBySection = new Map<Section, number>()
  const seen = new Map<Section, Set<string>>()

  const counted = countedHours(assignments.filter(staffed), slots)
  for (const a of assignments) {
    const worked = counted.get(a.id)
    const section = personSection.get(a.personId)
    if (worked === undefined || !section) continue

    hours.set(section, (hours.get(section) ?? 0) + worked)
    if (!isCollecting(a, baseLocationId)) {
      baseBySection.set(section, (baseBySection.get(section) ?? 0) + worked)
    }
    if (!seen.has(section)) seen.set(section, new Set())
    seen.get(section)!.add(a.personId)
  }

  const totalHours = [...hours.values()].reduce((a, b) => a + b, 0)

  // Every configured section, in the group's own order — plus any id that turns up in the
  // data without a definition, so a section deleted mid-season still shows its hours
  // instead of silently dropping them from the totals.
  const configured = sortSections(sections)
  const extra = [...hours.keys(), ...seen.keys()].filter(
    (id) => !configured.some((s) => s.id === id),
  )
  const order: { id: Section; youth: boolean }[] = [
    ...configured.map((s) => ({ id: s.id, youth: s.youth })),
    ...[...new Set(extra)].map((id) => ({ id, youth: true })),
  ]

  const rows: SectionParticipation[] = order.map(({ id }) => {
    const h = round2(hours.get(id) ?? 0)
    return {
      section: id,
      people: seen.get(id)?.size ?? 0,
      hours: h,
      baseHours: round2(baseBySection.get(id) ?? 0),
      share: totalHours > 0 ? h / totalHours : 0,
    }
  })

  const youthIds = new Set(order.filter((s) => s.youth).map((s) => s.id))
  const youthHours = round2(
    rows.filter((r) => youthIds.has(r.section)).reduce((sum, r) => sum + r.hours, 0),
  )

  return {
    rows,
    totalHours: round2(totalHours),
    youthHours,
    baseHours: round2(rows.reduce((sum, r) => sum + r.baseHours, 0)),
  }
}

export interface PersonTotals {
  personId: string
  revenue: number
  /** Every hour they gave, base included. */
  hours: number
  /** Of those, the ones at base rather than out at a shop. */
  baseHours: number
  jarCount: number
}

/** Per-youth totals — reliable now that a person is an id, not a formatted string. */
export function personTotals(
  assignments: Assignment[],
  jars: Jar[],
  slots: Slot[],
  baseLocationId?: string | null,
): PersonTotals[] {
  const acc = new Map<string, PersonTotals>()

  const ensure = (personId: string): PersonTotals => {
    let row = acc.get(personId)
    if (!row) {
      row = { personId, revenue: 0, hours: 0, baseHours: 0, jarCount: 0 }
      acc.set(personId, row)
    }
    return row
  }

  const counted = countedHours(assignments.filter(staffed), slots)
  for (const a of assignments) {
    const worked = counted.get(a.id)
    if (worked === undefined) continue
    const row = ensure(a.personId)
    row.hours += worked
    if (!isCollecting(a, baseLocationId)) row.baseHours += worked
  }

  for (const jar of jars) {
    if (!jar.personId || !isCounted(jar)) continue
    const row = ensure(jar.personId)
    row.revenue += jar.amount
    row.jarCount += 1
  }

  return [...acc.values()]
    .map((r) => ({
      ...r,
      revenue: round2(r.revenue),
      hours: round2(r.hours),
      baseHours: round2(r.baseHours),
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

export interface DayMoney {
  day: Day
  /** Counted jars only. */
  jarTotal: number
  cash: number
  card: number
  jarCount: number
  /** Handed out on this day and not yet counted. */
  stillOut: number
}

export interface MoneySummary {
  days: DayMoney[]
  /** Everything raised. Every penny of it came out of a jar. */
  jarTotal: number
  cash: number
  card: number
  /** Jars handed out and not yet counted, across every day. */
  stillOut: number
}

/**
 * What was raised, entirely from the jars.
 *
 * Each jar is counted once, in the app, with its location and youth already attached from
 * when it was issued — so the totals are a roll-up rather than a reconciliation against
 * numbers typed in from somewhere else. The cash and card split comes from how each jar
 * was counted, not from a separate tally.
 *
 * `stillOut` is the figure that decides whether any of this is final: while jars are on
 * the street the totals are a running count, not a result.
 *
 * Nothing is added to it by hand. Money that never went through a jar — apples by the
 * bushel, a donation at the door, a card tap away from the table — is recorded as a jar
 * without a number on the Jars screen, so it lands here with its day, its location and the
 * rest, instead of as a lump sum with none of them.
 */
export function summariseMoney(jars: Jar[], onlyDays?: Day[]): MoneySummary {
  const countedJars = jars.filter(isCounted)
  const relevant =
    onlyDays ??
    DAYS.filter((d) => jars.some((j) => j.day === d))

  const days: DayMoney[] = relevant.map((day) => {
    const dayJars = countedJars.filter((j) => j.day === day)
    const cash = round2(
      dayJars.filter((j) => j.method === 'cash').reduce((s, j) => s + j.amount, 0),
    )
    const card = round2(
      dayJars.filter((j) => j.method === 'square').reduce((s, j) => s + j.amount, 0),
    )
    return {
      day,
      jarTotal: round2(cash + card),
      cash,
      card,
      jarCount: dayJars.filter(isNumbered).length,
      stillOut: jars.filter((j) => j.day === day && j.status === 'out').length,
    }
  })

  return {
    days,
    jarTotal: round2(days.reduce((s, d) => s + d.jarTotal, 0)),
    cash: round2(days.reduce((s, d) => s + d.cash, 0)),
    card: round2(days.reduce((s, d) => s + d.card, 0)),
    stillOut: days.reduce((s, d) => s + d.stillOut, 0),
  }
}

