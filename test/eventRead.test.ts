import { describe, expect, it } from 'vitest'
import { readEvent } from '../src/domain/events'

/**
 * Reading an event back out of Firestore.
 *
 * The third converter to have been the bug, and the first two were unreachable from any
 * test. Every one was a correct write read back wrong.
 */

describe('the custom link', () => {
  it('can be unset', () => {
    // The bug: an unset link is stored as an empty string, and the converter ran it through
    // `slugifyEventName`, whose fallback for unusable input is `event-<hash>`. The hash of
    // an empty string is zero, so clearing the field read back as `event-0` — and because
    // that is a truthy slug, the link could not be unset at all.
    expect(readEvent('2026', { slug: '' }).slug).toBe('')
  })

  it('is empty when there is no slug field at all', () => {
    expect(readEvent('2026', {}).slug).toBe('')
  })

  it('is empty for a slug of nothing but spaces', () => {
    expect(readEvent('2026', { slug: '   ' }).slug).toBe('')
  })

  it('never falls back to the document id', () => {
    // An event whose link equals its id would look like it had a custom link, and put the
    // id in two places to keep in step.
    expect(readEvent('apple-day-2026', { slug: '' }).slug).toBe('')
  })

  it('keeps a link somebody chose', () => {
    expect(readEvent('apple-day-october-4-5-2026', { slug: '2026' }).slug).toBe('2026')
  })

  it('tidies a stored link that is not URL-safe', () => {
    expect(readEvent('2026', { slug: 'Apple Day 2026' }).slug).toBe('apple-day-2026')
  })

  it('ignores a slug that is not text', () => {
    expect(readEvent('2026', { slug: 2026 }).slug).toBe('')
  })
})

describe('day-of contacts', () => {
  it('reads a list', () => {
    expect(
      readEvent('2026', {
        support: [{ name: 'Devin', phone: '519-555-0100', email: '' }],
      }).support,
    ).toEqual([{ name: 'Devin', phone: '519-555-0100', email: '' }])
  })

  it('reads the single phone number every event used to carry', () => {
    expect(readEvent('2026', { supportPhone: '519-555-0100' }).support).toEqual([
      { name: '', phone: '519-555-0100', email: '' },
    ])
  })

  it('is empty when neither is stored', () => {
    expect(readEvent('2026', {}).support).toEqual([])
  })
})

describe('the name', () => {
  it('is what was stored', () => {
    expect(readEvent('2026', { name: ' Apple Day 2026 ' }).name).toBe('Apple Day 2026')
  })

  it('falls back to the year for events created before names existed', () => {
    expect(readEvent('2026', {}).name).toBe('Apple Day 2026')
  })

  it('falls back to the id when there is no year to name it by', () => {
    expect(readEvent('spring-bottle-drive', {}).name).toBe('spring-bottle-drive')
  })
})

describe('the shift shape', () => {
  it('keeps what was stored', () => {
    const event = readEvent('2026', { shiftMode: 'wholeDay', shiftMinutes: 45, overlapMinutes: 15 })
    expect(event.shiftMode).toBe('wholeDay')
    expect(event.shiftMinutes).toBe(45)
    expect(event.overlapMinutes).toBe(15)
  })

  it('clamps an overlap that would step nowhere', () => {
    // An overlap as long as the shift means every shift starts at the same moment.
    expect(readEvent('2026', { shiftMinutes: 60, overlapMinutes: 60 }).overlapMinutes).toBe(55)
  })

  it('falls back to shifts rather than whole-day for an unknown mode', () => {
    expect(readEvent('2026', { shiftMode: 'fortnightly' }).shiftMode).toBe('shifts')
  })
})

describe('the days it runs', () => {
  it('keeps a day with a sane window', () => {
    expect(
      readEvent('2026', { schedule: { fri: { startMin: 1020, endMin: 1260 } } }).schedule,
    ).toEqual({ fri: { startMin: 1020, endMin: 1260 } })
  })

  it('drops a day whose window ends before it starts', () => {
    // It would render zero columns and no explanation of why.
    expect(
      readEvent('2026', { schedule: { fri: { startMin: 1260, endMin: 1020 } } }).schedule,
    ).toEqual({})
  })

  it('drops a day with no window at all', () => {
    expect(readEvent('2026', { schedule: { fri: null, sat: 'all day' } }).schedule).toEqual({})
  })
})

describe('a field the event no longer carries', () => {
  it('ignores a status left on an old document', () => {
    /*
      `status` was draft/published/closed, settable in the editor, shown as a pill, and it
      gated nothing at all — a label somebody had to remember to set, which then said
      whatever they last set it to rather than anything true.

      Whether passes have gone out is already a fact the app works out for itself, from the
      publish record. Documents written before this still carry the field; reading one must
      not fail on it.
    */
    expect(() => readEvent('2026', { status: 'published' })).not.toThrow()
    expect(readEvent('2026', { status: 'published' })).not.toHaveProperty('status')
  })
})
