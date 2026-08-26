/**
 * Map links for a place.
 *
 * A search link is fully determined by the address, so `mapsUrl` is only an override — some
 * of the seeded links point at a specific entrance or car park that a plain address search
 * misses. Everything reads through `mapLink`, so an address alone still gives a link.
 */

/** A Google Maps search link for a street address. Empty for a blank address. */
export function mapsSearchUrl(address: string): string {
  const query = address.trim()
  if (!query) return ''
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
}

/**
 * A pasted link that is safe to put in an `href`, or empty.
 *
 * The override is free text and ends up in an `href` on a volunteer's pass, where a
 * `javascript:` URL runs on tap — React warns and renders it anyway. Parsed rather than
 * pattern-matched, since `https:/\/evil`, ` javascript:` and `jAvAsCrIpT:` all defeat a
 * prefix check. https only: an allowlist of one is harder to get wrong than a denylist.
 */
export function safeMapUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    return new URL(trimmed).protocol === 'https:' ? trimmed : ''
  } catch {
    return ''
  }
}

/** A place's own link if it has a usable one, otherwise one derived from its address. */
export function mapLink(place: { address: string; mapsUrl: string }): string {
  return safeMapUrl(place.mapsUrl) || mapsSearchUrl(place.address)
}

/**
 * An embeddable map, showing directions from base when there is a base.
 *
 * The keyless `output=embed` form, because the Maps Embed API needs a billing account and
 * this app stays on the free tier. It is undocumented, so callers show a plain link out
 * beside the map in case it stops being served.
 */
export function mapEmbedUrl(
  place: { name: string; address: string },
  base: { name: string; address: string } | null,
): string {
  const to = place.address.trim() || place.name.trim()
  if (!to) return ''
  const from = base ? base.address.trim() || base.name.trim() : ''
  const params = from
    ? `saddr=${encodeURIComponent(from)}&daddr=${encodeURIComponent(to)}`
    : `q=${encodeURIComponent(to)}`
  return `https://maps.google.com/maps?${params}&output=embed`
}

/** The same journey, to open in Google Maps proper. */
export function mapDirectionsUrl(
  place: { name: string; address: string; mapsUrl: string },
  base: { name: string; address: string } | null,
): string {
  const to = place.address.trim() || place.name.trim()
  const from = base ? base.address.trim() || base.name.trim() : ''
  // Without a base there is no journey to show, so a deliberate link on the place wins.
  if (!to || !from) return mapLink(place)
  return (
    'https://www.google.com/maps/dir/?api=1' +
    `&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`
  )
}
