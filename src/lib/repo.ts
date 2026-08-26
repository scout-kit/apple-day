import { customAlphabet } from 'nanoid'
import {
  collection,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import type { DocumentReference } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_SECTIONS, slugifySection, sortSections } from '../domain/sections'
import type { SectionDef, SectionTone } from '../domain/sections'
import { AUDIT_PAGE } from '../domain/paging'
import { buildAllSlots } from '../domain/slots'
import { DAYS, completeAvailability } from '../domain/types'
import { isPlausiblePosition } from '../domain/geo'
import type {
  Assignment,
  AssignmentStatus,
  Whereabouts,
  Day,
  EventLocation,
  Jar,
  Location,
  OpenRange,
  PaymentMethod,
  Person,
  Reconciliation,
  ScheduledLocation,
  Section,
  Signup,
} from '../domain/types'
import { useEvent } from './eventContext'
import { auth, db } from './firebase'
import { normaliseEmail } from '../domain/access'
import type { Invitation, RosterEntry, Tier } from '../domain/access'
import { readAssignment } from '../domain/assignments'
import { generateToken } from '../domain/publishing'
import { EVENT_SUBCOLLECTIONS } from '../domain/eventRemoval'
import type { EventTally } from '../domain/eventRemoval'
import type { EventData } from '../domain/history'
import type { AppleDayEvent } from '../domain/types'
import { readRequest } from '../domain/requests'
import type { RequestKind } from '../domain/requests'
import type { VolunteerRequest } from '../domain/requests'
import {
  readJar,
  shiftsOnCount,
  shiftsOnIssue,
  shiftsOnUnissue,
} from '../domain/jars'
import { paths } from './paths'
import { auditMoney, auditValue, diffFields } from '../domain/audit'
import type { AuditChange, AuditEntry } from '../domain/audit'
import { auditedBatch, auditedDelete, auditedSet, recordInBatch } from './audit'
import { useCollectionData, useDocumentData } from './useData'
import type { Loadable } from './useData'

/**
 * Firestore access, kept behind converters so a half-written document cannot crash a
 * screen. Slots are generated in code rather than stored — they are a fixed property of
 * the event, and deriving them removes a whole class of drift.
 */


// ------------------------------------------------------------------- converters

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : fallback)
const bool = (v: unknown, fallback = false): boolean =>
  typeof v === 'boolean' ? v : fallback
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/**
 * A person's section id, as stored.
 *
 * Not validated against the configured list: renaming or removing a section must not
 * silently reassign everybody who was in it. Unknown ids render under their own name.
 */
const section = (v: unknown): Section => (typeof v === 'string' && v ? v : 'unassigned')


function toOpenRange(raw: unknown): OpenRange | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  const openMin = v.openMin
  const closeMin = v.closeMin
  if (typeof openMin !== 'number' || typeof closeMin !== 'number') return null
  // A backwards range means closed rather than open for negative time.
  return closeMin > openMin ? { openMin, closeMin } : null
}

function toLocation(id: string, d: Record<string, unknown>): Location {
  const openHours = (d.openHours ?? {}) as Record<string, unknown>
  const contact = d.siteContact as Record<string, unknown> | null | undefined
  return {
    id,
    name: str(d.name, '(unnamed)'),
    address: str(d.address),
    mapsUrl: str(d.mapsUrl),
    groupCode: str(d.groupCode),
    siteContact: contact
      ? {
          name: str(contact.name),
          role: str(contact.role),
          phone: str(contact.phone),
          email: str(contact.email),
        }
      : null,
    insurance: str(d.insurance),
    comments: str(d.comments),
    // An explicit null is kept as null. Dropping it would make "closed all day"
    // indistinguishable from "nobody recorded it".
    openHours: Object.fromEntries(
      DAYS.flatMap((d) =>
        openHours[d] === undefined ? [] : [[d, toOpenRange(openHours[d])] as const],
      ),
    ),
    aliases: strArray(d.aliases),
    // Only a position that could be drawn. A geocode that failed tends to arrive as zero,
    // and a pin off the coast of Africa is worse than no pin — it looks like data.
    lat: isPlausiblePosition(d.lat, d.lng) ? (d.lat as number) : null,
    lng: isPlausiblePosition(d.lat, d.lng) ? (d.lng as number) : null,
  }
}

function toSection(id: string, d: Record<string, unknown>): SectionDef {
  const tone = d.tone
  return {
    id,
    name: str(d.name, id),
    youth: bool(d.youth, true),
    order: num(d.order, 99),
    tone: typeof tone === 'string' ? (tone as SectionTone) : 'grey',
    aliases: strArray(d.aliases),
  }
}

function toEventLocation(id: string, d: Record<string, unknown>): EventLocation {
  return {
    locationId: id,
    active: bool(d.active, true),
    priority: num(d.priority, 99),
  }
}

function toPerson(id: string, d: Record<string, unknown>): Person {
  return {
    id,
    firstName: str(d.firstName),
    lastName: str(d.lastName),
    section: section(d.section),
    parentName: str(d.parentName),
    parentEmail: str(d.parentEmail),
    parentPhone: str(d.parentPhone),
    pairWithPersonId: typeof d.pairWithPersonId === 'string' ? d.pairWithPersonId : null,
  }
}

function toSignup(id: string, d: Record<string, unknown>): Signup {
  const availability = (d.availability ?? {}) as Record<string, unknown>
  return {
    id,
    personId: str(d.personId),
    availability: Object.fromEntries(
      DAYS.map((day) => [day, strArray(availability[day])]).filter(
        ([, slots]) => (slots as string[]).length > 0,
      ),
    ),
    attendingWithYouth: bool(d.attendingWithYouth),
    notes: str(d.notes),
    sourceRow: num(d.sourceRow),
    importedAt: num(d.importedAt),
  }
}


function toReconciliation(_id: string, d: Record<string, unknown>): Reconciliation {
  return {
    bushelSales: num(d.bushelSales),
    deposit: num(d.deposit),
    notes: str(d.notes),
  }
}

// ------------------------------------------------------------------------ reads

/** Every place the group has ever used, across all years. A year selects from it. */
export const useLocationLibrary = (): Loadable<Location[]> =>
  useCollectionData(paths.locations(), toLocation)

/** Which library locations the selected year uses, with that year's active flag and order. */
export function useEventLocations(): Loadable<EventLocation[]> {
  const { eventId } = useEvent()
  return useCollectionData(
    paths.eventLocations(eventId ?? '_none'),
    toEventLocation,
    [eventId],
  )
}

/**
 * The library merged with this year's settings — what every screen actually wants.
 *
 * A library location with no settings for this year is not in this year, so it is absent
 * rather than appearing as inactive noise.
 */
/**
 * Where the event runs from.
 *
 * Resolved against the whole library, never the year's selected locations: the base is
 * deliberately not one of those, so looking it up there finds nothing and silently empties
 * the base banner, the published passes and the map. One hook, so that cannot recur.
 */
export function useBaseLocation(): Loadable<Location | null> {
  const library = useLocationLibrary()
  const { event } = useEvent()
  const id = event?.baseLocationId ?? null

  const data = useMemo(
    () => (id ? library.data.find((l) => l.id === id) ?? null : null),
    [library.data, id],
  )

  return { data, loading: library.loading, error: library.error }
}

export function useLocations(): Loadable<ScheduledLocation[]> {
  const library = useLocationLibrary()
  const settings = useEventLocations()

  const data = useMemo(() => {
    const byId = new Map(settings.data.map((s) => [s.locationId, s]))
    return library.data
      .flatMap((loc) => {
        const setting = byId.get(loc.id)
        return setting ? [{ ...loc, active: setting.active, priority: setting.priority }] : []
      })
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
  }, [library.data, settings.data])

  return {
    data,
    loading: library.loading || settings.loading,
    error: library.error ?? settings.error,
  }
}

/** The people taking part in the selected event. Scoped to it, like its shifts. */
export function usePeople(): Loadable<Person[]> {
  const { eventId } = useEvent()
  return useCollectionData(paths.people(eventId ?? '_none'), toPerson, [eventId])
}

/**
 * The group's sections.
 *
 * Falls back to the built-in set while none are configured, so a fresh install is not a
 * blank dropdown.
 */
export function useSectionDefs(): Loadable<SectionDef[]> {
  const stored = useCollectionData(paths.sections(), toSection)
  return {
    ...stored,
    data: stored.data.length > 0 ? sortSections(stored.data) : DEFAULT_SECTIONS,
  }
}

export function useSignups(): Loadable<Signup[]> {
  const { eventId } = useEvent()
  return useCollectionData(paths.signups(eventId ?? '_none'), toSignup, [eventId])
}

export function useAssignments(): Loadable<Assignment[]> {
  const { eventId } = useEvent()
  return useCollectionData(paths.assignments(eventId ?? '_none'), readAssignment, [eventId])
}

export function useJars(): Loadable<Jar[]> {
  const { eventId } = useEvent()
  return useCollectionData(paths.jars(eventId ?? '_none'), readJar, [eventId])
}

export function useReconciliation(): Loadable<Reconciliation | null> {
  const { eventId } = useEvent()
  return useDocumentData(
    eventId ? paths.reconciliation(eventId) : null,
    toReconciliation,
    [eventId],
  )
}

/** What the last publish put in front of volunteers, and when. */
export interface PublishState {
  publishedAt: number
  /** A hash of the published content — see `publishedFingerprint`. */
  fingerprint: string
  /**
   * The same hash, of the board as it stands now.
   *
   * Stored rather than computed on demand. Working it out would mean subscribing to every
   * location, person and assignment on all seventeen screens, since the flag lives in the
   * bar — a few hundred reads to decide whether to draw one small link. The screens that
   * hold that data anyway record it, so everywhere else compares two strings.
   */
  currentFingerprint: string
}

function toPublishState(_id: string, d: Record<string, unknown>): PublishState {
  return {
    publishedAt: typeof d.publishedAt === 'number' ? d.publishedAt : 0,
    fingerprint: typeof d.fingerprint === 'string' ? d.fingerprint : '',
    currentFingerprint:
      typeof d.currentFingerprint === 'string' ? d.currentFingerprint : '',
  }
}

/**
 * Note what the board currently hashes to.
 *
 * Written only when it has moved, so a screen left open all day writes nothing. Failure is
 * silent: this is bookkeeping for a flag, and refusing to render over it would be worse
 * than the flag being late.
 */
/** The log, newest first, for the event being looked at. */
/**
 * How much of the log a screen asks for to begin with.
 *
 * The log only grows — nothing is ever removed, by rule — so the window is asked for rather
 * than assumed. Widening costs a re-read of what is already held, since Firestore bills a
 * fresh listener for its whole result, but a hundred reads against a daily fifty thousand
 * on a screen opened twice a year is a better trade than a cursor that freezes older pages.
 */
/**
 * Which entries to read.
 *
 * Not everything logged belongs to an Apple Day. The library, the sections and the access
 * list are shared between years and are written with no event against them, so an
 * event-scoped query can never match one.
 */
export type AuditScope = 'all' | 'event' | 'shared'

export function useAuditLog(
  window: number = AUDIT_PAGE,
  scope: AuditScope = 'all',
): Loadable<AuditEntry[]> {
  const { eventId } = useEvent()
  /*
    Three queries rather than one clever one. "This event and the shared setup" is the usual
    question, and Firestore cannot express it in a single ordered query — `in` against a
    null is not something to rest an audit trail on.
  */
  const scoped =
    scope === 'event'
      ? [where('eventId', '==', eventId ?? '_none')]
      : scope === 'shared'
        ? [where('eventId', '==', null)]
        : []
  return useCollectionData(
    query(paths.auditLog(), ...scoped, orderBy('at', 'desc'), limit(window)),
    toAuditEntry,
    [eventId, window, scope],
  )
}

function toAuditEntry(id: string, d: Record<string, unknown>): AuditEntry {
  const changes = Array.isArray(d.changes) ? d.changes : []
  return {
    id,
    at: typeof d.at === 'number' ? d.at : 0,
    by: typeof d.by === 'string' ? d.by : '',
    byName: typeof d.byName === 'string' ? d.byName : '',
    byEmail: typeof d.byEmail === 'string' ? d.byEmail : '',
    action: (d.action === 'created' || d.action === 'deleted' ? d.action : 'updated'),
    entity: (typeof d.entity === 'string' ? d.entity : 'jar') as AuditEntry['entity'],
    entityId: typeof d.entityId === 'string' ? d.entityId : '',
    eventId: typeof d.eventId === 'string' ? d.eventId : null,
    summary: typeof d.summary === 'string' ? d.summary : '',
    changes: changes.flatMap((c) => {
      const row = c as Record<string, unknown>
      return typeof row.field === 'string'
        ? [{ field: row.field, from: String(row.from ?? ''), to: String(row.to ?? '') }]
        : []
    }),
  }
}

/*
  Deliberately not audited: derived state, not somebody's decision. The hash is recorded by
  whichever screen holds the schedule, several times a day. `requestSwap` is out for the
  opposite reason — a volunteer has no account to write an entry with, and their request is
  itself a permanent record of what they asked for.
*/
export async function recordPublishFingerprint(
  eventId: string,
  fingerprint: string,
): Promise<void> {
  await setDoc(
    paths.publishState(eventId),
    { currentFingerprint: fingerprint, currentAt: Date.now() },
    { merge: true },
  )
}

/**
 * Whether this event has been published, and what was in it.
 *
 * Written by the same batch that publishes, so the two cannot disagree.
 */
export function usePublishState(): Loadable<PublishState | null> {
  const { eventId } = useEvent()
  return useDocumentData(
    eventId ? paths.publishState(eventId) : null,
    toPublishState,
    [eventId],
  )
}

export interface PassRecord {
  token: string
  personId: string
  displayName: string
  shiftCount: number
}

function toPass(id: string, d: Record<string, unknown>): PassRecord {
  return {
    token: id,
    personId: str(d.personId),
    displayName: str(d.displayName),
    shiftCount: Array.isArray(d.shifts) ? d.shifts.length : 0,
  }
}

/**
 * Passes for the selected year. Listing is organizer-only — that is what stops tokens being
 * harvested; a volunteer can only fetch their own by exact id.
 */
export function usePasses(): Loadable<PassRecord[]> {
  const { eventId } = useEvent()
  return useCollectionData(
    query(paths.passes(), where('eventId', '==', eventId ?? '_none')),
    toPass,
    [eventId],
  )
}

// ----------------------------------------------------------------------- writes
//
// Every year-scoped write takes `eventId` explicitly, passed down from `useEvent()`. A
// parameter rather than a closure, so a stale one cannot write this year's edits into last
// year's records.

export async function saveLocation(location: Location): Promise<void> {
  const { id, openHours, ...rest } = location
  await auditedSet(
    paths.location(id),
    {
      ...rest,
      // Every day explicitly, `null` where closed. A merged write does not delete what it
      // is not given, so an omitted day would keep its old hours.
      openHours: Object.fromEntries(DAYS.map((d) => [d, openHours[d] ?? null])),
    },
    {
      entity: 'location',
      entityId: id,
      // The library is shared by every year, so this is an edit to all of them at once.
      eventId: null,
      summary: `Edited ${location.name} in the library`,
      fields: ['name', 'address', 'mapsUrl', 'groupCode', 'insurance', 'comments'],
    },
  )
}

/**
 * Record where a shop is, once it has been looked up.
 *
 * Deliberately not audited, on the same grounds as the publish fingerprint: this is derived
 * state, not somebody's decision. The position comes from the address, and the address is
 * what carries a name on the log — sixteen lines saying a coordinate appeared would bury a
 * day's real changes for no question anybody asks.
 *
 * Merged, so it cannot disturb anything else on the record. A lookup run saves each answer
 * as it goes, so stopping halfway keeps what it found.
 */
export async function saveLocationPosition(
  locationId: string,
  position: { lat: number; lng: number } | null,
): Promise<void> {
  await setDoc(paths.location(locationId), position ?? { lat: null, lng: null }, {
    merge: true,
  })
}

/** Add a library location to a year, or update its settings for that year. */
export async function saveEventLocation(
  eventId: string,
  locationId: string,
  settings: { active: boolean; priority: number },
): Promise<void> {
  await auditedSet(paths.eventLocation(eventId, locationId), settings, {
    entity: 'location',
    entityId: locationId,
    eventId,
    summary: settings.active
      ? `Turned on ${locationId} for this event`
      : `Turned off ${locationId} for this event`,
    fields: ['active', 'priority'],
  })
}

/**
 * Rewrite a year's location order from a list of ids.
 *
 * Renumbered 1..n in one batch, so the board and every ranking agree the moment it lands.
 * Nudging individual values instead lets the sequence drift into ties and gaps.
 */
export async function reorderEventLocations(
  eventId: string,
  orderedLocationIds: string[],
): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'updated',
    entity: 'location',
    entityId: 'order',
    eventId,
    summary: 'Reordered the locations for this event',
    changes: [{ field: 'priority', from: '—', to: orderedLocationIds.join(', ') }],
  })
  orderedLocationIds.forEach((locationId, index) => {
    batch.set(
      paths.eventLocation(eventId, locationId),
      { priority: index + 1 },
      { merge: true },
    )
  })
  await batch.commit()
}

/** Remove a location from a year entirely. Its library record and history are untouched. */
export async function removeEventLocation(
  eventId: string,
  locationId: string,
): Promise<void> {
  await auditedDelete(paths.eventLocation(eventId, locationId), {
    entity: 'location',
    entityId: locationId,
    eventId,
    summary: `Dropped ${locationId} from this event`,
  })
}

/** Add several library locations to a year at once, appended after the existing order. */
export async function addLocationsToEvent(
  eventId: string,
  locationIds: string[],
  startPriority: number,
): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'created',
    entity: 'location',
    entityId: locationIds.join(', '),
    eventId,
    summary: `Added ${locationIds.length} location${
      locationIds.length === 1 ? '' : 's'
    } to this event`,
  })
  locationIds.forEach((locationId, i) => {
    batch.set(
      paths.eventLocation(eventId, locationId),
      { active: true, priority: startPriority + i },
      { merge: true },
    )
  })
  await batch.commit()
}

/**
 * Copy a year's location choices into another year.
 *
 * A new Apple Day is largely the same list minus what closed, so starting from a copy and
 * toggling beats rebuilding. Everything arrives active; the toggles do the pruning.
 */
export async function copyEventLocations(
  toEventId: string,
  settings: EventLocation[],
): Promise<number> {
  let batch = writeBatch(db)
  let pending = 0
  let written = 0

  recordInBatch(batch, {
    action: 'created',
    entity: 'location',
    entityId: 'copied',
    eventId: toEventId,
    summary: `Copied ${settings.length} location${
      settings.length === 1 ? '' : 's'
    } from another event`,
  })
  pending += 1

  for (const setting of settings) {
    batch.set(
      paths.eventLocation(toEventId, setting.locationId),
      { active: setting.active, priority: setting.priority },
      { merge: true },
    )
    pending += 1
    written += 1
    if (pending >= 450) {
      await batch.commit()
      batch = writeBatch(db)
      pending = 0
    }
  }
  if (pending > 0) await batch.commit()
  return written
}

export async function saveSection(section: SectionDef): Promise<void> {
  const id = section.id || slugifySection(section.name)
  const { id: _ignored, ...rest } = { ...section, id }
  await auditedSet(paths.section(id), rest, {
    entity: 'event',
    entityId: id,
    eventId: null,
    summary: `Edited the ${section.name} section`,
    fields: ['name', 'order', 'colour'],
  })
}

/**
 * Remove a section.
 *
 * People recorded in it keep their id and their hours still show under it. Dropping a
 * section must not quietly remove hours from the totals.
 */
export async function deleteSection(sectionId: string): Promise<void> {
  await auditedDelete(paths.section(sectionId), {
    entity: 'event',
    entityId: sectionId,
    eventId: null,
    summary: `Removed the ${sectionId} section`,
  })
}

/** Renumber the sections from a given order. */
export async function reorderSections(orderedIds: string[]): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'updated',
    entity: 'event',
    entityId: 'sections',
    eventId: null,
    summary: 'Reordered the sections',
    changes: [{ field: 'order', from: '—', to: orderedIds.join(', ') }],
  })
  orderedIds.forEach((id, index) => {
    batch.set(paths.section(id), { order: index + 1 }, { merge: true })
  })
  await batch.commit()
}

export async function savePerson(eventId: string, person: Person): Promise<void> {
  const { id, ...rest } = person
  await auditedSet(paths.person(eventId, id), rest, {
    entity: 'person',
    entityId: id,
    eventId,
    summary: `Edited ${person.firstName} ${person.lastName}`.trim(),
    // Names and section, never contact details. The log is read by admins and kept for
    // years, and no question anybody asks of it needs a parent's phone number.
    fields: ['firstName', 'lastName', 'section', 'pairWithPersonId'],
  })
}

/**
 * Save a person, keeping their pairing pointing both ways.
 *
 * Pairing is a relationship, not a field: "schedule Theo alongside Boyan" means the same
 * from either end. The board reports each pair once, from the lower id, so a one-sided
 * write can hide a split pair depending on how the ids sort.
 *
 * Anyone dropped out of a pairing is cleared in the same batch.
 */
export async function savePersonWithPairing(
  eventId: string,
  person: Person,
  /** People whose pairing should be cleared: the old partner, and the new partner's old one. */
  clearPairingFor: string[],
): Promise<void> {
  const batch = writeBatch(db)
  const { id, ...rest } = person

  recordInBatch(batch, {
    action: 'updated',
    entity: 'person',
    entityId: id,
    eventId,
    summary: `Edited ${person.firstName} ${person.lastName}`.trim(),
    // Pairing only. Names and section come through `savePerson`; contact details never do.
    changes: [
      { field: 'pairWithPersonId', from: '—', to: person.pairWithPersonId ?? '—' },
    ],
  })

  batch.set(paths.person(eventId, id), rest, { merge: true })

  for (const otherId of new Set(clearPairingFor)) {
    if (otherId && otherId !== id && otherId !== person.pairWithPersonId) {
      batch.set(paths.person(eventId, otherId), { pairWithPersonId: null }, { merge: true })
    }
  }

  if (person.pairWithPersonId) {
    batch.set(
      paths.person(eventId, person.pairWithPersonId),
      { pairWithPersonId: id },
      { merge: true },
    )
  }

  await batch.commit()
}

/** The signup document id for a person in a year. Matches what the CSV importer writes. */
export const signupIdFor = (personId: string): string => `su-${personId}`

/**
 * Set the hours a person has offered for a year.
 *
 * Availability mostly arrives through the form import, but not always — a paper signup, a
 * phone call, a parent changing their mind. This creates the signup document if there is
 * none, so somebody who never filled the form in can still be scheduled.
 *
 * `merge`, so an import's notes, attendance flag and source row survive.
 */
export async function saveAvailability(
  eventId: string,
  personId: string,
  availability: Partial<Record<Day, string[]>>,
): Promise<void> {
  await auditedSet(
    paths.signup(eventId, signupIdFor(personId)),
    {
      personId,
      // Every day explicitly. See `completeAvailability`.
      availability: completeAvailability(availability),
      updatedAt: Date.now(),
    },
    {
      entity: 'signup',
      entityId: personId,
      eventId,
      // "I said I could not do Saturday morning" is a real conversation on the day.
      summary: 'Changed when somebody said they could work',
      fields: ['availability'],
    },
  )
}

/** Remove someone's signup for a year entirely. Their person record is untouched. */
export async function removeSignup(eventId: string, personId: string): Promise<void> {
  await auditedDelete(paths.signup(eventId, signupIdFor(personId)), {
    entity: 'signup',
    entityId: personId,
    eventId,
    summary: 'Removed somebody\u2019s availability',
  })
}

/**
 * Take someone out of a year: their signup and every shift they hold in it.
 *
 * One batch. Deleting the signup alone leaves shifts nobody has offered to work — flagged
 * on the board as scheduled outside availability, and still on the schedule everyone was
 * sent. Their person record and any other year are untouched.
 */
export async function removeFromEvent(
  eventId: string,
  personId: string,
  assignmentIds: string[],
): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'deleted',
    entity: 'person',
    entityId: personId,
    eventId,
    summary: `Took somebody out of this event, with ${assignmentIds.length} shift${
      assignmentIds.length === 1 ? '' : 's'
    }`,
  })
  batch.delete(paths.signup(eventId, signupIdFor(personId)))
  for (const id of assignmentIds) batch.delete(paths.assignment(eventId, id))
  await batch.commit()
}

/**
 * Delete a person from the roster outright.
 *
 * Only for a record that should not exist. Past years reference people by id, so removing
 * someone with history leaves those years showing an unknown id; the caller is expected to
 * have checked and warned.
 */
export async function deletePerson(eventId: string, personId: string): Promise<void> {
  await auditedDelete(paths.person(eventId, personId), {
    entity: 'person',
    entityId: personId,
    eventId,
    summary: 'Deleted a person record',
  })
}

export async function assign(
  eventId: string,
  assignment: Omit<Assignment, 'id'> & { id?: string },
): Promise<string> {
  const id =
    assignment.id ?? `${assignment.slotId}_${assignment.locationId}_${assignment.personId}`
  const { id: _ignored, ...rest } = { ...assignment, id }
  await auditedSet(
    paths.assignment(eventId, id),
    rest,
    {
      entity: 'assignment',
      entityId: id,
      eventId,
      // Putting somebody on the schedule is as much a change as taking them off it.
      summary: 'Put somebody on the schedule',
      fields: ['slotId', 'locationId', 'personId', 'status'],
    },
    // Not a merge: an assignment is written whole, so a reused id cannot keep a previous
    // occupant's fields.
    {},
  )
  return id
}

/**
 * Rebuild a shift from what its own id says it was for.
 *
 * Repair rather than delete: the shift is how hours worked at a location are counted, and
 * throwing it away to silence a warning quietly changes that location's revenue per hour.
 * `merge`, so the status and timestamps — possibly the only surviving trace — are kept.
 */
export async function repairAssignment(
  eventId: string,
  assignmentId: string,
  fields: { slotId: string; locationId: string; personId: string },
): Promise<void> {
  await auditedSet(paths.assignment(eventId, assignmentId), fields, {
    entity: 'assignment',
    entityId: assignmentId,
    eventId,
    summary: 'Repaired a broken shift record',
    fields: ['slotId', 'locationId', 'personId'],
  })
}

/** Point a jar at a different location, for one whose location has gone. */
export async function relocateJar(
  eventId: string,
  jarId: string,
  locationId: string,
  was = '',
): Promise<void> {
  // Money moving between shops changes which one looks worth staffing next year, so the
  // line names both ends of the move and the jar it came out of.
  await auditedSet(paths.jar(eventId, jarId), { locationId }, {
    action: 'updated',
    entity: 'jar',
    entityId: jarId,
    eventId,
    summary: 'Moved a jar\u2019s money to another location',
    fields: ['locationId', 'jarNumber', 'personId', 'amount'],
  })
  void was
}

export async function unassign(eventId: string, assignmentId: string): Promise<void> {
  // "I was definitely on the schedule" needs an answer, and the answer has to name the
  // person, the place and the hour — the document is about to go.
  await auditedDelete(paths.assignment(eventId, assignmentId), {
    entity: 'assignment',
    entityId: assignmentId,
    eventId,
    summary: 'Removed a shift from the board',
    fields: ['personId', 'locationId', 'slotId', 'status'],
  })
}

/**
 * Send somebody out, or bring them back, by hand.
 *
 * The jar normally does this. For the shift that goes out without one.
 */
export async function setWhereabouts(
  eventId: string,
  assignmentId: string,
  whereabouts: Whereabouts,
  at: number = Date.now(),
): Promise<void> {
  const patch: Record<string, unknown> = { whereabouts }
  if (whereabouts === 'back') patch.checkedOutAt = at

  // Somebody has to be answerable for where a youth is said to be, so the shift's own
  // fields come along.
  await auditedSet(paths.assignment(eventId, assignmentId), patch, {
    action: 'updated',
    entity: 'assignment',
    entityId: assignmentId,
    eventId,
    summary:
      whereabouts === 'out'
        ? 'Sent somebody out to a location'
        : whereabouts === 'back'
          ? 'Brought somebody back to base'
          : 'Changed where somebody is',
    fields: ['whereabouts', 'personId', 'locationId', 'slotId'],
  })
}

/**
 * Move several shifts at once, atomically.
 *
 * Consecutive shifts at one location are one stretch of work, driven from one set of
 * buttons. A batch rather than a loop, so a stretch cannot end up half checked in — one
 * state on the row and another in the headcount.
 */
/**
 * Show or hide a volunteer's locations on their own pass.
 *
 * Follows their check-in both ways: somebody un-checked-in because they went home should
 * not be left holding a page that still names where to go.
 *
 * Looked up by person, because a pass's id is its token and deliberately unguessable.
 * Fire-and-forget — failing to reveal a location must never stop a check-in at a busy table.
 */
export async function revealPassShifts(token: string, revealed: boolean): Promise<void> {
  await auditedSet(paths.pass(token), { revealShifts: revealed }, {
    entity: 'person',
    // The token is the credential; the log records that a pass changed, never which one.
    entityId: 'pass',
    eventId: null,
    summary: revealed ? 'Showed a volunteer their shifts' : 'Hid a volunteer\u2019s shifts',
    fields: ['revealShifts'],
  })
}

/**
 * The shifts a bulk change is about to touch, so each log line can name its own.
 *
 * A missing one is not an error: the change still goes through and the entry carries less.
 */
async function readShifts(
  eventId: string,
  assignmentIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>()
  await Promise.all(
    assignmentIds.map(async (id) => {
      const snap = await getDoc(paths.assignment(eventId, id)).catch(() => null)
      if (snap?.exists()) found.set(id, snap.data() as Record<string, unknown>)
    }),
  )
  return found
}

/** Who, where and when, alongside whatever actually changed. */
function shiftFacts(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
): AuditChange[] {
  const moved = diffFields(before ?? null, after, Object.keys(after))
  if (!before) return moved
  return [
    ...moved,
    ...(['personId', 'locationId', 'slotId'] as const).flatMap((field) =>
      field in before ? [{ field, from: auditValue(before[field]), to: auditValue(before[field]) }] : [],
    ),
  ]
}

export async function setAssignmentStatusMany(
  eventId: string,
  assignmentIds: string[],
  status: AssignmentStatus,
  at: number = Date.now(),
): Promise<void> {
  if (assignmentIds.length === 0) return

  /*
    One line per shift, naming that shift. "Marked 8 shifts checkedIn" is no use to somebody
    looking up one youth, and neither are eight rows that each say only "checkedIn".

    Read before the batch rather than inside it: a handful of documents, and it keeps every
    write in one commit.
  */
  const before = await readShifts(eventId, assignmentIds)

  const batch = writeBatch(db)
  for (const id of assignmentIds) {
    recordInBatch(batch, {
      action: 'updated',
      entity: 'assignment',
      entityId: id,
      eventId,
      summary: `Marked a shift ${status}`,
      changes: shiftFacts(before.get(id), { status }),
    })
    const patch: Record<string, unknown> = { status }
    if (status === 'checkedIn') patch.checkedInAt = at
    if (status === 'noShow') patch.checkedInAt = null
    // Where somebody is only means something once they have arrived. "Out collecting" said
    // of somebody who is not here is false, and more than one screen reads it.
    if (status !== 'checkedIn') {
      patch.whereabouts = 'here'
      patch.checkedOutAt = null
    }
    batch.update(paths.assignment(eventId, id), patch)
  }
  await batch.commit()
}

/** The same, for whereabouts. */
export async function setWhereaboutsMany(
  eventId: string,
  assignmentIds: string[],
  whereabouts: Whereabouts,
  at: number = Date.now(),
): Promise<void> {
  if (assignmentIds.length === 0) return
  const before = await readShifts(eventId, assignmentIds)

  const batch = writeBatch(db)
  for (const id of assignmentIds) {
    recordInBatch(batch, {
      action: 'updated',
      entity: 'assignment',
      entityId: id,
      eventId,
      summary: whereabouts === 'out' ? 'Sent somebody out' : 'Brought somebody back',
      changes: shiftFacts(before.get(id), { whereabouts }),
    })
    const patch: Record<string, unknown> = { whereabouts }
    if (whereabouts === 'back') patch.checkedOutAt = at
    batch.update(paths.assignment(eventId, id), patch)
  }
  await batch.commit()
}

export async function setAssignmentStatus(
  eventId: string,
  assignmentId: string,
  status: AssignmentStatus,
  at: number = Date.now(),
  was: AssignmentStatus | null = null,
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (status === 'checkedIn') patch.checkedInAt = at
  if (status === 'noShow') patch.checkedInAt = null
  // See `setAssignmentStatusMany`: whereabouts means nothing once they are not checked in.
  if (status !== 'checkedIn') {
    patch.whereabouts = 'here'
    patch.checkedOutAt = null
  }

  // Marking somebody a no-show is a claim about a child that a parent may ask about.
  // Recorded like the money is: who said so, and what it said before.
  // Read first, so the line names which child, at which shop, at what hour.
  await auditedSet(paths.assignment(eventId, assignmentId), patch, {
    action: 'updated',
    entity: 'assignment',
    entityId: assignmentId,
    eventId,
    summary: `Marked a shift ${status}`,
    fields: ['status', 'personId', 'locationId', 'slotId'],
  })
  void was
}

/** Swap two people between their shifts, in one atomic batch. */
export async function swapAssignments(
  eventId: string,
  a: Assignment,
  b: Assignment,
): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'updated',
    entity: 'assignment',
    entityId: a.id,
    eventId,
    summary: 'Swapped two people between their shifts',
    changes: [
      { field: 'personId', from: a.personId, to: b.personId },
      { field: 'locationId', from: a.locationId, to: a.locationId },
      { field: 'slotId', from: a.slotId, to: a.slotId },
      { field: 'personId (other shift)', from: b.personId, to: a.personId },
      { field: 'locationId (other shift)', from: b.locationId, to: b.locationId },
      { field: 'slotId (other shift)', from: b.slotId, to: b.slotId },
    ],
  })
  batch.update(paths.assignment(eventId, a.id), { personId: b.personId })
  batch.update(paths.assignment(eventId, b.id), { personId: a.personId })
  await batch.commit()
}

const randomId = customAlphabet('123456789abcdefghijkmnpqrstuvwxyz', 10)

/**
 * A document per trip, not per jar.
 *
 * A jar goes out, comes back, is counted, emptied and goes out again several times over a
 * Saturday. The invariant is not "one record per jar per day" but "a jar can only be out
 * once at a time", which the issue dialog checks against what is currently out.
 */
const tripId = (day: Day, jarNumber: number | null): string =>
  jarNumber === null ? `${day}-extra-${randomId()}` : `${day}-jar-${jarNumber}-${randomId()}`

export interface RecordMoneyInput {
  /** Null for money that never went through a numbered jar. */
  jarNumber: number | null
  day: Day
  locationId: string
  personId: string | null
  amount: number
  method: PaymentMethod
  note: string
}

/**
 * Record money that did not come through the issue-and-count flow.
 *
 * Two cases: a jar taken off the table before anyone opened the app, and money that never
 * involved a jar — bushel sales, a donation handed over, a card tap away from the table.
 *
 * A numbered entry keeps the number in its document id, so one jar still cannot be recorded
 * twice on a day. Unnumbered money gets its own id, so a location can have as many separate
 * amounts as it really had.
 */
export async function recordMoney(
  eventId: string,
  input: RecordMoneyInput,
  countedBy: string,
): Promise<string> {
  const id = tripId(input.day, input.jarNumber)

  await auditedSet(
    paths.jar(eventId, id),
    {
      ...input,
      status: 'counted',
      assignmentId: null,
      issuedAt: 0,
      issuedBy: '',
      countedBy,
      countedAt: Date.now(),
    },
    {
      entity: 'jar',
      entityId: id,
      eventId,
      // Money entered without a jar ever having been issued — a cash tin, a late handover.
      summary: `Recorded ${auditMoney(input.amount)} against jar ${input.jarNumber}`,
      fields: ['amount', 'method', 'locationId', 'personId', 'note'],
    },
    {},
  )
  return id
}

export interface IssueJarInput {
  jarNumber: number
  day: Day
  locationId: string
  personId: string | null
  assignmentId: string | null
  /**
   * Every shift this jar is going out for. Consecutive shifts at one location are one trip,
   * and its takings belong to all of them. Omitted means just `assignmentId`.
   */
  assignmentIds?: string[]
}

/**
 * Hand a jar over and mark the shift as out collecting.
 *
 * One batch, because these are the same act: the jar leaving the table is what puts them on
 * the street.
 */

export async function issueJar(
  eventId: string,
  input: IssueJarInput,
  issuedBy: string,
): Promise<string> {
  const id = tripId(input.day, input.jarNumber)
  const batch = writeBatch(db)

  // Recorded rather than derived later: a schedule edited afterwards must not change how
  // last week's money was divided up.
  const assignmentIds =
    input.assignmentIds && input.assignmentIds.length > 0
      ? input.assignmentIds
      : input.assignmentId
        ? [input.assignmentId]
        : []

  batch.set(paths.jar(eventId, id), {
    ...input,
    assignmentIds,
    status: 'out',
    issuedAt: Date.now(),
    issuedBy,
    // Not zero, which would read as "came back empty".
    amount: null,
    method: 'cash',
    note: '',
    countedBy: '',
    countedAt: 0,
  })

  // Attendance is untouched: whether they turned up is a separate fact, set by hand.
  for (const move of shiftsOnIssue({ assignmentId: input.assignmentId, assignmentIds })) {
    batch.update(paths.assignment(eventId, move.assignmentId), {
      whereabouts: move.whereabouts,
    })
  }

  recordInBatch(batch, {
    action: 'created',
    entity: 'jar',
    entityId: id,
    eventId,
    summary: `Issued jar ${input.jarNumber}`,
  })

  await batch.commit()
  return id
}

/**
 * Record what was in a jar when it came back, and close the shift it went out on.
 *
 * The location and person come from the issue rather than from whoever is counting — that
 * is the point of issuing.
 */
/**
 * What was in a jar, and everything else about it that may need correcting.
 *
 * More than the amount, because somebody notices at nine o'clock that jar 12's money was
 * written against the wrong shop, or that the youth was never recorded. Without this those
 * corrections mean deleting the record and typing it again.
 */
export interface JarCount {
  amount: number
  method: PaymentMethod
  locationId: string
  personId: string | null
  note: string
}

export async function countJar(
  eventId: string,
  jar: Jar,
  count: JarCount,
  countedBy: string,
  wasTheirLastJar = true,
): Promise<void> {
  const batch = writeBatch(db)

  /*
    The change this whole log exists for. An amount is typed once, by whoever is at the
    table, and a correction later looks exactly like the original. Same batch, so the number
    and the name of whoever typed it land together or not at all.
  */
  recordInBatch(batch, {
    action: jar.status === 'counted' ? 'updated' : 'created',
    entity: 'jar',
    entityId: jar.id,
    eventId,
    summary:
      jar.status === 'counted'
        ? `Re-counted jar ${jar.jarNumber} at ${auditMoney(count.amount)}`
        : `Counted jar ${jar.jarNumber} at ${auditMoney(count.amount)}`,
    changes: diffFields(
      jar as unknown as Record<string, unknown>,
      {
        amount: count.amount,
        method: count.method,
        locationId: count.locationId,
        personId: count.personId,
        note: count.note,
      },
      ['amount', 'method', 'locationId', 'personId', 'note'],
    ),
  })

  batch.set(
    paths.jar(eventId, jar.id),
    {
      status: 'counted',
      amount: count.amount,
      method: count.method,
      locationId: count.locationId,
      personId: count.personId,
      note: count.note,
      countedBy,
      countedAt: Date.now(),
    },
    { merge: true },
  )

  for (const move of shiftsOnCount(jar, { at: Date.now(), wasTheirLastJar })) {
    batch.update(paths.assignment(eventId, move.assignmentId), {
      whereabouts: move.whereabouts,
      checkedOutAt: move.checkedOutAt,
    })
  }

  await batch.commit()
}

/**
 * Take an issued jar back before it has been counted.
 *
 * For the wrong number, the wrong person, or somebody who never went out. The record is
 * removed rather than kept — an uncounted jar holds nothing worth an audit trail.
 *
 * The shift only reverts when this was their last jar. Someone who took three and handed
 * one back is still out collecting.
 */
export async function unissueJar(
  eventId: string,
  jar: Jar,
  wasTheirLastJar: boolean,
): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'deleted',
    entity: 'jar',
    entityId: jar.id,
    eventId,
    // No money is lost, but the number becoming free again may need accounting for.
    summary: `Took jar ${jar.jarNumber} back before it was counted`,
    changes: [
      { field: 'jarNumber', from: String(jar.jarNumber), to: '—' },
      { field: 'personId', from: jar.personId ?? '—', to: '—' },
      { field: 'locationId', from: jar.locationId, to: '—' },
    ],
  })
  batch.delete(paths.jar(eventId, jar.id))

  for (const move of shiftsOnUnissue(jar, { wasTheirLastJar })) {
    batch.update(paths.assignment(eventId, move.assignmentId), {
      whereabouts: move.whereabouts,
    })
  }
  await batch.commit()
}

/** Put a jar back out — for one issued to the wrong person, or counted by mistake. */
export async function reopenJar(eventId: string, jar: Jar): Promise<void> {
  const batch = auditedBatch({
    action: 'updated',
    entity: 'jar',
    entityId: jar.id,
    eventId,
    // The amount disappearing is the part worth tracing: money that was counted is now not.
    summary: `Reopened jar ${jar.jarNumber}, clearing ${auditMoney(jar.amount)}`,
    changes: diffFields<{ amount: number | null; status: string }>(
      { amount: jar.amount, status: jar.status },
      { amount: null, status: 'out' },
      ['amount', 'status'],
    ),
  })
  batch.set(
    paths.jar(eventId, jar.id),
    { status: 'out', amount: null, countedBy: '', countedAt: 0 },
    { merge: true },
  )
  await batch.commit()
}

/**
 * Remove a jar record outright.
 *
 * Takes the jar rather than its id: "deleted jar 12" is not much use, "deleted jar 12,
 * which held $180" is what somebody will be looking for.
 */
export async function deleteJar(eventId: string, jar: Jar): Promise<void> {
  await auditedDelete(paths.jar(eventId, jar.id), {
    entity: 'jar',
    entityId: jar.id,
    eventId,
    summary:
      jar.amount === null
        ? `Deleted jar ${jar.jarNumber}, which had not been counted`
        : `Deleted jar ${jar.jarNumber}, which held ${auditMoney(jar.amount)}`,
    fields: ['amount', 'locationId', 'personId', 'jarNumber'],
  })
}

export async function saveReconciliation(
  eventId: string,
  value: Reconciliation,
  before: Reconciliation | null = null,
): Promise<void> {
  // These figures are typed by hand and the deposit is reconciled against them, so "the
  // cash counted said 6,089 last week and says 6,003 now" needs an answer.
  const batch = auditedBatch({
    action: 'updated',
    entity: 'reconciliation',
    entityId: 'summary',
    eventId,
    summary: 'Changed the reconciliation figures',
    changes: diffFields(
      before as unknown as Record<string, unknown> | null,
      value as unknown as Record<string, unknown>,
      ['squareTotal', 'bushelSales', 'cashCounted', 'deposit', 'notes'],
    ),
  })
  batch.set(paths.reconciliation(eventId), value, { merge: true })
  await batch.commit()
}

/**
 * A volunteer asking for a swap from their pass page.
 *
 * Create-only and validated by the rules against a real pass token, so the public write
 * path cannot be used to read anything or to spam arbitrary documents.
 */
/** Every request volunteers have sent from their passes this event. */
export function useVolunteerRequests(): Loadable<VolunteerRequest[]> {
  const { eventId } = useEvent()
  return useCollectionData(
    paths.swapRequests(eventId ?? '_none'),
    readRequest,
    [eventId],
  )
}

/**
 * Mark a request dealt with.
 *
 * Kept rather than deleted: a volunteer told "sorry, we could not cover it" should still be
 * findable in the record.
 */
export interface RequestSubject {
  /** Who wrote in. The request itself holds only their pass token. */
  personId: string
  /** Which shift it was about, where they named one. */
  slotId: string
  /** What they asked for, in the app's own words. */
  what: string
}

export async function markRequestHandled(
  eventId: string,
  requestId: string,
  handledBy: string,
  about: RequestSubject,
  handledByEmail: string = auth.currentUser?.email ?? '',
): Promise<void> {
  await auditedSet(
    paths.swapRequest(eventId, requestId),
    { handledAt: Date.now(), handledBy, handledByEmail },
    {
      entity: 'signup',
      entityId: requestId,
      eventId,
      summary: `Dealt with a request: ${about.what}`,
      // Not `handledBy`. Every entry already names who did it, so recording the same uid
      // again would say the organizer twice and the request not at all.
      fields: [],
      changes: requestFacts(about),
    },
  )
}

/**
 * Who the request was from and what it was about.
 *
 * Passed in rather than read back: the request document holds a pass token, not a person,
 * and the screen has already resolved it. Recorded as unchanged fields, the way a shift's
 * are — context, not edits.
 */
function requestFacts(about: RequestSubject): AuditChange[] {
  return [
    { field: 'handled', from: 'no', to: 'yes' },
    ...(about.personId
      ? [{ field: 'personId', from: about.personId, to: about.personId }]
      : []),
    ...(about.slotId ? [{ field: 'slotId', from: about.slotId, to: about.slotId }] : []),
  ]
}

/** Put one back in the queue, for a request closed by mistake. */
export async function reopenRequest(eventId: string, requestId: string): Promise<void> {
  await auditedSet(
    paths.swapRequest(eventId, requestId),
    { handledAt: null, handledBy: '', handledByEmail: '' },
    {
      entity: 'signup',
      entityId: requestId,
      eventId,
      summary: 'Put a request back in the queue',
      fields: [],
      changes: [{ field: 'handled', from: 'yes', to: 'no' }],
    },
  )
}

/**
 * A year's shifts and jars, held for as long as the tab is open.
 *
 * Every year but the one being run is finished — its shifts happened, its jars were counted
 * — so re-reading them on every visit to a location page buys nothing.
 *
 * The year being run is never held here. It changes all afternoon, and a history screen
 * quoting this morning's totals is worse than one that pauses to fetch them.
 *
 * Module-level, so it lasts a session and no longer.
 */
const finishedYears = new Map<string, EventData>()

async function readYear(event: AppleDayEvent): Promise<EventData> {
  const [assignments, jars] = await Promise.all([
    getDocs(paths.assignments(event.id)),
    getDocs(paths.jars(event.id)),
  ])
  return {
    event,
    assignments: assignments.docs.map((d) =>
      readAssignment(d.id, d.data() as Record<string, unknown>),
    ),
    jars: jars.docs.map((d) => readJar(d.id, d.data() as Record<string, unknown>)),
    slots: buildAllSlots(event.schedule, {
      shiftMode: event.shiftMode,
      shiftMinutes: event.shiftMinutes,
      overlapMinutes: event.overlapMinutes,
    }),
  }
}

/**
 * The shifts and jars of the years asked for, oldest first.
 *
 * Asked for, rather than all of them: both callers show two years by default, and the
 * location page is reached by clicking a shop name from three other screens. Use
 * `lookbackIds` to work out the ids — it answers from the event list, before any fetch.
 *
 * A one-off fetch rather than a subscription, because this is a question about the past.
 */
export function useEventHistory(ids: string[]): Loadable<EventData[]> {
  const { events, eventId, loading: eventsLoading } = useEvent()
  const [state, setState] = useState<Loadable<EventData[]>>({
    data: [],
    loading: true,
    error: null,
  })

  /*
    The ids as a string, so the effect reruns when the years being compared change and not
    on every render that hands back a new array. The event list is in the key too: until it
    arrives there is nothing to look anything up in.
  */
  const key = `${ids.join(',')}|${eventId ?? ''}|${events.map((e) => e.id).join(',')}`

  useEffect(() => {
    // Still waiting on the events: not an answer, so do not report one.
    if (eventsLoading) {
      setState((was) => (was.loading ? was : { ...was, loading: true }))
      return
    }
    if (ids.length === 0) {
      setState({ data: [], loading: false, error: null })
      return
    }

    let alive = true
    const byId = new Map(events.map((e) => [e.id, e]))

    void Promise.all(
      ids.map(async (id) => {
        const event = byId.get(id)
        // An id naming an event that is no longer there. The rest is still worth showing.
        if (!event) return null

        const finished = id !== eventId
        const held = finished ? finishedYears.get(id) : undefined
        if (held) return held

        const year = await readYear(event)
        if (finished) finishedYears.set(id, year)
        return year
      }),
    )
      .then((rows) => {
        if (alive) {
          setState({ data: rows.filter((r): r is EventData => r !== null), loading: false, error: null })
        }
      })
      .catch((error: Error) => {
        if (alive) setState({ data: [], loading: false, error })
      })

    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, eventsLoading])

  return state
}

/**
 * Forget what is held, so the next read goes to Firestore.
 *
 * For tests, and for an event being deleted or its shifts rewritten wholesale.
 */
export function forgetEventHistory(): void {
  finishedYears.clear()
}

// ---------------------------------------------------------------------------- access

function toRosterEntry(uid: string, d: Record<string, unknown>): RosterEntry {
  return {
    uid,
    email: typeof d.email === 'string' ? d.email : '',
    // An entry with no level is a full admin. Reading it as the lesser tier would lock the
    // group out.
    tier: d.level === 'organizer' ? 'organizer' : 'admin',
    addedAt: typeof d.addedAt === 'number' ? d.addedAt : 0,
    addedBy: typeof d.addedBy === 'string' ? d.addedBy : '',
  }
}

function toInvitation(code: string, d: Record<string, unknown>): Invitation {
  return {
    code,
    /*
      Empty for one made by hand in the console, which carries only a tier and a date — the
      screen shows those as "no address", because that is what they are. `label` is read as
      well for any invitation written before the field was named for what it holds.
    */
    email:
      typeof d.email === 'string' && d.email.trim()
        ? d.email
        : typeof d.label === 'string' && d.label.trim()
          ? d.label
          : '',
    tier: d.level === 'organizer' ? 'organizer' : 'admin',
    invitedAt: typeof d.invitedAt === 'number' ? d.invitedAt : 0,
    invitedBy: typeof d.invitedBy === 'string' ? d.invitedBy : '',
    note: typeof d.note === 'string' ? d.note : '',
  }
}


/** Everybody with access. Admins only — the rules refuse the query to anyone else. */
export const useRoster = (): Loadable<RosterEntry[]> =>
  useCollectionData(paths.admins(), toRosterEntry)

export const useInvitations = (): Loadable<Invitation[]> =>
  useCollectionData(paths.invites(), toInvitation)

/**
 * Make an invitation, and return the code that claims it.
 *
 * The label is for the admin's own list and is checked against nothing — the person is never
 * shown it. What grants the access is the code, which goes in a link, and whoever opens it
 * and signs in gets the tier it names.
 */
export async function inviteToTier(
  email: string,
  tier: Tier,
  invitedBy: string,
  note = '',
): Promise<string> {
  /*
    The code is the invitation, so it is made here and returned for the screen to show.

    Same generator as a volunteer's pass: holding it is the whole of the permission, so the
    only thing protecting it is that it cannot be guessed.
  */
  const code = generateToken()
  const who = normaliseEmail(email).slice(0, 120)

  await auditedSet(
    paths.invite(code),
    {
      email: who,
      level: tier,
      invitedAt: Date.now(),
      invitedBy,
      note: note.slice(0, 200),
    },
    {
      entity: 'access',
      // The address, never the code. An audit entry is read by admins and kept for years,
      // and a live invitation code in one is a way in sitting in the record.
      entityId: who || 'invitation',
      eventId: null,
      summary: `Invited ${who || 'somebody'} as ${tier}`,
      fields: ['level'],
    },
    {},
  )

  return code
}


/** Revoke one. The only way to take a sent link back, since holding it is the permission. */
export async function cancelInvitation(code: string): Promise<void> {
  await auditedDelete(paths.invite(code), {
    entity: 'access',
    // Not the code. Audit entries are kept for years and read by admins, and a code in one
    // is a way in — this one is being revoked, but the habit is what keeps the log safe.
    entityId: 'invitation',
    eventId: null,
    summary: 'Cancelled an invitation',
  })
}

/** Move somebody between tiers. The rules refuse this on your own entry. */
export async function setTier(uid: string, tier: Tier): Promise<void> {
  await auditedSet(paths.admin(uid), { level: tier }, {
    entity: 'access',
    entityId: uid,
    eventId: null,
    // Who can change what. Worth tracing on its own account.
    summary: `Changed somebody\u2019s access to ${tier}`,
    fields: ['level'],
  })
}

/**
 * Take somebody's access away.
 *
 * Just the roster entry. An invitation is spent when it is claimed, so somebody already on
 * the roster has nothing left to come back through — and there is no way to look for one by
 * their address, because an invitation records no address to look for.
 */
export async function removeAccess(uid: string): Promise<void> {
  await auditedDelete(paths.admin(uid), {
    entity: 'access',
    entityId: uid,
    eventId: null,
    summary: 'Removed somebody\u2019s access',
  })
}

export async function requestSwap(
  eventId: string,
  passToken: string,
  kind: RequestKind,
  message: string,
  slotId = '',
): Promise<void> {
  const id = `${passToken.slice(0, 8)}-${Date.now()}`
  await setDoc(paths.swapRequest(eventId, id), {
    passToken,
    kind,
    // Which shift, so the organizer knows whether Friday or Saturday is the problem. Empty
    // means all of them.
    slotId,
    message: message.slice(0, 500),
    createdAt: Date.now(),
  })
}

/** Apply an import plan in batches. Firestore caps a batch at 500 writes. */
export async function applyImport(
  eventId: string,
  people: Person[],
  signups: Signup[],
): Promise<{ written: number }> {
  let batch = writeBatch(db)
  let pending = 0
  let written = 0

  const flush = async (): Promise<void> => {
    if (pending > 0) {
      await batch.commit()
      batch = writeBatch(db)
      pending = 0
    }
  }

  // One line for the import, not one per row: ninety identical entries would bury a day's
  // real changes. The rows themselves record what arrived.
  recordInBatch(batch, {
    action: 'created',
    entity: 'signup',
    entityId: 'import',
    eventId,
    summary: `Imported ${people.length} people and ${signups.length} availability rows`,
  })
  pending += 1

  for (const person of people) {
    const { id, ...rest } = person
    batch.set(paths.person(eventId, id), rest, { merge: true })
    pending += 1
    written += 1
    if (pending >= 450) await flush()
  }
  for (const signup of signups) {
    const { id, ...rest } = signup
    batch.set(paths.signup(eventId, id), rest, { merge: true })
    pending += 1
    written += 1
    if (pending >= 450) await flush()
  }
  await flush()

  return { written }
}

export function sectionCounts(people: Person[]): Record<Section, number> {
  const counts: Record<Section, number> = {}
  for (const p of people) counts[p.section] = (counts[p.section] ?? 0) + 1
  return counts
}

// ------------------------------------------------------------ removing an event

/**
 * How much an event is holding, before anybody is asked to confirm losing it.
 *
 * "This cannot be undone" is easy to click past; "113 people, 75 shifts, 64 jars" is not.
 */
export async function tallyEvent(eventId: string): Promise<EventTally> {
  const tally: EventTally = {}

  await Promise.all([
    ...EVENT_SUBCOLLECTIONS.map(async (name) => {
      const snap = await getDocs(collection(db, 'events', eventId, name))
      if (snap.size > 0) tally[name] = snap.size
    }),
    (async () => {
      const snap = await getDocs(query(paths.passes(), where('eventId', '==', eventId)))
      if (snap.size > 0) tally.passes = snap.size
    })(),
  ])

  return tally
}

/**
 * Remove an event and everything under it.
 *
 * Firestore does not cascade, so this walks `EVENT_SUBCOLLECTIONS` — checked against
 * `paths.ts` by a test, so a new subcollection cannot be quietly left behind.
 *
 * Children first and the event document last, so a failure part-way leaves the event still
 * listed and the whole thing retryable. The audit entry shares the final commit and is
 * filed against no event, the way creating one is.
 *
 * It cannot take the audit trail: entries are create-only by rule, since "who removed 2025"
 * is exactly what a log is for. The screen says so.
 */
export async function removeEvent(event: AppleDayEvent): Promise<void> {
  const doomed: DocumentReference[] = []

  for (const name of EVENT_SUBCOLLECTIONS) {
    const snap = await getDocs(collection(db, 'events', event.id, name))
    doomed.push(...snap.docs.map((d) => d.ref))
  }

  // Top-level, but this event's: a pass outliving its event is a working link into nothing.
  const passes = await getDocs(query(paths.passes(), where('eventId', '==', event.id)))
  doomed.push(...passes.docs.map((d) => d.ref))

  const tally = await tallyEvent(event.id)

  // Comfortably under Firestore's 500-write limit, so a batch never fails for its size.
  const PER_BATCH = 400
  for (let from = 0; from < doomed.length; from += PER_BATCH) {
    const batch = writeBatch(db)
    for (const ref of doomed.slice(from, from + PER_BATCH)) batch.delete(ref)
    await batch.commit()
  }

  const last = auditedBatch({
    action: 'deleted',
    entity: 'event',
    entityId: event.id,
    eventId: null,
    summary: `Removed ${event.name || event.id} and everything in it`,
    // What went, named, so the log answers more than "an event was removed".
    changes: Object.entries(tally).map(([field, n]) => ({
      field,
      from: String(n ?? 0),
      to: '—',
    })),
  })
  last.delete(paths.event(event.id))
  await last.commit()
}
