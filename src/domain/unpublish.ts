import { wasWorked } from './types'
import type { Assignment } from './types'

/**
 * Taking a published schedule back.
 *
 * Publishing is the one action here that reaches outside the app: it hands every volunteer a
 * link, and those links live in inboxes. So withdrawing it is not the inverse of a save —
 * it is a decision with a cost, and this is the arithmetic behind it.
 *
 * The cost is asymmetric. A pass is reached by its token and nothing else, so deleting the
 * documents makes every link already sent dead on arrival; publishing again mints new tokens
 * for everybody, because the reuse it does is reading the passes that are there, and there
 * will be none. Nobody gets their old link back.
 *
 * Which is exactly what it is for — a schedule published from the wrong draft, or a year
 * opened by mistake — and exactly why the screen has to say so before it happens.
 */

export interface UnpublishCost {
  /** Links that stop working. */
  passes: number
  /**
   * How many of those belong to somebody already checked in.
   *
   * The number that decides whether this is a correction or an accident: mid-Saturday, a
   * pass is what a youth at a shop door is reading to find out where they are and who to
   * ring, and taking it away leaves them with a dead link and a phone.
   */
  arrived: number
}

export function unpublishCost(
  passes: { personId: string }[],
  assignments: Assignment[],
): UnpublishCost {
  const holders = new Set(passes.map((p) => p.personId))
  const arrived = new Set(
    assignments
      .filter((a) => a.status !== 'swapped' && wasWorked(a) && holders.has(a.personId))
      .map((a) => a.personId),
  )
  return { passes: passes.length, arrived: arrived.size }
}

/**
 * What has to be said out loud before it happens, or nothing.
 *
 * Never a refusal. An organizer who has published the wrong thing needs a way back, and a
 * rule that decides for them would only be worked around by deleting passes by hand.
 */
export function unpublishCaution(cost: UnpublishCost): string | null {
  if (cost.passes === 0) return null
  if (cost.arrived === 0) return null
  return `${cost.arrived} ${
    cost.arrived === 1 ? 'volunteer has' : 'volunteers have'
  } already checked in and may be reading their pass right now.`
}
