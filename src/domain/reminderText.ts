import type { Audience, Recipient, RecipientYouth, SelectionKind } from './reminders'

/**
 * What a reminder says.
 *
 * Separate from who it goes to. The same audience wants different wording on different days
 * — here is your schedule, your shift is coming up, we are expecting you — and bundling the
 * two would mean a new audience for every turn of phrase.
 *
 * The wording is text with `{{placeholders}}`, and the built-in defaults are written in the
 * same form as an edited one, so there is a single renderer and a saved wording cannot
 * behave differently from the one it replaced.
 *
 * Not editable: which selections a wording fits, and whether it pins the audience. Those
 * are claims about who may receive it.
 *
 * Every default names the day and the hour outright. An organizer chooses when to send, so
 * "tomorrow" is a promise about the clock that nothing here can keep.
 *
 * There is no placeholder for a shop and none to add. Where somebody is standing is not told
 * to them until they report to base, and an email cannot be taken back.
 *
 * Where to *meet* is a different thing, and it is here: everybody reports to base first, so
 * base is the one place a reminder can name. Without it the email says when and never says
 * where, and a parent reads it as an oversight.
 *
 * Base is named and then linked, never spelled out: a map link carries the address and can be
 * pressed, and an address printed beside it is the same information twice — once in the form
 * that is no use in a car.
 *
 * The two notes the organizers write — what to do on arrival, and anything else for the day —
 * are here for the same reason the times are. They are on every pass already; a reminder that
 * leaves them out sends a parent to a page to find out what the email could have said.
 *
 * Plain text. This is read on a phone in a shop doorway.
 */

export type TemplateId = 'event_schedule' | 'shift_upcoming' | 'not_checked_in'

export interface TemplateContext {
  /** The event's name, for the subject line. */
  eventName: string
  /** "Saturday", "Saturday 9:00 AM", or empty for a whole-event send. */
  occasion: string
  /** Who to ring on the day. */
  supportLine: string
  /**
   * Where to report before a shift — the event's base, by name.
   *
   * Empty when no base is set, which drops the line that mentions it rather than sending
   * "report to  first". An event with no base has a warning of its own on publishing.
   */
  meetingPoint: string
  /**
   * A map link to it, which is the address in the form that is any use on the way there.
   *
   * Derived from the address when no link was saved, so a base with an address always has
   * one, and the address itself is never printed as well.
   */
  directions: string
  /** What to do on arrival, in the organizers' words. Empty means they wrote none. */
  arrivalNote: string
  /** Anything else for the day, in the organizers' words. */
  supportNote: string
}

/** The wording of one reminder — the half an organizer may change. */
export interface TemplateText {
  subject: string
  body: string
}

export interface ReminderTemplate extends TemplateText {
  id: TemplateId
  label: string
  /** One line under the label in the picker, saying when to reach for it. */
  blurb: string
  /** Which selections this wording reads sensibly for. */
  fits: SelectionKind[]
  /**
   * Pins the audience when the wording asserts something about state.
   *
   * "You have not checked in" must never reach somebody who has, so choosing this wording
   * sets the filter and locks it.
   */
  requiresAudience?: Audience
  /**
   * Where the filter starts when nobody has touched it.
   *
   * Weaker than `requiresAudience`: the wording asserts nothing, but telling a youth their
   * shift is coming up when they checked in an hour ago and have been working since is
   * noise. Back-to-back shifts are one stretch, and one check-in covers all of it.
   */
  defaultAudience?: Audience
}

/**
 * What may appear in a wording, and what each one puts there.
 *
 * A closed list: there is no expression to evaluate, only names to look up, which is what
 * makes an edited wording safe to render and why no editing can put a shop's address into
 * an email.
 */
export const PLACEHOLDERS: { token: string; describes: string }[] = [
  { token: 'parent', describes: 'The parent’s name, or “there” when none is on file' },
  { token: 'youth', describes: 'The children it is about — “Elliot and Nadia”' },
  { token: 'event', describes: 'The event’s name' },
  { token: 'occasion', describes: 'The day or hour it is about — “Saturday 9:00 AM”' },
  { token: 'shifts', describes: 'Their shift times, and a link to each child’s own page' },
  { token: 'support', describes: 'Who to ring on the day' },
  { token: 'meet', describes: 'Where to report before a shift — the event’s base' },
  { token: 'directions', describes: 'A map link to base — the address, in a form you can press' },
  { token: 'arrival', describes: 'What to do on arrival, as written on the event' },
  { token: 'notes', describes: 'Anything else for the day, as written on the event' },
]

/** "Elliot and Nadia" — a parent may have more than one child here. */
const named = (r: Recipient): string =>
  r.youths.map((y) => y.person.firstName).join(' and ')

/**
 * One youth's shifts, as lines.
 *
 * Their name heads the block only when the message covers more than one child.
 */
function block(youth: RecipientYouth, several: boolean): string {
  const lines: string[] = []
  if (several) lines.push(`${youth.person.firstName}:`)

  /*
    When, and not where. See the note at the top of the file.

    Each line is already a whole stretch: consecutive shifts at one shop were joined when the
    audience was built, which is where the shop is known. Nothing here has ever seen one.
  */
  for (const shift of youth.shifts) {
    lines.push(`  ${shift.day} ${shift.slotLabel}`)
  }

  if (youth.passUrl) {
    lines.push('')
    lines.push(`  ${several ? `${youth.person.firstName}'s page` : 'Your page'}: ${youth.passUrl}`)
  }
  return lines.join('\n')
}

/** The shift blocks for everybody on the message, with the links. */
function shiftDetail(r: Recipient): string {
  const several = r.youths.length > 1
  return r.youths.map((y) => block(y, several)).join('\n\n')
}

/**
 * Put the real values into a wording.
 *
 * An unknown placeholder is left as written rather than blanked, so a typo shows up in the
 * preview as `{{yout}}` instead of quietly removing the name it was meant to be.
 */
export function fillTemplate(text: string, r: Recipient, ctx: TemplateContext): string {
  const values: Record<string, string> = {
    parent: r.parentName || 'there',
    youth: named(r),
    event: ctx.eventName,
    occasion: ctx.occasion,
    shifts: shiftDetail(r),
    support: ctx.supportLine,
    meet: ctx.meetingPoint,
    directions: ctx.directions,
    arrival: ctx.arrivalNote.trim(),
    notes: ctx.supportNote.trim(),
  }
  const TOKEN = /\{\{\s*(\w+)\s*\}\}/g

  const lines = text.split('\n').flatMap((line) => {
    const used = [...line.matchAll(TOKEN)].map((m) => m[1]!)

    /*
      A line built entirely around empty placeholders is dropped whole. The default ends "On
      the day, ring {{support}}.", and an event with no contacts would otherwise send a
      sentence with its subject missing.

      All of them, not any: a line mentioning two things where one is known still has
      something to say.
    */
    if (used.length > 0 && used.every((name) => (values[name] ?? '') === '')) return []

    // And the gap an empty one leaves mid-line is closed up. Only runs following a visible
    // character — the shift block is indented two spaces a line, and that is the layout.
    return [
      line
        .replace(TOKEN, (whole, name: string) => values[name] ?? whole)
        .replace(/(\S) {2,}/g, '$1 ')
        .trimEnd(),
    ]
  })

  // Whatever gap a dropped line left is closed up.
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/**
 * The wording each reminder starts with.
 *
 * Number-neutral: "the shifts for Elliot" reads as well as "for Elliot and Nadia", where
 * "has a shift" would be wrong for two. Plain text cannot choose between has and have.
 */
export const DEFAULT_TEMPLATES: ReminderTemplate[] = [
  {
    id: 'event_schedule',
    label: 'Here are your shifts',
    blurb: 'The whole schedule, for sending once it is settled.',
    fits: ['event', 'day', 'slot'],
    subject: 'Your shifts for {{event}}',
    body: [
      'Hi {{parent}},',
      '',
      'The shifts for {{youth}} at {{event}}:',
      '',
      '{{shifts}}',
      '',
      'Report to {{meet}} first — where you are going is given out at check-in.',
      'Directions: {{directions}}',
      '',
      '{{arrival}}',
      '',
      'On the day, ring {{support}}.',
      '',
      '{{notes}}',
    ].join('\n'),
  },
  {
    id: 'shift_upcoming',
    label: 'Your shift is coming up',
    blurb: 'A nudge before a particular day or hour.',
    fits: ['day', 'slot'],
    // Starts with the filter on. Anybody already checked in for the coming hour is already
    // there, usually because they worked the hour before it at the same shop.
    defaultAudience: 'notCheckedIn',
    subject: 'Your {{occasion}} shift at {{event}}',
    body: [
      'Hi {{parent}},',
      '',
      'A reminder about {{occasion}} for {{youth}}:',
      '',
      '{{shifts}}',
      '',
      'Report to {{meet}} first — where you are going is given out at check-in.',
      'Directions: {{directions}}',
      '',
      '{{arrival}}',
      '',
      'On the day, ring {{support}}.',
      '',
      '{{notes}}',
    ].join('\n'),
  },
  {
    id: 'not_checked_in',
    label: 'We are expecting you',
    blurb: 'For chasing anybody who has not arrived. Only ever sent to those still expected.',
    fits: ['day', 'slot'],
    requiresAudience: 'notCheckedIn',
    subject: 'Please check in for your shift',
    body: [
      'Hi {{parent}},',
      '',
      'We have not checked {{youth}} in yet for {{occasion}}, and we are still expecting them.',
      '',
      '{{shifts}}',
      '',
      'Report to {{meet}} — where you are going is given out at check-in.',
      'Directions: {{directions}}',
      '',
      '{{arrival}}',
      '',
      'If something has come up, please let us know so we can cover the shift.',
      '',
      'On the day, ring {{support}}.',
      '',
      '{{notes}}',
    ].join('\n'),
  },
]

export const defaultTemplateById = (id: TemplateId): ReminderTemplate | undefined =>
  DEFAULT_TEMPLATES.find((t) => t.id === id)

/**
 * A wording with whatever has been saved over it.
 *
 * Absence is the default: nothing needs seeding, and resetting is deleting the record.
 */
export function templateWith(
  id: TemplateId,
  saved?: TemplateText | null,
): ReminderTemplate | undefined {
  const base = defaultTemplateById(id)
  if (!base) return undefined
  if (!saved) return base
  return {
    ...base,
    subject: saved.subject.trim() || base.subject,
    body: saved.body.trim() || base.body,
  }
}

/** Whether a wording has been changed from what it started as. */
export function isEdited(t: TemplateText & { id: TemplateId }): boolean {
  const base = defaultTemplateById(t.id)
  return base ? base.subject !== t.subject || base.body !== t.body : false
}

/**
 * What is wrong with an edited wording, or nothing.
 *
 * A body without `{{shifts}}` is the one worth refusing — it carries both the times and the
 * link to their own page, so a message without it tells a parent nothing. The rest of the
 * wording is theirs to get wrong.
 */
export function templateProblem(text: TemplateText): string | null {
  if (!text.subject.trim()) return 'The subject cannot be empty.'
  if (!text.body.trim()) return 'The message cannot be empty.'
  if (!/\{\{\s*shifts\s*\}\}/.test(text.body)) {
    return 'The message needs {{shifts}} — it is what carries the times and their own link.'
  }

  const known = new Set(PLACEHOLDERS.map((p) => p.token))
  const unknown = [
    ...new Set(
      [...`${text.subject}\n${text.body}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
        .map((m) => m[1]!)
        .filter((name) => !known.has(name)),
    ),
  ]
  if (unknown.length > 0) {
    return `${unknown.map((u) => `{{${u}}}`).join(', ')} ${
      unknown.length === 1 ? 'is not something' : 'are not things'
    } this app can fill in.`
  }
  return null
}

/** The templates worth offering for a selection — the rest would read oddly. */
export function templatesFor(kind: SelectionKind): ReminderTemplate[] {
  return DEFAULT_TEMPLATES.filter((t) => t.fits.includes(kind))
}

/**
 * The audience a template will actually be sent to.
 *
 * A wording that asserts somebody has not checked in decides outright, so the assertion
 * cannot be made false by a toggle. Failing that, whatever the organizer chose; failing
 * that, the wording's own default.
 *
 * `null` for "not chosen" rather than `false`, so a wording that starts the filter on can
 * still have it turned off deliberately.
 */
export function audienceFor(
  template: ReminderTemplate,
  chosen: Audience | null,
): Audience {
  return template.requiresAudience ?? chosen ?? template.defaultAudience ?? 'all'
}

/** What to open the picker on, so the ordinary case is one press. */
export function defaultTemplate(kind: SelectionKind, audience: Audience): TemplateId {
  if (audience === 'notCheckedIn' && kind !== 'event') return 'not_checked_in'
  return kind === 'event' ? 'event_schedule' : 'shift_upcoming'
}
