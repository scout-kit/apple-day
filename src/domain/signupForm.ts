import { buildSlots, DAY_LABEL } from './slots'
import type { SectionDef } from './sections'
import type { AppleDayEvent, Day } from './types'

/**
 * The signup form an event needs, described once.
 *
 * Intake stays on a Google Form, which means somebody builds that form by hand every year
 * and the import has to cope with whatever they typed. Two things go wrong there and both
 * are quiet: the shift options drift from the hours the event actually runs, so a family
 * offers an hour nobody is staffing; and a question gets renamed, so the import cannot find
 * the column and an organizer has to remap it from memory.
 *
 * Describing the form here fixes both ends at once. The availability options *are* the
 * event's shifts, and the question titles are ones this app's own importer recognises — so
 * a form built from this maps on sight, with nothing to correct.
 *
 * Pure, and deliberately not tied to how the form gets made. The same description drives
 * the button that creates one through Google's API and the list somebody copies by hand,
 * which is what keeps those two from disagreeing.
 */

export type QuestionKind = 'text' | 'longText' | 'choice' | 'checkboxes'

export interface FormQuestion {
  /**
   * The question as it appears on the form — and therefore the column heading in the
   * exported CSV, which is what the importer matches on. Not a label to prettify.
   */
  title: string
  /** Shown under the title, where a form needs a word of explanation. */
  help?: string
  kind: QuestionKind
  required: boolean
  options?: string[]
  /**
   * The importer field this column feeds, when it feeds one. `null` for a question the
   * form asks for the group's own reasons.
   */
  feeds: string | null
}

export interface FormSpec {
  title: string
  description: string
  questions: FormQuestion[]
}

export interface SignupFormOptions {
  /** Ask for a parent's email and phone. Neither was on the old forms. */
  contact?: boolean
  /** A yes/no on whether the parent is staying with their youth. */
  attending?: boolean
  /** A free-text box at the end. */
  notes?: boolean
  /** A field of its own for a buddy request, instead of it being typed into the name. */
  pairing?: boolean
}

const DEFAULTS: Required<SignupFormOptions> = {
  contact: true,
  attending: true,
  notes: true,
  pairing: false,
}

/**
 * The shift labels for one day, exactly as the schedule shows them.
 *
 * The same strings the app writes elsewhere, so an answer comes back as a shift this event
 * really has. Anything else — a tidied-up wording, a rounded time — is an answer the
 * importer has to guess at.
 */
export function shiftOptions(event: AppleDayEvent, day: Day): string[] {
  return buildSlots(day, event.schedule, event).map((slot) => slot.label)
}

/** The days this event runs, in week order. */
export function formDays(event: AppleDayEvent): Day[] {
  return (Object.keys(event.schedule) as Day[]).filter((day) => event.schedule[day])
}

/**
 * Build the form for an event.
 *
 * Question order matters and is not cosmetic: the importer takes the first column that
 * matches a field, so the youth's name has to be asked before anything else with the word
 * "youth" in it.
 */
export function buildSignupForm(
  event: AppleDayEvent,
  sections: SectionDef[],
  options: SignupFormOptions = {},
): FormSpec {
  const { contact, attending, notes, pairing } = { ...DEFAULTS, ...options }
  const questions: FormQuestion[] = []

  questions.push({
    title: 'Youth name',
    help: 'First and last name, as you would like it on the schedule.',
    kind: 'text',
    required: true,
    feeds: 'youthName',
  })

  questions.push({
    title: 'Section',
    kind: 'choice',
    required: true,
    /*
      Every section, Scouters included.

      Adults sign up on the same form and work the same shifts, so a list of youth sections
      leaves them nothing to pick — and somebody with nothing to pick picks whatever is
      nearest, which puts a leader in the Cubs figures for the year.

      The group's own sections rather than a fixed list, so renaming one or adding one needs
      no code change here.
    */
    options: sections.map((s) => s.name),
    feeds: 'section',
  })

  questions.push({
    title: 'Parent name',
    kind: 'text',
    required: false,
    feeds: 'parentName',
  })

  if (contact) {
    questions.push({
      title: 'Parent email',
      help: 'Where the schedule and any reminders will be sent.',
      kind: 'text',
      required: true,
      feeds: 'parentEmail',
    })
    /*
      Asked for, not insisted on.

      An address is how a schedule and its reminders are sent, so a signup without one
      cannot be answered at all. A number is how somebody is reached at ten past nine, which
      matters on the day and not before it — and a required field is a field people put
      anything in to get past. The app already marks who is missing one, on the screen where
      it can be chased.
    */
    questions.push({
      title: 'Parent phone',
      help: 'For reaching you on the day itself. Not required, but it helps.',
      kind: 'text',
      required: false,
      feeds: 'parentPhone',
    })
  }

  if (attending) {
    questions.push({
      title: 'Will you attend with your youth?',
      kind: 'choice',
      required: false,
      options: ['Yes', 'No'],
      feeds: 'attending',
    })
  }

  if (pairing) {
    questions.push({
      title: 'Pair with',
      help: 'A sibling or friend they should be scheduled alongside.',
      kind: 'text',
      required: false,
      feeds: 'pairWith',
    })
  }

  /*
    One question per day, titled with the day and nothing else.

    The importer finds an availability column by looking for the day's name in the heading,
    so "Friday" is found and so is "Friday availability" — but the plain day is the one that
    cannot collide with anything, and it reads as a heading on the form.
  */
  for (const day of formDays(event)) {
    questions.push({
      title: DAY_LABEL[day],
      help: 'Tick every hour they could work. More ticks makes the schedule easier to build.',
      kind: 'checkboxes',
      required: false,
      options: shiftOptions(event, day),
      feeds: `day:${day}`,
    })
  }

  if (notes) {
    questions.push({
      title: 'Notes',
      help: 'Anything else we should know.',
      kind: 'longText',
      required: false,
      feeds: 'notes',
    })
  }

  return {
    title: event.name,
    description: describeForm(event),
    questions,
  }
}

function describeForm(event: AppleDayEvent): string {
  const days = formDays(event).map((day) => DAY_LABEL[day])
  const when =
    days.length === 0
      ? ''
      : days.length === 1
        ? days[0]!
        : `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`

  return [
    `Please fill this in once for each youth taking part in ${event.name}.`,
    when && `We are out on ${when}.`,
    'Tick every hour they could work — the more you can offer, the easier the schedule is.',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * What is wrong with this form, in the words of what to do about it.
 *
 * Checked before a form is built rather than after it is filled in by ninety families.
 */
export function formProblems(spec: FormSpec, event: AppleDayEvent): string[] {
  const problems: string[] = []

  if (formDays(event).length === 0) {
    problems.push('This event has no days switched on, so there are no hours to offer.')
  }

  for (const question of spec.questions) {
    if (question.kind !== 'checkboxes') continue
    if (!question.options || question.options.length === 0) {
      problems.push(`${question.title} has no shifts — check the hours on the event.`)
    }
  }

  /*
    A comma in an option would split into two answers.

    Google joins the ticked boxes of a checkbox question with commas, and the importer
    splits them on commas to get back a list. An option containing one arrives as two
    answers, neither of which is a shift.
  */
  const withCommas = spec.questions
    .flatMap((q) => q.options ?? [])
    .filter((option) => option.includes(','))
  if (withCommas.length > 0) {
    problems.push(
      `These answers contain a comma, which would split them in two on the way back: ${withCommas.join(
        ' · ',
      )}.`,
    )
  }

  if (spec.questions.some((q) => q.kind === 'choice' && (q.options ?? []).length === 0)) {
    problems.push('A multiple-choice question has no answers to choose from.')
  }

  return problems
}

/** The form as text somebody can work through, for building it by hand. */
export function describeSpec(spec: FormSpec): string {
  const lines: string[] = [spec.title, '', spec.description, '']

  spec.questions.forEach((question, index) => {
    const kind = {
      text: 'Short answer',
      longText: 'Paragraph',
      choice: 'Multiple choice',
      checkboxes: 'Checkboxes',
    }[question.kind]

    lines.push(`${index + 1}. ${question.title}${question.required ? '  (required)' : ''}`)
    lines.push(`   ${kind}`)
    if (question.help) lines.push(`   ${question.help}`)
    for (const option of question.options ?? []) lines.push(`   - ${option}`)
    lines.push('')
  })

  return lines.join('\n').trimEnd()
}

/**
 * Whether a form built earlier still matches the event.
 *
 * The round trip only holds because the options *are* the event's shift labels. Change the
 * hours, the shift length or the overlap afterwards and the form goes on offering times
 * that no longer exist — families tick them, the import cannot resolve them, and the
 * availability goes quietly missing. Which is the failure this whole path was built to
 * avoid, arriving by another door.
 *
 * Compared as text against what the event would produce now, because that is exactly what a
 * response will be matched against.
 */
export function formIsCurrent(
  built: { day: Day; options: string[] }[],
  event: AppleDayEvent,
): boolean {
  const now = formDays(event)
  if (built.length !== now.length) return false

  return built.every((was) => {
    const options = shiftOptions(event, was.day)
    return (
      now.includes(was.day) &&
      options.length === was.options.length &&
      options.every((option, i) => option === was.options[i])
    )
  })
}

/** What the form is offering, kept so it can be checked against the event later. */
export function shiftSnapshot(event: AppleDayEvent): { day: Day; options: string[] }[] {
  return formDays(event).map((day) => ({ day, options: shiftOptions(event, day) }))
}

/**
 * What to say when they have drifted apart.
 *
 * Named plainly, because the fix is to build the form again and nothing else will do — an
 * organizer editing the old one by hand has to get every option exactly right.
 */
export function staleFormWarning(
  built: { day: Day; options: string[] }[],
  event: AppleDayEvent,
): string | null {
  if (formIsCurrent(built, event)) return null
  return (
    'The hours on this event have changed since this form was built, so it is offering ' +
    'shifts that no longer exist. Build it again — answers to the old times cannot be ' +
    'imported.'
  )
}
