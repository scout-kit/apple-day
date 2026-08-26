import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The two ways an embedded map quietly breaks the page around it.
 *
 * Both are invisible to every other test here, because both need a browser to see: jsdom
 * applies no stylesheet and lays nothing out. Both were reported from the running app.
 *
 * Leaflet ships its own stylesheet, and because the map is lazy-loaded that stylesheet
 * arrives *after* `styles.css`. Anything of ours at the same specificity loses the tie.
 */

const APP_CSS = readFileSync('src/styles.css', 'utf8')
const MAP = readFileSync('src/ui/LocationsMap.tsx', 'utf8')
const CARD = readFileSync('src/ui/LocationsMapCard.tsx', 'utf8')
const LEAFLET_CSS = readFileSync('node_modules/leaflet/dist/leaflet.css', 'utf8')

describe('the pins keep their numbers in the middle', () => {
  it('is a rule Leaflet actually contradicts, so this is worth guarding', () => {
    // A guard on the guard. If Leaflet ever stops setting this, the check below still
    // passes and would say nothing — better to notice the reason has gone.
    expect(LEAFLET_CSS).toMatch(/\.leaflet-marker-icon[^{]*\{[^}]*display:\s*block/)
  })

  it('scopes every pin rule, so the tie is not left to load order', () => {
    /*
      `.map-pin { display: grid }` and `.leaflet-marker-icon { display: block }` are one
      class each. The later stylesheet wins, and Leaflet's is the later one — so the number
      stopped being a grid item and sat in the corner of its circle.
    */
    const rules = [...APP_CSS.matchAll(/^([^{}\n][^{}]*)\{/gm)]
      .map((m) => m[1]!.trim())
      .filter((selector) => selector.includes('.map-pin'))

    expect(rules.length, 'no pin rules found — has the class been renamed?').toBeGreaterThan(0)
    for (const selector of rules) {
      const classes = selector.match(/\.[a-z][a-z0-9-]*/gi) ?? []
      expect(classes.length, `${selector} must outrank a single Leaflet class`).toBeGreaterThan(1)
    }
  })
})

describe('the marker element belongs to Leaflet', () => {
  /*
    Leaflet positions a marker by writing `transform: translate3d(…)` onto its element,
    inline. Two things follow, and both are silent:

      - a `transform` of ours in a stylesheet is outranked by that inline one, so it simply
        does nothing;
      - a `transition: transform` of ours *does* apply to it, so every pin slides into place
        a beat behind the map on each pan and zoom.

    So the visuals hang one level down, on `.map-pin-body`, which Leaflet does not touch.
  */
  it('positions markers with an inline transform, which is why this matters', () => {
    expect(readFileSync('node_modules/leaflet/dist/leaflet-src.js', 'utf8')).toMatch(
      /function setTransform/,
    )
  })

  it('paints the circle on an inner element, not on the marker', () => {
    expect(MAP).toMatch(/class="map-pin-body"/)
    expect(APP_CSS).toMatch(/\.map-pin-body\s*\{/)
  })

  it('never puts transform or transition on the marker element itself', () => {
    const markerRules = [...APP_CSS.matchAll(/([^{}\n][^{}]*)\{([^}]*)\}/g)].filter((m) => {
      const selector = m[1]!.trim()
      // The marker element is `.map-pin`, `.map-pin-shop`, `.map-pin-base`. `.map-pin-body`
      // and everything under it is ours to do as we like with.
      return /\.map-pin(-shop|-base|-on|-dim)?\s*(,|$)/.test(selector) &&
        !selector.includes('map-pin-body')
    })

    for (const rule of markerRules) {
      const [, selector, body] = rule
      expect(body, `${selector!.trim()} must leave transform to Leaflet`).not.toMatch(
        /(^|[;\s])transform\s*:/,
      )
      expect(body, `${selector!.trim()} must not transition Leaflet's transform`).not.toMatch(
        /transition\s*:/,
      )
    }
  })
})

describe('the page can still be scrolled', () => {
  it('hands vertical gestures back to the page', () => {
    /*
      Leaflet marks a draggable, pinch-zoomable container `touch-action: none`, which tells
      the browser to give it every gesture — including the swipe somebody meant to scroll
      the page with, leaving them stuck on the map.

      Set on the element, because Leaflet's rule carries three classes and ships in the
      lazy chunk: no stylesheet of ours is certain to beat it.
    */
    expect(LEAFLET_CSS, 'the rule this works around').toMatch(/touch-action:\s*none/)
    expect(MAP).toMatch(/getContainer\(\)\.style\.touchAction\s*=\s*'pan-y'/)
  })

  it('does not fight the page for the wheel either', () => {
    // The map is a picture of the year, not somewhere to get lost in. Scrolling the page
    // over it should scroll the page.
    expect(MAP).toMatch(/scrollWheelZoom:\s*false/)
  })

  it('opens in a dialog rather than inline on the locations screen', () => {
    /*
      The locations screen gives its whole height to the table and scrolls it internally —
      `.shell main:has(> .fill)` is `overflow: hidden`. A tall card above the table takes
      space that nothing can then scroll past, which is what stranded the screen.

      A dialog also matches how looking at a single location's map already works.
    */
    expect(CARD).toMatch(/<Modal/)
    expect(CARD).toMatch(/<LocationsMap/)

    const modalAt = CARD.indexOf('<Modal')
    const mapAt = CARD.indexOf('<LocationsMap')
    expect(mapAt, 'the map must be inside the dialog, not beside it').toBeGreaterThan(modalAt)
  })

  it('leaves the screen wrapper alone', () => {
    // The fill layout is what makes the table scroll rather than the page. Whatever the map
    // card does, it must not be by taking that away.
    const screen = readFileSync('src/ui/LocationsScreen.tsx', 'utf8')
    expect(screen).toMatch(/className="fill"/)
  })
})

describe('the map asks for nothing it has not been allowed', () => {
  it('names only the tile host the security policy allows', () => {
    const csp = readFileSync('firebase.json', 'utf8')
    const tiles = MAP.match(/https:\/\/[a-z.]*tile\.openstreetmap\.org/)?.[0]
    expect(tiles, 'no tile host found in the map').toBeTruthy()
    expect(csp, `${tiles} must be in img-src`).toContain(tiles!)
  })

  it('draws its own pins rather than fetching Leaflet’s marker images', () => {
    /*
      Leaflet's default marker is a PNG it resolves relative to its stylesheet. Drawing the
      pin keeps tiles as the map's only outside request — and lets a pin carry its number.
    */
    expect(MAP).toMatch(/L\.divIcon/)
    expect(MAP).not.toMatch(/L\.icon\(/)
  })
})
