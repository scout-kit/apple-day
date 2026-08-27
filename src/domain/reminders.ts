import { groupIntoRuns, runSpan, runState } from './shiftRuns'
import { DAY_LABEL } from './slots'
import { fullName } from './types'
import type { Assignment, Day, Person, Slot } from './types'

/**
 * Who a reminder goes to.
 *
 * Three choices, kept apart on purpose: who it covers, which of those are filtered out, and
 * what it says. The same audience — everyone on the Saturday 9:00 shift — wants different
 * wording on different days, so bundling the wording into the audience would mean a new
 * "scope" every time somebody wanted to say something slightly different.
 *
 * Nothing here consults the clock. Sending is manual, so the audience is *chosen* rather
 * than inferred from a rolling window: an organizer picks "the Saturday 9:00 shift", not
 * "whatever starts in the next hour". That makes the selection reviewable before it sends,
 * and it means this whole file is matching on slot ids and day names — no instants, no
 * timezone, no daylight saving.
 *
 * And nothing here knows about locations, on purpose. Where somebody is standing is not
 * told to them until they have reported to base and been checked in — that is what
 * `revealShifts` on a pass is for (see `domain/passes`). A reminder naming the shop, or
 * worse its street address, would post that straight out to a mailbox and undo the rule.
 * Times only.
 */

export type SelectionKind = 'event' | 'day' | 'slot'

export type Selection =
  | { kind: 'event' }
  | { kind: 'day'; day: Day }
  | { kind: 'slot'; slotId: string }

/** Everybody the selection covers, or only those still expected. */
export type Audience = 'all' | 'notCheckedIn'

/**
 * A stable key for what a reminder was about.
 *
 * Goes into the ledger document id, so it has to be derived from the selection alone and
 * has to stay the same between the preview and the send.
 */
export function selectionKey(selection: Selection): string {
  if (selection.kind === 'day') return `day-${selection.day}`
  if (selection.kind === 'slot') return `slot-${selection.slotId}`
  return 'event'
}

/**
 * When a shift is, and nothing else.
 *
 * Not `PassShift`, which carries the location, the address and a map link. Those cannot go
 * in an email — see the note at the top — and building this from the slot alone also means
 * a shift is never dropped for want of a location, which is what happened when the shape
 * came from `buildPassShifts`: a shop removed from the library took its shifts out of
 * somebody's reminder without saying so.
 */
export interface ReminderShift {
  slotId: string
  /** "Saturday". */
  day: string
  /**
   * The time, already the whole stretch where consecutive shifts share a shop: "9:00 AM –
   * 11:00 AM" rather than two lines an hour apart.
   *
   * Grouped here rather than where the message is written, and that is the point: working out
   * whether two shifts continue each other needs to know they are at the same shop, and the
   * one rule about a reminder is that it carries no location. So the shop is used to decide,
   * here, where it is legitimately known — and never reaches the thing that renders text.
   */
  slotLabel: string
}

/** One youth's part of a message: their shifts, and the link to their own page. */
export interface RecipientYouth {
  person: Person
  /** Only the shifts the selection covers, not everything they are on. */
  shifts: ReminderShift[]
  /**
   * The assignments those shifts are, for the ledger.
   *
   * Assignment ids rather than slot ids: a shift can be reassigned to another location at
   * the same hour, and "we already told them about this" should be false when it is.
   * Sorted, so the record does not depend on read order.
   */
  assignmentIds: string[]
  /** Empty when they have no pass yet — publish has not run since they were added. */
  passUrl: string
}

/**
 * One message.
 *
 * Keyed by address rather than by person, because a parent with two children in the group
 * should get one email naming both, not two near-identical ones a second apart.
 */
export interface Recipient {
  /** Normalised — trimmed and lowercased — which is also what groups siblings together. */
  email: string
  parentName: string
  youths: RecipientYouth[]
}

/** Somebody the selection covers who cannot be emailed, so an organizer can ring instead. */
export interface Unreachable {
  person: Person
  phone: string
}

export interface ReminderAudience {
  recipients: Recipient[]
  unreachable: Unreachable[]
}

export interface AudienceInput {
  assignments: Assignment[]
  slots: Slot[]
  people: Person[]
  /** Pass tokens by person id. Absent for anybody added since the last publish. */
  tokenByPerson: Map<string, string>
  /** Where the app is served from, for building pass links. */
  origin: string
}

/**
 * An address as a key.
 *
 * Lowercased and trimmed, because a form fills in `A@x.com` and `a@x.com` from two parents
 * who are the same parent, and sending them both would be the thing this is meant to stop.
 */
export const normaliseEmail = (email: string): string => email.trim().toLowerCase()

/** Whether a shift falls inside the selection. */
function covers(selection: Selection, assignment: Assignment, slotById: Map<string, Slot>): boolean {
  if (selection.kind === 'event') return true
  if (selection.kind === 'slot') return assignment.slotId === selection.slotId
  return slotById.get(assignment.slotId)?.day === selection.day
}

/**
 * Everybody a reminder would go to, and everybody it cannot reach.
 *
 * Pure, so the whole of "who gets this" is testable without a browser or an emulator —
 * which matters more than usual here, because the cost of getting it wrong is an email to
 * somebody's parent.
 */
export function buildAudience(
  selection: Selection,
  audience: Audience,
  input: AudienceInput,
): ReminderAudience {
  const slotById = new Map(input.slots.map((s) => [s.id, s]))
  const slotOrder = new Map(input.slots.map((s, i) => [s.id, i]))
  const personById = new Map(input.people.map((p) => [p.id, p]))

  /*
    Swapped shifts are somebody else's now.

    Matches `buildPassShifts`, which is what fills a pass — a reminder that named a shift
    the pass does not show would send somebody to a location that is not theirs.
  */
  const live = input.assignments.filter((a) => a.status !== 'swapped')

  const mine = new Map<string, Assignment[]>()
  for (const a of live) {
    if (!covers(selection, a, slotById)) continue
    const held = mine.get(a.personId)
    if (held) held.push(a)
    else mine.set(a.personId, [a])
  }

  const recipients = new Map<string, Recipient>()
  const unreachable: Unreachable[] = []

  for (const [personId, theirs] of mine) {
    const person = personById.get(personId)
    // On the board but not on the roster — a removal part-way through. Nothing to send to.
    if (!person) continue

    if (audience === 'notCheckedIn' && !stillExpected(theirs, slotById)) continue

    const email = normaliseEmail(person.parentEmail)
    if (!email) {
      unreachable.push({ person, phone: person.parentPhone.trim() })
      continue
    }

    const token = input.tokenByPerson.get(personId) ?? ''
    const youth: RecipientYouth = {
      person,
      // Their qualifying shifts only, in the order they happen — a reminder about the
      // Saturday should not list the Friday.
      shifts: groupIntoRuns(
        [...theirs]
          .sort((a, b) => (slotOrder.get(a.slotId) ?? 0) - (slotOrder.get(b.slotId) ?? 0))
          .flatMap((a) => {
            const slot = slotById.get(a.slotId)
            return slot
              ? [{
                  slotId: slot.id,
                  day: DAY_LABEL[slot.day],
                  label: slot.label,
                  /*
                    Keyed on the day as well as the shop, because the times are minutes from
                    midnight: without it, five o'clock on the Friday and five o'clock on the
                    Saturday look adjacent.
                  */
                  locationId: `${slot.day}|${a.locationId}`,
                  startMin: slot.startMin,
                  endMin: slot.endMin,
                }]
              : []
          }),
      ).map((run) => {
        const first = run.items[0]!
        return { slotId: first.slotId, day: first.day, slotLabel: runSpan(run, first.label) }
      }),
      assignmentIds: theirs.map((a) => a.id).sort(),
      passUrl: token ? `${input.origin.replace(/\/+$/, '')}/p/${token}` : '',
    }

    const already = recipients.get(email)
    if (already) {
      already.youths.push(youth)
      // The first youth with a parent named wins, so a blank on one sibling's row does not
      // decide how the greeting reads.
      if (!already.parentName) already.parentName = person.parentName.trim()
    } else {
      recipients.set(email, {
        email,
        parentName: person.parentName.trim(),
        youths: [youth],
      })
    }
  }

  for (const r of recipients.values()) {
    r.youths.sort((a, b) => fullName(a.person).localeCompare(fullName(b.person)))
  }

  return {
    recipients: [...recipients.values()].sort((a, b) => a.email.localeCompare(b.email)),
    unreachable: unreachable.sort((a, b) =>
      fullName(a.person).localeCompare(fullName(b.person)),
    ),
  }
}

/**
 * Whether somebody still has not turned up for the shifts in question.
 *
 * Grouped into runs first, and asked per run rather than over the lot: somebody who worked
 * the Friday and has not arrived for the Saturday is still worth chasing about the
 * Saturday, and asking across both stretches at once would answer "arrived" and say nothing.
 */
function stillExpected(theirs: Assignment[], slotById: Map<string, Slot>): boolean {
  const runs = groupIntoRuns(
    theirs.map((a) => ({
      assignment: a,
      locationId: a.locationId,
      startMin: slotById.get(a.slotId)?.startMin ?? null,
      endMin: slotById.get(a.slotId)?.endMin ?? null,
    })),
  )
  return runs.some(
    (run) => runState(run.items.map((i) => i.assignment)).attendance === 'expected',
  )
}

/**
 * The id a send is recorded under.
 *
 * Deterministic, so "have we already sent this" is a lookup by id rather than a query — no
 * index, nothing to go stale, and the same answer from any device.
 *
 * Keyed on the *wording*, not the audience. The template is what makes one reminder a
 * different reminder rather than a repeat: "here are your shifts" and "you have not checked
 * in" about the same hour are two things worth saying, while the same wording twice is the
 * accident this is here to catch. Whether the not-checked-in filter happened to be on does
 * not change which message somebody received.
 */
export function ledgerId(
  templateId: string,
  selection: Selection,
  personId: string,
): string {
  return `${templateId}__${selectionKey(selection)}__${personId}`
}

/** What is already on the record for a message, so the send knows what to skip. */
export interface AlreadySent {
  personId: string
  sentAt: number
}

/**
 * Whether a whole message can be skipped.
 *
 * Only when *every* youth it covers has already had it. A parent whose second child was
 * added to the board this morning has not had a reminder about that child, and skipping the
 * address on the strength of the first one would quietly drop them.
 */
export function fullySent(recipient: Recipient, sent: ReadonlySet<string>): boolean {
  return recipient.youths.every((y) => sent.has(y.person.id))
}

/** The youths on a message who still need it, given what is already recorded. */
export function outstanding(recipient: Recipient, sent: ReadonlySet<string>): RecipientYouth[] {
  return recipient.youths.filter((y) => !sent.has(y.person.id))
}

/**
 * What has already gone out, gathered so a screen can say so.
 *
 * The ledger is one row per youth per wording per selection, which is the right shape for
 * "has this one had it" and the wrong shape for "what have we sent". This turns the first
 * into the second.
 */
export interface SentRecord {
  templateId: string
  selectionKey: string
  personId: string
  sentAt: number
  sentByEmail: string
}

/** Who has had a particular wording about a particular selection, by person id. */
export function sentFor(
  records: SentRecord[],
  templateId: string,
  selection: Selection,
): Map<string, number> {
  const key = selectionKey(selection)
  return new Map(
    records
      .filter((r) => r.templateId === templateId && r.selectionKey === key)
      .map((r) => [r.personId, r.sentAt]),
  )
}

/** One line per thing that has been sent, newest first. */
export interface SendSummary {
  templateId: string
  selectionKey: string
  people: number
  lastAt: number
  by: string
}

/**
 * Every distinct thing that has been sent, newest first.
 *
 * Grouped by wording and selection — the pair that makes one reminder a different reminder
 * from another, and the same pair the ledger is keyed on.
 */
export function sendHistory(records: SentRecord[]): SendSummary[] {
  const groups = new Map<string, SendSummary>()
  for (const r of records) {
    const key = `${r.templateId}__${r.selectionKey}`
    const held = groups.get(key)
    if (held) {
      held.people += 1
      if (r.sentAt > held.lastAt) {
        held.lastAt = r.sentAt
        held.by = r.sentByEmail
      }
    } else {
      groups.set(key, {
        templateId: r.templateId,
        selectionKey: r.selectionKey,
        people: 1,
        lastAt: r.sentAt,
        by: r.sentByEmail,
      })
    }
  }
  return [...groups.values()].sort((a, b) => b.lastAt - a.lastAt)
}

/**
 * The recipient a wording is previewed against.
 *
 * Invented on purpose, rather than borrowing somebody real. A real one is an arbitrary
 * sample of one — the first address alphabetically — so it might be the dullest case there
 * is and show nothing about the wording being edited. This one is built to show what an
 * edit is most likely to break.
 *
 * Two children, because that is the shape that goes wrong: the names join with "and", each
 * gets a labelled block and a link of their own, and a wording that reads for two reads for
 * one. Two shifts on the first, because a run of hours is the common case and the lines
 * have to sit together.
 */
export function exampleRecipient(): Recipient {
  const child = (id: string, firstName: string, shifts: ReminderShift[]): RecipientYouth => ({
    person: {
      id,
      firstName,
      lastName: 'Example',
      section: '',
      parentName: 'A Parent',
      parentEmail: 'a.parent@example.org',
      parentPhone: '',
      pairWithPersonId: null,
    },
    shifts,
    assignmentIds: [`${id}-a1`],
    passUrl: `https://example.org/p/${id}xxxxxxxxxxxxxxxxx`,
  })

  return {
    email: 'a.parent@example.org',
    parentName: 'A Parent',
    youths: [
      // A stretch and a single hour, so the preview shows both shapes a parent might read.
      child('alex', 'Alex', [
        { slotId: 'e1', day: 'Saturday', slotLabel: '9:00 AM – 11:00 AM' },
      ]),
      child('sam', 'Sam', [{ slotId: 'e3', day: 'Saturday', slotLabel: '2:00 PM' }]),
    ],
  }
}
