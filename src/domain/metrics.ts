import { slotDurationHours } from './slots'
import { DEFAULT_SECTIONS, sortSections } from './sections'
import type { SectionDef } from './sections'
import { DAYS, isCounted, isNumbered, wasWorked } from './types'
import type {
  Assignment,
  Day,
  Jar,
  Person,
  Reconciliation,
  ScheduledLocation,
  Section,
  Slot,
} from './types'

/**
 * Every derived number the event is judged on, as pure functions over plain objects.
 *
 * Two of them are easy to get subtly wrong, and both were wrong in the spreadsheet this
 * replaces:
 *
 *  - Hours must be summed from assignment rows, each holding exactly one person. Counting
 *    filled cells makes two siblings sharing a cell into one hour.
 *  - Revenue per hour is undefined when no hours were staffed, not equal to the raw total.
 *    A location with $86.55 and no scheduled hours otherwise reports $86.55/hour and ranks
 *    fourth of twelve. Here it is surfaced as an anomaly rather than ranked.
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
  /** Null when nothing was staffed — never a silent fallback to `revenue`. */
  revenuePerHour: number | null
  /** Competition rank over locations with a non-null ratio. Null when unranked. */
  rank: number | null
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
  totalStaffedHours: number
}

function slotIndex(slots: Slot[]): Map<string, Slot> {
  return new Map(slots.map((s) => [s.id, s]))
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
  const bySlot = slotIndex(slots)
  const totals = new Map<string, number>()

  for (const a of assignments) {
    // A no-show staffed nothing; counting it would understate revenue per hour.
    if (a.status === 'noShow' || a.status === 'swapped') continue

    const slot = bySlot.get(a.slotId)
    if (!slot) continue

    totals.set(a.locationId, (totals.get(a.locationId) ?? 0) + slotDurationHours(slot))
  }

  return totals
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
  startMin: number
  revenue: number
  /** Person-hours worked in this slot — two siblings for an hour is 2, not 1. */
  staffedHours: number
  /** Revenue divided by person-hours, or null when nobody was out. */
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
): SlotMoneyReport {
  const bySlot = slotIndex(slots)
  const attributed = attributeJarRevenue(assignments, jars, slots)

  const revenue = new Map<string, number>()
  const jarCounts = new Map<string, number>()
  const outCounts = attributed.stillOutBySlot
  const hours = new Map<string, number>()
  const unattributed = attributed.unattributed

  for (const a of assignments) {
    if (a.status === 'noShow' || a.status === 'swapped') continue
    const slot = bySlot.get(a.slotId)
    if (!slot) continue
    hours.set(a.slotId, (hours.get(a.slotId) ?? 0) + slotDurationHours(slot))
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
      const rev = round2(revenue.get(slot.id) ?? 0)
      return {
        slotId: slot.id,
        day: slot.day,
        label: slot.label,
        startMin: slot.startMin,
        revenue: rev,
        staffedHours,
        // Null rather than falling back to the raw total — the spreadsheet's mistake, which
        // put a jar with no rostered hours in fourth place.
        revenuePerHour: staffedHours > 0 ? round2(rev / staffedHours) : null,
        jarCount: jarCounts.get(slot.id) ?? 0,
        jarsOut: outCounts.get(slot.id) ?? 0,
      }
    })
    .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day) || a.startMin - b.startMin)

  const earning = rows.filter((r) => r.revenue > 0)
  const best = earning.length === 0
    ? null
    : earning.reduce((top, r) => (r.revenue > top.revenue ? r : top))

  // Only the slots somebody worked: an hour nobody was rostered for is not an hour the
  // event was running, and counting it would report a rate for time nobody was out.
  const worked = slots.filter((slot) => (hours.get(slot.id) ?? 0) > 0)
  const clockMinutes = DAYS.reduce((total, day) => {
    const spans = worked
      .filter((slot) => slot.day === day)
      .map((slot) => [slot.startMin, slot.endMin] as const)
      .sort((a, b) => a[0] - b[0])

    let covered = 0
    let openAt: number | null = null
    let closeAt = 0
    for (const [start, end] of spans) {
      if (openAt === null) {
        openAt = start
        closeAt = end
      } else if (start <= closeAt) {
        closeAt = Math.max(closeAt, end)
      } else {
        covered += closeAt - openAt
        openAt = start
        closeAt = end
      }
    }
    if (openAt !== null) covered += closeAt - openAt
    return total + covered
  }, 0)

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
 * Revenue, staffed hours and revenue per staffed hour for every location, ranked.
 *
 * Locations are keyed by id, so a location that was written three different ways across
 * two days collapses to one row instead of appearing three times.
 */
export function locationMetrics(
  locations: ScheduledLocation[],
  assignments: Assignment[],
  jars: Jar[],
  slots: Slot[],
): LocationMetricsReport {
  const hours = staffedHoursByLocation(assignments, slots)
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
  ])
  const byId = new Map(locations.map((l) => [l.id, l]))

  const rows: LocationMetrics[] = [...ids].map((id) => {
    const loc = byId.get(id)
    const staffedHours = round2(hours.get(id) ?? 0)
    const rev = round2(revenue.get(id) ?? 0)
    return {
      locationId: id,
      name: loc?.name ?? `(unknown location: ${id})`,
      groupCode: loc?.groupCode ?? '',
      priority: loc?.priority ?? Number.MAX_SAFE_INTEGER,
      revenue: rev,
      staffedHours,
      revenuePerHour: staffedHours > 0 ? round2(rev / staffedHours) : null,
      rank: null,
      jarCount: jarCounts.get(id) ?? 0,
      jarsOut: outstanding.get(id) ?? 0,
    }
  })

  // Competition ranking (equal ratios share a rank) over rankable rows only.
  const rankable = rows
    .filter((r) => r.revenuePerHour !== null)
    .sort((a, b) => b.revenuePerHour! - a.revenuePerHour!)

  let lastValue: number | null = null
  let lastRank = 0
  rankable.forEach((row, i) => {
    if (lastValue !== null && row.revenuePerHour === lastValue) {
      row.rank = lastRank
    } else {
      row.rank = i + 1
      lastRank = i + 1
      lastValue = row.revenuePerHour
    }
  })

  return {
    ranked: rankable,
    revenueWithoutHours: rows
      .filter((r) => r.revenuePerHour === null && r.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue),
    staffedWithoutRevenue: rows
      .filter((r) => r.staffedHours > 0 && r.revenue === 0)
      .sort((a, b) => b.staffedHours - a.staffedHours),
    totalRevenue: round2(rows.reduce((sum, r) => sum + r.revenue, 0)),
    totalStaffedHours: round2(rows.reduce((sum, r) => sum + r.staffedHours, 0)),
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
  const bySlot = slotIndex(slots)
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

  for (const a of assignments) {
    if (a.status === 'noShow' || a.status === 'swapped') continue
    const slot = bySlot.get(a.slotId)
    if (!slot) continue
    seen.add(a.locationId)
    const k = key(a.locationId, a.slotId)
    hours.set(k, round2((hours.get(k) ?? 0) + slotDurationHours(slot)))
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
  hours: number
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
): { rows: SectionParticipation[]; totalHours: number; youthHours: number } {
  const bySlot = slotIndex(slots)
  const personSection = new Map(people.map((p) => [p.id, p.section]))

  const hours = new Map<Section, number>()
  const seen = new Map<Section, Set<string>>()

  for (const a of assignments) {
    if (a.status === 'noShow' || a.status === 'swapped') continue
    const slot = bySlot.get(a.slotId)
    const section = personSection.get(a.personId)
    if (!slot || !section) continue

    hours.set(section, (hours.get(section) ?? 0) + slotDurationHours(slot))
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
      share: totalHours > 0 ? h / totalHours : 0,
    }
  })

  const youthIds = new Set(order.filter((s) => s.youth).map((s) => s.id))
  const youthHours = round2(
    rows.filter((r) => youthIds.has(r.section)).reduce((sum, r) => sum + r.hours, 0),
  )

  return { rows, totalHours: round2(totalHours), youthHours }
}

export interface PersonTotals {
  personId: string
  revenue: number
  hours: number
  jarCount: number
}

/** Per-youth totals — reliable now that a person is an id, not a formatted string. */
export function personTotals(
  assignments: Assignment[],
  jars: Jar[],
  slots: Slot[],
): PersonTotals[] {
  const bySlot = slotIndex(slots)
  const acc = new Map<string, PersonTotals>()

  const ensure = (personId: string): PersonTotals => {
    let row = acc.get(personId)
    if (!row) {
      row = { personId, revenue: 0, hours: 0, jarCount: 0 }
      acc.set(personId, row)
    }
    return row
  }

  for (const a of assignments) {
    if (a.status === 'noShow' || a.status === 'swapped') continue
    const slot = bySlot.get(a.slotId)
    if (!slot) continue
    ensure(a.personId).hours += slotDurationHours(slot)
  }

  for (const jar of jars) {
    if (!jar.personId || !isCounted(jar)) continue
    const row = ensure(jar.personId)
    row.revenue += jar.amount
    row.jarCount += 1
  }

  return [...acc.values()]
    .map((r) => ({ ...r, revenue: round2(r.revenue), hours: round2(r.hours) }))
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
  jarTotal: number
  cash: number
  card: number
  bushelSales: number
  /** Everything raised: counted jars plus bushel sales. */
  grandTotal: number
  /** Jars handed out and not yet counted, across every day. */
  stillOut: number
  /** What reached the bank, when recorded, and how far off it is. 0 means not recorded. */
  deposit: number
  depositVariance: number
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
 */
export function summariseMoney(
  jars: Jar[],
  declared: Reconciliation,
  onlyDays?: Day[],
): MoneySummary {
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

  const jarTotal = round2(days.reduce((s, d) => s + d.jarTotal, 0))
  const grandTotal = round2(jarTotal + declared.bushelSales)

  return {
    days,
    jarTotal,
    cash: round2(days.reduce((s, d) => s + d.cash, 0)),
    card: round2(days.reduce((s, d) => s + d.card, 0)),
    bushelSales: declared.bushelSales,
    grandTotal,
    stillOut: days.reduce((s, d) => s + d.stillOut, 0),
    deposit: declared.deposit,
    // Only meaningful once a deposit has been entered.
    depositVariance: declared.deposit === 0 ? 0 : round2(declared.deposit - grandTotal),
  }
}

