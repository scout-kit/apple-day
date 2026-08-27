import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TEMPLATES,
  audienceFor,
  defaultTemplate,
  fillTemplate,
  isEdited,
  PLACEHOLDERS,
  templateProblem,
  templateWith,
  defaultTemplateById,
  templatesFor,
} from '../src/domain/reminderText'
import type { TemplateContext } from '../src/domain/reminderText'
import type { Recipient, RecipientYouth } from '../src/domain/reminders'
import type { Person } from '../src/domain/types'

/**
 * What a reminder says, and which wording may go to whom.
 *
 * The wording is chosen apart from the audience, so the pairing has to be checked: a
 * template that asserts somebody has not checked in must never reach somebody who has.
 */

const person = (id: string, first: string): Person => ({
  id, firstName: first, lastName: 'R', section: 'cubs',
  parentName: 'Ada Ramsahai', parentEmail: 'ada@example.org', parentPhone: '',
  pairWithPersonId: null,
})

const youth = (id: string, first: string): RecipientYouth => ({
  person: person(id, first),
  shifts: [{ slotId: 'sat-0900', day: 'Saturday', slotLabel: '9:00 AM' }],
  assignmentIds: [`a-${id}`],
  passUrl: `https://appleday.example.org/p/tok-${id}`,
})

const one: Recipient = {
  email: 'ada@example.org', parentName: 'Ada Ramsahai', youths: [youth('p1', 'Elliot')],
}
const family: Recipient = {
  email: 'ada@example.org',
  parentName: 'Ada Ramsahai',
  youths: [youth('p1', 'Elliot'), youth('p2', 'Nadia')],
}

const CTX: TemplateContext = {
  eventName: 'Apple Day 2026',
  occasion: 'Saturday, 9:00 AM',
  supportLine: 'base on 519-555-0100',
  meetingPoint: 'The Scout Hall, 5 King St',
}

const render = (id: string, r: Recipient) => {
  const t = defaultTemplateById(id as never)!
  return { subject: fillTemplate(t.subject, r, CTX), body: fillTemplate(t.body, r, CTX) }
}

describe('every template', () => {
  it('names the day and hour rather than saying "tomorrow"', () => {
    /*
      An organizer chooses when to send, so a relative word is a promise about the clock
      that nothing here can keep — send the Saturday reminder on Thursday and "tomorrow" is
      simply false. Naming the day is true whenever it arrives.
    */
    for (const t of DEFAULT_TEMPLATES) {
      const text = `${fillTemplate(t.subject, one, CTX)} ${fillTemplate(t.body, one, CTX)}`.toLowerCase()
      expect(text, t.id).not.toMatch(/\btomorrow\b/)
      expect(text, t.id).not.toMatch(/\bin about an hour\b/)
      expect(text, t.id).not.toMatch(/\btonight\b/)
    }
  })

  it('greets the parent and carries the link', () => {
    for (const t of DEFAULT_TEMPLATES) {
      const body = fillTemplate(t.body, one, CTX)
      expect(body, t.id).toContain('Ada Ramsahai')
      expect(body, t.id).toContain('https://appleday.example.org/p/tok-p1')
    }
  })

  it('says when the shift is', () => {
    for (const t of DEFAULT_TEMPLATES) {
      const body = fillTemplate(t.body, one, CTX)
      expect(body, t.id).toContain('Saturday')
      expect(body, t.id).toContain('9:00 AM')
    }
  })

  it('never says where it is', () => {
    /*
      Nobody is told which shop they are on until they have reported to base and been
      checked in — that is the point of `revealShifts` on a pass. An email is the one place
      that rule cannot be walked back from, so the shift carries no location at all: the
      type has no field for one, and this is the test that says why.

      `reminders.test.ts` runs the same check through the real builder, with a real location
      attached to the shift. This one guards the wording; that one guards the pipeline.
    */
    for (const t of DEFAULT_TEMPLATES) {
      const body = `${fillTemplate(t.subject, family, CTX)} ${fillTemplate(t.body, family, CTX)}`
      for (const leak of ['Braemar', 'Linden', 'maps.google', 'http://', 'Unit ']) {
        expect(body, `${t.id} leaked ${leak}`).not.toContain(leak)
      }
    }
  })

  it('falls back to a greeting that reads when no parent is named', () => {
    const nameless = { ...one, parentName: '' }
    for (const t of DEFAULT_TEMPLATES) {
      expect(fillTemplate(t.body, nameless, CTX), t.id).toContain('Hi there,')
    }
  })

  it('says who to ring, and drops the line when there is nobody', () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(fillTemplate(t.body, one, CTX), t.id).toContain('519-555-0100')
      expect(fillTemplate(t.body, one, { ...CTX, supportLine: '' }), t.id).not.toContain('ring')
    }
  })

  it('never leaves a trailing blank line', () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(fillTemplate(t.body, one, { ...CTX, supportLine: '' }), t.id).toBe(
        fillTemplate(t.body, one, { ...CTX, supportLine: '' }).trimEnd(),
      )
    }
  })
})

describe('a parent with two children', () => {
  it('gets one message naming both, with a link each', () => {
    const { body } = render('event_schedule', family)
    expect(body).toContain('Elliot and Nadia')
    expect(body).toContain('tok-p1')
    expect(body).toContain('tok-p2')
  })

  it('labels each block, which a single child does not need', () => {
    expect(render('event_schedule', family).body).toContain("Elliot's page")
    expect(render('event_schedule', one).body).toContain('Your page')
    expect(render('event_schedule', one).body).not.toContain("Elliot's page")
  })

  it('never puts a verb that must agree in number after the children', () => {
    /*
      The defaults are worded number-neutrally on purpose. They are text an organizer can
      edit, not functions that could pick "has" or "have", and plain text cannot agree in
      number — a placeholder for it would be a grammar engine nobody asked
      for. So the wording sidesteps the question: "the shifts for Elliot" reads as well as
      "the shifts for Elliot and Nadia".

      Checked against the template rather than the render, and only where it can go wrong —
      immediately after the names. "We have not checked…" agrees with *we* and is fine.
    */
    for (const t of DEFAULT_TEMPLATES) {
      const text = `${t.subject}\n${t.body}`
      expect(text, t.id).not.toMatch(/\{\{\s*youth\s*\}\}\s+(has|have|is|are)\b/)
    }
  })

  it('names one child or both, as the case is', () => {
    expect(render('event_schedule', one).body).toContain('for Elliot at')
    expect(render('event_schedule', family).body).toContain('for Elliot and Nadia at')
  })
})

describe('which wording fits which selection', () => {
  it('offers the schedule for anything', () => {
    for (const kind of ['event', 'day', 'slot'] as const) {
      expect(templatesFor(kind).map((t) => t.id)).toContain('event_schedule')
    }
  })

  it('does not offer a shift reminder for a whole-event send', () => {
    // "Your shift is coming up" reads oddly about twelve hours spread over two days.
    expect(templatesFor('event').map((t) => t.id)).not.toContain('shift_upcoming')
    expect(templatesFor('event').map((t) => t.id)).not.toContain('not_checked_in')
  })

  it('offers all three for a day or an hour', () => {
    expect(templatesFor('day')).toHaveLength(3)
    expect(templatesFor('slot')).toHaveLength(3)
  })
})

describe('a wording that asserts something about state', () => {
  it('pins the audience, so it cannot reach somebody who has checked in', () => {
    /*
      The one rule tying the two choices together. "We have not checked you in" is a claim,
      and the filter that makes it true is not something an organizer should be able to
      leave switched off.
    */
    const chasing = defaultTemplateById('not_checked_in')!
    expect(chasing.requiresAudience).toBe('notCheckedIn')
    expect(audienceFor(chasing, 'all')).toBe('notCheckedIn')
    expect(audienceFor(chasing, 'notCheckedIn')).toBe('notCheckedIn')
  })

  it('leaves the choice alone for wording that claims nothing', () => {
    const schedule = defaultTemplateById('event_schedule')!
    expect(audienceFor(schedule, 'all')).toBe('all')
    expect(audienceFor(schedule, 'notCheckedIn')).toBe('notCheckedIn')
  })
})

describe('what the picker opens on', () => {
  it('is the schedule for a whole event', () => {
    expect(defaultTemplate('event', 'all')).toBe('event_schedule')
  })

  it('is the upcoming-shift wording for a day or an hour', () => {
    expect(defaultTemplate('day', 'all')).toBe('shift_upcoming')
    expect(defaultTemplate('slot', 'all')).toBe('shift_upcoming')
  })

  it('follows the filter when it is switched to chasing', () => {
    expect(defaultTemplate('day', 'notCheckedIn')).toBe('not_checked_in')
    expect(defaultTemplate('slot', 'notCheckedIn')).toBe('not_checked_in')
  })

  it('never defaults to wording that does not fit the selection', () => {
    for (const kind of ['event', 'day', 'slot'] as const) {
      for (const audience of ['all', 'notCheckedIn'] as const) {
        const id = defaultTemplate(kind, audience)
        expect(templatesFor(kind).map((t) => t.id), `${kind}/${audience}`).toContain(id)
      }
    }
  })
})

describe('wording an organizer has changed', () => {
  const asSaved = (over: Partial<{ subject: string; body: string }>) =>
    templateWith('event_schedule', {
      subject: 'Subject',
      body: 'Hi {{parent}},\n\n{{shifts}}',
      ...over,
    })!

  it('replaces the built-in, and renders through the same code', () => {
    /*
      The whole reason the defaults are text rather than functions. A saved wording that went
      through a different renderer could behave differently from the one it replaced — and
      the difference would only show up in somebody's inbox.
    */
    const t = asSaved({ subject: 'Apple Day: {{youth}}' })
    expect(fillTemplate(t.subject, one, CTX)).toBe('Apple Day: Elliot')
    expect(fillTemplate(t.body, one, CTX)).toContain('Saturday')
    expect(fillTemplate(t.body, one, CTX)).toContain('tok-p1')
  })

  it('keeps the parts that are not wording', () => {
    // Which selections it fits, and whether it pins the audience, are claims about who may
    // receive it — not turns of phrase, and not editable.
    const chasing = templateWith('not_checked_in', { subject: 'S', body: '{{shifts}}' })!
    expect(chasing.requiresAudience).toBe('notCheckedIn')
    expect(chasing.fits).toEqual(['day', 'slot'])
    expect(chasing.label).toBe('We are expecting you')
  })

  it('falls back to the built-in for a blank field', () => {
    const t = templateWith('event_schedule', { subject: '   ', body: '' })!
    expect(t.subject).toBe(defaultTemplateById('event_schedule')!.subject)
    expect(t.body).toBe(defaultTemplateById('event_schedule')!.body)
  })

  it('is the built-in when nothing has been saved', () => {
    expect(templateWith('event_schedule', null)).toEqual(
      defaultTemplateById('event_schedule'),
    )
    expect(isEdited(templateWith('event_schedule', null)!)).toBe(false)
    expect(isEdited(asSaved({}))).toBe(true)
  })
})

describe('what a wording is not allowed to be', () => {
  const check = (over: Partial<{ subject: string; body: string }>) =>
    templateProblem({ subject: 'S', body: '{{shifts}}', ...over })

  it('refuses a message with no {{shifts}} in it', () => {
    /*
      The one rule worth refusing over. `{{shifts}}` carries both the times and the link to
      their own page, so a message without it tells a parent nothing and gives them nowhere
      to look — and it would go to sixty families before anybody noticed.
    */
    expect(check({ body: 'Hi {{parent}}, see you Saturday.' })).toMatch(/needs \{\{shifts\}\}/)
  })

  it('accepts it however it is written', () => {
    expect(check({ body: '{{ shifts }}' })).toBeNull()
    expect(check({ body: 'Before.\n{{shifts}}\nAfter.' })).toBeNull()
  })

  it('refuses an empty subject or message', () => {
    expect(check({ subject: '  ' })).toMatch(/subject cannot be empty/)
    expect(check({ body: '   ' })).toMatch(/cannot be empty/)
  })

  it('names a placeholder it cannot fill', () => {
    // A typo, most likely. Better refused than sent with `{{yout}}` in it.
    expect(check({ body: '{{shifts}} {{yout}}' })).toMatch(/\{\{yout\}\} is not something/)
    expect(check({ body: '{{shifts}} {{a}} {{b}}' })).toMatch(/are not things/)
  })

  it('has no placeholder for a location, so no wording can add one', () => {
    // The rule holds by construction rather than by review.
    expect(PLACEHOLDERS.map((p) => p.token)).not.toContain('location')
    expect(check({ body: '{{shifts}} at {{location}}' })).toMatch(/\{\{location\}\}/)
  })
})

describe('a placeholder with nothing to fill it', () => {
  it('takes its line with it rather than sending half a sentence', () => {
    /*
      The default ends "On the day, ring {{support}}." An event with no contact recorded
      would otherwise send "On the day, ring ." — a sentence with its subject missing.
    */
    const body = fillTemplate(
      defaultTemplateById('event_schedule')!.body,
      one,
      { ...CTX, supportLine: '' },
    )
    expect(body).not.toContain('ring')
    expect(body).not.toMatch(/\s\.$/)
    expect(body).toContain('Saturday')
  })

  it('keeps a line that still has something to say', () => {
    // All of its placeholders empty, not any: one known value is enough to keep the line.
    const filled = fillTemplate('{{youth}} on {{occasion}}\n{{shifts}}', one, {
      ...CTX,
      occasion: '',
    })
    expect(filled).toContain('Elliot on')
  })

  it('leaves an unknown placeholder visible, so a typo can be seen', () => {
    expect(fillTemplate('{{shifts}} {{nope}}', one, CTX)).toContain('{{nope}}')
  })
})

describe('where the not-checked-in filter starts', () => {
  const start = (id: string) => audienceFor(defaultTemplateById(id as never)!, null)

  it('is on for a reminder about an hour that is about to begin', () => {
    /*
      Reported from the day: somebody with back-to-back shifts who checked in for the
      earlier one should not be told the later one is coming up. Checking in covers the
      whole stretch — `setStatus` writes to every shift in a run — so the filter catches
      them; it just has to be on to do it.
    */
    expect(start('shift_upcoming')).toBe('notCheckedIn')
  })

  it('is on, and locked, for the one that says they have not checked in', () => {
    expect(start('not_checked_in')).toBe('notCheckedIn')
    // Locked, not merely defaulted: the wording makes a claim that has to stay true.
    expect(audienceFor(defaultTemplateById('not_checked_in')!, 'all')).toBe('notCheckedIn')
  })

  it('is off for the whole schedule, which is not about an hour', () => {
    // "Here are your shifts" is worth sending to somebody who is already at the table.
    expect(start('event_schedule')).toBe('all')
  })

  it('can be cleared where it is only a default', () => {
    // Which is the difference between a default and a lock, and the reason for the third
    // state: "untouched" has to be distinguishable from "turned off".
    expect(audienceFor(defaultTemplateById('shift_upcoming')!, 'all')).toBe('all')
    expect(audienceFor(defaultTemplateById('event_schedule')!, 'notCheckedIn')).toBe(
      'notCheckedIn',
    )
  })
})

describe('a gap left by an empty placeholder', () => {
  const ctx = { eventName: 'Apple Day 2026', occasion: '', supportLine: '', meetingPoint: '' }

  it('is closed up rather than left as a double space', () => {
    // The line stays — it still says something — but "Your {{occasion}} shift" should not
    // read "Your  shift".
    expect(fillTemplate('Your {{occasion}} shift at {{event}}', one, ctx)).toBe(
      'Your shift at Apple Day 2026',
    )
  })

  it('leaves the indentation of the shift block alone', () => {
    /*
      Only runs that follow a visible character are collapsed. The shift block is indented
      two spaces a line and four for the link, and that indentation is the layout.
    */
    const body = fillTemplate('{{shifts}}', one, ctx)
    expect(body.split('\n').some((l) => l.startsWith('  '))).toBe(true)
  })

  it('does not touch a line where nothing was empty', () => {
    expect(fillTemplate('Hi {{parent}}, see you.', one, ctx)).toBe('Hi Ada Ramsahai, see you.')
  })
})

/**
 * Where to meet.
 *
 * The emails said when and never said where. A parent reads that as an oversight, and the
 * one place a reminder may name is base: everybody reports there first, so saying it gives
 * nothing away about which shop anybody ends up at.
 */
describe('the meeting point', () => {
  it('is in every wording, so no reminder goes out without it', () => {
    for (const t of DEFAULT_TEMPLATES) {
      expect(fillTemplate(t.body, one, CTX), t.id).toContain('The Scout Hall, 5 King St')
    }
  })

  it('takes its line with it when no base is set', () => {
    // Rather than "Report to  first". Publishing warns about a missing base separately.
    for (const t of DEFAULT_TEMPLATES) {
      const body = fillTemplate(t.body, one, { ...CTX, meetingPoint: '' })
      expect(body, t.id).not.toContain('Report to')
      expect(body, t.id).not.toMatch(/check-in/)
    }
  })

  it('is still only the base — a wording cannot name the shop instead', () => {
    // The guard above holds: there is nothing to put a shop's name into.
    expect(PLACEHOLDERS.map((p) => p.token)).toContain('meet')
    expect(templateProblem({ subject: 's', body: '{{shifts}} {{meet}}' })).toBeNull()
  })
})
