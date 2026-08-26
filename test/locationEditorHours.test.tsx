// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Location } from '../src/domain/types'

/**
 * The day switches in the location editor.
 *
 * Rendered rather than reasoned about, because the failure lives in JSX: `range !== null` is
 * true for a day that is simply absent, which shows an "open" switch directly above the word
 * "Closed". A domain test alone cannot catch that.
 *
 * The editor is rendered on its own rather than reached through the library list, which would
 * say more about the library than about the thing under test.
 */

const saveLocation = vi.fn()
/** What the library already holds, so a new name can be checked against it. */
let library: Location[] = []

vi.mock('../src/lib/repo', () => ({
  saveLocation: (...args: unknown[]) => saveLocation(...args),
  useLocations: () => ({ data: library, loading: false, error: null }),
}))

const { LocationEditor } = await import('../src/ui/LocationEditor')

/** As the workbook extract leaves them: Friday and Saturday only. */
const partiallyRecorded: Location = {
  id: 'braemar-640',
  name: 'Braemar — 640 Linden Drive',
  address: '640 Linden Dr',
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
  library = [partiallyRecorded]
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
describe('switching a day on copies the nearest one already open', () => {
  /*
    The pain this removes: a shop with the same hours all week is seven switches and fourteen
    dropdowns to say one sentence. Copying makes it seven switches.

    Read off the rendered dropdowns rather than the saved record, because what matters is that
    somebody sees the hours arrive filled in — a value that only appears after Save is not the
    thing that saves anybody time.
  */
  const rangeOf = (day: string): [string, string] => {
    const [open, close] = Array.from(
      switchFor(day).closest('.row')!.querySelectorAll('select'),
    )
    return [(open as HTMLSelectElement).value, (close as HTMLSelectElement).value]
  }

  it('copies the day above', async () => {
    editing = { ...partiallyRecorded, openHours: { sun: { openMin: 7 * 60, closeMin: 23 * 60 } } }
    await openEditor()

    await userEvent.click(switchFor('Monday'))
    expect(rangeOf('Monday')).toEqual([String(7 * 60), String(23 * 60)])
  })

  it('reaches past a day that is shut', async () => {
    // Sunday 7am–11pm, Monday closed, Tuesday still wants Sunday's hours.
    editing = {
      ...partiallyRecorded,
      openHours: { sun: { openMin: 7 * 60, closeMin: 23 * 60 }, mon: null },
    }
    await openEditor()

    await userEvent.click(switchFor('Tuesday'))
    expect(rangeOf('Tuesday')).toEqual([String(7 * 60), String(23 * 60)])
  })

  it('carries a change forward from where it was made', async () => {
    editing = {
      ...partiallyRecorded,
      openHours: {
        sun: { openMin: 7 * 60, closeMin: 23 * 60 },
        wed: { openMin: 9 * 60, closeMin: 17 * 60 },
      },
    }
    await openEditor()

    await userEvent.click(switchFor('Thursday'))
    expect(rangeOf('Thursday')).toEqual([String(9 * 60), String(17 * 60)])
  })

  it('leaves the day it copied from alone', async () => {
    // Two days that agree, not one day shown twice.
    editing = { ...partiallyRecorded, openHours: { sun: { openMin: 7 * 60, closeMin: 23 * 60 } } }
    await openEditor()

    await userEvent.click(switchFor('Monday'))
    const [, mondayClose] = Array.from(
      switchFor('Monday').closest('.row')!.querySelectorAll('select'),
    )
    await userEvent.selectOptions(mondayClose!, String(17 * 60))

    expect(rangeOf('Sunday')).toEqual([String(7 * 60), String(23 * 60)])
  })

  it('still offers a plain long day when nothing is recorded at all', async () => {
    editing = { ...partiallyRecorded, openHours: {} }
    await openEditor()

    await userEvent.click(switchFor('Sunday'))
    expect(rangeOf('Sunday')).toEqual([String(8 * 60), String(21 * 60)])
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
      'https://www.google.com/maps/search/?api=1&query=640%20Linden%20Dr',
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

describe('adding one whose name is already taken', () => {
  /*
    Ids come from the name, so saving a second "Braemar — 640 Linden Drive" would merge onto
    the first: its address, its opening hours and the past names holding four years of
    takings on one row, replaced by whatever was just typed.

    Two branches of the same chain are a real thing, and they have to be told apart on a
    board anyway — so the answer is a different name, not a second identical one.
  */
  const addNamed = async (name: string): Promise<void> => {
    editing = { ...partiallyRecorded, id: '', name: '', openHours: {} }
    await openEditor()
    await userEvent.type(screen.getByLabelText('Name'), name)
  }

  const saveButton = (): HTMLButtonElement =>
    screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

  it('says which one it would write over', async () => {
    await addNamed(partiallyRecorded.name)
    expect(screen.getByText(/already a location called/)).toBeTruthy()
    expect(screen.getByText(partiallyRecorded.name)).toBeTruthy()
  })

  it('will not save over it', async () => {
    await addNamed(partiallyRecorded.name)
    expect(saveButton().disabled).toBe(true)
  })

  it('lets a name that tells them apart through', async () => {
    await addNamed('Braemar — Aldergrove')
    expect(screen.queryByText(/already a location called/)).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })

  it('catches a name that only differs by punctuation, because the id would not', async () => {
    // The id is a slug, so "Braemar - 640 Linden Drive" lands on the same document.
    await addNamed(partiallyRecorded.name.replace('—', '-'))
    expect(screen.getByText(/already a location called/)).toBeTruthy()
  })

  it('says nothing when editing the location that has that name', async () => {
    // It is not a clash with itself: editing keeps the id it already has.
    await openEditor()
    expect(screen.queryByText(/already a location called/)).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })
})
