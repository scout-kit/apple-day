import { onSnapshot } from 'firebase/firestore'
import type {
  DocumentReference,
  DocumentSnapshot,
  Query,
  QuerySnapshot,
} from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'

import { isFatalClientFailure } from '../domain/clientFailure'
import { recoverFromFatalFailure } from './recover'

/**
 * Realtime subscription hooks.
 *
 * Read budget matters a little here: a listener costs one read per document on the
 * initial snapshot and one per changed document afterwards. At this event's size
 * (~21 locations, ~60 people, ~60 jars) a day of heavy use is low thousands of reads
 * against the Spark limit of 50,000, so subscribing broadly is fine — but subscribe once
 * at the top of a screen rather than per row.
 */

/**
 * How many times a failed subscription is retried before the error is believed.
 *
 * A Firestore listener that errors is finished: it does not retry when the credentials
 * arrive a moment later. That is only a detail until the moment somebody first signs in,
 * when every screen subscribes against a roster entry written seconds ago — one denied
 * read then left the whole page showing an error until it was reloaded by hand, which is
 * exactly what a reload appeared to fix.
 *
 * Bounded, because a permission error that persists is a real answer and should be shown.
 * Four attempts over about two and a half seconds.
 */
const RETRIES = 4

const backoff = (attempt: number): number => 150 * 2 ** attempt

/**
 * Subscribe, and treat a failure as possibly-temporary before treating it as an answer.
 *
 * The caller is left in whatever state it was in — loading, usually — for as long as this
 * is still trying, so a screen says "loading" rather than flashing an error it is about to
 * withdraw.
 *
 * Retrying is only right for a failure that might not happen again. When the client
 * itself is finished — see `isFatalClientFailure` — asking again cannot succeed, and
 * asking again from every subscription on the page is how one broken client became
 * dozens of identical console errors. Those stop here and go to recovery instead.
 */
function watch<T>(
  attach: (onValue: (value: T) => void, onError: (error: Error) => void) => () => void,
  onValue: (value: T) => void,
  onFailed: (error: Error) => void,
): () => void {
  let stop: (() => void) | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const failed = (error: Error): void => {
    // Already dead: Firestore will not call this listener again.
    stop = null
    onFailed(error)
    if (isFatalClientFailure(error)) void recoverFromFatalFailure(error)
  }

  const start = (attempt: number): void => {
    try {
      stop = attach(onValue, (error) => {
        stop = null
        if (isFatalClientFailure(error) || attempt >= RETRIES) {
          failed(error)
          return
        }
        timer = setTimeout(() => start(attempt + 1), backoff(attempt))
      })
    } catch (error) {
      // A client whose work queue has failed throws out of onSnapshot rather than
      // calling back. Uncaught, that escapes the effect and takes the render with it.
      failed(error instanceof Error ? error : new Error(String(error)))
    }
  }

  start(0)

  return () => {
    stop?.()
    if (timer !== null) clearTimeout(timer)
  }
}

export interface Loadable<T> {
  data: T
  loading: boolean
  error: Error | null
}

/** Subscribe to a whole collection or query, mapping each doc through `convert`. */
export function useCollectionData<T>(
  query: Query,
  convert: (id: string, data: Record<string, unknown>) => T,
  deps: unknown[] = [],
): Loadable<T[]> {
  const [state, setState] = useState<Loadable<T[]>>({
    data: [],
    loading: true,
    error: null,
  })

  // Keep the converter out of the effect's dependency list — an inline arrow would
  // otherwise resubscribe (and re-bill reads) on every render.
  const convertRef = useRef(convert)
  convertRef.current = convert

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoQuery = useMemo(() => query, deps)

  useEffect(
    () =>
      watch<QuerySnapshot>(
        (onValue, onError) => onSnapshot(memoQuery, onValue, onError),
        (snapshot) => {
          const rows = snapshot.docs.map((d) =>
            convertRef.current(d.id, d.data() as Record<string, unknown>),
          )
          setState({ data: rows, loading: false, error: null })
        },
        (error) => setState({ data: [], loading: false, error }),
      ),
    [memoQuery],
  )

  return state
}

/** Subscribe to a single document. */
export function useDocumentData<T>(
  ref: DocumentReference | null,
  convert: (id: string, data: Record<string, unknown>) => T,
  deps: unknown[] = [],
): Loadable<T | null> {
  const [state, setState] = useState<Loadable<T | null>>({
    data: null,
    loading: ref !== null,
    error: null,
  })

  const convertRef = useRef(convert)
  convertRef.current = convert

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoRef = useMemo(() => ref, deps)

  useEffect(() => {
    if (!memoRef) {
      setState({ data: null, loading: false, error: null })
      return
    }
    return watch<DocumentSnapshot>(
      (onValue, onError) => onSnapshot(memoRef, onValue, onError),
      (snapshot) => {
        setState({
          data: snapshot.exists()
            ? convertRef.current(snapshot.id, snapshot.data() as Record<string, unknown>)
            : null,
          loading: false,
          error: null,
        })
      },
      (error) => setState({ data: null, loading: false, error }),
    )
  }, [memoRef])

  return state
}
