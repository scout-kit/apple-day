// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Location } from '../src/domain/types'

/**
 * The day switches in the location editor.
 *
 * Rendered rather than reasoned about, because the bug this covers was a comparison in
 * JSX — `range !== null`, which is true for a day that is simply absent — so every
 * unrecorded day showed an "open" switch directly above the word "Closed". A domain test
 * alone would not have caught it.
 *
 * The editor is rendered on its own. It used to be reached by pressing Edit in the library
 * list, which is gone — a location is edited on its own page now, so that route said more
 * about the library than about the thing under test.
 */

const saveLocation = vi.fn()
vi.mock('../src/lib/repo', () => ({
  saveLocation: (...args: unknown[]) => saveLocation(...args),
}))

const { LocationEditor } = await import('../src/ui/LocationEditor')

/** As the workbook extract leaves them: Friday and Saturday only. */
const partiallyRecorded: Location = {
  id: 'sobeys-640',
  name: 'Sobeys — 640 Parkside Drive',
  address: '640 Parkside Dr',
  mapsUrl: '',
  lat: null,
  lng: null,
  groupCode: '640',
  siteContact: null,
  insurance: '',
  comments: '',
  openHours: {
    fri: { openMin: 17 * 60, closeMin: 21 * 60 },
    sat: { openMin: 8 * 60, closeMin: 15 * 60 },
  },
  aliases: [],
}

const switchFor = (day: string): HTMLInputElement =>
  screen.getByRole('checkbox', { name: `Open on ${day}` }) as HTMLInputElement

/** The location the editor opens on, reassigned per test. */
let editing: Location = partiallyRecorded

beforeEach(() => {
  saveLocation.mockReset()
  editing = partiallyRecorded
})

async function openEditor(): Promise<void> {
  render(<LocationEditor location={editing} onClose={() => {}} />)
  await Promise.resolve()
}

describe('day switches reflect what is actually recorded', () => {
  it('is on only for the days with hours', async () => {
    await openEditor()

    expect(switchFor('Friday').checked).toBe(true)
    expect(switchFor('Saturday').checked).toBe(true)

    // The five the workbook never recorded. These were all showing as checked.
    for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday']) {
      expect(switchFor(day).checked).toBe(false)
    }
  })

  it('never shows an on switch beside the word closed', async () => {
    await openEditor()

    for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday']) {
      const row = switchFor(day).closest('.row')!
      expect(switchFor(day).checked).toBe(false)
      expect(row.textContent).toContain('closed')
    }
  })

  it('shows every switch off for a location with no hours at all', async () => {
    editing = { ...partiallyRecorded, openHours: {} }
    await openEditor()

    for (const day of ['Sunday', 'Monday', 'Friday', 'Saturday']) {
      expect(switchFor(day).checked).toBe(false)
    }
  })

  it('treats an explicit null the same as absent', async () => {
    editing = { ...partiallyRecorded, openHours: { fri: null, sat: null } }
    await openEditor()

    expect(switchFor('Friday').checked).toBe(false)
    expect(switchFor('Saturday').checked).toBe(false)
  })

  it('treats a backwards range as closed rather than open', async () => {
    editing = {
      ...partiallyRecorded,
        openHours: { fri: { openMin: 21 * 60, closeMin: 17 * 60 } },
      }
    await openEditor()

    expect(switchFor('Friday').checked).toBe(false)
  })
})

describe('turning a day on and off', () => {
  it('reveals the time dropdowns when switched on', async () => {
    await openEditor()

    const sunday = switchFor('Sunday')
    const row = sunday.closest('.row')!
    expect(row.querySelectorAll('select')).toHaveLength(0)

    await userEvent.click(sunday)
    expect(switchFor('Sunday').checked).toBe(true)
    // An open and a close time.
    expect(switchFor('Sunday').closest('.row')!.querySelectorAll('select')).toHaveLength(2)
  })

  it('records an explicit closure when switched off', async () => {
    await openEditor()

    await userEvent.click(switchFor('Friday'))
    expect(switchFor('Friday').checked).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(saveLocation).toHaveBeenCalledTimes(1)

    const saved = saveLocation.mock.calls[0]![0] as Location
    // Null, not absent. An earlier version deleted the key, which made "closed all day"
    // indistinguishable from "nobody recorded it" — and the schedule board only withholds
    // a picker for the former, so a deliberate closure was silently schedulable.
    expect('fri' in saved.openHours).toBe(true)
    expect(saved.openHours.fri).toBeNull()
    expect(saved.openHours.sat).toEqual({ openMin: 8 * 60, closeMin: 15 * 60 })
  })

  it('leaves a day nobody has touched out of the editor state', async () => {
    await openEditor()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saved = saveLocation.mock.calls[0]![0] as Location
    // The editor only knows about what it was given; `saveLocation` is what expands the
    // week to seven explicit keys on the way to Firestore.
    expect('sun' in saved.openHours).toBe(false)
  })

  it('keeps the switch on after picking hours for a new day', async () => {
    await openEditor()

    await userEvent.click(switchFor('Sunday'))
    const [openSelect] = Array.from(
      switchFor('Sunday').closest('.row')!.querySelectorAll('select'),
    )
    await userEvent.selectOptions(openSelect!, String(10 * 60))

    expect(switchFor('Sunday').checked).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    const saved = saveLocation.mock.calls[0]![0] as Location
    expect(saved.openHours.sun).toEqual({ openMin: 10 * 60, closeMin: 21 * 60 })
  })
})
describe('the map link comes from the address', () => {
  const linkButton = (): HTMLElement =>
    screen.getByRole('button', { name: /Use a different link|Use the address/ })

  it('offers a checkable link built from the address, with no field to fill in', async () => {
    await openEditor()

    expect(screen.queryByLabelText('Map link')).toBeNull()
    const link = screen.getByRole('link', { name: 'Check it' }) as HTMLAnchorElement
    expect(link.href).toBe(
      'https://www.google.com/maps/search/?api=1&query=640%20Parkside%20Dr',
    )
  })

  it('asks for an address first when there is none', async () => {
    editing = { ...partiallyRecorded, address: '' }
    await openEditor()

    expect(screen.queryByRole('link', { name: 'Check it' })).toBeNull()
    expect(
      screen.getByText('Add an address and the map link is made from it.'),
    ).toBeTruthy()
  })

  it('keeps a stored link editable — the workbook ones point at specific entrances', async () => {
    editing = { ...partiallyRecorded, mapsUrl: 'https://maps.app.goo.gl/loadingDock' }
    await openEditor()

    const field = screen.getByLabelText('Map link') as HTMLInputElement
    expect(field.value).toBe('https://maps.app.goo.gl/loadingDock')
  })

  it('drops a stored link back to the address on request, and saves it empty', async () => {
    editing = { ...partiallyRecorded, mapsUrl: 'https://maps.app.goo.gl/loadingDock' }
    await openEditor()

    await userEvent.click(linkButton())
    expect(screen.queryByLabelText('Map link')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((saveLocation.mock.calls[0]![0] as Location).mapsUrl).toBe('')
  })

  it('reveals the field when a different link is wanted', async () => {
    await openEditor()

    await userEvent.click(linkButton())
    const field = screen.getByLabelText('Map link') as HTMLInputElement
    await userEvent.type(field, 'https://maps.app.goo.gl/sideEntrance')

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((saveLocation.mock.calls[0]![0] as Location).mapsUrl).toBe(
      'https://maps.app.goo.gl/sideEntrance',
    )
  })
})
