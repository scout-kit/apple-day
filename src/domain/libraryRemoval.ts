/**
 * Taking a shop out of the library.
 *
 * The library is shared across every year, so a location is what three or four years of jars
 * and assignments hang off. Removing one that anything points at orphans all of it — a jar
 * with takings against a shop that no longer exists, a shift at nowhere — and unlike a wrong
 * address it is not something the person who did it will see.
 *
 * So it is not a question of warning hard enough. A shop nothing points at is a typo from
 * yesterday and can go; a shop with history cannot, and the honest answer is to say what is
 * holding it rather than to ask somebody to be sure.
 */

/** What still points at a shop, per year. */
export interface LocationUsage {
  eventId: string
  eventName: string
  shifts: number
  jars: number
  /** Whether that year has it in its own list of places to work. */
  inThatYear: boolean
}

/** Everything holding a shop, across every year. */
export function stillHolding(usage: LocationUsage[]): LocationUsage[] {
  return usage.filter((u) => u.shifts > 0 || u.jars > 0 || u.inThatYear)
}

/**
 * Why a shop cannot be removed, or null when it can.
 *
 * Named by year and by what is in it, because "it is in use" leaves somebody hunting. The
 * way out is the same either way — take it off that year's list, or leave it alone.
 */
export function removalProblem(usage: LocationUsage[]): string | null {
  const held = stillHolding(usage)
  if (held.length === 0) return null

  const where = held
    .map((u) => {
      const parts: string[] = []
      if (u.shifts > 0) parts.push(`${u.shifts} shift${u.shifts === 1 ? '' : 's'}`)
      if (u.jars > 0) parts.push(`${u.jars} jar${u.jars === 1 ? '' : 's'}`)
      if (parts.length === 0) parts.push('on its list of places')
      return `${u.eventName}: ${parts.join(', ')}`
    })
    .join(' · ')

  return `Still in use — ${where}. Removing it would leave those pointing at nothing.`
}

/** What a shop nothing points at is, said plainly before it goes. */
export function removalSummary(name: string): string {
  return `${name} is not used by any year, so nothing points at it.`
}
