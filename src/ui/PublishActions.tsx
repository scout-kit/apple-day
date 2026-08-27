import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { unpublishCaution, unpublishCost } from '../domain/unpublish'
import { useEvent } from '../lib/eventContext'
import { publish, unpublish } from '../lib/publish'
import { useAssignments, usePasses } from '../lib/repo'
import { useSession } from '../lib/session'
import { ErrorNote } from './Bits'
import { Modal } from './Modal'
import { RepublishNotice, usePublishInput } from './PublishNotice'

/**
 * Publishing, on the screen the schedule is built on.
 *
 * Here rather than on a screen of its own, because everything a Publish screen would hold
 * belongs somewhere better: a volunteer's link and QR on their own page, the jar labels
 * beside the jars, the "no contact details" warning on the roster where the details are
 * entered. What is left is one button, and it belongs where the thing it publishes is built.
 *
 * The two warnings here are not repeated anywhere. Neither is about the schedule, but both
 * are about to be baked into every pass, and this is the last moment they can be fixed.
 *
 * There was a mail-merge CSV here as well, the only route from this app to a parent's
 * inbox — there are no Cloud Functions on the free plan, so nothing here can send anything.
 * Removed on request; the passes it drew on are unchanged, so it is a component to write
 * again rather than a capability to rebuild.
 */
export function PublishActions(): ReactNode {
  const { event } = useEvent()
  const { role } = useSession()
  const passes = usePasses()
  const assignments = useAssignments()
  const input = usePublishInput()

  const [publishing, setPublishing] = useState(false)
  const [justPublished, setJustPublished] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false)
  const [withdrawn, setWithdrawn] = useState(0)
  const [error, setError] = useState<Error | null>(null)

  /*
    The confirmation goes away by itself.

    Saying it happened is the whole job, and once it has been read there is nothing left to
    say. A line that stays until the screen is left leaves the board carrying a stale claim,
    and a count nobody asked for reads as a thing to check.
  */
  useEffect(() => {
    if (!justPublished) return
    const timer = setTimeout(() => setJustPublished(false), 4000)
    // Cleared on unmount as well, so leaving the screen mid-countdown does not set state
    // on a component that is gone.
    return () => clearTimeout(timer)
  }, [justPublished])

  /*
    And the same for a withdrawal, which is a heavier thing to say and still only worth
    saying once. It sits longer because it is worth reading twice — but it does go: the row
    above it already shows the truth of it, with nothing left to unpublish.
  */
  useEffect(() => {
    if (withdrawn === 0) return
    const timer = setTimeout(() => setWithdrawn(0), 8000)
    return () => clearTimeout(timer)
  }, [withdrawn])

  const existingTokens = new Map(passes.data.map((p) => [p.personId, p.token]))

  /*
    Withdrawing is an admin's call, and only ever offered when there is something to
    withdraw. Publishing is an organizer's — the difference is that this one reaches back out
    and breaks links that have already been handed out, which cannot be undone by doing it
    again: the new passes have new tokens.
  */
  const cost = unpublishCost(passes.data, assignments.data)
  const caution = unpublishCaution(cost)
  const canWithdraw = role === 'admin' && cost.passes > 0

  const doUnpublish = async (): Promise<void> => {
    if (!event) return
    setConfirmingWithdraw(false)
    setWithdrawing(true)
    setError(null)
    try {
      const gone = await unpublish(event.id, passes.data.map((p) => p.token))
      setWithdrawn(gone)
    } catch (e) {
      setError(e as Error)
    } finally {
      setWithdrawing(false)
    }
  }

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
        {canWithdraw && (
          <button disabled={withdrawing} onClick={() => setConfirmingWithdraw(true)}>
            {withdrawing ? 'Unpublishing…' : 'Unpublish'}
          </button>
        )}
      </div>

      {justPublished && <div className="note good">Schedule published.</div>}
      {withdrawn > 0 && (
        // A warning, not a confirmation: what it reports is that something people were sent
        // has stopped working, which is the same kind of thing as the two notices below it.
        <div className="note warning">
          Schedule unpublished. {withdrawn} {withdrawn === 1 ? 'link' : 'links'} no longer{' '}
          {withdrawn === 1 ? 'works' : 'work'}.
        </div>
      )}

      {confirmingWithdraw && (
        <Modal
          title="Unpublish the schedule?"
          onClose={() => setConfirmingWithdraw(false)}
          footer={
            <>
              <button onClick={() => setConfirmingWithdraw(false)}>Cancel</button>
              <button className="danger" onClick={() => void doUnpublish()}>
                Unpublish
              </button>
            </>
          }
        >
          <div className="stack">
            <p>
              Every volunteer's page is deleted. The{' '}
              <strong>
                {cost.passes} {cost.passes === 1 ? 'link' : 'links'}
              </strong>{' '}
              already sent out will stop working.
            </p>
            {/*
              The one thing publishing again does not fix. Tokens are reused by reading the
              passes that are there, and after this there are none — so everybody is issued
              a new link and the old ones stay dead.
            */}
            <p>
              Publishing again hands out new links rather than the old ones, so anybody who
              has already been sent theirs has to be sent it again.
            </p>
            {caution && <div className="note warning">{caution}</div>}
            <p className="small muted">
              The schedule itself is untouched — this only withdraws what was handed out.
            </p>
          </div>
        </Modal>
      )}

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
