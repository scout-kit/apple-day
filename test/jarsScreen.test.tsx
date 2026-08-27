// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { resetUrl } from './helpers/url'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAllSlots } from '../src/domain/slots'
import { forgetRememberedDay } from '../src/lib/dayFilter'
import type { Jar, Person, ScheduledLocation } from '../src/domain/types'

/**
 * Counting jars in, and the destructive actions beside them.
 *
 * Deleting a counted jar removes money from every total, so it asks first. Reopening one
 * clears the counted amount, which is the same loss by another route — one misplaced click on
 * either would otherwise be irreversible.
 */

const deleteJar = vi.fn()
const reopenJar = vi.fn()
const countJar = vi.fn()
const recordMoney = vi.fn()
const unissueJar = vi.fn()

const SLOTS = buildAllSlots()

const locations: ScheduledLocation[] = [
  {
    id: 'braemar', name: 'Braemar', address: '', mapsUrl: '', lat: null, lng: null, groupCode: '',
    siteContact: null, insurance: '', comments: '', aliases: [],
    active: true, priority: 1,
    openHours: { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null },
  },
  {
    id: 'kelmont', name: 'Kelmont', address: '335 Farmers Market Rd', mapsUrl: '', lat: null, lng: null,
    groupCode: '', siteContact: null, insurance: '', comments: '', aliases: [],
    active: true, priority: 2,
    openHours: { fri: { openMin: 17 * 60, closeMin: 21 * 60 }, sat: null },
  },
]

const people: Person[] = [
  {
    id: 'p-one', firstName: 'Alpha', lastName: 'One', section: 'cubs',
    parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  },
  {
    id: 'p-two', firstName: 'Beta', lastName: 'Two', section: 'scouts',
    parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  },
]

let jars: Jar[] = []

vi.mock('../src/lib/repo', () => ({
  countJar: (...a: unknown[]) => countJar(...a),
  deleteJar: (...a: unknown[]) => deleteJar(...a),
  recordMoney: (...a: unknown[]) => recordMoney(...a),
  reopenJar: (...a: unknown[]) => reopenJar(...a),
  unissueJar: (...a: unknown[]) => unissueJar(...a),
  useJars: () => ({ data: jars, loading: false, error: null }),
  // The requests alert rides along on this screen too; empty unless a test says otherwise.
  useVolunteerRequests: () => ({ data: [], loading: false, error: null }),
  usePasses: () => ({ data: [], loading: false, error: null }),
  useAssignments: () => ({ data: [], loading: false, error: null }),
  markRequestHandled: vi.fn(),
  setAssignmentStatusMany: vi.fn(),
  useLocations: () => ({ data: locations, loading: false, error: null }),
  usePeople: () => ({ data: people, loading: false, error: null }),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026', year: 2026 },
    slots: SLOTS,
    // Names on these screens link to the person's page, and the link is built
    // through pathFor so it survives an event reached by its link name.
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
}))

vi.mock('../src/lib/session', () => ({
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
  useSession: () => ({ user: { uid: 'organizer' }, role: 'admin' }),
}))

const { JarsScreen } = await import('../src/ui/JarsScreen')

/** The confirmation dialog. Scoped, because the row behind it repeats the same text. */
const dialog = (): HTMLElement => screen.getByRole('dialog')

const counted = (over: Partial<Jar> & { id: string }): Jar => ({
  jarNumber: 7,
  day: 'fri',
  locationId: 'braemar',
  personId: 'p-one',
  assignmentId: 'a1', assignmentIds: ['a1'],
  status: 'counted',
  issuedAt: 1,
  issuedBy: 'organizer',
  amount: 134.2,
  method: 'cash',
  note: '',
  countedBy: 'baseops',
  countedAt: 2,
  ...over,
})

beforeEach(() => {
  forgetRememberedDay()
  resetUrl()
  // Every mock, not a chosen few: a mock that survives a test makes the next one assert
  // against the previous one's call and pass or fail for the wrong reason.
  for (const fn of [countJar, deleteJar, recordMoney, reopenJar, unissueJar]) {
    fn.mockReset()
    fn.mockResolvedValue(undefined)
  }
  jars = [counted({ id: 'j1' })]
})

describe('deleting a counted jar', () => {
  it('asks first', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(deleteJar).not.toHaveBeenCalled()
    expect(screen.getByText(/Delete jar 7\?/)).toBeDefined()
  })

  it('says what will be lost, and where from', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    const inDialog = within(dialog())
    expect(inDialog.getByText(/\$134\.20/)).toBeDefined()
    expect(inDialog.getByText(/Braemar/)).toBeDefined()
    expect(inDialog.getByText(/removes the amount from every total/)).toBeDefined()
    // And points at the non-destructive option.
    expect(inDialog.getByText(/use Correct instead/)).toBeDefined()
  })

  it('deletes when confirmed', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    // The confirm button, not the row's own Delete.
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Delete' }))

    /*
      The jar, not its id. Deleting one now writes a line saying what it held, and that line
      cannot be written from an id alone — "deleted jar 12, which held $180" is the whole
      point of having the log.
    */
    expect(deleteJar).toHaveBeenCalledWith('2026', expect.objectContaining({ id: 'j1' }))
  })

  it('does nothing when cancelled', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))

    expect(deleteJar).not.toHaveBeenCalled()
    expect(screen.queryByText(/Delete jar 7\?/)).toBeNull()
  })

  it('names money recorded without a jar properly', async () => {
    jars = [counted({ id: 'm1', jarNumber: null, note: 'bushel sales' })]
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByText(/Delete this money\?/)).toBeDefined()
    expect(within(dialog()).getByText(/bushel sales/)).toBeDefined()
  })
})

describe('reopening a counted jar', () => {
  it('asks first, because the counted amount is cleared', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))

    expect(reopenJar).not.toHaveBeenCalled()
    expect(screen.getByText(/Put jar 7 back out\?/)).toBeDefined()
    expect(screen.getByText(/counted amount is cleared/)).toBeDefined()
  })

  it('reopens when confirmed', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Reopen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Put back out' }))

    expect(reopenJar).toHaveBeenCalledTimes(1)
    expect(reopenJar.mock.calls[0]![1]).toMatchObject({ id: 'j1' })
  })
})

describe('taking back a jar that is still out', () => {
  it('does not ask, because no money is at stake', async () => {
    // An uncounted jar holds nothing, and re-issuing it is one click. A dialog at a busy
    // counting table would cost more than it protects.
    jars = [counted({ id: 'j2', status: 'out', amount: null })]
    unissueJar.mockResolvedValue(undefined)
    render(<JarsScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Take back' }))
    expect(unissueJar).toHaveBeenCalledTimes(1)
  })
})

describe('the counted list', () => {
  const table = (): HTMLElement =>
    screen.getByRole('columnheader', { name: 'Where' }).closest('table')!

  const rows = (): string[][] =>
    Array.from(table().querySelectorAll('tbody tr')).map((r) =>
      Array.from(r.querySelectorAll('td')).map((c) => c.textContent!),
    )

  const threeJars = (): void => {
    jars = [
      counted({ id: 'j1', jarNumber: 12, locationId: 'braemar', personId: 'p-one', amount: 100 }),
      counted({ id: 'j2', jarNumber: 3, locationId: 'kelmont', personId: 'p-two', amount: 60 }),
      counted({ id: 'j3', jarNumber: 9, locationId: 'kelmont', personId: null, amount: 20 }),
    ]
  }

  it('gives the location and the person a column each', () => {
    // One cell reading "Braemar · Alpha One" cannot be scanned down or sorted, and reads as
    // one fact rather than two.
    threeJars()
    render(<JarsScreen />)

    const headers = Array.from(table().querySelectorAll('thead th')).map((h) => h.textContent)
    expect(headers).toEqual(['Jar', 'Where', 'Who', 'Amount', 'Method', ''])
    expect(rows()[0]![1]).toContain('Braemar')
    expect(rows()[0]![2]).toBe('Alpha One')
  })

  it('links the youth a jar is against to their own page', () => {
    // Counting jars back in is where a name and a number stop matching, and the first
    // thing you want is the rest of that person's evening.
    threeJars()
    render(<JarsScreen />)

    const link = within(table()).getByRole('link', { name: 'Alpha One' })
    expect(link.getAttribute('href')).toBe('/e/2026/person/p-one')
  })

  it('says plainly when a jar has no youth against it', () => {
    threeJars()
    render(<JarsScreen />)
    const kelmontNoOne = rows().find((r) => r[0]!.startsWith('9'))!
    expect(kelmontNoOne[2]).toBe('not recorded')
  })

  it('finds a jar by its number', async () => {
    // Sixty jars by the end of a Saturday, newest first. Reading down the list is the moment
    // a busy table gives up and writes it on paper instead.
    threeJars()
    render(<JarsScreen />)

    await userEvent.type(screen.getByLabelText('Search counted jars'), '12')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]![1]).toContain('Braemar')
  })

  it('finds jars by location', async () => {
    threeJars()
    render(<JarsScreen />)
    await userEvent.type(screen.getByLabelText('Search counted jars'), 'kelmont')
    expect(rows()).toHaveLength(2)
  })

  it('finds a jar by whose it was', async () => {
    threeJars()
    render(<JarsScreen />)
    await userEvent.type(screen.getByLabelText('Search counted jars'), 'beta')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]![2]).toBe('Beta Two')
  })

  it('takes several words, each of which has to appear somewhere', async () => {
    threeJars()
    render(<JarsScreen />)
    await userEvent.type(screen.getByLabelText('Search counted jars'), '3 kel')
    expect(rows()).toHaveLength(1)
    expect(rows()[0]![0]).toContain('3')
  })

  it('says how many of how many are showing', async () => {
    threeJars()
    render(<JarsScreen />)
    await userEvent.type(screen.getByLabelText('Search counted jars'), 'kelmont')
    expect(screen.getByRole('heading', { name: /Counted \(2 of 3\)/ })).toBeTruthy()
  })

  it('says so when a search matches nothing, rather than looking empty', async () => {
    threeJars()
    render(<JarsScreen />)
    await userEvent.type(screen.getByLabelText('Search counted jars'), 'zzz')
    expect(screen.getByText(/Nothing counted matches “zzz”/)).toBeTruthy()
  })
})

describe('correcting a jar', () => {
  const openCorrection = async (): Promise<void> => {
    jars = [
      counted({
        id: 'j1', jarNumber: 12, locationId: 'braemar', personId: 'p-one',
        amount: 100, note: 'first go', assignmentId: null, assignmentIds: [],
      }),
    ]
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct' }))
  }

  it('opens with everything the jar already says', async () => {
    /*
      An amount and a method alone would mean a jar written against the wrong shop can only be
      corrected by deleting the record and typing it in again, which throws away the audit
      trail for the sake of a typo.
    */
    await openCorrection()
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('100')
    expect(screen.getByRole('button', { name: 'Location' }).textContent).toContain('Braemar')
    expect(screen.getByRole('button', { name: 'Youth' }).textContent).toContain('Alpha One')
    expect((screen.getByLabelText(/^Note/) as HTMLInputElement).value).toBe('first go')
  })

  it('corrects the location it was written against', async () => {
    await openCorrection()
    await userEvent.click(screen.getByRole('button', { name: 'Location' }))
    await userEvent.click(await screen.findByRole('option', { name: /Kelmont/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Record 12$/ }))

    expect(countJar.mock.calls[0]![2]).toMatchObject({ locationId: 'kelmont' })
  })

  it('corrects whose it was', async () => {
    await openCorrection()
    await userEvent.click(screen.getByRole('button', { name: 'Youth' }))
    await userEvent.click(await screen.findByRole('option', { name: /Beta Two/ }))
    await userEvent.click(screen.getByRole('button', { name: /^Record 12$/ }))

    expect(countJar.mock.calls[0]![2]).toMatchObject({ personId: 'p-two' })
  })

  it('takes the youth off a jar that never had one', async () => {
    await openCorrection()
    await userEvent.click(screen.getByRole('button', { name: 'Clear Youth' }))
    await userEvent.click(screen.getByRole('button', { name: /^Record 12$/ }))

    expect(countJar.mock.calls[0]![2]).toMatchObject({ personId: null })
  })

  it('edits the note', async () => {
    await openCorrection()
    const note = screen.getByLabelText(/^Note/)
    await userEvent.clear(note)
    await userEvent.type(note, 'bushel sales')
    await userEvent.click(screen.getByRole('button', { name: /^Record 12$/ }))

    expect(countJar.mock.calls[0]![2]).toMatchObject({ note: 'bushel sales' })
  })

  it('still saves the amount and method, which is the usual path', async () => {
    await openCorrection()
    const amount = screen.getByLabelText('Amount')
    await userEvent.clear(amount)
    await userEvent.type(amount, '125.50')
    await userEvent.click(screen.getByRole('button', { name: /^Record 12$/ }))

    expect(countJar.mock.calls[0]![2]).toMatchObject({ amount: 125.5, method: 'cash' })
  })

  it('warns that moving a jar between youths does not move the hours it was out for', async () => {
    /*
      The shift a jar went out on is a separate record, and the hour-by-hour figures follow
      that. Saying so beats silently doing one or the other.
    */
    jars = [
      counted({
        id: 'j1', jarNumber: 12, locationId: 'braemar', personId: 'p-one',
        amount: 100, assignmentId: 'a1', assignmentIds: ['a1'],
      }),
    ]
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Correct' }))

    expect(screen.queryByText(/hours it was out for stay with the shift/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Youth' }))
    await userEvent.click(await screen.findByRole('option', { name: /Beta Two/ }))
    expect(screen.getByText(/hours it was out for stay with the shift/)).toBeTruthy()
  })

  it('says nothing about shifts for money that was never on one', async () => {
    await openCorrection()
    await userEvent.click(screen.getByRole('button', { name: 'Youth' }))
    await userEvent.click(await screen.findByRole('option', { name: /Beta Two/ }))
    expect(screen.queryByText(/hours it was out for stay with the shift/)).toBeNull()
  })
})

describe('labelling the jars', () => {
  /*
    Moved here from the Publish screen, where it sat beside volunteer passes and location
    cards under one "printable sheet" switch. Labelling tins has nothing to do with
    publishing a schedule — it is a week-before job — and it belongs beside the screen that
    reads the labels back.
  */

  it('is folded away until asked for', () => {
    // This screen is open all day Saturday, and two hundred QR codes is real work.
    render(<JarsScreen />)
    expect(screen.getByRole('button', { name: 'Make labels' })).toBeTruthy()
    expect(document.querySelectorAll('.qr-sheet')).toHaveLength(0)
  })

  it('draws a label per jar once opened', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Make labels' }))

    expect(document.querySelectorAll('.qr-card').length).toBe(40)
    expect(screen.getByText('Jar 1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy()
  })

  it('prints just the ones that need replacing', async () => {
    /*
      The case this is for: three labels peel off in the rain and somebody wants 4, 12 and
      17 — not another forty to get three.
    */
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Make labels' }))

    const which = screen.getByLabelText(/Which jars/)
    await userEvent.clear(which)
    await userEvent.type(which, '12,17,4')

    expect(document.querySelectorAll('.qr-card').length).toBe(3)
    // Printed in an order somebody can file, whatever order they were typed in.
    expect(
      Array.from(document.querySelectorAll('.qr-card .cap')).map((c) => c.textContent),
    ).toEqual(['Jar 4', 'Jar 12', 'Jar 17'])
  })

  it('reads the selection back before it becomes paper', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Make labels' }))

    const which = screen.getByLabelText(/Which jars/)
    await userEvent.clear(which)
    await userEvent.type(which, '1-3, 15')
    expect(screen.getByText('4 labels: 1–3, 15')).toBeTruthy()
  })

  it('says what is wrong instead of printing nothing', async () => {
    render(<JarsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Make labels' }))

    const which = screen.getByLabelText(/Which jars/)
    await userEvent.clear(which)
    await userEvent.type(which, '1-10, banana')

    expect(screen.getByText(/banana/)).toBeTruthy()
    expect(document.querySelectorAll('.qr-card')).toHaveLength(0)
    // And nothing to print, so the button says so.
    expect((screen.getByRole('button', { name: 'Print' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('the two ways to get money in', () => {
  /*
    Reported as looking like toggles that do not toggle.

    A primary button beside a plain one in a row is how this app shows a choice — which day,
    which measure, day or hour. Two *actions* laid out that way read as a toggle with the
    left one selected, so pressing the right one looks like it did nothing.
  */
  it('opens the form when the second one is pressed', async () => {
    render(<JarsScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Record one by hand' }))
    expect(screen.getByRole('heading', { name: 'Record money by hand' })).toBeTruthy()
  })

  it('does not dress them as a choice between two settings', () => {
    /*
      One is the main action and the other is an alternative. Giving the second the same
      weight as an unselected day button is what made it read as a state.
    */
    render(<JarsScreen />)

    const byHand = screen.getByRole('button', { name: 'Record one by hand' })
    expect(byHand.className).toContain('ghost')
    expect(byHand.className).not.toContain('primary')
  })

  it('says "or" between them, so they read as one thing and an alternative', () => {
    render(<JarsScreen />)
    const row = screen.getByRole('button', { name: 'Scan a jar' }).closest('.row')!
    expect(row.textContent).toMatch(/Scan a jar\s*or\s*Record one by hand/)
  })
})
