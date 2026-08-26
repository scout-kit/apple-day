import { DEFAULT_SECTIONS, matchSection } from './sections'
import type { SectionDef } from './sections'
import { DAY_LABEL, parseAvailability } from './slots'

import type { Day, Person, SchedulingWindow, Section, Signup } from './types'
import type { SlotParseFailure, SlotShape } from './slots'

/**
 * Google Form CSV import.
 *
 * Intake stays on the existing Google Form, so this is the seam where messy text becomes
 * structured data — and therefore the one place that has to be forgiving about input and
 * strict about output. Three years of exports differ in every way that matters:
 *
 *   2023 headers: `Timestamp | Youth Name | [Section] | [Friday] | [Saturday] |
 *                  Parent Name | I will attend with my youth`
 *   2024 headers: `Timestamp | Youth Name | Section | Parent Name |
 *                  I will attend with my youth | Friday | Saturday | Note`
 *
 * Neither has an email or phone column, which is the gap the 2025 retro notes flagged.
 * Availability is a comma-joined multi-select in one cell. Pairing requests were typed
 * into the name field as `(w/ Ken please)`.
 *
 * Two guarantees:
 *  - Nothing is dropped silently. Every row that cannot be understood comes back in
 *    `problems` with its source row number.
 *  - Re-importing the same file changes nothing. Person ids are derived from name and
 *    section, so a second run matches instead of duplicating.
 */

// ------------------------------------------------------------------ normalising

/** Collapse tabs, non-breaking spaces and runs of whitespace; strip wrapping quotes. */
export function normaliseWhitespace(value: string): string {
  return value
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["']+|["']+$/g, '')
    .trim()
}

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z]/g, '')
}

/**
 * Which section a form answer refers to.
 *
 * Matched against the group's configured sections — their ids, names and recorded aliases —
 * so a group that renames a section or adds one does not need a code change for the import
 * to understand it.
 */
export function parseSection(
  raw: string,
  sections: SectionDef[] = DEFAULT_SECTIONS,
): Section | null {
  return matchSection(normaliseWhitespace(raw), sections)?.id ?? null
}

/**
 * Split a name field, pulling out any pairing request typed into it.
 *
 * Handles the real 2024 shapes: `Ada Byron (w/ Ken please)` and
 * `Grace Hopper (with brother Toby in tow)`.
 */
export function parseNameField(raw: string): {
  firstName: string
  lastName: string
  pairHint: string | null
} {
  const cleaned = normaliseWhitespace(raw)

  let pairHint: string | null = null
  const parenthetical = /\(([^)]*)\)/.exec(cleaned)
  if (parenthetical?.[1]) {
    const inner = parenthetical[1]
    // Pull the first capitalised word that is not a relationship or filler word.
    const stop = new Set([
      'w', 'with', 'and', 'please', 'brother', 'sister', 'sibling',
      'in', 'tow', 'the', 'his', 'her', 'their',
    ])
    const candidate = inner
      .split(/[\s,/]+/)
      .map((t) => t.replace(/[^\w'-]/g, ''))
      .find((t) => t.length > 1 && !stop.has(t.toLowerCase()))
    pairHint = candidate ?? null
  }

  const withoutParens = normaliseWhitespace(cleaned.replace(/\([^)]*\)/g, ''))
  const parts = withoutParens.split(' ').filter(Boolean)
  const firstName = parts[0] ?? ''
  const lastName = parts.slice(1).join(' ')

  return { firstName, lastName, pairHint }
}

/** Deterministic id from name and section — what makes re-import idempotent. */
export function personId(firstName: string, lastName: string, section: Section): string {
  const slug = `${firstName} ${lastName}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `p-${slug}-${section}`
}

/**
 * The same, but never one that is already taken.
 *
 * Two people can genuinely share a name — a section with two Lucas in it is an ordinary
 * Tuesday — and the derived id cannot tell them apart, so adding the second silently wrote
 * over the first. One name, one record, and a youth who had disappeared from the board.
 *
 * Only for somebody being added by hand. The import wants the plain derived id: two rows
 * landing on one is how a family resubmitting the form is recognised, and it reports that
 * rather than quietly making a second person out of it.
 */
export function freePersonId(
  firstName: string,
  lastName: string,
  section: Section,
  taken: Iterable<string>,
): string {
  const base = personId(firstName, lastName, section)
  const used = new Set(taken)
  if (!used.has(base)) return base

  // The second Luca is `-2`, which is what somebody would write on a name badge.
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (!used.has(candidate)) return candidate
  }
}

// --------------------------------------------------------------------- mapping

/**
 * When a row was submitted, as a number to sort by, or null when it cannot be read.
 *
 * A form's timestamp is text — `2026-09-14 18:32:05`, or `9/14/2026 18:32:05` — and reading
 * it as a plain number gives `NaN` for every one of them. Falling back to zero made every
 * row equally recent, so which of two submissions survived came down to whichever happened
 * to be later in the file.
 *
 * Null rather than zero when it cannot be read, so the caller can fall back to file order
 * deliberately instead of comparing two zeroes. A day-first date like `14/09/2026` is one
 * of those: no single row says whether it is the 14th of September or the 9th of February,
 * and guessing would quietly keep the wrong submission.
 */
export function parseTimestamp(raw: string): number | null {
  const value = raw.trim()
  if (!value) return null

  // Already epoch — some exports write it that way.
  if (/^\d{9,}$/.test(value)) return Number(value)

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export type FieldName =
  | 'timestamp' | 'youthName' | 'section'
  | 'parentName' | 'parentEmail' | 'parentPhone' | 'attending' | 'pairWith' | 'notes'

/** Header substrings that identify each field, most specific first. */
const HEADER_HINTS: [FieldName, (key: string) => boolean][] = [
  ['timestamp', (k) => k.includes('timestamp') || k === 'date'],
  ['parentEmail', (k) => k.includes('email')],
  ['parentPhone', (k) => k.includes('phone') || k.includes('cell') || k.includes('mobile')],
  ['parentName', (k) => k.includes('parent') || k.includes('guardian')],
  ['attending', (k) => k.includes('attend') || k.includes('staywith')],
  ['pairWith', (k) => k.includes('pair') || k.includes('buddy') || k.includes('together')],
  ['section', (k) => k.includes('section') || k.includes('group')],
  ['youthName', (k) => k.includes('youthname') || k.includes('scoutname') || k === 'name' || k.includes('childname')],
  ['notes', (k) => k.includes('note') || k.includes('comment') || k.includes('request')],
]

/**
 * Which CSV column feeds which field, plus one availability column per day the event
 * runs. Days are separate from the flat fields because the set of them is the event's
 * choice, not a fixed list — adding a Sunday to the event adds a Sunday column here.
 */
export interface ColumnMapping extends Partial<Record<FieldName, string>> {
  days?: Partial<Record<Day, string>>
}

/**
 * Guess which CSV column feeds which field. The organizer confirms or corrects this in
 * the UI before anything is written — a wrong guess must never silently import.
 */
export function detectMapping(headers: string[], days?: Day[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  for (const header of headers) {
    const key = headerKey(header)
    if (!key) continue
    for (const [field, matches] of HEADER_HINTS) {
      if (mapping[field] === undefined && matches(key)) {
        mapping[field] = header
        break
      }
    }
  }

  // One availability column per day, matched on the day's name — the form's own headings
  // ("Friday", " [Saturday]", "Sunday availability") all reduce to the same key.
  const wanted = days ?? (['fri', 'sat'] as Day[])
  const dayColumns: Partial<Record<Day, string>> = {}
  for (const day of wanted) {
    const long = DAY_LABEL[day].toLowerCase()
    const found = headers.find((h) => {
      const key = headerKey(h)
      return key.includes(long) || key === day
    })
    if (found) dayColumns[day] = found
  }
  if (Object.keys(dayColumns).length > 0) mapping.days = dayColumns
  return mapping
}

export function missingRequiredColumns(mapping: ColumnMapping): FieldName[] {
  return (['youthName', 'section'] as FieldName[]).filter((f) => mapping[f] === undefined)
}

// ---------------------------------------------------------------------- import

export type ImportProblem =
  | { kind: 'missingName'; row: number }
  | { kind: 'unknownSection'; row: number; value: string }
  | { kind: 'unparseableSlot'; row: number; day: Day; detail: SlotParseFailure }
  | { kind: 'noAvailability'; row: number; name: string }
  | { kind: 'supersededDuplicate'; row: number; name: string; keptRow: number }
  | { kind: 'unresolvedPairHint'; row: number; name: string; hint: string }

export interface ImportPlan {
  /** People not already in the roster. */
  newPeople: Person[]
  /** Existing people whose contact details or pairing the CSV would update. */
  updatedPeople: Person[]
  signups: Signup[]
  problems: ImportProblem[]
  stats: {
    rowsRead: number
    rowsAccepted: number
    peopleMatched: number
    peopleCreated: number
    /** True when applying this plan would change nothing. */
    noOp: boolean
  }
}

export interface ImportOptions {
  mapping: ColumnMapping
  /** The group's sections, for matching whatever the form called them. */
  sections?: SectionDef[]
  existingPeople: Person[]
  existingSignups?: Signup[]
  importedAt?: number
  /** The event's scheduling window, so 12-hour labels resolve against the right hours. */
  schedule?: Partial<Record<Day, SchedulingWindow>>
  /**
   * How long a shift is and how much it overlaps, so an answer resolves to a shift the
   * board really has.
   *
   * Without it every import is read against hourly shifts starting on the hour. An event
   * with 90-minute shifts, or any overlap at all, then produces slot ids for hours that do
   * not exist — availability that looks imported and appears nowhere on the board.
   */
  shape?: SlotShape
}

type CsvRow = Record<string, string>

function cell(row: CsvRow, mapping: ColumnMapping, field: FieldName): string {
  const header = mapping[field]
  if (!header) return ''
  return normaliseWhitespace(row[header] ?? '')
}

function isYes(value: string): boolean {
  return /^(y|yes|true|1)$/i.test(value.trim())
}

/**
 * Build an import plan without touching the database, so the organizer can review the
 * problems list before committing.
 */
export function planImport(rows: CsvRow[], options: ImportOptions): ImportPlan {
  const {
    mapping,
    existingPeople,
    existingSignups = [],
    importedAt = 0,
    schedule,
    shape,
    sections = DEFAULT_SECTIONS,
  } = options

  const problems: ImportProblem[] = []
  const byId = new Map(existingPeople.map((p) => [p.id, p]))

  interface Candidate {
    row: number
    /** When it was submitted, or null when the file did not say in a readable way. */
    timestamp: number | null
    person: Person
    availability: Partial<Record<Day, string[]>>
    attending: boolean
    notes: string
    pairHint: string | null
  }

  const candidates: Candidate[] = []

  rows.forEach((row, index) => {
    // CSV row 1 is the header, so data starts at 2.
    const rowNumber = index + 2

    const rawName = cell(row, mapping, 'youthName')
    if (!rawName) {
      // A blank trailing row is not worth reporting; a row with data but no name is.
      const hasAnyData = Object.values(row).some((v) => normaliseWhitespace(v) !== '')
      if (hasAnyData) problems.push({ kind: 'missingName', row: rowNumber })
      return
    }

    const rawSection = cell(row, mapping, 'section')
    const section = parseSection(rawSection, sections)
    if (!section) {
      problems.push({ kind: 'unknownSection', row: rowNumber, value: rawSection })
      return
    }

    const { firstName, lastName, pairHint } = parseNameField(rawName)
    if (!firstName) {
      problems.push({ kind: 'missingName', row: rowNumber })
      return
    }

    const availability: Partial<Record<Day, string[]>> = {}
    let offered = 0
    for (const [day, header] of Object.entries(mapping.days ?? {}) as [Day, string][]) {
      if (!header) continue
      const parsed = parseAvailability(
        day,
        normaliseWhitespace(row[header] ?? ''),
        schedule,
        shape,
      )
      for (const detail of parsed.problems) {
        problems.push({ kind: 'unparseableSlot', row: rowNumber, day, detail })
      }
      if (parsed.slotIds.length > 0) {
        availability[day] = parsed.slotIds
        offered += parsed.slotIds.length
      }
    }

    const name = `${firstName} ${lastName}`.trim()
    if (offered === 0) {
      // Worth surfacing: someone filled the form in but offered no time.
      problems.push({ kind: 'noAvailability', row: rowNumber, name })
    }

    const id = personId(firstName, lastName, section)
    const existing = byId.get(id)

    const timestamp = parseTimestamp(cell(row, mapping, 'timestamp'))

    candidates.push({
      row: rowNumber,
      timestamp,
      person: {
        id,
        firstName,
        lastName,
        section,
        parentName: cell(row, mapping, 'parentName') || existing?.parentName || '',
        parentEmail: cell(row, mapping, 'parentEmail') || existing?.parentEmail || '',
        parentPhone: cell(row, mapping, 'parentPhone') || existing?.parentPhone || '',
        pairWithPersonId: existing?.pairWithPersonId ?? null,
      },
      availability,
      attending: isYes(cell(row, mapping, 'attending')),
      notes: cell(row, mapping, 'notes'),
      pairHint: pairHint ?? (cell(row, mapping, 'pairWith') || null),
    })
  })

  // One signup per person. A family that submitted twice — the workbook's cell comments
  // literally read "Responder updated this value." — keeps the latest submission, and
  // the superseded row is reported rather than silently discarded.
  const latest = new Map<string, Candidate>()
  for (const candidate of candidates) {
    const held = latest.get(candidate.person.id)
    if (!held) {
      latest.set(candidate.person.id, candidate)
      continue
    }
    /*
      By submission time when the file says, by position when it does not.

      A Google Form exports oldest first, so later-in-file is later-in-time and the fallback
      is right for the ordinary case. It is only a fallback: a file sorted newest-first, or
      one whose dates are day-first and so unreadable, would otherwise keep the older
      submission and import the availability the family had already replaced.
    */
    const bothTimed = candidate.timestamp !== null && held.timestamp !== null
    const candidateWins = bothTimed
      ? candidate.timestamp! >= held.timestamp!
      : candidate.row > held.row

    const [keep, drop] = candidateWins ? [candidate, held] : [held, candidate]
    latest.set(candidate.person.id, keep)
    problems.push({
      kind: 'supersededDuplicate',
      row: drop.row,
      name: `${drop.person.firstName} ${drop.person.lastName}`.trim(),
      keptRow: keep.row,
    })
  }

  // Resolve pairing hints against the people this import knows about, by first name.
  const accepted = [...latest.values()]
  const byFirstName = new Map<string, string[]>()
  for (const c of accepted) {
    const key = c.person.firstName.toLowerCase()
    const list = byFirstName.get(key)
    if (list) list.push(c.person.id)
    else byFirstName.set(key, [c.person.id])
  }
  for (const existing of existingPeople) {
    const key = existing.firstName.toLowerCase()
    const list = byFirstName.get(key)
    if (list) {
      if (!list.includes(existing.id)) list.push(existing.id)
    } else byFirstName.set(key, [existing.id])
  }

  for (const c of accepted) {
    if (!c.pairHint) continue
    const matches = (byFirstName.get(c.pairHint.toLowerCase()) ?? [])
      .filter((id) => id !== c.person.id)
    if (matches.length === 1) {
      c.person.pairWithPersonId = matches[0]!
    } else {
      // Ambiguous or unknown — never guess. An organizer resolves it on the board.
      problems.push({
        kind: 'unresolvedPairHint',
        row: c.row,
        name: `${c.person.firstName} ${c.person.lastName}`.trim(),
        hint: c.pairHint,
      })
    }
  }

  const newPeople: Person[] = []
  const updatedPeople: Person[] = []
  for (const c of accepted) {
    const existing = byId.get(c.person.id)
    if (!existing) {
      newPeople.push(c.person)
    } else if (JSON.stringify(existing) !== JSON.stringify(c.person)) {
      updatedPeople.push(c.person)
    }
  }

  const existingSignupByPerson = new Map(existingSignups.map((s) => [s.personId, s]))
  const signups: Signup[] = accepted.map((c) => {
    const previous = existingSignupByPerson.get(c.person.id)
    return {
      id: previous?.id ?? `su-${c.person.id}`,
      personId: c.person.id,
      availability: c.availability,
      attendingWithYouth: c.attending,
      notes: c.notes,
      sourceRow: c.row,
      importedAt,
    }
  })

  const signupsChanged = signups.some((s) => {
    const previous = existingSignupByPerson.get(s.personId)
    if (!previous) return true
    return (
      JSON.stringify(previous.availability) !== JSON.stringify(s.availability) ||
      previous.attendingWithYouth !== s.attendingWithYouth ||
      previous.notes !== s.notes
    )
  })

  return {
    newPeople,
    updatedPeople,
    signups,
    problems,
    stats: {
      rowsRead: rows.length,
      rowsAccepted: accepted.length,
      peopleMatched: accepted.length - newPeople.length,
      peopleCreated: newPeople.length,
      noOp: newPeople.length === 0 && updatedPeople.length === 0 && !signupsChanged,
    },
  }
}

export function sectionCounts(people: Person[]): Record<Section, number> {
  const counts: Record<Section, number> = {}
  for (const p of people) counts[p.section] = (counts[p.section] ?? 0) + 1
  return counts
}
