import { describe, expect, it } from 'vitest'
import {
  isThemeChoice,
  nextTheme,
  resolveTheme,
  themeAttribute,
} from '../src/domain/theme'

/**
 * Choosing light or dark, or leaving it to the device.
 *
 * Three states rather than a toggle: a two-way switch has to start somewhere, and either
 * starting point is wrong for half the people who open it.
 */

describe('cycling through the choices', () => {
  it('goes system, light, dark, and back', () => {
    expect(nextTheme('system')).toBe('light')
    expect(nextTheme('light')).toBe('dark')
    expect(nextTheme('dark')).toBe('system')
  })

  it('returns to where it started after three presses', () => {
    expect(nextTheme(nextTheme(nextTheme('system')))).toBe('system')
  })
})

describe('what actually gets painted', () => {
  it('follows the device when nothing has been chosen', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('overrides the device once somebody has chosen', () => {
    // The point of the control: a phone set to dark, held up in the sun.
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('what goes on the root element', () => {
  it('stamps nothing for "match device"', () => {
    /*
      The stylesheet already answers the device through `prefers-color-scheme`. Stamping the
      resolved value would duplicate that answer and then stop following it when somebody
      changes the setting with the app open.
    */
    expect(themeAttribute('system')).toBeNull()
  })

  it('stamps the choice, so it beats the media query', () => {
    expect(themeAttribute('light')).toBe('light')
    expect(themeAttribute('dark')).toBe('dark')
  })
})

describe('reading back what was stored', () => {
  it('accepts the three it knows', () => {
    expect(isThemeChoice('system')).toBe(true)
    expect(isThemeChoice('dark')).toBe(true)
  })

  it('rejects anything else, so a stale value cannot wedge the app', () => {
    for (const junk of ['', 'blue', null, undefined, 1, {}]) {
      expect(isThemeChoice(junk), String(junk)).toBe(false)
    }
  })
})
