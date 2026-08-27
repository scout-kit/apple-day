/**
 * Reading an amount somebody typed.
 *
 * `Number()` is the obvious thing and the wrong one, because of what it does with a blank:
 * `Number('')` is `0`, and `0` is a perfectly good amount. So a field that failed to accept
 * what was typed — a browser number input discards a `$` as you type it — records nothing
 * wrong, it records zero, and the day is out by however much that was.
 *
 * Anything unreadable comes back as null so the screen can say so. Nothing here guesses.
 */

/** How money is written when somebody is not thinking about parsers. */
const NUMERIC = /^(\d+(\.\d*)?|\.\d+)$/

/**
 * The amount in a string, or null if it is not one.
 *
 * Accepts what people actually type: a currency mark, thousands separators, and a minus on
 * either side of the mark — "-$50" and "$-50" are the same thought. Rounded to the cent,
 * which is the resolution everything downstream works in.
 */
export function parseMoney(text: string): number | null {
  let rest = text.trim()
  if (!rest) return null

  /*
    One minus, on whichever side of the currency mark it landed. Two of them is not an
    emphatic negative, it is a typo, and the second pass below refuses it.
  */
  let negative = false
  if (rest.startsWith('-')) {
    negative = true
    rest = rest.slice(1).trim()
  }
  if (rest.startsWith('$')) rest = rest.slice(1).trim()
  if (!negative && rest.startsWith('-')) {
    negative = true
    rest = rest.slice(1).trim()
  }

  // Separators are how the number was read out, not part of it.
  rest = rest.replace(/,/g, '')
  if (!NUMERIC.test(rest)) return null

  const value = Number(rest)
  if (!Number.isFinite(value)) return null

  return Math.round((negative ? -value : value) * 100) / 100
}
