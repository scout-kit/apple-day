import type { SendChannel } from '../reminders'

/**
 * What sending needs to know, and where the links point.
 *
 * All public. A browser OAuth client id is not a secret — the consent screen and the origin
 * allowlist are what protect the account — and the origin is on every link the app makes.
 */

export const GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) ?? ''


/**
 * Where a volunteer's personal link should point.
 *
 * Configured rather than read from the page, so testing against the emulator cannot mail
 * out `localhost` links. The fallback keeps a deployed app working unconfigured.
 */
export function publicOrigin(): string {
  const configured = (import.meta.env.VITE_PUBLIC_ORIGIN as string | undefined)?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  return typeof window === 'undefined' ? '' : window.location.origin
}

/** Whether a link built from this origin is safe to put in an email. */
export function originLooksPublic(origin: string): boolean {
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|$|\/)/i.test(origin)
}

/** Whether a way of sending has been set up. Exporting a file needs nothing, so always. */
export function channelConfigured(channel: SendChannel): boolean {
  return channel === 'csv' || GOOGLE_CLIENT_ID !== ''
}

/** Which variable is missing, so the message can name it rather than gesture at it. */
export function missingSetting(channel: SendChannel): string {
  return channel === 'gmail' ? 'VITE_GOOGLE_CLIENT_ID' : ''
}
