import { describe, expect, it } from 'vitest'
import { buildSignupForm, describeSpec, PAGE_PARENT, PAGE_REST } from '../src/domain/signupForm'
import { layOut } from '../src/lib/googleForms'
import { buildAudience, greetingName } from '../src/domain/reminders'
import { DEFAULT_SECTIONS } from '../src/domain/sections'
import { buildAllSlots } from '../src/domain/slots'
import { blankEvent } from '../src/domain/events'
import type { Assignment, Person } from '../src/domain/types'

/**
 * Scouters sign up on the same form as the youth, and the form asks about a parent.
 *
 * An adult has no parent to name, so either they invented one or they gave up on a required
 * field — and when they left it blank, every message the group sent them opened "Hi there".
 * Both halves of that are the same mistake: a question meant for the family of a youth,
 * asked of everybody.
 */

const event = { ...blankEvent('Apple Day 2026'), id: 'e1' }

const person = (over: Partial<Person> = {}): Person => ({
  id: 'p1', firstName: 'Alpha', lastName: 'One', section: 'cubs',
  parentName: '', parentEmail: 'a@example.com', parentPhone: '', pairWithPersonId: null,
  ...over,
} as Person)

describe('the form stops asking a Scouter about their parent', () => {
  const spec = buildSignupForm(event, DEFAULT_SECTIONS)

  it('skips only the questions that are about having a parent', () => {
    /*
      Two of them: who the parent is, and whether that parent is coming along. Asked of an
      adult the second has no answer either — they are not attending *with* anybody, they
      are working the shift.

      Their address and number are wanted exactly as anybody's are, because that is how the
      schedule reaches them and how they are found at ten past nine, so those stay on the
      page everybody answers.
    */
    expect(spec.pages.map((p) => p.id)).toEqual([PAGE_PARENT, PAGE_REST])
    expect(spec.questions.filter((q) => q.page === PAGE_PARENT).map((q) => q.title))
      .toEqual(['Parent name', 'Will you attend with your youth?'])
    const rest = spec.questions.filter((q) => q.page === PAGE_REST).map((q) => q.title)
    expect(rest.slice(0, 2)).toEqual(['Contact Email', 'Contact Phone Number'])
  })

  it('names the shared questions for everybody who answers them', () => {
    // "Parent email" put to a Scouter is a question about somebody not involved.
    const titles = spec.questions.map((q) => q.title)
    expect(titles).not.toContain('Parent email')
    expect(titles).not.toContain('Parent phone')
  })

  it('still feeds the stored fields, whatever the heading says', () => {
    // Renaming stored data to match a form's wording is how old people records stop
    // resolving, so the fields are untouched and only the question moved.
    const byTitle = new Map(spec.questions.map((q) => [q.title, q]))
    expect(byTitle.get('Contact Email')!.feeds).toBe('parentEmail')
    expect(byTitle.get('Contact Phone Number')!.feeds).toBe('parentPhone')
  })

  it('sends every youth section to the parent page and the adults past it', () => {
    const section = spec.questions.find((q) => q.title === 'Section')!
    expect(section.optionGoTo).toEqual({
      Beavers: PAGE_PARENT,
      Cubs: PAGE_PARENT,
      Scouts: PAGE_PARENT,
      Venturers: PAGE_PARENT,
      Scouters: PAGE_REST,
    })
  })

  it('requires the parent name, now that only a parent is asked for it', () => {
    const byTitle = new Map(spec.questions.map((q) => [q.title, q]))
    expect(byTitle.get('Parent name')!.required).toBe(true)
    expect(byTitle.get('Contact Email')!.required).toBe(true)
    // Still not required, and for its own reason: a number matters on the day, and a
    // required field is a field people put anything in to get past.
    expect(byTitle.get('Contact Phone Number')!.required).toBe(false)
  })

  it('stays a flat form for a group whose sections are all youth', () => {
    // A page break is a "Next" button between somebody and the form. No adults, nothing to
    // skip, so nothing is gained by one.
    const flat = buildSignupForm(event, DEFAULT_SECTIONS.filter((s) => s.youth))
    expect(flat.pages).toEqual([])
    expect(flat.questions.every((q) => q.page === undefined)).toBe(true)
    // And the parent name goes back to optional, because there it is asked of everybody.
    expect(flat.questions.find((q) => q.title === 'Parent name')!.required).toBe(false)
  })

  it('lays the items out as Google will see them', () => {
    const laid = layOut(spec)
    const names = laid.map((i) => (i.kind === 'page' ? `[${i.id}]` : i.question.title))
    expect(names.slice(0, 7)).toEqual([
      'Youth name', 'Section',
      `[${PAGE_PARENT}]`, 'Parent name', 'Will you attend with your youth?',
      `[${PAGE_REST}]`, 'Contact Email',
    ])
    // The branching question has to be the last thing on its page, or Google ignores it.
    expect(names.indexOf('Section')).toBe(names.indexOf(`[${PAGE_PARENT}]`) - 1)
  })

  it('writes the branching out for somebody building it by hand', () => {
    const text = describeSpec(spec)
    expect(text).toContain('Section: Parent or guardian')
    expect(text).toContain('Scouters  → go to “Contact and availability”')
    expect(text).toContain('Go to section based on answer')
  })
})

describe('what a message calls somebody with no parent named', () => {
  it('uses a Scouter own name', () => {
    expect(greetingName(person({ section: 'scouters' }), DEFAULT_SECTIONS)).toBe('Alpha One')
  })

  it('leaves a youth alone, because the address is their parent own', () => {
    /*
      The mistake worth avoiding. A youth's email goes to their parent, so falling back to
      the youth's name would greet a parent by their child's name — in a message about that
      child. Blank, and the wording falls through to "there" as it always did.
    */
    expect(greetingName(person({ section: 'cubs' }), DEFAULT_SECTIONS)).toBe('')
  })

  it('prefers a parent name whenever there is one', () => {
    expect(greetingName(person({ section: 'scouters', parentName: 'Pat Two' }), DEFAULT_SECTIONS))
      .toBe('Pat Two')
  })

  it('treats an unknown section as youth, which is the safe way to be wrong', () => {
    expect(greetingName(person({ section: 'rovers' }), DEFAULT_SECTIONS)).toBe('')
  })

  it('carries it through to the recipient a reminder is addressed to', () => {
    const slots = buildAllSlots()
    const assignment: Assignment = {
      id: 'a1', slotId: slots[0]!.id, locationId: 'braemar', personId: 'p1',
      status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
    }
    const built = buildAudience(
      { kind: 'event' },
      'all',
      {
        people: [person({ section: 'scouters' })],
        assignments: [assignment],
        slots,
        sections: DEFAULT_SECTIONS,
        tokenByPerson: new Map(),
        origin: 'https://example.com',
      },
    )
    expect(built.recipients[0]!.parentName).toBe('Alpha One')
  })
})
