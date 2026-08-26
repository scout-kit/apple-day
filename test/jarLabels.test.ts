import { describe, expect, it } from 'vitest'
import { describeJarNumbers, parseJarNumbers } from '../src/domain/jarLabels'

/**
 * Which jars get a label.
 *
 * "The first forty" is right the week before the event and wrong every time after it: a tin
 * comes back dented, three labels peel off in the rain, somebody finds two more in a
 * cupboard. What you want then is 4, 12 and 17.
 */

const numbers = (text: string): number[] => parseJarNumbers(text).numbers

describe('reading what somebody typed', () => {
  it('takes a plain run, which is the week-before case', () => {
    expect(numbers('1-40')).toHaveLength(40)
    expect(numbers('1-40')[0]).toBe(1)
    expect(numbers('1-40')[39]).toBe(40)
  })

  it('takes the odd ones out, in any order', () => {
    // Typed as they came to mind; printed in an order somebody can file.
    expect(numbers('12,17,4')).toEqual([4, 12, 17])
  })

  it('takes both at once', () => {
    expect(numbers('1-10, 15, 20-22')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 21, 22])
  })

  it('does not print the same jar twice', () => {
    expect(numbers('1-5, 3, 4-6')).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('reads a single number as itself', () => {
    expect(numbers('17')).toEqual([17])
  })

  it('is not fussy about how the numbers are separated', () => {
    for (const text of ['12,17,4', '12, 17, 4', '12 17 4', '12,  17,4', '12,17,4,']) {
      expect(numbers(text), text).toEqual([4, 12, 17])
    }
  })

  it('understands a dash pasted out of a document', () => {
    // En and em dashes arrive whenever somebody copies from a note or an email.
    for (const dash of ['-', '–', '—']) {
      expect(numbers(`10${dash}12`), dash).toEqual([10, 11, 12])
    }
  })

  it('reads a backwards range the way it was plainly meant', () => {
    expect(numbers('12-10')).toEqual([10, 11, 12])
  })

  it('prints nothing for an empty field, and says nothing about it', () => {
    // Not an error: it is somebody who has not typed yet.
    expect(parseJarNumbers('')).toEqual({ numbers: [], problem: null })
    expect(parseJarNumbers('   ')).toEqual({ numbers: [], problem: null })
  })
})

describe('saying what is wrong, rather than printing nothing', () => {
  it('names the part it could not read', () => {
    const { numbers: none, problem } = parseJarNumbers('1-10, banana, 15')
    expect(none).toEqual([])
    expect(problem).toContain('banana')
  })

  it('refuses jar zero, because jars are numbered from one', () => {
    expect(parseJarNumbers('0').problem).toBeTruthy()
    expect(parseJarNumbers('0-5').problem).toBeTruthy()
  })

  it('refuses a range that would fill the printer', () => {
    // A mis-typed range is the usual cause: 1-1000 rather than 1-100.
    const { problem } = parseJarNumbers('1-1000')
    expect(problem).toContain('200')
  })

  it('refuses more labels than one sheet will draw', () => {
    expect(parseJarNumbers('1-40', 10).problem).toContain('40 labels')
  })

  it('says nothing is wrong when nothing is', () => {
    expect(parseJarNumbers('1-40').problem).toBeNull()
  })
})

describe('reading the selection back', () => {
  /*
    A list of forty numbers is not something anybody can check at a glance, and it is about
    to become forty pieces of paper.
  */

  it('folds a run back into a range', () => {
    expect(describeJarNumbers([1, 2, 3, 4, 5])).toBe('5 labels: 1–5')
  })

  it('keeps the odd ones out separate', () => {
    expect(describeJarNumbers([4, 12, 17])).toBe('3 labels: 4, 12, 17')
  })

  it('mixes runs and singles', () => {
    expect(describeJarNumbers([1, 2, 3, 15, 20, 21])).toBe('6 labels: 1–3, 15, 20–21')
  })

  it('counts one label as one', () => {
    expect(describeJarNumbers([7])).toBe('1 label: 7')
  })

  it('says so when there is nothing', () => {
    expect(describeJarNumbers([])).toBe('Nothing to print')
  })

  it('describes what was parsed, whatever order it was typed in', () => {
    expect(describeJarNumbers(numbers('20-21, 3, 1-2'))).toBe('5 labels: 1–3, 20–21')
  })
})
