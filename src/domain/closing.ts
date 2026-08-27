import type { AppleDayEvent, Person } from './types'

/**
 * Finishing a year, and what that is for.
 *
 * An Apple Day ends, and everything the app needed in order to run it stops being something
 * worth holding. Two things in particular:
 *
 * A pass is a bearer document — `allow get: if true`, because the token is the credential —
 * carrying a child's full name, their hours, and, once they had been checked in, the shop
 * they were standing outside. Nothing expired one. A link forwarded into a family group chat
 * in 2026 still answered in 2031.
 *
 * And a parent's name, email and phone were collected so somebody could be rung on the day.
 * The day is over. Keeping them is keeping a list of minors' guardians and how to reach
 * them, for no remaining purpose, growing by a year every year.
 *
 * What stays is the youth's own name and section. That is deliberate and was asked for:
 * looking back at what a year was worth means telling this year's Calvin from the last
 * three, and a first name alone does not — there are a lot of Calvins. A name and a section
 * are also the least that could identify somebody, and the roll-ups never read either: the
 * history screens work off assignments, jars and slots and have never touched a person.
 *
 * None of it is reversible, which is the point, and why the screen says so twice.
 */

/** The fields a finish clears. Named once, so the writer and the wording cannot disagree. */
export const CONTACT_FIELDS = ['parentName', 'parentEmail', 'parentPhone'] as const

export type ContactField = (typeof CONTACT_FIELDS)[number]

/** Whether the year has been closed out. */
export function isFinished(event: Pick<AppleDayEvent, 'finishedAt'> | null): boolean {
  return Boolean(event && event.finishedAt !== null && event.finishedAt > 0)
}

/**
 * Whether the schedule may still be published.
 *
 * Publishing a finished year would mint a fresh set of the documents the finish existed to
 * delete — and against people whose parents can no longer be told, since the addresses a
 * reminder would use are the ones that went.
 *
 * A courtesy, not a gate: everybody who can press Publish is trusted with the data anyway.
 * What the finish actually guarantees is that the passes are gone and the contact details
 * are gone, and that is enforced by their absence rather than by a rule.
 */
export function canPublish(event: Pick<AppleDayEvent, 'finishedAt'> | null): boolean {
  return event !== null && !isFinished(event)
}

/** Whether anybody still holds contact details in this year. */
export function holdsContacts(person: Person): boolean {
  return CONTACT_FIELDS.some((field) => person[field].trim() !== '')
}

/** A person with nothing left on them that could be used to reach a family. */
export function withoutContacts(person: Person): Person {
  return { ...person, parentName: '', parentEmail: '', parentPhone: '' }
}

export interface ClosingCost {
  /** Links that stop working. */
  passes: number
  /** People whose parent's details go. */
  contacts: number
}

export function closingCost(
  passes: readonly unknown[],
  people: readonly Person[],
): ClosingCost {
  return {
    passes: passes.length,
    contacts: people.filter(holdsContacts).length,
  }
}

/**
 * What is about to happen, in the order it will be missed.
 *
 * Lines rather than a sentence, and things rather than a document count: "38 links, 52
 * parents' contact details" is what makes somebody check they have the export first.
 */
export function describeClosing(cost: ClosingCost): string[] {
  const said: string[] = []
  if (cost.passes > 0) {
    said.push(`${cost.passes} volunteer ${cost.passes === 1 ? 'link' : 'links'}`)
  }
  if (cost.contacts > 0) {
    said.push(
      `${cost.contacts} ${cost.contacts === 1 ? "parent's" : "parents'"} name, email and phone`,
    )
  }
  return said
}

/**
 * Whether there is anything left to do.
 *
 * A year with no passes and no contact details on it has already been finished, or never
 * held either — and offering to finish it again invites somebody to press a button whose
 * warning is about data that is not there.
 */
export function worthFinishing(cost: ClosingCost): boolean {
  return cost.passes > 0 || cost.contacts > 0
}

/**
 * What the confirmation makes somebody type.
 *
 * The event's name, which is what `confirmsRemoval` asks for — the same gesture for the same
 * reason. This cannot be undone, and a dialog with one button between somebody and a
 * decision gets pressed by muscle memory.
 */
export const confirmsClosing = (typed: string, name: string): boolean =>
  typed.trim().toLowerCase() === name.trim().toLowerCase() && name.trim() !== ''
