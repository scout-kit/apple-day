import { useEffect } from 'react'
import { useUrlState } from './urlState'
import type { Day } from '../domain/types'

/**
 * Which day is being looked at, carried between screens.
 *
 * The schedule board, the day-of table and the jar count all show one day at a time, and
 * building a Saturday means moving between them. Each holding its own selection meant
 * choosing Saturday three times, and choosing it again every time you came back.
 *
 * Two carriers, because there are two ways to leave a screen and they do not behave alike.
 *
 * The address bar handles leaving and returning: links to a person or a location are plain
 * anchors and so real page loads, which throw away everything React was holding. That is
 * what `useUrlState` is for.
 *
 * This module handles moving between screens, which the nav does client-side. A remembered
 * day fills in when the screen you have arrived at has nothing in its own address bar.
 *
 * Module-level, and deliberately not stored anywhere: a reload starts again from today, or
 * from the day the event opens on. Somebody who reaches for the address bar is asking for a
 * fresh look, and a filter that survives a reload is a filter nobody remembers setting.
 */
let remembered: Day | null = null

/** For tests, which share a module between cases the way a session never does. */
export function forgetRememberedDay(): void {
  remembered = null
}

/**
 * The day to show, and how to change it.
 *
 * `eventDays` is what the event actually runs. A day outside it is dropped rather than
 * displayed — an event edited down to Friday cannot go on showing a Saturday nobody is
 * working, and the stale choice has to go from the address bar and from the memory above it
 * or the next screen picks it straight back up.
 */
export function useDayFilter(eventDays: Day[], preferred: Day | null): [Day, (day: Day) => void] {
  const [param, setParam] = useUrlState('day')

  const asked = (param || remembered || null) as Day | null
  const valid = asked && eventDays.includes(asked) ? asked : null
  const day = valid ?? preferred ?? eventDays[0] ?? 'sat'

  useEffect(() => {
    // Nothing to reconcile until the event has said which days it runs.
    if (eventDays.length === 0) return

    if (asked && !valid) {
      remembered = null
      if (param) setParam('')
      return
    }

    /*
      Arrived from another screen with a day in mind. Writing it into the address bar keeps
      the two carriers saying the same thing, so following a link from here and pressing Back
      comes back to the day being worked rather than to today.
    */
    if (valid && !param) setParam(valid)
  }, [asked, valid, param, setParam, eventDays.length])

  const choose = (next: Day): void => {
    remembered = next
    setParam(next)
  }

  return [day, choose]
}
