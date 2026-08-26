import { describe, expect, it } from 'vitest'
import {
  auditMoney,
  auditValue,
  describeEntry,
  diffFields,
  sortEntries,
  worthRecording,
} from '../src/domain/audit'
import type { AuditEntry } from '../src/domain/audit'

/**
 * Being able to answer "who changed this, and what was it before".
 *
 * The money is why. A jar's amount is typed in once by whoever is at base ops, and the
 * honest answer to "the shop says they handed over $180 and the sheet says $80" was a shrug.
 */

describe('what gets written down about a change', () => {
  it('records only the fields that actually moved', () => {
    const changes = diffFields(
      { amount: 80, method: 'cash', note: '' },
      { amount: 180, method: 'cash' },
      ['amount', 'method', 'note'],
    )
    expect(changes).toEqual([{ field: 'amount', from: '80', to: '180' }])
  })

  it('ignores fields the change did not mention', () => {
    // A merge write names a few fields. The rest are not "unchanged to null".
    const changes = diffFields({ amount: 80, note: 'porch' }, { amount: 90 }, ['amount', 'note'])
    expect(changes.map((c) => c.field)).toEqual(['amount'])
  })

  it('treats an absent value as nothing, not as a value', () => {
    expect(auditValue(null)).toBe('—')
    expect(auditValue(undefined)).toBe('—')
    expect(auditValue('')).toBe('—')
  })

  it('records a number becoming nothing, which is what a reopened jar does', () => {
    const changes = diffFields<{ amount: number | null }>(
      { amount: 120 },
      { amount: null },
      ['amount'],
    )
    expect(changes).toEqual([{ field: 'amount', from: '120', to: '—' }])
  })

  it('records a first value as coming from nothing', () => {
    expect(diffFields(null, { amount: 40 }, ['amount'])).toEqual([
      { field: 'amount', from: '—', to: '40' },
    ])
  })

  it('writes money the way the screens do', () => {
    expect(auditMoney(180)).toBe('$180.00')
    expect(auditMoney(null)).toBe('—')
  })
})

describe('what is worth a line in the log', () => {
  it('skips an update that changed nothing', () => {
    /*
      Opening a jar and pressing save is not an event. A log full of nothing happening is one
      nobody reads on the day something does.
    */
    expect(worthRecording('updated', [])).toBe(false)
  })

  it('keeps a creation and a deletion, which have no fields to compare', () => {
    expect(worthRecording('created', [])).toBe(true)
    expect(worthRecording('deleted', [])).toBe(true)
  })
})

const entry = (over: Partial<AuditEntry> & { id: string; at: number }): AuditEntry => ({
  by: 'u1', byName: 'Devin', byEmail: 'devin@example.org',
  action: 'updated', entity: 'jar', entityId: 'j1',
  eventId: '2026', summary: '', changes: [],
  ...over,
})

describe('reading the log back', () => {
  it('puts the most recent first, because that is the question being asked', () => {
    const sorted = sortEntries([
      entry({ id: 'a', at: 1 }),
      entry({ id: 'c', at: 3 }),
      entry({ id: 'b', at: 2 }),
    ])
    expect(sorted.map((e) => e.id)).toEqual(['c', 'b', 'a'])
  })

  it('is stable when two things happened in the same millisecond', () => {
    // A batch writes its entries at one timestamp; the order must not wobble between renders.
    const sorted = sortEntries([entry({ id: 'b', at: 5 }), entry({ id: 'a', at: 5 })])
    expect(sorted.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('names who did it', () => {
    expect(describeEntry(entry({ id: 'x', at: 1, summary: 'Counted jar 12 at Sobeys' })))
      .toBe('Counted jar 12 at Sobeys — updated by Devin')
  })

  it('falls back to the uid when there is no name to show', () => {
    // Better an unfamiliar id than a line that says somebody did it.
    expect(describeEntry(entry({ id: 'x', at: 1, byName: '', summary: 'Deleted jar 4' })))
      .toBe('Deleted jar 4 — updated by u1')
  })
})

/**
 * Making an entry answer the question it was written for.
 *
 * Reported after the first version shipped: "removed a shift from the board" does not say
 * from what location, timeslot, or who. The entry stores ids, which are exact and still mean
 * something years later; a reader wants names.
 */
const NAMES = {
  location: (id: string) => (id === 'sobeys' ? 'Sobeys' : undefined),
  person: (id: string) => (id === 'y01' ? 'Elliot R' : undefined),
  slot: (id: string) => (id === 'fri-1700' ? 'Fri 5:00 PM' : undefined),
  user: (uid: string) => (uid === 'u-devin' ? 'devin@example.org' : undefined),
}

const removal = (): AuditEntry => ({
  id: 'e1', at: 1, by: 'u1', byName: 'Devin', byEmail: 'devin@example.org', action: 'deleted',
  entity: 'assignment', entityId: 'a1', eventId: '2026',
  summary: 'Removed a shift from the board',
  changes: [
    { field: 'personId', from: 'y01', to: '—' },
    { field: 'locationId', from: 'sobeys', to: '—' },
    { field: 'slotId', from: 'fri-1700', to: '—' },
    { field: 'status', from: 'planned', to: '—' },
  ],
})

describe('saying which shift it was', () => {
  it('names the person, the place and the hour', async () => {
    const { subjectOf } = await import('../src/domain/audit')
    expect(subjectOf(removal(), NAMES)).toBe('Elliot R · Sobeys · Fri 5:00 PM')
  })

  it('falls back to the id when something has since been renamed away', async () => {
    /*
      A location dropped from the library, a youth removed after the event. The id is not
      pretty but it is what happened, and it beats a blank.
    */
    const { subjectOf } = await import('../src/domain/audit')
    const empty = {
      location: () => undefined,
      person: () => undefined,
      slot: () => undefined,
      user: () => undefined,
    }
    expect(subjectOf(removal(), empty)).toBe('y01 · sobeys · fri-1700')
  })

  it('says nothing when an entry is not about a shift', async () => {
    const { subjectOf } = await import('../src/domain/audit')
    const entry = { ...removal(), changes: [{ field: 'amount', from: '80', to: '180' }] }
    expect(subjectOf(entry, NAMES)).toBe('')
  })

  it('reads a value through the right lookup for its field', async () => {
    const { readableValue } = await import('../src/domain/audit')
    expect(readableValue('locationId', 'sobeys', NAMES)).toBe('Sobeys')
    expect(readableValue('personId', 'y01', NAMES)).toBe('Elliot R')
    // Not everything is an id. An amount is an amount.
    expect(readableValue('amount', '180', NAMES)).toBe('180')
    expect(readableValue('locationId', '—', NAMES)).toBe('—')
  })

  it('gives a field a heading somebody would use out loud', async () => {
    const { fieldLabel } = await import('../src/domain/audit')
    expect(fieldLabel('personId')).toBe('Who')
    expect(fieldLabel('locationId')).toBe('Where')
    expect(fieldLabel('slotId')).toBe('When')
    // A swap touches two shifts, and the second one has to stay distinguishable.
    expect(fieldLabel('personId (other shift)')).toBe('Who (other shift)')
    // Anything unlabelled shows through rather than disappearing.
    expect(fieldLabel('squareTotal')).toBe('squareTotal')
  })
})
