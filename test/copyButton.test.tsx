// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Copying something, and saying that it happened.
 *
 * A button whose work is invisible reads as a button that did nothing, so it gets pressed
 * again and the thing lands twice — or somebody gives up and selects the text by hand, which
 * is what the button was for. Most of what it copies here is a link that is the whole of
 * somebody's access, so "did that work" is worth answering.
 */

vi.mock('../src/lib/firebase', () => ({ missingConfig: [], auth: {}, db: {} }))
vi.mock('../src/lib/sections', () => ({ useSections: () => ({ data: [], loading: false }) }))

const { CopyButton } = await import('../src/ui/Bits')

let writeText: ReturnType<typeof vi.fn>

const withClipboard = (impl: () => Promise<void>): void => {
  writeText = vi.fn(impl)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
}

const withoutClipboard = (): void => {
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  withClipboard(async () => undefined)
  document.execCommand = vi.fn(() => true)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('when it works', () => {
  it('copies what it was given', async () => {
    render(<CopyButton text="https://x.example/join/abc" />)
    await userEvent.click(screen.getByRole('button'))
    expect(writeText).toHaveBeenCalledWith('https://x.example/join/abc')
  })

  it('says so, which is the whole point', async () => {
    render(<CopyButton text="x" label="Copy link" />)
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
  })

  it('goes back to normal, so it does not look stuck', async () => {
    // A button left reading "Copied" cannot say it a second time, and the second press is
    // the one somebody is unsure about.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<CopyButton text="x" label="Copy link" />)

    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  it('is announced, not only recoloured', async () => {
    // The label changing confirms it for anybody looking at it. A live region is what
    // confirms it for anybody who is not.
    render(<CopyButton text="x" />)
    expect(screen.getByRole('button').getAttribute('aria-live')).toBe('polite')
  })
})

describe('when the browser will not', () => {
  it('falls back rather than failing, where the fallback works', async () => {
    /*
      `navigator.clipboard` is absent outside a secure context, which is not exotic: it is
      what happens when somebody opens the dev server on their phone by IP address.
    */
    withoutClipboard()
    render(<CopyButton text="x" label="Copy link" />)

    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
    expect(document.execCommand).toHaveBeenCalledWith('copy')
  })

  it('falls back when the clipboard is there and refuses', async () => {
    // Permission can be denied outright, separately from the API existing.
    withClipboard(async () => {
      throw new Error('denied')
    })
    render(<CopyButton text="x" label="Copy link" />)

    await userEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy())
  })

  it('says it could not, rather than pretending or going quiet', async () => {
    withoutClipboard()
    document.execCommand = vi.fn(() => false)
    render(<CopyButton text="x" label="Copy link" />)

    await userEvent.click(screen.getByRole('button'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Could not copy' })).toBeTruthy(),
    )
  })

  it('says what to do instead', async () => {
    withoutClipboard()
    document.execCommand = vi.fn(() => false)
    render(<CopyButton text="x" label="Copy link" />)

    await userEvent.click(screen.getByRole('button'))
    await waitFor(() =>
      expect(screen.getByRole('button').getAttribute('title')).toMatch(/by hand/),
    )
  })

  it('survives a fallback that throws', async () => {
    withoutClipboard()
    document.execCommand = vi.fn(() => {
      throw new Error('no')
    })
    render(<CopyButton text="x" label="Copy link" />)

    await userEvent.click(screen.getByRole('button'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Could not copy' })).toBeTruthy(),
    )
  })

  it('leaves nothing behind in the page', async () => {
    // The fallback works by putting a real textarea in the document. One left there would
    // be a stray focus target on every screen that has a copy button.
    withoutClipboard()
    render(<CopyButton text="x" />)
    await userEvent.click(screen.getByRole('button'))
    expect(document.querySelectorAll('textarea')).toHaveLength(0)
  })
})
