// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetUrl } from './helpers/url'
import type { AuditEntry } from '../src/domain/audit'
import { AUDIT_PAGE } from '../src/domain/paging'

/**
 * Reading back who changed what.
 *
 * One conversation built this: the shop says they handed over $180 and the sheet says $80.
 * The screen has to answer it without anybody knowing what a document id is.
 */

let entries: AuditEntry[] = []
let loading = false
/** How much of the log the screen last asked Firestore for. */
let asked = 0
/** And which entries it asked for. */
let askedScope = ''

/*
  The screen resolves ids to names as it reads, so the library and the roster come with it.
  Nothing here is about Firestore: the entry stores `sobeys`, the reader wants "Sobeys".
*/
vi.mock('../src/lib/repo', () => ({
  useAuditLog: (window: number, scope: string) => {
    /*
      The mock honours the window rather than ignoring it, because the window is the thing
      under test: the screen has one control for both what it fetches and what it renders,
      and a mock that returned everything regardless would let that control be wired to
      nothing at all and still pass.
    */
    asked = window
    askedScope = scope
    return { data: entries.slice(0, window), loading, error: null }
  },
  useLocationLibrary: () => ({
    data: [{ id: 'sobeys', name: 'Sobeys' }],
    loading: false,
    error: null,
  }),
  usePeople: () => ({
    data: [{ id: 'y01', firstName: 'Elliot', lastName: 'R' }],
    loading: false,
    error: null,
  }),
  // The log names organizers by address, resolved through the access list.
  useRoster: () => ({
    data: [
      { uid: 'u1', email: 'devin@example.org', tier: 'admin' },
      { uid: 'u-other', email: 'other@example.org', tier: 'organizer' },
    ],
    loading: false,
    error: null,
  }),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    eventId: '2026',
    slots: [{ id: 'fri-1700', label: '5:00 PM', day: 'fri', startMin: 1020, endMin: 1080 }],
  }),
}))

const { AuditScreen } = await import('../src/ui/AuditScreen')

const entry = (over: Partial<AuditEntry> & { id: string }): AuditEntry => ({
  at: Date.UTC(2026, 9, 3, 14, 30),
  by: 'u1', byName: 'Devin', byEmail: 'devin@example.org',
  action: 'updated', entity: 'jar', entityId: 'fri-12',
  eventId: '2026', summary: 'Counted jar 12 at $180.00', changes: [],
  ...over,
})

beforeEach(() => {
  resetUrl()
  loading = false
  asked = 0
  askedScope = ''
  entries = [
    entry({
      id: 'e2',
      at: 2,
      summary: 'Counted jar 12 at $180.00',
      changes: [{ field: 'amount', from: '80', to: '180' }],
    }),
    entry({ id: 'e1', at: 1, action: 'deleted', summary: 'Deleted jar 4, which held $60.00' }),
  ]
})

describe('the log on screen', () => {
  it('shows what a number was before it was changed', () => {
    // The whole point: "$80 → $180", not "the amount was edited".
    render(<AuditScreen />)
    expect(screen.getByText('80')).toBeTruthy()
    expect(screen.getByText('180')).toBeTruthy()
  })

  it('names who did it and when', () => {
    /*
      Both halves, separately: the action heads the card and the name sits at its foot, so
      "Changed by Devin" is no longer one run of text. What matters is that a reader can see
      what happened and who did it on the same card, not the order the words fall in.
    */
    render(<AuditScreen />)
    const card = screen.getAllByRole('listitem')[0]!
    expect(card.textContent).toContain('Changed')
    expect(card.textContent).toContain('by devin@example.org')
  })

  it('puts the most recent first', () => {
    render(<AuditScreen />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]!.textContent).toContain('jar 12')
    expect(items[1]!.textContent).toContain('jar 4')
  })

  it('says plainly that entries cannot be removed', () => {
    /*
      Worth stating on the screen. A log whose readers assume it can be edited is one they
      will not trust when it matters, and this one genuinely cannot be.
    */
    expect(render(<AuditScreen />).container.textContent).toContain('cannot be edited or removed')
  })
})

/**
 * Saying which shift, not just that a shift changed.
 *
 * Reported after the first version: "removed a shift from the board" names no location, no
 * timeslot and no person. The entry keeps ids; the screen is where they become names.
 */
describe('what an entry says it was about', () => {
  beforeEach(() => {
    entries = [
      entry({
        id: 'r1',
        at: 3,
        action: 'deleted',
        entity: 'assignment',
        summary: 'Removed a shift from the board',
        changes: [
          { field: 'personId', from: 'y01', to: '—' },
          { field: 'locationId', from: 'sobeys', to: '—' },
          { field: 'slotId', from: 'fri-1700', to: '—' },
        ],
      }),
    ]
  })

  it('names the person, the place and the hour', () => {
    render(<AuditScreen />)
    expect(screen.getByText('Elliot R · Sobeys · 5:00 PM')).toBeTruthy()
  })

  it('labels the fields the way somebody would say them out loud', () => {
    render(<AuditScreen />)
    const item = screen.getAllByRole('listitem')[0]!
    expect(item.textContent).toContain('Who:')
    expect(item.textContent).toContain('Where:')
    expect(item.textContent).toContain('When:')
  })

  it('can be found by the name on screen, not just the id underneath', async () => {
    // Nobody searches an audit log for "y01".
    render(<AuditScreen />)
    await userEvent.type(screen.getByLabelText('Search the log'), 'Elliot')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('finding one thing in it', () => {
  it('narrows to what was asked for', async () => {
    render(<AuditScreen />)
    await userEvent.type(screen.getByLabelText('Search the log'), 'jar 4')

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(1)
    expect(items[0]!.textContent).toContain('jar 4')
  })

  it('says when a search matches nothing, rather than looking empty', async () => {
    render(<AuditScreen />)
    await userEvent.type(screen.getByLabelText('Search the log'), 'zzz')
    expect(screen.getByText('Nothing here matches that.')).toBeTruthy()
  })

  it('distinguishes an empty log from a search that found nothing', () => {
    entries = []
    render(<AuditScreen />)
    expect(screen.getByText('Nothing has been changed yet this event.')).toBeTruthy()
  })
})

describe('a log with no end to it', () => {
  /** `n` entries, newest first, all on the same day. */
  const many = (n: number): AuditEntry[] =>
    Array.from({ length: n }, (_, i) =>
      entry({ id: `e${i}`, at: Date.UTC(2026, 9, 3, 14, 30) - i, summary: `Change ${i}` }),
    )

  it('shows a page of it, not all of it', () => {
    entries = many(260)
    render(<AuditScreen />)
    expect(screen.getAllByRole('listitem')).toHaveLength(AUDIT_PAGE)
  })

  it('asks for more only when more is asked for', async () => {
    entries = many(260)
    render(<AuditScreen />)
    expect(asked).toBe(AUDIT_PAGE)

    await userEvent.click(screen.getByRole('button', { name: /older changes/ }))
    expect(asked).toBe(AUDIT_PAGE * 2)
    expect(screen.getAllByRole('listitem')).toHaveLength(AUDIT_PAGE * 2)
  })

  it('stops offering older ones once a short page comes back', () => {
    /*
      A short page is the only honest end-marker. Counting is not available — the screen
      never learns how many entries exist — so it keeps offering until Firestore returns
      fewer than were asked for.
    */
    entries = many(AUDIT_PAGE - 1)
    render(<AuditScreen />)
    expect(screen.queryByRole('button', { name: /older changes/ })).toBeNull()
  })

  it('warns that a search only covers what has been read', async () => {
    /*
      Otherwise an empty result reads as an answer. "No such jar" and "that jar is further
      back than we have fetched" look identical, and only one of them is true.
    */
    entries = many(260)
    render(<AuditScreen />)
    await userEvent.type(screen.getByLabelText('Search the log'), 'sobeys')
    expect(screen.getByText(/Searching the .* most recent changes/)).toBeTruthy()
  })

  it('cuts the log into days', () => {
    entries = [
      entry({ id: 'sat', at: Date.UTC(2026, 9, 3, 14, 30), summary: 'On the Saturday' }),
      // Both stamped at midday UTC: the grouping is by local day, and a late-evening UTC
      // stamp would fall on the next day east of Greenwich and break the test there.
      entry({ id: 'fri', at: Date.UTC(2026, 9, 2, 14, 0), summary: 'On the Friday' }),
    ]
    render(<AuditScreen />)
    const days = screen.getAllByRole('heading', { level: 2 })
    expect(days).toHaveLength(2)
    expect(days[0]!.textContent).toMatch(/October 3, 2026/)
    expect(days[1]!.textContent).toMatch(/October 2, 2026/)
  })
})

describe('naming whoever did it', () => {
  it('does not name the same person twice', () => {
    /*
      Reported verbatim from the log:

        Changed · Marked a volunteer request dealt with
        handledBy: — → gtQJ7d2k4jXChdHhHDKCk9n7ZIym
        by Devin

      Every entry already carries who did it. Recording the same person a second time as a
      changed field named the organizer twice and the request not at all. Newer entries do
      not record it; older ones do, and are read this way rather than rewritten — the log
      cannot be edited, which is the whole point of it.
    */
    entries = [
      entry({
        id: 'h1',
        by: 'u1',
        summary: 'Dealt with a request',
        changes: [{ field: 'handledBy', from: '—', to: 'u1' }],
      }),
    ]
    render(<AuditScreen />)

    const card = screen.getAllByRole('listitem')[0]!
    expect(card.textContent).not.toContain('Dealt with by')
    expect(card.textContent).not.toContain('u1')
    expect(card.textContent!.match(/devin@example\.org/g)).toHaveLength(1)
  })

  it('still resolves a uid that names somebody else', () => {
    // Somebody undoing another organizer's decision is exactly what the log is for, and
    // there the field is not a repetition — it is the point.
    entries = [
      entry({
        id: 'h2',
        by: 'u1',
        changes: [{ field: 'countedBy', from: '—', to: 'u-other' }],
      }),
    ]
    render(<AuditScreen />)

    const card = screen.getAllByRole('listitem')[0]!
    expect(card.textContent).toContain('Counted by')
    expect(card.textContent).toContain('other@example.org')
  })

  it('falls back to what the entry stored when somebody has left the roster', () => {
    // Removed from the access list a year ago. The address on the entry is the last thing
    // anybody recorded about them, and it beats a uid.
    entries = [entry({ id: 'gone', by: 'u-old', byEmail: 'left@example.org' })]
    render(<AuditScreen />)
    expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('by left@example.org')
  })

  it('falls back again to the name on entries written before addresses were recorded', () => {
    entries = [entry({ id: 'old', by: 'u-old', byEmail: '', byName: 'Someone Else' })]
    render(<AuditScreen />)
    expect(screen.getAllByRole('listitem')[0]!.textContent).toContain('by Someone Else')
  })

  it('can be searched by address', async () => {
    entries = [entry({ id: 'a' }), entry({ id: 'b', by: 'u-other', byEmail: 'other@example.org' })]
    render(<AuditScreen />)
    await userEvent.type(screen.getByLabelText('Search the log'), 'other@')
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })
})

describe('the log is not only about one Apple Day', () => {
  it('reads everything by default', async () => {
    /*
      The flaw this fixes: the library, the sections and the access list are shared between
      every year and are written with no event against them, so an event-scoped query could
      never match one. A shop being renamed, or somebody being granted access, was on the
      record and on no screen — and you cannot narrow to something you do not know is there.
    */
    render(<AuditScreen />)
    expect(askedScope).toBe('all')
  })

  it('can be narrowed to this event, or to the shared setup', async () => {
    render(<AuditScreen />)
    const picker = screen.getByLabelText('Showing')

    await userEvent.selectOptions(picker, 'shared')
    expect(askedScope).toBe('shared')

    await userEvent.selectOptions(picker, 'event')
    expect(askedScope).toBe('event')
  })

  it('says which event an entry belongs to when it is not this one', () => {
    entries = [
      entry({ id: 'here', eventId: '2026', summary: 'This year' }),
      entry({ id: 'last', eventId: '2025', summary: 'Last year' }),
      entry({ id: 'shared', eventId: null, summary: 'Renamed a shop' }),
    ]
    render(<AuditScreen />)
    const cards = screen.getAllByRole('listitem')

    // Unmarked: it happened to the event on screen, which is the whole context.
    expect(cards[0]!.querySelector('.pill')).toBeNull()
    expect(cards[1]!.querySelector('.pill')!.textContent).toBe('2025')
    expect(cards[2]!.querySelector('.pill')!.textContent).toBe('shared setup')
  })

  it('goes back to the first page when the scope changes', async () => {
    // The old window is a count of different entries, so carrying it over would ask for
    // four hundred of something else.
    entries = Array.from({ length: 300 }, (_, i) => entry({ id: `e${i}`, at: 300 - i }))
    render(<AuditScreen />)
    await userEvent.click(screen.getByRole('button', { name: /older changes/ }))
    expect(asked).toBe(AUDIT_PAGE * 2)

    await userEvent.selectOptions(screen.getByLabelText('Showing'), 'shared')
    expect(asked).toBe(AUDIT_PAGE)
  })
})
