/**
 * The invitation code somebody arrived with, kept across signing in.
 *
 * Signing in with Google leaves the page and comes back to the app's own route rather than
 * the join page, so the code cannot simply be held in React state. Session storage rather
 * than local: it belongs to this tab and this visit.
 *
 * A module of its own, and small on purpose. It is reached from the join page, from the
 * session, and from signing out — and the session cannot be imported by the thing it
 * imports.
 *
 * Two limits, both of which exist because a stored code is a grant sitting there waiting for
 * whoever signs in next. It expires, and signing out clears it — otherwise somebody who
 * opened a link and then handed the laptop over, or signed in as somebody else, hands over
 * the invitation with it.
 */

const KEY = 'apple-day:invite'

/** Long enough to survive the round trip through Google, and no longer. */
const GOOD_FOR_MINUTES = 15

export function rememberInvite(code: string): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }))
  } catch {
    /* Private browsing. The code is still in the address bar, which is the other copy. */
  }
}

export function pendingInvite(): string {
  try {
    const held = window.sessionStorage.getItem(KEY)
    if (!held) return ''

    const { code, at } = JSON.parse(held) as { code?: unknown; at?: unknown }
    if (typeof code !== 'string' || typeof at !== 'number') {
      forgetInvite()
      return ''
    }
    if (Date.now() - at > GOOD_FOR_MINUTES * 60 * 1000) {
      forgetInvite()
      return ''
    }
    return code
  } catch {
    // Unreadable, or written by something else. Not a code worth acting on, and leaving it
    // there means being asked about it again on the next sign-in.
    forgetInvite()
    return ''
  }
}

export function forgetInvite(): void {
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    /* Nothing to do. */
  }
}
