import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The shape of the navigation.
 *
 * A source-level check, because the thing worth protecting is a judgement rather than a
 * behaviour: these are three different kinds of screen, and one flat row of fourteen links
 * said they were all the same. What is easy to lose later is not the styling but the
 * grouping — a new screen appended to whichever array is nearest.
 */

const app = readFileSync('src/App.tsx', 'utf8')

/** The source of one named group of the nav. */
function groupSource(label: string): string {
  const start = app.indexOf(`label: '${label}'`)
  expect(start, `no group called ${label}`).toBeGreaterThan(-1)
  return app.slice(start, app.indexOf('\n    ],', app.indexOf('screens: [', start)))
}

/** Every screen in a group. */
function group(label: string): string[] {
  return [...groupSource(label).matchAll(/screen: '([a-z-]+)'/g)].map((m) => m[1]!)
}

/** The screens in a group that an organizer is not offered. */
function adminOnly(label: string): string[] {
  return [...groupSource(label).matchAll(/screen: '([a-z-]+)'[^}]*adminOnly/g)].map(
    (m) => m[1]!,
  )
}

describe('the organizer nav is grouped', () => {
  it('separates running the event from its records, its setup and its admin', () => {
    for (const label of ['Running', 'Records', 'Setup', 'Admin']) {
      expect(group(label).length, label).toBeGreaterThan(0)
    }
  })

  it('puts the screens somebody uses on the night under Running', () => {
    // No 'publish': it was a page holding two buttons, and they sit at the foot of the
    // board now. Everything else it carried had a better home — a volunteer's link and QR
    // on their own page, the jar labels beside the jars.
    //
    // 'reminders' is here rather than under Setup because that is when it is used: the
    // evening before and the morning itself, from the same sitting as the board.
    expect(group('Running')).toEqual([
      'schedule-board', 'people', 'day-of', 'jars', 'reminders',
    ])
  })

  it('puts History with Money rather than with the setup screens', () => {
    // Both answer the same kind of question — what happened, and what it was worth.
    expect(group('Records')).toContain('history')
    expect(group('Records')).toContain('money')
    expect(group('Setup')).not.toContain('history')
  })

  it('puts the once-a-year screens under Setup', () => {
    for (const screen of ['events', 'locations', 'library', 'import']) {
      expect(group('Setup'), screen).toContain(screen)
    }
  })

  it('gathers everything above an organizer under one heading', () => {
    /*
      These were scattered through the other groups behind a per-entry flag, which made the
      menu a different shape for different people with no explanation of why: an organizer
      saw Setup with three of its entries missing and no way to know they existed.

      Under one heading the line is visible — who gets in, what every year is read through,
      and the record of what everybody did.
    */
    expect(group('Admin')).toEqual(['access', 'sections', 'audit'])
    expect(adminOnly('Admin')).toEqual(['access', 'sections', 'audit'])
  })

  it('leaves no admin-only screen outside that heading', () => {
    for (const label of ['Running', 'Records', 'Setup']) {
      expect(adminOnly(label), label).toEqual([])
    }
  })

  it('leaves no screen out of a group', () => {
    /*
      A screen that exists but appears in no group is unreachable from the nav.

      Notifications is the exception: it is reached by the bell in the top bar, because it is
      somewhere to go when something is waiting rather than one of the screens the event is
      run from. Putting it in the nav as well would be two doors to one room.
    */
    const reachedAnotherWay = ['notifications']
    const routed = [...app.matchAll(/\['([a-z-]+)', <\w+Screen/g)]
      .map((m) => m[1]!)
      .filter((screen) => !reachedAnotherWay.includes(screen))
    const inNav = new Set([
      ...group('Running'),
      ...group('Records'),
      ...group('Setup'),
      ...group('Admin'),
    ])
    const missing = routed.filter((screen) => !inNav.has(screen))
    expect(missing).toEqual([])
  })

})

describe('what an organizer is offered', () => {
  it('gets everything for running the event', () => {
    // Nothing in the day-to-day group is above their tier.
    expect(adminOnly('Running')).toEqual([])
  })

  it('gets all of the records', () => {
    /*
      The audit log used to sit here behind a flag. It is a record kept about the people
      running the event rather than one of the event's own records, and it reads better
      under the heading that says so.
    */
    expect(adminOnly('Records')).toEqual([])
  })

  it('gets the setup screens, including the library and the importer', () => {
    /*
      The line moved off "shared between years", which had put the wrong things behind it.
      Finding a shop's address is wrong happens standing outside the shop; importing the
      form is the fiddliest job of the year but not the most dangerous one, and an organizer
      can already add people by hand one at a time.
    */
    for (const screen of ['events', 'locations', 'library', 'import']) {
      expect(adminOnly('Setup'), screen).not.toContain(screen)
    }
  })

  it('is not offered what cannot be undone or noticed later', () => {
    // Who gets in, what every past year is grouped by, and the log of who did what.
    for (const screen of ['access', 'sections', 'audit']) {
      expect(adminOnly('Admin'), screen).toContain(screen)
    }
  })
})

describe('the menu and the routes agree', () => {
  /*
    They did not, and the symptom was ugly: an organizer saw Library and Import in the menu,
    pressed one, and got "not yours". The rules had been opened to them and the menu had
    been opened to them, and the route tier — a third place, in a different array — had not.

    A link that refuses is worse than no link, so the two are checked against each other
    rather than against a list somebody has to remember to update.
  */

  /** Every routed screen with the tier its route demands. */
  const routeTiers = (): Map<string, string> => {
    const tiers = new Map<string, string>()
    for (const m of app.matchAll(/\['([a-z-]+)', <[^>]*?\/?>(?:<\/\w+>)?, (RUNS|ADMIN)\]/g)) {
      tiers.set(m[1]!, m[2]!)
    }
    return tiers
  }

  it('finds a tier for every routed screen', () => {
    // The regex above is the whole test; if it stops matching, everything below passes
    // vacuously. This is what makes that fail instead.
    const routed = [...app.matchAll(/\['([a-z-]+)', <\w+Screen/g)].map((m) => m[1]!)
    const tiers = routeTiers()
    expect(routed.length).toBeGreaterThan(10)
    for (const screen of routed) {
      expect([...tiers.keys()], `no tier found for ${screen}`).toContain(screen)
    }
  })

  it('gives an admin-only screen an admin-only route, and no other', () => {
    const tiers = routeTiers()
    const flagged = new Set(
      ['Running', 'Records', 'Setup', 'Admin'].flatMap((label) => adminOnly(label)),
    )

    for (const [screen, tier] of tiers) {
      // 'notifications' is reached by the bell rather than the menu, so it has no entry to
      // compare against.
      if (screen === 'notifications') continue
      expect(tier, `${screen}: menu says ${flagged.has(screen) ? 'admin' : 'organizer'}`).toBe(
        flagged.has(screen) ? 'ADMIN' : 'RUNS',
      )
    }
  })
})
