// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/*
  The boundary asks for recovery when the Firestore client is the thing that died, which pulls
  the whole client in behind it. Stubbed here so this file tests the boundary rather than
  standing up Firebase to do it.
*/
const recover = vi.fn()
vi.mock('../src/lib/recover', () => ({
  recoverFromFatalFailure: (error: unknown) => {
    recover(error)
  },
}))

const { ErrorBoundary } = await import('../src/ui/ErrorBoundary')

/**
 * Never a white page again.
 *
 * Reported as "I could log in but then get sent to a blank white screen". React unmounts the
 * whole tree when something throws and nothing catches it — and nothing did. The error was in
 * the console the entire time; the page simply had no way to say so.
 */

function Boom({ message = 'Firestore fell over' }: { message?: string }): React.ReactElement {
  throw new Error(message)
}

beforeEach(() => {
  recover.mockClear()
  // React logs the caught error itself; the test does not need it on the terminal.
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('when a screen throws', () => {
  it('says so, instead of showing nothing', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/Something went wrong on this screen/)).toBeTruthy()
  })

  it('offers the thing that usually fixes it', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy()
  })

  it('shows the message, for whoever gets asked about it', () => {
    render(
      <ErrorBoundary>
        <Boom message="INTERNAL ASSERTION FAILED" />
      </ErrorBoundary>,
    )
    expect(screen.getByText('INTERNAL ASSERTION FAILED')).toBeTruthy()
  })

  it('says that nothing entered was lost, because that is the first worry', () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/Nothing you entered has been lost/)).toBeTruthy()
  })

  it('stays out of the way when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>The board</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('The board')).toBeTruthy()
  })
})

describe('a client that is finished', () => {
  it('is sent off to be recovered, rather than only reported', () => {
    // The one failure the app can do something about by itself: throw the store away, reload.
    render(
      <ErrorBoundary>
        <Boom message="FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state" />
      </ErrorBoundary>,
    )
    expect(recover).toHaveBeenCalled()
  })

  it('leaves an ordinary bug alone, because reloading will not fix it', () => {
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined" />
      </ErrorBoundary>,
    )
    expect(recover).not.toHaveBeenCalled()
  })
})

describe('where it sits', () => {
  it('wraps every provider, since a provider is what threw', () => {
    /*
      Inside the providers it would be unmounted along with them. The event context wraps the
      whole app and subscribes on sign-in — which is the throw that produced the white page.
    */
    const main = readFileSync('src/main.tsx', 'utf8')
    const at = main.indexOf('<ErrorBoundary>')
    /*
      Present first. `indexOf` gives -1 when it is missing, and -1 is less than every other
      position — so an "is it outermost" check passes most convincingly when there is no
      boundary at all. This test made exactly that mistake before it was caught.
    */
    expect(at).toBeGreaterThan(-1)
    for (const provider of ['<ThemeProvider>', '<SessionProvider>', '<EventProvider>']) {
      expect(main.indexOf(provider)).toBeGreaterThan(at)
    }
  })
})
