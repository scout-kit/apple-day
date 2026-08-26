import type { ReactNode } from 'react'
import { fullName } from '../domain/types'
import type { Person } from '../domain/types'
import { useEvent } from '../lib/eventContext'

/**
 * A person's name, as a way to get to their page.
 *
 * One component rather than an anchor written out at each site, because a name that is a
 * link on one screen and plain text on the next is worse than either: an organizer learns
 * that names are clickable, then finds the one place it is not — which was the state of
 * this app. Day-of and the notification cards linked; the roster, the board, the money
 * table and the counted jars did not.
 *
 * Falls back to plain text when there is nobody to link to, so a caller can hand it
 * whatever it has without checking first. That case is real: jars and assignments hold a
 * person id, and a person deleted from the event leaves rows behind that still name them.
 */
export function PersonLink({
  person,
  personId,
  fallback = '(unknown)',
  className = 'strong-link',
}: {
  person: Person | null | undefined
  /** Shown when the person is missing — usually the raw id, which is a clue to what broke. */
  personId?: string
  fallback?: string
  className?: string
}): ReactNode {
  const { pathFor } = useEvent()
  if (!person) return <>{personId || fallback}</>
  return (
    <a className={className} href={pathFor(`person/${person.id}`)}>
      {fullName(person)}
    </a>
  )
}
