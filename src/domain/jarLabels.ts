/**
 * Which jars to print labels for.
 *
 * The sheet used to be "the first N", which is right the week before the event and wrong
 * every time after it: a tin comes back dented, three labels peel off in the rain, somebody
 * finds two more jars in a cupboard. What you want then is 4, 12 and 17 — not another
 * forty.
 *
 * One field takes both, because they are the same question asked twice: `1-40` for the
 * first run, `12,17,4` for the repairs, `1-10, 15, 20-22` when it is both.
 */

export interface JarSelection {
  /** Ascending and deduplicated: a label sheet gets cut up and filed, so order helps. */
  numbers: number[]
  /** What is wrong with what was typed, in the words of the thing that is wrong. */
  problem: string | null
}

/** Jars are numbered from one, and a sheet beyond this is a mis-typed range. */
const HIGHEST = 200

export function parseJarNumbers(text: string, limit = HIGHEST): JarSelection {
  const nothing = { numbers: [], problem: null }
  if (!text.trim()) return nothing

  const found = new Set<number>()

  // Commas or whitespace, either way — people type both, and a trailing comma is not an
  // error, it is somebody mid-thought.
  for (const token of text.split(/[,\s]+/).filter(Boolean)) {
    // An en or em dash as well as a hyphen: these get pasted out of documents.
    const range = token.match(/^(\d+)\s*[-–—]\s*(\d+)$/)
    if (range) {
      const a = Number(range[1])
      const b = Number(range[2])
      if (a < 1 || b < 1) return { numbers: [], problem: `Jars are numbered from 1, so “${token}” cannot be printed` }
      // Backwards ranges are read the way they were plainly meant.
      const [from, to] = a <= b ? [a, b] : [b, a]
      if (to > HIGHEST) {
        return { numbers: [], problem: `“${token}” goes past jar ${HIGHEST}, which is more than this sheet will print` }
      }
      for (let n = from; n <= to; n += 1) found.add(n)
      continue
    }

    if (!/^\d+$/.test(token)) {
      return { numbers: [], problem: `“${token}” is not a jar number or a range like 10-12` }
    }
    const n = Number(token)
    if (n < 1) return { numbers: [], problem: 'Jars are numbered from 1' }
    if (n > HIGHEST) {
      return { numbers: [], problem: `Jar ${n} is past ${HIGHEST}, which is more than this sheet will print` }
    }
    found.add(n)
  }

  const numbers = [...found].sort((a, b) => a - b)
  if (numbers.length > limit) {
    return {
      numbers: [],
      problem: `That is ${numbers.length} labels; ${limit} is as many as one sheet will draw`,
    }
  }
  return { numbers, problem: null }
}

/**
 * The selection read back, so somebody can check it before printing a sheet.
 *
 * Runs of consecutive numbers are folded back into ranges — a list of forty numbers is
 * not something anybody can verify at a glance, and "1–40" is.
 */
export function describeJarNumbers(numbers: number[]): string {
  if (numbers.length === 0) return 'Nothing to print'

  const parts: string[] = []
  let start = numbers[0]!
  let previous = start

  for (const n of [...numbers.slice(1), Number.NaN]) {
    if (n === previous + 1) {
      previous = n
      continue
    }
    parts.push(start === previous ? `${start}` : `${start}–${previous}`)
    start = n
    previous = n
  }

  const count = `${numbers.length} label${numbers.length === 1 ? '' : 's'}`
  return `${count}: ${parts.join(', ')}`
}
