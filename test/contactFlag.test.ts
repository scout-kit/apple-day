import { describe, expect, it } from 'vitest'
import { todayProblem as contactProblem } from '../src/domain/contact'
import type { Person } from '../src/domain/types'

/**
 * Whether somebody can be reached on the day.
 *
 * The roster says this in a banner, once, covering everybody — right for the screen where
 * the gap gets filled. At the check-in table the question is about the one person in front
 * of you, and the answer has to be beside their name.
 */

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p-one', firstName: 'Alpha', lastName: 'One', section: 'cubs',
  parentName: 'A Parent', parentEmail: 'parent@example.org', parentPhone: '519-555-0100',
  pairWithPersonId: null,
  ...over,
})

describe('what is missing', () => {
  it('says nothing when there is a phone number', () => {
    expect(contactProblem(person())).toBeNull()
  })

  it('says nothing when the phone is there but the email is not', () => {
    // A phone is what you need at ten past nine. An email missing is not a problem today.
    expect(contactProblem(person({ parentEmail: '' }))).toBeNull()
  })

  it('flags an email address with no phone behind it', () => {
    // Worth saying on its own: emailing somebody who is not where they should be is no use.
    expect(contactProblem(person({ parentPhone: '' }))).toContain('No phone number')
  })

  it('flags having neither', () => {
    const problem = contactProblem(person({ parentPhone: '', parentEmail: '' }))
    expect(problem).toContain('No phone number or email address')
  })

  it('treats whitespace as nothing at all', () => {
    // A field somebody tabbed through is not a phone number.
    expect(contactProblem(person({ parentPhone: '   ' }))).toContain('No phone number')
    expect(contactProblem(person({ parentPhone: ' ', parentEmail: '  ' }))).toContain(
      'No phone number or email address',
    )
  })
})
