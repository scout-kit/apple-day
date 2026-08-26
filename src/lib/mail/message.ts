import type { OutgoingMessage } from './index'

/** Turning a message into something a mail API will take. */

/**
 * Anything that could start a new header line, removed.
 *
 * A header ends at a newline, so a subject containing one becomes whatever comes next —
 * `Bcc:` included. Subjects are built from event and location names, which people type.
 */
export const headerSafe = (value: string): string =>
  value.replace(/[\r\n]+/g, ' ').trim()

/**
 * A header value encoded so it survives, per RFC 2047.
 *
 * Headers are ASCII, so an accent or an em dash arrives as mojibake without this. Left
 * alone when it is already plain, since the encoded form is unreadable in the raw.
 */
export function encodeHeader(value: string): string {
  const safe = headerSafe(value)
  return isPlainAscii(safe) ? safe : `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(safe))}?=`
}

/** Printable ASCII, which is all a header may carry unencoded. */
const isPlainAscii = (value: string): boolean => !/[^\x20-\x7E]/.test(value)

/** The message as a mail server expects it. */
export function rfc2822(message: OutgoingMessage): string {
  const headers = [
    `To: ${headerSafe(message.to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ]
  // The body too, not just the headers: a line over 998 characters is illegal, and a bare
  // `.` on its own line can truncate the message on some paths.
  const body = bytesToBase64(new TextEncoder().encode(message.body))
  return `${headers.join('\r\n')}\r\n\r\n${wrap(body)}`
}

/** Base64 with the URL alphabet and no padding, which is what the Gmail API wants. */
export function toBase64Url(raw: string): string {
  return bytesToBase64(new TextEncoder().encode(raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** `btoa` throws on code points above 255, so encode to UTF-8 bytes first. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  // Chunked, because spreading a large array into `fromCharCode` overflows the stack.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** Base64 bodies are wrapped at 76 characters, per the MIME spec. */
const wrap = (value: string): string => (value.match(/.{1,76}/g) ?? []).join('\r\n')
