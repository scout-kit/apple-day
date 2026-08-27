import { deleteField, writeBatch } from 'firebase/firestore'
import {
  buildPassShifts,
  generateToken,
  publishedFingerprint,
} from '../domain/publishing'
import type { PublishInput, PublishedPass } from '../domain/publishing'
import { fullName, wasWorked } from '../domain/types'
import { db } from './firebase'
import { paths } from './paths'
import { recordInBatch } from './audit'

/**
 * Writing a publish to Firestore.
 *
 * The shift-flattening this depends on is a pure function in `src/domain/publishing.ts`,
 * kept there so it can be tested without Firebase.
 *
 * With no Cloud Functions there is nothing to email on our behalf, so publishing produces
 * an artefact instead: a pass per volunteer, reached by a link only they are given.
 */

/**
 * Write a pass per scheduled volunteer, plus a record of what was published.
 *
 * Volunteers with no shift get no pass — there is nothing to tell them, and the schedule
 * board already flags them separately.
 */
export async function publish(
  eventId: string,
  input: PublishInput,
): Promise<PublishedPass[]> {
  const {
    people,
    assignments,
    support,
    supportNote,
    arrivalNote,
    base = null,
    existingTokens = new Map(),
  } = input

  const live = assignments.filter((a) => a.status !== 'swapped')
  const scheduledPersonIds = new Set(live.map((a) => a.personId))

  /*
    Who has already turned up, so re-publishing does not send them back to base.

    A pass hides where somebody is going until an organizer checks them in. Writing that flag
    as a flat `false` is right for the first publish, when nobody has arrived, and wrong for
    every one after: re-publishing part-way through the Saturday — or after it, to correct
    something — took the locations off the pass of everybody already standing at a door.

    Read off the board rather than carried over from the old pass, because the board is what
    the check-in actually changed. Somebody who has been un-checked-in is hidden again by the
    same reading, which is what the flag is for.
  */
  const arrived = new Set(live.filter(wasWorked).map((a) => a.personId))
  const personById = new Map(people.map((p) => [p.id, p]))

  const published: PublishedPass[] = []
  let batch = writeBatch(db)
  let pending = 0

  const flush = async (): Promise<void> => {
    if (pending > 0) {
      await batch.commit()
      batch = writeBatch(db)
      pending = 0
    }
  }

  for (const personId of scheduledPersonIds) {
    const person = personById.get(personId)
    if (!person) continue

    const shifts = buildPassShifts(personId, input)
    const token = existingTokens.get(personId) ?? generateToken()

    batch.set(paths.pass(token), {
      eventId,
      personId,
      // A pass shows the holder their own name in full; it is already their own data.
      displayName: fullName(person),
      support,
      supportNote,
      arrivalNote,
      /*
        Where they are going is withheld until an organizer checks them in.

        Everyone reports to base first — that is where the jars and apples are — so a pass
        that names a location invites a youth to skip it and go straight there. It also means
        a link that gets forwarded around does not tell a stranger where a named child will be
        standing at five o'clock. The organizer checking them in reveals it, and a re-publish
        keeps it revealed for anybody who has already arrived.
      */
      revealShifts: arrived.has(personId),
      // On the pass itself: where to report is the first thing a parent needs, and looking
      // it up would cost a second read on a phone with one bar of signal.
      base,
      shifts,
      publishedAt: Date.now(),
    })
    pending += 1
    published.push({ token, personId, displayName: fullName(person), shiftCount: shifts.length })

    if (pending >= 450) await flush()
  }

  /*
    What was published, so the app can tell later whether the board has moved on.

    A hash rather than a copy: it is only ever compared against the same hash taken over
    the board as it stands, and it is written in the same batch as the passes, so the two
    can never disagree about what went out.
  */
  /*
    Both hashes, from the one value, in the one write.

    `currentFingerprint` is what the board hashes to and is normally recorded as the board
    is used; setting it here as well means a publish lands "current" rather than showing a
    re-publish notice for as long as it took somebody to open a screen that records it.
  */
  const fingerprint = publishedFingerprint(input)
  /*
    Publishing is a decision, unlike the fingerprint recording that happens as the board is
    used: it changes what is in front of every volunteer, all at once.
  */
  /*
    `created`, and not `updated`, because that is what it is: a publish writes a pass per
    volunteer. It also has to be — an `updated` entry carrying no field changes is dropped by
    `worthRecording`, which is right for a save that moved nothing and wrong here, and meant
    the log said nothing at all about the one action that reaches every volunteer at once.
  */
  recordInBatch(batch, {
    action: 'created',
    entity: 'event',
    entityId: 'publish',
    eventId,
    summary: `Published the schedule to ${published.length} volunteers`,
  })
  batch.set(paths.publishState(eventId), {
    publishedAt: Date.now(),
    fingerprint,
    currentFingerprint: fingerprint,
    currentAt: Date.now(),
  })
  pending += 1
  await flush()

  return published.sort((a, b) => a.displayName.localeCompare(b.displayName))
}



/**
 * Take a published schedule back.
 *
 * Deletes every pass for the event and returns the publish record to "never published", so
 * the board stops claiming a schedule is out and the notice stops offering a stale link.
 *
 * The links die with the documents — that is the whole of it, since a pass is reached by its
 * token and by nothing else. `src/domain/unpublish.ts` has what that costs and why the screen
 * says it first.
 *
 * The board's own hash is left alone. It describes the schedule as it stands, which
 * unpublishing does not touch, and clearing it would make the next publish look stale the
 * moment it landed.
 */
export async function unpublish(eventId: string, tokens: string[]): Promise<number> {
  let batch = writeBatch(db)
  let pending = 0

  const flush = async (): Promise<void> => {
    if (pending > 0) {
      await batch.commit()
      batch = writeBatch(db)
      pending = 0
    }
  }

  for (const token of tokens) {
    batch.delete(paths.pass(token))
    pending += 1
    if (pending >= 450) await flush()
  }

  recordInBatch(batch, {
    action: 'deleted',
    entity: 'event',
    entityId: 'publish',
    eventId,
    summary: `Unpublished the schedule, withdrawing ${tokens.length} ${
      tokens.length === 1 ? 'pass' : 'passes'
    }`,
  })

  /*
    Back to never-published rather than deleted.

    `publishStatus` reads a zero `publishedAt` as "never", and the document also carries the
    board's current hash, which is nothing to do with publishing. Removing the record would
    throw that away and cost a re-read of every person, location and assignment to rebuild.

    The old fingerprint goes, though: leaving it would let a later comparison call an
    unpublished event current.
  */
  batch.set(
    paths.publishState(eventId),
    { publishedAt: 0, fingerprint: deleteField() },
    { merge: true },
  )
  pending += 1
  await flush()

  return tokens.length
}
