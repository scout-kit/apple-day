// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetUrl } from './helpers/url'
import type { Assignment, Person, Slot } from '../src/domain/types'

/**
 * The reminder screen.
 *
 * The behaviour worth pinning is what happens between reading the list and pressing send.
 * Somebody checking in while the list is on screen is the ordinary case — that is what the
 * day-of screen is for — and sending the list as it was read would tell somebody standing
 * at a table that we are still expecting them.
 */

const SLOTS: Slot[] = [
  { id: 'sat-0900', day: 'sat', startMin: 540, endMin: 600, label: '9:00 AM' },
  { id: 'sat-1000', day: 'sat', startMin: 600, endMin: 660, label: '10:00 AM' },
]

const person = (id: string, first: string, over: Partial<Person> = {}): Person => ({
  id, firstName: first, lastName: 'R', section: 'cubs',
  parentName: 'Ada R', parentEmail: `${first.toLowerCase()}@example.org`, parentPhone: '',
  pairWithPersonId: null, ...over,
})

const shift = (id: string, personId: string, over: Partial<Assignment> = {}): Assignment => ({
  id, slotId: 'sat-0900', locationId: 'braemar', personId,
  status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null, ...over,
})

let people: Person[] = []
let assignments: Assignment[] = []

/** Everything handed to the mail sender, in order. */
let sent: { to: string; subject: string; body: string }[] = []
/** Every ledger write. */
let recorded: string[] = []
/** Who the ledger says has already had it. */
let already = new Set<string>()
/** Which reminder the records in `already` are about. The screen opens on this one. */
let alreadyFor = { templateId: 'event_schedule', selectionKey: 'event' }
let sendFails = new Set<string>()

vi.mock('../src/lib/repo', () => ({
  usePeople: () => ({ data: people, loading: false, error: null }),
  useAssignments: () => ({ data: assignments, loading: false, error: null }),
  // Where to report, which every wording names.
  useBaseLocation: () => ({
    data: { id: 'hall', name: 'The Scout Hall', address: '5 King St', mapsUrl: '' },
    loading: false,
    error: null,
  }),
  usePasses: () => ({
    data: people.map((p) => ({
      token: `tok-${p.id}`, personId: p.id, displayName: p.firstName, shiftCount: 1,
    })),
    loading: false,
    error: null,
  }),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({
    event: { id: '2026', name: 'Apple Day 2026', slug: 'apple-day', support: [] },
    eventId: '2026',
    slots: SLOTS,
    pathFor: (s: string) => `/e/2026/${s}`,
  }),
}))

/** Wording an organizer has saved over the built-in. Empty unless a test sets one. */
let savedWording = new Map<string, { subject: string; body: string }>()
const saveReminderTemplate = vi.fn()
const resetReminderTemplate = vi.fn()

/*
  The ledger, as a live listener rather than a lookup.

  `already` is kept as the shorthand the tests set — it names person ids that have had the
  reminder under test — and is turned into records here, so the screen reads it the way it
  reads the real thing. `alreadyFor` says which reminder those records are about; it
  defaults to the one the screen opens on.
*/
vi.mock('../src/lib/reminders', () => ({
  useSentReminders: () => ({
    data: [...already].map((personId) => ({
      templateId: alreadyFor.templateId,
      selectionKey: alreadyFor.selectionKey,
      personId,
      assignmentIds: [],
      sentAt: 1,
      sentBy: 'u1',
      sentByEmail: 'organizer@example.org',
      channel: 'gmail' as const,
    })),
    loading: false,
    error: null,
  }),
  useReminderTemplates: () => ({ data: savedWording, loading: false, error: null }),
  saveReminderTemplate: (...a: unknown[]) => saveReminderTemplate(...a),
  resetReminderTemplate: (...a: unknown[]) => resetReminderTemplate(...a),
  recordSent: async (
    _e: string, _t: string, _s: unknown,
    youths: { person: { id: string } }[],
  ) => {
    recorded.push(...youths.map((y) => y.person.id))
  },
  recordSendInLog: async () => undefined,
  pendingFor: (
    recipient: { youths: { person: { id: string } }[] },
    sent2: ReadonlySet<string>,
    mode: string,
  ) =>
    mode === 'resend'
      ? recipient.youths
      : recipient.youths.filter((y) => !sent2.has(y.person.id)),
}))

/*
  The senders are stubbed, not the delivery loop.

  `deliver` is what decides that one bad address costs one message and not the run, so it
  runs for real here — only the thing that talks to Google is replaced.
*/
const stubSender = (channel: string) => ({
  channel,
  label: channel,
  isConnected: () => true,
  connect: async () => {},
  sendingAs: () => 'organizer@example.org',
  send: async (m: { to: string; subject: string; body: string }) => {
    if (sendFails.has(m.to)) throw new Error('550 mailbox unavailable')
    sent.push(m)
  },
  finish: () => {},
})

vi.mock('../src/lib/mail/gmail', () => ({ gmailSender: () => stubSender('gmail') }))
vi.mock('../src/lib/mail/csvExport', () => ({ csvSender: () => stubSender('csv') }))
/** Whether a mailbox counts as set up. Flipped by the tests that care. */
let configured = true

vi.mock('../src/lib/mail/config', () => ({
  GOOGLE_CLIENT_ID: 'g',
  publicOrigin: () => 'https://appleday.example.org',
  originLooksPublic: () => true,
  channelConfigured: (c: string) => c === 'csv' || configured,
  missingSetting: (c: string) => (c === 'gmail' ? 'VITE_GOOGLE_CLIENT_ID' : ''),
}))

const { RemindersScreen } = await import('../src/ui/RemindersScreen')

const openReview = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: /Review and send/ }))
}
const sendNow = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: /^Send to/ }))
}

beforeEach(() => {
  resetUrl()
  people = [person('p1', 'Elliot'), person('p2', 'Boyan')]
  assignments = [shift('a1', 'p1'), shift('a2', 'p2')]
  sent = []
  recorded = []
  already = new Set()
  alreadyFor = { templateId: 'event_schedule', selectionKey: 'event' }
  sendFails = new Set()
  configured = true
  savedWording = new Map()
  saveReminderTemplate.mockReset()
  saveReminderTemplate.mockResolvedValue(undefined)
  resetReminderTemplate.mockReset()
  resetReminderTemplate.mockResolvedValue(undefined)
})

describe('choosing who it goes to', () => {
  it('opens on the whole event and lists every address', () => {
    render(<RemindersScreen />)
    expect(screen.getByRole('heading', { name: '2 addresses' })).toBeTruthy()
    expect(screen.getByText(/covering 2 on the schedule/)).toBeTruthy()
    expect(screen.getByText('elliot@example.org')).toBeTruthy()
    expect(screen.getByText('boyan@example.org')).toBeTruthy()
  })

  it('says plainly when nobody covered has an address', () => {
    /*
      The state the app is actually in today: the signup form has never asked for an email,
      so every selection is empty. An empty list with no explanation reads as a bug.
    */
    people = [person('p1', 'Elliot', { parentEmail: '' })]
    assignments = [shift('a1', 'p1')]
    render(<RemindersScreen />)
    expect(screen.getByText(/has an email address on file/)).toBeTruthy()
  })

  it('lists who to ring instead', () => {
    people = [person('p1', 'Elliot', { parentEmail: '', parentPhone: '519-555-0100' })]
    assignments = [shift('a1', 'p1')]
    render(<RemindersScreen />)
    expect(screen.getByText(/Cannot be emailed/)).toBeTruthy()
    expect(screen.getByRole('link', { name: '519-555-0100' })).toBeTruthy()
  })
})

describe('the wording and the filter', () => {
  it('locks the filter on for wording that claims somebody has not checked in', async () => {
    /*
      The one rule tying the two choices together. "We have not checked you in" is a claim,
      and the control that makes it true is not something to leave switchable.
    */
    render(<RemindersScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Covering'), 'day')
    await userEvent.selectOptions(screen.getByLabelText('Wording'), 'not_checked_in')

    const box = screen.getByLabelText(/Only those who have not checked in/) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(true)
    // The reason sits outside the label, so reading it does not toggle what it explains.
    expect(screen.getByText(/Always on for this wording/)).toBeTruthy()
  })

  it('does not offer shift wording for a whole-event send', () => {
    render(<RemindersScreen />)
    const options = Array.from(
      (screen.getByLabelText('Wording') as HTMLSelectElement).options,
    ).map((o) => o.value)
    expect(options).toEqual(['event_schedule'])
  })

  it('starts with the filter on for a shift reminder, and says why', async () => {
    /*
      Reported: somebody with back-to-back shifts who checked in for the earlier one should
      not be told the later one is coming up — they are already standing on it. Checking in
      covers the whole stretch, so the filter catches them; it just has to be on.

      On by default rather than locked: it is a judgement about the ordinary case, not a
      claim the wording makes.
    */
    assignments = [shift('a1', 'p1', { status: 'checkedIn' }), shift('a2', 'p2')]
    render(<RemindersScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Covering'), 'day')

    const box = screen.getByLabelText(/Only those who have not checked in/) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(false)
    expect(screen.getByText(/already checked in is already there/)).toBeTruthy()

    expect(screen.queryByText('elliot@example.org')).toBeNull()
    expect(screen.getByText('boyan@example.org')).toBeTruthy()
  })

  it('can still be turned off deliberately', async () => {
    // A default, not a lock — which is only meaningful if it can be cleared.
    assignments = [shift('a1', 'p1', { status: 'checkedIn' }), shift('a2', 'p2')]
    render(<RemindersScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Covering'), 'day')
    await userEvent.click(screen.getByLabelText(/Only those who have not checked in/))

    expect(screen.getByText('elliot@example.org')).toBeTruthy()
  })

  it('leaves it off for the whole-event schedule, which is not about an hour', async () => {
    assignments = [shift('a1', 'p1', { status: 'checkedIn' }), shift('a2', 'p2')]
    render(<RemindersScreen />)

    const box = screen.getByLabelText(/Only those who have not checked in/) as HTMLInputElement
    expect(box.checked).toBe(false)
    expect(screen.getByText('elliot@example.org')).toBeTruthy()
  })

  it('follows the new wording default when the wording changes', async () => {
    render(<RemindersScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Covering'), 'day')
    // Off for the schedule wording…
    await userEvent.selectOptions(screen.getByLabelText('Wording'), 'event_schedule')
    expect(
      (screen.getByLabelText(/Only those who have not checked in/) as HTMLInputElement).checked,
    ).toBe(false)
    // …and back on for the one that is about an hour.
    await userEvent.selectOptions(screen.getByLabelText('Wording'), 'shift_upcoming')
    expect(
      (screen.getByLabelText(/Only those who have not checked in/) as HTMLInputElement).checked,
    ).toBe(true)
  })
})

describe('the preview', () => {
  it('shows the real subject and body for a real recipient', async () => {
    // The first alphabetically, which is Boyan — a real person's real link, not a sample.
    render(<RemindersScreen />)
    await openReview()
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText(/Subject: Your shifts for Apple Day 2026/)).toBeTruthy()
    expect(within(dialog).getByText(/appleday\.example\.org\/p\/tok-p2/)).toBeTruthy()
  })

  /**
   * What a reminder about one hour says it is about.
   *
   * The hour decides who is written to. It is not a fact about any of them: somebody down
   * for nine till eleven, nudged about the nine o'clock, got "Your Saturday 9:00 AM shift"
   * over a message whose own lines said nine till eleven — and the subject is the half a
   * parent reads.
   */
  describe('for one hour of a stretch somebody works twice', () => {
    beforeEach(() => {
      people = [person('p1', 'Elliot')]
      assignments = [
        shift('a1', 'p1', { slotId: 'sat-0900' }),
        shift('a2', 'p1', { slotId: 'sat-1000' }),
      ]
    })

    const openHour = async (): Promise<void> => {
      render(<RemindersScreen />)
      await userEvent.selectOptions(screen.getByLabelText('Covering'), 'slot')
      await userEvent.selectOptions(screen.getByLabelText('Shift'), 'sat-0900')
      await openReview()
    }

    it('names the day in the subject, and not an hour it does not work', async () => {
      await openHour()
      const dialog = screen.getByRole('dialog')
      expect(within(dialog).getByText(/Subject: Your Saturday shift at Apple Day 2026/)).toBeTruthy()
    })

    it('leads with the stretch, and names the hour only as the reason it landed', async () => {
      await openHour()
      const shown = document.querySelector('pre')!.textContent ?? ''
      expect(shown).toContain('Saturday 9:00 AM – 11:00 AM')
      expect(shown).toContain('the whole stretch — this went out for the 9:00 AM shift')
      // Nowhere else. The sentence above the block used to name the hour a third time.
      expect(shown.match(/9:00 AM/g)).toHaveLength(2)
    })

    it('says nothing about an hour when a whole day was chosen', async () => {
      // There is no hour to explain, and every stretch they work that day is listed.
      render(<RemindersScreen />)
      await userEvent.selectOptions(screen.getByLabelText('Covering'), 'day')
      await openReview()

      const shown = document.querySelector('pre')!.textContent ?? ''
      expect(shown).not.toContain('this went out for')
      expect(shown).toContain('Saturday 9:00 AM – 11:00 AM')
    })
  })

  it('says the rest get the same, personalised', async () => {
    render(<RemindersScreen />)
    await openReview()
    expect(screen.getByText(/Everybody else gets the same/)).toBeTruthy()
  })
})

describe('sending', () => {
  it('sends one message per address and records each one', async () => {
    render(<RemindersScreen />)
    await openReview()
    await sendNow()

    await waitFor(() => expect(screen.getByText(/2 sent/)).toBeTruthy())
    expect(sent.map((m) => m.to).sort()).toEqual(['boyan@example.org', 'elliot@example.org'])
    expect(recorded.sort()).toEqual(['p1', 'p2'])
  })

  it('skips anybody who has already had this exact reminder', async () => {
    // The accidental second click, which is the whole reason the ledger exists.
    already = new Set(['p1'])
    render(<RemindersScreen />)
    await openReview()
    await sendNow()

    await waitFor(() => expect(screen.getByText(/1 sent/)).toBeTruthy())
    expect(sent.map((m) => m.to)).toEqual(['boyan@example.org'])
    expect(screen.getByText(/1 skipped, already sent this/)).toBeTruthy()
  })

  it('sends to them anyway when told to', async () => {
    already = new Set(['p1'])
    render(<RemindersScreen />)
    await openReview()
    await userEvent.click(screen.getByLabelText(/Send again to anybody/))
    await sendNow()

    await waitFor(() => expect(sent).toHaveLength(2))
  })

  it('carries on past an address that fails, and says which', async () => {
    sendFails = new Set(['elliot@example.org'])
    render(<RemindersScreen />)
    await openReview()
    await sendNow()

    await waitFor(() => expect(screen.getByText(/1 failed/)).toBeTruthy())
    expect(sent.map((m) => m.to)).toEqual(['boyan@example.org'])
    expect(screen.getByText(/550 mailbox unavailable/)).toBeTruthy()
    // And it does not record somebody who was never told, so a retry reaches them.
    expect(recorded).toEqual(['p2'])
  })
})

describe('when the list moves between reading it and sending it', () => {
  /*
    The fixture is changed *and* the tree re-rendered, because that is what actually
    happens: a Firestore listener delivers a snapshot and React renders again. Changing the
    data alone would leave the component holding the array from its last render, and the
    test would be proving something the app never does.
  */
  it('sends nothing on the press that discovers the change', async () => {
    /*
      The behaviour the whole arrangement is for. An organizer opens the chase list at the
      table, somebody walks up and checks in, and the press that finds that out must not
      also send — otherwise the warning arrives after the email telling them we are still
      waiting.
    */
    assignments = [shift('a1', 'p1'), shift('a2', 'p2')]
    const view = render(<RemindersScreen />)
    // The filter is on by default for this wording; nothing to click.
    await userEvent.selectOptions(screen.getByLabelText('Covering'), 'day')
    await openReview()

    assignments = [shift('a1', 'p1', { status: 'checkedIn' }), shift('a2', 'p2')]
    view.rerender(<RemindersScreen />)
    await sendNow()

    expect(sent).toEqual([])
    expect(recorded).toEqual([])
    expect(screen.getByText(/dropped out of the list/)).toBeTruthy()
    expect(screen.getByText(/Nothing has been sent/)).toBeTruthy()
  })

  it('sends the corrected list on the next press', async () => {
    assignments = [shift('a1', 'p1'), shift('a2', 'p2')]
    const view = render(<RemindersScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Covering'), 'day')
    await openReview()

    assignments = [shift('a1', 'p1', { status: 'checkedIn' }), shift('a2', 'p2')]
    view.rerender(<RemindersScreen />)
    await sendNow()

    // The list on screen is now the list that will go, so a second press sends it.
    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^Send to 1 address/ }) as HTMLButtonElement).disabled).toBe(false),
    )
    await sendNow()

    await waitFor(() => expect(screen.getByText(/1 sent/)).toBeTruthy())
    expect(sent.map((m) => m.to)).toEqual(['boyan@example.org'])
  })

  it('notices somebody who joined the list, and holds off just the same', async () => {
    const view = render(<RemindersScreen />)
    await openReview()

    people = [...people, person('p3', 'Nadia')]
    assignments = [...assignments, shift('a3', 'p3')]
    view.rerender(<RemindersScreen />)
    await sendNow()

    expect(sent).toEqual([])
    expect(screen.getByText(/joined it/)).toBeTruthy()

    await waitFor(() =>
      expect((screen.getByRole('button', { name: /^Send to 3 addresses/ }) as HTMLButtonElement).disabled).toBe(false),
    )
    await sendNow()
    await waitFor(() => expect(screen.getByText(/3 sent/)).toBeTruthy())
  })
})

describe('what has already gone out', () => {
  it('is said before the send, not after it', async () => {
    /*
      Stopping the second click is the whole purpose of the record, and it cannot do that if
      it is only consulted once the click has happened — which is how it worked at first.
    */
    already = new Set(['p1'])
    render(<RemindersScreen />)
    await openReview()

    // Inside the dialog: the main screen says it too now, which is the point.
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog')).getByText(/already had this reminder/),
      ).toBeTruthy(),
    )
    expect(screen.getByRole('button', { name: /^Send to 1 address/ })).toBeTruthy()
    expect(sent).toEqual([])
  })

  it('offers to send anyway, and says what that will do', async () => {
    already = new Set(['p1'])
    render(<RemindersScreen />)
    await openReview()
    await waitFor(() => expect(screen.getByText(/will be skipped/)).toBeTruthy())

    await userEvent.click(screen.getByLabelText(/Send again to anybody/))
    expect(screen.getByText(/will be sent it again/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Send to 2 addresses/ })).toBeTruthy()
  })

  it('says so plainly when there is nobody left to tell', async () => {
    already = new Set(['p1', 'p2'])
    render(<RemindersScreen />)
    await openReview()

    await waitFor(() =>
      expect(screen.getByText(/Everybody on this selection has already had/)).toBeTruthy(),
    )
    // And the send button is not offered as something to press.
    expect((screen.getByRole('button', { name: /^Send to 0/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('a mailbox that has not been set up', () => {
  /*
    Reported as "I press Choose the mailbox and nothing happens".

    It was refusing correctly — there is no client id, so there is nothing to ask
    permission of — and saying so at the top of the page, four cards above the button. From
    where the button is, that is indistinguishable from a dead control.
  */
  beforeEach(() => {
    configured = false
  })

  it('says so before anything is pressed, and names what is missing', () => {
    render(<RemindersScreen />)
    expect(screen.getByText(/has not been set up to send from Gmail/)).toBeTruthy()
    expect(screen.getByText('VITE_GOOGLE_CLIENT_ID')).toBeTruthy()
  })

  it('does not offer a button that cannot work', () => {
    render(<RemindersScreen />)
    expect(
      (screen.getByRole('button', { name: /Choose the mailbox/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Review and send' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('points at the way that needs no setup', () => {
    // The dropdown also has an option by that name, so this looks inside the warning.
    render(<RemindersScreen />)
    const warning = screen.getByText(/has not been set up to send from Gmail/)
    expect(warning.textContent).toContain('Download a file instead')
    expect(warning.textContent).toContain('needs no setup')
  })

  it('marks it in the dropdown too', () => {
    render(<RemindersScreen />)
    const options = Array.from(
      (screen.getByLabelText('How to send') as HTMLSelectElement).options,
    ).map((o) => o.textContent)
    expect(options.filter((o) => o?.includes('not set up'))).toHaveLength(1)
  })

  it('lets the file option through, because it needs nothing', async () => {
    render(<RemindersScreen />)
    await userEvent.selectOptions(screen.getByLabelText('How to send'), 'csv')
    expect(
      (screen.getByRole('button', { name: 'Review and send' }) as HTMLButtonElement).disabled,
    ).toBe(false)
    expect(screen.queryByText(/has not been set up/)).toBeNull()
  })
})

describe('rewording a reminder', () => {
  const openEditor = async (): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: 'Edit wording' }))
  }

  /** The rendered message under the fields. Queried directly — it is the only `pre` open. */
  const previewText = (): string => document.querySelector('pre')!.textContent ?? ''

  it('opens on the wording that is in force', async () => {
    render(<RemindersScreen />)
    await openEditor()
    expect((screen.getByLabelText('Subject') as HTMLInputElement).value).toContain('{{event}}')
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toContain(
      '{{shifts}}',
    )
  })

  it('saves what was typed', async () => {
    /*
      `fireEvent.change` rather than `userEvent.type`: the latter reads `{` as the start of a
      key descriptor, so typing a placeholder types something else entirely. Nothing to do
      with the app — but it would have made this test assert a value nobody can enter.
    */
    render(<RemindersScreen />)
    await openEditor()

    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'Apple Day for {{youth}}' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Save wording' }))

    expect(saveReminderTemplate).toHaveBeenCalledTimes(1)
    expect(saveReminderTemplate.mock.calls[0]![0]).toBe('event_schedule')
    expect(saveReminderTemplate.mock.calls[0]![1]).toMatchObject({
      subject: 'Apple Day for {{youth}}',
    })
  })

  it('will not save a message with no {{shifts}} in it', async () => {
    /*
      The one rule worth refusing over: it carries the times and the link to their own page,
      so a message without it tells a parent nothing — and it would reach sixty families
      before anybody noticed.
    */
    render(<RemindersScreen />)
    await openEditor()

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'See you Saturday.' },
    })

    expect(screen.getByText(/needs \{\{shifts\}\}/)).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Save wording' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('offers nothing to save until something changes', async () => {
    render(<RemindersScreen />)
    await openEditor()
    expect(
      (screen.getByRole('button', { name: 'Save wording' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('says the wording is shared before anything is typed', async () => {
    /*
      It is one record with no event against it, used by every organizer in every year. An
      editor opened from a screen that is otherwise all about this Saturday reads as though
      it belongs to this Saturday, and nothing else in the dialog corrects that.
    */
    render(<RemindersScreen />)
    await openEditor()
    expect(screen.getByText(/everybody sends, in every year/)).toBeTruthy()
  })

  it('lists the placeholders, and offers none for a location', async () => {
    render(<RemindersScreen />)
    await openEditor()
    expect(screen.getByText('{{shifts}}')).toBeTruthy()
    expect(screen.queryByText('{{location}}')).toBeNull()
  })

  it('previews the message as it is typed', async () => {
    /*
      Live and underneath, rather than behind a tab. Watching it change while typing is the
      whole value; type-switch-look-switch-back is not.
    */
    render(<RemindersScreen />)
    await openEditor()

    // Always the example, whoever is on the selection — see the note in the dialog.
    expect(previewText()).toContain('Alex')

    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Morning {{parent}}.\n\n{{shifts}}' },
    })
    expect(previewText()).toContain('Morning A Parent.')
    expect(previewText()).toContain('Saturday')
  })

  it('previews the subject too, filled in', async () => {
    render(<RemindersScreen />)
    await openEditor()
    fireEvent.change(screen.getByLabelText('Subject'), {
      target: { value: 'For {{youth}} at {{event}}' },
    })
    expect(screen.getByText(/Subject: For Alex and Sam at Apple Day 2026/)).toBeTruthy()
  })

  it('previews the same example whoever is on the selection', async () => {
    /*
      A real recipient would be an arbitrary sample of one — the first address
      alphabetically — so the preview would change with the selection and might show the
      dullest case there is. The example is built to show what an edit breaks.
    */
    render(<RemindersScreen />)
    await openEditor()

    expect(screen.getByText(/How it will read/)).toBeTruthy()
    expect(screen.getByText(/two children on the list/)).toBeTruthy()
    expect(previewText()).not.toContain('Boyan')
    expect(previewText()).not.toContain('Elliot')
  })

  it('previews the same thing when nobody at all can be emailed', async () => {
    people = [person('p1', 'Elliot', { parentEmail: '' })]
    assignments = [shift('a1', 'p1')]
    render(<RemindersScreen />)
    await openEditor()
    expect(previewText()).toContain('Alex')
  })

  it('shows the shape an edit is most likely to break', async () => {
    // Two children: joined names, a labelled block each, a link each.
    render(<RemindersScreen />)
    await openEditor()

    const shown = previewText()
    expect(shown).toContain('Alex and Sam')
    expect(shown).toContain('Alex:')
    expect(shown).toContain('Sam:')
    // Their own pages: one each. The directions link to base is not one of these.
    expect(shown.match(/\/p\//g)).toHaveLength(2)
  })

  it('shows a broken wording as it would actually read', async () => {
    // The refusal says what is wrong; the preview shows what it would look like, which is
    // the faster way to see that the times and the link have gone.
    render(<RemindersScreen />)
    await openEditor()
    /*
      `{{parent}}` and not `{{occasion}}`: a whole-event send has no occasion, so a line
      holding only that placeholder is dropped entirely — which is the empty-placeholder
      rule working, and would leave nothing here to look at.
    */
    fireEvent.change(screen.getByLabelText('Message'), {
      target: { value: 'Hi {{parent}}, see you then.' },
    })

    expect(screen.getByText(/needs \{\{shifts\}\}/)).toBeTruthy()
    expect(previewText()).toContain('see you then')
    expect(previewText()).not.toContain('http')
    expect(previewText()).not.toContain('9:00')
  })

  it('uses a saved wording for the real message', async () => {
    savedWording = new Map([
      ['event_schedule', { subject: 'Our own subject', body: 'Ours:\n{{shifts}}' }],
    ])
    render(<RemindersScreen />)
    await openReview()

    await waitFor(() => expect(screen.getByText(/Subject: Our own subject/)).toBeTruthy())
    expect(screen.getByText(/reworded by your group/)).toBeTruthy()
  })

  it('offers no way back to a default that is already in force', async () => {
    render(<RemindersScreen />)
    await openEditor()
    expect(screen.queryByRole('button', { name: 'Back to the default' })).toBeNull()
  })

  it('puts a reworded one back', async () => {
    savedWording = new Map([['event_schedule', { subject: 'Ours', body: '{{shifts}}' }]])
    render(<RemindersScreen />)
    await openEditor()

    await userEvent.click(screen.getByRole('button', { name: 'Back to the default' }))
    expect(resetReminderTemplate).toHaveBeenCalledWith('event_schedule', 'Here are your shifts')
  })
})

describe('the shape of the choices', () => {
  it('separates who it goes to from what it says', () => {
    /*
      They were one undifferentiated stack, with the wording picker in the same row as the
      day picker as though it answered the same question — and jumping sideways whenever the
      day picker appeared.
    */
    render(<RemindersScreen />)
    expect(screen.getByRole('heading', { name: 'Who it goes to' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'What it says' })).toBeTruthy()
  })

  it('keeps the reason out of the checkbox label', async () => {
    /*
      A label wrapping the explanation makes the whole paragraph a click target, so reading
      why the filter is on turns it off.
    */
    render(<RemindersScreen />)
    await userEvent.selectOptions(screen.getByLabelText('Covering'), 'day')

    const box = screen.getByLabelText(/Only those who have not checked in/) as HTMLInputElement
    expect(box.checked).toBe(true)

    // The reason is on the page, but not inside the thing that toggles.
    const reason = screen.getByText(/already checked in is already there/)
    expect(reason.closest('label')).toBeNull()

    await userEvent.click(reason)
    expect(box.checked).toBe(true)
  })

  it('links every name to that person own page', () => {
    // No dead ends: a name in a list of people is a way through to the person.
    render(<RemindersScreen />)
    const links = screen.getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.getAttribute('href')).toContain('person/')
    }
  })

  it('links somebody who cannot be emailed too, which is where a number gets added', () => {
    people = [person('p1', 'Elliot', { parentEmail: '', parentPhone: '' })]
    assignments = [shift('a1', 'p1')]
    render(<RemindersScreen />)
    expect(
      screen.getByRole('link', { name: /Elliot/ }).getAttribute('href'),
    ).toContain('person/p1')
  })
})

describe('knowing what has already gone out', () => {
  it('marks each person who has had it, and when', () => {
    /*
      Before this, the list looked identical whether the reminder went an hour ago or never
      — and the only way to find out was to press Review, which is starting the thing you
      were checking on.
    */
    already = new Set(['p1'])
    render(<RemindersScreen />)
    expect(screen.getByText(/· sent /)).toBeTruthy()
  })

  it('says how many of them, above the list', () => {
    already = new Set(['p1'])
    render(<RemindersScreen />)
    expect(screen.getByText(/1 of 2 have already had this reminder/)).toBeTruthy()
  })

  it('says so plainly when it has gone to everybody', () => {
    already = new Set(['p1', 'p2'])
    render(<RemindersScreen />)
    expect(screen.getByText(/Everybody here has already had this reminder/)).toBeTruthy()
  })

  it('says nothing when none of it has gone out', () => {
    render(<RemindersScreen />)
    expect(screen.queryByText(/already had this reminder/)).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Already sent' })).toBeNull()
  })

  it('lists what has been sent, grouped by wording and what it was about', () => {
    // The question somebody arrives with: did the Saturday reminders go out?
    already = new Set(['p1', 'p2'])
    alreadyFor = { templateId: 'shift_upcoming', selectionKey: 'day-sat' }
    render(<RemindersScreen />)

    const card = screen.getByRole('heading', { name: 'Already sent' }).closest('.card') as HTMLElement
    expect(within(card).getByText('Your shift is coming up')).toBeTruthy()
    expect(within(card).getByText(/Saturday/)).toBeTruthy()
    expect(within(card).getByText(/2 people/)).toBeTruthy()
    expect(within(card).getByText(/organizer@example\.org/)).toBeTruthy()
  })
})

describe('sending it again anyway', () => {
  it('is offered even when everybody has already had it', async () => {
    /*
      The case the override exists for. With the list empty of anybody left to tell, the
      way to send it again has to still be reachable — otherwise "send to everyone again"
      is impossible precisely when it is asked for.
    */
    already = new Set(['p1', 'p2'])
    render(<RemindersScreen />)
    await openReview()

    await waitFor(() =>
      expect(screen.getByText(/Everybody on this selection has already had/)).toBeTruthy(),
    )
    expect(
      (screen.getByRole('button', { name: /^Send to 0/ }) as HTMLButtonElement).disabled,
    ).toBe(true)

    await userEvent.click(screen.getByLabelText(/Send again to anybody/))

    const send = screen.getByRole('button', { name: /^Send to 2 addresses/ })
    expect((send as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(send)

    await waitFor(() => expect(screen.getByText(/2 sent/)).toBeTruthy())
    expect(sent.map((m) => m.to).sort()).toEqual(['boyan@example.org', 'elliot@example.org'])
  })
})
