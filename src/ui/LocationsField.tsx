import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ranked } from '../domain/search'
import type { Location } from '../domain/types'

/**
 * Choose any number of locations, or none for all of them.
 *
 * Different from the single picker beside it, and not just in how many it takes. That one
 * is a field being filled in — a jar's location, an event's base — where exactly one answer
 * is right. This one narrows a view, where the honest starting point is everything and
 * every choice after that is a subtraction.
 *
 * So an empty selection means every location rather than none, and the panel says so with a
 * row of its own. Without it there was no way back: pick a shop and the only thing offered
 * was a different shop, so "show me all of them again" meant reloading the page.
 *
 * Chips outside the panel rather than a count inside it, because which ones are picked is
 * the thing being read at a glance, and each needs its own way off.
 */
export function LocationsField({
  locations,
  value,
  onChange,
  label,
}: {
  locations: Location[]
  /** The chosen ids, in the order they were chosen. Empty means every location. */
  value: string[]
  onChange: (ids: string[]) => void
  label: string
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const field = useRef<HTMLDivElement>(null)

  /*
    Closed by a click outside it, rather than by a sheet laid over the page.

    A `position: fixed; inset: 0` backdrop is the easy way to catch that click, and it also
    catches every wheel and swipe — so opening the panel anywhere but the bottom of the page
    left the page frozen with most of the panel below the fold and no way to reach it.

    A listener costs nothing and blocks nothing. `mousedown` rather than `click` so it closes
    on the way down, before whatever was clicked acts on it.
  */
  useEffect(() => {
    if (!open) return

    const closeIfOutside = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && !field.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('touchstart', closeIfOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('touchstart', closeIfOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const chosen = useMemo(
    () => value.map((id) => locations.find((l) => l.id === id)).filter(Boolean) as Location[],
    [value, locations],
  )

  const options = useMemo(
    () =>
      ranked(
        locations.map((l) => ({
          id: l.id,
          label: l.name,
          tag: l.groupCode || undefined,
          // Searched, not shown: these names carry their own street already.
          note: l.address || undefined,
        })),
        query,
      ),
    [locations, query],
  )

  const toggle = (id: string): void => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  return (
    <div className="locations-field" ref={field}>
      {/*
        The panel hangs off the button alone.

        Everything else in this field grows: a chip per location picked, wrapping onto a
        second line once there are a few. Anchoring the panel to anything that contains them
        walks it further down the page with every location added, until it is off the bottom
        of the screen — which is precisely what it did.
      */}
      <div className="locations-anchor">
        <button
          type="button"
          className="picker-field"
          aria-label={label}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <span className={chosen.length > 0 ? '' : 'muted'}>
            {chosen.length === 0
              ? 'Every location'
              : chosen.length === 1
                ? chosen[0]!.name
                : `${chosen.length} locations`}
          </span>
          <span className="muted" aria-hidden="true">
            ▾
          </span>
        </button>

        {open && (
          <div className="picker locations-panel" role="dialog" aria-label={label}>
              <div className="picker-head">
                <input
                  type="search"
                  autoFocus
                  value={query}
                  placeholder="Search locations"
                  aria-label="Search locations"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="picker-list">
                {/*
                  Its own row at the top, and the way back. Reading as a choice rather than
                  as the absence of one is the point: an empty selection is what this screen
                  opens on, so it has to be somewhere you can get back to.
                */}
                <button
                  type="button"
                  className={`picker-option${value.length === 0 ? ' on' : ''}`}
                  onClick={() => {
                    onChange([])
                    setOpen(false)
                  }}
                >
                  <span className="picker-name">
                    <strong>Every location</strong>
                  </span>
                  {value.length === 0 && <span aria-hidden="true">✓</span>}
                </button>

                {options.map((option) => {
                  const picked = value.includes(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      className={`picker-option${picked ? ' on' : ''}`}
                      aria-pressed={picked}
                      onClick={() => toggle(option.id)}
                    >
                      <span className="picker-name">{option.label}</span>
                      {option.tag && <span className="pill small">{option.tag}</span>}
                      {picked && <span aria-hidden="true">✓</span>}
                    </button>
                  )
                })}

                {options.length === 0 && (
                  <p className="picker-empty muted small">Nothing matches that.</p>
                )}
              </div>

            <div className="picker-foot">
              <button type="button" className="tiny" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/*
        Below the button and outside its anchor, so adding one cannot move the panel. Each
        carries its own way off, and "Every location" sits beside them rather than being
        something to reach by unpicking one at a time.
      */}
      {chosen.length > 0 && (
        <div className="row chips" style={{ marginTop: '0.35rem' }}>
          {chosen.map((location) => (
            <button
              key={location.id}
              type="button"
              className="chip"
              aria-label={`Stop showing ${location.name}`}
              onClick={() => toggle(location.id)}
            >
              {location.name} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button type="button" className="tiny ghost" onClick={() => onChange([])}>
            Every location
          </button>
        </div>
      )}
    </div>
  )
}
