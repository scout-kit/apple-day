import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Location, Person } from '../domain/types'
import { fullName } from '../domain/types'
import { LocationPicker } from './LocationPicker'
import { PersonPicker } from './PersonPicker'

/**
 * A form field that opens a type-to-search picker.
 *
 * The point of it is uniformity. Choosing a youth on the schedule board was a typeahead,
 * while choosing the same youth to record a jar against was a native dropdown of a hundred
 * names — the same decision made two different ways on two screens, one of them badly.
 * These wrappers make the picker as cheap to reach for as a `<select>` was.
 */

function Trigger({
  label,
  empty,
  onOpen,
  disabled,
  ariaLabel,
}: {
  label: string | null
  empty: string
  onOpen: (anchor: DOMRect) => void
  disabled?: boolean
  ariaLabel: string
}): ReactNode {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <button
      ref={ref}
      type="button"
      className="picker-field"
      aria-label={ariaLabel}
      disabled={disabled ?? false}
      onClick={() => {
        const rect = ref.current?.getBoundingClientRect()
        if (rect) onOpen(rect)
      }}
    >
      <span className={label ? '' : 'muted'}>{label ?? empty}</span>
      <span className="muted" aria-hidden="true">
        ▾
      </span>
    </button>
  )
}

export function PersonField({
  people,
  value,
  onChange,
  label,
  empty = 'Choose…',
  allowNone = false,
}: {
  people: Person[]
  value: string
  onChange: (personId: string) => void
  /** What this field is for, read out to anybody who cannot see it. */
  label: string
  empty?: string
  /** Offer a way back to no choice at all, for an optional field. */
  allowNone?: boolean
}): ReactNode {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const chosen = people.find((p) => p.id === value) ?? null

  return (
    <>
      <div className="row" style={{ gap: '0.25rem' }}>
        <Trigger
          ariaLabel={label}
          label={chosen ? fullName(chosen) : null}
          empty={empty}
          onOpen={setAnchor}
        />
        {allowNone && value !== '' && (
          <button className="tiny" onClick={() => onChange('')} aria-label={`Clear ${label}`}>
            Clear
          </button>
        )}
      </div>
      {anchor && (
        <PersonPicker
          anchor={anchor}
          title={label}
          groups={[{ label: 'Everyone', people }]}
          onPick={(id) => {
            onChange(id)
            setAnchor(null)
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  )
}

export function LocationField({
  locations,
  value,
  onChange,
  label,
  empty = 'Choose…',
}: {
  locations: Location[]
  value: string
  onChange: (locationId: string) => void
  label: string
  empty?: string
}): ReactNode {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const chosen = locations.find((l) => l.id === value) ?? null

  return (
    <>
      <Trigger
        ariaLabel={label}
        label={chosen?.name ?? null}
        empty={empty}
        onOpen={setAnchor}
      />
      {anchor && (
        <LocationPicker
          anchor={anchor}
          title={label}
          locations={locations}
          onPick={(id) => {
            onChange(id)
            setAnchor(null)
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  )
}
