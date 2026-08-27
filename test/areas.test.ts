import { describe, expect, it } from 'vitest'
import { AREA_TONES, areaOf, areaTone, sameArea } from '../src/domain/areas'
import type { Location } from '../src/domain/types'

/**
 * Shops that are one place to stand.
 *
 * Two siblings asked to stay together do not have to be at the same door. A plaza with a
 * grocer at one end and a chemist at the other is one place to the parent dropping them off,
 * and putting them at both ends covers twice the footfall — which is the point of sending
 * two of them.
 */

const at = (code: string): Pick<Location, 'groupCode'> => ({ groupCode: code })

const library = (entries: Record<string, string>): Map<string, Pick<Location, 'groupCode'>> =>
  new Map(Object.entries(entries).map(([id, code]) => [id, at(code)]))

describe('reading an area off a location', () => {
  it('is the code, however it was typed', () => {
    expect(areaOf(at('linden'))).toBe('LINDEN')
    expect(areaOf(at('  Linden  '))).toBe('LINDEN')
  })

  it('is nothing when nobody has said', () => {
    expect(areaOf(at(''))).toBeNull()
    expect(areaOf(at('   '))).toBeNull()
    expect(areaOf(undefined)).toBeNull()
  })
})

describe('whether two shops are the same place to stand', () => {
  const shops = library({
    braemar: 'LINDEN',
    chemist: 'LINDEN',
    kelmont: 'FARMERS',
    ashfield: '',
    hall: '',
  })

  it('counts a shop as itself', () => {
    expect(sameArea('kelmont', 'kelmont', shops)).toBe(true)
    // Including one with no area at all: it is still the same door.
    expect(sameArea('ashfield', 'ashfield', shops)).toBe(true)
  })

  it('counts two shops sharing an area', () => {
    expect(sameArea('braemar', 'chemist', shops)).toBe(true)
  })

  it('does not count two different areas', () => {
    expect(sameArea('braemar', 'kelmont', shops)).toBe(false)
  })

  it('does not count a shop with an area against one without', () => {
    // However close they are on the map. Nobody has said they are together.
    expect(sameArea('braemar', 'ashfield', shops)).toBe(false)
  })

  it('never puts two ungrouped shops together', () => {
    /*
      The care this whole thing needs. Treating a blank code as a group called "" would put
      every ungrouped shop in one enormous area with every other one — and a pair split
      across two ends of town would report nothing at all, which is the exact warning this
      is meant to preserve.
    */
    expect(sameArea('ashfield', 'hall', shops)).toBe(false)
  })

  it('says nothing about a location it has never heard of', () => {
    expect(sameArea('braemar', 'gone-away', shops)).toBe(false)
  })
})

describe('the colour an area gets', () => {
  it('is one of the tones the rest of the app uses', () => {
    expect(AREA_TONES).toContain(areaTone('LINDEN'))
  })

  it('is the same every time, for the same code', () => {
    expect(areaTone('LINDEN')).toBe(areaTone('LINDEN'))
  })

  it('comes from the code rather than from the order', () => {
    // Adding a shop must not repaint the board: a colour that moved would make two rows stop
    // matching for a reason nobody changed.
    const before = ['LINDEN', 'FARMERS', 'MARKET'].map(areaTone)
    const after = ['MARKET', 'LINDEN', 'FARMERS'].map(areaTone)
    expect(after).toEqual([before[2], before[0], before[1]])
  })

  it('gives different areas different colours, for the ones a group will have', () => {
    const tones = new Set(['LINDEN', 'FARMERS', 'MARKET', 'FOXGLOVE'].map(areaTone))
    expect(tones.size).toBeGreaterThan(1)
  })
})
