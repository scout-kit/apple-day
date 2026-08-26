// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { resetUrl } from './helpers/url'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAllSlots } from '../src/domain/slots'
import type { Assignment, Person, Signup } from '../src/domain/types'

/**
 * The signups roster.
 *
 * The workbook kept this on a hidden sheet with availability as comma-joined text, so
 * answering "who is free at 6pm and not already booked" meant reading down a column by
 * eye. These tests pin the two things that makes it useful: the per-hour grid, and the
 * filters that narrow it to the person you are looking for.
 */

const savePersonWithPairing = vi.fn()
const saveAvailability = vi.fn()
const removeFromEvent = vi.fn()
const deletePerson = vi.fn()
const SLOTS = buildAllSlots()

let people: Person[] = []
let signups: Signup[] = []
let assignments: Assignment[] = []

vi.mock('../src/lib/repo', () => ({
  savePersonWithPairing: (...args: unknown[]) => savePersonWithPairing(...args),
  saveAvailability: (...args: unknown[]) => saveAvailability(...args),
  removeFromEvent: (...args: unknown[]) => removeFromEvent(...args),
  deletePerson: (...args: unknown[]) => deletePerson(...args),
  usePeople: () => ({ data: people, loading: false, error: null }),
  useSignups: () => ({ data: signups, loading: false, error: null }),
  useAssignments: () => ({ data: assignments, loading: false, error: null }),
  useLocations: () => ({
    data: [{ id: 'braemar', name: 'Braemar' }],
    loading: false,
    error: null,
  }),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026', name: 'Apple Day 2026', year: 2026 },
    slots: SLOTS,
    // Names on these screens link to the person's page, and the link is built
    // through pathFor so it survives an event reached by its link name.
    pathFor: (screen: string) => `/e/2026/${screen}`,
  }),
}))

vi.mock('../src/lib/csv', () => ({ downloadFile: vi.fn(), toCsv: vi.fn(() => '') }))

const { PeopleScreen } = await import('../src/ui/PeopleScreen')
const { PersonEditor } = await import('../src/ui/PersonEditor')

const person = (over: Partial<Person> & { id: string }): Person => ({
  firstName: 'A', lastName: 'Person', section: 'cubs',
  parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
  ...over,
})

/**
 * A person's own row.
 *
 * Matched on the first cell only: a paired person's row also names their partner, so a
 * document-wide text search finds two rows.
 */
const rowFor = (name: string): HTMLElement => {
  const rows = Array.from(document.querySelectorAll<HTMLTableRowElement>('tbody tr'))
  const found = rows.find((r) =>
    r.querySelector('td')?.textContent?.includes(name),
  )
  if (!found) throw new Error(`no row for ${name}`)
  return found
}

/** The picker's search box. A `<select>` also reports as a combobox, so scope it. */
const pickerSearch = (): HTMLElement =>
  screen.getByRole('combobox', { name: /^Search people for/ })

beforeEach(() => {
  resetUrl()
  savePersonWithPairing.mockReset()
  savePersonWithPairing.mockResolvedValue(undefined)
  saveAvailability.mockReset()
  saveAvailability.mockResolvedValue(undefined)
  removeFromEvent.mockReset()
  removeFromEvent.mockResolvedValue(undefined)
  deletePerson.mockReset()
  deletePerson.mockResolvedValue(undefined)
  people = [
    person({ id: 'p-free', firstName: 'Freda', lastName: 'Available', section: 'scouts',
      parentEmail: 'freda@example.org' }),
    person({ id: 'p-busy', firstName: 'Ben', lastName: 'Booked', section: 'cubs',
      parentPhone: '519-555-0100' }),
    person({ id: 'p-quiet', firstName: 'Quinn', lastName: 'Quiet', section: 'beavers' }),
  ]
  signups = [
    {
      id: 's1', personId: 'p-free',
      availability: { fri: ['fri-1700', 'fri-1800'], sat: [] },
      attendingWithYouth: true, notes: '', sourceRow: 2, importedAt: 0,
    },
    {
      id: 's2', personId: 'p-busy',
      availability: { fri: ['fri-1700'], sat: ['sat-0900'] },
      attendingWithYouth: false, notes: '', sourceRow: 3, importedAt: 0,
    },
  ]
  assignments = [
    {
      id: 'a1', slotId: 'fri-1700', locationId: 'braemar', personId: 'p-busy',
      status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
    },
  ]
})

describe('the roster', () => {
  it('shows everyone on record by default', () => {
    // Availability is set here as well as imported, so somebody who never filled the form
    // in is exactly who needs finding — hiding them by default hid the work.
    render(<PeopleScreen />)
    expect(screen.getByText(/Freda Available/)).toBeDefined()
    expect(screen.getByText(/Ben Booked/)).toBeDefined()
    expect(screen.getByText(/Quinn Quiet/)).toBeDefined()
  })

  it('can narrow to just those who signed up', async () => {
    render(<PeopleScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Who to show'), 'signedUp')

    expect(screen.getByText(/Freda Available/)).toBeDefined()
    // Quinn is on record but never filled the form in.
    expect(screen.queryByText(/Quinn Quiet/)).toBeNull()
  })

  it('counts offered hours against shifts booked', () => {
    render(<PeopleScreen />)
    // Freda offered two hours and has nothing booked.
    expect(rowFor('Freda Available').textContent).toContain('0')
    // Ben offered two and has one.
    expect(rowFor('Ben Booked').textContent).toContain('1')
  })

  it('marks each hour as booked, offered or unavailable', () => {
    render(<PeopleScreen />)
    const ben = rowFor('Ben Booked')

    // Booked hour names the location on hover, so a gap can be traced.
    expect(ben.querySelector('[title*="Braemar"]')).not.toBeNull()
    expect(ben.querySelector('[title*="available"]')).not.toBeNull()
    expect(ben.querySelector('[title*="not available"]')).not.toBeNull()
  })

  it('counts the two gaps apart, because they go wrong at different times', () => {
    /*
      This used to assert silence here, and passing was the blind spot.

      Ben has a phone and no email; Freda has an email and no phone. Neither is missing
      *both*, which was the only thing being counted — so the screen said nothing, while
      Freda could not be reached on the day and Ben could not be sent a schedule. Those are
      two different problems with two different deadlines and they get two sentences.
    */
    render(<PeopleScreen />)
    expect(screen.getByText(/have no phone number/)).toBeDefined()
    expect(screen.getByText(/have no email address/)).toBeDefined()
  })

  it('marks the people it is counting, so the list answers "which"', () => {
    /*
      The banner gives the count and stops there. Which people is a different question, and
      it is answered where the names are — with the same mark the day-of table uses, so it
      means the same thing in both places.
    */
    render(<PeopleScreen />)
    const marks = document.querySelectorAll('.contact-flag')
    expect(marks.length).toBeGreaterThan(0)
    expect(marks[0]!.getAttribute('aria-label')).toMatch(/No (phone number|email address)/)
  })

  it('says nothing when everybody can be reached both ways', () => {
    people = people.map((p) => ({
      ...p,
      parentPhone: p.parentPhone || '519-555-0100',
      parentEmail: p.parentEmail || 'parent@example.org',
    }))
    render(<PeopleScreen />)
    expect(screen.queryByText(/have no phone number/)).toBeNull()
    expect(screen.queryByText(/have no email address/)).toBeNull()
    expect(document.querySelectorAll('.contact-flag')).toHaveLength(0)
  })
})

describe('filters', () => {
  it('narrows to people free at a given hour', async () => {
    render(<PeopleScreen />)

    await userEvent.selectOptions(
      screen.getByLabelText('Filter by availability'),
      'sat-0900',
    )

    // Only Ben offered Saturday morning.
    expect(screen.getByText(/Ben Booked/)).toBeDefined()
    expect(screen.queryByText(/Freda Available/)).toBeNull()
  })

  it('shows only those with no shift yet', async () => {
    render(<PeopleScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Who to show'), 'unscheduled')

    expect(screen.getByText(/Freda Available/)).toBeDefined()
    expect(screen.queryByText(/Ben Booked/)).toBeNull()
  })

  it('comes back to everyone after narrowing', async () => {
    render(<PeopleScreen />)
    const filter = screen.getByLabelText('Who to show')

    await userEvent.selectOptions(filter, 'signedUp')
    expect(screen.queryByText(/Quinn Quiet/)).toBeNull()

    await userEvent.selectOptions(filter, 'everyone')
    expect(screen.getByText(/Quinn Quiet/)).toBeDefined()
  })

  it('searches by name and by parent email', async () => {
    render(<PeopleScreen />)
    const search = screen.getByPlaceholderText(/Search name/)

    await userEvent.type(search, 'freda@')
    expect(screen.getByText(/Freda Available/)).toBeDefined()
    expect(screen.queryByText(/Ben Booked/)).toBeNull()
  })

  it('filters by section', async () => {
    render(<PeopleScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Filter by section'), 'scouts')

    expect(screen.getByText(/Freda Available/)).toBeDefined()
    expect(screen.queryByText(/Ben Booked/)).toBeNull()
  })
})

describe('the person editor: filling in what the form never asked for', () => {
  /*
    Rendered on its own rather than reached from the list.

    It used to be opened by an Edit button on the row, which is gone — a person's details
    are changed on their own page now, where their shifts and history are in front of you
    while you change them. The editor itself is unchanged, so the tests are too; only the
    way in is.
  */
  const openEditor = async (name: string): Promise<void> => {
    const person = people.find((p) => `${p.firstName} ${p.lastName}` === name)!
    render(<PersonEditor person={person} onClose={() => {}} />)
    await Promise.resolve()
  }

  it('saves contact details', async () => {
    await openEditor('Freda Available')

    await userEvent.type(screen.getByLabelText(/Phone/), '519-555-0199')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(savePersonWithPairing).toHaveBeenCalledTimes(1)
    expect(savePersonWithPairing.mock.calls[0]![1]).toMatchObject({
      id: 'p-free',
      parentPhone: '519-555-0199',
    })
  })

  it('picks a pairing by searching, not from a list of everybody', async () => {
    await openEditor('Freda Available')

    await userEvent.click(screen.getByRole('button', { name: 'Choose someone' }))
    // The same typeahead the schedule board uses.
    await userEvent.type(pickerSearch(), 'ben')
    await userEvent.click(screen.getByRole('option', { name: /Ben Booked/ }))

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(savePersonWithPairing.mock.calls[0]![1]).toMatchObject({
      id: 'p-free',
      pairWithPersonId: 'p-busy',
    })
  })

  it('applies the pairing to both people, not just one', async () => {
    // The relationship means the same from either end; writing one side left the other
    // unaware, and the board could then miss a split pair entirely.
    await openEditor('Freda Available')
    await userEvent.click(screen.getByRole('button', { name: 'Choose someone' }))
    await userEvent.click(screen.getByRole('option', { name: /Ben Booked/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // The write carries the partner, and `savePersonWithPairing` sets their side too.
    const [, saved, toClear] = savePersonWithPairing.mock.calls[0]!
    expect(saved.pairWithPersonId).toBe('p-busy')
    expect(toClear).toEqual([])
  })

  it('frees the previous partner when a pairing changes', async () => {
    people = [
      { ...people[0]!, pairWithPersonId: 'p-quiet' },
      people[1]!,
      { ...people[2]!, pairWithPersonId: 'p-free' },
    ]
    await openEditor('Freda Available')
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    await userEvent.click(screen.getByRole('option', { name: /Ben Booked/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Quinn was Freda's partner and must not be left pointing at her.
    expect(savePersonWithPairing.mock.calls[0]![2]).toContain('p-quiet')
  })

  it('frees whoever the new partner was paired with', async () => {
    people = [
      people[0]!,
      { ...people[1]!, pairWithPersonId: 'p-quiet' },
      { ...people[2]!, pairWithPersonId: 'p-busy' },
    ]
    await openEditor('Freda Available')
    await userEvent.click(screen.getByRole('button', { name: 'Choose someone' }))
    await userEvent.click(screen.getByRole('option', { name: /Ben Booked/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    // Ben was paired with Quinn; taking Ben leaves Quinn dangling unless cleared.
    expect(savePersonWithPairing.mock.calls[0]![2]).toContain('p-quiet')
  })

  it('can clear a pairing', async () => {
    people = [{ ...people[0]!, pairWithPersonId: 'p-busy' }, people[1]!, people[2]!]
    await openEditor('Freda Available')
    await userEvent.click(screen.getByLabelText('Not paired with anybody'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const [, saved, toClear] = savePersonWithPairing.mock.calls[0]!
    expect(saved.pairWithPersonId).toBeNull()
    expect(toClear).toContain('p-busy')
  })
})

describe('setting availability', () => {
  const hourFor = (name: string, when: string): HTMLElement =>
    screen.getByRole('button', { name: `${name} ${when}` })

  it('offers an hour that was not available', async () => {
    render(<PeopleScreen />)
    // Freda offered 5pm and 6pm only; 7pm is a plain dot.
    await userEvent.click(hourFor('Freda Available', 'Fri 7:00 PM – 8:00 PM'))

    expect(saveAvailability).toHaveBeenCalledTimes(1)
    const [eventId, personId, availability] = saveAvailability.mock.calls[0]!
    expect(eventId).toBe('2026')
    expect(personId).toBe('p-free')
    expect(availability.fri).toEqual(
      expect.arrayContaining(['fri-1700', 'fri-1800', 'fri-1900']),
    )
  })

  it('withdraws an hour that was offered', async () => {
    render(<PeopleScreen />)
    await userEvent.click(hourFor('Freda Available', 'Fri 5:00 PM – 6:00 PM'))

    const availability = saveAvailability.mock.calls[0]![2]
    expect(availability.fri).toEqual(['fri-1800'])
  })

  it('can withdraw an hour someone is already booked for', async () => {
    // Allowed on purpose — plans change — and the board flags the disagreement.
    render(<PeopleScreen />)
    await userEvent.click(hourFor('Ben Booked', 'Fri 5:00 PM – 6:00 PM'))

    const availability = saveAvailability.mock.calls[0]![2]
    expect(availability.fri ?? []).not.toContain('fri-1700')
    // Saturday untouched.
    expect(availability.sat).toEqual(['sat-0900'])
  })

  it('shows an hour worked but never offered as a disagreement', () => {
    assignments = [
      {
        id: 'a2', slotId: 'fri-2000', locationId: 'braemar', personId: 'p-free',
        status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
      },
    ]
    render(<PeopleScreen />)
    const cell = hourFor('Freda Available', 'Fri 8:00 PM – 9:00 PM')
    expect(cell.title).toContain('not offered')
  })

  it('offers a whole day at once, and withdraws it again', async () => {
    render(<PeopleScreen />)
    const row = rowFor('Freda Available')

    const offerFriday = Array.from(row.querySelectorAll('button')).find(
      (b) => b.title === 'Offer all of Friday',
    )!
    await userEvent.click(offerFriday)

    const offered = saveAvailability.mock.calls[0]![2]
    expect(offered.fri).toEqual(['fri-1700', 'fri-1800', 'fri-1900', 'fri-2000'])

    // Ben has all of Saturday? No — but his Friday is fully offered after this, so the
    // control flips to withdrawing.
    saveAvailability.mockClear()
    const benRow = rowFor('Ben Booked')
    const withdrawSat = Array.from(benRow.querySelectorAll('button')).find(
      (b) => b.title === 'Offer all of Saturday',
    )!
    await userEvent.click(withdrawSat)
    expect(saveAvailability.mock.calls[0]![2].sat).toHaveLength(
      SLOTS.filter((s) => s.day === 'sat').length,
    )
  })

  it('reports a failure rather than silently doing nothing', async () => {
    saveAvailability.mockRejectedValue(new Error('offline write rejected'))
    render(<PeopleScreen />)
    await userEvent.click(hourFor('Freda Available', 'Fri 7:00 PM – 8:00 PM'))

    expect(await screen.findByText(/offline write rejected/)).toBeDefined()
  })

  it('does not wait for the server before accepting the next click', async () => {
    // A pending write must not gate the grid — same rule as the schedule board.
    saveAvailability.mockReturnValue(new Promise(() => {}))
    render(<PeopleScreen />)

    await userEvent.click(hourFor('Freda Available', 'Fri 7:00 PM – 8:00 PM'))
    await userEvent.click(hourFor('Ben Booked', 'Fri 6:00 PM – 7:00 PM'))

    expect(saveAvailability).toHaveBeenCalledTimes(2)
  })
})

describe('adding someone who never used the form', () => {
  it('derives the same id the importer would, so a later import matches', async () => {
    render(<PeopleScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }))

    await userEvent.type(screen.getByLabelText('First name'), 'Paper')
    await userEvent.type(screen.getByLabelText('Last name'), 'Signup')
    await userEvent.selectOptions(screen.getByLabelText('Section'), 'scouts')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(savePersonWithPairing).toHaveBeenCalledTimes(1)
    expect(savePersonWithPairing.mock.calls[0]![1]).toMatchObject({
      id: 'p-paper-signup-scouts',
      firstName: 'Paper',
      section: 'scouts',
    })
  })

  it('will not save without a name', async () => {
    render(<PeopleScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'Add person' }))
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe('clearing availability from the grid', () => {
  const hourFor = (name: string, when: string): HTMLElement =>
    screen.getByRole('button', { name: `${name} ${when}` })

  const dayButton = (name: string, title: string): HTMLElement =>
    Array.from(rowFor(name).querySelectorAll('button')).find((b) => b.title === title)!

  it('clears a whole day, sending an empty list for it', async () => {
    // Already offering every Friday hour, so the control is a withdraw. (The mocked store
    // does not reflect writes, so the state has to be seeded rather than clicked into.)
    signups = [
      {
        id: 's1', personId: 'p-free',
        availability: { fri: SLOTS.filter((s) => s.day === 'fri').map((s) => s.id) },
        attendingWithYouth: true, notes: '', sourceRow: 2, importedAt: 0,
      },
    ]
    render(<PeopleScreen />)

    await userEvent.click(dayButton('Freda Available', 'Withdraw all of Friday'))
    expect(saveAvailability.mock.calls[0]![2].fri).toEqual([])
  })

  it('clears the last remaining hour, leaving nothing offered', async () => {
    signups = [
      {
        id: 's1', personId: 'p-free',
        availability: { fri: ['fri-1700'] },
        attendingWithYouth: true, notes: '', sourceRow: 2, importedAt: 0,
      },
    ]
    render(<PeopleScreen />)

    await userEvent.click(hourFor('Freda Available', 'Fri 5:00 PM – 6:00 PM'))

    const sent = saveAvailability.mock.calls[0]![2]
    // Not an omitted key — see completeAvailability.
    expect(sent.fri).toEqual([])
  })

  it('does not grant availability for an hour worked but never offered', async () => {
    // Ben works Friday 5pm. Take that hour out of what he offered.
    signups = [
      {
        id: 's2', personId: 'p-busy',
        availability: { sat: ['sat-0900'] },
        attendingWithYouth: false, notes: '', sourceRow: 3, importedAt: 0,
      },
    ]
    render(<PeopleScreen />)

    // Toggling an unrelated hour must not quietly add fri-1700 just because he is booked
    // then — the write is built from what was offered, not from what is drawn.
    await userEvent.click(hourFor('Ben Booked', 'Fri 6:00 PM – 7:00 PM'))

    const sent = saveAvailability.mock.calls[0]![2]
    expect(sent.fri).toEqual(['fri-1800'])
    expect(sent.fri).not.toContain('fri-1700')
    expect(sent.sat).toEqual(['sat-0900'])
  })

  it('withdrawing one day leaves the others exactly as they were', async () => {
    signups = [
      {
        id: 's2', personId: 'p-busy',
        availability: {
          fri: ['fri-1700'],
          sat: SLOTS.filter((s) => s.day === 'sat').map((s) => s.id),
        },
        attendingWithYouth: false, notes: '', sourceRow: 3, importedAt: 0,
      },
    ]
    render(<PeopleScreen />)

    await userEvent.click(dayButton('Ben Booked', 'Withdraw all of Saturday'))

    const sent = saveAvailability.mock.calls[0]![2]
    expect(sent.sat).toEqual([])
    // Friday must survive untouched.
    expect(sent.fri).toEqual(['fri-1700'])
  })
})

describe('removing someone from a year', () => {
  const removeButton = (name: string): HTMLElement =>
    Array.from(rowFor(name).querySelectorAll('button')).find(
      (b) => b.textContent === 'Remove',
    )!

  it('asks first, naming what goes with them', async () => {
    render(<PeopleScreen />)
    await userEvent.click(removeButton('Ben Booked'))

    // Ben holds one shift; the confirmation has to say so.
    expect(screen.getByText(/1 booked shift/)).toBeDefined()
    expect(removeFromEvent).not.toHaveBeenCalled()
  })

  it('takes their shifts with them', async () => {
    render(<PeopleScreen />)
    await userEvent.click(removeButton('Ben Booked'))
    await userEvent.click(screen.getByRole('button', { name: /Remove from Apple Day 2026/ }))

    expect(removeFromEvent).toHaveBeenCalledTimes(1)
    const [eventId, personId, assignmentIds] = removeFromEvent.mock.calls[0]!
    expect(eventId).toBe('2026')
    expect(personId).toBe('p-busy')
    // Leaving the shift behind would keep him on the published schedule.
    expect(assignmentIds).toEqual(['a1'])
  })

  it('says plainly when there are no shifts to lose', async () => {
    render(<PeopleScreen />)
    await userEvent.click(removeButton('Freda Available'))

    expect(screen.getByText(/no booked shifts/)).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: /Remove from Apple Day 2026/ }))
    expect(removeFromEvent.mock.calls[0]![2]).toEqual([])
  })

  it('does not delete the person record for an ordinary removal', async () => {
    render(<PeopleScreen />)
    await userEvent.click(removeButton('Freda Available'))
    await userEvent.click(screen.getByRole('button', { name: /Remove from Apple Day 2026/ }))

    expect(deletePerson).not.toHaveBeenCalled()
  })

  it('keeps deleting the roster record behind a separate, warned control', async () => {
    render(<PeopleScreen />)
    await userEvent.click(removeButton('Freda Available'))

    // Not a primary action: it lives behind a disclosure with its own warning.
    expect(screen.getByText(/cannot be undone/)).toBeDefined()
    await userEvent.click(screen.getByRole('button', { name: /Delete Freda Available/ }))

    expect(removeFromEvent).toHaveBeenCalledTimes(1)
    // People live under the event now, so deleting one is scoped to it.
    expect(deletePerson).toHaveBeenCalledWith('2026', 'p-free')
  })

  it('can be cancelled without touching anything', async () => {
    render(<PeopleScreen />)
    await userEvent.click(removeButton('Ben Booked'))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(removeFromEvent).not.toHaveBeenCalled()
    expect(deletePerson).not.toHaveBeenCalled()
  })

  it('reports a failure instead of appearing to have worked', async () => {
    removeFromEvent.mockRejectedValue(new Error('permission denied'))
    render(<PeopleScreen />)
    await userEvent.click(removeButton('Ben Booked'))
    await userEvent.click(screen.getByRole('button', { name: /Remove from Apple Day 2026/ }))

    expect(await screen.findByText(/permission denied/)).toBeDefined()
  })
})

describe('a name is a way to reach that person', () => {
  it('links each youth on the roster to their own page', () => {
    // The screen an organizer scans down to find somebody, and the one place their name
    // was plain text — so looking somebody up meant navigating there by another route.
    render(<PeopleScreen />)

    const link = screen.getByRole('link', { name: 'Freda Available' })
    expect(link.getAttribute('href')).toBe('/e/2026/person/p-free')
  })
})

describe('editing is not offered in the list', () => {
  it('has no Edit button on a row', () => {
    /*
      Removed deliberately. A person's details are changed on their own page, reached by
      their name — the list cannot show what an edit affects while you are making it: their
      availability, their shifts, whether they have done this before.
    */
    render(<PeopleScreen />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('still offers Remove, which is about this list rather than about them', () => {
    // Taking somebody out of the year belongs here; changing who they are does not.
    render(<PeopleScreen />)
    expect(screen.getAllByRole('button', { name: 'Remove' }).length).toBeGreaterThan(0)
  })

  it('links a name to their own page', () => {
    render(<PeopleScreen />)
    const link = screen.getAllByRole('link')[0]!
    expect(link.getAttribute('href')).toContain('person/')
  })
})

describe('parents’ contact details are not on the list', () => {
  it('has no Contact column', () => {
    /*
      Removed deliberately. This screen is open all day on a table in a shop doorway, and a
      column of parents' phone numbers and addresses sat there being read by nobody. What is
      worth acting on is when one is *missing* — the mark beside a name says that — and the
      details themselves are on the person's own page, a click away.
    */
    render(<PeopleScreen />)
    expect(screen.queryByRole('columnheader', { name: 'Contact' })).toBeNull()
  })

  it('shows no address or phone number in a row', () => {
    render(<PeopleScreen />)
    const table = screen.getByRole('table')
    expect(table.textContent).not.toContain('@')
    expect(table.textContent).not.toMatch(/\d{3}-\d{3}-\d{4}/)
  })

  it('still marks whoever cannot be reached', () => {
    // The absence is the part worth a place on the board, and it stays.
    render(<PeopleScreen />)
    expect(document.querySelectorAll('.contact-flag').length).toBeGreaterThan(0)
  })

  it('keeps every header row the same width as the body', () => {
    // Removing a column means removing it from two header rows and the body; miss one and
    // the whole grid shears sideways.
    render(<PeopleScreen />)
    const rows = screen.getAllByRole('row')
    const widths = rows.map((r) =>
      Array.from(r.querySelectorAll('th, td')).reduce(
        (n, c) => n + (Number((c as HTMLTableCellElement).colSpan) || 1),
        0,
      ),
    )
    expect(new Set(widths).size).toBe(1)
  })
})
