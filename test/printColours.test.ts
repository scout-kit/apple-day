import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Nothing goes to the printer in the dark theme's ink.
 *
 * Reported as a jar label printing its QR code and not its number. The code is drawn black
 * on white into the image itself, so it survived; the number under it is written in
 * `--text`, which on a phone set to dark is #f2ece5 — near-white, onto white paper. It had
 * been printing as nothing at all, and so would every table, pass and heading printed from
 * a dark screen.
 *
 * The fix is that both dark blocks are `@media screen`, leaving print to the light values
 * at the top of the file. Worth a test because it is invisible everywhere else: jsdom
 * applies no stylesheet, no other test here has a print medium, and the way to undo it is
 * to add a third palette — or to lift one of these back out of `screen` — without ever
 * seeing a page come out wrong.
 */

/** Which `--text` values the stylesheet sets, and what each one is nested inside. */
function textColours(): { value: string; scope: string[] }[] {
  // Comments first: several of them contain braces, which a brace scan would count.
  const css = readFileSync('src/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  const found: { value: string; scope: string[] }[] = []
  const scope: string[] = []
  let buffer = ''
  for (const c of css) {
    if (c === '{') {
      scope.push(buffer.trim())
      buffer = ''
    } else if (c === '}') {
      scope.pop()
      buffer = ''
    } else if (c === ';') {
      const declared = /^--text\s*:\s*(\S+)$/.exec(buffer.trim())
      if (declared?.[1]) found.push({ value: declared[1], scope: [...scope] })
      buffer = ''
    } else {
      buffer += c
    }
  }
  return found
}

/** Light enough that it would come out as paper rather than as ink. */
const nearlyWhite = (hex: string): boolean => {
  const channel = (at: number): number => parseInt(hex.slice(at, at + 2), 16)
  return (0.299 * channel(1) + 0.587 * channel(3) + 0.114 * channel(5)) / 255 > 0.5
}

describe('the colours a page is printed in', () => {
  it('is watching something that is actually there', () => {
    // A parser that quietly found nothing would pass every assertion below.
    const colours = textColours()
    expect(colours.length).toBeGreaterThanOrEqual(3)
    expect(colours.some((c) => nearlyWhite(c.value))).toBe(true)
    expect(colours.some((c) => !nearlyWhite(c.value))).toBe(true)
  })

  it('keeps every near-white text colour on screen', () => {
    for (const { value, scope } of textColours()) {
      if (!nearlyWhite(value)) continue
      const guarded = scope.some((s) => s.startsWith('@media') && s.includes('screen'))
      expect(guarded, `${value} in ${scope.join(' / ') || 'the top level'}`).toBe(true)
    }
  })

  it('does not keep a second set of light colours for print', () => {
    /*
      There is one obvious way to fix white-on-white — copy the light palette into the print
      block — and it leaves two sets of colours where a later edit will only reach one.
    */
    for (const { scope } of textColours()) {
      expect(scope.some((s) => s.startsWith('@media') && s.includes('print'))).toBe(false)
    }
  })
})
