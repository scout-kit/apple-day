import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useEvent } from '../lib/eventContext'
import { publish } from '../lib/publish'
import { usePasses } from '../lib/repo'
import { ErrorNote } from './Bits'
import { RepublishNotice, usePublishInput } from './PublishNotice'

/**
 * Publishing, on the screen the schedule is built on.
 *
 * There used to be a Publish screen. Almost everything on it had found a better home —
 * a volunteer's link and QR live on their own page, the jar labels beside the jars, and
 * the "no contact details" warning was already on the roster where the details are
 * entered. What was left was two buttons, and then one: the public schedule it opened is
 * gone too, so publishing now writes passes and nothing else.
 *
 * The two warnings kept here are not repeated anywhere: neither is about the schedule, but
 * both are about to be baked into every pass, and this is the moment they still can be
 * fixed.
 *
 * There was a mail-merge CSV here as well, the only route from this app to a parent's
 * inbox — there are no Cloud Functions on the free plan, so nothing here can send anything.
 * Removed on request; the passes it drew on are unchanged, so it is a component to write
 * again rather than a capability to rebuild.
 */
export function PublishActions(): ReactNode {
  const { event } = useEvent()
  const passes = usePasses()
  const input = usePublishInput()

  const [publishing, setPublishing] = useState(false)
  const [justPublished, setJustPublished] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  /*
    The confirmation goes away by itself.

    It used to say "Published 47 passes" and stay there until the screen was left, so the
    board carried a stale claim about something that had already happened — and the number,
    which nobody had asked for, read as though it were a thing to check. Saying it happened
    is the whole job, and once it has been read there is nothing left to say.
  */
  useEffect(() => {
    if (!justPublished) return
    const timer = setTimeout(() => setJustPublished(false), 4000)
    // Cleared on unmount as well, so leaving the screen mid-countdown does not set state
    // on a component that is gone.
    return () => clearTimeout(timer)
  }, [justPublished])

  const existingTokens = new Map(passes.data.map((p) => [p.personId, p.token]))

  const doPublish = async (): Promise<void> => {
    if (!event) return
    setPublishing(true)
    setError(null)
    try {
      // Existing tokens are reused, so a link already in somebody's inbox keeps working.
      await publish(event.id, { ...input, existingTokens })
      setJustPublished(true)
    } catch (e) {
      setError(e as Error)
    } finally {
      setPublishing(false)
    }
  }

  return (
    /*
      Not a card: it is nested inside the board's own, under the day switch and the counts.
    */
    <div className="no-print" style={{ marginTop: '0.6rem' }}>
      <ErrorNote error={error} />
      <RepublishNotice showLink={false} />

      <div className="row">
        <button className="primary" disabled={publishing} onClick={() => void doPublish()}>
          {publishing ? 'Publishing…' : 'Publish schedule'}
        </button>
      </div>

      {justPublished && <div className="note good">Schedule published.</div>}

      {!event?.baseLocationId && (
        <div className="note warning">
          No base of operations set. Volunteers will not be told where to report — set one on
          the Events screen.
        </div>
      )}
      {input.support.length === 0 && (
        <div className="note warning">
          No day-of contacts set. The 2025 review asked for a number on every printout so a
          parent at a location has someone to call — add one on the Events screen.
        </div>
      )}
    </div>
  )
}
