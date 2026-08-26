import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * What the browser is told about the page.
 *
 * A source-level check, because there is nowhere else to catch it: hosting headers are
 * config, they apply only once deployed, and a missing one fails silently and for ever.
 *
 * The app has one stored-content path that reaches an `href` — a location's pasted map
 * link, which is checked in `domain/maps` before it is rendered. This is the second line
 * behind that, and the only line for anything not thought of yet.
 */

const config = JSON.parse(readFileSync('firebase.json', 'utf8')) as {
  hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] }
}

/** The headers applied to every path. */
const everywhere = (): Record<string, string> => {
  const rule = config.hosting.headers.find((h) => h.source === '**')
  expect(rule, 'no header rule covering every path').toBeTruthy()
  return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]))
}

describe('the headers every page is served with', () => {
  it('sets a content security policy', () => {
    expect(everywhere()['Content-Security-Policy']).toBeTruthy()
  })

  it('allows no script the app did not ship', () => {
    // No 'unsafe-inline' and no 'unsafe-eval' on scripts: Vite emits hashed bundles and
    // nothing inline, so anything inline is not ours.
    const csp = everywhere()['Content-Security-Policy']!
    const scripts = csp.split('; ').find((d) => d.startsWith('script-src'))!
    expect(scripts).not.toContain('unsafe-inline')
    expect(scripts).not.toContain('unsafe-eval')
  })

  it('lets nobody frame it, and lets it load nothing by default', () => {
    const csp = everywhere()['Content-Security-Policy']!
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
  })

  it('can load what Firebase Auth needs to sign anybody in', () => {
    /*
      Found by reading the built bundle rather than by reasoning: the SDK loads
      `https://apis.google.com/js/api.js` for its hidden auth iframe, and `script-src
      'self'` would have blocked it. Sign-in is the front door of the whole app, so that is
      a total outage, and it would only have shown up once deployed.
    */
    const csp = everywhere()['Content-Security-Policy']!
    expect(csp).toMatch(/script-src[^;]*apis\.google\.com/)
    // The popup and the auth iframe are served from the project's own authDomain.
    expect(csp).toMatch(/frame-src[^;]*firebaseapp\.com/)
    expect(csp).toMatch(/frame-src[^;]*web\.app/)
    expect(csp).toMatch(/connect-src[^;]*identitytoolkit\.googleapis\.com/)
  })

  it('can load reCAPTCHA, which is what App Check runs on', () => {
    /*
      Missed once already, and the way it fails is instructive: the policy is written in
      firebase.json, the App Check client is written in TypeScript, and nothing connects them
      — so switching App Check on shipped a site whose own policy blocked the script it had
      just been told to load. It surfaces only against a deployed project, on somebody's first
      sign-in, as a console violation rather than an error the app can report.

      Path-scoped rather than whole-origin: `https://www.google.com` on script-src would let
      anything Google serves from that host run, and only /recaptcha/ is wanted.
    */
    const csp = everywhere()['Content-Security-Policy']!
    expect(csp).toMatch(/script-src[^;]*www\.google\.com\/recaptcha\//)
    expect(csp).toMatch(/script-src[^;]*www\.gstatic\.com\/recaptcha\//)
    // The challenge runs in an iframe on www.google.com, and the badge image is on gstatic.
    expect(csp).toMatch(/frame-src[^;]*www\.google\.com/)
    expect(csp).toMatch(/img-src[^;]*www\.gstatic\.com/)
  })

  it('can reach the App Check exchange, which is what the token is for', () => {
    // A reCAPTCHA token is traded for an App Check token at firebaseappcheck.googleapis.com.
    // Blocked there, every request goes out unverified and enforcement turns them all away.
    const csp = everywhere()['Content-Security-Policy']!
    const connect = csp.split('; ').find((d) => d.startsWith('connect-src'))!
    expect(connect).toMatch(/\*\.googleapis\.com|firebaseappcheck\.googleapis\.com/)
  })

  it("still allows no inline or evaluated script", () => {
    // Widening for one Google origin must not become widening in general.
    const scripts = everywhere()['Content-Security-Policy']!
      .split('; ')
      .find((d) => d.startsWith('script-src'))!
    expect(scripts).not.toContain('unsafe-inline')
    expect(scripts).not.toContain('unsafe-eval')
    expect(scripts).not.toContain('*')
  })

  it('can still reach Firestore and the sign-in popup', () => {
    /*
      The failure mode of a policy written blind: it deploys, and the app cannot open a
      listener. Both are same-day discoveries only if somebody thought to check.
    */
    const csp = everywhere()['Content-Security-Policy']!
    expect(csp).toMatch(/connect-src[^;]*googleapis\.com/)
    expect(csp).toMatch(/connect-src[^;]*wss:/)
    expect(csp).toMatch(/frame-src[^;]*accounts\.google\.com/)
  })

  it('can load what the reminder screen needs to send', () => {
    /*
      Sending goes straight from the browser to Gmail — there is no server to send from — so
      the sign-in library and the API both have to be reachable. A policy that blocks them
      fails only once deployed, and fails at the moment somebody is trying to tell eighteen
      families about tomorrow.
    */
    const csp = everywhere()['Content-Security-Policy']!
    expect(csp).toMatch(/script-src[^;]*accounts\.google\.com/)
    expect(csp).toMatch(/connect-src[^;]*gmail\.googleapis\.com/)
  })

  it('allows no origin the app has stopped talking to', () => {
    // Outlook was dropped; a policy is only as good as it is narrow.
    const csp = everywhere()['Content-Security-Policy']!
    for (const gone of ['msauth.net', 'graph.microsoft.com', 'login.microsoftonline.com']) {
      expect(csp, gone).not.toContain(gone)
    }
  })

  it('keeps the camera, because the jar scanner needs it', () => {
    // Everything else is off. The scanner is same-origin, so `self` is enough.
    const policy = everywhere()['Permissions-Policy']!
    expect(policy).toContain('camera=(self)')
    expect(policy).toContain('geolocation=()')
  })

  it('does not let a pass URL leak to another site', () => {
    // A pass link is a bearer token, and it is in the address bar.
    expect(everywhere()['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })

  it('does not sniff content types', () => {
    expect(everywhere()['X-Content-Type-Options']).toBe('nosniff')
  })

  it('leaves the sign-in popup able to talk back', () => {
    // `same-origin` outright would break `signInWithPopup`.
    expect(everywhere()['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups')
  })
})

describe('the indexes that get deployed', () => {
  it('has one for every query that needs it, and none that no query makes', () => {
    /*
      Firestore builds and maintains every index in this file on every write, whether or not
      anything reads it. Three of these were left over from queries that no longer exist —
      two on assignments, one on jars — so every check-in and every jar count was
      maintaining indexes with no reader.

      The audit log is the only place left that combines a filter with an ordering.
    */
    const idx = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')) as {
      indexes: { collectionGroup: string }[]
    }
    expect(idx.indexes.map((i) => i.collectionGroup)).toEqual(['audit'])
  })
})
