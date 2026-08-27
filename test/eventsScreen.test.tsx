// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppleDayEvent } from '../src/domain/types'

/**
 * Editing an event's days, hours and shift shape.
 *
 * The day windows were dropdowns of whole hours, so a Saturday starting at 7:45 or an
 * evening ending at 8:30 could not be expressed at all.
 */

const saveEvent = vi.fn()
const createEvent = vi.fn()
const select = vi.fn()

const EVENT: AppleDayEvent = {
  id: '2026',
  name: 'Apple Day 2026',
  slug: '',
  year: 2026,
  fridayDate: '2026-10-02',
  saturdayDate: '2026-10-03',
  support: [],
  supportNote: '',
  arrivalNote: '',
  baseLocationId: null,
  schedule: {
    fri: { startMin: 17 * 60, endMin: 21 * 60 },
    sat: { startMin: 7 * 60, endMin: 15 * 60 },
  },
  shiftMode: 'shifts',
  shiftMinutes: 60,
  overlapMinutes: 0,
}

let events: AppleDayEvent[] = []

// The screen reads the signed-in tier to decide what to offer, which would otherwise boot
// Firebase Auth.
/** The tier the screen is being viewed at. Set per test. */
let viewerRole = 'admin'

// Reached through the export, which stamps the file with the project it came from.
vi.mock('../src/lib/firebase', () => ({ db: {}, auth: {}, missingConfig: [], PROJECT_ID: 'test' }))

vi.mock('../src/lib/eventTransfer', () => ({
  exportEvent: vi.fn(async () => ({ format: 'apple-day/event@1' })),
  restoreEvent: vi.fn(async () => undefined),
}))

vi.mock('../src/lib/session', () => ({
  useSession: () => ({ user: { uid: 'admin-uid' }, role: viewerRole }),
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canSeeTheEvent: (r: string) => r === 'admin' || r === 'organizer' || r === 'viewer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
}))

vi.mock('../src/lib/eventContext', async () => {
  const actual = await import('../src/domain/eventLinks')
  return {
    useEvent: () => ({
      events,
      event: events[0] ?? null,
      loading: false,
      error: null,
      select,
      createEvent,
      saveEvent,
      pathFor: (screen: string, id?: string) => `/e/${id ?? '2026'}/${screen}`,
    }),
    defaultDatesFor: () => ({ fridayDate: '2027-10-01', saturdayDate: '2027-10-02' }),
    slugifyEventName: actual.slugifyEventName,
    eventLinkFor: actual.eventLinkFor,
    eventLinkProblem: actual.eventLinkProblem,
    sanitiseEventLink: actual.sanitiseEventLink,
  }
})

/** What the event being removed is said to hold. */
let tally: Record<string, number> = {}
const removeEvent = vi.fn()

vi.mock('../src/lib/repo', () => ({
  copyEventLocations: vi.fn(),
  useEventLocations: () => ({ data: [], loading: false, error: null }),
  useLocationLibrary: () => ({ data: [], loading: false, error: null }),
  tallyEvent: async () => tally,
  removeEvent: (...a: unknown[]) => removeEvent(...a),
}))

const { EventsScreen } = await import('../src/ui/EventsScreen')

beforeEach(() => {
  tally = { people: 3, assignments: 2, jars: 1, passes: 2 }
  removeEvent.mockReset()
  removeEvent.mockResolvedValue(undefined)
  viewerRole = 'admin'
  saveEvent.mockReset()
  saveEvent.mockResolvedValue(undefined)
  events = [{ ...EVENT, schedule: { ...EVENT.schedule } }]
})

const openEditor = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
}

/**
 * Set a time field.
 *
 * A real time control hands over a whole value; typing into one character by character
 * yields half-formed times ("07:4", then "07:59" as the segments fill), which is a quirk of
 * the control rather than anything the app should be tested against.
 */
const setTime = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('setting the hours', () => {
  it('offers a clock, not a list of whole hours', async () => {
    render(<EventsScreen />)
    await openEditor()

    const start = screen.getByLabelText('Friday start') as HTMLInputElement
    expect(start.type).toBe('time')
    // Quarter-hour steps in the picker.
    expect(start.step).toBe(String(15 * 60))
    expect(start.value).toBe('17:00')
  })

  it('accepts a quarter-hour start', async () => {
    render(<EventsScreen />)
    await openEditor()

    setTime('Saturday start', '07:45')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveEvent).toHaveBeenCalledTimes(1)
    expect(saveEvent.mock.calls[0]![0].schedule.sat.startMin).toBe(7 * 60 + 45)
  })

  it('accepts a quarter-hour end', async () => {
    render(<EventsScreen />)
    await openEditor()

    setTime('Friday end', '20:30')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveEvent.mock.calls[0]![0].schedule.fri.endMin).toBe(20 * 60 + 30)
  })

  it('leaves the stored time alone while the field is empty', async () => {
    // Clearing a time input momentarily reports '', which must not reset the day to
    // midnight and silently wipe the window.
    render(<EventsScreen />)
    await openEditor()

    setTime('Friday start', '')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveEvent.mock.calls[0]![0].schedule.fri.startMin).toBe(17 * 60)
  })

  it('flags a day that ends before it starts, beside the field', async () => {
    render(<EventsScreen />)
    await openEditor()

    setTime('Friday end', '16:00')
    // Inline, next to the offending time, rather than a banner elsewhere.
    expect(screen.getByText(/must end after it starts/)).toBeDefined()
  })
})

describe('the shift shape', () => {
  it('shows how many shifts the hours produce', async () => {
    render(<EventsScreen />)
    await openEditor()
    // Friday 5–9pm at hourly shifts is four.
    expect(screen.getByText('4 shifts')).toBeDefined()
  })

  it('recounts them when the overlap changes', async () => {
    render(<EventsScreen />)
    await openEditor()

    await userEvent.selectOptions(screen.getByLabelText('Overlap'), '15')
    // 45 minutes apart across four hours is five.
    expect(screen.getByText('5 shifts')).toBeDefined()
    expect(screen.getByText(/starts 45 min apart/)).toBeDefined()
  })

  it('previews the resulting shift times', async () => {
    render(<EventsScreen />)
    await openEditor()
    await userEvent.selectOptions(screen.getByLabelText('Overlap'), '15')

    // The handover reads the way it was described: ending at 6, next starting at 5:45.
    expect(screen.getByText(/5:00 PM – 6:00 PM, 5:45 PM – 6:45 PM/)).toBeDefined()
  })

  it('refuses an overlap as long as the shift', async () => {
    render(<EventsScreen />)
    await openEditor()

    await userEvent.selectOptions(screen.getByLabelText('Shift length'), '30')
    await userEvent.selectOptions(screen.getByLabelText('Overlap'), '30')
    expect(screen.getByText(/shorter than the shift/)).toBeDefined()
  })

  it('saves the shape', async () => {
    render(<EventsScreen />)
    await openEditor()

    await userEvent.selectOptions(screen.getByLabelText('Shift length'), '90')
    await userEvent.selectOptions(screen.getByLabelText('Overlap'), '15')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveEvent.mock.calls[0]![0]).toMatchObject({
      shiftMinutes: 90,
      overlapMinutes: 15,
    })
  })
})

describe('an event with no shifts', () => {
  it('offers a whole-day mode', async () => {
    render(<EventsScreen />)
    await openEditor()

    const mode = screen.getByLabelText('Scheduling') as HTMLSelectElement
    expect(Array.from(mode.options).map((o) => o.value)).toEqual(['shifts', 'wholeDay'])
  })

  it('hides the shift length and overlap, which no longer mean anything', async () => {
    render(<EventsScreen />)
    await openEditor()
    expect(screen.queryByLabelText('Shift length')).not.toBeNull()

    await userEvent.selectOptions(screen.getByLabelText('Scheduling'), 'wholeDay')
    expect(screen.queryByLabelText('Shift length')).toBeNull()
    expect(screen.queryByLabelText('Overlap')).toBeNull()
  })

  it('shows each day as a single slot', async () => {
    render(<EventsScreen />)
    await openEditor()
    await userEvent.selectOptions(screen.getByLabelText('Scheduling'), 'wholeDay')

    expect(screen.getByText(/Friday is one slot: 5:00 PM – 9:00 PM/)).toBeDefined()
    // And the per-day label stops counting shifts.
    expect(screen.getAllByText('whole day').length).toBeGreaterThan(0)
  })

  it('saves the mode', async () => {
    render(<EventsScreen />)
    await openEditor()
    await userEvent.selectOptions(screen.getByLabelText('Scheduling'), 'wholeDay')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(saveEvent.mock.calls[0]![0]).toMatchObject({ shiftMode: 'wholeDay' })
  })

  it('still lets the day hours be set', async () => {
    // The window is what the single slot spans, so it matters more here, not less.
    render(<EventsScreen />)
    await openEditor()
    await userEvent.selectOptions(screen.getByLabelText('Scheduling'), 'wholeDay')

    setTime('Saturday start', '08:30')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(saveEvent.mock.calls[0]![0].schedule.sat.startMin).toBe(8 * 60 + 30)
  })
})

describe('editing the link an event is shared under', () => {
  /** Render first, then open — the button only exists once the list is on screen. */
  const edit = async (): Promise<void> => {
    render(<EventsScreen />)
    await openEditor()
  }

  const linkField = (): HTMLInputElement =>
    screen.getByLabelText('Link') as HTMLInputElement
  const saveButton = (): HTMLButtonElement =>
    screen.getByRole('button', { name: /^Save/ }) as HTMLButtonElement

  it('starts empty, showing the generated id as the placeholder', async () => {
    await edit()
    expect(linkField().value).toBe('')
    expect(linkField().placeholder).toBe('2026')
  })

  it('saves what was typed', async () => {
    await edit()
    await userEvent.type(linkField(), 'apple-day-2026')
    await userEvent.click(saveButton())

    expect(saveEvent).toHaveBeenCalledTimes(1)
    expect((saveEvent.mock.calls[0]![0] as AppleDayEvent).slug).toBe('apple-day-2026')
  })

  it('lets a dash be typed', async () => {
    // Re-slugifying on every keystroke ate it: "apple-" became "apple" before the next
    // letter arrived, so a multi-word link was unreachable. Same bug as the alias field.
    await edit()
    await userEvent.type(linkField(), 'apple-')
    expect(linkField().value).toBe('apple-')
  })

  it('makes what is typed URL-safe as it is typed', async () => {
    await edit()
    await userEvent.type(linkField(), 'Apple Day 2026!')
    expect(linkField().value).toBe('apple-day-2026-')
  })

  it('tidies a trailing dash away on save', async () => {
    await edit()
    await userEvent.type(linkField(), 'apple-day-')
    await userEvent.click(saveButton())
    expect((saveEvent.mock.calls[0]![0] as AppleDayEvent).slug).toBe('apple-day-')
  })

  it('says where the event will live, and that the old link still works', async () => {
    await edit()
    await userEvent.type(linkField(), 'ad26')
    const note = screen.getByText(/keeps working either way/)
    expect(note.textContent).toContain('/e/ad26')
    // The id is the reason editing is safe at all, so it is named explicitly.
    expect(note.textContent).toContain('/e/2026')
  })

  it('refuses a link another event already answers to, and blocks the save', async () => {
    events = [
      EVENT,
      { ...EVENT, id: 'apple-day-2025', name: 'Apple Day 2025', slug: 'ad25' },
    ]
    render(<EventsScreen />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!)
    await userEvent.type(linkField(), 'ad25')

    expect(screen.getByText(/Another event already uses that link/)).toBeTruthy()
    expect(saveButton().disabled).toBe(true)

    await userEvent.clear(linkField())
    await userEvent.type(linkField(), 'ad26')
    expect(saveButton().disabled).toBe(false)
  })

  it('can be put back to the generated link', async () => {
    events = [{ ...EVENT, slug: 'ad26' }]
    await edit()
    expect(linkField().value).toBe('ad26')

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(linkField().value).toBe('')

    await userEvent.click(saveButton())
    expect((saveEvent.mock.calls[0]![0] as AppleDayEvent).slug).toBe('')
  })

  it('lists the link people actually use, not the document id', async () => {
    events = [{ ...EVENT, slug: 'ad26' }]
    render(<EventsScreen />)
    expect(screen.getByText('/e/ad26')).toBeTruthy()
  })
})

describe('who a volunteer can reach on the day', () => {
  const edit = async (): Promise<void> => {
    render(<EventsScreen />)
    await openEditor()
  }

  const field = (n: number, what: string): HTMLInputElement =>
    screen.getByLabelText(`Contact ${n} ${what}`) as HTMLInputElement

  it('starts with none, and says why that matters', async () => {
    await edit()
    expect(screen.getByText(/A pass with no way to reach anybody/)).toBeTruthy()
  })

  it('takes a name, a phone and an email', async () => {
    await edit()
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }))

    await userEvent.type(field(1, 'name'), 'Devin, base ops')
    await userEvent.type(field(1, 'phone'), '519-555-0100')
    await userEvent.type(field(1, 'email'), 'devin@example.org')
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))

    expect((saveEvent.mock.calls[0]![0] as AppleDayEvent).support).toEqual([
      { name: 'Devin, base ops', phone: '519-555-0100', email: 'devin@example.org' },
    ])
  })

  it('takes several, because base ops changes hands', async () => {
    await edit()
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    await userEvent.type(field(1, 'phone'), '519-555-0100')
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    await userEvent.type(field(2, 'email'), 'saturday@example.org')

    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))
    const saved = (saveEvent.mock.calls[0]![0] as AppleDayEvent).support
    expect(saved).toHaveLength(2)
    // An email on its own is a contact: some organizers would rather be written to.
    expect(saved[1]).toEqual({ name: '', phone: '', email: 'saturday@example.org' })
  })

  it('takes an email with no phone at all', async () => {
    await edit()
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    await userEvent.type(field(1, 'email'), 'devin@example.org')
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))

    expect((saveEvent.mock.calls[0]![0] as AppleDayEvent).support).toEqual([
      { name: '', phone: '', email: 'devin@example.org' },
    ])
  })

  it('removes one without disturbing the others', async () => {
    events = [
      {
        ...EVENT,
        support: [
          { name: 'Devin', phone: '519-555-0100', email: '' },
          { name: 'Saturday', phone: '519-555-0199', email: '' },
        ],
      },
    ]
    await edit()
    await userEvent.click(screen.getByRole('button', { name: 'Remove contact 1' }))
    await userEvent.click(screen.getByRole('button', { name: /^Save/ }))

    expect((saveEvent.mock.calls[0]![0] as AppleDayEvent).support).toEqual([
      { name: 'Saturday', phone: '519-555-0199', email: '' },
    ])
  })

  it('shows what is already stored', async () => {
    events = [{ ...EVENT, support: [{ name: 'Devin', phone: '519-555-0100', email: '' }] }]
    await edit()
    expect(field(1, 'name').value).toBe('Devin')
    expect(field(1, 'phone').value).toBe('519-555-0100')
  })

  it('carries an event that only ever had the one old phone number', async () => {
    // Reading is where the fallback lives, so an event stored before this shows its number
    // as a contact rather than losing it.
    events = [{ ...EVENT, support: [{ name: '', phone: '519-555-0100', email: '' }] }]
    await edit()
    expect(field(1, 'phone').value).toBe('519-555-0100')
  })
})


describe('what an organizer sees here', () => {
  /*
    An organizer needs to know which events exist and which one they are working in — that
    is the question "what do I have access to". Creating one, or changing its dates, hours
    or shift shape, decides what every other screen shows, so it stays with an admin.
  */
  it('lists the events, so they know what there is', () => {
    viewerRole = 'organizer'
    render(<EventsScreen />)
    expect(screen.getByText('Apple Day 2026')).toBeTruthy()
    expect(screen.getByText('/e/2026')).toBeTruthy()
  })

  it('does not offer its own way to switch between them', () => {
    /*
      Switching events is the picker in the bar, which is on every screen and is where
      somebody already goes to do it. A second control that does the same thing only here
      is one more thing to learn, and it read as the way to open an event rather than as a
      duplicate of the one above it.
    */
    viewerRole = 'organizer'
    events = [EVENT, { ...EVENT, id: '2027', name: 'Apple Day 2027' }]
    render(<EventsScreen />)
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    // The link each event answers to is still on the row, to read or to copy.
    expect(screen.getByText('/e/2026')).toBeTruthy()
  })

  it('changes the year it is running, but does not start or end one', () => {
    /*
      Wanting the support number changed at 8am on the Saturday is not unreasonable.
      Deleting an event is the most destructive act in the app — a year of jars, shifts and
      audit entries go with it — so making one, and removing one, stay with an admin.
    */
    viewerRole = 'organizer'
    render(<EventsScreen />)
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'New event' })).toBeNull()
  })

  it('still offers all of it to an admin', () => {
    render(<EventsScreen />)
    expect(screen.getByRole('button', { name: 'New event' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy()
  })
})

describe('a day-of contact with no way to reach them', () => {
  /*
    Reported: adding a contact with only a name looked like it saved, and had not.

    It is dropped on purpose — this is printed on every volunteer's pass as who to ring, and
    a name with no number tells a parent nothing. What was wrong was the silence: you typed,
    you saved, and it was gone with no word about why.
  */
  const addContact = async (): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }))
  }

  it('says so while the row is still on screen', async () => {
    render(<EventsScreen />)
    await openEditor()
    await addContact()

    await userEvent.type(screen.getByLabelText('Contact 1 name'), 'Devin')
    expect(screen.getByText(/will not be kept/)).toBeTruthy()
  })

  it('stops saying so once there is a phone', async () => {
    render(<EventsScreen />)
    await openEditor()
    await addContact()

    await userEvent.type(screen.getByLabelText('Contact 1 name'), 'Devin')
    await userEvent.type(screen.getByLabelText('Contact 1 phone'), '519-555-0100')
    expect(screen.queryByText(/will not be kept/)).toBeNull()
  })

  it('stops saying so once there is an email', async () => {
    render(<EventsScreen />)
    await openEditor()
    await addContact()

    await userEvent.type(screen.getByLabelText('Contact 1 name'), 'Devin')
    await userEvent.type(screen.getByLabelText('Contact 1 email'), 'devin@example.org')
    expect(screen.queryByText(/will not be kept/)).toBeNull()
  })

  it('says nothing about a row nobody has started', async () => {
    // A blank row is not a mistake, it is a row waiting to be filled in.
    render(<EventsScreen />)
    await openEditor()
    await addContact()

    expect(screen.queryByText(/will not be kept/)).toBeNull()
  })
})

describe('removing an event', () => {
  it('is offered to an admin and not to an organizer', () => {
    // The one action here that no other screen can undo.
    render(<EventsScreen />)
    expect(screen.getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0)

    viewerRole = 'organizer'
    cleanup()
    render(<EventsScreen />)
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('counts what would go before asking', async () => {
    /*
      "This cannot be undone" is easy to click past. Naming what is in there is the sentence
      that makes somebody stop and check which event they are on.
    */
    render(<EventsScreen />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect(screen.getByText('3 people')).toBeTruthy()
    expect(screen.getByText('2 shifts')).toBeTruthy()
  })

  it('will not go until the name is typed back', async () => {
    render(<EventsScreen />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    const go = (): HTMLButtonElement =>
      screen.getByRole('button', { name: 'Remove it' }) as HTMLButtonElement
    expect(go().disabled).toBe(true)

    await userEvent.type(screen.getByLabelText(/Type the event name/), 'wrong')
    expect(go().disabled).toBe(true)

    await userEvent.clear(screen.getByLabelText(/Type the event name/))
    await userEvent.type(screen.getByLabelText(/Type the event name/), 'Apple Day 2026')
    expect(go().disabled).toBe(false)

    await userEvent.click(go())
    await waitFor(() => expect(removeEvent).toHaveBeenCalledTimes(1))
    expect(removeEvent.mock.calls[0]![0]).toMatchObject({ id: '2026' })
  })

  it('says the audit log survives it', async () => {
    // Entries are create-only by rule, so a removal is never quite total. Pretending
    // otherwise would be the wrong promise.
    render(<EventsScreen />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)
    await waitFor(() =>
      expect(screen.getByText(/audit log keeps its record/)).toBeTruthy(),
    )
  })

  it('says so when there is nothing in it', async () => {
    tally = {}
    render(<EventsScreen />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!)
    await waitFor(() => expect(screen.getByText(/holds nothing/)).toBeTruthy())
  })
})

describe('creating an event', () => {
  /*
    Reported: "when doing the original event create it is a very limited create screen vs
    the edit screen."

    It was. Creating asked for a name and offered to copy last year's locations. The dates,
    the hours, the shift length, the overlap, where volunteers report and who they can ring
    were all in the editor only — so the way to set up a year was to create it, look at a
    board built from defaults nobody had chosen, and work out that there was a second
    button. Both forms are now the same component over the same shape.
  */
  const openCreate = async (): Promise<void> => {
    render(<EventsScreen />)
    await userEvent.click(screen.getByRole('button', { name: 'New event' }))
  }

  beforeEach(() => {
    createEvent.mockReset()
    createEvent.mockResolvedValue('apple-day-2027')
  })

  it('asks everything the editor asks', async () => {
    await openCreate()

    // The whole point. Each of these was reachable only after the event existed.
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.getByLabelText('Link')).toBeTruthy()
    expect(screen.getByLabelText('First day')).toBeTruthy()
    expect(screen.getByLabelText('Last day')).toBeTruthy()
    expect(screen.getByLabelText('Scheduling')).toBeTruthy()
    expect(screen.getByLabelText('Shift length')).toBeTruthy()
    expect(screen.getByLabelText('Overlap')).toBeTruthy()
    expect(screen.getByLabelText('Friday start')).toBeTruthy()
    expect(screen.getByLabelText('Base of operations')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add contact' })).toBeTruthy()
  })

  it('writes what was filled in, in one go', async () => {
    /*
      One write, not create-then-save. Two would put two entries in the audit log for one
      act, and leave a window where the event existed with hours nobody had chosen.
    */
    await openCreate()

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Apple Day 2027' },
    })
    await userEvent.selectOptions(screen.getByLabelText('Shift length'), '90')
    setTime('Saturday start', '08:30')
    await userEvent.click(screen.getByRole('button', { name: 'Add contact' }))
    await userEvent.type(screen.getByLabelText('Contact 1 phone'), '519-555-0100')

    await userEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(createEvent).toHaveBeenCalledTimes(1))
    expect(createEvent.mock.calls[0]![0]).toMatchObject({
      name: 'Apple Day 2027',
      shiftMinutes: 90,
      support: [{ name: '', phone: '519-555-0100', email: '' }],
    })
    expect(createEvent.mock.calls[0]![0].schedule.sat.startMin).toBe(8 * 60 + 30)
    // And nothing is saved a second time to fill in what the form could not ask for.
    expect(saveEvent).not.toHaveBeenCalled()
  })

  it('opens on defaults that can be accepted as they stand', async () => {
    // An event with no days switched on has nothing to schedule and no board to look at.
    await openCreate()

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toContain('2027')
    expect((screen.getByLabelText('Friday start') as HTMLInputElement).value).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })

  it('says a name is taken while the form is still open', async () => {
    /*
      Said while the form is open. Accepting the name, closing the dialog and only then saying
      the event exists is a message about work that never happened, on a form that has gone.
    */
    await openCreate()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Apple Day 2026' },
    })

    expect(screen.getByText(/already exists/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled,
    ).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(createEvent).not.toHaveBeenCalled()
  })

  it('refuses a name with nothing in it', async () => {
    await openCreate()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } })

    expect(screen.getByText('Give it a name.')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('refuses a shape that would schedule nothing', async () => {
    await openCreate()
    // Turn off every day the defaults switched on.
    for (const day of ['Friday', 'Saturday']) {
      const box = screen.getByLabelText(`Run on ${day}`) as HTMLInputElement
      if (box.checked) await userEvent.click(box)
    }

    expect(
      (screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('shows the link the name would produce, before it exists', async () => {
    await openCreate()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Apple Day 2027' },
    })
    expect((screen.getByLabelText('Link') as HTMLInputElement).placeholder).toBe(
      'apple-day-2027',
    )
  })

  it('offers to copy locations, which editing has nothing to offer', async () => {
    // The one field that belongs to creating: afterwards the event has its own list.
    await openCreate()
    expect(screen.getByLabelText(/Start from another event/)).toBeTruthy()

    cleanup()
    render(<EventsScreen />)
    await openEditor()
    expect(screen.queryByLabelText(/Start from another event/)).toBeNull()
  })
})
