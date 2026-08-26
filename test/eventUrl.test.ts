import { describe, expect, it } from 'vitest'
import {
  eventIdFromPath,
  screenFromPath,
  slugifyEventName,
} from '../src/domain/eventLinks'

/**
 * The event in the URL.
 *
 * An event is a named thing, not a year — "Apple Day, October 4–5 2026" is a perfectly good
 * name — and the address has to carry which one you are looking at, or a link sent to
 * somebody else opens whatever event their browser happens to remember.
 */

describe('turning a name into a link', () => {
  it('handles a real event name', () => {
    expect(slugifyEventName('Apple Day, October 4–5 2026')).toBe(
      'apple-day-october-4-5-2026',
    )
  })

  it('is stable for the same name', () => {
    expect(slugifyEventName('Spring Bottle Drive')).toBe(
      slugifyEventName('  Spring Bottle Drive  '),
    )
  })

  it('strips accents and punctuation rather than escaping them', () => {
    expect(slugifyEventName("Jack's Brunch — Café")).toBe('jack-s-brunch-cafe')
  })

  it('collapses runs of separators and trims the ends', () => {
    expect(slugifyEventName('---Apple   Day!!!---')).toBe('apple-day')
  })

  it('accepts a bare year', () => {
    expect(slugifyEventName('2027')).toBe('2027')
  })

  it('caps the length, so a rambling name still makes a usable link', () => {
    expect(slugifyEventName('a'.repeat(200)).length).toBeLessThanOrEqual(60)
  })

  it('never returns an empty id', () => {
    // A name of nothing but punctuation would otherwise produce an unroutable path.
    expect(slugifyEventName('!!!')).not.toBe('')
    expect(slugifyEventName('日本語')).not.toBe('')
  })
})

describe('reading the event out of a path', () => {
  it('finds it in an event-scoped path', () => {
    expect(eventIdFromPath('/e/apple-day-2026/schedule-board')).toBe('apple-day-2026')
    expect(eventIdFromPath('/e/2026/money')).toBe('2026')
  })

  it('finds it with no screen after it', () => {
    expect(eventIdFromPath('/e/apple-day-2026')).toBe('apple-day-2026')
  })

  it('returns nothing for a path that names no event', () => {
    expect(eventIdFromPath('/')).toBeNull()
    expect(eventIdFromPath('/schedule-board')).toBeNull()
    // The public pages are deliberately not event-scoped.
    expect(eventIdFromPath('/p/AbCdEf123456')).toBeNull()
    expect(eventIdFromPath('/schedule')).toBeNull()
  })
})

describe('reading the screen out of a path', () => {
  it('finds the screen after the event', () => {
    expect(screenFromPath('/e/2026/money')).toBe('money')
    expect(screenFromPath('/e/apple-day-2026/schedule-board')).toBe('schedule-board')
  })

  it('falls back to the board, so switching events always lands somewhere', () => {
    expect(screenFromPath('/e/2026')).toBe('schedule-board')
    expect(screenFromPath('/')).toBe('schedule-board')
  })

  it('keeps a nested screen path intact', () => {
    expect(screenFromPath('/e/2026/some/deeper/screen')).toBe('some/deeper/screen')
  })
})

describe('switching events keeps you on the same screen', () => {
  it('rebuilds the path with a different event', () => {
    const path = '/e/apple-day-2026/reconcile'
    const next = `/e/spring-drive/${screenFromPath(path)}`
    expect(next).toBe('/e/spring-drive/reconcile')
  })
})
