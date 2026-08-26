// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { glob } from 'node:fs/promises'

/**
 * Structural guards for the table layout.
 *
 * jsdom does no layout, so the visual result cannot be asserted here — only the structure
 * the CSS depends on. Two bugs are being guarded against, and the second was caused by the
 * fix for the first:
 *
 *  1. `overflow-x: auto` makes an element a scroll container on both axes, and a sticky
 *     header sticks to its scroll container — so with the page scrolling vertically the
 *     header had nothing to stick to.
 *  2. Bounding the table's height fixed that but created two nested scroll regions. When
 *     the container's bottom edge fell below the viewport, the last rows could not be
 *     reached at all.
 *
 * The resolution is one scroll region per screen: a `.fill` screen is exactly
 * viewport-height and its `.table-card` takes the leftover space, so the table is the only
 * thing that scrolls. Screens that are not `.fill` scroll as a normal page and simply do
 * not pin their header.
 */

async function uiFiles(): Promise<{ path: string; src: string }[]> {
  const out: { path: string; src: string }[] = []
  for await (const path of glob('src/ui/*.tsx')) {
    out.push({ path, src: readFileSync(path, 'utf8') })
  }
  return out
}

const css = readFileSync('src/styles.css', 'utf8')

describe('every table can scroll under a pinned header', () => {
  it('wraps each table in a scroll container', async () => {
    const offenders: string[] = []
    for (const { path, src } of await uiFiles()) {
      for (const match of src.matchAll(/<table>/g)) {
        const before = src.slice(Math.max(0, match.index - 400), match.index)
        if (!/table-wrap|board/.test(before)) {
          offenders.push(`${path}:${src.slice(0, match.index).split('\n').length}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('never makes the padded card the scrollport', async () => {
    const offenders: string[] = []
    for (const { path, src } of await uiFiles()) {
      for (const match of src.matchAll(/className="card [^"]*\b(?:board|table-wrap)\b/g)) {
        offenders.push(`${path}:${src.slice(0, match.index).split('\n').length}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('the stylesheet keeps the parts sticky works with', () => {
  it('gives a filled screen exactly one scroll region', () => {
    // The shell owns the viewport, so the page cannot scroll behind a scrolling table.
    expect(css).toMatch(/\.shell \{[^}]*height: 100dvh/)
    expect(css).toMatch(/\.shell \{[^}]*overflow: hidden/)
    // The table takes the leftover height instead of a guessed max-height.
    expect(css).toMatch(/\.fill > \.table-card > \.table-wrap[\s\S]{0,120}?flex: 1/)
    expect(css).toMatch(/\.fill > \.table-card > \.table-wrap[\s\S]{0,120}?min-height: 0/)
  })

  it('does not bound a table by a guessed viewport calculation', () => {
    // A max-height that has to guess the space above it is what put the container's bottom
    // below the viewport and made the last rows unreachable.
    expect(css).not.toMatch(/\.table-wrap[^{]*\{[^}]*max-height:\s*max\(/)
  })

  it('does not trap scroll chaining on a table', () => {
    // `overscroll-behavior: contain` on a table stopped the page scrolling once the table
    // hit its end, which is what made the last rows unreachable. It is fine elsewhere —
    // the person picker uses it so reaching the end of its list does not scroll the board
    // out from under the panel — so this checks the table rules specifically.
    const tableRules = css.match(/\.(table-wrap|board)[^{]*\{[^}]*\}/g) ?? []
    expect(tableRules.length).toBeGreaterThan(0)
    for (const rule of tableRules) {
      expect(rule, rule).not.toMatch(/overscroll-behavior/)
    }
  })

  it('uses separate borders, so a sticky cell still paints its edge', () => {
    expect(css).toMatch(/border-collapse:\s*separate/)
  })

  it('gives headers an opaque background and a stacking order', () => {
    const rule = /th\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toMatch(/position:\s*sticky/)
    expect(rule).toMatch(/background:\s*var\(--surface\)/)
    expect(rule).toMatch(/z-index/)
  })

  it('offsets a second header row by the height of the first', () => {
    // The signups grid groups hours under a day, so its second row must sit below.
    expect(css).toMatch(/thead tr:nth-child\(2\) th\s*\{\s*top:\s*var\(--th-h\)/)
    expect(css).toMatch(/--th-h:/)
  })

  it('pins the first column on the wide grids', () => {
    expect(css).toMatch(/\.board td:first-child/)
    expect(css).toMatch(/\.sticky-first td:first-child/)
    // A sticky cell has its own background, so the row hover has to be repainted on it.
    expect(css).toMatch(/tbody tr:hover td:first-child/)
  })

  it('unsticks and unclips everything for print', () => {
    const print = /@media print \{[\s\S]*?\n\}/.exec(css)?.[0] ?? ''
    expect(print).toMatch(/max-height:\s*none/)
    expect(print).toMatch(/position:\s*static/)
    // The shell is viewport-height on screen; on paper that would crop the QR sheet to a
    // single page.
    expect(print).toMatch(/\.shell \{[^}]*height: auto/)
    expect(print).toMatch(/\.shell \{[^}]*overflow: visible/)
  })
})

describe('the grids that scroll sideways opt into a pinned first column', () => {
  it('covers the schedule board and the signups grid', async () => {
    const files = await uiFiles()
    const schedule = files.find((f) => f.path.endsWith('ScheduleScreen.tsx'))!
    const people = files.find((f) => f.path.endsWith('PeopleScreen.tsx'))!

    expect(schedule.src).toMatch(/className="table-wrap board"/)
    expect(people.src).toMatch(/className="table-wrap sticky-first"/)
  })
})

describe('the long-list screens fill the viewport', () => {
  const FILLED = [
    'ScheduleScreen.tsx',
    'PeopleScreen.tsx',
    'LibraryScreen.tsx',
    'LocationsScreen.tsx',
  ]

  it('wraps each in a fill container with one flexible table card', async () => {
    const files = await uiFiles()
    for (const name of FILLED) {
      const file = files.find((f) => f.path.endsWith(name))!
      expect(file.src, `${name} should fill`).toMatch(/className="fill"/)
      expect(file.src, `${name} needs a table-card`).toMatch(/className="card table-card"/)
    }
  })

  it('puts the scroll container directly inside the table card', async () => {
    // The CSS uses a child selector, so an extra wrapper would silently stop it flexing
    // and the table would collapse to nothing.
    for (const { path, src } of await uiFiles()) {
      const at = src.indexOf('card table-card')
      if (at === -1) continue
      const after = src.slice(at, at + 500)
      expect(after, path).toMatch(/className="table-wrap/)
    }
  })

  it('leaves multi-table screens scrolling as a normal page', async () => {
    const files = await uiFiles()
    for (const name of ['MoneyScreen.tsx', 'ReconcileScreen.tsx', 'JarsScreen.tsx']) {
      const file = files.find((f) => f.path.endsWith(name))!
      // Filling a screen with several stacked tables would squeeze them all.
      expect(file.src, `${name} should not fill`).not.toMatch(/className="fill"/)
    }
  })
})

describe('long content inside a note on a viewport-filling screen', () => {
  it('bounds the warnings list so it scrolls itself', () => {
    // A `.fill` screen clips overflow, so an expanded list of fifty warnings would run past
    // the bottom of the window with no way to reach the rest.
    const rule = /\.issue-list\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toMatch(/max-height/)
    expect(rule).toMatch(/overflow-y:\s*auto/)
    // Reaching its end must not start scrolling whatever is behind it.
    expect(rule).toMatch(/overscroll-behavior/)
  })

  it('bounds a long inline list of names in a note', () => {
    const rule = /\.note-names\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rule).toMatch(/max-height/)
    expect(rule).toMatch(/overflow-y:\s*auto/)
  })

  it('applies the bounded class to the warnings list', async () => {
    const files = await uiFiles()
    const bits = files.find((f) => f.path.endsWith('Bits.tsx'))!
    expect(bits.src).toMatch(/className="issue-list"/)
    // And not via an inline style, which the stylesheet could not bound.
    expect(bits.src).not.toMatch(/<ul style=\{\{ margin: '0\.4rem 0 0', paddingLeft/)
  })

  it('keeps the notes out of the table rules, so the table still chains its scroll', () => {
    // The table must never contain its own overscroll — that is what made rows unreachable.
    const tableRules = css.match(/\.(table-wrap|board)[^{]*\{[^}]*\}/g) ?? []
    for (const rule of tableRules) expect(rule).not.toMatch(/overscroll-behavior/)
  })
})

describe('a dialog taller than the screen', () => {
  it('bounds the dialog rather than scrolling the backdrop', () => {
    // A scrolling backdrop with a sticky footer let a long form's fields slide past the
    // Cancel and Save buttons and remain visible below them.
    // The declaring rule, not a narrow-screen override that also matches the selector.
    const backdrop =
      (css.match(/\.modal-backdrop\s*\{[^}]*\}/g) ?? []).find((rule) =>
        rule.includes('position: fixed'),
      ) ?? ''
    expect(backdrop).toMatch(/overflow:\s*hidden/)

    const modal = /\.modal\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(modal).toMatch(/max-height/)
    expect(modal).toMatch(/flex-direction:\s*column/)
    expect(modal).toMatch(/min-height:\s*0/)
  })

  it('scrolls only the body, between a fixed header and footer', () => {
    const body = /\.modal-body\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    expect(body).toMatch(/overflow-y:\s*auto/)
    expect(body).toMatch(/flex:\s*1/)
    expect(body).toMatch(/min-height:\s*0/)
    // Reaching its end must not scroll whatever is behind the dialog.
    expect(body).toMatch(/overscroll-behavior/)
  })

  it('keeps the header and footer out of the scroll area', () => {
    // `flex: none` rather than `position: sticky`: a real flex item cannot be scrolled past.
    const head = /\.modal-head\s*\{[^}]*\}/.exec(css)?.[0] ?? ''
    const foot = /\.modal-foot\s*\{[^}]*\}/.exec(css)?.[0] ?? ''

    expect(head).toMatch(/flex:\s*none/)
    expect(head).not.toMatch(/position:\s*sticky/)
    expect(foot).toMatch(/flex:\s*none/)
    expect(foot).not.toMatch(/position:\s*sticky/)
  })

  it('puts narrow-screen overrides after the rules they override', () => {
    // Same specificity means the later rule wins, so an override written above its target
    // silently does nothing.
    const lastDeclaration = css.lastIndexOf('.modal-backdrop {')
    const override = css.lastIndexOf('@media (max-width: 640px)')
    expect(override).toBeGreaterThan(-1)
    expect(override).toBeGreaterThan(css.indexOf('.modal-backdrop {'))
    expect(lastDeclaration).toBeGreaterThan(override)
  })
})

describe('which screens fill the viewport', () => {
  const screenSource = (name: string): string =>
    readFileSync(`src/ui/${name}.tsx`, 'utf8')

  it('leaves the day-of table to scroll with the page', () => {
    /*
      Filling the viewport gives a table whatever is left after the day switch, the base
      line, the warnings and the requests inbox. On a phone on a busy evening, with all of
      those showing, that is one or two rows — so this screen scrolls as a page instead.

      The header no longer sticks, which is the trade: by the third row nobody is reading
      "Who · Shift · Where" anyway, and seeing the list matters more.
    */
    const source = screenSource('DayOfScreen')
    expect(source).not.toMatch(/className="fill"/)
    expect(source).not.toMatch(/sticky-first/)
    expect(source).not.toMatch(/table-card/)
  })

  it('keeps it for the boards where a header far from the rows is unreadable', () => {
    // The schedule board is a grid of hours across locations: the column you are looking at
    // is meaningless without its heading, however far down you have scrolled.
    expect(screenSource('ScheduleScreen')).toMatch(/className="fill"/)
  })
})


describe('where the requests alert appears', () => {
  const screenSource = (name: string): string => readFileSync(`src/ui/${name}.tsx`, 'utf8')

  it('is on every screen somebody stands in front of during the event', () => {
    // Requests arrive while these are open, and a message nobody sees is the same as no
    // message. Jars especially: that is where somebody is all evening.
    for (const name of ['ScheduleScreen', 'DayOfScreen', 'JarsScreen']) {
      expect(screenSource(name), name).toContain('<RequestsInbox />')
    }
  })

  it('is above the first card on each of them', () => {
    for (const name of ['ScheduleScreen', 'DayOfScreen', 'JarsScreen']) {
      const source = screenSource(name)
      expect(source.indexOf('<RequestsInbox />'), name).toBeLessThan(
        source.indexOf('<div className="card"'),
      )
    }
  })

  it('reaches the history through the bell rather than another nav item', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain('NotificationBell')
    expect(app).toMatch(/bell-dot/)
  })
})

describe('form controls fill their label', () => {
  it('includes textareas, not only inputs and selects', () => {
    /*
      A textarea is inline-block by default. Left out of this rule it sat on the same line as
      the label text at its own default width — about twenty columns — so "Anything to add"
      read as a small box shoved to one side rather than a field.
    */
    const rule = css.match(/label > input,[\s\S]*?\}/)?.[0] ?? ''
    expect(rule).toContain('label > textarea')
    expect(rule).toContain('width: 100%')
    expect(rule).toContain('display: block')
  })

  it('gives a textarea room to be typed into', () => {
    // Two or three lines, and resizable: somebody explaining why they cannot make Saturday
    // should not be typing into a slot.
    expect(css).toMatch(/label > textarea \{[^}]*min-height/)
    expect(css).toMatch(/label > textarea \{[^}]*resize: vertical/)
  })

  it('covers every textarea the app has, because they all sit in a label', () => {
    for (const name of ['PassPage', 'EventsScreen', 'ReconcileScreen']) {
      const source = readFileSync(`src/ui/${name}.tsx`, 'utf8')
      for (const match of source.matchAll(/<textarea/g)) {
        // The nearest opening tag before it should be a label, not a bare div.
        const before = source.slice(0, match.index)
        expect(before.lastIndexOf('<label'), `${name} textarea outside a label`).toBeGreaterThan(
          before.lastIndexOf('</label>'),
        )
      }
    }
  })
})

describe('columns you navigate by keep their width', () => {
  /*
    Both grids froze a header row and a first column, then let the browser size every
    column from its contents. So a long shop name widened the location column, an hour
    with three people in it widened that hour, and everything else slid sideways
    underneath the parts that were pinned in place. Whatever you were looking at moved.

    The fix is `table-layout: fixed`, with the table exactly as wide as its columns —
    computed from `--cols`, the number the day actually has. It never stretches to fill,
    because a table asked to fill has to put the surplus somewhere and every choice of
    where makes one day differ from the other.
  */

  it('sizes the schedule board from the grid, not from what is in it', () => {
    expect(css).toMatch(/\.board table \{[^}]*table-layout: fixed/)
    expect(css).toMatch(/\.board th\.slot \{[^}]*width: var\(--slot-col\)/)
  })

  it('makes every column a plain width, so no day can differ from another', () => {
    // A percentage anywhere in here means a column sized against the table rather than in
    // its own right, which is how both earlier attempts ended up day-dependent.
    for (const rule of [
      '\\.board th\\.loc',
      '\\.board th\\.slot',
      '\\.grid-table thead th:not\\(\\.sticky-name\\)',
    ]) {
      const block = css.match(new RegExp(`${rule} \\{[^}]*\\}`))?.[0] ?? ''
      expect(block, `${rule} not found`).not.toBe('')
      expect(block, `${rule} is sized against the table, not in its own right`).not.toMatch(
        /100%/,
      )
      expect(block).toMatch(/width: var\(--/)
    }
  })

  it('sizes the by-hour grids the same way', () => {
    expect(css).toMatch(/\.grid-table \{[^}]*table-layout: fixed/)
    expect(css).toMatch(/\.grid-table th\.sticky-name[\s\S]{0,400}?width: var\(--name-col\)/)
  })

  it('never stretches the board, whose two days are compared against each other', () => {
    /*
      Two goes at this got it wrong in opposite directions. Sharing the surplus among all
      columns gave Friday 12.8rem hours against Saturday's 9.5rem. Giving it all to the
      location column gave Friday a 24.75rem location against Saturday's 13rem. A table
      that fills its container has to put the spare width somewhere, and on the board there
      is nowhere to put it that does not make a four-hour day look unlike an eight-hour one.
    */
    const block = css.match(/\.board table \{[^}]*\}/)?.[0] ?? ''
    expect(block, 'the board should not fill its container').not.toMatch(/max\(100%/)
    expect(block).toMatch(/width: calc\(var\(--[a-z-]+\) \+ var\(--[a-z-]+\) \* var\(--cols/)
  })

  it('does stretch the comparison grids, which are read on their own', () => {
    /*
      The opposite call, for the opposite reason. There is nothing to flip between here, so
      a column width nobody can check costs nothing — while three years of locations came
      out 640px wide in a 1136px card, which is half the page given over to nothing.
    */
    const block = css.match(/\.grid-table \{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(block).toMatch(/width: max\(100%, var\(--grid-width\)\)/)
    // The floor still holds, so a wide one scrolls rather than squeezing.
    expect(block).toMatch(/min-width: var\(--grid-width\)/)
  })

  it('counts the columns in the component, not with arithmetic buried in the CSS', () => {
    /*
      `--cols` is every column after the frozen one. Taking the hour count and adding one for
      the trailing total inside the calc goes wrong silently the day a grid grows a second
      trailing column: the table comes out narrower than its columns
      and they all squeeze.
    */
    expect(css).not.toMatch(/var\(--cols[^)]*\)\s*\+\s*1/)
    expect(css).not.toMatch(/--slots/)
  })

  it('leaves no content-driven minimum behind to fight the fixed width', () => {
    // `min-width` on a cell overrides a fixed column, which would put the old behaviour
    // straight back while the rules above still read as though it were fixed.
    const board = css.match(/\.board table \{[\s\S]*?\.chip \{/)?.[0] ?? ''
    expect(board).not.toMatch(/\.board (th|td)[^{]*\{[^}]*min-width/)
  })

  it('is handed the column count by every screen that uses one', async () => {
    // A grid rendered without `--slots` falls back to a guess, so the table would be the
    // wrong width rather than obviously broken — worth catching here.
    for (const { path, src } of await uiFiles()) {
      if (!/className="grid-table"|className="table-wrap board"/.test(src)) continue
      expect(src, `${path} renders a fixed grid without --cols`).toContain("'--cols'")
    }
  })

  it('wraps a long name instead of letting it spill into the next column', () => {
    // A fixed column cannot grow, so anything that will not fit has to break.
    expect(css).toMatch(/\.board \.locname \{[^}]*overflow-wrap: anywhere/)
    expect(css).toMatch(/\.chip > span:first-child \{[^}]*overflow-wrap: anywhere/)
    // A flex item will not shrink below its content without this, so the × gets pushed out.
    expect(css).toMatch(/\.chip > span:first-child \{[^}]*min-width: 0/)
  })
})

describe('the columns are wide enough for what actually goes in them', () => {
  /*
    Sized against the real list, not guessed at. Nineteen locations run 25 to 57 characters
    with a median of 32; volunteer names reach 15 at the eightieth percentile, and sit in a
    chip beside a section pill and a remove button.

    These assert the numbers rather than the rendering — jsdom does no layout — so they are
    really a note that the widths mean something, and a prompt to re-measure rather than
    nudge if they stop being enough.
  */

  const varOf = (name: string): number => {
    const raw = css.match(new RegExp(`${name}:\\s*([\\d.]+)rem`))?.[1]
    expect(raw, `${name} should be set in rem`).toBeDefined()
    return Number(raw)
  }

  it('fits a typical location name on one line', () => {
    // 0.47rem a character at 0.9rem semibold, plus 1.2rem of cell padding.
    const needed = 34 * 0.47 + 1.2
    expect(varOf('--loc-col')).toBeGreaterThanOrEqual(needed)
  })

  it('fits one in the comparison grids too, which hold the same names', () => {
    // These were 12rem, which cut the longer names off.
    expect(varOf('--name-col')).toBeGreaterThanOrEqual(34 * 0.47 + 1.2)
  })

  it('fits the heading, which is wider than any figure under it', () => {
    /*
      Sized twice from the figures and clipped twice. A money cell wants 5.4rem, but an hour
      is written as a range — "10:00 AM – 11:00 AM", nineteen characters — and these
      headings do not wrap.
    */
    expect(varOf('--col')).toBeGreaterThanOrEqual(19 * 0.47 + 1.2)
  })

  it('fits a name, its section and the remove button on one line', () => {
    // 15 characters at 0.8rem, the widest pill, two gaps, the button, and the padding.
    const needed = 15 * 0.4 + 0.25 + 4.3 + 0.25 + 1.0 + 0.65 + 0.13 + 0.5
    expect(varOf('--slot-col')).toBeGreaterThanOrEqual(needed)
  })

  it('keeps Friday inside the card without scrolling', () => {
    /*
      The ceiling is not the screen — `main` is capped at 1200px however wide the monitor
      is, and `main` and `.card` take a rem of padding each side apiece. Friday's four
      hours should fit inside what is left; Saturday's eight cannot and never will.
    */
    const cap = Number(css.match(/max-width: (\d+)px/)?.[1]) / 16
    const usable = cap - 2 - 2
    expect(usable).toBeCloseTo(71, 1)

    const friday = varOf('--loc-col') + varOf('--slot-col') * 4
    expect(friday).toBeLessThanOrEqual(usable)
  })
})

describe('the day above the hour', () => {
  it('is centred over its column, not pushed to the edge with the figures', () => {
    /*
      The heading cell is right-aligned so the times line up with the money underneath, and
      that dragged the day label to the right-hand edge with them — where it read as though
      it belonged to the column after it.
    */
    expect(css).toMatch(/\.grid-table th \.hour-day \{[^}]*text-align: center/)
    expect(readFileSync('src/ui/MoneyScreen.tsx', 'utf8')).toContain('hour-day')
  })
})
