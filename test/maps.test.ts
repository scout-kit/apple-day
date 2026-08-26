import { describe, expect, it } from 'vitest'
import {
  mapDirectionsUrl,
  mapEmbedUrl,
  mapLink,
  mapsSearchUrl,
} from '../src/domain/maps'

describe('mapsSearchUrl', () => {
  it('builds a Google Maps search from a street address', () => {
    expect(mapsSearchUrl('640 Parkside Dr, Waterloo ON')).toBe(
      'https://www.google.com/maps/search/?api=1&query=640%20Parkside%20Dr%2C%20Waterloo%20ON',
    )
  })

  it('encodes the characters that would otherwise break the query', () => {
    // St Jacobs Market's address has an ampersand in it; unencoded it would truncate
    // the query at the first field separator.
    expect(mapsSearchUrl('878 Weber St N & King')).toContain('%26')
  })

  it('has nothing to link to without an address', () => {
    expect(mapsSearchUrl('')).toBe('')
    expect(mapsSearchUrl('   ')).toBe('')
  })
})

describe('mapLink', () => {
  it('prefers a link somebody chose deliberately', () => {
    expect(
      mapLink({ address: '640 Parkside Dr', mapsUrl: 'https://maps.app.goo.gl/dock' }),
    ).toBe('https://maps.app.goo.gl/dock')
  })

  it('falls back to the address', () => {
    expect(mapLink({ address: '640 Parkside Dr', mapsUrl: '' })).toBe(
      mapsSearchUrl('640 Parkside Dr'),
    )
  })

  it('ignores a stored link that is only whitespace', () => {
    expect(mapLink({ address: '640 Parkside Dr', mapsUrl: '  ' })).toBe(
      mapsSearchUrl('640 Parkside Dr'),
    )
  })

  it('gives an empty link when there is neither', () => {
    expect(mapLink({ address: '', mapsUrl: '' })).toBe('')
  })
})

describe('mapEmbedUrl', () => {
  const sobeys = { name: 'Sobeys', address: '640 Parkside Dr, Waterloo ON' }
  const hall = { name: 'Scout Hall', address: '123 Hall St, Waterloo ON' }

  it('shows directions from base when there is a base', () => {
    const url = mapEmbedUrl(sobeys, hall)
    expect(url).toContain('saddr=123%20Hall%20St')
    expect(url).toContain('daddr=640%20Parkside%20Dr')
    expect(url).toContain('output=embed')
  })

  it('shows just the place when no base is set', () => {
    const url = mapEmbedUrl(sobeys, null)
    expect(url).toContain('q=640%20Parkside%20Dr')
    expect(url).not.toContain('saddr')
  })

  it('falls back to the name for a place with no address', () => {
    // Better than an empty map: the name alone is often enough for Google to find a
    // Waterloo storefront.
    expect(mapEmbedUrl({ name: 'St Jacobs Market', address: '' }, null)).toContain(
      'q=St%20Jacobs%20Market',
    )
  })

  it('has nothing to embed with neither a name nor an address', () => {
    expect(mapEmbedUrl({ name: '', address: '  ' }, null)).toBe('')
  })

  it('treats a base with no address of its own by its name', () => {
    expect(mapEmbedUrl(sobeys, { name: 'Scout Hall', address: '' })).toContain(
      'saddr=Scout%20Hall',
    )
  })
})

describe('mapDirectionsUrl', () => {
  const sobeys = { name: 'Sobeys', address: '640 Parkside Dr', mapsUrl: '' }
  const hall = { name: 'Scout Hall', address: '123 Hall St' }

  it('is a route when there is a base to route from', () => {
    const url = mapDirectionsUrl(sobeys, hall)
    expect(url).toContain('/maps/dir/')
    expect(url).toContain('origin=123%20Hall%20St')
    expect(url).toContain('destination=640%20Parkside%20Dr')
  })

  it('is the place itself when there is no base', () => {
    expect(mapDirectionsUrl(sobeys, null)).toBe(mapLink(sobeys))
  })

  it('prefers a deliberately saved link when there is no journey to show', () => {
    // Some library links point at a specific entrance; without a base there is nothing a
    // route would add over that.
    const withLink = { ...sobeys, mapsUrl: 'https://maps.app.goo.gl/dock' }
    expect(mapDirectionsUrl(withLink, null)).toBe('https://maps.app.goo.gl/dock')
  })
})
