import { describe, expect, it } from 'vitest'
import {
  eventLinkFor,
  eventLinkProblem,
  resolveEventRef,
  sanitiseEventLink,
  slugifyEventName,
} from '../src/domain/eventLinks'

/**
 * Editing the link an event is shared under.
 *
 * The document id cannot change — every year's signups, shifts and jars live in
 * subcollections beneath it — so a custom link is a second name resolved alongside it.
 * That is what makes editing safe: the id keeps resolving, so a link already sent out
 * survives.
 */


describe('an event link can be changed without breaking the old one', () => {
  const event = (id: string, slug = ''): { id: string; slug: string } => ({ id, slug })

  const events = [
    event('apple-day-october-4-5-2026', '2026'),
    event('spring-bottle-drive'),
    event('2025'),
  ]

  it('uses the chosen link when there is one', () => {
    expect(eventLinkFor(events[0]!)).toBe('2026')
  })

  it('falls back to the document id', () => {
    expect(eventLinkFor(events[1]!)).toBe('spring-bottle-drive')
  })

  it('ignores a link of nothing but spaces', () => {
    expect(eventLinkFor(event('2027', '   '))).toBe('2027')
  })

  it('resolves the chosen link', () => {
    expect(resolveEventRef(events, '2026')?.id).toBe('apple-day-october-4-5-2026')
  })

  it('still resolves the original id, which is the whole point', () => {
    // Somebody was sent /e/apple-day-october-4-5-2026/schedule last week. Changing the
    // link must not turn that into a dead URL.
    expect(resolveEventRef(events, 'apple-day-october-4-5-2026')?.id).toBe(
      'apple-day-october-4-5-2026',
    )
  })

  it('prefers an id over another event using it as a slug', () => {
    // Ambiguity can only arise from data that predates the collision check; resolving to
    // the document id is the stable reading.
    const shadowed = [event('2025'), event('apple-day-2025', '2025')]
    expect(resolveEventRef(shadowed, '2025')?.id).toBe('2025')
  })

  it('is case insensitive, because links get typed by hand', () => {
    expect(resolveEventRef(events, '2026')?.id).toBe(resolveEventRef(events, '2026')?.id)
    expect(resolveEventRef(events, 'Spring-Bottle-Drive')?.id).toBe('spring-bottle-drive')
  })

  it('resolves nothing for an unknown reference', () => {
    expect(resolveEventRef(events, 'not-a-thing')).toBeNull()
    expect(resolveEventRef(events, null)).toBeNull()
    expect(resolveEventRef(events, '  ')).toBeNull()
  })
})

describe('checking a link before it is saved', () => {
  const others = [
    { id: '2025', slug: '' },
    { id: 'apple-day-2027', slug: 'next-year' },
  ]
  const self = { id: 'apple-day-october-4-5-2026' }

  it('accepts a free link', () => {
    expect(eventLinkProblem('2026', self, others)).toBeNull()
  })

  it('accepts an empty link, meaning "use the id"', () => {
    expect(eventLinkProblem('', self, others)).toBeNull()
  })

  it('refuses another event id, which would shadow it', () => {
    // Resolution tries ids first, so this link would send its own traffic elsewhere.
    expect(eventLinkProblem('2025', self, others)).toMatch(/already uses/)
  })

  it('refuses another event slug', () => {
    expect(eventLinkProblem('next-year', self, others)).toMatch(/already uses/)
  })

  it('lets an event keep its own link', () => {
    const keeping = { id: 'apple-day-2027' }
    expect(eventLinkProblem('next-year', keeping, others)).toBeNull()
  })

  it('refuses anything that is not URL-safe', () => {
    expect(eventLinkProblem('Apple Day 2026', self, others)).toMatch(/Letters, numbers/)
    expect(eventLinkProblem('2026/schedule', self, others)).toMatch(/Letters, numbers/)
  })
})

describe('cleaning up a link as it is typed', () => {
  it('keeps a trailing dash, so a dash can be typed at all', () => {
    // Full slugification on every keystroke turns "apple-" into "apple", so the next letter
    // lands against the previous word and a multi-word link cannot be typed at all. The same
    // failure as an "also known as" field that eats commas.
    expect(sanitiseEventLink('apple-')).toBe('apple-')
  })

  it('lowercases and replaces what a URL cannot carry', () => {
    expect(sanitiseEventLink('Apple Day 2026')).toBe('apple-day-2026')
    expect(sanitiseEventLink('2026/schedule')).toBe('2026-schedule')
  })

  it('folds accents rather than dropping the letter', () => {
    expect(sanitiseEventLink('Café')).toBe('cafe')
  })

  it('collapses a run of separators to one dash', () => {
    expect(sanitiseEventLink('apple   day')).toBe('apple-day')
  })

  it('refuses to start with a dash, which would read as a stray path segment', () => {
    expect(sanitiseEventLink('-apple')).toBe('apple')
  })

  it('is settled by the time it is saved', () => {
    // The editor sanitises; saving slugifies, which is where the trailing dash goes.
    expect(slugifyEventName(sanitiseEventLink('apple-day-'))).toBe('apple-day')
  })

  it('does not call a half-typed dash a mistake', () => {
    expect(eventLinkProblem('apple-', { id: 'x' }, [])).toBeNull()
  })

  it('does call a link of nothing but dashes a mistake', () => {
    // Caught by the character check: the sanitiser reduces a run of dashes to nothing, so
    // the typed value cannot match it.
    expect(eventLinkProblem('--', { id: 'x' }, [])).toMatch(/Letters, numbers/)
  })
})
