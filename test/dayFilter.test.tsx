// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { forgetRememberedDay, useDayFilter } from '../src/lib/dayFilter'
import type { Day } from '../src/domain/types'

/**
 * The day being looked at, carried between screens.
 *
 * The schedule board, the day-of table and the jar count each show one day, and building a
 * Saturday means moving between them. Each holding its own selection meant choosing Saturday
 * three times, and again every time you came back.
 *
 * Two carriers, because leaving a screen happens two ways. Links to a person are plain
 * anchors and so real page loads, which throw React state away — the address bar survives
 * that. Moving between screens is client-side, and the address bar does not come along.
 */

const WEEKEND: Day[] = ['fri', 'sat']

/** Arriving at a screen at a given address, the way a client-side navigation does. */
const arriveAt = (search: string): void => {
  window.history.replaceState({}, '', `/e/2026/schedule-board${search}`)
}

const show = (days: Day[] = WEEKEND, preferred: Day | null = 'fri') =>
  renderHook(({ d, p }: { d: Day[]; p: Day | null }) => useDayFilter(d, p), {
    initialProps: { d: days, p: preferred },
  })

beforeEach(() => {
  forgetRememberedDay()
  arriveAt('')
})

afterEach(cleanup)

describe('choosing a day', () => {
  it('starts on the one the screen prefers', () => {
    const { result } = show()
    expect(result.current[0]).toBe('fri')
  })

  it('shows what was chosen', () => {
    const { result } = show()
    act(() => result.current[1]('sat'))
    expect(result.current[0]).toBe('sat')
  })

  it('puts it in the address bar, so a link and Back come back to it', () => {
    // Links out of these screens are real page loads. Nothing React holds survives one.
    const { result } = show()
    act(() => result.current[1]('sat'))
    expect(new URLSearchParams(window.location.search).get('day')).toBe('sat')
  })
})

describe('moving to another screen', () => {
  it('carries the day, though the address bar does not', () => {
    /*
      The point of the whole thing. The nav is client-side, so the new screen mounts at its
      own address with no `day` on it — and should still be showing Saturday.
    */
    const first = show()
    act(() => first.result.current[1]('sat'))
    cleanup()

    arriveAt('')
    const second = show()
    expect(second.result.current[0]).toBe('sat')
  })

  it('writes it into the new screen’s address bar too', () => {
    // So that following a link from *this* screen and pressing Back also returns to Saturday.
    const first = show()
    act(() => first.result.current[1]('sat'))
    cleanup()

    arriveAt('')
    show()
    expect(new URLSearchParams(window.location.search).get('day')).toBe('sat')
  })

  it('lets the address bar win when it says something', () => {
    // Back from a link lands on a real address, and that address is the truth about where
    // somebody was.
    const first = show()
    act(() => first.result.current[1]('sat'))
    cleanup()

    arriveAt('?day=fri')
    const second = show()
    expect(second.result.current[0]).toBe('fri')
  })
})

describe('a day the event no longer runs', () => {
  it('falls back rather than filtering to nothing', () => {
    // Saturday chosen, then edited off the event. There is no Saturday to show.
    const { result, rerender } = show()
    act(() => result.current[1]('sat'))

    rerender({ d: ['fri'] as Day[], p: 'fri' as Day | null })
    expect(result.current[0]).toBe('fri')
  })

  it('drops it from the address bar', () => {
    const { result, rerender } = show()
    act(() => result.current[1]('sat'))

    rerender({ d: ['fri'] as Day[], p: 'fri' as Day | null })
    expect(new URLSearchParams(window.location.search).get('day')).toBeNull()
  })

  it('forgets it, so the next screen does not pick it up again', () => {
    /*
      The failure this is really about: the stale choice living on in memory, so every screen
      you move to asks for a Saturday that is not there.
    */
    const { result, rerender } = show()
    act(() => result.current[1]('sat'))
    rerender({ d: ['fri'] as Day[], p: 'fri' as Day | null })
    cleanup()

    arriveAt('')
    const next = show(['fri'], 'fri')
    expect(next.result.current[0]).toBe('fri')
  })

  it('waits for the event before deciding anything is stale', () => {
    // Days arrive a moment after the screen mounts. Treating "none yet" as "not that day"
    // would throw the selection away on every load.
    const { result, rerender } = show()
    act(() => result.current[1]('sat'))

    rerender({ d: [] as Day[], p: null })
    cleanup()

    arriveAt('')
    const back = show()
    expect(back.result.current[0]).toBe('sat')
  })
})

describe('reloading', () => {
  it('starts again from the default, because nothing is stored', () => {
    /*
      A filter that survives a reload is a filter nobody remembers setting. Somebody reaching
      for the address bar is asking for a fresh look — and `forgetRememberedDay` here is what
      a new page load does for free.
    */
    const { result } = show()
    act(() => result.current[1]('sat'))
    cleanup()

    forgetRememberedDay()
    arriveAt('')
    const afterReload = show()
    expect(afterReload.result.current[0]).toBe('fri')
  })
})
