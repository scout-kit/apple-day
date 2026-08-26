import { clearIndexedDbPersistence, terminate } from 'firebase/firestore'
import { isFatalClientFailure } from '../domain/clientFailure'
import { db } from './firebase'

/**
 * Getting out of a Firestore client that has stopped working.
 *
 * Once `isFatalClientFailure` holds, nothing this page does afterwards will succeed, and
 * the SDK's own advice is to discard the store and reload. Doing that by hand means
 * devtools and clear-site-data, which is not a thing to ask of somebody outside a shop.
 *
 * It costs anything written offline and not yet synced — but the store being discarded is
 * one the SDK has already refused to read, so those writes were unreachable anyway. Once
 * per page-session, so an unrepairable store cannot become a reload loop.
 */
const ATTEMPTED = 'apple-day:cache-recovery'

/** Remembered across the reload, and only across the reload. */
function alreadyTried(): boolean {
  try {
    return window.sessionStorage.getItem(ATTEMPTED) !== null
  } catch {
    // Private browsing, or site data blocked. Better to skip recovery than to loop.
    return true
  }
}

function remember(): void {
  try {
    window.sessionStorage.setItem(ATTEMPTED, '1')
  } catch {
    /* Nothing to do: the guard above will read `true` and recovery stays off. */
  }
}

export async function recoverFromFatalFailure(error: unknown): Promise<void> {
  if (!isFatalClientFailure(error) || alreadyTried()) return
  remember()

  try {
    // clearIndexedDbPersistence refuses while the client is running, hence terminate.
    await terminate(db)
    await clearIndexedDbPersistence(db)
  } catch {
    // Clearing failed too. Reload anyway: a fresh page sometimes opens what this could
    // not, and if it does not, the second load leaves the honest error on screen.
  }
  window.location.reload()
}
