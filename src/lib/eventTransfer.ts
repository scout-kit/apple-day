import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore'
import { EVENT_SUBCOLLECTIONS } from '../domain/eventRemoval'
import { TRANSFER_FORMAT } from '../domain/eventTransfer'
import type { EventTransfer } from '../domain/eventTransfer'
import type { AppleDayEvent } from '../domain/types'
import { recordInBatch } from './audit'
import { db } from './firebase'
import { paths } from './paths'

/**
 * Taking a year out of Firestore and putting one back.
 *
 * The shape of the file and every judgement about it are in `domain/eventTransfer`; this is
 * the reading and writing, which is all this layer should be.
 */

/** Comfortably under Firestore's 500-write limit, so a batch never fails for its size. */
const PER_BATCH = 400

/**
 * A read that says what it was reading when it failed.
 *
 * An export walks a dozen collections, and "Missing or insufficient permissions" names none
 * of them. That is the whole of what somebody gets to act on: which rule, which collection,
 * whether it is this year's records or the shared library. Twice now the answer has been a
 * subcollection with no rule behind it, and both times finding out meant reading this file.
 *
 * The original is kept as the cause, so nothing is lost by naming the path.
 */
async function reading<T>(what: string, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (cause) {
    const said = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`${said} (reading ${what})`, { cause })
  }
}

/**
 * Everything needed to rebuild a year somewhere else.
 *
 * Reads the event's own subcollections, then the shops and sections its records point at.
 * Those last two are the difference between a restore and a board full of unknown places —
 * they live outside the event because they are shared between years, which is exactly why a
 * project that never ran this year will not have them.
 */
export async function exportEvent(
  event: AppleDayEvent,
  projectId: string,
): Promise<EventTransfer> {
  const records: EventTransfer['records'] = {}

  for (const name of EVENT_SUBCOLLECTIONS) {
    const snap = await reading(`events/${event.id}/${name}`, () =>
      getDocs(collection(db, 'events', event.id, name)),
    )
    if (snap.docs.length === 0) continue
    records[name] = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))
  }

  /*
    Only what this year points at.

    A library holds every shop the group has ever called on, and most of them have nothing to
    do with this year. Carrying the lot would make a restore quietly rewrite shops the
    destination already had its own record of.
  */
  const wanted = new Set<string>()
  for (const name of ['assignments', 'jars', 'eventLocations'] as const) {
    for (const [id, row] of Object.entries(records[name] ?? {})) {
      const locationId = name === 'eventLocations' ? id : (row.locationId as string | undefined)
      if (typeof locationId === 'string' && locationId) wanted.add(locationId)
    }
  }
  if (typeof event.baseLocationId === 'string' && event.baseLocationId) {
    wanted.add(event.baseLocationId)
  }

  const locations: EventTransfer['locations'] = {}
  for (const id of wanted) {
    const snap = await reading(`locations/${id}`, () => getDoc(paths.location(id)))
    if (snap.exists()) locations[id] = snap.data()
  }

  const usedSections = new Set(
    Object.values(records.people ?? {})
      .map((p) => p.section)
      .filter((s): s is string => typeof s === 'string' && s !== ''),
  )
  const sections: EventTransfer['sections'] = {}
  for (const id of usedSections) {
    const snap = await reading(`sections/${id}`, () => getDoc(paths.section(id)))
    if (snap.exists()) sections[id] = snap.data()
  }

  /*
    Passes, which are stored outside the event because a token is the credential and a parent
    does not know an event id. Kept so links already handed out still work after a restore —
    and the reason the file is as sensitive as it is.
  */
  const passSnap = await reading('passes', () =>
    getDocs(query(paths.passes(), where('eventId', '==', event.id))),
  )
  const passes = Object.fromEntries(passSnap.docs.map((d) => [d.id, d.data()]))

  return {
    format: TRANSFER_FORMAT,
    exportedAt: Date.now(),
    fromProject: projectId,
    event,
    records,
    locations,
    sections,
    passes,
  }
}

/**
 * Write a year back, in the order that leaves nothing pointing at nothing.
 *
 * Shops and sections first, then the event, then its records: at no point is there an event
 * on screen whose rows name places the library has not heard of. The event document last of
 * those three because it is what every screen keys off — until it exists, none of this is
 * reachable, which is the right way for a half-finished restore to fail.
 */
export async function restoreEvent(file: EventTransfer): Promise<void> {
  const writes: { path: ReturnType<typeof doc>; data: Record<string, unknown> }[] = []

  for (const [id, data] of Object.entries(file.sections)) {
    writes.push({ path: paths.section(id), data })
  }
  for (const [id, data] of Object.entries(file.locations)) {
    writes.push({ path: paths.location(id), data })
  }

  const { id, ...event } = file.event
  writes.push({ path: paths.event(id), data: event as unknown as Record<string, unknown> })

  for (const [name, docs] of Object.entries(file.records)) {
    for (const [docId, data] of Object.entries(docs)) {
      writes.push({ path: doc(db, 'events', id, name, docId), data })
    }
  }
  for (const [token, data] of Object.entries(file.passes)) {
    writes.push({ path: paths.pass(token), data })
  }

  for (let from = 0; from < writes.length; from += PER_BATCH) {
    const batch = writeBatch(db)
    for (const write of writes.slice(from, from + PER_BATCH)) batch.set(write.path, write.data)
    await batch.commit()
  }

  const last = writeBatch(db)
  recordInBatch(last, {
    action: 'created',
    entity: 'event',
    entityId: id,
    eventId: null,
    summary: `Restored ${file.event.name || id} from a file`,
    changes: [
      { field: 'from', from: '—', to: file.fromProject || 'an export' },
      { field: 'documents', from: '—', to: String(writes.length) },
    ],
  })
  await last.commit()
}
