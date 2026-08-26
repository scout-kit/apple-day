import { getDoc, writeBatch } from 'firebase/firestore'
import type { DocumentReference, WriteBatch } from 'firebase/firestore'
import { auditValue, diffFields, worthRecording } from '../domain/audit'
import type { AuditAction, AuditChange, AuditEntity } from '../domain/audit'
import { auth, db } from './firebase'
import { paths } from './paths'

/**
 * Putting a change and the record of it into the same write.
 *
 * The entry goes in the caller's batch, never in a second one. A batch is atomic: either the
 * jar's new amount and the line saying who typed it both land, or neither does. Two separate
 * writes would eventually leave a change with no record — on a dropped connection at a shop
 * doorway, which is exactly when somebody later wants to know what happened.
 *
 * The rules also require this: a jar write without its entry is refused. That is what makes
 * the log a record rather than a courtesy — see `firestore.rules`.
 */
export interface AuditFacts {
  action: AuditAction
  entity: AuditEntity
  entityId: string
  eventId: string | null
  /** One line in the app's own words: "Counted jar 12 at Braemar". */
  summary: string
  changes?: AuditChange[]
}

/** A local id, so the entry can be written in the same batch as the thing it describes. */
function entryId(): string {
  const now = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${now}-${rand}`
}

/**
 * Who is doing this.
 *
 * The uid is the only part the rules can vouch for; the rest is a convenience for whoever
 * reads the log, and is stored rather than looked up because the roster entry may be gone by
 * the time anybody asks.
 *
 * The address, not the display name. Two Scouters called Dave are one line each in a log
 * read years later in an argument, and a Google display name is whatever somebody set it to
 * — it is not an identity anybody can act on. An address is the same string that appears on
 * the access list and in the invitation that granted it.
 */
function actor(): { by: string; byName: string; byEmail: string } {
  const user = auth.currentUser
  return {
    by: user?.uid ?? '',
    // Kept being written for entries read by anything expecting it; the screens show the
    // address. Empty rather than absent, because `undefined` is not a Firestore value.
    byName: user?.displayName ?? user?.email ?? '',
    byEmail: user?.email ?? '',
  }
}

export function recordInBatch(batch: WriteBatch, facts: AuditFacts): void {
  const changes = facts.changes ?? []
  // A save that moved nothing is not an event, and a log full of those is one nobody reads.
  if (!worthRecording(facts.action, changes)) return

  batch.set(paths.auditEntry(entryId()), {
    at: Date.now(),
    ...actor(),
    action: facts.action,
    entity: facts.entity,
    entityId: facts.entityId,
    eventId: facts.eventId,
    summary: facts.summary,
    changes,
  })
}

/**
 * For a change that was a single write before this existed.
 *
 * Returns a batch with the entry already in it, so the caller adds its own write and
 * commits. Nothing is recorded twice and nothing can be committed without its record.
 */
export function auditedBatch(facts: AuditFacts): WriteBatch {
  const batch = writeBatch(db)
  recordInBatch(batch, facts)
  return batch
}

/**
 * Save a record, and write down what moved, in one commit.
 *
 * The previous values are read here rather than passed in. Threading a `before` through
 * every screen that edits something means thirty call sites that can each get it wrong, and
 * the one that does is silently a lie in the log — worse than no log. One read costs a
 * fraction of the budget (a few hundred a day against fifty thousand) and cannot be got
 * wrong by a caller.
 *
 * The read is not part of the atomic write, so a change landing between the read and the
 * commit would make `from` stale. That needs a transaction, which costs another round trip
 * on a phone with one bar; at this scale — one person editing one location at a time — the
 * trade is not close.
 */
export async function auditedSet(
  ref: DocumentReference,
  data: Record<string, unknown>,
  facts: Omit<AuditFacts, 'changes' | 'action'> & {
    /** Which fields are worth a line. Never the whole document — see `diffFields`. */
    fields: string[]
    /** Given when the caller already knows; otherwise taken from whether it existed. */
    action?: AuditAction
    /**
     * Lines the caller knows and the document does not.
     *
     * A request holds a pass token rather than a person, so who wrote in cannot be diffed
     * out of it — and an entry that cannot say who it was about is the one nobody can use.
     */
    changes?: AuditChange[]
  },
  options: { merge?: boolean } = { merge: true },
): Promise<void> {
  const existing = await getDoc(ref).catch(() => null)
  const before = existing?.exists() ? (existing.data() as Record<string, unknown>) : null

  const batch = writeBatch(db)
  recordInBatch(batch, {
    ...facts,
    action: facts.action ?? (before ? 'updated' : 'created'),
    changes: [...(facts.changes ?? []), ...diffFields(before, data, facts.fields)],
  })
  batch.set(ref, data, options)
  await batch.commit()
}

/**
 * Remove a record, and write down what it was, in one commit.
 *
 * `fields` is what makes a deletion answerable. "Removed a shift from the board" tells
 * nobody anything; the question is always which shift, whose, and where — and once the
 * document is gone there is no way back to that. So the values are read and kept before the
 * write, as `value → —`, which is what a deletion actually is.
 */
export async function auditedDelete(
  ref: DocumentReference,
  facts: Omit<AuditFacts, 'action'> & { fields?: string[] },
): Promise<void> {
  const { fields, ...rest } = facts

  let changes = rest.changes ?? []
  if (fields && fields.length > 0) {
    const existing = await getDoc(ref).catch(() => null)
    const before = existing?.exists() ? (existing.data() as Record<string, unknown>) : null
    if (before) {
      changes = [
        ...changes,
        ...fields.flatMap((field) =>
          field in before
            ? [{ field, from: auditValue(before[field]), to: '—' }]
            : [],
        ),
      ]
    }
  }

  const batch = writeBatch(db)
  recordInBatch(batch, { ...rest, action: 'deleted', changes })
  batch.delete(ref)
  await batch.commit()
}
