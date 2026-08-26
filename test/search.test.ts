import { describe, expect, it } from 'vitest'
import { matchesTerms, ranked, searchTerms } from '../src/domain/search'

/**
 * One search, used by every list.
 *
 * Every word has to appear somewhere in the row, in any order and in any field.
 */

const finds = (
  query: string,
  fields: (string | number | null | undefined)[],
): boolean =>
  matchesTerms(searchTerms(query), fields)

describe('searching a row', () => {
  it('matches a word in any field', () => {
    expect(finds('sobeys', ['Sobeys - 640 Parkside', 'Alpha One'])).toBe(true)
    expect(finds('alpha', ['Sobeys - 640 Parkside', 'Alpha One'])).toBe(true)
  })

  it('needs every word, but in no particular order', () => {
    // The behaviour that makes "12 sob" useful.
    expect(finds('12 sob', [12, 'Sobeys'])).toBe(true)
    expect(finds('sob 12', [12, 'Sobeys'])).toBe(true)
    expect(finds('12 walmart', [12, 'Sobeys'])).toBe(false)
  })

  it('matches on part of a word, which is what makes it worth typing', () => {
    expect(finds('no fri', ['Paul and Mallory’s No Frills'])).toBe(true)
  })

  it('ignores case and stray spacing', () => {
    expect(finds('  SOBEYS   ', ['sobeys'])).toBe(true)
  })

  it('matches everything when nothing is typed', () => {
    // An empty box is not a filter that excludes every row.
    expect(finds('', ['anything'])).toBe(true)
    expect(finds('   ', ['anything'])).toBe(true)
  })

  it('searches numbers as they are written', () => {
    expect(finds('640', ['Sobeys - 640 Parkside'])).toBe(true)
    expect(finds('7', [7])).toBe(true)
  })

  it('skips fields that are not there rather than matching on “null”', () => {
    // A row with no note must not be found by searching for "null".
    expect(finds('null', ['Sobeys', null, undefined])).toBe(false)
  })

  it('does not match on a near miss', () => {
    // Deliberately not fuzzy: these lists are money and children.
    expect(finds('sobys', ['Sobeys'])).toBe(false)
  })
})

describe('ordering what matched', () => {
  /*
    Reported: searching the shops put "WalMart - 335 Farmers Market Road" above the two
    actually called "St. Jacob's Farmers market". Nothing was wrong with the matching —
    all three hold the word — but matches came back in whatever order the library held
    them, so where the word landed counted for nothing.
  */
  const shops = [
    { label: 'WalMart - 335 Farmers Market Road', tag: 'WM' },
    { label: "St. Jacob's Farmers market Loc.1", tag: 'SJFM1' },
    { label: "St. Jacob's Farmers market Loc.2", tag: 'SJFM2' },
    { label: 'Sobeys - 640 Parkside Drive', tag: '640', note: '640 Parkside Dr, Elmbridge' },
  ]

  const order = (query: string): string[] =>
    ranked(shops, query).map((s) => s.label)

  it('puts a name that starts with what was typed first', () => {
    expect(order('sobeys')[0]).toBe('Sobeys - 640 Parkside Drive')
  })

  it('prefers the earlier word when two names both hold it', () => {
    // "Farmers" is the fourth word of one and the fifth of the other.
    expect(order('farmers')[0]).toContain("St. Jacob's")
  })

  it('finds a shop by its group code', () => {
    expect(order('sjfm1')).toEqual(["St. Jacob's Farmers market Loc.1"])
  })

  it('ranks a code match above a mention buried in an address', () => {
    const rows = [
      { label: 'Somewhere else', note: 'On the corner of WM Road' },
      { label: 'WalMart', tag: 'WM' },
    ]
    expect(ranked(rows, 'wm')[0]!.label).toBe('WalMart')
  })

  it('still finds a shop by an address that is not on the row', () => {
    // The address is searched and not shown, so this has to keep working.
    expect(order('parkside')[0]).toBe('Sobeys - 640 Parkside Drive')
  })

  it('keeps the given order when nothing is typed', () => {
    /*
      Empty is not a search. The order it was handed is the meaningful one — the year's
      shops in the order they are worked — and re-sorting that by nothing would scramble it.
    */
    expect(order('')).toEqual(shops.map((s) => s.label))
  })

  it('keeps the given order between rows that rank the same', () => {
    expect(order('loc')).toEqual([
      "St. Jacob's Farmers market Loc.1",
      "St. Jacob's Farmers market Loc.2",
    ])
  })

  it('drops what does not match at all', () => {
    expect(order('bakery')).toEqual([])
  })

  it('still finds a row by separate words, below anything matched whole', () => {
    const rows = [
      { label: 'Market Farmers Co-op' },
      { label: "St. Jacob's Farmers market" },
    ]
    // "farmers market" is one phrase in the second and two scattered words in the first.
    expect(ranked(rows, 'farmers market')[0]!.label).toBe("St. Jacob's Farmers market")
  })

  it('is not confused by a query with regex in it', () => {
    // Typed into a search box, "loc.1" is four characters, not a pattern.
    expect(ranked(shops, 'loc.1').map((s) => s.label)).toEqual([
      "St. Jacob's Farmers market Loc.1",
    ])
  })
})
