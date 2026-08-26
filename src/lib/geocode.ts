import type { Location } from '../domain/types'
import { addressAttempts, isPlausiblePosition } from '../domain/geo'

/**
 * Turning a street address into a position, once.
 *
 * Nominatim, which is OpenStreetMap's own geocoder: free, no key, no billing account. It is
 * run on donated hardware, and its usage policy is the constraint this module exists to
 * respect — at most one request a second, no bulk runs, and cache what comes back.
 *
 * So this is deliberate rather than automatic. Nothing here fires because a screen opened;
 * an organizer presses a button, sees it work through the list one shop at a time, and the
 * answers are written to the locations so it never runs for those again.
 *
 * A browser cannot set a User-Agent, so the app identifies itself by its `Referer`, which
 * is what the policy asks of a web app.
 */

/** The policy's floor, with a little room. One shop a second is fast enough for nineteen. */
const BETWEEN_LOOKUPS_MS = 1100

const ENDPOINT = 'https://nominatim.openstreetmap.org/search'

export interface Found {
  lat: number
  lng: number
  /** What Nominatim thinks it found, so somebody can see it picked the right place. */
  label: string
}

/**
 * Look up one address.
 *
 * Null for anything that is not a confident single answer. A geocoder asked for a shop it
 * does not know will happily return the town it is in, and a pin in the middle of Waterloo
 * standing in for a specific shop is worse than an admission that it is not known.
 */
export async function lookupAddress(address: string): Promise<Found | null> {
  const attempts = addressAttempts(address)

  for (const [index, query] of attempts.entries()) {
    const found = await askOnce(query)
    if (found) return found
    // The pause applies between attempts too — a retry is still a request.
    if (index < attempts.length - 1) await pause(BETWEEN_LOOKUPS_MS)
  }
  return null
}

async function askOnce(query: string): Promise<Found | null> {
  const url = `${ENDPOINT}?${new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: '1',
    addressdetails: '0',
  })}`

  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Lookup failed (${response.status}). Try again in a minute.`)
  }

  const results: unknown = await response.json()
  if (!Array.isArray(results) || results.length === 0) return null

  const first = results[0] as Record<string, unknown>
  const lat = Number(first.lat)
  const lng = Number(first.lon)
  if (!isPlausiblePosition(lat, lng)) return null

  return { lat, lng, label: String(first.display_name ?? query) }
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export interface LookupOutcome {
  location: Location
  found: Found | null
  /** Why it could not be asked, or what went wrong asking. */
  error?: string
}

/**
 * Look up a list of addresses, one at a time, reporting each as it lands.
 *
 * Never rejects. One shop whose address is a typo should cost that shop and nothing else —
 * stopping the run would leave the rest unplaced and no indication of which.
 *
 * `onFound` is awaited before the next lookup, so each answer is saved as the run goes. Stop
 * halfway and what was found is kept.
 */
export async function lookupAll(
  locations: Location[],
  onFound: (outcome: LookupOutcome) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
  shouldStop?: () => boolean,
): Promise<LookupOutcome[]> {
  const outcomes: LookupOutcome[] = []

  for (const [index, location] of locations.entries()) {
    if (shouldStop?.()) break

    let outcome: LookupOutcome
    try {
      outcome = { location, found: await lookupAddress(location.address) }
    } catch (error) {
      outcome = {
        location,
        found: null,
        error: error instanceof Error ? error.message : String(error),
      }
    }

    try {
      await onFound(outcome)
    } catch (error) {
      // Found but not saved. Said plainly rather than counted as a failure to find, because
      // the two need different things doing about them.
      outcome = {
        ...outcome,
        error: `Found, but not saved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }

    outcomes.push(outcome)
    onProgress?.(index + 1, locations.length)

    if (index < locations.length - 1) await pause(BETWEEN_LOOKUPS_MS)
  }

  return outcomes
}

/** How long a run will take, so the button can say so before it is pressed. */
export function lookupEstimateMs(count: number): number {
  return Math.max(0, count - 1) * BETWEEN_LOOKUPS_MS
}

/** "about 20 seconds", for a button that is about to sit there for that long. */
export function describeEstimate(count: number): string {
  const seconds = Math.round(lookupEstimateMs(count) / 1000)
  if (seconds < 5) return 'a moment'
  if (seconds < 60) return `about ${seconds} seconds`
  const minutes = Math.round(seconds / 60)
  return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
}
