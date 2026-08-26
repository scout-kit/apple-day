import type { ReactNode } from 'react'
import { useEvent } from '../lib/eventContext'

/**
 * A location's name, as a way to get to its page.
 *
 * The same reasoning as `PersonLink`, and the same shape: a name that is a link on one
 * screen and plain text on the next teaches somebody the wrong thing twice. Location names
 * were inert text in a dozen tables while every person's name had been clickable for weeks.
 */
export function LocationLink({
  name,
  locationId,
  className = 'strong-link',
}: {
  name: string
  locationId: string
  className?: string
}): ReactNode {
  const { pathFor } = useEvent()
  if (!locationId) return <>{name}</>
  return (
    <a className={className} href={pathFor(`location/${locationId}`)}>
      {name}
    </a>
  )
}
