// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRoute } from './helpers/router'
import type { Assignment, Person, ScheduledLocation, Slot } from '../src/domain/types'

/**
 * Saying that the published schedule no longer matches the board.
 *
 * The banner on the board and on Publish covers the screen somebody is most likely to be
 * on when they change a shift. It does not cover the rest: a surname is corrected on the
 * roster, an address in the library, a phone number on the event — each changes every pass
 * that was already sent, and none of those screens would have said a word. So the bar
 * carries it too.
 */

const SLOTS: Slot[] = [
  { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00 PM' },
]

let locations: ScheduledLocation[] = [
  {
    id: 'sobeys', name: 'Sobeys', address: '640 Parkside', mapsUrl: '', lat: null, lng: null, groupCode: '',
    siteContact: null, insurance: '', comments: '', aliases: [],
    active: true, priority: 1, openHours: { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null },
  },
]

let people: Person[] = [
  {
    id: 'p-one', firstName: 'Alpha', lastName: 'One', section: 'cubs',
    parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  },
]

let assignments: Assignment[] = [
  {
    id: 'a1', slotId: 'fri-1700', locationId: 'sobeys', personId: 'p-one',
    status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
  },
]

let publishState:
  | { publishedAt: number; fingerprint: string; currentFingerprint: string }
  | null = null
let loading = false

/** Counted, so a test can assert what the flag in the bar does and does not subscribe to. */
const reads = { locations: 0, people: 0, assignments: 0, base: 0 }
const recorded = vi.fn()

/*
  While loading, the collections are empty — which is the point.

  A fixture that hands over the full data and merely says `loading: true` cannot catch the
  bug this guards against: the fingerprint would match anyway, so dropping the loading
  check would change nothing and the test would pass either way.
*/
vi.mock('../src/lib/repo', () => ({
  useLocations: () => {
    reads.locations += 1
    return { data: loading ? [] : locations, loading, error: null }
  },
  usePeople: () => {
    reads.people += 1
    return { data: loading ? [] : people, loading, error: null }
  },
  useAssignments: () => {
    reads.assignments += 1
    return { data: loading ? [] : assignments, loading, error: null }
  },
  useBaseLocation: () => {
    reads.base += 1
    return { data: null, loading, error: null }
  },
  usePublishState: () => ({ data: publishState, loading, error: null }),
  recordPublishFingerprint: (eventId: string, fingerprint: string) => {
    recorded(eventId, fingerprint)
    return Promise.resolve()
  },
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    eventId: '2026',
    event: { id: '2026', support: [], supportNote: '', arrivalNote: '' },
    slots: SLOTS,
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
  eventLinkFor: () => '2026',
}))

vi.mock('../src/lib/sections', () => ({
  useSections: () => ({ sections: [], lookup: () => ({ name: 'Cubs' }) }),
}))

const { PublishWatch, RepublishFlag, RepublishNotice } = await import(
  '../src/ui/PublishNotice',
)
const { publishedFingerprint } = await import('../src/domain/publishing')

const input = () => ({
  locations, people, assignments, slots: SLOTS,
  support: [], supportNote: '', arrivalNote: '', base: null,
})

const matching = (): string => publishedFingerprint(input())

const renderFlag = (): void => {
  render(
    <MemoryRoute path="*" url="/e/2026/people">
      <RepublishFlag />
    </MemoryRoute>,
  )
}

const BASE_LOCATIONS = [...locations]
const BASE_PEOPLE = [...people]
const BASE_ASSIGNMENTS = [...assignments]

beforeEach(() => {
  publishState = null
  loading = false
  reads.locations = 0
  reads.people = 0
  reads.assignments = 0
  reads.base = 0
  recorded.mockClear()
  // Restored every time: these tests add and remove people, and a leak between them would
  // make the fingerprint comparisons meaningless.
  locations = [...BASE_LOCATIONS]
  people = [...BASE_PEOPLE]
  assignments = [...BASE_ASSIGNMENTS]
})

describe('the flag in the bar', () => {
  it('is absent before anything has been published', () => {
    renderFlag()
    expect(screen.queryByText('Re-publish')).toBeNull()
  })

  it('is absent while the published copy still matches', () => {
    publishState = { publishedAt: 1, fingerprint: matching(), currentFingerprint: matching() }
    renderFlag()
    expect(screen.queryByText('Re-publish')).toBeNull()
  })

  it('appears once the board has moved on, wherever you are', () => {
    // Rendered here on the roster route, which has no banner of its own.
    publishState = { publishedAt: 1, fingerprint: 'stale', currentFingerprint: matching() }
    renderFlag()

    const flag = screen.getByText('Re-publish')
    // The board, since that is where publishing lives now.
    expect(flag.getAttribute('href')).toBe('/e/2026/schedule-board')
  })

  it('says nothing while the data is still arriving', () => {
    /*
      A half-read document says "never published", so without this the flag would flicker on
      every page load — which is how a warning becomes something people click past.
    */
    loading = true
    publishState = { publishedAt: 1, fingerprint: 'stale', currentFingerprint: matching() }
    renderFlag()
    expect(screen.queryByText('Re-publish')).toBeNull()
  })

  it('costs one document, not the whole schedule', () => {
    /*
      The flag is in the bar, so it renders on all seventeen screens. Working the hash out
      here meant subscribing to every location, person and assignment to do it — opening the
      checklist read a few hundred documents to decide whether to draw one small link.

      The board records the hash; this compares two strings on the one document it already
      needs for `publishedAt`.
    */
    publishState = { publishedAt: 1, fingerprint: 'stale', currentFingerprint: matching() }
    renderFlag()

    expect(screen.getByText('Re-publish')).toBeTruthy()
    expect(reads).toEqual({ locations: 0, people: 0, assignments: 0, base: 0 })
  })
})

/**
 * Keeping the recorded hash true to the board.
 *
 * Mounted beside the screens that hold this data for their own reasons, so the hash costs
 * nothing extra — and on more than the board, because a surname corrected on the roster
 * changes every pass just as surely as a swapped shift does.
 */
describe('recording what the board hashes to', () => {
  const renderWatch = (): void => {
    render(
      <MemoryRoute path="*" url="/e/2026/people">
        <PublishWatch />
      </MemoryRoute>,
    )
  }

  it('writes the hash when the board has moved since it was last recorded', () => {
    publishState = { publishedAt: 1, fingerprint: 'old', currentFingerprint: 'older' }
    renderWatch()
    expect(recorded).toHaveBeenCalledWith('2026', matching())
  })

  it('writes nothing when the recorded hash is already right', () => {
    // A screen left open all day must not write on every render.
    publishState = { publishedAt: 1, fingerprint: 'old', currentFingerprint: matching() }
    renderWatch()
    expect(recorded).not.toHaveBeenCalled()
  })

  it('writes nothing while the data is still arriving', () => {
    /*
      A hash over half-read collections is not the board's. Storing it would put a
      re-publish notice on every other screen until somebody came back to one that records.
    */
    loading = true
    publishState = { publishedAt: 1, fingerprint: 'old', currentFingerprint: 'older' }
    renderWatch()
    expect(recorded).not.toHaveBeenCalled()
  })
})

describe('where the warning appears', () => {
  it('is in the bar, so it is not confined to the two screens that discuss it', () => {
    const app = readFileSync('src/App.tsx', 'utf8')
    expect(app).toContain('<RepublishFlag />')
  })

  it('is on the board and on Publish as a banner that explains itself', () => {
    // On the board, inside the publish controls, beside the button that answers it.
    expect(readFileSync('src/ui/PublishActions.tsx', 'utf8')).toContain('<RepublishNotice')
    expect(readFileSync('src/ui/ScheduleScreen.tsx', 'utf8')).toContain('<PublishActions />')
  })
})

describe('an event published before any of this existed', () => {
  it('says nothing, because there is nothing left to compare', () => {
    /*
      There used to be a fallback: such a publish still stored the public schedule's rows,
      and those could be rebuilt from the board. The public page is gone and its rows with
      it, so `unknown` is the honest answer — and one publish re-establishes the baseline.
    */
    publishState = { publishedAt: 1, fingerprint: '', currentFingerprint: '' }
    assignments = []
    renderFlag()

    expect(screen.queryByText('Re-publish')).toBeNull()
  })
})

describe('publishing and checking must agree', () => {
  /*
    Reported from the running app: publish, change nothing, and it still says the schedule
    is out of date. It said so for ever.

    The cause was two copies of the same input. Publishing passed `event.slug`; the check
    passed `eventLinkFor(event)`, which falls back to the event's id when there is no
    custom link — the ordinary case. Publishing also derived the base's map link from its
    address and the check read the raw field. Either alone makes the two hashes differ on
    every comparison, and nothing about the code said they had to be identical.

    They are now one function. These are source-level checks because the failure was one of
    construction, not behaviour: both sides worked, they simply were not the same.
  */

  const notice = readFileSync('src/ui/PublishNotice.tsx', 'utf8')
  const screen_ = readFileSync('src/ui/PublishActions.tsx', 'utf8')

  it('builds the input in exactly one place', () => {
    expect(notice).toContain('export function usePublishInput')
    expect(screen_).toContain('usePublishInput()')
  })

  it('is the only thing that calls publish', () => {
    // One caller, so there is nowhere else for a second copy of the input to appear.
    const callers = readdirSync('src/ui')
      .filter((f) => f.endsWith('.tsx'))
      .filter((f) => /\bpublish\(/.test(readFileSync(`src/ui/${f}`, 'utf8')))
    expect(callers).toEqual(['PublishActions.tsx'])
  })

  it('does not let the publish screen assemble its own', () => {
    // The fields that differed. Either one reappearing here means there are two copies
    // again, and they will drift.
    expect(screen_).not.toMatch(/slug:\s*event\.slug/)
    expect(screen_).not.toMatch(/supportNote:\s*event\./)
    expect(screen_).not.toMatch(/mapsUrl:\s*mapLink/)
  })

  it('passes the whole input through, adding only what publishing needs', () => {
    // `existingTokens` keeps already-sent links working; it is not part of what is
    // published, and the fingerprint ignores it.
    expect(screen_).toMatch(/\{\s*\.\.\.input,\s*existingTokens\s*\}/)
  })
})

describe('what the notice says has changed', () => {
  /*
    Reported: the arrival note and the support note were edited on the event, the change did
    not reach anybody's pass, and the connection was not obvious. The flag was working —
    both fields are in the fingerprint — but the wording named the schedule, and what had
    changed was neither the schedule nor anything the person editing would call one.
  */
  it('names the passes, which is what a re-publish rewrites', () => {
    publishState = { publishedAt: 1, fingerprint: 'stale', currentFingerprint: matching() }
    render(
      <MemoryRoute path="*" url="/e/2026/schedule-board">
        <RepublishNotice />
      </MemoryRoute>,
    )
    expect(screen.getByText(/What is on the passes has changed/i)).toBeTruthy()
  })

  it('says the same in the flag that sits in the bar', () => {
    publishState = { publishedAt: 1, fingerprint: 'stale', currentFingerprint: matching() }
    renderFlag()
    expect(
      screen.getByText('Re-publish').getAttribute('title'),
    ).toMatch(/passes/i)
  })
})
