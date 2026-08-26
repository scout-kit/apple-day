import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { isThemeChoice, nextTheme, themeAttribute } from '../domain/theme'
import type { ThemeChoice } from '../domain/theme'

/**
 * Remembering whether somebody wanted this light or dark.
 *
 * Per device, not per account: it is a property of the screen you are holding, and the one
 * organizer who runs the day from a phone in the sun and a laptop indoors wants different
 * answers on each. That also keeps it out of Firestore, which would be a read and a write
 * on every load for something the browser can hold for nothing.
 */
const STORED = 'apple-day:theme'

function readStored(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(STORED)
    return isThemeChoice(raw) ? raw : 'system'
  } catch {
    // Private browsing, or site data blocked. Following the device is the right default
    // anyway, so there is nothing to recover from.
    return 'system'
  }
}

interface Theme {
  theme: ThemeChoice
  cycle: () => void
}

const ThemeContext = createContext<Theme>({ theme: 'system', cycle: () => {} })

/**
 * Applied above the router, not inside the shell.
 *
 * It lived in the bar with the button, which meant it only ever ran on screens that had a
 * bar. A volunteer's pass has none — so an organizer who had chosen dark, then opened
 * somebody's schedule to check it, got a white page. The choice is a property of the
 * browser, not of the part of the app you happen to be looking at.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const [theme, setTheme] = useState<ThemeChoice>(readStored)

  useEffect(() => {
    const attribute = themeAttribute(theme)
    const root = document.documentElement
    /*
      Removed rather than set to "system": the stylesheet answers the device through
      `prefers-color-scheme`, and an attribute would shadow that — then keep shadowing it
      after somebody changed their phone's setting with this open.
    */
    if (attribute) root.setAttribute('data-theme', attribute)
    else root.removeAttribute('data-theme')

    try {
      window.localStorage.setItem(STORED, theme)
    } catch {
      /* Nothing to do; the choice simply lasts as long as the tab does. */
    }
  }, [theme])

  const cycle = useCallback(() => {
    setTheme((current) => nextTheme(current))
  }, [])

  const value = useMemo(() => ({ theme, cycle }), [theme, cycle])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
