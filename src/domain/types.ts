import type { SupportContact } from './support'

/**
 * Apple Day domain types.
 *
 * Everything references everything else by id. No entity is ever identified by a display
 * string, which is what keeps `Braemar - 640 Linden Drive` and `Braemar Aldergrove - 640
 * Linden Drive` from being two locations.
 */

/**
 * A day of the week, Sunday first.
 *
 * All seven, though an event usually runs two of them: a location's opening hours are a
 * fact about the whole week regardless of when it is staffed.
 */
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type Day = (typeof DAYS)[number]

/**
 * A section id — `beavers`, `cubs`, or whatever this group calls its own.
 *
 * A plain string rather than a union: which sections exist is configuration, not something
 * this app decides. See `domain/sections.ts` for the definitions and the defaults.
 */
export type Section = string

/**
 * Whether they turned up. Set by hand, at the table.
 *
 * Kept apart from {@link WHEREABOUTS_VALUES}: attendance and whereabouts are independent
 * facts, and one field for both means the last write wins — issuing a jar would overwrite
 * a check-in, and checking somebody in would overwrite the fact that they were out.
 *
 * A list rather than a union, because the Firestore converter validates against it. A
 * second hand-written copy drifts, and a value missing from it reads back as `planned`.
 */
export const ATTENDANCE_VALUES = [
  'planned',
  'confirmed',
  'checkedIn',
  'noShow',
  'swapped',
] as const

export type AssignmentStatus = (typeof ATTENDANCE_VALUES)[number]

/**
 * Where they are right now.
 *
 * Driven by the jar: handing one over is the moment somebody goes out, counting it back in
 * is the moment they return, so neither needs a button pressed at the busiest time. Both
 * can still be set by hand, for a shift that goes out with no jar.
 */
export const WHEREABOUTS_VALUES = ['here', 'out', 'back'] as const

export type Whereabouts = (typeof WHEREABOUTS_VALUES)[number]

/** Whether this shift counts as worked — they were checked in, or they went out. */
export function wasWorked(assignment: Pick<Assignment, 'status' | 'whereabouts'>): boolean {
  return (
    assignment.status === 'checkedIn' ||
    assignment.whereabouts === 'out' ||
    assignment.whereabouts === 'back'
  )
}

export type PaymentMethod = 'cash' | 'square'


/**
 * A window on a specific day, identified as `fri-1700` / `sat-0700`.
 *
 * Times are minutes from midnight, 24-hour, always — a 12-hour label makes Friday evening
 * and Saturday morning the same string. `label` is for display and is never a key.
 */
export interface Slot {
  id: string
  day: Day
  startMin: number
  endMin: number
  label: string
}

export interface SiteContact {
  name: string
  role: string
  phone: string
  email: string
}

/**
 * When a place is open.
 *
 * Independent of the event's scheduling grid, which is what lets the board say "shut at
 * that hour" rather than offering hours nobody could work. `null` means closed. A single
 * range cannot express a midday closure — the price of two dropdowns over a grid.
 */
export interface OpenRange {
  /** Minutes from midnight, 24-hour. */
  openMin: number
  closeMin: number
}

/**
 * A location in the global library, stable across years.
 *
 * These are facts about a real place: where it is, when it opens, who to ask for. Whether
 * we are *using* it in a given year, and in what order, lives on {@link EventLocation} —
 * so setting up 2027 cannot rewrite what 2026 recorded.
 *
 * `aliases` carries every historical spelling found in past workbooks so that
 * year-over-year roll-ups collapse onto one row instead of splitting.
 */
export interface Location {
  id: string
  name: string
  address: string
  mapsUrl: string
  /**
   * Which area this shop is in, as a short code shared by everything in it.
   *
   * Two shops at either end of one plaza are one place to stand: siblings asked to stay
   * together can take a door each and cover twice the footfall, and the board should not warn
   * that they are split. Locations sharing a code are that place; a location with none is its
   * own, because an empty code is the absence of an answer rather than a group called "".
   */
  groupCode: string
  siteContact: SiteContact | null
  insurance: string
  comments: string
  /** Partial, so a location carries only the days worth recording. */
  openHours: Partial<Record<Day, OpenRange | null>>
  aliases: string[]
  /**
   * Where it is, once somebody has looked it up. Null until then.
   *
   * Stored rather than derived: a shop does not move, and looking one up means asking a
   * free service somebody else pays for. See `domain/geo`.
   */
  lat: number | null
  lng: number | null
}

/** A library location pulled into one year, with that year's settings. */
export interface EventLocation {
  locationId: string
  /** Using it this year. Toggled from the year's location list. */
  active: boolean
  /** 1 = work this location first. Per year — it changed year to year in practice. */
  priority: number
}

/**
 * A library location merged with its settings for one year.
 *
 * Everything downstream — the board, the metrics, publishing — works on this, so it never
 * has to know that the two halves are stored apart.
 */
export type ScheduledLocation = Location & {
  active: boolean
  priority: number
}

/**
 * A youth or an adult taking part, stored under the event they took part in.
 *
 * Not a register spanning years: two Apple Days may each hold somebody called Elliot, and
 * nothing links them. That is the trade — no per-person history, and no child's contact
 * details outliving the day they were collected for.
 *
 * Contains PII. Never expose this to unauthenticated readers.
 */
export interface Person {
  id: string
  firstName: string
  lastName: string
  section: Section
  parentName: string
  parentEmail: string
  parentPhone: string
  /** Sibling or buddy who should be scheduled to the same location and slot. */
  pairWithPersonId: string | null
}

export interface Signup {
  id: string
  personId: string
  /** Slot ids offered, by day. Only the event's own days appear. */
  availability: Partial<Record<Day, string[]>>
  attendingWithYouth: boolean
  notes: string
  /** Row number in the source CSV, so an import problem can be traced back. */
  sourceRow: number
  importedAt: number
}

/** Exactly one person. Two siblings at one location is two assignments, not one cell. */
export interface Assignment {
  id: string
  slotId: string
  locationId: string
  personId: string
  /** Did they turn up. Manual. */
  status: AssignmentStatus
  /** Are they out collecting. Follows the jar; overridable by hand. */
  whereabouts: Whereabouts
  checkedInAt: number | null
  checkedOutAt: number | null
}

/**
 * A collection jar, from being handed over to being counted.
 *
 * The number printed on the jar is reused every day and every year, so the document id is
 * `${day}-jar-${jarNumber}` — a jar can only be out once on a given day.
 *
 * `amount` is null while it is out, not zero. A jar still on the street is not a jar that
 * came back empty, and treating them alike misstates both figures.
 */
export interface Jar {
  id: string
  /**
   * The number printed on the jar, or null for money that never went through one.
   *
   * Bushel sales, a donation handed over, a card tap away from the table — all money raised
   * at a place, and all of it has to land somewhere or the total will not reconcile.
   */
  jarNumber: number | null
  day: Day
  locationId: string
  personId: string | null
  /** Which shift it went out on, so returning it can close that shift. */
  assignmentId: string | null
  /**
   * Every shift the jar was out for.
   *
   * One jar covers a stretch of consecutive shifts: a youth working 5–6 and 6–7 at one shop
   * carries it through both. Crediting only `assignmentId` would give the whole evening's
   * takings to the first hour and report the second as having earned nothing.
   *
   * The first entry is `assignmentId`, the shift the jar closes when it comes back. Empty
   * for money recorded against no shift.
   */
  assignmentIds: string[]
  status: 'out' | 'counted'
  issuedAt: number
  issuedBy: string
  amount: number | null
  method: PaymentMethod
  /** Why, for anything recorded by hand: "bushel sales", "donation at the door". */
  note: string
  countedBy: string
  countedAt: number
}

/** A jar that has been counted, so its amount is known. */
export type CountedJar = Jar & { amount: number }

export function isCounted(jar: Jar): jar is CountedJar {
  return jar.status === 'counted' && typeof jar.amount === 'number'
}

/** An actual numbered jar, as opposed to money recorded without one. */
export type NumberedJar = Jar & { jarNumber: number }

export function isNumbered(jar: Jar): jar is NumberedJar {
  return typeof jar.jarNumber === 'number'
}

/**
 * The few figures that are not derivable from the jars.
 *
 * Nothing here duplicates a jar. The cash and card split comes from how each jar was
 * counted; a second source for the same figure is how books end up quietly disagreeing.
 * What is left is what no jar can tell you: bushel sales, and what reached the bank.
 */
/**
 * Something worth remembering about the money, written down as it happens.
 *
 * One record each rather than one field holding all of them. A single box collects a year of
 * unsigned, undated text that nobody edits for fear of losing the rest of it — and the things
 * worth writing down here arrive one at a time, from different people, over two days.
 */
export interface EventNote {
  id: string
  text: string
  /** When it was written. What makes the list read as a record rather than a pile. */
  at: number
  /** Who wrote it, by address. A note nobody can be asked about is half a note. */
  by: string
}

/** The hours a given event actually staffs, per day. Half-open: [startMin, endMin). */
export interface SchedulingWindow {
  startMin: number
  endMin: number
}

/**
 * One year's Apple Day.
 *
 * The scheduling window is stored rather than coded because it moves: a later sunset, a
 * market that opens earlier, a Friday run an hour longer. Signups, assignments, jars and
 * passes all hang off the event, so a new year starts clean.
 */
export interface AppleDayEvent {
  /**
   * Stable, URL-safe, never reused. Derived from the name at creation and then left alone:
   * every year's data lives in subcollections beneath it.
   */
  id: string
  /**
   * A shorter link to share, when the generated id is not the one to hand out — how
   * `/e/apple-day-october-4-5-2026` becomes `/e/2026`. Empty means use the id.
   *
   * Resolution tries the id first and then the slug, so changing this never breaks a link
   * already sent out.
   */
  slug: string
  /** "Apple Day, October 4–5 2026", "Spring bottle drive". */
  name: string
  /** Used only for ordering and grouping. 0 when it isn't a year-shaped event. */
  year: number
  fridayDate: string
  saturdayDate: string
  /**
   * Who volunteers can reach on the day.
   *
   * A list: the event runs from two places across two days, base ops changes hands, and a
   * parent whose child is not where the schedule says needs somebody who answers.
   */
  support: SupportContact[]
  /** Anything else to tell them, in the organizers' own words. Printed on every pass. */
  supportNote: string
  /**
   * What to tell a volunteer on reaching base. Shown on the base card of every pass.
   *
   * Separate from {@link supportNote} because where an instruction sits changes what it
   * means: "come here first for a jar" belongs beside the address, not under the numbers.
   */
  arrivalNote: string
  /**
   * Where the event runs from — the hall, the church, wherever the apples are stacked.
   *
   * Into the library rather than an address typed here: the base is a real place with a map
   * link and a contact. It is not one of the year's staffed locations, so it never appears
   * on the board or in the revenue ranking.
   */
  baseLocationId: string | null
  /**
   * Which hours this event staffs, per day, and so the columns on the schedule board. A day
   * present is a day the event runs.
   */
  schedule: Partial<Record<Day, SchedulingWindow>>
  /**
   * Whether the day is divided into shifts at all.
   *
   * `wholeDay` gives each day one slot covering its whole window: people come for the
   * duration rather than being rostered to an hour.
   */
  shiftMode: 'shifts' | 'wholeDay'
  /** How long one shift lasts, in minutes. Ignored in `wholeDay` mode. */
  shiftMinutes: number
  /**
   * How much each shift overlaps the one before it — a handover, where the next pair arrive
   * while the current ones are still there. A 60 minute shift with 15 minutes of overlap
   * starts every 45.
   */
  overlapMinutes: number
}

/**
 * Expand a sparse availability map into every day of the week.
 *
 * Empty arrays, never omitted keys: a merged write does not delete what it is not given, so
 * an omitted day keeps its old hours and clearing a day becomes a no-op.
 */
export function completeAvailability(
  availability: Partial<Record<Day, string[]>>,
): Record<Day, string[]> {
  return Object.fromEntries(DAYS.map((day) => [day, availability[day] ?? []])) as Record<
    Day,
    string[]
  >
}


export function fullName(person: Pick<Person, 'firstName' | 'lastName'>): string {
  return `${person.firstName} ${person.lastName}`.trim()
}
