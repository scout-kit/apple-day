// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * A name on screen is a way to get to that person.
 *
 * Day-of and the notification cards linked; the roster, the schedule board, the money
 * table and the counted jars printed plain text. An organizer learns that names are
 * clickable and then finds the places they are not, which is worse than none of them
 * being links.
 *
 * Two rules that hold across screens live here. That each individual name actually renders
 * as a link is asserted against real DOM in each screen's own test, which is the only place
 * that can tell a name inside an anchor from a name beside one.
 */

const SCREENS = [
  'DayOfScreen',
  'JarsScreen',
  'MoneyScreen',
  'NotificationsScreen',
  'PeopleScreen',
  'PersonScreen',
  'ScheduleScreen',
]

const source = (name: string): string => readFileSync(`src/ui/${name}.tsx`, 'utf8')

describe('every name on screen reaches that person', () => {
  it('renders names through the one component, so they all behave alike', () => {
    // Not "some screens link": these six each show a list of people, and every one of them
    // is somewhere an organizer looks somebody up from.
    for (const name of ['DayOfScreen', 'JarsScreen', 'MoneyScreen', 'PeopleScreen', 'ScheduleScreen']) {
      expect(source(name), `${name} shows names but links none of them`).toContain(
        '<PersonLink',
      )
    }
  })

  it('builds every link through pathFor, never by hand', () => {
    /*
      A hand-built `/e/${event.id}/person/...` pins the URL to the event's id, so following
      it from an event reached by its link name jumps to a different shape of URL. The
      person page's own "works alongside" link did exactly that.
    */
    for (const name of [...SCREENS, 'PersonLink']) {
      expect(source(name), `${name} builds a person URL by hand`).not.toMatch(
        /href=\{`\/e\/\$\{/,
      )
    }
    expect(source('PersonLink')).toContain('pathFor(`person/${person.id}`)')
  })

})
