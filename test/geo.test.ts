import { describe, expect, it } from 'vitest'
import {
  addressAttempts,
  boundsOf,
  describeUnplaced,
  isPlaced,
  isPlausiblePosition,
  padBounds,
  planMap,
} from '../src/domain/geo'
import type { Location } from '../src/domain/types'

/**
 * What a year's map can draw, and what it has to admit it cannot.
 *
 * The arithmetic is the easy half. The half worth testing is the admission: a map that
 * silently draws thirteen of nineteen shops tells an organizer the year is smaller than it
 * is, and the six it dropped are the ones needing attention.
 */

const shop = (id: string, over: Partial<Location> = {}): Location => ({
  id,
  name: id,
  address: '1 High Street',
  mapsUrl: '',
  groupCode: '',
  siteContact: null,
  insurance: '',
  comments: '',
  openHours: {},
  aliases: [],
  lat: null,
  lng: null,
  ...over,
})

describe('a position worth drawing', () => {
  it('takes a real one', () => {
    expect(isPlausiblePosition(43.47, -80.52)).toBe(true)
  })

  it('refuses Null Island', () => {
    /*
      A geocoder that failed and a field nobody filled in both tend to arrive as zero. A pin
      in the Gulf of Guinea standing in for a shop in Waterloo is worse than no pin, because
      it looks like data.
    */
    expect(isPlausiblePosition(0, 0)).toBe(false)
  })

  it('still allows a real place on one axis of zero', () => {
    // The equator and the prime meridian are real. Only both at once is the sentinel.
    expect(isPlausiblePosition(0, -80.52)).toBe(true)
    expect(isPlausiblePosition(43.47, 0)).toBe(true)
  })

  it('refuses what is not a number at all', () => {
    expect(isPlausiblePosition(undefined, undefined)).toBe(false)
    expect(isPlausiblePosition('43.47', '-80.52')).toBe(false)
    expect(isPlausiblePosition(NaN, 0)).toBe(false)
    expect(isPlausiblePosition(Infinity, 0)).toBe(false)
  })

  it('refuses coordinates off the globe', () => {
    expect(isPlausiblePosition(91, 0)).toBe(false)
    expect(isPlausiblePosition(0, 181)).toBe(false)
  })

  it('needs both halves, so a half-written record is not drawn', () => {
    expect(isPlaced(shop('a', { lat: 43.47, lng: null }))).toBe(false)
    expect(isPlaced(shop('a', { lat: null, lng: -80.52 }))).toBe(false)
    expect(isPlaced(shop('a', { lat: 43.47, lng: -80.52 }))).toBe(true)
  })
})

describe('the box to fit', () => {
  it('holds every point', () => {
    const box = boundsOf([
      { lat: 43.4, lng: -80.6 },
      { lat: 43.5, lng: -80.4 },
      { lat: 43.45, lng: -80.5 },
    ])!
    expect(box).toEqual({ north: 43.5, south: 43.4, east: -80.4, west: -80.6 })
  })

  it('is nothing for nothing', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('gives a single point a box a map can actually use', () => {
    /*
      One shop has a box of zero size. Fitting to that either fails or zooms to the maximum,
      which puts the only shop of the year under a street-level view of its own car park.
    */
    const box = padBounds(boundsOf([{ lat: 43.47, lng: -80.52 }])!)
    expect(box.north).toBeGreaterThan(box.south)
    expect(box.east).toBeGreaterThan(box.west)
    // Still centred on the shop.
    expect((box.north + box.south) / 2).toBeCloseTo(43.47, 5)
    expect((box.east + box.west) / 2).toBeCloseTo(-80.52, 5)
  })

  it('leaves the edge pins off the frame', () => {
    const tight = { north: 43.5, south: 43.4, east: -80.4, west: -80.6 }
    const box = padBounds(tight)
    expect(box.north).toBeGreaterThan(tight.north)
    expect(box.south).toBeLessThan(tight.south)
    expect(box.east).toBeGreaterThan(tight.east)
    expect(box.west).toBeLessThan(tight.west)
  })

  it('does not pad off the globe', () => {
    const box = padBounds({ north: 89.99, south: 89.98, east: 179.99, west: 179.98 })
    expect(box.north).toBeLessThanOrEqual(90)
    expect(box.east).toBeLessThanOrEqual(180)
  })
})

describe('sorting a year into what a map can do with it', () => {
  const list = [
    shop('placed-1', { lat: 43.47, lng: -80.52 }),
    shop('placed-2', { lat: 43.48, lng: -80.51 }),
    shop('needs-lookup'),
    shop('no-address', { address: '   ' }),
  ]

  it('draws the ones it can', () => {
    expect(planMap(list).placed.map((l) => l.id)).toEqual(['placed-1', 'placed-2'])
  })

  it('keeps the order it was given, which is the order the year works them', () => {
    const reversed = [list[1]!, list[0]!]
    expect(planMap(reversed).placed.map((l) => l.id)).toEqual(['placed-2', 'placed-1'])
  })

  it('separates "not looked up yet" from "nothing to look up"', () => {
    // Different problems needing different things done: one is a button, the other is
    // somebody typing an address in first.
    const plan = planMap(list)
    expect(plan.lookupPending.map((l) => l.id)).toEqual(['needs-lookup'])
    expect(plan.noAddress.map((l) => l.id)).toEqual(['no-address'])
  })

  it('accounts for every location exactly once', () => {
    // Nothing may fall between the three buckets — a shop that appears in none of them is
    // a shop the screen never mentions again.
    const plan = planMap(list)
    const seen = [...plan.placed, ...plan.lookupPending, ...plan.noAddress].map((l) => l.id)
    expect(seen.sort()).toEqual(list.map((l) => l.id).sort())
  })

  it('has no box when nothing is placed', () => {
    expect(planMap([shop('a')]).bounds).toBeNull()
  })
})

describe('what it says about the ones it cannot draw', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describeUnplaced(planMap([shop('a', { lat: 43.4, lng: -80.5 })]))).toEqual([])
  })

  it('counts both kinds separately', () => {
    const plan = planMap([shop('a'), shop('b'), shop('c', { address: '' })])
    expect(describeUnplaced(plan)).toEqual([
      '2 shops have not been looked up',
      '1 shop has no address on file',
    ])
  })

  it('reads correctly for one of each', () => {
    const plan = planMap([shop('a'), shop('b', { address: '' })])
    expect(describeUnplaced(plan)).toEqual([
      '1 shop has not been looked up',
      '1 shop has no address on file',
    ])
  })
})

describe('what to ask a geocoder for', () => {
  /*
    Addresses are written the way people write them, leading with what the shop is called.
    A geocoder matching that whole string against its own records mostly finds nothing —
    against the real library it placed 5 of 16. Dropping the name on a second attempt took
    that to 14.
  */
  it('tries the whole thing first', () => {
    // When the geocoder does know the shop by name, that is a better answer than the
    // building it sits in.
    expect(addressAttempts('Sobeys, 640 Parkside Dr, Waterloo ON')[0]).toBe(
      'Sobeys, 640 Parkside Dr, Waterloo ON',
    )
  })

  it('falls back to the address without the shop name', () => {
    expect(addressAttempts("Brady's Meat & Deli, 465 Phillip St, Waterloo, ON")).toEqual([
      "Brady's Meat & Deli, 465 Phillip St, Waterloo, ON",
      '465 Phillip St, Waterloo, ON',
    ])
  })

  it('does not drop a leading segment that is a street', () => {
    // "640 Parkside Dr" starts with a number, so it is where the place is, not what it is
    // called — dropping it would throw away the only part that matters.
    expect(addressAttempts('640 Parkside Dr, Waterloo, ON')).toEqual([
      '640 Parkside Dr, Waterloo, ON',
    ])
  })

  it('leaves a single-part address alone', () => {
    expect(addressAttempts('Waterloo Memorial Complex')).toEqual([
      'Waterloo Memorial Complex',
    ])
  })

  it('has nothing to ask for a blank address', () => {
    expect(addressAttempts('   ')).toEqual([])
  })

  it('tidies the whitespace people leave behind', () => {
    expect(addressAttempts('  Sobeys ,  640  Parkside Dr ')).toEqual([
      'Sobeys , 640 Parkside Dr',
      '640 Parkside Dr',
    ])
  })

  it('never asks the same thing twice', () => {
    for (const address of [
      'Sobeys, 640 Parkside Dr',
      '640 Parkside Dr, Waterloo',
      'One Name Only',
      'Shop,,,',
    ]) {
      const tries = addressAttempts(address)
      expect(new Set(tries).size, address).toBe(tries.length)
    }
  })
})

describe('base is not one of the shops', () => {
  /*
    Nobody is scheduled to base and no money is raised there — it is where volunteers report
    and jars are counted. Numbering it among the shops makes the year look one shop longer
    than it is and puts a number against a place no shift refers to.
  */
  const hall = shop('hall', { name: 'Scout Hall', lat: 43.46, lng: -80.53 })
  const shops = [
    shop('market', { lat: 43.47, lng: -80.52 }),
    shop('corner', { lat: 43.48, lng: -80.51 }),
  ]

  it('keeps it out of the numbered list', () => {
    const plan = planMap(shops, hall)
    expect(plan.placed.map((l) => l.id)).toEqual(['market', 'corner'])
    expect(plan.base?.id).toBe('hall')
  })

  it('drops it from the shops when it is also in the year', () => {
    /*
      A group whose hall is also a pitch would otherwise get two markers on one spot and a
      numbered entry for the place everybody is already standing.
    */
    const plan = planMap([...shops, hall], hall)
    expect(plan.placed.map((l) => l.id)).toEqual(['market', 'corner'])
    expect(plan.placed.some((l) => l.id === 'hall')).toBe(false)
    expect(plan.base?.id).toBe('hall')
  })

  it('still fits the map around it', () => {
    // A base off to one side must not sit outside the frame — every distance being judged
    // here is a distance from it.
    const far = shop('hall', { lat: 43.40, lng: -80.60 })
    const box = planMap(shops, far).bounds!
    expect(box.south).toBeLessThan(43.4)
    expect(box.west).toBeLessThan(-80.6)
  })

  it('is looked up like anything else, or there is no star to draw', () => {
    const unplaced = shop('hall', { lat: null, lng: null, address: '14 Chapel Road' })
    const plan = planMap(shops, unplaced)
    expect(plan.base).toBeNull()
    expect(plan.lookupPending.map((l) => l.id)).toContain('hall')
  })

  it('is not counted as a shop needing an address', () => {
    const noAddress = shop('hall', { lat: null, lng: null, address: '' })
    expect(planMap(shops, noAddress).noAddress.map((l) => l.id)).toEqual(['hall'])
  })

  it('copes with an event that has no base at all', () => {
    const plan = planMap(shops, null)
    expect(plan.base).toBeNull()
    expect(plan.placed).toHaveLength(2)
  })

  it('draws a base even when no shop is placed yet', () => {
    // Setting a year up, base is often the first thing on file.
    const plan = planMap([shop('a', { lat: null, lng: null })], hall)
    expect(plan.placed).toHaveLength(0)
    expect(plan.base?.id).toBe('hall')
    expect(plan.bounds, 'somewhere to draw it').not.toBeNull()
  })
})
