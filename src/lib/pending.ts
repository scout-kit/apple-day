import { waitForPendingWrites } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import type { SyncState } from '../domain/syncing'
import { db } from './firebase'

/**
 * Whether anything written here is still waiting to be acknowledged.
 *
 * `waitForPendingWrites` is the only complete answer the SDK gives: it resolves when the
 * whole queue has been acknowledged by the server, and immediately when the queue is empty.
 * So the question "is anything outstanding" is asked by racing it against a short timer —
 * if the timer wins, there is a queue.
 *
 * Complete is the reason for doing it this way. Counting our own writes would mean wrapping
 * every call site in `repo.ts`, `publish.ts` and the rest, and the first one anybody forgot
 * would make the flag say "all saved" while a jar sat unsent. A boolean that is always right
 * beats a number that is usually right, on the screen whose whole job is to be trusted.
 *
 * Polled rather than pushed, because nothing here is told when a write is enqueued. Once a
 * second, against a local queue — no network, no reads, no cost.
 */
const EVERY_MS = 1000
/** Long enough that an acknowledged write is not reported, short enough to feel immediate. */
const GRACE_MS = 200

export function usePendingWrites(): SyncState {
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const look = async (): Promise<void> => {
      let settled = false
      const drained = waitForPendingWrites(db).then(() => {
        settled = true
      })

      await Promise.race([
        drained,
        new Promise((done) => {
          timer = setTimeout(done, GRACE_MS)
        }),
      ])
      if (stopped) return
      setSaving(!settled)

      /*
        Kept off the microtask queue if it never resolves.

        A rejection is not a reason to say anything: `waitForPendingWrites` rejects when the
        client is shut down or the user signs out, neither of which is a write in danger.
      */
      void drained.catch(() => undefined)

      timer = setTimeout(() => void look(), EVERY_MS)
    }

    void look()

    return () => {
      stopped = true
      if (timer !== null) clearTimeout(timer)
    }
  }, [])

  return { saving }
}
