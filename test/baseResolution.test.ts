import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Where the base of operations is looked up.
 *
 * A source-level check rather than a behavioural one, because the bug it guards was a
 * *plausible-looking* line repeated in two screens: `locations.data.find(l => l.id ===
 * event.baseLocationId)`. `useLocations()` returns only the locations the year staffs, and
 * the base is deliberately excluded from those — it must never be a row on the board or in
 * the revenue ranking. So the lookup always came back undefined. The base banner rendered
 * blank, published passes carried no base, and the location map fell back to a bare pin
 * with no route from anywhere. Nothing threw and no test failed, because every fixture had
 * put the base in the year's list.
 *
 * `useBaseLocation()` resolves it against the library instead. This asserts nothing goes
 * back to the old shape.
 */

const uiFiles = readdirSync('src/ui')
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => ({ name: f, source: readFileSync(`src/ui/${f}`, 'utf8') }))

describe('the base is resolved against the library, not the year', () => {
  it('finds the screens that mention it at all', () => {
    // A guard on the guard: if this list empties because of a rename, the checks below
    // would pass by vacuum.
    const mentioning = uiFiles.filter((f) => f.source.includes('baseLocationId'))
    expect(mentioning.length).toBeGreaterThan(0)
  })

  it('never searches the year-scoped locations for it', () => {
    const offenders = uiFiles
      .filter((f) => /locations\.data\s*\n?\s*\.?\s*find\([^)]*baseLocationId/s.test(f.source))
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })

  it('reads it through the one hook, or over the library it belongs to', () => {
    const offenders = uiFiles
      .filter((f) => f.source.includes('baseLocationId'))
      .filter(
        (f) =>
          !f.source.includes('useBaseLocation') &&
          /*
            The event form names and picks the base, so it is handed the library to offer.
            It never resolves the id itself — it puts `baseLocationId` into a picker and
            takes back whatever was chosen — so there is nothing here to resolve wrongly.
          */
          !/\blibrary(\.data)?\b/.test(f.source) &&
          /*
            Publish takes the base as part of the whole publish input, which resolves it
            through the hook on the screen's behalf. That input is deliberately built in
            one place: it has to match, byte for byte, what the staleness check hashes, and
            when this screen assembled its own copy the two disagreed permanently.
          */
          !f.source.includes('usePublishInput'),
      )
      .map((f) => f.name)
    expect(offenders).toEqual([])
  })
})
