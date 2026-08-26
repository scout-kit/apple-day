import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Bounds, PlacedLocation, Point } from '../domain/geo'

/**
 * A year's shops on one map.
 *
 * OpenStreetMap tiles through Leaflet, which needs no key and no billing account — the
 * Google embed used elsewhere takes a single place per frame, and putting nineteen pins on
 * one map is the Maps JavaScript API, which is a key and an account behind it.
 *
 * Organizer-only, and it has to stay that way: a map of every shop a year is using, in
 * priority order, is precisely what a volunteer's pass is written to avoid saying.
 *
 * Leaflet owns its DOM, so this mounts it into a ref and hands it data. Nothing here is
 * rendered by React, which is why the pins are rebuilt in an effect rather than as
 * children.
 */

export interface LocationsMapProps {
  places: PlacedLocation[]
  /** Where the event runs from, marked apart from the shops and never numbered. */
  base: (Point & { id: string; name: string }) | null
  bounds: Bounds
  /**
   * Where a shop's own page lives, so a pin is not a dead end.
   *
   * A link in a popup rather than a jump on click. A pin is a small target on a phone, and
   * a mis-tap that navigates away from the map is a worse mistake than one that opens a
   * label — and an anchor can be opened in a new tab, which a click handler cannot.
   */
  hrefFor: (locationId: string) => string
  /** Numbered by the order the year works them, matching the list beside the map. */
  numbered?: boolean
  /**
   * The shop being pointed at, wherever the pointing is happening.
   *
   * The map and the list beside it are two views of one thing, and a numbered pin only
   * answers "which of these is Market Square" if you can find the number. Held by the
   * parent rather than either view, so hovering the list lights the pin and hovering the
   * pin lights the row, without the two needing to know about each other.
   */
  highlighted?: string | null
  onHighlight?: (locationId: string | null) => void
}

/*
  The popup is built as an HTML string, which is Leaflet's interface. Shop names are typed
  by people, so they are escaped rather than trusted — a name with an apostrophe is ordinary
  and one with a bracket in it should still be a name.
*/
const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const escapeAttribute = (value: string): string =>
  escapeText(value).replace(/"/g, '&quot;')

/**
 * A numbered pin, drawn rather than loaded.
 *
 * Leaflet's own marker is a PNG it fetches by a path relative to its stylesheet, which a
 * bundler rewrites and a strict `img-src` would have to allow. Drawing it here keeps the
 * map to tiles as its only outside request, and lets a pin carry its number.
 */
function pin(label: string, tone: 'shop' | 'base'): L.DivIcon {
  const size = tone === 'base' ? 30 : 26
  return L.divIcon({
    className: `map-pin map-pin-${tone}`,
    /*
      The circle is the inner element, not the marker itself.

      Leaflet positions a marker by writing `transform: translate3d(…)` straight onto its
      element, inline. Anything this file puts in `transform` there is either ignored — an
      inline style outranks a stylesheet — or, worse, gets a transition applied to it, so
      every pin slides into place a beat behind the map on each pan and zoom.

      So the marker element is left as a positioning box that Leaflet owns, and everything
      visual hangs one level down where it is free to scale.
    */
    html: `<span class="map-pin-body">${label}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

export function LocationsMap({
  places,
  base,
  bounds,
  hrefFor,
  numbered = true,
  highlighted = null,
  onHighlight,
}: LocationsMapProps): ReactNode {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  const pins = useRef<L.LayerGroup | null>(null)
  /** Kept so highlighting can touch one pin rather than rebuild all of them. */
  const markers = useRef(new Map<string, L.Marker>())

  // Read inside the effect below without making it re-run: a new callback on every render
  // would otherwise tear down and rebuild every pin.
  const href = useRef(hrefFor)
  href.current = hrefFor
  const report = useRef(onHighlight)
  report.current = onHighlight

  useEffect(() => {
    if (!holder.current || map.current) return

    const instance = L.map(holder.current, {
      // The map is a picture of the year, not somewhere to get lost. Scrolling the page
      // over it should scroll the page.
      scrollWheelZoom: false,
      attributionControl: true,
    })

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Required by the tile usage policy, and it is somebody else's work.
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(instance)

    /*
      Give the page its scrolling back.

      Leaflet marks a draggable, pinch-zoomable container `touch-action: none`, which tells
      the browser to hand it every gesture — including the swipe somebody meant to scroll
      the page with. `pan-y` keeps the vertical one for the page and leaves horizontal drags
      and the mouse to the map.

      Set on the element rather than in the stylesheet: Leaflet's rule carries three classes
      and ships in the lazy chunk, so an inline style is the only one certain to win.
    */
    instance.getContainer().style.touchAction = 'pan-y'

    pins.current = L.layerGroup().addTo(instance)
    map.current = instance

    return () => {
      instance.remove()
      map.current = null
      pins.current = null
    }
  }, [])

  useEffect(() => {
    const instance = map.current
    const layer = pins.current
    if (!instance || !layer) return

    layer.clearLayers()

    markers.current.clear()

    places.forEach((place, index) => {
      const marker = L.marker([place.lat, place.lng], {
        icon: pin(numbered ? String(index + 1) : '', 'shop'),
        title: place.name,
        alt: place.name,
        keyboard: true,
      })
        .addTo(layer)
        .bindPopup(
          `<a class="strong-link" href="${escapeAttribute(
            href.current(place.id),
          )}">${escapeText(place.name)}</a>`,
        )
        .bindTooltip(place.name)
        .on('mouseover', () => report.current?.(place.id))
        .on('mouseout', () => report.current?.(null))

      markers.current.set(place.id, marker)
    })

    if (base) {
      const marker = L.marker([base.lat, base.lng], {
        icon: pin('★', 'base'),
        title: base.name,
      })
        .addTo(layer)
        .bindTooltip(`${base.name} — base`)
        .on('mouseover', () => report.current?.(base.id))
        .on('mouseout', () => report.current?.(null))

      // In the same registry as the shops, so pointing at its line lights it like any other.
      markers.current.set(base.id, marker)
    }

    instance.fitBounds(
      [
        [bounds.south, bounds.west],
        [bounds.north, bounds.east],
      ],
      { padding: [8, 8] },
    )
  }, [places, base, bounds, numbered])

  /*
    Lifting one pin out of the crowd.

    Classes on the elements Leaflet already made, rather than new icons: rebuilding a marker
    replaces its element, which would shut any open popup and lose the tooltip mid-hover.

    `places` is in the list because the effect above rebuilds every marker when it changes,
    which drops whatever this had set.
  */
  useEffect(() => {
    for (const [id, marker] of markers.current) {
      const element = marker.getElement()
      if (!element) continue

      const on = id === highlighted
      element.classList.toggle('map-pin-on', on)
      element.classList.toggle('map-pin-dim', highlighted !== null && !on)
      // Leaflet stacks markers by latitude, so the one being pointed at has to be asked
      // for explicitly or a southerly neighbour draws over it.
      marker.setZIndexOffset(on ? 1000 : 0)
    }
  }, [highlighted, places])

  return (
    <div
      className="locations-map"
      ref={holder}
      role="application"
      aria-label="Map of this year's locations"
    />
  )
}
