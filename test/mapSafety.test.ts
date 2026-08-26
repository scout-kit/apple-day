import { describe, expect, it } from 'vitest'
import { mapLink, safeMapUrl } from '../src/domain/maps'

/**
 * A pasted map link ends up in an `href` on a volunteer's phone.
 *
 * Almost every location has only an address, and the link is derived from it — always
 * https, always safe. The override exists for the handful of library entries whose real
 * link points at a specific entrance. It is a free-text field, it is now editable by
 * anybody running the event rather than by an admin, and it reaches people who have no
 * account at all, on a page they open from a QR code.
 */

describe('a link that is safe to put in an href', () => {
  it('keeps an ordinary https link', () => {
    const url = 'https://maps.google.com/?q=Braemar+Aldergrove'
    expect(safeMapUrl(url)).toBe(url)
  })

  it('refuses a javascript: URL', () => {
    // React logs a warning about these and renders them anyway, so the warning is not a
    // defence. This is the one that matters: it runs when the link is tapped.
    expect(safeMapUrl('javascript:alert(1)')).toBe('')
  })

  it('refuses the ways a prefix check would be fooled', () => {
    for (const attempt of [
      ' javascript:alert(1)',
      'jAvAsCrIpT:alert(1)',
      '\tjavascript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
    ]) {
      expect(safeMapUrl(attempt), attempt).toBe('')
    }
  })

  it('keeps an odd-looking link that is genuinely https', () => {
    /*
      `HTTPS:evil` parses to `https://evil/` — the scheme is normalised, so this is a real
      https navigation to a strange host rather than anything that executes. Refusing it
      would be the check straying from what it is for: this guards the `href` against code,
      not organizers against typing a bad address.
    */
    expect(safeMapUrl('HTTPS:evil')).toBe('HTTPS:evil')
  })

  it('refuses plain http', () => {
    // An allowlist of one is a smaller thing to get wrong than a denylist.
    expect(safeMapUrl('http://maps.google.com/?q=x')).toBe('')
  })

  it('refuses something that is not a URL at all', () => {
    // Half-typed, or an address pasted into the wrong box.
    expect(safeMapUrl('maps.google.com')).toBe('')
    expect(safeMapUrl('123 Market St W')).toBe('')
    expect(safeMapUrl('')).toBe('')
  })
})

describe('the link a place actually gets', () => {
  it('prefers a usable override', () => {
    expect(mapLink({ address: '123 Market St W', mapsUrl: 'https://maps.example/x' })).toBe(
      'https://maps.example/x',
    )
  })

  it('falls back to the address when the override cannot be used', () => {
    /*
      Falling back rather than failing. A location whose override is unusable still has an
      address, and a working link to it is better than none — the person holding the pass
      is standing in a car park trying to find a shop.
    */
    const link = mapLink({ address: '123 Market St W', mapsUrl: 'javascript:alert(1)' })
    expect(link).toMatch(/^https:\/\/www\.google\.com\/maps\/search/)
    expect(link).toContain('123%20Market%20St%20W')
  })

  it('has nothing to offer when there is neither', () => {
    expect(mapLink({ address: '', mapsUrl: 'javascript:alert(1)' })).toBe('')
  })
})
