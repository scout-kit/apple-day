import { useCallback, useEffect, useState } from 'react'

/**
 * A piece of view state that lives in the address bar.
 *
 * Which day is being worked, which shift is filtered to, what has been typed into a search
 * — these were React state, so they existed only until you left the page. Opening somebody
 * from the Saturday check-in table and pressing Back put you on Friday with the filters
 * cleared, and the way back to where you were was to press the same four buttons again.
 *
 * Written with `replaceState` rather than a push: pressing a day button is a change of view,
 * not a place you should have to press Back through. Following a link is a push, so Back
 * from that link returns here with the view intact — which is the whole point.
 *
 * Deliberately not react-router's `useSearchParams`. Every link out of these screens is a
 * plain anchor and so a real page load, which makes the address bar the actual carrier of
 * this state rather than a mirror of something the router holds.
 */
export function useUrlState(
  key: string,
  fallback = '',
): [string, (next: string) => void] {
  const [value, setValue] = useState(() => readParam(key) ?? fallback)

  // The Back button, and anything else that moves through history.
  useEffect(() => {
    const onPop = (): void => setValue(readParam(key) ?? fallback)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [key, fallback])

  const set = useCallback(
    (next: string) => {
      setValue(next)
      const url = new URL(window.location.href)
      // An empty value means "not set", and an empty parameter in the address bar is
      // noise that also makes two identical views look like different ones.
      if (next === '' || next === fallback) url.searchParams.delete(key)
      else url.searchParams.set(key, next)
      window.history.replaceState(window.history.state, '', url)
    },
    [key, fallback],
  )

  return [value, set]
}

function readParam(key: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(key)
}
