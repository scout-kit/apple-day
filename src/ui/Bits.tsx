import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { areaOf, areaTone } from '../domain/areas'
import { useSections } from '../lib/sections'
import type { Section } from '../domain/types'
import type { IssueSeverity, ScheduleIssue } from '../domain/validation'

/** Small shared pieces, kept together rather than one file each. */

/**
 * The area a shop is in, marked so two of them read as one place.
 *
 * A stripe and the code, in every list that names shops: the schedule board, the year's
 * locations, the library. One piece rather than three, because the colour is the whole point
 * — two rows carrying the same one are the same plaza — and three copies of it is three
 * chances for one list to disagree with another about which colour that is.
 *
 * Nothing at all for a shop on its own. Most of a fresh library has no area, and a mark on
 * every row would say they were all together.
 */
export function AreaMark({ code, label = false }: { code: string; label?: boolean }): ReactNode {
  const area = areaOf({ groupCode: code })
  if (!area) return null

  return (
    <>
      <span
        className={`area-mark tone-${areaTone(area)}`}
        title={`In ${area} — anybody paired here can stand at any shop in it`}
      />
      {label && <span className="small muted">{area}</span>}
    </>
  )
}

/**
 * Copy something, and say that it happened.
 *
 * A button that does its work invisibly reads as a button that did nothing, so people press
 * it again and paste it twice — or give up and select the text by hand, which is the thing
 * the button existed to avoid. What it copies here is mostly links that are the whole of
 * somebody's access, so "did that work" is a question worth answering.
 *
 * One component rather than the same three lines everywhere, because the interesting parts
 * are easy to leave out: resetting afterwards, and saying so when the browser refuses.
 * Clipboard access needs a secure context, so a phone opening the dev server over a LAN
 * address has none — and being told is much better than a button that shrugs.
 */
export function CopyButton({
  text,
  label = 'Copy',
  className = 'tiny',
}: {
  text: string
  label?: string
  className?: string
}): ReactNode {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Back to normal after a moment, and never against a button that has since gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const settle = (result: 'done' | 'failed'): void => {
    setState(result)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }

  const copy = (): void => {
    /*
      The old way, kept as a fallback rather than for old browsers.

      `navigator.clipboard` is absent outside a secure context, which is not an exotic case:
      it is what happens when somebody opens the dev server on their phone by IP address.
      A hidden textarea and `execCommand` still work there.
    */
    const theHardWay = (): boolean => {
      const field = document.createElement('textarea')
      field.value = text
      field.setAttribute('readonly', '')
      field.style.position = 'fixed'
      field.style.opacity = '0'
      document.body.appendChild(field)

      /*
        Taken back out whatever happens. It is a real textarea in the document, so one left
        behind is a stray focus target on every screen that has a copy button — and the way
        it gets left behind is `execCommand` throwing rather than returning false.
      */
      try {
        field.select()
        return document.execCommand('copy')
      } catch {
        return false
      } finally {
        field.remove()
      }
    }

    if (navigator.clipboard?.writeText) {
      void navigator.clipboard
        .writeText(text)
        .then(() => settle('done'))
        .catch(() => settle(theHardWay() ? 'done' : 'failed'))
      return
    }
    settle(theHardWay() ? 'done' : 'failed')
  }

  return (
    <button
      className={className}
      onClick={copy}
      /*
        Announced, not just recoloured. The label changing is the confirmation for anybody
        looking at it; a live region is the confirmation for anybody who is not.
      */
      aria-live="polite"
      title={state === 'failed' ? 'Select the text and copy it by hand' : undefined}
    >
      {state === 'done' ? 'Copied' : state === 'failed' ? 'Could not copy' : label}
    </button>
  )
}

export function Money({ value }: { value: number | null }): ReactNode {
  if (value === null) {
    // Deliberately not "$0.00" — the whole point of the null is that there is no ratio.
    return <span className="muted">—</span>
  }
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {value.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })}
    </span>
  )
}

export function Hours({ value }: { value: number }): ReactNode {
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {value % 1 === 0 ? value : value.toFixed(1)}
    </span>
  )
}

/**
 * A section's name in its own colour.
 *
 * Both come from configuration, so renaming a section or recolouring it is a settings
 * change. An id with no definition still renders — under its own name, in grey — because a
 * person recorded in a since-deleted section should not become invisible.
 */
export function SectionPill({ section }: { section: Section }): ReactNode {
  const { lookup } = useSections()
  const def = lookup(section)
  return <span className={`pill tone-${def.tone}`}>{def.name}</span>
}

export function Loading({ what = 'Loading' }: { what?: string }): ReactNode {
  return <p className="muted">{what}…</p>
}

export function Empty({ children }: { children: ReactNode }): ReactNode {
  return <p className="muted">{children}</p>
}

export function ErrorNote({ error }: { error: Error | null }): ReactNode {
  if (!error) return null
  return (
    <div className="note error">
      {error.message}
      {/* A permission error almost always means "signed in, but not an organizer". */}
      {error.message.includes('permission') && (
        <div className="small">Ask an organizer to add your account.</div>
      )}
    </div>
  )
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: 'good' | 'bad' | 'warn'
}): ReactNode {
  const color = tone ? `var(--${tone})` : undefined
  return (
    <div className="stat">
      <div className="value" style={color ? { color } : undefined}>{value}</div>
      <div className="label">{label}</div>
    </div>
  )
}

/**
 * The schedule board's validation banner.
 *
 * Grouped by severity and collapsed by default — during a working session there can be
 * dozens of unstaffed-slot warnings, and a wall of text gets ignored, which defeats the
 * purpose. Errors are always shown.
 */
export function IssueBanner({
  issues,
  onSelect,
}: {
  issues: ScheduleIssue[]
  onSelect?: (issue: ScheduleIssue) => void
}): ReactNode {
  /*
    Nothing at all when there is nothing wrong.

    "No conflicts." is a permanent green bar reporting the ordinary case, at the top of the
    screen with the least room to spare. The board itself is the evidence that it is fine; a
    banner is only worth its space when it has something to say.
  */
  if (issues.length === 0) return null

  const groups: [IssueSeverity, string][] = [
    ['error', 'must fix'],
    ['warning', 'worth a look'],
    ['info', 'notes'],
  ]

  return (
    <>
      {groups.map(([severity, caption]) => {
        const group = issues.filter((i) => i.severity === severity)
        if (group.length === 0) return null

        const body = (
          // Bounded and scrollable: on a screen that fills the viewport nothing outside the
          // table can grow, so an expanded list of fifty warnings would otherwise run off
          // the bottom with no way to reach the rest of it.
          <ul className="issue-list">
            {group.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>
                {onSelect ? (
                  <button
                    className="ghost tiny"
                    style={{ textAlign: 'left', border: 0, padding: 0, color: 'inherit' }}
                    onClick={() => onSelect(issue)}
                  >
                    {issue.message}
                  </button>
                ) : (
                  issue.message
                )}
              </li>
            ))}
          </ul>
        )

        return (
          <div className={`note ${severity}`} key={severity}>
            {severity === 'error' ? (
              <>
                <strong>{group.length} {caption}</strong>
                {body}
              </>
            ) : (
              <details>
                <summary>
                  <strong>{group.length} {caption}</strong>
                </summary>
                {body}
              </details>
            )}
          </div>
        )
      })}
    </>
  )
}

/**
 * A change as a signed percentage, with the sign carrying the meaning.
 *
 * Here rather than on the history screen because the location page reads the same figures:
 * two copies of "what colour is a fall in takings" is one copy too many.
 */
export function Change({ value }: { value: number | null }): ReactNode {
  if (value === null) return <span className="muted">—</span>
  const pct = Math.round(value * 100)
  if (pct === 0) return <span className="muted">level</span>
  return (
    <span style={{ color: pct > 0 ? 'var(--good)' : 'var(--bad)' }}>
      {pct > 0 ? '+' : ''}
      {pct}%
    </span>
  )
}

