// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventNote, Jar } from '../src/domain/types'

/**
 * Notes on the totals screen.
 *
 * Everything else here is the jars added up, and there is nothing to type in — money that
 * never went through one is recorded as a jar without a number, so it arrives with its day
 * and its location like everything else.
 *
 * What is left to write down is the things a figure cannot say. One record each rather than
 * one box holding all of them: a single box collects a year of unsigned, undated text that
 * nobody edits for fear of losing the rest of it, and the things worth writing here arrive
 * one at a time, from different people, over two days.
 */

const saveEventNote = vi.fn()
const deleteEventNote = vi.fn()
const downloadFile = vi.fn()

let notes: EventNote[] = []
let jars: Jar[] = []

vi.mock('../src/lib/repo', () => ({
  useJars: () => ({ data: jars, loading: false, error: null }),
  useEventNotes: () => ({ data: notes, loading: false, error: null }),
  saveEventNote: (...a: unknown[]) => saveEventNote(...a),
  deleteEventNote: (...a: unknown[]) => deleteEventNote(...a),
}))

vi.mock('../src/lib/csv', () => ({
  toCsv: (rows: unknown[]) => JSON.stringify(rows),
  downloadFile: (...a: unknown[]) => downloadFile(...a),
}))

vi.mock('../src/lib/eventContext', () => ({
  useEvent: () => ({ event: { id: '2026', name: 'Apple Day 2026' } }),
}))

let role = 'admin'

vi.mock('../src/lib/session', () => ({
  useSession: () => ({ user: { uid: 'u1', email: 'devin@example.org' }, role }),
  runsTheEvent: (r: string) => r === 'admin' || r === 'organizer',
  canSeeTheEvent: (r: string) => r === 'admin' || r === 'organizer' || r === 'viewer',
}))

vi.mock('../src/lib/sections', () => ({
  useSections: () => ({ sections: [], lookup: (id: string) => ({ id, name: id }) }),
}))

const { ReconcileScreen } = await import('../src/ui/ReconcileScreen')

const note = (over: Partial<EventNote> = {}): EventNote => ({
  id: 'n1', text: 'Found jar 14 behind the till.', at: Date.UTC(2026, 9, 3, 18, 0),
  by: 'devin@example.org', ...over,
})

const notesCard = (): HTMLElement =>
  screen.getByRole('heading', { name: 'Notes' }).closest('.card') as HTMLElement

beforeEach(() => {
  saveEventNote.mockReset()
  saveEventNote.mockResolvedValue(undefined)
  deleteEventNote.mockReset()
  deleteEventNote.mockResolvedValue(undefined)
  downloadFile.mockReset()
  notes = []
  jars = []
  role = 'admin'
})

afterEach(cleanup)

describe('what is no longer asked for', () => {
  it('does not ask for bushel sales', () => {
    /*
      It is money, and it belongs with the money — as a jar without a number, recorded on the
      Jars screen with the day and the location it came from. Typed in here it is a lump sum
      with neither, which is what the old workbook's second set of totals was.
    */
    render(<ReconcileScreen />)
    expect(screen.queryByText(/[Bb]ushel/)).toBeNull()
  })

  it('does not ask what reached the bank', () => {
    // Nothing here is assembled by hand, so there is no second figure to disagree with.
    render(<ReconcileScreen />)
    expect(screen.queryByText(/[Dd]eposit/)).toBeNull()
  })

  it('shows one total, because every penny of it came out of a jar', () => {
    render(<ReconcileScreen />)
    expect(screen.getByText('raised in total')).toBeTruthy()
    expect(screen.queryByText('from jars')).toBeNull()
  })
})

describe('writing one down', () => {
  it('adds it, with who wrote it', async () => {
    render(<ReconcileScreen />)

    await userEvent.type(screen.getByLabelText('Write a note'), 'Float of $50 went out.')
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => expect(saveEventNote).toHaveBeenCalled())
    const [eventId, written, by] = saveEventNote.mock.calls[0]! as [
      string,
      { id: string; text: string },
      string,
    ]
    expect(eventId).toBe('2026')
    expect(written.text).toBe('Float of $50 went out.')
    expect(written.id).toBe('')
    expect(by).toBe('devin@example.org')
  })

  it('will not add an empty one', async () => {
    render(<ReconcileScreen />)
    expect(
      (screen.getByRole('button', { name: 'Add note' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('clears the box afterwards, ready for the next one', async () => {
    render(<ReconcileScreen />)
    const box = screen.getByLabelText('Write a note') as HTMLTextAreaElement

    await userEvent.type(box, 'Float of $50 went out.')
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }))

    await waitFor(() => expect(box.value).toBe(''))
  })
})

describe('the list of them', () => {
  it('says when each was written and by whom', () => {
    notes = [note()]
    render(<ReconcileScreen />)

    expect(within(notesCard()).getByText(/Found jar 14/)).toBeTruthy()
    expect(within(notesCard()).getByText(/devin@example\.org/)).toBeTruthy()
  })

  it('puts the newest first, which is what somebody came to read', () => {
    notes = [
      note({ id: 'old', text: 'Earlier', at: Date.UTC(2026, 9, 2) }),
      note({ id: 'new', text: 'Later', at: Date.UTC(2026, 9, 4) }),
    ]
    render(<ReconcileScreen />)

    const shown = within(notesCard())
      .getAllByRole('listitem')
      .map((li) => li.textContent ?? '')
    expect(shown[0]).toContain('Later')
  })

  it('says so plainly when there are none', () => {
    render(<ReconcileScreen />)
    expect(screen.getByText(/Nothing written down yet/)).toBeTruthy()
  })

  it('edits one in place, keeping its id', async () => {
    // Changed rather than added, which is the difference between a record and a pile.
    notes = [note()]
    render(<ReconcileScreen />)

    await userEvent.click(within(notesCard()).getByRole('button', { name: 'Edit' }))
    const box = screen.getByLabelText('Change this note') as HTMLTextAreaElement
    expect(box.value).toBe('Found jar 14 behind the till.')

    await userEvent.clear(box)
    await userEvent.type(box, 'Found jar 14 — counted it in on the Monday.')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveEventNote).toHaveBeenCalled())
    const [, written] = saveEventNote.mock.calls[0]! as [string, { id: string; text: string }]
    expect(written.id).toBe('n1')
    expect(written.text).toMatch(/Monday/)
  })

  it('lets an edit be abandoned', async () => {
    notes = [note()]
    render(<ReconcileScreen />)

    await userEvent.click(within(notesCard()).getByRole('button', { name: 'Edit' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByLabelText('Write a note')).toBeTruthy()
    expect(saveEventNote).not.toHaveBeenCalled()
  })

  it('deletes one on its own, not the lot', async () => {
    notes = [note({ id: 'a', text: 'First' }), note({ id: 'b', text: 'Second' })]
    render(<ReconcileScreen />)

    const second = within(notesCard())
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes('Second'))!
    await userEvent.click(within(second).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleteEventNote).toHaveBeenCalled())
    expect((deleteEventNote.mock.calls[0]![1] as EventNote).id).toBe('b')
  })
})

describe('taking them away with you', () => {
  it('exports them, with when and who', async () => {
    notes = [note()]
    render(<ReconcileScreen />)

    await userEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    expect(downloadFile).toHaveBeenCalled()
    const [filename, body] = downloadFile.mock.calls[0]! as [string, string]
    expect(filename).toMatch(/notes.*\.csv$/)
    expect(body).toContain('Found jar 14')
    expect(body).toContain('devin@example.org')
    expect(body).toContain('When')
  })

  it('offers nothing to export when there is nothing', () => {
    render(<ReconcileScreen />)
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull()
  })
})

describe('what a read-only account is offered here', () => {
  beforeEach(() => {
    role = 'viewer'
    notes = [note()]
  })

  it('shows the figures and the notes', () => {
    render(<ReconcileScreen />)
    expect(screen.getByText('raised in total')).toBeTruthy()
    expect(within(notesCard()).getByText(/Found jar 14/)).toBeTruthy()
  })

  it('offers no way to write one', () => {
    render(<ReconcileScreen />)
    expect(screen.queryByLabelText('Write a note')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull()
  })

  it('offers no way to change or remove one', () => {
    render(<ReconcileScreen />)
    expect(within(notesCard()).queryByRole('button', { name: 'Edit' })).toBeNull()
    expect(within(notesCard()).queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('still lets them export', () => {
    // Reading includes taking a copy away, which is most of why the tier exists.
    render(<ReconcileScreen />)
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy()
  })
})
