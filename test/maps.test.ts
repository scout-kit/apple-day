import { describe, expect, it } from 'vitest'
import {
  mapDirectionsUrl,
  mapEmbedUrl,
  mapLink,
  mapsSearchUrl,
} from '../src/domain/maps'

describe('mapsSearchUrl', () => {
  it('builds a Google Maps search from a street address', () => {
    expect(mapsSearchUrl('640 Linden Dr, Elmbridge ON')).toBe(
      'https://www.google.com/maps/search/?api=1&query=640%20Linden%20Dr%2C%20Elmbridge%20ON',
    )
  })

  it('encodes the characters that would otherwise break the query', () => {
    // Ashfield Market's address has an ampersand in it; unencoded it would truncate
    // the query at the first field separator.
    expect(mapsSearchUrl('878 Marchmont St N & Market')).toContain('%26')
  })

  it('has nothing to link to without an address', () => {
    expect(mapsSearchUrl('')).toBe('')
    expect(mapsSearchUrl('   ')).toBe('')
  })
})

describe('mapLink', () => {
  it('prefers a link somebody chose deliberately', () => {
    expect(
      mapLink({ address: '640 Linden Dr', mapsUrl: 'https://maps.app.goo.gl/dock' }),
    ).toBe('https://maps.app.goo.gl/dock')
  })

  it('falls back to the address', () => {
    expect(mapLink({ address: '640 Linden Dr', mapsUrl: '' })).toBe(
      mapsSearchUrl('640 Linden Dr'),
    )
  })

  it('ignores a stored link that is only whitespace', () => {
    expect(mapLink({ address: '640 Linden Dr', mapsUrl: '  ' })).toBe(
      mapsSearchUrl('640 Linden Dr'),
    )
  })

  it('gives an empty link when there is neither', () => {
    expect(mapLink({ address: '', mapsUrl: '' })).toBe('')
  })
})

describe('mapEmbedUrl', () => {
  const braemar = { name: 'Braemar', address: '640 Linden Dr, Elmbridge ON' }
  const hall = { name: 'Scout Hall', address: '123 Hall St, Elmbridge ON' }

  it('shows directions from base when there is a base', () => {
    const url = mapEmbedUrl(braemar, hall)
    expect(url).toContain('saddr=123%20Hall%20St')
    expect(url).toContain('daddr=640%20Linden%20Dr')
    expect(url).toContain('output=embed')
  })

  it('shows just the place when no base is set', () => {
    const url = mapEmbedUrl(braemar, null)
    expect(url).toContain('q=640%20Linden%20Dr')
    expect(url).not.toContain('saddr')
  })

  it('falls back to the name for a place with no address', () => {
    // Better than an empty map: the name alone is often enough for Google to find a
    // Elmbridge storefront.
    expect(mapEmbedUrl({ name: 'Ashfield Market', address: '' }, null)).toContain(
      'q=Ashfield%20Market',
    )
  })

  it('has nothing to embed with neither a name nor an address', () => {
    expect(mapEmbedUrl({ name: '', address: '  ' }, null)).toBe('')
  })

  it('treats a base with no address of its own by its name', () => {
    expect(mapEmbedUrl(braemar, { name: 'Scout Hall', address: '' })).toContain(
      'saddr=Scout%20Hall',
    )
  })
})

describe('mapDirectionsUrl', () => {
  const braemar = { name: 'Braemar', address: '640 Linden Dr', mapsUrl: '' }
  const hall = { name: 'Scout Hall', address: '123 Hall St' }

  it('is a route when there is a base to route from', () => {
    const url = mapDirectionsUrl(braemar, hall)
    expect(url).toContain('/maps/dir/')
    expect(url).toContain('origin=123%20Hall%20St')
    expect(url).toContain('destination=640%20Linden%20Dr')
  })

  it('is the place itself when there is no base', () => {
    expect(mapDirectionsUrl(braemar, null)).toBe(mapLink(braemar))
  })

  it('prefers a deliberately saved link when there is no journey to show', () => {
    // Some library links point at a specific entrance; without a base there is nothing a
    // route would add over that.
    const withLink = { ...braemar, mapsUrl: 'https://maps.app.goo.gl/dock' }
    expect(mapDirectionsUrl(withLink, null)).toBe('https://maps.app.goo.gl/dock')
  })
})
