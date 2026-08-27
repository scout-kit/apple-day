import type { Location } from './types'

/**
 * Locations that are the same place, for somebody standing in it.
 *
 * Two siblings asked to stay together do not have to be at the same door. A plaza with a
 * grocer at one end and a chemist at the other is one place to a parent dropping them off,
 * and putting them at both ends covers twice the footfall — which is the point of sending
 * two.
 *
 * The grouping is the location's `groupCode`. Shops sharing one are the same area; a shop
 * with none is its own, because an empty code is the absence of an answer rather than a
 * group called "". That distinction is the whole of the care needed here: without it every
 * ungrouped shop is in one enormous group with every other ungrouped shop, and a pair split
 * across two ends of town reports nothing at all.
 */

/** The area a location belongs to, or null when nobody has said. */
export function areaOf(location: Pick<Location, 'groupCode'> | undefined): string | null {
  const code = location?.groupCode.trim().toUpperCase()
  return code ? code : null
}

/**
 * Whether two locations count as the same place to stand.
 *
 * The same location always does. Beyond that it takes a shared area on both sides — one shop
 * in a plaza and one that has never been given a code are not together, however close they
 * happen to be on the map, because nobody has said they are.
 */
export function sameArea(
  a: string,
  b: string,
  locations: Map<string, Pick<Location, 'groupCode'>>,
): boolean {
  if (a === b) return true
  const areaA = areaOf(locations.get(a))
  return areaA !== null && areaA === areaOf(locations.get(b))
}

/**
 * A colour for an area, so two rows far apart in the list still read as one place.
 *
 * The same five tones the sections use, picked by the code itself rather than by the order
 * the locations happen to be in: adding a shop must not repaint the board.
 */
export const AREA_TONES = ['blue', 'green', 'amber', 'purple', 'red'] as const

export type AreaTone = (typeof AREA_TONES)[number]

export function areaTone(code: string): AreaTone {
  let hash = 0
  for (const ch of code) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return AREA_TONES[hash % AREA_TONES.length]!
}
