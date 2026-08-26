/**
 * A record of who changed what.
 *
 * The money is the reason this exists. A jar's amount is typed in once, by whoever is at
 * base ops at the time, and until now nothing said who that was or what the number had been
 * before. "Sobeys says they handed over $180 and the sheet says $80" is a conversation this
 * group has had, and the honest answer to it was a shrug.
 *
 * What this can and cannot promise, on the free plan: entries are written by the app, in the
 * same batch as the change they describe, and the rules refuse to let one be edited or
 * removed afterwards. So a change made through the app always leaves a mark, and the mark
 * cannot be tidied away. Somebody with Firebase console access bypasses the rules entirely —
 * that is what a server-side log would fix, and it needs a paid plan.
 *
 * Pure: building and reading entries is testable without Firestore.
 */
export type AuditAction = 'created' | 'updated' | 'deleted'

/** Things worth tracing. Anything money touches, and anything that moves a person about. */
export type AuditEntity =
  | 'jar'
  | 'assignment'
  | 'person'
  | 'signup'
  | 'location'
  | 'reconciliation'
  | 'event'
  | 'access'
  | 'reminder'

/** One field that moved. Values are already written out, so the log needs no schema to read. */
export interface AuditChange {
  field: string
  from: string
  to: string
}

export interface AuditEntry {
  id: string
  at: number
  /** The uid, which is the only thing rules can vouch for. */
  by: string
  /** Who that was, as their Google display name. Kept for entries written before the
      address was recorded; the screens show the address. */
  byName: string
  /** The address that signed in. Empty on entries written before it was recorded. */
  byEmail: string
  action: AuditAction
  entity: AuditEntity
  entityId: string
  /** Which event it belongs to, or null for the shared library and the roster. */
  eventId: string | null
  /** One line, in the app's own words: "Counted jar 12 at Sobeys". */
  summary: string
  changes: AuditChange[]
}

/** How a value is written into the log. Money stays money; nothing becomes "—". */
export function auditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/**
 * What actually moved between two versions of a record.
 *
 * Only the named fields, and only the ones that differ. A whole-document copy would be
 * bigger than the record it describes, would carry contact details into a collection with
 * looser reads than `people` has, and would bury the one number somebody is looking for.
 */
export function diffFields<T extends Record<string, unknown>>(
  before: T | null,
  after: Partial<T>,
  fields: (keyof T & string)[],
): AuditChange[] {
  const changes: AuditChange[] = []
  for (const field of fields) {
    if (!(field in after)) continue
    const from = before ? before[field] : undefined
    const to = after[field]
    if (auditValue(from) === auditValue(to)) continue
    changes.push({ field, from: auditValue(from), to: auditValue(to) })
  }
  return changes
}

/** Money, for a summary line. Kept here so the log reads the same as the screens do. */
export const auditMoney = (amount: number | null): string =>
  amount === null ? '—' : `$${amount.toFixed(2)}`

/**
 * Whether an entry is worth writing.
 *
 * A save that changed nothing is not an event. Without this, opening a jar and pressing save
 * would put a line in the log saying nothing happened — and a log of nothing happening is
 * one nobody reads when something does.
 */
export function worthRecording(action: AuditAction, changes: AuditChange[]): boolean {
  return action !== 'updated' || changes.length > 0
}

/** Newest first, which is the order somebody asking "what just happened" wants. */
export function sortEntries(entries: AuditEntry[]): AuditEntry[] {
  return [...entries].sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
}

/** The line a reader scans: what happened, and to what. */
export function describeEntry(entry: AuditEntry): string {
  const what = entry.summary || `${entry.entity} ${entry.entityId}`
  return `${what} — ${entry.action} by ${entry.byName || entry.by}`
}

/**
 * Turning the ids in an entry into something a person can read.
 *
 * The entry stores ids because they are exact and they still mean something years later.
 * Nobody reads them: "locationId: sobeys → —" answers a different question from "Sobeys".
 * So the ids are kept and the names are resolved at the point of reading, falling back to
 * the id whenever the thing has since been renamed away or deleted — which is honest, and
 * better than a blank.
 */
export interface AuditNames {
  location: (id: string) => string | undefined
  person: (id: string) => string | undefined
  slot: (id: string) => string | undefined
  /** An organizer's address, from their uid. */
  user: (uid: string) => string | undefined
}

/**
 * Fields whose value is a uid rather than anything a reader can use.
 *
 * `handledBy: — → gtQJ7d2k4jXChdHhHDKCk9n7ZIym` is a true statement and a useless one. The
 * uid is what is stored, because it is the only thing the rules can vouch for and the only
 * thing that still resolves after somebody is removed — so it is resolved on the way out,
 * the same as a location id or a person id.
 */
const UID_FIELDS = new Set(['handledBy', 'countedBy', 'addedBy', 'by'])

const FIELD_LABEL: Record<string, string> = {
  personId: 'Who',
  locationId: 'Where',
  slotId: 'When',
  jarNumber: 'Jar',
  amount: 'Amount',
  method: 'Paid by',
  status: 'Status',
  whereabouts: 'Whereabouts',
  note: 'Note',
  availability: 'Availability',
  level: 'Access',
  priority: 'Priority',
  active: 'In this event',
  pairWithPersonId: 'Paired with',
  handled: 'Dealt with',
  handledBy: 'Dealt with by',
  handledAt: 'Dealt with',
  countedBy: 'Counted by',
  addedBy: 'Added by',
}

/** The heading a reader sees for a field, or the raw name when it has none. */
export function fieldLabel(field: string): string {
  const base = field.replace(' (other shift)', '')
  const label = FIELD_LABEL[base] ?? base
  return field.endsWith('(other shift)') ? `${label} (other shift)` : label
}

/** A single value, resolved through whichever lookup the field calls for. */
export function readableValue(field: string, value: string, names: AuditNames): string {
  if (value === '—') return value
  const base = field.replace(' (other shift)', '')
  if (base === 'locationId') return names.location(value) ?? value
  if (base === 'personId' || base === 'pairWithPersonId') return names.person(value) ?? value
  if (base === 'slotId') return names.slot(value) ?? value
  if (UID_FIELDS.has(base)) return names.user(value) ?? value
  return value
}

/**
 * The address to show against an entry.
 *
 * Resolved through the roster first so that an entry written before addresses were recorded
 * still reads as one, and so that a changed address reads as the current one. Falls back
 * through what the entry itself stored, and finally to the uid — which is ugly, and is the
 * honest answer for somebody who has been removed and never had an address recorded.
 */
export function visibleChanges(entry: AuditEntry): AuditChange[] {
  /*
    A "who did it" field that names the person the entry already names is noise.

    `handledBy: — → <uid>` on an entry that ends "by <the same person>" says it twice and
    says nothing else. Newer entries do not record it at all; older ones do, and are read
    here rather than rewritten — the log cannot be edited, which is the point of it.
  */
  return entry.changes.filter((c) => !(UID_FIELDS.has(c.field) && c.to === entry.by))
}

export function actorOf(entry: AuditEntry, names: AuditNames): string {
  return names.user(entry.by) || entry.byEmail || entry.byName || entry.by
}

/**
 * The one-line answer to "which shift was that".
 *
 * Built from the entry's own fields rather than from the summary, because the summary is
 * written once at the time and cannot know what a location will be called later.
 */
export function subjectOf(entry: AuditEntry, names: AuditNames): string {
  const at = (field: string): string | undefined => {
    const change = entry.changes.find((c) => c.field === field)
    if (!change) return undefined
    const raw = change.from !== '—' ? change.from : change.to
    return raw === '—' ? undefined : readableValue(field, raw, names)
  }

  return [at('personId'), at('locationId'), at('slotId')].filter(Boolean).join(' · ')
}

/** A day's worth of entries, newest day first. */
export interface AuditDay {
  /** `YYYY-MM-DD` in local time — the key, not the heading. */
  key: string
  entries: AuditEntry[]
}

/**
 * The log, cut into days.
 *
 * A flat list of four hundred rows all stamped with a date is a wall. Cut into days it
 * becomes "what happened on the Saturday", which is how anybody actually arrives at it.
 *
 * Local time, deliberately: the question is always about the day the event was run, and an
 * entry written at 8pm should not be filed under tomorrow because UTC says so.
 */
export function groupByDay(entries: AuditEntry[]): AuditDay[] {
  const days: AuditDay[] = []
  for (const entry of sortEntries(entries)) {
    const d = new Date(entry.at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`
    const last = days[days.length - 1]
    if (last && last.key === key) last.entries.push(entry)
    else days.push({ key, entries: [entry] })
  }
  return days
}
