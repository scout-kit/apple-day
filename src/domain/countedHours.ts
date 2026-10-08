import type { Assignment, Day, Slot } from './types'

/**
 * How much of the day each shift adds to the person doing it.
 *
 * A shift is two things: the hour on location, and the quarter-hour before it when the
 * person is told to turn up. Both are time they are standing there, so both count — but
 * only once. Somebody doing 5–6 and 6–7 was asked to arrive at 4:45 and goes home at 7:00,
 * which is 2¼ hours, not the 2½ that adding two 1¼-hour shifts gives: the second shift's
 * lead-in is the first shift's last quarter of an hour, and it was being counted twice.
 *
 * Counting the stretch rather than the shifts is also what makes the figure survive a
 * change of shape. Before this, an event bought its check-in window by making the shift
 * itself 75 minutes, so every hours figure in the app was 25% high and the error grew with
 * the number of shifts somebody did.
 *
 * Each shift is credited with the part of its window that no earlier shift already covered,
 * so the credits still add up: sum them by location, by slot, by section or by person and
 * every total agrees with the person-by-person one.
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
      Earliest arrival first, so whatever has already been counted is always a prefix of the
      day and one number — how far the credit has reached — is enough to carry. The longer
      shift wins a tie, which keeps a short shift sitting inside a long one from taking the
      credit and leaving the long one with the remainder.
    */
    const ordered = [...shifts].sort(
      (a, b) => a.slot.arriveMin - b.slot.arriveMin || b.slot.endMin - a.slot.endMin,
    )

    let reached = -Infinity
    for (const { id, slot } of ordered) {
      const from = Math.max(slot.arriveMin, reached)
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
