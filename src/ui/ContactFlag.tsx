import type { ReactNode } from 'react'
import { contactProblem } from '../domain/contact'
import type { Person } from '../domain/types'

/**
 * A quiet mark beside a name when there is no way to reach them.
 *
 * The roster says this loudly, in a banner, because that screen is where the gap gets
 * filled — one sentence covering everybody, before the day. On the day it is a different
 * question: you are checking people in at a table with a queue behind you, and what matters
 * is whether *this* one can be rung if they do not turn up. A banner cannot tell you that,
 * and a warning against every second name would be read once and then not at all.
 *
 * So: a small mark, and the reason on hover. `title` for the mouse, `aria-label` for
 * everything else — a glyph with no accessible name is furniture to a screen reader.
 *
 * The number itself is not on the table. It used to be, under the name, which put parents'
 * phone numbers on a screen that is open on a table all day in a shop doorway for the sake
 * of a call almost nobody makes. The name links to the person's page, and the number is
 * there. Only the absence is worth a place on the board.
 */
export function ContactFlag({
  person,
  scope = 'today',
}: {
  person: Person
  /** Where it is being shown — see `contactProblem`. */
  scope?: 'today' | 'signup'
}): ReactNode {
  const problem = contactProblem(person, scope)
  if (!problem) return null

  return (
    <span className="contact-flag" title={problem} aria-label={problem} role="img">
      !
    </span>
  )
}
