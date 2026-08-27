// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Assignment, Person, Slot } from '../src/domain/types'
import type { VolunteerRequest } from '../src/domain/requests'
import { PAGE, moreLabel } from '../src/domain/paging'

/**
 * Where a volunteer's request goes.
 *
 * The working screens carry an alert about what is waiting. The history lives on its own
 * page, per event, reached by the bell — so closing a request is not the same as losing it.
 */

const SLOTS: Slot[] = [
  { id: 'fri-1700', day: 'fri', startMin: 17 * 60, endMin: 18 * 60, label: '5:00 PM' },
  { id: 'fri-1800', day: 'fri', startMin: 18 * 60, endMin: 19 * 60, label: '6:00 PM' },
]

const people: Person[] = [
  {
    id: 'p-one', firstName: 'Edsger', lastName: 'Dijkstra', section: 'beavers',
    parentName: 'Ada Dijkstra', parentEmail: 'ada@example.org', parentPhone: '519-555-0100',
    pairWithPersonId: null,
  },
]

const shift = (id: string, slotId: string): Assignment => ({
  id, slotId, locationId: 'braemar', personId: 'p-one',
  status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
})

// Reassigned in beforeEach: a test that adds a second shift must not leak into the rest.
let assignments: Assignment[] = []

const markRequestHandled = vi.fn()
const reopenRequest = vi.fn()
const setAssignmentStatusMany = vi.fn()

let requests: VolunteerRequest[] = []

vi.mock('../src/lib/repo', () => ({
  useVolunteerRequests: () => ({ data: requests, loading: false, error: null }),
  usePasses: () => ({
    data: [{ token: 'tok-one', personId: 'p-one', role: 'volunteer' }],
    loading: false,
    error: null,
  }),
  usePeople: () => ({ data: people, loading: false, error: null }),
  useAssignments: () => ({ data: assignments, loading: false, error: null }),
  useLocations: () => ({ data: [{ id: 'braemar', name: 'Braemar' }], loading: false, error: null }),
  markRequestHandled: (...a: unknown[]) => markRequestHandled(...a),
  reopenRequest: (...a: unknown[]) => reopenRequest(...a),
  setAssignmentStatusMany: (...a: unknown[]) => setAssignmentStatusMany(...a),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026', name: 'Apple Day 2026' },
    pathFor: (screen: string) => `/e/2026/${screen}`,
    slots: SLOTS,
  }),
}))

vi.mock('../src/lib/sections', () => ({
  // SectionPill resolves a section id to its name and colour.
  useSections: () => ({
    sections: [],
    lookup: (id: string) => ({ id, name: id, youth: true, order: 1, tone: 'blue', aliases: [] }),
  }),
}))

vi.mock('../src/lib/session', () => ({
  useSession: () => ({ user: { uid: 'organizer' }, role: 'admin' }),
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canSeeTheEvent: (r: string) => r === 'admin' || r === 'organizer' || r === 'viewer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
}))

const { NotificationsScreen } = await import('../src/ui/NotificationsScreen')

const request = (over: Partial<VolunteerRequest> = {}): VolunteerRequest => ({
  id: 'r1', passToken: 'tok-one', kind: 'cancel', slotId: '',
  message: 'soccer runs late', createdAt: 100, handledAt: null, handledBy: '',
  handledByEmail: '',
  ...over,
})

const section = (name: string): HTMLElement =>
  screen.getByRole('heading', { name: new RegExp(name) }).closest('.card')!

beforeEach(() => {
  requests = []
  assignments = [shift('a1', 'fri-1700')]
  for (const fn of [markRequestHandled, setAssignmentStatusMany, reopenRequest]) {
    fn.mockReset()
    fn.mockResolvedValue(undefined)
  }
})

describe('the notifications page', () => {
  it('is about this event, and says so', () => {
    // A request belongs to the Apple Day it was sent about; last year's swap is not
    // something to surface while this year is being run.
    render(<NotificationsScreen />)
    expect(screen.getByText(/for Apple Day 2026/)).toBeTruthy()
  })

  it('separates what is waiting from what has been dealt with', () => {
    requests = [
      request({ id: 'open', message: 'still waiting' }),
      request({ id: 'done', message: 'sorted', handledAt: 200, handledBy: 'organizer' }),
    ]
    render(<NotificationsScreen />)

    expect(within(section('Waiting')).getByText(/still waiting/)).toBeTruthy()
    expect(within(section('Dealt with')).getByText(/sorted/)).toBeTruthy()
  })

  it('keeps the history rather than deleting it, and says why', () => {
    requests = [request({ id: 'done', handledAt: 200, handledBy: 'organizer' })]
    render(<NotificationsScreen />)
    expect(screen.getByText(/becomes unresolvable/)).toBeTruthy()
  })

  it('lists both as cards, and the actions live inside them', () => {
    // Every card is a button — it opens. What differs between a waiting one and a dealt-with
    // one is what the card opens *to*, which the modal tests cover.
    requests = [
      request({ id: 'open' }),
      request({ id: 'done', handledAt: 200, handledBy: 'organizer' }),
    ]
    render(<NotificationsScreen />)

    expect(section('Waiting').querySelectorAll('.mail-card')).toHaveLength(1)
    expect(section('Dealt with').querySelectorAll('.mail-card')).toHaveLength(1)
    // Nothing to press without opening one.
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
  })

  it('says plainly when there is nothing in either', () => {
    render(<NotificationsScreen />)
    expect(screen.getByText(/Nothing is waiting on anybody/)).toBeTruthy()
    expect(screen.getByText(/Nothing has been dealt with yet/)).toBeTruthy()
  })

  it('counts each section in its heading', () => {
    requests = [
      request({ id: 'a' }),
      request({ id: 'b' }),
      request({ id: 'done', handledAt: 200, handledBy: 'organizer' }),
    ]
    render(<NotificationsScreen />)
    expect(screen.getByRole('heading', { name: 'Waiting (2)' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Dealt with (1)' })).toBeTruthy()
  })
})


describe('a notification reads like an email', () => {
  const cards = (): HTMLElement[] =>
    Array.from(document.querySelectorAll('.mail-card')) as HTMLElement[]

  it('shows who, what and a line of what they said, without opening it', () => {
    requests = [request({ message: 'soccer runs late, can we move it?' })]
    render(<NotificationsScreen />)

    const card = cards()[0]!
    expect(card.textContent).toContain('Edsger Dijkstra')
    expect(card.textContent).toContain('cannot make it')
    expect(card.textContent).toContain('soccer runs late')
  })

  it('marks the ones still waiting, the way an unread message is marked', () => {
    requests = [
      request({ id: 'open' }),
      request({ id: 'done', handledAt: 200, handledBy: 'organizer' }),
    ]
    render(<NotificationsScreen />)

    const unread = cards().filter((c) => c.className.includes('is-unread'))
    expect(unread).toHaveLength(1)
  })

  it('names the shift when the volunteer named one', () => {
    requests = [request({ slotId: 'fri-1700' })]
    render(<NotificationsScreen />)
    expect(cards()[0]!.textContent).toContain('Friday 5:00 PM')
  })
})

describe('opening one', () => {
  const openFirst = async (): Promise<void> => {
    render(<NotificationsScreen />)
    await userEvent.click(document.querySelector('.mail-card') as HTMLElement)
  }

  it('gives the parent’s number, which is what answering usually needs', async () => {
    requests = [request()]
    await openFirst()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('link', { name: '519-555-0100' }).getAttribute('href')).toBe(
      'tel:519-555-0100',
    )
    expect(within(dialog).getByRole('link', { name: 'ada@example.org' })).toBeTruthy()
    expect(within(dialog).getByText('Ada Dijkstra')).toBeTruthy()
  })

  it('shows what they said in full, not a cut-off line', async () => {
    requests = [request({ message: 'a much longer message than the card can show' })]
    await openFirst()
    expect(within(screen.getByRole('dialog')).getByText(/much longer message/)).toBeTruthy()
  })

  it('lists every shift they are on, with the named one marked', async () => {
    requests = [request({ slotId: 'fri-1700' })]
    await openFirst()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Friday 5:00 PM · Braemar/)).toBeTruthy()
    expect(dialog.querySelector('.shift-list li.is-named')).toBeTruthy()
  })

  it('is where the actions live now', async () => {
    requests = [request()]
    await openFirst()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'No-show, and done' })).toBeTruthy()
  })

  it('takes them off a single shift without closing the request', async () => {
    requests = [request({ slotId: 'fri-1700' })]
    await openFirst()

    await userEvent.click(screen.getByRole('button', { name: 'No-show for this shift' }))
    expect(setAssignmentStatusMany).toHaveBeenCalledWith('2026', ['a1'], 'noShow')
    // Left open: you may still need to find cover for it.
    expect(markRequestHandled).not.toHaveBeenCalled()
  })

  /*
    Three buttons do the same thing to different amounts of the board, and two of them also
    close the request. Labels like "Off all 2", "Mark no-show" and "Off this one" say neither
    how many shifts are affected nor whether the request is being dealt with. Somebody
    clearing a queue on a Friday evening should not have to
    work that out from a tooltip.
  */

  it('says which shifts a button covers, and whether it deals with the request', async () => {
    assignments = [shift('a1', 'fri-1700'), shift('a2', 'fri-1800')]
    requests = [request()]
    await openFirst()

    const dialog = screen.getByRole('dialog')
    // Every shift, and the request closed with it.
    expect(within(dialog).getByRole('button', { name: 'No-show for all 2, and done' })).toBeTruthy()
    // One shift, and the request left open.
    expect(within(dialog).getAllByRole('button', { name: 'No-show for this shift' })).toHaveLength(2)
  })

  it('takes them off every remaining shift and closes the request', async () => {
    assignments = [shift('a1', 'fri-1700'), shift('a2', 'fri-1800')]
    requests = [request()]
    await openFirst()

    await userEvent.click(screen.getByRole('button', { name: 'No-show for all 2, and done' }))
    expect(setAssignmentStatusMany).toHaveBeenCalledWith('2026', ['a1', 'a2'], 'noShow')
    // The log needs to say what was dealt with, and the request document holds a pass
    // token rather than a person — so the screen passes down what it has already resolved.
    expect(markRequestHandled).toHaveBeenCalledWith(
      '2026',
      'r1',
      'organizer',
      expect.objectContaining({ personId: 'p-one' }),
    )
  })

  it('never labels a button with a bare “off”', () => {
    // The word the report was about. It described the button's effect on the data, not
    // the decision being made, and read as though it removed them from the board.
    requests = [request()]
    render(<NotificationsScreen />)
    for (const button of screen.getAllByRole('button')) {
      expect(button.textContent ?? '').not.toMatch(/\boff\b/i)
    }
  })

  it('marks it dealt with', async () => {
    requests = [request()]
    await openFirst()
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    // The log needs to say what was dealt with, and the request document holds a pass
    // token rather than a person — so the screen passes down what it has already resolved.
    expect(markRequestHandled).toHaveBeenCalledWith(
      '2026',
      'r1',
      'organizer',
      expect.objectContaining({ personId: 'p-one' }),
    )
  })

  it('offers one Close, not two, once it has been dealt with', async () => {
    /*
      A dealt-with request grew a second Close in the dialog body — a `tiny` button wired
      to an `onDismiss` that did exactly what the footer's Close did. Two buttons, the same
      word, the same effect, one above the other.
    */
    requests = [request({ handledAt: 200, handledBy: 'devin' })]
    await openFirst()

    const dialog = screen.getByRole('dialog')
    // The header's ✕ and the footer's Close, as in every dialog in the app, and nothing else.
    // A third in the body puts the same word on two buttons.
    const named = within(dialog)
      .getAllByRole('button')
      .filter((b) => /^close$/i.test((b.textContent ?? '').trim()))
    expect(named).toHaveLength(1)
    expect(within(dialog).getByLabelText('Close')).toBeTruthy()
  })

  it('has exactly one while there are still decisions on it too', async () => {
    requests = [request()]
    await openFirst()

    const dialog = screen.getByRole('dialog')
    const named = within(dialog)
      .getAllByRole('button')
      .filter((b) => /^close$/i.test((b.textContent ?? '').trim()))
    expect(named).toHaveLength(1)
  })

  it('says when and by whom one was dealt with, and offers no buttons', async () => {
    requests = [request({ handledAt: Date.UTC(2026, 9, 2, 9), handledBy: 'devin' })]
    await openFirst()

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Dealt with/)).toBeTruthy()
    expect(within(dialog).getByText(/by devin/)).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'No-show for this shift' })).toBeNull()
  })

  it('says so when the pass no longer matches anybody', async () => {
    requests = [request({ passToken: 'tok-gone' })]
    await openFirst()
    expect(screen.getByText(/no longer matches anybody/)).toBeTruthy()
  })
})

describe('a mailbox with a lot in it', () => {
  const many = (n: number, over: Partial<VolunteerRequest> = {}): VolunteerRequest[] =>
    Array.from({ length: n }, (_, i) =>
      request({ id: `r${i}`, message: `message ${i}`, createdAt: 100 + i, ...over }),
    )

  it('shows a page of the queue, and says how many are behind it', () => {
    requests = many(PAGE + 12)
    render(<NotificationsScreen />)
    const waiting = section('Waiting')
    expect(within(waiting).getAllByRole('button')).toHaveLength(PAGE + 1) // + "show more"
    expect(within(waiting).getByRole('button', { name: moreLabel(12) })).toBeTruthy()
  })

  it('shows the rest when asked', async () => {
    requests = many(PAGE + 12)
    render(<NotificationsScreen />)
    const waiting = section('Waiting')
    await userEvent.click(within(waiting).getByRole('button', { name: /Show/ }))
    expect(within(waiting).getAllByRole('button')).toHaveLength(PAGE + 12)
    expect(within(waiting).queryByRole('button', { name: /^Show/ })).toBeNull()
  })

  it('pages the two sections apart from each other', async () => {
    /*
      Waiting is worked through and Dealt with is only ever browsed, so opening more of one
      has no business opening more of the other — and a single shared count would do exactly
      that the moment a request moved between them.
    */
    requests = [
      ...many(PAGE + 5),
      ...many(PAGE + 5, { handledAt: 900, handledBy: 'organizer' }).map((r) => ({
        ...r,
        id: `${r.id}-done`,
      })),
    ]
    render(<NotificationsScreen />)
    await userEvent.click(within(section('Waiting')).getByRole('button', { name: /Show/ }))
    expect(within(section('Waiting')).queryByRole('button', { name: /^Show/ })).toBeNull()
    expect(within(section('Dealt with')).getByRole('button', { name: /^Show/ })).toBeTruthy()
  })

  it('leaves a short list alone', () => {
    requests = many(3)
    render(<NotificationsScreen />)
    expect(within(section('Waiting')).queryByRole('button', { name: /^Show/ })).toBeNull()
  })
})

describe('who dealt with it', () => {
  it('names them by address rather than by uid', () => {
    /*
      It read "by gtQJ7d2k4jXChdHhHDKCk9n7ZIym" — true, and naming nobody.

      Stored rather than resolved on the way out, unlike the audit log's: the roster is
      admin-readable only and this screen is one organizers work from, so the lookup would
      be denied. Writing it at the time also keeps it right for somebody who has since left.
    */
    requests = [
      request({
        id: 'done',
        handledAt: 200,
        handledBy: 'gtQJ7d2k4jXChdHhHDKCk9n7ZIym',
        handledByEmail: 'devin@example.org',
      }),
    ]
    render(<NotificationsScreen />)
    fireEvent.click(within(section('Dealt with')).getAllByRole('button')[0]!)

    expect(screen.getByText(/by devin@example\.org/)).toBeTruthy()
    expect(screen.queryByText(/gtQJ7d2k4jXChdHhHDKCk9n7ZIym/)).toBeNull()
  })

  it('falls back to the uid on one dealt with before addresses were recorded', () => {
    // Shown rather than hidden: an admin can match it on the access screen, which is more
    // than a blank offers.
    requests = [request({ id: 'old', handledAt: 200, handledBy: 'u-old', handledByEmail: '' })]
    render(<NotificationsScreen />)
    fireEvent.click(within(section('Dealt with')).getAllByRole('button')[0]!)

    expect(screen.getByText(/by u-old/)).toBeTruthy()
  })
})

describe('putting one back in the queue', () => {
  /*
    The way back from the one action here that is otherwise final.

    A queue gets worked through quickly on a Friday evening, so the wrong row gets pressed —
    and a request marked dealt with is off the waiting list, leaving the volunteer who wrote
    in waiting on somebody who believes they have already answered.
  */
  const openDealtWith = async (): Promise<void> => {
    requests = [request({ id: 'done', handledAt: 200, handledBy: 'organizer' })]
    render(<NotificationsScreen />)
    await userEvent.click(document.querySelector('.mail-card') as HTMLElement)
  }

  it('is offered on one already dealt with', async () => {
    await openDealtWith()
    expect(screen.getByRole('button', { name: /Put back in the queue/ })).toBeTruthy()
  })

  it('is not offered on one still waiting, which is already there', async () => {
    requests = [request({ id: 'open' })]
    render(<NotificationsScreen />)
    await userEvent.click(document.querySelector('.mail-card') as HTMLElement)
    expect(screen.queryByRole('button', { name: /Put back in the queue/ })).toBeNull()
  })

  it('reopens that request, and says which it was about', async () => {
    /*
      The log gets two lines that read "dealt with" and then "put back". Without naming who
      wrote in and what they asked for, the second says nothing a reader can match to the
      first.
    */
    await openDealtWith()
    await userEvent.click(screen.getByRole('button', { name: /Put back in the queue/ }))

    expect(reopenRequest).toHaveBeenCalled()
    const [eventId, requestId, about] = reopenRequest.mock.calls[0]! as [
      string,
      string,
      { personId: string; what: string },
    ]
    expect(eventId).toBe('2026')
    expect(requestId).toBe('done')
    expect(about.personId).toBe('p-one')
    expect(about.what).toBeTruthy()
  })

  it('leaves the board alone', async () => {
    // It says nothing about whether anybody is working — only that the request still needs
    // an answer. That is what makes it safe enough to need no confirming.
    await openDealtWith()
    await userEvent.click(screen.getByRole('button', { name: /Put back in the queue/ }))
    expect(setAssignmentStatusMany).not.toHaveBeenCalled()
    expect(markRequestHandled).not.toHaveBeenCalled()
  })

  it('closes the dialog, so the queue is what you are looking at again', async () => {
    await openDealtWith()
    await userEvent.click(screen.getByRole('button', { name: /Put back in the queue/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
