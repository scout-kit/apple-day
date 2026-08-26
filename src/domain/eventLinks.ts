/**
 * Turning events into links, and links back into events.
 *
 * Pure string handling, kept in the domain layer so it is testable without booting
 * Firebase — the same reason the pass-building lives there.
 *
 * An event is a named thing rather than a year. "Apple Day, October 4–5 2026" and "Spring
 * bottle drive" are both valid, so the id is a slug of the name, fixed at creation and
 * never regenerated: a link somebody has already been sent has to survive a rename.
 */

/** A URL-safe id from a free-text name. */
export function slugifyEventName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    // Drop combining marks so accents fold to their base letter.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')

  // A name of nothing but punctuation or non-Latin script would otherwise be unroutable.
  if (slug) return slug
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) % 0xffffff
  return `event-${hash.toString(36)}`
}

/**
 * Clean up a link as somebody types it.
 *
 * Deliberately gentler than `slugifyEventName`: it does not strip a *trailing* dash. Doing
 * that on every keystroke makes a dash impossible to type — "apple-" is re-slugified to
 * "apple" before the next letter arrives — which is the same bug that made the "also known
 * as" field swallow commas. The value is normalised properly on save instead.
 */
export function sanitiseEventLink(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 60)
}

/** What goes in the URL for an event: its chosen link if it has one, else its id. */
export function eventLinkFor(event: { id: string; slug: string }): string {
  return event.slug.trim() || event.id
}

/**
 * Find the event a link refers to.
 *
 * The id is tried before the slug, and both are tried for every event, so changing an
 * event's link never breaks a link already sent: `/e/2026/...` keeps resolving by id even
 * once the slug says something else. Returns null for a reference that matches nothing,
 * which the caller falls back from rather than showing an empty app.
 */
export function resolveEventRef<E extends { id: string; slug: string }>(
  events: E[],
  ref: string | null,
): E | null {
  if (!ref) return null
  const wanted = ref.trim().toLowerCase()
  if (!wanted) return null
  return (
    events.find((e) => e.id.toLowerCase() === wanted) ??
    events.find((e) => e.slug.trim().toLowerCase() === wanted) ??
    null
  )
}

/**
 * Why a link cannot be used, or null when it can.
 *
 * Collisions are checked against every other event's id *and* slug, because resolution
 * looks at both: a slug that shadows another event's id would silently send one event's
 * links to the other.
 */
export function eventLinkProblem(
  wanted: string,
  self: { id: string },
  others: { id: string; slug: string }[],
): string | null {
  const value = wanted.trim().toLowerCase()
  if (!value) return null
  // Compared against the typing-time sanitiser, not the full slug: a trailing dash is a
  // link halfway through being typed, not a mistake to shout about.
  if (value !== sanitiseEventLink(wanted)) {
    return 'Letters, numbers and dashes only.'
  }
  for (const other of others) {
    if (other.id === self.id) continue
    if (other.id.toLowerCase() === value || other.slug.trim().toLowerCase() === value) {
      return 'Another event already uses that link.'
    }
  }
  return null
}

/** The event id in `/e/<id>/…`, or null for a path that is not event-scoped. */
export function eventIdFromPath(pathname: string): string | null {
  return /^\/e\/([^/]+)/.exec(pathname)?.[1] ?? null
}

/** The screen part of `/e/<id>/<screen>`, defaulting to the board. */
export function screenFromPath(pathname: string): string {
  return /^\/e\/[^/]+\/(.+)$/.exec(pathname)?.[1] ?? 'schedule-board'
}

/** The path for a screen within an event. */
export function eventPath(eventId: string, screen: string): string {
  return `/e/${eventId}/${screen}`
}

/**
 * Where a screen lives, given everything that might name an event.
 *
 * Extracted from the context so the one property that matters can be tested: while any event
 * exists, this never returns the bare `/${screen}`. That path is the one that forwards to
 * whatever this returns — so returning it means forwarding to itself, for ever, on a blank
 * page. It did exactly that whenever no event was remembered, which is every organizer's
 * next sign-in after clearing site data.
 *
 * Order of preference: what the caller asked for, then what the URL already says, then the
 * remembered choice, then the newest event there is.
 */
export function buildPathFor<E extends { id: string; slug: string }>(
  events: E[],
  urlEventId: string | undefined,
  remembered: string | null,
  screen: string,
  asked?: string,
): string {
  const ref = asked ?? urlEventId ?? remembered ?? events[0]?.id ?? ''
  if (!ref) return `/${screen}`
  const found = resolveEventRef(events, ref)
  return eventPath(found ? eventLinkFor(found) : ref, screen)
}
