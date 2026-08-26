import type { ReactNode } from 'react'
import { useSections } from '../lib/sections'
import type { Section } from '../domain/types'
import type { IssueSeverity, ScheduleIssue } from '../domain/validation'

/** Small shared pieces, kept together rather than one file each. */

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

    This used to say "No conflicts." — a permanent green bar reporting the ordinary case,
    at the top of the screen with the least room to spare. The board itself is the evidence
    that it is fine; a banner is only worth its space when it has something to say.
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

