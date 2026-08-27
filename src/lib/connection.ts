import { useEffect, useState } from 'react'

/**
 * Whether the browser thinks it has a connection.
 *
 * Base ops is a table in a shop doorway, and the signal there is whatever it is. Offline
 * persistence means the app keeps working — a check-in taken with no bars is held and sent
 * when there is one — but an organizer looking at the screen has no way to tell a board that
 * is live from one that stopped updating twenty minutes ago, and that is the difference
 * between trusting it and not.
 *
 * `navigator.onLine` is the honest limit of what a browser will say: it knows the machine has
 * no network, and it does not know that the network it has goes nowhere. Reported as what it
 * is rather than dressed up as a connection check.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const went = (): void => setOnline(navigator.onLine)
    window.addEventListener('online', went)
    window.addEventListener('offline', went)
    /*
      Read once more on mount. The events only fire on a change, so a tab opened while
      already offline would otherwise sit there claiming a connection until one arrived.
    */
    went()
    return () => {
      window.removeEventListener('online', went)
      window.removeEventListener('offline', went)
    }
  }, [])

  return online
}
