// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Noticing that a write has not been acknowledged.
 *
 * `waitForPendingWrites` is the only complete answer the SDK gives — it resolves when the
 * whole queue has been acknowledged, and immediately when the queue is empty — so the
 * question is asked by racing it against a short timer. Complete matters more than exact
 * here: counting our own writes would mean wrapping every call site, and the first one
 * anybody forgot would have the flag saying "all saved" over an unsent jar.
 */

/** Resolved by a test when it wants the queue to drain. */
let drain: (() => void) | null = null
let waits = 0

vi.mock('firebase/firestore', () => ({
  waitForPendingWrites: () => {
    waits += 1
    if (drain === null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      drain = () => resolve()
    })
  },
}))

vi.mock('../src/lib/firebase', () => ({ db: {} }))

const { usePendingWrites } = await import('../src/lib/pending')

function Flag(): React.ReactNode {
  const { saving } = usePendingWrites()
  return <span data-testid="flag">{saving ? 'saving' : 'settled'}</span>
}

const shown = (): string => screen.getByTestId('flag').textContent ?? ''

beforeEach(() => {
  waits = 0
  drain = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('when nothing is outstanding', () => {
  it('stays quiet', async () => {
    render(<Flag />)
    await waitFor(() => expect(waits).toBeGreaterThan(0))
    expect(shown()).toBe('settled')
  })
})

describe('when a write has not been acknowledged', () => {
  it('says so once the grace period passes', async () => {
    // A promise that never settles is the shape of a queue that is not draining.
    drain = () => undefined
    render(<Flag />)
    await waitFor(() => expect(shown()).toBe('saving'), { timeout: 2000 })
  })

  it('goes quiet again when the queue drains', async () => {
    drain = () => undefined
    render(<Flag />)
    await waitFor(() => expect(shown()).toBe('saving'), { timeout: 2000 })

    drain?.()
    drain = null
    await waitFor(() => expect(shown()).toBe('settled'), { timeout: 3000 })
  })

  it('keeps asking, since nothing tells it when a write is enqueued', async () => {
    render(<Flag />)
    await waitFor(() => expect(waits).toBeGreaterThan(1), { timeout: 4000 })
  })
})

describe('when the component goes away mid-check', () => {
  it('stops asking', async () => {
    const view = render(<Flag />)
    await waitFor(() => expect(waits).toBeGreaterThan(0))
    view.unmount()

    const asked = waits
    await new Promise((done) => setTimeout(done, 1500))
    // A poll that outlives its component sets state on one that is gone.
    expect(waits).toBe(asked)
  })
})
