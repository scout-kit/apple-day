import { describe, expect, it } from 'vitest'
import {
  CONTACT_FIELDS,
  canPublish,
  closingCost,
  confirmsClosing,
  describeClosing,
  holdsContacts,
  isFinished,
  withoutContacts,
  worthFinishing,
} from '../src/domain/closing'
import type { AppleDayEvent, Person } from '../src/domain/types'

/**
 * Finishing a year.
 *
 * An Apple Day ends and the things that existed to run it stop being worth holding: a pass
 * is readable by anybody holding its token, with no account and no expiry, and a parent's
 * phone number was collected so somebody could be rung on a day that is over.
 *
 * What stays is the youth's own name and section — asked for, and the whole value of looking
 * back. There are a lot of Calvins, and a first name alone cannot tell one year's from
 * another's.
 */

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1', firstName: 'Calvin', lastName: 'Osei', section: 'cubs',
  parentName: 'Ada Osei', parentEmail: 'ada@example.org', parentPhone: '519-555-0100',
  pairWithPersonId: null,
  ...over,
})

const event = (over: Partial<AppleDayEvent> = {}): AppleDayEvent =>
  ({ id: '2026', name: 'Apple Day 2026', year: 2026, finishedAt: null, ...over }) as AppleDayEvent

describe('whether a year is finished', () => {
  it('is not, while it is still running', () => {
    expect(isFinished(event())).toBe(false)
  })

  it('is, once it has been stamped', () => {
    expect(isFinished(event({ finishedAt: 1_700_000_000_000 }))).toBe(true)
  })

  it('is not, for a zero — which is how reopening writes it', () => {
    // A merge cannot remove a field, so the stamp is cleared by being set to nothing.
    expect(isFinished(event({ finishedAt: 0 }))).toBe(false)
  })

  it('is not, for an event that is not there', () => {
    expect(isFinished(null)).toBe(false)
  })
})

describe('publishing a finished year', () => {
  it('is refused, because it would mint the links the finish deleted', () => {
    expect(canPublish(event({ finishedAt: 1 }))).toBe(false)
  })

  it('is allowed while the year is running', () => {
    expect(canPublish(event())).toBe(true)
  })

  it('is refused when there is no event at all', () => {
    // Nothing to publish, and no screen should be offering to.
    expect(canPublish(null)).toBe(false)
  })
})

describe('what a finish clears', () => {
  it('is the three ways to reach a family, and nothing else', () => {
    expect([...CONTACT_FIELDS]).toEqual(['parentName', 'parentEmail', 'parentPhone'])
  })

  it('leaves the youth’s own name and section alone', () => {
    /*
      Deliberate. Telling this year's Calvin from the last three is the reason anybody opens
      a past year, and a first name does not do it — hence the surname as well.
    */
    const before = person()
    const after = withoutContacts(before)
    expect(after.firstName).toBe('Calvin')
    expect(after.lastName).toBe('Osei')
    expect(after.section).toBe('cubs')
    expect(after.pairWithPersonId).toBe(before.pairWithPersonId)
  })

  it('empties every contact field', () => {
    const after = withoutContacts(person())
    expect([after.parentName, after.parentEmail, after.parentPhone]).toEqual(['', '', ''])
    expect(holdsContacts(after)).toBe(false)
  })

  it('counts somebody holding only a phone number as holding contact details', () => {
    // Any one of the three is a way to reach a family, so any one of them counts.
    expect(holdsContacts(person({ parentName: '', parentEmail: '' }))).toBe(true)
  })

  it('does not count whitespace as a contact detail', () => {
    expect(holdsContacts(person({ parentName: ' ', parentEmail: '', parentPhone: '' }))).toBe(false)
  })
})

describe('what somebody is told before pressing it', () => {
  it('counts the links and the families, not the documents', () => {
    // "413 documents" means nothing. "38 links, 52 parents' details" makes somebody check
    // they took the export.
    const cost = closingCost(['t1', 't2'], [person(), person({ id: 'p2' })])
    expect(cost).toEqual({ passes: 2, contacts: 2 })
    expect(describeClosing(cost)).toEqual([
      '2 volunteer links',
      "2 parents' name, email and phone",
    ])
  })

  it('reads in the singular for one of each', () => {
    expect(describeClosing({ passes: 1, contacts: 1 })).toEqual([
      '1 volunteer link',
      "1 parent's name, email and phone",
    ])
  })

  it('says nothing about what the year does not hold', () => {
    expect(describeClosing({ passes: 0, contacts: 3 })).toEqual([
      "3 parents' name, email and phone",
    ])
  })

  it('ignores people whose details are already gone', () => {
    // A second finish, or a year imported without contact details in the first place.
    const cost = closingCost([], [withoutContacts(person()), person({ id: 'p2' })])
    expect(cost).toEqual({ passes: 0, contacts: 1 })
  })
})

describe('whether there is anything left to do', () => {
  it('is false for a year holding neither', () => {
    /*
      A button whose warning is about data that is not there teaches people the warning is
      noise. Finishing such a year is still allowed — it records that the year is over — the
      dialog just says so instead.
    */
    expect(worthFinishing({ passes: 0, contacts: 0 })).toBe(false)
  })

  it('is true for either one on its own', () => {
    expect(worthFinishing({ passes: 1, contacts: 0 })).toBe(true)
    expect(worthFinishing({ passes: 0, contacts: 1 })).toBe(true)
  })
})

describe('confirming it', () => {
  it('takes the event’s name, the way a removal does', () => {
    // The same gesture for the same reason: one button between somebody and a decision that
    // cannot be undone gets pressed by muscle memory.
    expect(confirmsClosing('Apple Day 2026', 'Apple Day 2026')).toBe(true)
    expect(confirmsClosing('  apple day 2026 ', 'Apple Day 2026')).toBe(true)
    expect(confirmsClosing('Apple Day', 'Apple Day 2026')).toBe(false)
  })

  it('cannot be satisfied by an empty name', () => {
    // An event saved without one would otherwise confirm on an empty box.
    expect(confirmsClosing('', '')).toBe(false)
  })
})
