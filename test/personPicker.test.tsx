// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonPicker } from '../src/ui/PersonPicker'
import type { Person, Section } from '../src/domain/types'

/**
 * The type-to-search person picker.
 *
 * It exists because a native select holding ninety names is unusable: you cannot type at
 * it, and the people who actually said they could work the hour are buried in the middle
 * of an alphabetical list. So the things worth pinning are the search, the keyboard path,
 * and that "signed up" stays visibly separate from "not signed up".
 */

const onPick = vi.fn()
const onClose = vi.fn()

const person = (first: string, last: string, section: Section): Person => ({
  id: `p-${first}-${last}`.toLowerCase(),
  firstName: first,
  lastName: last,
  section,
  parentName: '',
  parentEmail: '',
  parentPhone: '',
  pairWithPersonId: null,
})

const AVAILABLE = [
  person('Niklaus', 'Wirth', 'cubs'),
  person('Frances', 'Allen', 'scouts'),
  person('Tony', 'Hoare', 'beavers'),
]
const OTHERS = [person('Alan', 'Turing', 'scouts'), person('Niklaus', 'Lamport', 'cubs')]

const anchor = { top: 100, bottom: 120, left: 40, height: 20 } as DOMRect

function open(): void {
  render(
    <PersonPicker
      anchor={anchor}
      title="Sobeys · Friday 5:00 PM – 6:00 PM"
      groups={[
        { label: 'Signed up for this hour', people: AVAILABLE },
        { label: 'Not signed up for this hour', people: OTHERS, hint: 'not available' },
      ]}
      onPick={onPick}
      onClose={onClose}
    />,
  )
}

const options = (): string[] =>
  screen.getAllByRole('option').map((o) => o.textContent ?? '')

beforeEach(() => {
  onPick.mockReset()
  onClose.mockReset()
})

describe('what it shows', () => {
  it('lists everyone, signed up first', () => {
    open()
    const shown = options()
    expect(shown).toHaveLength(5)
    expect(shown[0]).toContain('Niklaus Wirth')
    // The people who offered the hour come before the ones who did not.
    expect(shown.findIndex((o) => o.includes('Alan'))).toBeGreaterThan(2)
  })

  it('separates the two groups and says which is which', () => {
    open()
    expect(screen.getByText('Signed up for this hour')).toBeDefined()
    expect(screen.getByText('Not signed up for this hour')).toBeDefined()
  })

  it('marks the ones who did not offer the hour', () => {
    open()
    const alan = screen.getAllByRole('option').find((o) => o.textContent?.includes('Alan'))!
    expect(alan.textContent).toContain('not available')
  })

  it('names the cell being filled, so the panel is not context-free', () => {
    open()
    expect(screen.getByText(/Sobeys · Friday 5:00 PM/)).toBeDefined()
  })

  it('counts what is on offer', () => {
    open()
    expect(screen.getByText(/5 matches/)).toBeDefined()
  })
})

describe('searching', () => {
  it('filters as you type', async () => {
    open()
    await userEvent.type(screen.getByRole('combobox'), 'niklaus')

    const shown = options()
    expect(shown).toHaveLength(2)
    expect(shown.every((o) => o.includes('Niklaus'))).toBe(true)
  })

  it('matches a surname', async () => {
    open()
    await userEvent.type(screen.getByRole('combobox'), 'allen')
    expect(options()).toHaveLength(1)
  })

  it('matches on section, so a whole group can be narrowed', async () => {
    open()
    await userEvent.type(screen.getByRole('combobox'), 'beavers')
    expect(options()[0]).toContain('Tony Hoare')
  })

  it('treats several words as all having to match', async () => {
    // "niklaus cubs" should not also match Frances just because she is a scout.
    open()
    await userEvent.type(screen.getByRole('combobox'), 'niklaus cubs')
    expect(options()).toHaveLength(2)

    await userEvent.clear(screen.getByRole('combobox'))
    await userEvent.type(screen.getByRole('combobox'), 'lamport cubs')
    expect(options()).toHaveLength(1)
    expect(options()[0]).toContain('Niklaus Lamport')
  })

  it('is case insensitive', async () => {
    open()
    await userEvent.type(screen.getByRole('combobox'), 'Tony')
    expect(options()).toHaveLength(1)
  })

  it('says so when nothing matches, quoting what was typed', async () => {
    open()
    await userEvent.type(screen.getByRole('combobox'), 'zzz')
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByText(/Nobody matches/)).toBeDefined()
    expect(screen.getByText(/zzz/)).toBeDefined()
  })
})

describe('the keyboard path', () => {
  it('picks the first match on enter', async () => {
    open()
    await userEvent.type(screen.getByRole('combobox'), 'tony{Enter}')
    expect(onPick).toHaveBeenCalledWith('p-tony-hoare')
  })

  it('moves the highlight with the arrows', async () => {
    open()
    const input = screen.getByRole('combobox')
    await userEvent.type(input, '{ArrowDown}{ArrowDown}{Enter}')
    // Third in the list.
    expect(onPick).toHaveBeenCalledWith('p-tony-hoare')
  })

  it('does not run off either end', async () => {
    open()
    const input = screen.getByRole('combobox')
    await userEvent.type(input, '{ArrowUp}{ArrowUp}{Enter}')
    expect(onPick).toHaveBeenCalledWith('p-niklaus-wirth')

    onPick.mockReset()
    await userEvent.type(input, '{ArrowDown>10/}{Enter}')
    expect(onPick).toHaveBeenCalledWith('p-niklaus-lamport')
  })

  it('resets the highlight when the search changes', async () => {
    // Otherwise a stale highlight picks somebody the organizer never looked at.
    open()
    const input = screen.getByRole('combobox')
    await userEvent.type(input, '{ArrowDown}{ArrowDown}')
    await userEvent.type(input, 'niklaus')
    await userEvent.type(input, '{Enter}')
    expect(onPick).toHaveBeenCalledWith('p-niklaus-wirth')
  })

  it('closes on escape without picking', async () => {
    open()
    await userEvent.type(screen.getByRole('combobox'), '{Escape}')
    expect(onClose).toHaveBeenCalled()
    expect(onPick).not.toHaveBeenCalled()
  })

  it('does nothing on enter when nothing matches', async () => {
    open()
    await userEvent.type(screen.getByRole('combobox'), 'zzz{Enter}')
    expect(onPick).not.toHaveBeenCalled()
  })

  it('focuses the search box on open, so you can just type', () => {
    open()
    expect(document.activeElement).toBe(screen.getByRole('combobox'))
  })
})

describe('dismissing', () => {
  it('closes when the page behind it scrolls, rather than drifting from its cell', () => {
    open()
    window.dispatchEvent(new Event('scroll'))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes when the board scrolls', () => {
    // The board is a nested scroll container; scroll events from it do not bubble, which
    // is why the listener is in the capture phase.
    const board = document.createElement('div')
    document.body.appendChild(board)
    open()
    board.dispatchEvent(new Event('scroll', { bubbles: false }))
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open while its own list is scrolled', () => {
    // A capture-phase listener also sees the panel's own scrolling. Closing on that made
    // the list impossible to scroll at all.
    open()
    const list = screen.getByRole('listbox')
    list.dispatchEvent(new Event('scroll', { bubbles: false }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open when an option inside it scrolls into view', () => {
    open()
    const option = screen.getAllByRole('option')[0]!
    option.dispatchEvent(new Event('scroll', { bubbles: false }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('stays open while the search box is used', () => {
    open()
    screen.getByRole('combobox').dispatchEvent(new Event('scroll', { bubbles: false }))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes on a resize', () => {
    open()
    window.dispatchEvent(new Event('resize'))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('arrow keys with a list longer than the panel', () => {
  const MANY = Array.from({ length: 40 }, (_, i) =>
    person(`Youth${String(i).padStart(2, '0')}`, 'Test', 'cubs'),
  )

  const openMany = (): void => {
    render(
      <PersonPicker
        anchor={anchor}
        title="Sobeys · Friday"
        groups={[{ label: 'Signed up for this hour', people: MANY }]}
        onPick={onPick}
        onClose={onClose}
      />,
    )
  }

  it('moves through a long list without closing', async () => {
    openMany()
    const input = screen.getByRole('combobox')
    // Far enough down that the highlight has to be scrolled into view repeatedly.
    await userEvent.type(input, '{ArrowDown>25/}')

    expect(onClose).not.toHaveBeenCalled()
    await userEvent.type(input, '{Enter}')
    expect(onPick).toHaveBeenCalledWith('p-youth25-test')
  })

  it('keeps the whole list reachable by keyboard', async () => {
    openMany()
    const input = screen.getByRole('combobox')
    await userEvent.type(input, '{ArrowDown>100/}{Enter}')

    // Clamped at the last entry rather than running off the end.
    expect(onPick).toHaveBeenCalledWith('p-youth39-test')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('clicking', () => {
  it('picks the person clicked', async () => {
    open()
    await userEvent.click(screen.getByRole('option', { name: /Frances Allen/ }))
    expect(onPick).toHaveBeenCalledWith('p-frances-allen')
  })
})
