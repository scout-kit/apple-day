import type { ReactNode } from 'react'
import { fullName } from '../domain/types'
import type { Person } from '../domain/types'
import { Picker } from './Picker'

/**
 * Choose one person, by typing part of their name.
 *
 * A thin mapping onto {@link Picker}: people become options with their section as the tag,
 * so "ol cub" still finds Olivia in Cubs. Everything about panels, keyboards and scrolling
 * lives in the picker itself, which the location picker shares — one behaviour, so choosing
 * a youth and choosing a location work the same way wherever they appear.
 */

export interface PersonPickerGroup {
  label: string
  people: Person[]
  /** Shown alongside each name in this group. */
  hint?: string
}

export function PersonPicker({
  anchor,
  title,
  groups,
  onPick,
  onClose,
}: {
  anchor: DOMRect
  title: string
  groups: PersonPickerGroup[]
  onPick: (personId: string) => void
  onClose: () => void
}): ReactNode {
  return (
    <Picker
      anchor={anchor}
      title={title}
      noun="people"
      // People, not options: "Nobody matches" reads better than "Nothing matches" about a
      // list of children, and the board's empty case is a specific thing worth saying.
      noMatch={(query) => `Nobody matches “${query}”.`}
      emptyNote="Nobody left to add for this hour."
      onPick={onPick}
      onClose={onClose}
      groups={groups.map((group) => ({
        label: group.label,
        ...(group.hint === undefined ? {} : { hint: group.hint }),
        options: group.people.map((person) => ({
          id: person.id,
          label: fullName(person),
          tag: person.section,
          tone: person.section,
        })),
      }))}
    />
  )
}
