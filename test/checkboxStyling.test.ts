import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Every checkbox has to escape the rule that makes a field fill its label.
 *
 * `label > input { width: 100%; display: block }` in `styles.css` is what makes a text box
 * fill the width under its caption — and it catches checkboxes too, rendering one as a
 * full-width bar on a line of its own. It looks broken, and it looks broken only in a
 * browser, so nothing else here would notice.
 *
 * Two ways out, both already used: `className="switch"` for the app's pill toggle, which
 * sets its own width and `flex: none`, or an explicit width for a plain box in a table cell.
 * A source check rather than a rendered one, because jsdom does not apply the stylesheet —
 * the bug is invisible to every other test in this suite.
 */

/**
 * Every `<input …/>` tag in a file, one at a time.
 *
 * Sliced rather than matched with one regex. A lazy pattern from `<input` to `/>` runs
 * straight past the end of its own tag when the attribute it is looking for belongs to a
 * later one — which is how the first version of this reported a text field as a checkbox.
 * Attribute values here contain both `>` and `<` inside arrow functions, so there is no
 * character class that fences a tag either.
 */
function inputTags(src: string): { text: string; line: number }[] {
  const tags: { text: string; line: number }[] = []
  for (let at = src.indexOf('<input'); at !== -1; at = src.indexOf('<input', at + 6)) {
    const close = src.indexOf('/>', at)
    if (close === -1) break
    tags.push({ text: src.slice(at, close + 2), line: src.slice(0, at).split('\n').length })
  }
  return tags
}

const checkboxes = (): { file: string; text: string; line: number }[] =>
  readdirSync('src/ui')
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((file) =>
      inputTags(readFileSync(`src/ui/${file}`, 'utf8'))
        .filter((t) => t.text.includes('type="checkbox"'))
        .map((t) => ({ file: `src/ui/${file}`, ...t })),
    )

const offenders = (): string[] =>
  checkboxes()
    .filter(
      (c) =>
        !/className="[^"]*\bswitch\b/.test(c.text) && !/width:\s*'auto'/.test(c.text),
    )
    .map((c) => `${c.file}:${c.line}`)

describe('checkboxes', () => {
  it('all carry the switch class, or say their own width', () => {
    expect(offenders()).toEqual([])
  })

  it('are actually being looked for', () => {
    /*
      The check above passes trivially if the scan stops finding anything. This asserts it
      still sees the several that exist, so a scan that has quietly stopped scanning fails
      instead of reassuring.
    */
    expect(checkboxes().length).toBeGreaterThanOrEqual(6)
  })

  it('does not mistake a text field for a checkbox', () => {
    // What the first version of this got wrong, and the reason for slicing per tag.
    expect(inputTags('<input value={a} />\n<input type="checkbox" />')).toHaveLength(2)
    expect(inputTags('<input value={a} />')[0]!.text).not.toContain('checkbox')
  })
})
