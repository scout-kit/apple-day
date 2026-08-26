import { describe, expect, it } from 'vitest'
import {
  buildSignupForm,
  formIsCurrent,
  shiftSnapshot,
  staleFormWarning,
  describeSpec,
  formDays,
  formProblems,
  shiftOptions,
} from '../src/domain/signupForm'
import { detectMapping, missingRequiredColumns, planImport } from '../src/domain/importer'
import { DEFAULT_SECTIONS } from '../src/domain/sections'
import { buildSlots } from '../src/domain/slots'
import type { AppleDayEvent } from '../src/domain/types'

/**
 * The form an event asks for, and whether the app can read its answers back.
 *
 * This exists for one property, and everything else here is in service of it: a form built
 * from an event must import with nothing to correct. The titles have to be ones the
 * importer already recognises, and the shift options have to be answers it can resolve to
 * this event's own slots.
 *
 * Get that wrong and it fails quietly — a column that does not map is a field an organizer
 * has to find by hand, and an option that does not parse is availability that goes missing.
 */

const EVENT: AppleDayEvent = {
  id: '2026',
  name: 'Apple Day 2026',
  slug: '',
  year: 2026,
  fridayDate: '2026-10-02',
  saturdayDate: '2026-10-03',
  support: [],
  supportNote: '',
  arrivalNote: '',
  baseLocationId: null,
  schedule: {
    fri: { startMin: 17 * 60, endMin: 21 * 60 },
    sat: { startMin: 9 * 60, endMin: 15 * 60 },
  },
  shiftMode: 'shifts',
  shiftMinutes: 60,
  overlapMinutes: 0,
}

const spec = (over: Partial<AppleDayEvent> = {}) =>
  buildSignupForm({ ...EVENT, ...over }, DEFAULT_SECTIONS)

describe('the form maps itself', () => {
  it('gives every field a column the importer finds on its own', () => {
    /*
      The whole point. An organizer building this form and exporting its responses should
      not have to tell the app which column is which — the app chose the titles.
    */
    const headers = ['Timestamp', ...spec().questions.map((q) => q.title)]
    const mapping = detectMapping(headers, formDays(EVENT))

    expect(mapping.youthName).toBe('Youth name')
    expect(mapping.section).toBe('Section')
    expect(mapping.parentName).toBe('Parent name')
    expect(mapping.parentEmail).toBe('Parent email')
    expect(mapping.parentPhone).toBe('Parent phone')
    expect(mapping.attending).toBe('Will you attend with your youth?')
    expect(mapping.notes).toBe('Notes')
    expect(mapping.timestamp).toBe('Timestamp')
  })

  it('finds an availability column for every day the event runs', () => {
    const headers = ['Timestamp', ...spec().questions.map((q) => q.title)]
    const mapping = detectMapping(headers, formDays(EVENT))

    expect(mapping.days?.fri).toBe('Friday')
    expect(mapping.days?.sat).toBe('Saturday')
  })

  it('leaves nothing required unmapped', () => {
    const headers = spec().questions.map((q) => q.title)
    expect(missingRequiredColumns(detectMapping(headers, formDays(EVENT)))).toEqual([])
  })

  it('asks the youth’s name before anything else mentioning youth', () => {
    /*
      The importer takes the first column that matches a field. "Will you attend with your
      youth?" sits after the name question, so it cannot be picked up as the name — and
      reordering them would break that silently.
    */
    const titles = spec().questions.map((q) => q.title)
    expect(titles.indexOf('Youth name')).toBeLessThan(
      titles.indexOf('Will you attend with your youth?'),
    )
  })

  it('adds a day when the event does', () => {
    // A Sunday on the event is a Sunday question, without anybody rebuilding the form.
    const sunday = spec({
      schedule: { ...EVENT.schedule, sun: { startMin: 10 * 60, endMin: 14 * 60 } },
    })
    expect(sunday.questions.some((q) => q.title === 'Sunday')).toBe(true)
  })
})

describe('the shift options are this event’s own shifts', () => {
  it('offers exactly what the schedule shows', () => {
    const labels = buildSlots('fri', EVENT.schedule, EVENT).map((s) => s.label)
    expect(shiftOptions(EVENT, 'fri')).toEqual(labels)
  })

  it('follows the hours, not a fixed list', () => {
    const late = spec({ schedule: { fri: { startMin: 17 * 60, endMin: 22 * 60 } } })
    const friday = late.questions.find((q) => q.title === 'Friday')!
    expect(friday.options).toHaveLength(5)
  })

  it('follows the shift length', () => {
    const half = spec({ shiftMinutes: 30 })
    expect(half.questions.find((q) => q.title === 'Friday')!.options).toHaveLength(8)
  })

  it('offers one box for a whole-day event', () => {
    const wholeDay = spec({ shiftMode: 'wholeDay' })
    expect(wholeDay.questions.find((q) => q.title === 'Friday')!.options).toHaveLength(1)
  })
})

describe('what comes back imports without a correction', () => {
  /** A filled-in response, exactly as Google would export it. */
  const response = (over: Record<string, string> = {}): Record<string, string> => ({
    Timestamp: '2026-09-14 18:32:05',
    'Youth name': 'Ada Byron',
    Section: 'Cubs',
    'Parent name': 'Anne Byron',
    'Parent email': 'anne@example.org',
    'Parent phone': '555-0100',
    'Will you attend with your youth?': 'Yes',
    // Google joins ticked boxes with a comma and a space.
    Friday: '5:00 PM – 6:00 PM, 6:00 PM – 7:00 PM',
    Saturday: '9:00 AM – 10:00 AM',
    Notes: 'Back by 8 if possible.',
    ...over,
  })

  const importIt = (rows: Record<string, string>[]) =>
    planImport(rows, {
      mapping: detectMapping(
        ['Timestamp', ...spec().questions.map((q) => q.title)],
        formDays(EVENT),
      ),
      existingPeople: [],
      schedule: EVENT.schedule,
      shape: EVENT,
    })

  it('reads a whole response with nothing left over', () => {
    const plan = importIt([response()])

    expect(plan.problems, 'nothing unreadable').toEqual([])
    expect(plan.newPeople[0]).toMatchObject({
      firstName: 'Ada',
      lastName: 'Byron',
      section: 'cubs',
      parentName: 'Anne Byron',
      parentEmail: 'anne@example.org',
      parentPhone: '555-0100',
    })
  })

  it('turns the ticked boxes back into this event’s shifts', () => {
    /*
      The property the whole feature rests on. The form offers the app's own labels, so the
      answers have to resolve to the app's own slot ids — not to nothing, and not to a
      neighbouring hour.
    */
    const plan = importIt([response()])
    expect(plan.signups[0]!.availability).toEqual({
      fri: ['fri-1700', 'fri-1800'],
      sat: ['sat-0900'],
    })
  })

  it('reads every option of every day, not just the convenient ones', () => {
    // One response per day with everything ticked, so no label escapes the check.
    const everything = response({
      Friday: shiftOptions(EVENT, 'fri').join(', '),
      Saturday: shiftOptions(EVENT, 'sat').join(', '),
    })
    const plan = importIt([everything])

    expect(plan.problems).toEqual([])
    expect(plan.signups[0]!.availability.fri).toHaveLength(shiftOptions(EVENT, 'fri').length)
    expect(plan.signups[0]!.availability.sat).toHaveLength(shiftOptions(EVENT, 'sat').length)
  })

  it('holds when the shifts overlap and no longer start on the hour', () => {
    const overlapping = { ...EVENT, overlapMinutes: 15 }
    const built = buildSignupForm(overlapping, DEFAULT_SECTIONS)
    const plan = planImport(
      [
        response({
          Friday: shiftOptions(overlapping, 'fri').join(', '),
          Saturday: shiftOptions(overlapping, 'sat').join(', '),
        }),
      ],
      {
        mapping: detectMapping(
          ['Timestamp', ...built.questions.map((q) => q.title)],
          formDays(overlapping),
        ),
        existingPeople: [],
        schedule: overlapping.schedule,
        shape: overlapping,
      },
    )

    expect(plan.problems).toEqual([])
    expect(plan.signups[0]!.availability.fri).toEqual(
      buildSlots('fri', overlapping.schedule, overlapping).map((s) => s.id),
    )
  })

  it('reads a section by the name the form offered', () => {
    const cubs = spec().questions.find((q) => q.title === 'Section')!.options!
    for (const name of cubs) {
      const plan = importIt([response({ Section: name })])
      expect(plan.problems, name).toEqual([])
    }
  })
})

describe('what it refuses to build', () => {
  it('says so when the event has no days switched on', () => {
    const bare = { ...EVENT, schedule: {} }
    expect(formProblems(buildSignupForm(bare, DEFAULT_SECTIONS), bare)[0]).toMatch(
      /no days switched on/,
    )
  })

  it('catches an answer with a comma in it, which would come back as two', () => {
    /*
      Google joins ticked boxes with commas and the importer splits on them, so an option
      containing one arrives as two answers and neither is a shift.
    */
    const built = buildSignupForm(EVENT, [
      { id: 'cubs', name: 'Cubs, 8-10', youth: true, order: 1, tone: 'grey', aliases: [] },
    ])
    expect(formProblems(built, EVENT).join(' ')).toMatch(/contain a comma/)
  })

  it('is happy with an ordinary event', () => {
    expect(formProblems(spec(), EVENT)).toEqual([])
  })

  it('never produces a shift label containing a comma', () => {
    // A guard on the format itself rather than on one event's hours.
    for (const day of formDays(EVENT)) {
      for (const option of shiftOptions(EVENT, day)) {
        expect(option, option).not.toContain(',')
      }
    }
  })
})

describe('written out for building by hand', () => {
  it('names every question, its type and its answers', () => {
    const text = describeSpec(spec())
    expect(text).toContain('Youth name')
    expect(text).toContain('Checkboxes')
    expect(text).toContain('5:00 PM – 6:00 PM')
    expect(text).toContain('(required)')
  })

  it('lists them in the order they have to be asked', () => {
    const text = describeSpec(spec())
    expect(text.indexOf('Youth name')).toBeLessThan(text.indexOf('Will you attend'))
  })
})

describe('the questions an event can do without', () => {
  it('leaves out contact details when they are not wanted', () => {
    const built = buildSignupForm(EVENT, DEFAULT_SECTIONS, { contact: false })
    expect(built.questions.some((q) => q.title === 'Parent email')).toBe(false)
  })

  it('leaves out a pairing field by default', () => {
    // Pairing arrives written into the name field, which the importer already digs out.
    expect(spec().questions.some((q) => q.feeds === 'pairWith')).toBe(false)
  })

  it('adds one when asked', () => {
    const built = buildSignupForm(EVENT, DEFAULT_SECTIONS, { pairing: true })
    const headers = built.questions.map((q) => q.title)
    expect(detectMapping(headers, formDays(EVENT)).pairWith).toBe('Pair with')
  })
})

describe('a form that no longer matches its event', () => {
  /*
    The round trip holds only because the options are this event's own shift labels. Change
    the hours afterwards and the form goes on offering times that no longer exist: families
    tick them, the import cannot resolve them, and the availability goes quietly missing —
    which is the failure this whole path exists to prevent, arriving by another door.
  */
  it('is current when nothing has moved', () => {
    expect(formIsCurrent(shiftSnapshot(EVENT), EVENT)).toBe(true)
    expect(staleFormWarning(shiftSnapshot(EVENT), EVENT)).toBeNull()
  })

  it('notices the hours being widened', () => {
    const was = shiftSnapshot(EVENT)
    const later = { ...EVENT, schedule: { ...EVENT.schedule, fri: { startMin: 17 * 60, endMin: 22 * 60 } } }
    expect(formIsCurrent(was, later)).toBe(false)
    expect(staleFormWarning(was, later)).toMatch(/shifts that no longer exist/)
  })

  it('notices the shift length changing', () => {
    // Same hours, different cuts — every option on the form is now a time nobody works.
    const was = shiftSnapshot(EVENT)
    expect(formIsCurrent(was, { ...EVENT, shiftMinutes: 90 })).toBe(false)
  })

  it('notices an overlap being introduced', () => {
    // Shifts stop starting on the hour, so every label but the first has moved.
    const was = shiftSnapshot(EVENT)
    expect(formIsCurrent(was, { ...EVENT, overlapMinutes: 15 })).toBe(false)
  })

  it('notices a day being added', () => {
    const was = shiftSnapshot(EVENT)
    const withSunday = {
      ...EVENT,
      schedule: { ...EVENT.schedule, sun: { startMin: 10 * 60, endMin: 14 * 60 } },
    }
    expect(formIsCurrent(was, withSunday)).toBe(false)
  })

  it('notices a day being dropped', () => {
    const was = shiftSnapshot(EVENT)
    expect(formIsCurrent(was, { ...EVENT, schedule: { fri: EVENT.schedule.fri! } })).toBe(false)
  })

  it('does not mind a change that leaves the shifts alone', () => {
    // Renaming the event, or changing the base, does not touch a single option.
    const was = shiftSnapshot(EVENT)
    expect(formIsCurrent(was, { ...EVENT, name: 'Apple Day, renamed', baseLocationId: 'hall' })).toBe(true)
  })
})

describe('what the form insists on', () => {
  /*
    Two required fields and no more. A required box is a box people put anything in to get
    past, so it is worth spending only where a missing answer makes the signup unusable.
  */
  const required = () =>
    spec().questions.filter((q) => q.required).map((q) => q.title)

  it('insists on the name and the section, which nothing works without', () => {
    expect(required()).toContain('Youth name')
    expect(required()).toContain('Section')
  })

  it('insists on an email, because a schedule cannot be sent without one', () => {
    expect(required()).toContain('Parent email')
  })

  it('asks for a phone without insisting on it', () => {
    // Wanted on the day, not needed to accept the signup. The app marks who is missing one.
    const phone = spec().questions.find((q) => q.title === 'Parent phone')!
    expect(phone.required).toBe(false)
    expect(phone.help).toMatch(/helps/i)
  })

  it('leaves the availability optional, so somebody with no free hours can still say so', () => {
    const friday = spec().questions.find((q) => q.title === 'Friday')!
    expect(friday.required).toBe(false)
  })
})

describe('who the form is for', () => {
  it('offers every section, so a Scouter has something to pick', () => {
    /*
      Adults sign up on the same form and work the same shifts. Offering only the youth
      sections leaves them nothing to choose, and somebody with nothing to choose picks
      whatever is nearest — which puts a leader in the Cubs figures for the year.
    */
    const section = spec().questions.find((q) => q.title === 'Section')!
    expect(section.options).toEqual(DEFAULT_SECTIONS.map((s) => s.name))
    expect(section.options).toContain('Scouters')
  })

  it('imports a Scouter’s answer as that section, not as unrecognised', () => {
    const plan = planImport(
      [
        {
          Timestamp: '2026-09-14 18:32:05',
          'Youth name': 'Sam Reid',
          Section: 'Scouters',
          Friday: '5:00 PM – 6:00 PM',
        },
      ],
      {
        mapping: detectMapping(
          ['Timestamp', ...spec().questions.map((q) => q.title)],
          formDays(EVENT),
        ),
        existingPeople: [],
        schedule: EVENT.schedule,
        shape: EVENT,
      },
    )
    expect(plan.problems).toEqual([])
    expect(plan.newPeople[0]!.section).toBe('scouters')
  })

  it('follows the group’s own sections rather than a fixed list', () => {
    const own = [
      { id: 'joeys', name: 'Joeys', youth: true, order: 1, tone: 'grey' as const, aliases: [] },
      { id: 'helpers', name: 'Helpers', youth: false, order: 2, tone: 'grey' as const, aliases: [] },
    ]
    const built = buildSignupForm(EVENT, own)
    expect(built.questions.find((q) => q.title === 'Section')!.options).toEqual([
      'Joeys',
      'Helpers',
    ])
  })
})
