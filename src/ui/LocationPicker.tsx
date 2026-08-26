import type { ReactNode } from 'react'
import type { Location } from '../domain/types'
import { Picker } from './Picker'

/**
 * Choose one location, by typing part of its name or address.
 *
 * The same control as the person picker, for the same reason: twenty shops in a native
 * dropdown is a scroll-and-squint exercise, and the thing that tells two Sobeys apart is the
 * address, which an `<option>` has nowhere to put. Searching covers the address and the
 * group code as well as the name, so "640" finds the Parkside one.
 *
 * A row is the shop and its group code, and no more. The address is searched but not shown:
 * these names carry their own street — "Sobeys - 640 Parkside Drive" — so printing the
 * address underneath says the same thing twice and pushes the name out of the panel.
 */

/** Room for a shop name, which is longer than a person's. */
const PANEL_WIDTH = 340

export function LocationPicker({
  anchor,
  title,
  locations,
  onPick,
  onClose,
  groupLabel = 'Locations',
}: {
  anchor: DOMRect
  title: string
  locations: Location[]
  onPick: (locationId: string) => void
  onClose: () => void
  groupLabel?: string
}): ReactNode {
  return (
    <Picker
      anchor={anchor}
      title={title}
      noun="locations"
      width={PANEL_WIDTH}
      onPick={onPick}
      onClose={onClose}
      groups={[
        {
          label: groupLabel,
          options: locations.map((location) => ({
            id: location.id,
            label: location.name,
            ...(location.groupCode ? { tag: location.groupCode } : {}),
            // Searched, not shown: typing "640" still finds the Parkside one.
            ...(location.address ? { search: location.address } : {}),
          })),
        },
      ]}
    />
  )
}
