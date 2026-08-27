import { describe, expect, it } from 'vitest'
import { removalProblem, removalSummary, stillHolding } from '../src/domain/libraryRemoval'
import type { LocationUsage } from '../src/domain/libraryRemoval'

/**
 * Taking a shop out of the library.
 *
 * The library is shared across every year, so a location is what three or four years of jars
 * and shifts hang off. Removing one that anything points at orphans all of it — takings
 * against a shop that no longer exists, a shift at nowhere — and unlike a wrong address it is
 * not something the person who did it will see.
 *
 * So it is refused rather than confirmed. "Are you sure" is the wrong question when the
 * answer is knowable and the person pressing it is looking at one row.
 */

const year = (over: Partial<LocationUsage> = {}): LocationUsage => ({
  eventId: '2025', eventName: 'Apple Day 2025', shifts: 0, jars: 0, inThatYear: false,
  ...over,
})

describe('what is still holding a shop', () => {
  it('is nothing when no year uses it', () => {
    expect(stillHolding([year(), year({ eventId: '2026' })])).toEqual([])
  })

  it('counts a year that has shifts there', () => {
    expect(stillHolding([year({ shifts: 3 })])).toHaveLength(1)
  })

  it('counts a year that has jars there', () => {
    // Money against a shop is the thing that must never point at nothing.
    expect(stillHolding([year({ jars: 2 })])).toHaveLength(1)
  })

  it('counts a year that merely lists it', () => {
    /*
      A shop on this year's list with nothing scheduled yet is still in use: it is on the
      board, waiting to be staffed, and removing it would empty a row somebody was working
      through.
    */
    expect(stillHolding([year({ inThatYear: true })])).toHaveLength(1)
  })
})

describe('what it says when it refuses', () => {
  it('allows one nothing points at', () => {
    expect(removalProblem([year(), year({ eventId: '2024', eventName: 'Apple Day 2024' })]))
      .toBeNull()
  })

  it('names the year and what is in it, rather than saying "in use"', () => {
    // "In use" leaves somebody hunting through four years for the one that holds it.
    const problem = removalProblem([year({ shifts: 3, jars: 2 })])
    expect(problem).toContain('Apple Day 2025')
    expect(problem).toContain('3 shifts')
    expect(problem).toContain('2 jars')
  })

  it('names every year holding it, not the first', () => {
    const problem = removalProblem([
      year({ eventId: '2024', eventName: 'Apple Day 2024', jars: 1 }),
      year({ eventId: '2025', eventName: 'Apple Day 2025', shifts: 4 }),
    ])
    expect(problem).toContain('Apple Day 2024')
    expect(problem).toContain('Apple Day 2025')
  })

  it('says so plainly for a year that only lists it', () => {
    const problem = removalProblem([year({ inThatYear: true })])
    expect(problem).toContain('on its list of places')
  })

  it('counts one of a thing as one', () => {
    expect(removalProblem([year({ shifts: 1 })])).toContain('1 shift.')
  })
})

describe('what it says when it agrees', () => {
  it('says why it is safe, rather than asking whether somebody is sure', () => {
    expect(removalSummary('Braemar')).toContain('Braemar')
    expect(removalSummary('Braemar')).toMatch(/nothing points at it/)
  })
})
