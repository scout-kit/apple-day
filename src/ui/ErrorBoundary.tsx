import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { isFatalClientFailure } from '../domain/clientFailure'
import { recoverFromFatalFailure } from '../lib/recover'

/**
 * The last thing between a thrown error and a white page.
 *
 * React unmounts the whole tree when a render or an effect throws and nothing catches it.
 * With no boundary anywhere, that meant signing in and landing on a blank screen — no shell,
 * no message, nothing to report but "it isn't loading". The error had already been thrown and
 * described in the console; the page just could not say so.
 *
 * A class component because this is the one thing hooks cannot do.
 */
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Kept in the console, where a stack is worth more than anything shown on screen.
    console.error('Apple Day: unhandled error', error, info.componentStack)

    const failure = error instanceof Error ? error : new Error(String(error))
    // A dead Firestore client is the one failure the app can do something about by itself.
    if (isFatalClientFailure(failure)) void recoverFromFatalFailure(failure)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="pass">
        <div className="note error">
          <strong>Something went wrong on this screen.</strong>
          <div className="small" style={{ marginTop: '0.35rem' }}>
            Nothing you entered has been lost — the app records each change as it is made.
          </div>
        </div>

        <div className="card">
          <p className="small muted">
            Reloading fixes most of these. If it keeps happening, clearing this site&rsquo;s
            data will rebuild the offline copy, which is the usual cause.
          </p>
          <div className="row">
            <button className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
          {/* The message, last and quiet: useful to whoever is asked about it, noise to
              everybody else. */}
          <p className="small mono muted" style={{ marginTop: '0.75rem' }}>
            {error.message}
          </p>
        </div>
      </div>
    )
  }
}
