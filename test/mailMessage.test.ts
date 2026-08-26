import { describe, expect, it } from 'vitest'
import { encodeHeader, headerSafe, rfc2822, toBase64Url } from '../src/lib/mail/message'

/**
 * Turning a message into something a mail API will take.
 *
 * Two things go wrong here and both go wrong quietly: a header split across lines, which is
 * how a stray `Bcc:` gets added to somebody else's mail, and a name with an accent in it,
 * which arrives as mojibake or not at all.
 */

const decodeBody = (raw: string): string => {
  const body = raw.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n/g, '')
  return new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)))
}

const headerLine = (raw: string, name: string): string =>
  raw.split('\r\n\r\n')[0]!.split('\r\n').find((l) => l.startsWith(`${name}: `))!

describe('keeping a header on one line', () => {
  it('strips a newline out of a value', () => {
    /*
      A mail header ends at a newline, so a subject containing one stops being a subject and
      starts being whatever comes after it. Nothing here builds a subject from what a
      volunteer types, but it is built from an event name and a location name — both typed
      into a box by somebody — and "nobody would" is not a control.
    */
    expect(headerSafe('Your shift\r\nBcc: someone@else.org')).toBe(
      'Your shift Bcc: someone@else.org',
    )
    expect(headerSafe('Your shift\nBcc: x@y.org')).toBe('Your shift Bcc: x@y.org')
  })

  it('leaves an injected header with nowhere to go', () => {
    const raw = rfc2822({
      to: 'ada@example.org',
      subject: 'Shift\r\nBcc: sneaky@example.org',
      body: 'Hello',
    })
    const headers = raw.split('\r\n\r\n')[0]!.split('\r\n')
    expect(headers.some((l) => l.startsWith('Bcc:'))).toBe(false)
  })

  it('strips a newline out of the address too', () => {
    const raw = rfc2822({ to: 'ada@example.org\r\nBcc: x@y.org', subject: 'S', body: 'B' })
    expect(raw.split('\r\n\r\n')[0]!.split('\r\n').some((l) => l.startsWith('Bcc:'))).toBe(false)
  })
})

describe('a header that is not plain ASCII', () => {
  it('is left alone when it does not need encoding', () => {
    // An encoded header is unreadable in the raw; there is no reason to make every one so.
    expect(encodeHeader('Your shifts for Apple Day 2026')).toBe('Your shifts for Apple Day 2026')
  })

  it('is encoded when it has an accent in it', () => {
    const encoded = encodeHeader('Renée')
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/)
    expect(encoded).not.toContain('Renée')
  })

  it('is encoded when it has a dash the app actually uses', () => {
    // Every template joins with an em dash, so this is the common case, not an edge one.
    expect(encodeHeader('Saturday — 9:00 AM')).toMatch(/^=\?UTF-8\?B\?/)
  })
})

describe('the body', () => {
  it('survives a round trip', () => {
    const body = 'Hi Ada,\n\n  Saturday 9:00 AM — Braemar\n  Your page: https://x.org/p/tok'
    expect(decodeBody(rfc2822({ to: 'a@x.org', subject: 'S', body }))).toBe(body)
  })

  it('survives an accented name', () => {
    /*
      `btoa` throws outright on anything above code point 255, so a parent called Renée
      would have failed to send at all rather than arriving oddly.
    */
    const body = 'Hi Renée,\n\nÉlodie has a shift.'
    expect(decodeBody(rfc2822({ to: 'a@x.org', subject: 'S', body }))).toBe(body)
  })

  it('survives an emoji, which somebody will eventually put in a location name', () => {
    const body = 'Braemar 🍎'
    expect(decodeBody(rfc2822({ to: 'a@x.org', subject: 'S', body }))).toBe(body)
  })

  it('is wrapped, because a base64 line over 998 characters is not legal mail', () => {
    const raw = rfc2822({ to: 'a@x.org', subject: 'S', body: 'x'.repeat(5000) })
    const longest = Math.max(...raw.split('\r\n').map((l) => l.length))
    expect(longest).toBeLessThanOrEqual(76)
  })

  it('is announced as base64 UTF-8, so a client knows how to read it', () => {
    const raw = rfc2822({ to: 'a@x.org', subject: 'S', body: 'B' })
    expect(headerLine(raw, 'Content-Type')).toContain('charset="UTF-8"')
    expect(headerLine(raw, 'Content-Transfer-Encoding')).toBe('Content-Transfer-Encoding: base64')
  })
})

describe('the url-safe encoding Gmail wants', () => {
  it('uses the url alphabet and drops the padding', () => {
    const encoded = toBase64Url('To: a@x.org\r\n\r\n???>>>')
    expect(encoded).not.toMatch(/[+/=]/)
  })

  it('round-trips back to the same bytes', () => {
    const raw = rfc2822({ to: 'a@x.org', subject: 'Renée', body: 'Héllo 🍎' })
    const url = toBase64Url(raw)
    const padded = url.replace(/-/g, '+').replace(/_/g, '/')
    const back = new TextDecoder().decode(
      Uint8Array.from(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)), (c) =>
        c.charCodeAt(0),
      ),
    )
    expect(back).toBe(raw)
  })
})
