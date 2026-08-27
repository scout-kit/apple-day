import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  confirmsRemoval,
  describeRemoval,
  EVENT_SCOPED_ELSEWHERE,
  EVENT_SUBCOLLECTIONS,
  holdsAnything,
} from '../src/domain/eventRemoval'

/**
 * What removing an event takes with it.
 *
 * Firestore does not cascade — a subcollection outlives the document it sits under — so
 * this list is the delete. Anything missing from it is data that silently stays behind,
 * belonging to a year that no longer appears anywhere.
 */

describe('what a removal has to walk', () => {
  it('names every subcollection an event has', () => {
    /*
      Checked against `paths.ts` rather than a memory of it. Adding a subcollection to the
      event and forgetting it here is the omission nobody notices: the screens stop showing
      the year, and the records simply remain.
    */
    const paths = readFileSync('src/lib/paths.ts', 'utf8')
    const inPaths = [
      ...new Set([...paths.matchAll(/'events', eventId, '([a-zA-Z]+)'/g)].map((m) => m[1]!)),
    ]

    const missing = inPaths.filter((name) => !EVENT_SUBCOLLECTIONS.includes(name as never))
    expect(missing, 'reachable in paths.ts but never walked').toEqual([])
  })

  it('keeps walking one nothing writes to any more', () => {
    /*
      Retired rather than removed. The hand-typed totals `reconciliation` held are gone from
      the app, and a project that ran an event before they were is still holding the
      document — dropping the name here would orphan it, which is the same silent leftover
      this list exists to prevent. A name that finds nothing costs one query.
    */
    expect(EVENT_SUBCOLLECTIONS).toContain('reconciliation')
  })

  it('has a rule for every one of them', () => {
    /*
      The walk and the rules have to agree, and nothing made them.

      `reconciliation` was on this list with no `match` block behind it, so it fell to the
      catch-all deny — and both the things that walk the list, the export and the removal
      tally, failed outright for an admin with a permissions error. A name here is a promise
      that the collection can be read; this is what keeps it one.
    */
    const rules = readFileSync('firestore.rules', 'utf8')
    const ruled = new Set(
      [...rules.matchAll(/match \/([a-zA-Z]+)\/\{/g)].map((m) => m[1]!),
    )

    const unruled = [...EVENT_SUBCOLLECTIONS, ...EVENT_SCOPED_ELSEWHERE].filter(
      (name) => !ruled.has(name),
    )
    expect(unruled, 'walked but denied by the catch-all').toEqual([])
  })

  it('remembers the things stored outside the event', () => {
    // A pass is top-level because the token is the credential and a parent does not know an
    // event id. One outliving its event is a working link into nothing.
    expect(EVENT_SCOPED_ELSEWHERE).toContain('passes')
  })
})

describe('saying what will go', () => {
  it('names things rather than counting documents', () => {
    // "413 documents" means nothing. "113 people, 75 shifts" is what makes somebody stop.
    expect(describeRemoval({ people: 113, assignments: 75, jars: 64 })).toEqual([
      '113 people',
      '75 shifts',
      '64 jars',
    ])
  })

  it('leaves out what is not there', () => {
    expect(describeRemoval({ people: 2, jars: 0 })).toEqual(['2 people'])
  })

  it('agrees in number', () => {
    expect(describeRemoval({ people: 1, assignments: 1 })).toEqual(['1 person', '1 shift'])
  })

  it('knows when there is nothing to lose', () => {
    expect(holdsAnything({})).toBe(false)
    expect(holdsAnything({ people: 0 })).toBe(false)
    expect(holdsAnything({ people: 1 })).toBe(true)
  })
})

describe('confirming by name', () => {
  it('accepts the name, however it is capitalised or spaced', () => {
    expect(confirmsRemoval('  apple day 2026 ', 'Apple Day 2026')).toBe(true)
  })

  it('refuses anything else', () => {
    expect(confirmsRemoval('Apple Day 2025', 'Apple Day 2026')).toBe(false)
    expect(confirmsRemoval('', 'Apple Day 2026')).toBe(false)
    expect(confirmsRemoval('yes', 'Apple Day 2026')).toBe(false)
  })

  it('cannot be satisfied by an event with no name', () => {
    // Otherwise an empty box would confirm the removal of an unnamed event.
    expect(confirmsRemoval('', '')).toBe(false)
    expect(confirmsRemoval('   ', '  ')).toBe(false)
  })
})
