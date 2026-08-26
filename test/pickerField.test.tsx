// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LocationField, PersonField } from '../src/ui/PickerField'
import type { Location, Person } from '../src/domain/types'

/**
 * Choosing a youth or a location, wherever it happens.
 *
 * Both used to be a native `<select>` on some screens and a type-to-search panel on others —
 * the same decision made two different ways, one of them a scroll through a hundred names.
 */

const person = (id: string, first: string, last: string, section = 'cubs'): Person => ({
  id, firstName: first, lastName: last, section,
  parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
})

const location = (id: string, name: string, address = '', groupCode = ''): Location => ({
  id, name, address, groupCode, mapsUrl: '', lat: null, lng: null, siteContact: null,
  insurance: '', comments: '', openHours: {}, aliases: [],
})

const PEOPLE = [
  person('p-1', 'Niklaus', 'Dijkstra'),
  person('p-2', 'Alan', 'Turing', 'scouts'),
  person('p-3', 'Edsger', 'Dijkstra', 'beavers'),
]

const LOCATIONS = [
  location('sobeys-640', 'Sobeys', '640 Parkside Dr', '640'),
  location('sobeys-north', 'Sobeys Northfield', '450 Northfield Dr'),
  location('walmart', 'Walmart', '335 Farmers Market Rd'),
]

describe('choosing a youth', () => {
  it('shows who is chosen, not an id', () => {
    render(<PersonField label="Youth" people={PEOPLE} value="p-2" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Youth' }).textContent).toContain('Alan Turing')
  })

  it('says what it wants when nothing is chosen', () => {
    render(
      <PersonField label="Youth" empty="Not recorded" people={PEOPLE} value="" onChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Youth' }).textContent).toContain('Not recorded')
  })

  it('finds somebody by typing, rather than scrolling a hundred names', async () => {
    const onChange = vi.fn()
    render(<PersonField label="Youth" people={PEOPLE} value="" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Youth' }))
    await userEvent.type(screen.getByRole('combobox'), 'alan')
    await userEvent.click(screen.getByRole('option', { name: /Alan/ }))

    expect(onChange).toHaveBeenCalledWith('p-2')
  })

  it('searches the section too, so "el bea" finds Edsger in Beavers', async () => {
    render(<PersonField label="Youth" people={PEOPLE} value="" onChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Youth' }))
    await userEvent.type(screen.getByRole('combobox'), 'eds bea')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]!.textContent).toContain('Edsger')
  })

  it('says so when nobody matches, quoting what was typed', async () => {
    render(<PersonField label="Youth" people={PEOPLE} value="" onChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Youth' }))
    await userEvent.type(screen.getByRole('combobox'), 'zzz')
    expect(screen.getByText(/Nobody matches “zzz”/)).toBeTruthy()
  })

  it('can be cleared when the field is optional', async () => {
    const onChange = vi.fn()
    render(
      <PersonField label="Youth" allowNone people={PEOPLE} value="p-1" onChange={onChange} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear Youth' }))
    expect(onChange).toHaveBeenCalledWith('')
  })

  it('offers no way to clear a field that must have an answer', () => {
    render(<PersonField label="Youth" people={PEOPLE} value="p-1" onChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Clear Youth' })).toBeNull()
  })
})

describe('choosing a location', () => {
  it('shows the chosen one by name', () => {
    render(
      <LocationField label="Location" locations={LOCATIONS} value="walmart" onChange={vi.fn()} />,
    )
    expect(screen.getByRole('button', { name: 'Location' }).textContent).toContain('Walmart')
  })

  it('searches the address, which is what tells two Sobeys apart', async () => {
    /*
      An `<option>` has nowhere to put an address, so a dropdown of twenty shops showed two
      entries called Sobeys and no way to tell which was which.
    */
    const onChange = vi.fn()
    render(<LocationField label="Location" locations={LOCATIONS} value="" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Location' }))
    await userEvent.type(screen.getByRole('combobox'), '640')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    await userEvent.click(options[0]!)
    expect(onChange).toHaveBeenCalledWith('sobeys-640')
  })

  it('shows the name and its group code, and not the address', async () => {
    /*
      The address is searched but not printed. A shop's name usually carries its own street
      — "Sobeys - 640 Parkside Drive" — so a line of address underneath repeats it and
      pushes the name out of the panel.
    */
    render(<LocationField label="Location" locations={LOCATIONS} value="" onChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Location' }))

    expect(screen.getByText('Sobeys')).toBeTruthy()
    expect(screen.getByText('640'), 'the group code stays').toBeTruthy()
    expect(screen.queryByText('640 Parkside Dr')).toBeNull()
  })

  it('puts the best match first, not whichever came first in the list', async () => {
    /*
      Reported against the real library: searching found the shop whose *address* mentioned
      the words above the two actually named that, because matches came back in list order.
    */
    render(<LocationField label="Location" locations={LOCATIONS} value="" onChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Location' }))
    await userEvent.type(screen.getByRole('combobox'), 'sobeys')

    const names = screen.getAllByRole('option').map((o) => o.textContent ?? '')
    expect(names[0]).toContain('Sobeys')
    expect(names.some((n) => n.includes('Walmart'))).toBe(false)
  })

  it('closes without choosing anything on escape', async () => {
    const onChange = vi.fn()
    render(<LocationField label="Location" locations={LOCATIONS} value="" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Location' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('can be worked with the keyboard alone', async () => {
    const onChange = vi.fn()
    render(<LocationField label="Location" locations={LOCATIONS} value="" onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Location' }))
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('sobeys-north')
  })
})
