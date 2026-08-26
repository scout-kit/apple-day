import type { ReactNode } from 'react'
import { THEME_LABEL } from '../domain/theme'
import { useTheme } from '../lib/theme'

/**
 * Light, dark, or whatever the device says.
 *
 * One button rather than three, because it is a preference somebody sets once and it should
 * not cost a menu. Drawn rather than an emoji, for the same reason as the bell: an emoji sun
 * is a different picture on every platform and cannot take the colour of the bar it sits in.
 *
 * Wherever somebody might want it, which turned out to include a volunteer's pass. That
 * page has no bar and no account, and the argument that it "follows their phone" was an
 * argument for giving them no say — the same say everybody else on the app has.
 */
export function ThemeButton(): ReactNode {
  const { theme, cycle } = useTheme()
  return (
    <button
      className="ghost tiny"
      onClick={cycle}
      // The state, not the action: a control that announces "switch to dark" while showing
      // a sun is a coin-flip as to which one it is telling you about.
      aria-label={`Theme: ${THEME_LABEL[theme].toLowerCase()}`}
      title={`Theme: ${THEME_LABEL[theme].toLowerCase()}`}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        {theme === 'dark' ? (
          <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
        ) : theme === 'light' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
          </>
        ) : (
          // Match device: half of each, which is what it is doing.
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none" />
          </>
        )}
      </svg>
    </button>
  )
}
