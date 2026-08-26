// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRoute } from './helpers/router'
import { toPass } from '../src/domain/passes'

/**
 * Where volunteers report.
 *
 * An event runs from somewhere — a hall with the apples stacked in it — and that is the
 * first thing a parent needs to know. It is denormalized onto the pass so the page still
 * costs a single read on a phone with one bar of signal.
 */

const readPass = vi.fn()
vi.mock('../src/lib/session', () => ({
  runsTheEvent: (role: string) => role === 'admin' || role === 'organizer',
  canEditSetup: (role: string) => role === 'admin',
  canEditLibrary: (role: string) => role === 'admin' || role === 'organizer',
  canRemoveLibrary: (role: string) => role === 'admin',
  canEditEvent: (role: string) => role === 'admin' || role === 'organizer',
  canAddEvent: (role: string) => role === 'admin',
  readPass: (...args: unknown[]) => readPass(...args),
  /*
    The page watches its pass rather than reading it once, so their location can appear the
    moment an organizer checks them in. The mock resolves the same promise and then holds
    the subscription open, which is what the real listener does.
  */
  watchPass: (
    token: string,
    onData: (p: unknown) => void,
    onError: () => void,
  ): (() => void) => {
    void readPass(token).then(onData).catch(onError)
    return () => {}
  },
}))
const requestSwap = vi.fn()
vi.mock('../src/lib/repo', () => ({
  requestSwap: (...args: unknown[]) => requestSwap(...args),
}))

const { PassPage } = await import('../src/ui/PassPage')

beforeEach(() => {
  requestSwap.mockReset()
  requestSwap.mockResolvedValue(undefined)
})

const BASE = {
  name: 'St Andrew’s Church hall',
  address: '54 Foxglove Rd E',
  mapsUrl: 'https://maps.example/hall',
}

const renderPass = (): void => {
  render(
    <MemoryRoute path="/p/:token" url="/p/tok123">
      <PassPage />
    </MemoryRoute>,
  )
}

describe('a volunteer’s pass', () => {
  it('says where to report, with directions', async () => {
    readPass.mockResolvedValue({
      eventId: '2026', base: BASE, personId: 'y01', role: 'volunteer',
      displayName: 'Alpha One', support: [{ name: '', phone: '519-555-0100', email: '' }],
      arrivalNote: 'Come here first to collect a jar and your apples.',
      shifts: [
        {
          day: 'Friday', slotLabel: '5:00 PM – 6:00 PM', locationName: 'Braemar',
          address: '', mapsUrl: '', comments: '',
        },
      ],
    })
    renderPass()

    await waitFor(() => expect(screen.getByText(/Report to/)).toBeDefined())
    // The base is also named in the line explaining where the location comes from, so
    // check the heading rather than any mention of the hall.
    expect(screen.getByText(/Report to St Andrew/)).toBeDefined()
    expect(screen.getByText('54 Foxglove Rd E')).toBeDefined()
    // Both the base and the shift location offer directions.
    expect(screen.getAllByText('Directions').length).toBeGreaterThan(0)
    // Arrival advice is the organizers' own text now, carried on the pass, not a sentence
    // the app supplies.
    expect(screen.getByText(/collect a jar/)).toBeDefined()
  })

  it('says nothing about a base when the event has none', async () => {
    readPass.mockResolvedValue({
      eventId: '2026', base: null, personId: 'y01', role: 'volunteer',
      displayName: 'Alpha One', support: [], shifts: [],
    })
    renderPass()

    await waitFor(() => expect(screen.getByText('Alpha One')).toBeDefined())
    expect(screen.queryByText(/Report to/)).toBeNull()
  })

  it('still shows the base when somebody has no shifts yet', async () => {
    // They have been told to turn up; where matters even before they are rostered.
    readPass.mockResolvedValue({
      eventId: '2026', base: BASE, personId: 'y01', role: 'volunteer',
      displayName: 'Alpha One', support: [], shifts: [],
    })
    renderPass()

    await waitFor(() => expect(screen.getByText(/Report to/)).toBeDefined())
    expect(screen.getByText(/No shifts on this pass yet/)).toBeDefined()
  })
})

describe('day-of contacts on a pass', () => {
  it('lists every one, as something tappable', async () => {
    readPass.mockResolvedValue({
      eventId: '2026',
      base: BASE,
      personId: 'y01',
      role: 'volunteer',
      displayName: 'Alpha One',
      support: [
        { name: 'Devin, base ops', phone: '519-555-0100', email: 'devin@example.org' },
        { name: 'Saturday cover', phone: '', email: 'saturday@example.org' },
      ],
      shifts: [],
    })
    renderPass()

    // Read in a car park with one bar of signal: nobody retypes a number.
    const call = await screen.findByRole('link', { name: '519-555-0100' })
    expect(call.getAttribute('href')).toBe('tel:519-555-0100')
    expect(screen.getByRole('link', { name: 'devin@example.org' }).getAttribute('href')).toBe(
      'mailto:devin@example.org',
    )
    // A contact with only an email is still a contact.
    expect(screen.getByText('Saturday cover')).toBeTruthy()
    expect(
      screen.getByRole('link', { name: 'saturday@example.org' }).getAttribute('href'),
    ).toBe('mailto:saturday@example.org')
  })

  it('says nothing at all when there are none', async () => {
    readPass.mockResolvedValue({
      eventId: '2026', base: BASE, personId: 'y01', role: 'volunteer',
      displayName: 'Alpha One', support: [], shifts: [],
    })
    renderPass()
    await screen.findByText(/Alpha One/)
    expect(screen.queryByText(/Need help on the day/)).toBeNull()
  })

  it('does not print a bare number twice', async () => {
    // A contact stored with no name falls back to its number as the heading; showing it
    // again beside itself reads as two contacts.
    readPass.mockResolvedValue({
      eventId: '2026', base: BASE, personId: 'y01', role: 'volunteer',
      displayName: 'Alpha One',
      support: [{ name: '', phone: '519-555-0100', email: '' }],
      shifts: [],
    })
    renderPass()

    expect(await screen.findByText('519-555-0100')).toBeTruthy()
    const call = screen.getByRole('link', { name: 'Call' })
    expect(call.getAttribute('href')).toBe('tel:519-555-0100')
  })
})

describe('where they are going is not on the pass until they check in', () => {
  const passWith = (over: Record<string, unknown>) => ({
    eventId: '2026',
    base: BASE,
    personId: 'y01',
    role: 'volunteer',
    displayName: 'Alpha One',
    support: [],
    supportNote: '',
    arrivalNote: '',
    shifts: [
      {
        day: 'Friday',
        slotLabel: '5:00 PM – 6:00 PM',
        locationName: 'Braemar — 640 Linden Drive',
        address: '640 Linden Dr',
        mapsUrl: 'https://maps.example/braemar',
        comments: 'Outside on the sidewalk.',
      },
    ],
    ...over,
  })

  it('withholds the location, and says where it comes from', async () => {
    /*
      Everyone reports to base first — that is where the jars and apples are — so a pass
      naming a location invites a youth to skip base and go straight there. It also means a
      link forwarded around a family group chat does not tell a stranger where a named child
      will be standing at five o'clock.
    */
    readPass.mockResolvedValue(passWith({ revealShifts: false }))
    renderPass()

    await waitFor(() => expect(screen.getByText('Alpha One')).toBeDefined())
    expect(screen.queryByText(/Braemar/)).toBeNull()
    expect(screen.queryByText(/640 Linden/)).toBeNull()
    expect(screen.getByText(/given out at St Andrew/)).toBeDefined()
  })

  it('still shows when their shift is, which is what they need in advance', async () => {
    readPass.mockResolvedValue(passWith({ revealShifts: false }))
    renderPass()

    await waitFor(() => expect(screen.getByText(/5:00 PM/)).toBeDefined())
    expect(screen.getByText(/Report to St Andrew/)).toBeDefined()
  })

  it('shows the location once an organizer has checked them in', async () => {
    readPass.mockResolvedValue(passWith({ revealShifts: true }))
    renderPass()

    await waitFor(() => expect(screen.getByText(/Braemar/)).toBeDefined())
    // The location name itself ends in "640 Linden Drive", so match the address exactly.
    expect(screen.getByText('640 Linden Dr')).toBeDefined()
    expect(screen.getByText(/Outside on the sidewalk/)).toBeDefined()
  })

  it('says so without naming a base when the event has none', async () => {
    readPass.mockResolvedValue(passWith({ revealShifts: false, base: null }))
    renderPass()

    await waitFor(() => expect(screen.getByText('Alpha One')).toBeDefined())
    expect(screen.getByText(/given out when you check in/)).toBeDefined()
  })

  it('hides it on a pass that predates the field', async () => {
    /*
      Asserted against a fixture that leaves `revealShifts` out entirely, because that is the
      only way to cover what the reader does when the field is missing. Setting it by hand
      proves nothing about that case. The reader
      treats absent as hidden; see the converter's own test for that.
    */
    const legacy: Record<string, unknown> = passWith({ revealShifts: true })
    delete legacy.revealShifts
    readPass.mockResolvedValue(toPass(legacy))
    renderPass()

    await waitFor(() => expect(screen.getByText(/given out/)).toBeDefined())
    expect(screen.queryByText(/Braemar/)).toBeNull()
  })
})

describe('instructions on a pass are the organizers’ own words', () => {
  it('prints nothing of its own where there are no instructions', async () => {
    readPass.mockResolvedValue({
      eventId: '2026', base: BASE, personId: 'y01', role: 'volunteer',
      displayName: 'Alpha One', support: [], supportNote: '', arrivalNote: '',
      revealShifts: true, shifts: [],
    })
    renderPass()

    await waitFor(() => expect(screen.getByText('Alpha One')).toBeDefined())
    // "Please arrive about 15 minutes before your shift" and "come here first to collect a
    // jar" were both built into the page, where nobody could change or drop them.
    expect(screen.queryByText(/15 minutes/)).toBeNull()
    expect(screen.queryByText(/collect a jar/)).toBeNull()
  })

  it('prints what the organizers wrote, in both places', async () => {
    readPass.mockResolvedValue({
      eventId: '2026', base: BASE, personId: 'y01', role: 'volunteer',
      displayName: 'Alpha One',
      support: [{ name: 'Devin', phone: '519-555-0100', email: '' }],
      supportNote: 'Texting is quicker than calling.',
      arrivalNote: 'Come to the side door.',
      revealShifts: true, shifts: [],
    })
    renderPass()

    await waitFor(() => expect(screen.getByText(/side door/)).toBeDefined())
    expect(screen.getByText(/Texting is quicker/)).toBeDefined()
  })
})

describe('asking for a change from a pass', () => {
  const ready = async (): Promise<void> => {
    readPass.mockResolvedValue({
      eventId: '2026', base: BASE, personId: 'y01', role: 'volunteer',
      displayName: 'Alpha One', support: [], supportNote: '', arrivalNote: '',
      revealShifts: true, shifts: [],
    })
    renderPass()
    await waitFor(() => expect(screen.getByText('Alpha One')).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: 'Send a request' }))
  }

  it('records what was asked for', async () => {
    await ready()
    await userEvent.selectOptions(screen.getByLabelText(/What do you need/), 'cancel')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(requestSwap).toHaveBeenCalledWith('2026', 'tok123', 'cancel', '', '')
  })

  it('offers the things somebody actually asks for', async () => {
    await ready()
    const options = Array.from(
      (screen.getByLabelText(/What do you need/) as HTMLSelectElement).options,
    ).map((o) => o.textContent)
    expect(options).toEqual([
      'Ask to swap',
      'Cannot make it',
      'Need a hand',
      'Something else',
    ])
  })

  it('does not offer reporting somebody else absent', async () => {
    // That is an organizer's judgement about a person, not a request from one.
    await ready()
    expect(
      Array.from(
        (screen.getByLabelText(/What do you need/) as HTMLSelectElement).options,
      ).map((o) => o.value),
    ).not.toContain('noShow')
  })

  it('sends a request for a hand', async () => {
    await ready()
    await userEvent.selectOptions(screen.getByLabelText(/What do you need/), 'help')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(requestSwap.mock.calls[0]![2]).toBe('help')
  })

  it('says so where the button was', async () => {
    /*
      The bug: the confirmation rendered in a note at the top of a long pass while the
      button sat at the bottom, so sending a request looked exactly like nothing happening.
      The request was recorded and the volunteer had no way to know.
    */
    await ready()
    const button = screen.getByRole('button', { name: 'Send' })
    const card = button.closest('.card') as HTMLElement

    await userEvent.click(button)
    expect(within(card).getByRole('status').textContent).toMatch(/An organizer will pick this up/)
  })

  it('says a failure looks like a failure, and what to do instead', async () => {
    requestSwap.mockRejectedValueOnce(new Error('offline'))
    await ready()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    const status = screen.getByRole('status')
    // Green for "could not send" is worse than no message at all.
    expect(status.className).toContain('error')
    expect(status.textContent).toMatch(/phone one of the contacts/)
  })

  it('carries the volunteer’s own words with it', async () => {
    await ready()
    await userEvent.type(screen.getByLabelText(/Anything to add/), 'soccer runs late')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(requestSwap).toHaveBeenCalledWith('2026', 'tok123', 'swap', 'soccer runs late', '')
  })

  it('cannot be sent twice by an impatient second tap', async () => {
    let release: (() => void) | undefined
    requestSwap.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve }),
    )
    await ready()

    const button = screen.getByRole('button', { name: 'Send' })
    await userEvent.click(button)
    // Mid-flight it says so and is disabled, rather than sitting there inviting another tap.
    const busy = screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)

    release?.()
    await waitFor(() => expect(requestSwap).toHaveBeenCalledTimes(1))
  })
})

describe('saying which shift you cannot make', () => {
  const twoShifts = () => ({
    eventId: '2026', base: BASE, personId: 'y01', role: 'volunteer',
    displayName: 'Alpha One', support: [], supportNote: '', arrivalNote: '',
    revealShifts: true,
    shifts: [
      { slotId: 'fri-1700', day: 'Friday', slotLabel: '5:00 PM – 6:00 PM',
        locationName: 'Braemar', address: '', mapsUrl: '', comments: '' },
      { slotId: 'sat-0900', day: 'Saturday', slotLabel: '9:00 AM – 10:00 AM',
        locationName: 'Kelmont', address: '', mapsUrl: '', comments: '' },
    ],
  })

  const openForm = async (): Promise<void> => {
    renderPass()
    await waitFor(() => expect(screen.getByText('Alpha One')).toBeDefined())
    await userEvent.click(screen.getByRole('button', { name: 'Send a request' }))
  }

  it('asks which one, when they have more than one', async () => {
    // Otherwise the organizer receiving it cannot tell whether the Friday evening or the
    // Saturday morning is the problem, and the only action takes them off both.
    readPass.mockResolvedValue(twoShifts())
    await openForm()

    const picker = screen.getByLabelText(/Which shift/)
    expect(picker).toBeDefined()
    await userEvent.selectOptions(screen.getByLabelText(/What do you need/), 'cancel')
    await userEvent.selectOptions(picker, 'sat-0900')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    // What they are asking and which shift they mean, as two separate answers.
    expect(requestSwap).toHaveBeenCalledWith('2026', 'tok123', 'cancel', '', 'sat-0900')
  })

  it('defaults to all of them, which is the honest default', async () => {
    readPass.mockResolvedValue(twoShifts())
    await openForm()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    // Nothing chosen for the shift, so the request is about all of them.
    expect(requestSwap).toHaveBeenCalledWith('2026', 'tok123', 'swap', '', '')
  })

  it('does not ask when there is only one shift to mean', async () => {
    readPass.mockResolvedValue({ ...twoShifts(), shifts: [twoShifts().shifts[0]!] })
    await openForm()
    expect(screen.queryByLabelText(/Which shift/)).toBeNull()
  })

  it('only asks for the two requests that are about a shift', async () => {
    /*
      "Cannot make it" and "ask to swap" are both requests to change one shift, so which is
      the whole of what an organizer needs. "Need a hand" is about the person and "something
      else" is whatever the list could not express — asking which shift they mean invites an
      answer that is not true.
    */
    readPass.mockResolvedValue(twoShifts())
    await openForm()
    const kind = screen.getByLabelText(/What do you need/)

    for (const about of ['swap', 'cancel']) {
      await userEvent.selectOptions(kind, about)
      expect(screen.queryByLabelText(/Which shift/), about).not.toBeNull()
    }
    for (const notAbout of ['help', 'question']) {
      await userEvent.selectOptions(kind, notAbout)
      expect(screen.queryByLabelText(/Which shift/), notAbout).toBeNull()
    }
  })

  it('forgets a shift chosen before switching to a request that is not about one', async () => {
    /*
      Otherwise the choice is still held after it leaves the screen, and a question arrives
      attached to a shift — which reads as a claim about a shift nobody was talking about.
    */
    readPass.mockResolvedValue(twoShifts())
    await openForm()

    await userEvent.selectOptions(screen.getByLabelText(/What do you need/), 'cancel')
    await userEvent.selectOptions(screen.getByLabelText(/Which shift/), 'sat-0900')
    await userEvent.selectOptions(screen.getByLabelText(/What do you need/), 'question')
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))

    expect(requestSwap).toHaveBeenCalledWith('2026', 'tok123', 'question', '', '')
  })
})
