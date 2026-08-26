/**
 * The one way this app searches a list.
 *
 * Every word typed must appear somewhere in the row, in any order and any field: "12 sob"
 * finds jar 12 at Braemar, "no fri" finds Pricewise.
 *
 * Not fuzzy. These lists are money and children, and somebody checking a figure needs to
 * know they are looking at the row they asked for.
 */

export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

export function matchesTerms(
  terms: string[],
  fields: (string | number | null | undefined)[],
): boolean {
  if (terms.length === 0) return true
  const haystack = fields
    .filter((f) => f !== null && f !== undefined)
    .join(' ')
    .toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/**
 * How well a row answers what was typed, as a number to sort by. Lower is better.
 *
 * Filtering alone is not enough once a list is twenty long. Search "market" across the
 * shops and three match — two named "Ashfield Farmers market" and one called "KelMont -
 * 335 Farmers Market Road" — and without ranking they come back in whatever order the
 * library happens to hold them, so the one that merely mentions a road can sit above the
 * two the query actually names.
 *
 * The tiers are about where the match landed, in the order a person would rank them
 * themselves: what the thing is called first, then what it is filed under, then anything
 * else recorded about it.
 */
export const NO_MATCH = Number.MAX_SAFE_INTEGER

export interface Searchable {
  /** What the thing is called. */
  label: string
  /** A short code or category it is filed under. */
  tag?: string | undefined
  /** Anything else worth searching — an address, a note. */
  note?: string | undefined
}

export function rankMatch(row: Searchable, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0

  const label = row.label.toLowerCase()
  const tag = (row.tag ?? '').toLowerCase()
  const note = (row.note ?? '').toLowerCase()

  // Where in the name it landed, so "Farmers" at word four beats the same word at word six.
  const at = label.indexOf(q)
  const wordStart = new RegExp(`\\b${escapeForRegExp(q)}`).test(label)

  if (label.startsWith(q)) return 0 * 1000 + at
  if (wordStart) return 1 * 1000 + at
  if (tag.startsWith(q)) return 2 * 1000
  if (at >= 0) return 3 * 1000 + at
  if (tag.includes(q)) return 4 * 1000
  if (note.includes(q)) return 5 * 1000 + note.indexOf(q)

  /*
    Nothing matched the query whole, so this row is here on the strength of its separate
    words — "no fri" finding Pricewise. Worth keeping and worth ranking below anything that
    matched outright.
  */
  return matchesTerms(searchTerms(q), [row.label, row.tag, row.note]) ? 6 * 1000 : NO_MATCH
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The rows that match, best first.
 *
 * A stable sort, so rows that rank equally keep the order they were given — which for a
 * location list is the order the year works them.
 */
export function ranked<T extends Searchable>(rows: T[], query: string): T[] {
  if (!query.trim()) return rows
  return rows
    .map((row, index) => ({ row, score: rankMatch(row, query), index }))
    .filter((scored) => scored.score !== NO_MATCH)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((scored) => scored.row)
}
