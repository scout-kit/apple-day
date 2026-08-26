import { describe, expect, it } from 'vitest'
import { buildPathFor } from '../src/domain/eventLinks'

/**
 * The bare path, and the loop it used to cause.
 *
 * Reported as "still getting a re-direct after logging in to /schedule-board", on a blank
 * page. `/schedule-board` exists to forward to `/e/2026/schedule-board`. When the forward
 * target came back as `/schedule-board` again, it forwarded to itself, and kept going.
 *
 * It hid for a long time because the target is worked out from the remembered event, which
 * localStorage holds from the first time anybody picks one. Clearing site data — the standard
 * advice for a broken offline store — puts every organizer into it on their next sign-in.
 */

const EVENTS = [
  { id: '2026', slug: '' },
  { id: '2025', slug: '' },
]

describe('working out where a bare screen path should go', () => {
  it('uses the newest event when nothing else names one', () => {
    expect(buildPathFor(EVENTS, undefined, null, 'schedule-board')).toBe(
      '/e/2026/schedule-board',
    )
  })

  it('prefers what the URL already says', () => {
    expect(buildPathFor(EVENTS, '2025', null, 'schedule-board')).toBe('/e/2025/schedule-board')
  })

  it('prefers a remembered choice over the newest', () => {
    expect(buildPathFor(EVENTS, undefined, '2025', 'schedule-board')).toBe(
      '/e/2025/schedule-board',
    )
  })

  it('prefers an explicit request over everything', () => {
    expect(buildPathFor(EVENTS, '2026', '2026', 'money', '2025')).toBe('/e/2025/money')
  })

  it('never returns the bare path while any event exists', () => {
    /*
      The property that matters. The bare path is the one that forwards to whatever this
      returns, so returning it is an infinite redirect — and an infinite redirect shows
      nothing at all, which is why it took three rounds to find.
    */
    for (const screen of ['schedule-board', 'money', 'jars', 'day-of']) {
      expect(buildPathFor(EVENTS, undefined, null, screen)).not.toBe(`/${screen}`)
    }
  })

  it('has nowhere to send anybody when there are no events at all', () => {
    // Correct, and safe: the route that forwards checks for an empty list before asking.
    expect(buildPathFor([], undefined, null, 'schedule-board')).toBe('/schedule-board')
  })
})
