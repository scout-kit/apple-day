import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Where a youth or a location gets chosen.
 *
 * A source-level check, because the thing that drifts is not behaviour but consistency: a
 * new screen reaches for `<select>` because it is the obvious thing to type, and the app
 * ends up choosing the same youth two different ways on two screens — one of them a scroll
 * through a hundred names.
 *
 * Short, fixed lists are still plain dropdowns, and should be: a day, a payment method, a
 * section, a tier. The rule is about lists that grow with the group.
 */

/** The pickers themselves, which describe the `<select>` they replace. */
const PICKERS = ['Picker.tsx', 'PickerField.tsx', 'PersonPicker.tsx', 'LocationPicker.tsx']

const screens = readdirSync('src/ui')
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ name: f, source: readFileSync(`src/ui/${f}`, 'utf8') }))

/** Screens that use a picker, as opposed to the ones that are one. */
const callers = screens.filter((s) => !PICKERS.includes(s.name))

/** A `<select>` whose options are built by mapping over a collection of this shape. */
const buildsOptionsFrom = (source: string, collection: RegExp): boolean => {
  const selects = source.split('<select').slice(1)
  return selects.some((chunk) => {
    const body = chunk.slice(0, chunk.indexOf('</select>'))
    return collection.test(body)
  })
}

describe('choosing a person', () => {
  it('is never a native dropdown of everybody', () => {
    const offenders = callers
      .filter((s) => buildsOptionsFrom(s.source, /people\b|\.people\b|Person\[\]/))
      .map((s) => s.name)
    expect(offenders).toEqual([])
  })

  it('goes through the shared picker wherever it happens', () => {
    // Every screen that lets somebody pick a person uses the same control.
    const pickers = screens.filter(
      (s) => s.source.includes('PersonField') || s.source.includes('PersonPicker'),
    )
    expect(pickers.length).toBeGreaterThan(1)
  })
})

describe('choosing a location', () => {
  it('is never a native dropdown of the library', () => {
    const offenders = callers
      .filter((s) => buildsOptionsFrom(s.source, /locations\.data|library\.data/))
      .map((s) => s.name)
    expect(offenders).toEqual([])
  })

  it('goes through the shared picker wherever it happens', () => {
    const pickers = screens.filter(
      (s) => s.source.includes('LocationField') || s.source.includes('LocationPicker'),
    )
    expect(pickers.length).toBeGreaterThan(1)
  })
})

describe('one picker, two wrappers', () => {
  it('keeps the panel behaviour in a single place', () => {
    /*
      Portals, keyboard handling, scroll-close and positioning are subtle and were got wrong
      twice already. A second copy is a second set of those bugs.
    */
    const withPortal = screens.filter((s) => s.source.includes('createPortal')).map((s) => s.name)
    expect(withPortal).toEqual(['Picker.tsx'])
  })
})
