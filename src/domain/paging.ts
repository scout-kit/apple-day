/** Showing a long list a page at a time. */

/** How many rows a page shows. */
export const PAGE = 25

/**
 * How much of the audit log is fetched at a time.
 *
 * Larger than a display page because `useAuditLog` re-reads the whole window each time it
 * widens: a few more documents per press buys many fewer presses.
 */
export const AUDIT_PAGE = 100

export interface Page<T> {
  rows: T[]
  /** How many there are altogether, in the list this page was cut from. */
  total: number
  /** How many are not being shown yet. */
  hidden: number
}

/** The first `shown` of `all`, and how much is left behind it. */
export function paged<T>(all: T[], shown: number): Page<T> {
  // `shown` survives a filter changing, so it can arrive larger than the list it indexes.
  const upTo = Math.max(0, Math.min(shown, all.length))
  return { rows: all.slice(0, upTo), total: all.length, hidden: all.length - upTo }
}

/** One more page of them. */
export function nextShown(shown: number, total: number, size: number = PAGE): number {
  return Math.min(shown + size, total)
}

/** What the button offering the next page should say. */
export function moreLabel(hidden: number, size: number = PAGE): string {
  if (hidden <= 0) return ''
  const next = Math.min(hidden, size)
  return hidden <= size ? `Show the last ${next}` : `Show ${next} more of ${hidden}`
}
