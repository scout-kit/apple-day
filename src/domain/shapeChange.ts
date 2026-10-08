import type { Assignment, Slot } from './types'

/**
 * What changing a year's shift shape would do to the shifts already on the board.
 *
 * A slot id is built from its start — `fri-1645` is the block beginning at a quarter to
 * five — so moving the shift length, the overlap or a day's opening time moves the ids with
 * it. Shifts are stored against those ids, and a shift whose id is no longer in the grid
 * stops appearing anywhere: not on the board, not in anybody's hours, not in the revenue
 * its jars are attributed through. It is still in the database, and the orphan list on the
 * money screen is the only thing that will ever mention it again.
 *
 * None of which is obvious from a dropdown that says "75 min". So this is the arithmetic the
 * settings screen needs in order to say, before anything is saved, exactly which shifts are
 * about to fall off and how many people are on them.
 */

export interface LostSlot {
  slotId: string
  /** The slot as the board shows it today, so the warning names something recognisable. */
  label: string
  /** How many shifts are rostered on it. */
  shifts: number
  /** The people on it, by id — the caller turns these into names. */
  personIds: string[]
}

export interface ShapeChangeImpact {
  /** Slots that exist now and would not afterwards, worst first. */
  lost: LostSlot[]
  /** Shifts that would be left pointing at a slot that no longer exists. */
  orphaned: number
  /** Slots the change would add. Harmless, but it is half of what changed. */
  added: string[]
}

/**
 * Compare the grid as it stands with the grid a draft would produce.
 *
 * Only shifts on a slot that exists *now* are counted: a shift that is already orphaned was
 * broken before this edit and blaming the edit for it would be wrong, and would make the
 * warning cry wolf on every save.
 */
export function shapeChangeImpact(
  before: Slot[],
  after: Slot[],
  assignments: Assignment[],
): ShapeChangeImpact {
  const afterIds = new Set(after.map((s) => s.id))
  const onSlot = new Map<string, string[]>()

  for (const a of assignments) {
    const list = onSlot.get(a.slotId)
    if (list) list.push(a.personId)
    else onSlot.set(a.slotId, [a.personId])
  }

  const lost: LostSlot[] = []
  for (const slot of before) {
    if (afterIds.has(slot.id)) continue
    const personIds = onSlot.get(slot.id) ?? []
    lost.push({
      slotId: slot.id,
      label: slot.arriveLabel,
      shifts: personIds.length,
      personIds: [...new Set(personIds)],
    })
  }

  // Busiest first: the cost of the change is the shifts on it, not the slots.
  lost.sort((a, b) => b.shifts - a.shifts || a.slotId.localeCompare(b.slotId))

  const beforeIds = new Set(before.map((s) => s.id))
  return {
    lost,
    orphaned: lost.reduce((sum, s) => sum + s.shifts, 0),
    added: after.filter((s) => !beforeIds.has(s.id)).map((s) => s.id),
  }
}
