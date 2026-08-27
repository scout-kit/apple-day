// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useOnline } from '../src/lib/connection'

/**
 * Saying when the board has stopped being live.
 *
 * Base ops is a table in a shop doorway and the signal there is whatever it is. Offline
 * persistence means the app keeps working — a check-in taken with no bars is held and sent
 * when there is one — but an organizer looking at the screen had no way to tell a live board
 * from one that stopped updating twenty minutes ago, which is the difference between
 * trusting it and not.
 */

function Probe(): React.ReactElement {
  return <span data-testid="state">{useOnline() ? 'online' : 'offline'}</span>
}

const state = (): string => screen.getByTestId('state').textContent ?? ''

/** What the browser says, which is the only thing there is to go on. */
const setOnline = (value: boolean): void => {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true })
}

beforeEach(() => {
  setOnline(true)
})

afterEach(cleanup)

describe('what it reports', () => {
  it('says online when there is a connection', () => {
    render(<Probe />)
    expect(state()).toBe('online')
  })

  it('notices the connection going', () => {
    render(<Probe />)
    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(state()).toBe('offline')
  })

  it('notices it coming back', () => {
    render(<Probe />)
    act(() => {
      setOnline(false)
      window.dispatchEvent(new Event('offline'))
    })
    act(() => {
      setOnline(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(state()).toBe('online')
  })

  it('is right about a tab opened while already offline', () => {
    /*
      The events only fire on a change, so a screen brought up in a dead spot would otherwise
      sit there claiming a connection until one arrived — which is the exact moment somebody
      most needs to be told.
    */
    setOnline(false)
    render(<Probe />)
    expect(state()).toBe('offline')
  })

  it('stops listening when it goes away', () => {
    // A listener left behind writes to a component that is no longer there.
    const { unmount } = render(<Probe />)
    unmount()
    setOnline(false)
    expect(() => window.dispatchEvent(new Event('offline'))).not.toThrow()
  })
})
