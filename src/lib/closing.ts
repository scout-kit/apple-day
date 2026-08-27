import { collection, getDocs, query, where, writeBatch } from 'firebase/firestore'
import { CONTACT_FIELDS, closingCost, holdsContacts } from '../domain/closing'
import type { ClosingCost } from '../domain/closing'
import type { AppleDayEvent, Person } from '../domain/types'
import { recordInBatch } from './audit'
import { db } from './firebase'
import { paths } from './paths'
import { toPerson } from './repo'

/**
 * Closing out a year.
 *
 * Why any of this exists is in `domain/closing`. This is the writing: the passes go, the
 * parents' contact details are blanked where they are held, and the event is stamped.
 *
 * One walk, in batches, in that order. Passes first because they are the exposure that does
 * not need an account to reach — a token is the whole credential — and if the run fails
 * part-way, the half that has happened is the half worth having.
 */

/** Comfortably under Firestore's 500-write limit, so a batch never fails for its size. */
const PER_BATCH = 400

/**
 * What a year is still holding, before anybody is asked to give it up.
 *
 * Read here rather than through the hooks, because this screen lists every year and the
 * hooks are scoped to the one that is open — the same reason `tallyEvent` reads its own.
 */
export async function gatherClosing(
  eventId: string,
): Promise<{ people: Person[]; passTokens: string[] }> {
  const [peopleSnap, passSnap] = await Promise.all([
    getDocs(collection(db, 'events', eventId, 'people')),
    getDocs(query(paths.passes(), where('eventId', '==', eventId))),
  ])

  return {
    people: peopleSnap.docs.map((d) => toPerson(d.id, d.data())),
    passTokens: passSnap.docs.map((d) => d.id),
  }
}

export async function finishEvent(
  event: AppleDayEvent,
  people: Person[],
  passTokens: string[],
): Promise<ClosingCost> {
  const holders = people.filter(holdsContacts)
  const cost = closingCost(passTokens, people)

  let batch = writeBatch(db)
  let pending = 0

  const flush = async (): Promise<void> => {
    if (pending > 0) {
      await batch.commit()
      batch = writeBatch(db)
      pending = 0
    }
  }

  for (const token of passTokens) {
    batch.delete(paths.pass(token))
    pending += 1
    if (pending >= PER_BATCH) await flush()
  }

  for (const person of holders) {
    /*
      Blanked, not deleted, and merged rather than rewritten.

      Every field is written explicitly as an empty string: a merge does not remove what it
      is not given, so omitting one would leave it exactly where it was. The youth's own name
      and section are not touched — telling this year's Calvin from the last three is the
      whole value of looking back, and a first name alone does not.
    */
    batch.set(
      paths.person(event.id, person.id),
      Object.fromEntries(CONTACT_FIELDS.map((field) => [field, ''])),
      { merge: true },
    )
    pending += 1
    if (pending >= PER_BATCH) await flush()
  }

  /*
    The stamp, and the record of what went.

    Changes on the entry rather than a bare summary, because an `updated` entry carrying none
    is dropped by `worthRecording` — and this is the last entry that will ever say how many
    families' details this year held.
  */
  recordInBatch(batch, {
    action: 'updated',
    entity: 'event',
    entityId: event.id,
    eventId: event.id,
    summary: `Finished ${event.name || event.id}`,
    changes: [
      { field: 'links deleted', from: String(cost.passes), to: '0' },
      { field: 'contact details cleared', from: String(cost.contacts), to: '0' },
    ],
  })
  batch.set(paths.event(event.id), { finishedAt: Date.now() }, { merge: true })
  pending += 1
  await flush()

  return cost
}

/**
 * Put a finished year back to running.
 *
 * Only the stamp comes back. The passes were deleted and the contact details were blanked,
 * and nothing here can undo either — which the screen says, because the reason somebody
 * reaches for this is usually that they did not mean to finish it.
 *
 * Worth having anyway: without it, one wrong press means a year that can never be published
 * again, and the way round that would be somebody editing Firestore by hand.
 */
export async function reopenEvent(event: AppleDayEvent): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'updated',
    entity: 'event',
    entityId: event.id,
    eventId: event.id,
    summary: `Reopened ${event.name || event.id}`,
    changes: [{ field: 'finishedAt', from: String(event.finishedAt ?? 0), to: '—' }],
  })
  batch.set(paths.event(event.id), { finishedAt: 0 }, { merge: true })
  await batch.commit()
}
