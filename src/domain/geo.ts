import type { Location } from './types'

/**
 * Where the shops are, as coordinates.
 *
 * A position is stored on the location rather than worked out when a map opens. Looking one
 * up means asking somebody else's server, and a shop does not move: doing it once and
 * keeping the answer is the difference between a map that draws instantly and nineteen
 * requests to a free service every time somebody glances at it.
 *
 * Pure, so the arithmetic that decides what a map shows can be tested without a browser or
 * a network.
 */

export interface Point {
  lat: number
  lng: number
}

/** A location that has been placed, so it can be drawn. */
export type PlacedLocation = Location & Point

/**
 * Whether a pair of numbers is a position worth drawing.
 *
 * Null Island is excluded on purpose. A geocoder that fails and a field that was never
 * filled in both tend to arrive as zero, and a pin off the coast of Africa is a worse
 * answer than no pin — it looks like data.
 */
export function isPlausiblePosition(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false
  if (lat === 0 && lng === 0) return false
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180
}

export function isPlaced(location: Location): location is PlacedLocation {
  return isPlausiblePosition(location.lat, location.lng)
}

export interface Bounds {
  north: number
  south: number
  east: number
  west: number
}

/** The smallest box holding every point, or null for nothing to hold. */
export function boundsOf(points: Point[]): Bounds | null {
  if (points.length === 0) return null
  return points.reduce<Bounds>(
    (box, p) => ({
      north: Math.max(box.north, p.lat),
      south: Math.min(box.south, p.lat),
      east: Math.max(box.east, p.lng),
      west: Math.min(box.west, p.lng),
    }),
    { north: -90, south: 90, east: -180, west: 180 },
  )
}

/**
 * Widen a box so its edge pins are not against the frame.
 *
 * A single point has a box of zero size, which a map cannot fit to — it would either refuse
 * or zoom to the maximum, putting one shop under a street-level view of its own car park.
 * The minimum span is what keeps that at a useful scale.
 */
export function padBounds(box: Bounds, minSpan = 0.01, margin = 0.15): Bounds {
  const height = Math.max(box.north - box.south, minSpan)
  const width = Math.max(box.east - box.west, minSpan)
  const midLat = (box.north + box.south) / 2
  const midLng = (box.east + box.west) / 2
  const padLat = (height * (1 + margin * 2)) / 2
  const padLng = (width * (1 + margin * 2)) / 2
  return {
    north: Math.min(90, midLat + padLat),
    south: Math.max(-90, midLat - padLat),
    east: Math.min(180, midLng + padLng),
    west: Math.max(-180, midLng - padLng),
  }
}

/**
 * What a year's map can and cannot show.
 *
 * Both halves are the answer. A map that quietly draws thirteen of nineteen shops is
 * telling an organizer the year is smaller than it is, and the six it left out are exactly
 * the ones that need attention — a shop with no address is a shop nobody can be sent to.
 */
export interface MapPlan {
  /** The year's shops, drawable, in the order the year works them. */
  placed: PlacedLocation[]
  /**
   * Where the event runs from, when it has a position.
   *
   * Held apart from the shops rather than counted among them. Nobody is scheduled to base
   * and no money is raised there — it is where volunteers report and jars are counted — so
   * numbering it alongside the shops makes the year look one shop longer than it is, and
   * puts a number against a place no number on the schedule refers to.
   */
  base: PlacedLocation | null
  /** With an address but never looked up, base included. */
  lookupPending: Location[]
  /** No address at all, so there is nothing to look up. */
  noAddress: Location[]
  /** The box to fit, already padded. Null when nothing is placed. */
  bounds: Bounds | null
}

/**
 * Sort out a year's locations into what a map can do with them.
 *
 * Takes the year's list already narrowed to what is switched on: a shop the year is not
 * using is not missing from the map, it is simply not in the year.
 *
 * The base is passed separately because it comes from the library rather than the year. It
 * is also removed from the shops if it happens to be in them — a group whose base is also a
 * pitch would otherwise get two markers on one spot and a numbered entry for the hall.
 */
export function planMap(locations: Location[], base: Location | null = null): MapPlan {
  const shops = base ? locations.filter((l) => l.id !== base.id) : locations

  const placed = shops.filter(isPlaced)
  const placedBase = base && isPlaced(base) ? base : null

  // Base is worth looking up like anything else: without a position there is no star.
  const unplaced = [...shops.filter((l) => !isPlaced(l)), ...(base && !placedBase ? [base] : [])]

  // The box holds base too, or a base off to one side sits outside the frame.
  const box = boundsOf(placedBase ? [...placed, placedBase] : placed)

  return {
    placed,
    base: placedBase,
    lookupPending: unplaced.filter((l) => l.address.trim() !== ''),
    noAddress: unplaced.filter((l) => l.address.trim() === ''),
    bounds: box ? padBounds(box) : null,
  }
}

/**
 * What to say about the shops that are not on the map.
 *
 * Said in the order somebody can act on: the ones a button will fix, then the ones needing
 * an address typed in first.
 */
export function describeUnplaced(plan: MapPlan): string[] {
  const said: string[] = []
  const n = (count: number, one: string, many: string): string =>
    `${count} ${count === 1 ? one : many}`

  if (plan.lookupPending.length > 0) {
    said.push(`${n(plan.lookupPending.length, 'shop has', 'shops have')} not been looked up`)
  }
  if (plan.noAddress.length > 0) {
    said.push(`${n(plan.noAddress.length, 'shop has', 'shops have')} no address on file`)
  }
  return said
}

/**
 * The queries to try for one address, in order.
 *
 * Addresses in the library are written the way a person writes them — "Brady's Meat & Deli,
 * 465 Phillip St, Elmbridge, ON" — and a geocoder matching that whole string against its own
 * records mostly finds nothing, because it does not know the shop by that name. The street
 * address on its own it knows perfectly well.
 *
 * So the leading segment is dropped on the second attempt, but only when it looks like a
 * name rather than a street: a street line starts with a number, a business name does not.
 * Trying the full string first keeps the benefit of the name when the geocoder does know it,
 * which is a more precise answer than the building.
 */
export function addressAttempts(address: string): string[] {
  const whole = address.trim().replace(/\s+/g, ' ')
  if (!whole) return []

  const parts = whole.split(',').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return [whole]

  const first = parts[0]!
  // A street line has a number in it. Without one, this is what the shop is called.
  if (/\d/.test(first)) return [whole]

  const withoutName = parts.slice(1).join(', ')
  return withoutName ? [whole, withoutName] : [whole]
}
