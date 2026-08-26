import { describe, expect, it } from 'vitest'
import { contactGap, countGaps, todayProblem } from '../src/domain/contact'
import type { Person } from '../src/domain/types'

const person = (parentPhone: string, parentEmail: string): Person => ({
  id: 'p', firstName: 'A', lastName: 'B', section: 'beavers',
  parentName: '', parentEmail, parentPhone, pairWithPersonId: null,
})

describe('whether somebody can be reached', () => {
  it('tells the two gaps apart', () => {
    expect(contactGap(person('519-555-0100', 'a@b.org'))).toBe('none')
    expect(contactGap(person('', 'a@b.org'))).toBe('phone')
    expect(contactGap(person('519-555-0100', ''))).toBe('email')
    expect(contactGap(person('', ''))).toBe('both')
  })

  it('does not count whitespace as a contact detail', () => {
    expect(contactGap(person('  ', ' '))).toBe('both')
  })

  it('counts each gap on its own, and says how many overlap', () => {
    /*
      The count that was being reported was of people with *neither*, which left the youth
      with an address and no number — reachable in July, unreachable on the day — in no
      count at all. That is the worse of the two gaps to not know about.
    */
    const gaps = countGaps([
      person('519-555-0100', 'a@b.org'),
      person('', 'a@b.org'),
      person('519-555-0100', ''),
      person('', ''),
    ])
    expect(gaps).toEqual({ phone: 2, email: 2, both: 1, of: 4 })
  })
})

describe('the mark at the table', () => {
  it('says a phone number is missing, and which way round it is', () => {
    expect(todayProblem(person('', 'a@b.org'))).toMatch(/No phone number/)
    expect(todayProblem(person('', ''))).toMatch(/No phone number or email address/)
  })

  it('says nothing about a missing address', () => {
    // You are not going to email somebody who is late. A mark against half the names is
    // read once and then not at all.
    expect(todayProblem(person('519-555-0100', ''))).toBeNull()
  })
})
