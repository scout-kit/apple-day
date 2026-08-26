import { getDoc, writeBatch } from 'firebase/firestore'
import { useMemo } from 'react'
import { ledgerId, outstanding, selectionKey } from '../domain/reminders'
import type { Recipient, RecipientYouth, Selection } from '../domain/reminders'
import type { TemplateId, TemplateText } from '../domain/reminderText'
import { auditedDelete, auditedSet, recordInBatch } from './audit'
import { auth, db } from './firebase'
import { useEvent } from './eventContext'
import { paths } from './paths'
import { useCollectionData } from './useData'
import type { Loadable } from './useData'

/**
 * What has already been sent, and to whom.
 *
 * A record per youth even though a message goes to an address, because "has this child's
 * parent been told about this shift" is the question being answered, and a sibling added
 * later must not look already-done on the strength of the first one.
 *
 * Append-only, like the audit log: a send happened or it did not, and tidying that away
 * afterwards would leave nobody able to answer whether a parent was told.
 */

export type SendChannel = 'gmail' | 'csv'

export interface ReminderRecord {
  templateId: TemplateId
  selectionKey: string
  personId: string
  assignmentIds: string[]
  sentAt: number
  sentBy: string
  /**
   * The organizer's address, denormalized at write time.
   *
   * The roster is admin-readable only and this is read on a screen organizers work from,
   * so it cannot be resolved on the way out — the same reason `handledByEmail` is stored on
   * a volunteer request.
   */
  sentByEmail: string
  channel: SendChannel
}

/**
 * Who has already had this exact reminder.
 *
 * One `getDoc` per youth, by an id built from the wording, the selection and the person —
 * no query, so no index, and no chance of reading a stale result from a listener that has
 * not caught up.
 *
 * Failures are treated as "not sent". Getting that wrong sends a second copy of a reminder,
 * which is a nuisance; the other way round silently drops somebody, which is not.
 */
export async function alreadySent(
  eventId: string,
  templateId: TemplateId,
  selection: Selection,
  personIds: string[],
): Promise<Set<string>> {
  const found = await Promise.all(
    personIds.map(async (personId) => {
      const snap = await getDoc(
        paths.reminder(eventId, ledgerId(templateId, selection, personId)),
      ).catch(() => null)
      return snap?.exists() ? personId : null
    }),
  )
  return new Set(found.filter((id): id is string => id !== null))
}

/**
 * Record that a message went out, one line per youth it covered.
 *
 * Written immediately after that address's send succeeds rather than batched at the end of
 * the run: a failure halfway through then leaves an accurate record of who was actually
 * reached, and a retry naturally targets only the rest.
 *
 * The address is deliberately absent. The ledger is keyed by person, and contact details
 * belong in `people`, which is read by fewer screens.
 */
export async function recordSent(
  eventId: string,
  templateId: TemplateId,
  selection: Selection,
  youths: RecipientYouth[],
  channel: SendChannel,
): Promise<void> {
  if (youths.length === 0) return

  const user = auth.currentUser
  const batch = writeBatch(db)
  for (const youth of youths) {
    batch.set(paths.reminder(eventId, ledgerId(templateId, selection, youth.person.id)), {
      templateId,
      selectionKey: selectionKey(selection),
      personId: youth.person.id,
      assignmentIds: youth.assignmentIds,
      sentAt: Date.now(),
      sentBy: user?.uid ?? '',
      sentByEmail: user?.email ?? '',
      channel,
    })
  }
  await batch.commit()
}

/**
 * One audit line for the whole send, not one per recipient.
 *
 * Eighteen lines saying the same thing would drown a log that is read perhaps twice a year,
 * and the ledger above already answers "was this person told". What the log wants is that
 * somebody sent something, what it said, and how many it reached.
 */
export async function recordSendInLog(
  eventId: string,
  facts: {
    templateLabel: string
    occasion: string
    addresses: number
    skipped: number
    failed: number
    channel: SendChannel
  },
): Promise<void> {
  const batch = writeBatch(db)
  recordInBatch(batch, {
    action: 'created',
    entity: 'reminder',
    entityId: `${facts.channel}-${Date.now().toString(36)}`,
    eventId,
    summary: `Sent "${facts.templateLabel}"${facts.occasion ? ` for ${facts.occasion}` : ''} to ${facts.addresses} ${facts.addresses === 1 ? 'address' : 'addresses'}`,
    changes: [
      { field: 'sent', from: '—', to: String(facts.addresses) },
      ...(facts.skipped > 0
        ? [{ field: 'skipped', from: '—', to: String(facts.skipped) }]
        : []),
      ...(facts.failed > 0 ? [{ field: 'failed', from: '—', to: String(facts.failed) }] : []),
    ],
  })
  await batch.commit()
}

/** Everybody a message still needs to reach, once the ledger has had its say. */
export function pendingFor(
  recipient: Recipient,
  sent: ReadonlySet<string>,
  duplicates: 'skip' | 'resend',
): RecipientYouth[] {
  return duplicates === 'resend' ? recipient.youths : outstanding(recipient, sent)
}

/**
 * Everything already sent for this event.
 *
 * One listener over the whole ledger rather than a lookup per person per selection. At this
 * size — a few sends across sixty youth — it is a few hundred documents read once and kept
 * live, which is cheaper than the point-reads it replaces *and* answers a question they
 * could not: what has gone out, rather than only whether this particular thing has.
 */
export function useSentReminders(): Loadable<ReminderRecord[]> {
  const { eventId } = useEvent()
  return useCollectionData(paths.reminders(eventId ?? '_none'), toReminderRecord, [eventId])
}

function toReminderRecord(_id: string, d: Record<string, unknown>): ReminderRecord {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '')
  return {
    templateId: str(d.templateId) as TemplateId,
    selectionKey: str(d.selectionKey),
    personId: str(d.personId),
    assignmentIds: Array.isArray(d.assignmentIds) ? d.assignmentIds.map(String) : [],
    sentAt: typeof d.sentAt === 'number' ? d.sentAt : 0,
    sentBy: str(d.sentBy),
    sentByEmail: str(d.sentByEmail),
    channel: (d.channel === 'csv' ? 'csv' : 'gmail') as SendChannel,
  }
}

// ------------------------------------------------------------------- wording

/**
 * The wording an organizer has saved, if any.
 *
 * A live subscription, because two organizers can be looking at the reminder screen at the
 * same time and the one who did not make the edit should not send the old words.
 */
export function useReminderTemplates(): Loadable<Map<TemplateId, TemplateText>> {
  const raw = useCollectionData(paths.reminderTemplates(), toTemplateText)
  const data = useMemo(
    () => new Map(raw.data.map((t) => [t.id, { subject: t.subject, body: t.body }])),
    [raw.data],
  )
  return { data, loading: raw.loading, error: raw.error }
}

function toTemplateText(
  id: string,
  d: Record<string, unknown>,
): { id: TemplateId; subject: string; body: string } {
  return {
    id: id as TemplateId,
    subject: typeof d.subject === 'string' ? d.subject : '',
    body: typeof d.body === 'string' ? d.body : '',
  }
}

/**
 * Save a wording, recording what it used to say.
 *
 * The whole of both fields, before and after — unusual for this log, which normally keeps a
 * line to a field and a value. Here the value *is* the thing that went to sixty families,
 * and "the wording changed" without saying to what would answer nothing.
 */
export async function saveReminderTemplate(
  id: TemplateId,
  text: TemplateText,
  label: string,
): Promise<void> {
  const user = auth.currentUser
  await auditedSet(
    paths.reminderTemplate(id),
    {
      subject: text.subject.trim(),
      body: text.body.trim(),
      updatedAt: Date.now(),
      updatedBy: user?.email ?? user?.uid ?? '',
    },
    {
      entity: 'reminder',
      entityId: id,
      // Shared across years, so it belongs to none of them.
      eventId: null,
      summary: `Reworded the "${label}" reminder`,
      fields: ['subject', 'body'],
    },
    // Replaced outright rather than merged: the record is only ever these two fields, and
    // a merge would leave half of an older wording behind.
    { merge: false },
  )
}

/** Put a wording back to the built-in, which is what an absent record means. */
export async function resetReminderTemplate(id: TemplateId, label: string): Promise<void> {
  await auditedDelete(paths.reminderTemplate(id), {
    entity: 'reminder',
    entityId: id,
    eventId: null,
    summary: `Put the "${label}" reminder back to its default wording`,
    fields: ['subject', 'body'],
  })
}
