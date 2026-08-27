import type { AppleDayEvent } from './types'

/**
 * A year, in a file.
 *
 * There is no way back from a mistake otherwise. An admin pressing Remove takes a year's
 * people, shifts and jars with it; a bad deploy or a wrong project alias does the same at a
 * larger scale. Scheduled Firestore exports need a paid plan and a storage bucket, so the
 * only backup a group on the free plan can have is one they take themselves.
 *
 * It carries the things an event points at as well as the event's own records — the shops
 * and sections its people and jars are keyed by. Without those a restore is a board full of
 * rows reading "unknown location", which is not a restore.
 *
 * The same file moves a year between projects, which is the other reason to have it: a year
 * built in staging can be carried into production instead of typed again.
 */

/** Bumped when the shape changes in a way an older reader would get wrong. */
export const TRANSFER_FORMAT = 'apple-day/event@1'

export interface EventTransfer {
  format: string
  exportedAt: number
  /** Which project it came out of, so a restore into the wrong one is noticeable. */
  fromProject: string
  event: AppleDayEvent
  /** Everything under the event, keyed by subcollection then document id. */
  records: Record<string, Record<string, Record<string, unknown>>>
  /** Shops the event's records point at, so a restore is not full of unknown places. */
  locations: Record<string, Record<string, unknown>>
  /** Sections its people are keyed by, for the same reason. */
  sections: Record<string, Record<string, unknown>>
  /** Passes belonging to this event, so links already given out keep working. */
  passes: Record<string, Record<string, unknown>>
}

/**
 * What is in the file, in the words somebody deciding whether to trust it would use.
 *
 * Shown before a restore writes anything. "412 documents" tells nobody whether this is the
 * right file; "Apple Day 2025 · 113 people, 75 shifts, 40 jars" does.
 */
export function describeTransfer(file: EventTransfer): string[] {
  const parts: string[] = []
  for (const [name, docs] of Object.entries(file.records)) {
    const n = Object.keys(docs).length
    if (n > 0) parts.push(`${n} ${name}`)
  }
  const places = Object.keys(file.locations).length
  if (places > 0) parts.push(`${places} locations`)
  const passes = Object.keys(file.passes).length
  if (passes > 0) parts.push(`${passes} passes`)
  return parts
}

/**
 * Read a file, or say why it cannot be read.
 *
 * Every failure here is somebody about to overwrite a year with the wrong thing, so nothing
 * is assumed and nothing is repaired: a file this cannot vouch for is refused rather than
 * half-imported.
 */
export function readTransfer(text: string): { file: EventTransfer } | { problem: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { problem: 'That is not a file this wrote — it is not readable as JSON.' }
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { problem: 'That file is empty, or not an export.' }
  }

  const file = parsed as Partial<EventTransfer>
  if (file.format !== TRANSFER_FORMAT) {
    return {
      problem: file.format
        ? `That file is in ${String(file.format)}, and this reads ${TRANSFER_FORMAT}.`
        : 'That is not an Apple Day export.',
    }
  }
  if (!file.event || typeof file.event.id !== 'string' || !file.event.id) {
    return { problem: 'That export names no event.' }
  }
  if (!file.records || typeof file.records !== 'object') {
    return { problem: 'That export has no records in it.' }
  }

  return { file: file as EventTransfer }
}

/** Why this file cannot go into this project, or null when it can. */
export function restoreProblem(
  file: EventTransfer,
  existingEventIds: string[],
): string | null {
  if (existingEventIds.includes(file.event.id)) {
    /*
      Refused rather than merged.

      Merging two years is a decision with no obviously right answer — which of two jars
      numbered 12 survives? — and getting it wrong silently rewrites money. Removing the year
      first is a deliberate act with its own confirmation, which is the right shape for
      something this size.
    */
    return `${file.event.name || file.event.id} is already here. Remove it first, or restore into a project that does not have it.`
  }
  return null
}
