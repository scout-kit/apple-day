/**
 * Light, dark, or whatever the device says.
 *
 * Three states rather than a toggle: a two-way switch has to start somewhere, and either
 * starting point is wrong for half the phones. The explicit two are for the person whose
 * device is set one way and who wants this screen the other.
 */
export type ThemeChoice = 'system' | 'light' | 'dark'

const THEME_CHOICES: ThemeChoice[] = ['system', 'light', 'dark']

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === 'string' && (THEME_CHOICES as string[]).includes(value)
}

/** What the next press gives you. System → light → dark → system. */
export function nextTheme(current: ThemeChoice): ThemeChoice {
  const at = THEME_CHOICES.indexOf(current)
  return THEME_CHOICES[(at + 1) % THEME_CHOICES.length]!
}

/** What is actually painted, once the device has had its say. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return prefersDark ? 'dark' : 'light'
  return choice
}

/**
 * What goes on the root element, or null to leave it alone.
 *
 * Nothing for `system`: the stylesheet already follows `prefers-color-scheme`, and a
 * stamped attribute would freeze that answer instead of tracking it.
 */
export function themeAttribute(choice: ThemeChoice): 'light' | 'dark' | null {
  return choice === 'system' ? null : choice
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'Match device',
  light: 'Light',
  dark: 'Dark',
}
