// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SECTIONS } from '../src/domain/sections'
import type { AppleDayEvent } from '../src/domain/types'

/**
 * Building the signup form from the screen that will read it back.
 *
 * Two routes to the same form: a button when Google Forms is set up, and the questions to
 * copy when it is not. The second is always there, because a group should not have to touch
 * the Google Cloud console to run an Apple Day.
 */

const connect = vi.fn()
const createForm = vi.fn()
let clientId = 'client-123'

vi.mock('../src/lib/mail/config', () => ({
  get GOOGLE_CLIENT_ID() {
    return clientId
  },
}))

// Reached through the shared copy button, which lives with the other small pieces.
vi.mock('../src/lib/firebase', () => ({ missingConfig: [], auth: {}, db: {} }))

vi.mock('../src/lib/googleForms', () => ({
  connect: (...a: unknown[]) => connect(...a),
  createForm: (...a: unknown[]) => createForm(...a),
  isConnected: () => false,
}))

const { SignupFormCard } = await import('../src/ui/SignupFormCard')

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
  finishedAt: null,
  schedule: {
    fri: { startMin: 17 * 60, endMin: 21 * 60 },
    sat: { startMin: 9 * 60, endMin: 15 * 60 },
  },
  shiftMode: 'shifts',
  shiftMinutes: 60,
  overlapMinutes: 0,
}

const show = (over: Partial<AppleDayEvent> = {}): void => {
  render(<SignupFormCard event={{ ...EVENT, ...over }} sections={DEFAULT_SECTIONS} />)
}

beforeEach(() => {
  clientId = 'client-123'
  connect.mockReset()
  connect.mockResolvedValue(undefined)
  createForm.mockReset()
  createForm.mockResolvedValue({
    formId: 'f1',
    responderUri: 'https://forms.example/answer',
    editUri: 'https://forms.example/edit',
  })
})

afterEach(cleanup)

describe('creating it through Google', () => {
  it('asks for permission before building anything', async () => {
    /*
      Two calls, in that order. Consent opens while somebody is looking at a button they
      pressed — asking for it in the middle of the work is where a popup blocker strands it.
    */
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Create it in Google Forms' }))

    await waitFor(() => expect(createForm).toHaveBeenCalled())
    expect(connect).toHaveBeenCalledWith('client-123')
    expect(connect.mock.invocationCallOrder[0]!).toBeLessThan(
      createForm.mock.invocationCallOrder[0]!,
    )
  })

  it('hands over both links, which are for different people', async () => {
    // One goes to families; the other is where the organizer reads the responses.
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Create it in Google Forms' }))

    await waitFor(() => expect(screen.getByRole('link', { name: /form link/ })).toBeTruthy())
    expect(screen.getByRole('link', { name: /form link/ }).getAttribute('href')).toBe(
      'https://forms.example/answer',
    )
    expect(screen.getByRole('link', { name: /open it here/ }).getAttribute('href')).toBe(
      'https://forms.example/edit',
    )
  })

  it('builds the form from this event, not a fixed list', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Create it in Google Forms' }))

    await waitFor(() => expect(createForm).toHaveBeenCalled())
    const spec = createForm.mock.calls[0]![0] as { questions: { title: string }[] }
    expect(spec.questions.map((q) => q.title)).toContain('Friday')
    expect(spec.questions.map((q) => q.title)).toContain('Saturday')
  })

  it('says what went wrong rather than looking like it worked', async () => {
    createForm.mockRejectedValue(new Error('The Google Forms API is not enabled'))
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Create it in Google Forms' }))

    await waitFor(() => expect(screen.getByText(/not enabled/)).toBeTruthy())
    expect(screen.queryByRole('link', { name: /form link/ })).toBeNull()
  })
})

describe('when Google is not set up', () => {
  beforeEach(() => {
    clientId = ''
  })

  it('does not offer a button that cannot work', () => {
    show()
    expect(screen.queryByRole('button', { name: /Create it in Google Forms/ })).toBeNull()
  })

  it('still offers the questions, and says why', () => {
    // The route that needs nothing. Naming the reason is what makes it fixable.
    show()
    expect(screen.getByRole('button', { name: 'Show me the questions' })).toBeTruthy()
    expect(screen.getByText(/needs the Google Forms API enabled/)).toBeTruthy()
  })
})

describe('the questions to build it by hand', () => {
  it('lists every question with its type and its answers', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Show me the questions' }))

    expect(screen.getByText('Youth name')).toBeTruthy()
    expect(screen.getByText('5:00 PM – 6:00 PM')).toBeTruthy()
    expect(screen.getAllByText('Checkboxes').length).toBeGreaterThan(0)
  })

  it('says the titles have to match, because that is what the import reads', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: 'Show me the questions' }))
    expect(screen.getByText(/Titles have to match exactly/)).toBeTruthy()
  })

  it('offers the shift times this event actually runs', async () => {
    show({ schedule: { fri: { startMin: 17 * 60, endMin: 19 * 60 } } })
    await userEvent.click(screen.getByRole('button', { name: 'Show me the questions' }))

    expect(screen.getByText('5:00 PM – 6:00 PM')).toBeTruthy()
    expect(screen.getByText('6:00 PM – 7:00 PM')).toBeTruthy()
    expect(screen.queryByText('7:00 PM – 8:00 PM')).toBeNull()
  })
})

describe('an event it will not build a form for', () => {
  it('refuses when no day is switched on, and says so', () => {
    // There are no hours to offer, so the form would ask nothing worth asking.
    show({ schedule: {} })
    expect(screen.getByText(/no days switched on/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Create it/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Show me the questions/ })).toBeNull()
  })
})
