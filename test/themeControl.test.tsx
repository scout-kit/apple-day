// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider, useTheme } from '../src/lib/theme'

/**
 * Remembering the choice, and letting it beat the device.
 *
 * The stylesheet already followed `prefers-color-scheme`, so dark worked on a dark phone.
 * What it could not do was go the other way: a phone set to dark, held up outside a shop in
 * the sun, with no way to ask for a light screen.
 */

function Probe(): React.ReactElement {
  const { theme, cycle } = useTheme()
  return (
    <button onClick={cycle} data-testid="t">
      {theme}
    </button>
  )
}

/** Everything a real page has: the provider at the root, the control somewhere inside. */
const withTheme = (children: React.ReactNode): React.ReactElement => (
  <ThemeProvider>{children}</ThemeProvider>
)

const root = (): HTMLElement => document.documentElement
const press = (): void => {
  act(() => {
    screen.getByTestId('t').click()
  })
}

beforeEach(() => {
  window.localStorage.clear()
  root().removeAttribute('data-theme')
})

afterEach(() => {
  window.localStorage.clear()
})

describe('choosing a theme', () => {
  it('starts by following the device', () => {
    render(withTheme(<Probe />))
    expect(screen.getByTestId('t').textContent).toBe('system')
    // Nothing stamped: the stylesheet's media query is the answer, and stays the answer if
    // the device setting changes while this is open.
    expect(root().hasAttribute('data-theme')).toBe(false)
  })

  it('stamps the root once a choice is made, so it beats the media query', () => {
    render(withTheme(<Probe />))
    press()
    expect(root().getAttribute('data-theme')).toBe('light')
    press()
    expect(root().getAttribute('data-theme')).toBe('dark')
  })

  it('goes back to following the device, and stops stamping', () => {
    render(withTheme(<Probe />))
    press()
    press()
    press()
    expect(screen.getByTestId('t').textContent).toBe('system')
    expect(root().hasAttribute('data-theme')).toBe(false)
  })

  it('is still there next time', () => {
    const first = render(withTheme(<Probe />))
    press()
    press()
    first.unmount()

    render(withTheme(<Probe />))
    expect(screen.getByTestId('t').textContent).toBe('dark')
    expect(root().getAttribute('data-theme')).toBe('dark')
  })

  it('ignores a stored value it does not recognise', () => {
    // An older build, or somebody editing storage. Following the device beats wedging.
    window.localStorage.setItem('apple-day:theme', 'chartreuse')
    render(withTheme(<Probe />))
    expect(screen.getByTestId('t').textContent).toBe('system')
  })
})

/**
 * Where the choice has to reach.
 *
 * Reported from the running app: the app dark, and a volunteer's schedule page white. The
 * effect lived in the bar beside the button, so it only ran on screens that had a bar —
 * and a pass has none.
 */
describe('a page with no bar on it', () => {
  it('is painted by the choice even with no control rendered', () => {
    window.localStorage.setItem('apple-day:theme', 'dark')
    render(withTheme(<p>Somebody&rsquo;s shifts</p>))
    expect(root().getAttribute('data-theme')).toBe('dark')
  })

  it('is applied above the router, so every route gets it', () => {
    /*
      Structural, because the alternative is rendering the whole app to prove a wrapper is
      in the right place. The pass route is a sibling of the shell, not a child of it.
    */
    const main = readFileSync('src/main.tsx', 'utf8')
    expect(main.indexOf('<ThemeProvider>')).toBeLessThan(main.indexOf('<BrowserRouter'))
  })
})

describe('the stylesheet backs it up', () => {
  it('paints a chosen dark, not only a device-preferred one', () => {
    /*
      The dark tokens used to exist only inside `@media (prefers-color-scheme: dark)`. A
      preference the app holds cannot override a media query, so without a selector of its
      own the button would set an attribute that changed nothing.
    */
    const css = readFileSync('src/styles.css', 'utf8')
    expect(css).toContain(':root[data-theme="dark"]')
    // After the media block, so the explicit choice wins.
    expect(css.indexOf(':root[data-theme="dark"]')).toBeGreaterThan(
      css.indexOf('prefers-color-scheme: dark'),
    )
  })

  it('keeps a chosen light out of the device-dark block', () => {
    const css = readFileSync('src/styles.css', 'utf8')
    expect(css).toContain(':root:not([data-theme="light"])')
  })
})

/**
 * Every page somebody can be looking at, including the ones with no bar.
 *
 * Reported twice: first that a volunteer's schedule ignored the choice, then that there was
 * no way to make one there. Following the phone is a fine default and a poor answer to
 * "I want this light" — a volunteer standing in the sun has exactly the same want as the
 * organizer standing beside them.
 */
describe('where the control appears', () => {
  it('is on a volunteer pass, which has no bar to hang it off', () => {
    const pass = readFileSync('src/ui/PassPage.tsx', 'utf8')
    expect(pass).toContain('<ThemeButton />')
  })

  it('is on the dead-link page too, because that is a page to be stuck on', () => {
    const pass = readFileSync('src/ui/PassPage.tsx', 'utf8')
    // Twice: once beside the name, once above "this link is not valid".
    expect(pass.split('<ThemeButton />').length - 1).toBe(2)
  })

  it('is one component, so the bar and the pass cannot drift apart', () => {
    const button = readFileSync('src/ui/ThemeButton.tsx', 'utf8')
    expect(button).toContain('export function ThemeButton')
    expect(readFileSync('src/App.tsx', 'utf8')).toContain("from './ui/ThemeButton'")
  })

  it('has somewhere to sit, on the right of what it governs', () => {
    // `.row.between` is what pushes it there; without the rule it just trails the heading.
    const css = readFileSync('src/styles.css', 'utf8')
    expect(css).toContain('.row.between')
    expect(css).toContain('.row.end')
  })
})
