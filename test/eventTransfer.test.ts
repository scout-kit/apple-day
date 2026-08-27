import { describe, expect, it } from 'vitest'
import {
  TRANSFER_FORMAT,
  describeTransfer,
  readTransfer,
  restoreProblem,
} from '../src/domain/eventTransfer'
import type { EventTransfer } from '../src/domain/eventTransfer'

/**
 * A year in a file.
 *
 * There is no other way back. An admin pressing Remove takes a year's people, shifts and
 * jars with it; scheduled Firestore exports need a paid plan and a storage bucket, so the
 * only backup a group on the free plan can have is one they took themselves.
 *
 * Every failure here is somebody about to overwrite a year with the wrong thing, so nothing
 * is assumed and nothing is repaired: a file this cannot vouch for is refused rather than
 * half-imported.
 */

const file = (over: Partial<EventTransfer> = {}): EventTransfer => ({
  format: TRANSFER_FORMAT,
  exportedAt: Date.UTC(2026, 9, 5),
  fromProject: 'apple-day-live',
  event: { id: '2025', name: 'Apple Day 2025', year: 2025 } as EventTransfer['event'],
  records: {
    people: { 'p-1': { firstName: 'Alex' } },
    assignments: { a1: { personId: 'p-1' } },
  },
  locations: { braemar: { name: 'Braemar' } },
  sections: { cubs: { name: 'Cubs' } },
  passes: { tok1: { personId: 'p-1' } },
  ...over,
})

describe('reading a file', () => {
  it('takes one this wrote', () => {
    const read = readTransfer(JSON.stringify(file()))
    expect('file' in read && read.file.event.id).toBe('2025')
  })

  it('refuses something that is not JSON at all', () => {
    const read = readTransfer('a spreadsheet, probably')
    expect('problem' in read && read.problem).toMatch(/not readable as JSON/)
  })

  it('refuses a file from a format this does not read', () => {
    // Naming both is what lets somebody work out which end is old.
    const read = readTransfer(JSON.stringify(file({ format: 'apple-day/event@9' })))
    expect('problem' in read && read.problem).toMatch(/apple-day\/event@9/)
    expect('problem' in read && read.problem).toMatch(new RegExp(TRANSFER_FORMAT.replace('/', '\\/')))
  })

  it('refuses somebody else’s JSON', () => {
    const read = readTransfer(JSON.stringify({ hello: 'world' }))
    expect('problem' in read && read.problem).toMatch(/not an Apple Day export/)
  })

  it('refuses one naming no event', () => {
    const read = readTransfer(JSON.stringify(file({ event: undefined as never })))
    expect('problem' in read && read.problem).toMatch(/names no event/)
  })

  it('refuses one with no records', () => {
    const read = readTransfer(JSON.stringify(file({ records: undefined as never })))
    expect('problem' in read && read.problem).toMatch(/no records/)
  })
})

describe('deciding whether it can go in', () => {
  it('lets a year in that is not already there', () => {
    expect(restoreProblem(file(), ['2026'])).toBeNull()
  })

  it('refuses to land on a year that exists, rather than merging', () => {
    /*
      Merging two years has no obviously right answer — which of two jars numbered 12
      survives? — and getting it wrong silently rewrites money. Removing the year first is a
      deliberate act with its own confirmation, which is the right shape for something this
      size.
    */
    const problem = restoreProblem(file(), ['2025', '2026'])
    expect(problem).toMatch(/already here/)
    expect(problem).toMatch(/Apple Day 2025/)
  })
})

describe('saying what is in it', () => {
  it('counts the things somebody would recognise', () => {
    // "412 documents" tells nobody whether this is the right file.
    const what = describeTransfer(file())
    expect(what).toContain('1 people')
    expect(what).toContain('1 assignments')
    expect(what).toContain('1 locations')
    expect(what).toContain('1 passes')
  })

  it('leaves out what the file does not have', () => {
    const what = describeTransfer(file({ records: { people: {}, jars: { j1: {} } } }))
    expect(what).toContain('1 jars')
    expect(what.some((line) => line.includes('people'))).toBe(false)
  })
})
