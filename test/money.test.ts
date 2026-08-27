import { describe, expect, it } from 'vitest'
import { parseMoney } from '../src/domain/money'

/**
 * Reading an amount somebody typed.
 *
 * Reported as "$50 goes in as nothing": a browser number input discards the `$` as it is
 * typed, leaving the field empty — and `Number('')` is `0`, which is a perfectly good
 * amount. So the form did not refuse anything. It recorded zero, and the day's total was out
 * by fifty pounds with nothing anywhere saying so.
 */

describe('what it accepts', () => {
  it('reads a plain number', () => {
    expect(parseMoney('50')).toBe(50)
    expect(parseMoney('50.25')).toBe(50.25)
  })

  it('reads one with a currency mark, which is how people write money', () => {
    expect(parseMoney('$50')).toBe(50)
    expect(parseMoney('$50.25')).toBe(50.25)
  })

  it('reads a negative either way round, because they are the same thought', () => {
    expect(parseMoney('-50')).toBe(-50)
    expect(parseMoney('-$50')).toBe(-50)
    expect(parseMoney('$-50')).toBe(-50)
  })

  it('ignores the spacing somebody used', () => {
    expect(parseMoney('  $ 50.25 ')).toBe(50.25)
    expect(parseMoney('- $50')).toBe(-50)
  })

  it('reads separators as punctuation rather than as part of the number', () => {
    expect(parseMoney('1,234.50')).toBe(1234.5)
    expect(parseMoney('$1,234')).toBe(1234)
  })

  it('reads the shorthands for less than a pound', () => {
    expect(parseMoney('.5')).toBe(0.5)
    expect(parseMoney('0.05')).toBe(0.05)
  })

  it('rounds to the cent, which is what everything downstream works in', () => {
    expect(parseMoney('10.005')).toBe(10.01)
    expect(parseMoney('-10.005')).toBe(-10.01)
  })

  it('reads a real zero as zero', () => {
    // Distinct from the blank below: a jar that came back empty is a fact worth recording.
    expect(parseMoney('0')).toBe(0)
    expect(parseMoney('$0.00')).toBe(0)
  })
})

describe('what it refuses', () => {
  it('refuses a blank, rather than calling it zero', () => {
    // The whole reason this exists.
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('   ')).toBeNull()
  })

  it('refuses a currency mark on its own', () => {
    expect(parseMoney('$')).toBeNull()
    expect(parseMoney('-$')).toBeNull()
  })

  it('refuses words', () => {
    expect(parseMoney('fifty')).toBeNull()
    expect(parseMoney('50ish')).toBeNull()
    expect(parseMoney('about $50')).toBeNull()
  })

  it('refuses a mark in the wrong place', () => {
    expect(parseMoney('50$')).toBeNull()
    expect(parseMoney('5$0')).toBeNull()
  })

  it('refuses two minus signs, which is a typo rather than emphasis', () => {
    expect(parseMoney('--50')).toBeNull()
    expect(parseMoney('-$-50')).toBeNull()
  })

  it('refuses a number that is not one', () => {
    expect(parseMoney('1.2.3')).toBeNull()
    expect(parseMoney('1e5')).toBeNull()
    expect(parseMoney('Infinity')).toBeNull()
  })
})
