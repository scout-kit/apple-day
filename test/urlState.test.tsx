// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useUrlState } from '../src/lib/urlState'

/**
 * View state that survives leaving the page.
 *
 * The report: check somebody in on the Saturday table, open their page, press Back — and
 * you are on Friday with the filters cleared, four button presses from where you were.
 */

function Probe({ name = 'day', fallback = '' }: { name?: string; fallback?: string }) {
  const [value, set] = useUrlState(name, fallback)
  return (
    <>
      <span data-testid="value">{value || '(none)'}</span>
      <button onClick={() => set('sat')}>Saturday</button>
      <button onClick={() => set(fallback)}>Reset</button>
    </>
  )
}

const url = (): string => window.location.search

beforeEach(() => {
  window.history.replaceState(null, '', '/e/2026/day-of')
})

describe('keeping the view in the address bar', () => {
  it('starts from whatever the address bar says', () => {
    window.history.replaceState(null, '', '/e/2026/day-of?day=sat')
    render(<Probe />)
    expect(screen.getByTestId('value').textContent).toBe('sat')
  })

  it('starts from the fallback when it says nothing', () => {
    render(<Probe fallback="fri" />)
    expect(screen.getByTestId('value').textContent).toBe('fri')
  })

  it('writes a change into the address bar', async () => {
    render(<Probe />)
    await userEvent.click(screen.getByRole('button', { name: 'Saturday' }))

    expect(screen.getByTestId('value').textContent).toBe('sat')
    expect(url()).toContain('day=sat')
  })

  it('does not stack a history entry per button press', async () => {
    /*
      Pressing a day button is a change of view, not a place to press Back through. Twenty
      filter changes must not become twenty entries between you and the page you came from.
    */
    render(<Probe />)
    const before = window.history.length
    await userEvent.click(screen.getByRole('button', { name: 'Saturday' }))
    expect(window.history.length).toBe(before)
  })

  it('drops the parameter when the value is back to the default', async () => {
    // An empty parameter is noise, and it makes two identical views look different.
    window.history.replaceState(null, '', '/e/2026/day-of?day=sat')
    render(<Probe fallback="fri" />)

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(url()).not.toContain('day=')
  })

  it('follows the address bar back when history moves', () => {
    // What Back actually does: the URL changes underneath, and the screen has to notice.
    window.history.replaceState(null, '', '/e/2026/day-of?day=sat')
    render(<Probe />)
    expect(screen.getByTestId('value').textContent).toBe('sat')

    act(() => {
      window.history.replaceState(null, '', '/e/2026/day-of?day=fri')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(screen.getByTestId('value').textContent).toBe('fri')
  })

  it('leaves other parameters alone', async () => {
    // Several filters share one address bar.
    window.history.replaceState(null, '', '/e/2026/day-of?find=braemar')
    render(<Probe />)

    await userEvent.click(screen.getByRole('button', { name: 'Saturday' }))
    expect(url()).toContain('find=braemar')
    expect(url()).toContain('day=sat')
  })
})
