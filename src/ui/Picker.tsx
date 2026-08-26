import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NO_MATCH, rankMatch } from '../domain/search'
import { createPortal } from 'react-dom'
/**
 * A type-to-search picker for choosing one thing out of many.
 *
 * Replaces a native `<select>` holding every youth in the group, or every location in the
 * library. With ninety names that list is a scroll-and-squint exercise, and the useful
 * information — who actually said they could work this hour — was buried in an optgroup
 * halfway down it. The same is true of locations once there are twenty of them.
 *
 * Rendered through a portal because the schedule board is a scroll container: an absolutely
 * positioned panel inside a cell gets clipped at the container's edge. Positioned from the
 * trigger's rect, and closed on scroll rather than chased, since a panel that drifts away
 * from its cell is worse than one that closes.
 *
 * Knows nothing about people or locations: a caller hands it options with a label and
 * whatever else is worth searching on, and gets back an id.
 */

export interface PickerOption {
  id: string
  label: string
  /** A short tag beside the label — a section, a group code. */
  tag?: string
  /** Its colour class, when the tag has one. */
  tone?: string
  /** A second line, and part of what typing searches. */
  note?: string
  /**
   * Searched but never shown.
   *
   * For a detail worth finding a row by that would only repeat what is already on it — a
   * shop's address, where the street is in the name already. Typing "640" still finds it;
   * the row does not say "640" twice.
   */
  search?: string
}

export interface PickerGroup {
  label: string
  options: PickerOption[]
  /** Shown alongside each option in this group. */
  hint?: string
}

export interface PickerProps {
  /** Where the panel is anchored — usually the button that opened it. */
  anchor: DOMRect
  title: string
  groups: PickerGroup[]
  onPick: (id: string) => void
  onClose: () => void
  /** What this is a list of, for the placeholder and the empty message. */
  noun?: string
  /** Shown when a search matches nothing. */
  noMatch?: (query: string) => string
  /** Shown when there is nothing to choose from at all. */
  emptyNote?: string
  /** How wide the panel should be. Defaults to enough for a name and a tag. */
  width?: number
}

interface Candidate {
  option: PickerOption
  groupLabel: string
  hint?: string
}

/*
   Wide enough for a name and a section, which is what most of these hold. A list whose rows
   carry more than that asks for its own — see `LocationPicker`, where every row is a shop, a
   group code and a street address.
*/
const PANEL_WIDTH = 288
const MAX_HEIGHT = 320

/*
  Matching and ordering both come from `domain/search`, so every list in the app agrees on
  what "best match" means — and so the ranking can be tested without a browser.
*/
const scoreOf = (option: PickerOption, query: string): number =>
  rankMatch(
    {
      label: option.label,
      tag: option.tag,
      // Whatever is only searchable ranks with the rest of the fine print.
      note: [option.note, option.search].filter(Boolean).join(' ') || undefined,
    },
    query,
  )

export function Picker({
  anchor,
  title,
  groups,
  onPick,
  onClose,
  noun = 'options',
  noMatch = (query) => `Nothing matches “${query}”.`,
  emptyNote,
  width = PANEL_WIDTH,
}: PickerProps): ReactNode {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  /** Flattened, because arrow keys move through one sequence regardless of grouping. */
  const candidates = useMemo((): Candidate[] => {
    const out: (Candidate & { score: number; order: number })[] = []
    let order = 0

    for (const group of groups) {
      for (const option of group.options) {
        const score = scoreOf(option, query)
        if (score === NO_MATCH) continue
        out.push({
          option,
          groupLabel: group.label,
          ...(group.hint === undefined ? {} : { hint: group.hint }),
          score,
          order: order++,
        })
      }
    }

    /*
      Best match first, and only while there is something typed.

      With the box empty the given order is the meaningful one — the year's shops in the
      order they are worked, people by section — and re-sorting that would be re-sorting
      nothing by nothing. Ties keep the order they came in.
    */
    if (query.trim()) out.sort((a, b) => a.score - b.score || a.order - b.order)
    return out
  }, [groups, query])

  // A stale highlight would pick the wrong person after typing.
  useEffect(() => setActive(0), [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /**
   * Close when the page behind moves, because the panel is anchored to a cell that
   * scrolls away — but not when the scrolling is the panel's own list.
   *
   * The listener has to be in the capture phase, since scroll events do not bubble and the
   * board is a nested scroll container. Capture also means it sees scrolls from *inside*
   * the picker, so an unfiltered handler closed the panel the moment you scrolled its list
   * or moved the highlight far enough for `scrollIntoView` to fire.
   */
  useEffect(() => {
    const onScroll = (event: Event): void => {
      // A page scroll targets `window`, which is not a Node — passing it to `contains`
      // throws, and a handler that throws never gets as far as closing.
      const target = event.target
      if (target instanceof Node && panelRef.current?.contains(target)) return
      onClose()
    }
    const onResize = (): void => onClose()

    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [onClose])

  useLayoutEffect(() => {
    const option = listRef.current?.querySelector('[data-active="true"]')
    // Optional call: keeping the highlight in view is a nicety, and not every environment
    // implements it (jsdom does not). It must never be able to break the picker.
    option?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const choose = (index: number): void => {
    const candidate = candidates[index]
    if (candidate) onPick(candidate.option.id)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => Math.min(candidates.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(active)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  // Flip above the anchor when there is no room below it.
  const spaceBelow = window.innerHeight - anchor.bottom
  const openUpwards = spaceBelow < MAX_HEIGHT && anchor.top > spaceBelow
  // Never wider than the screen it has to sit on, whatever the caller asked for.
  const panelWidth = Math.min(width, window.innerWidth - 16)
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - panelWidth - 8))

  let lastGroup: string | null = null

  return createPortal(
    <>
      {/* Clicking anywhere else dismisses it. */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 60 }}
        onMouseDown={onClose}
        role="presentation"
      />
      <div
        ref={panelRef}
        className="picker"
        role="dialog"
        aria-label={title}
        style={{
          position: 'fixed',
          zIndex: 61,
          left,
          width: panelWidth,
          ...(openUpwards
            ? { bottom: window.innerHeight - anchor.top + 4 }
            : { top: anchor.bottom + 4 }),
        }}
      >
        <div className="picker-head">
          <div className="small muted">{title}</div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={`Type to search ${noun}…`}
            aria-label={`Search ${noun} for ${title}`}
            role="combobox"
            aria-expanded
            aria-controls="picker-list"
          />
        </div>

        <div className="picker-list" id="picker-list" role="listbox" ref={listRef}>
          {candidates.length === 0 ? (
            <div className="picker-empty small muted">
              {query ? noMatch(query) : (emptyNote ?? `No ${noun} left to choose.`)}
            </div>
          ) : (
            candidates.map((candidate, index) => {
              const newGroup = candidate.groupLabel !== lastGroup
              lastGroup = candidate.groupLabel
              return (
                <div key={candidate.option.id}>
                  {newGroup && <div className="picker-group">{candidate.groupLabel}</div>}
                  <button
                    role="option"
                    aria-selected={index === active}
                    data-active={index === active}
                    className="picker-option"
                    // mousedown, so the backdrop's own handler cannot close first.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      onPick(candidate.option.id)
                    }}
                    onMouseEnter={() => setActive(index)}
                  >
                    <span className="picker-name">{candidate.option.label}</span>
                    {candidate.option.tag && (
                      <span className={`pill ${candidate.option.tone ?? ''}`}>
                        {candidate.option.tag}
                      </span>
                    )}
                    {candidate.option.note && (
                      <span className="picker-hint small muted">{candidate.option.note}</span>
                    )}
                    {candidate.hint && (
                      <span className="picker-hint small muted">{candidate.hint}</span>
                    )}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="picker-foot small muted">
          {candidates.length} match{candidates.length === 1 ? '' : 'es'} · ↑↓ to move ·
          enter to choose · esc to close
        </div>
      </div>
    </>,
    document.body,
  )
}
