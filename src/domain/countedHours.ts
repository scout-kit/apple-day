import type { Assignment, Day, Slot } from './types'

/**
 * How much worked time each shift adds to the person doing it.
 *
 * Two things are being taken out of the old figure. A block is a quarter of an hour of
 * checking in followed by an hour on a doorstep, and only the hour is worked — so a 75
 * minute block is worth 1 hour, not 1¼. And where blocks overlap, as they do when an event
 * runs a handover, the shared minutes belong to one of them rather than to both.
 *
 * The event this was written for ran four 75 minute blocks from a quarter to five, and every
 * hours figure in the app was 25% high: four shifts read as 5 hours of work for an evening
 * that was 4.
 *
 * Each shift is credited with the part of its shift that no earlier shift of that person's
 * day already covered, so the credits still add up: sum them by location, by slot, by
 * section or by person and every total agrees with the person-by-person one.
 */

/** The stretch of a day one shift is credited with. Minutes from midnight. */
export interface CountedWindow {
  day: Day
  from: number
  to: number
}

/**
 * Keyed by day as well as person, because the times are minutes from midnight: without it,
 * five o'clock on the Friday and five o'clock on the Saturday overlap.
 */
function keyOf(personId: string, day: Day): string {
  return `${personId}\u0000${day}`
}

/**
 * The window each assignment is credited with, by assignment id.
 *
 * Assignments the caller does not want counted — no-shows, swapped rows, whichever basis a
 * screen is on — must be left out by the caller. They are left out of the overlap maths
 * too, so a no-show cannot absorb the credit for a shift somebody really worked.
 *
 * An assignment whose slot is unknown is absent from the result rather than zero: it has no
 * time to place, which is a different thing from having worked none.
 */
export function countedWindows(
  assignments: Assignment[],
  slots: Slot[],
): Map<string, CountedWindow> {
  const bySlot = new Map(slots.map((s) => [s.id, s]))
  const byPersonDay = new Map<string, { id: string; slot: Slot }[]>()

  for (const a of assignments) {
    const slot = bySlot.get(a.slotId)
    if (!slot) continue
    const key = keyOf(a.personId, slot.day)
    const list = byPersonDay.get(key)
    if (list) list.push({ id: a.id, slot })
    else byPersonDay.set(key, [{ id: a.id, slot }])
  }

  const out = new Map<string, CountedWindow>()

  for (const shifts of byPersonDay.values()) {
    /*
      Earliest shift first, so whatever has already been counted is always a prefix of the
      day and one number — how far the credit has reached — is enough to carry. The longer
      shift wins a tie, which keeps a short shift sitting inside a long one from taking the
      credit and leaving the long one with the remainder.
    */
    const ordered = [...shifts].sort(
      (a, b) => a.slot.workStartMin - b.slot.workStartMin || b.slot.endMin - a.slot.endMin,
    )

    let reached = -Infinity
    for (const { id, slot } of ordered) {
      const from = Math.max(slot.workStartMin, reached)
      // Wholly inside a stretch already counted: real, worked, and worth no extra minutes.
      if (slot.endMin <= from) continue
      out.set(id, { day: slot.day, from, to: slot.endMin })
      reached = slot.endMin
    }
  }

  return out
}

/** The same thing in hours, which is what every total in the app is in. */
export function countedHours(assignments: Assignment[], slots: Slot[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const [id, window] of countedWindows(assignments, slots)) {
    out.set(id, (window.to - window.from) / 60)
  }
  return out
}
