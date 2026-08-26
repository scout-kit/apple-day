import type { ReactNode } from 'react'
import { useEvent } from '../lib/eventContext'
import { runsTheEvent, useSession } from '../lib/session'
import { useRequestActions } from './RequestActions'

/**
 * A pointer to requests waiting on an answer.
 *
 * It says that something needs dealing with and where to go; it does not deal with it. The
 * screens it appears on are the ones somebody is working from — the board, the day-of table,
 * the jar count — and answering a volunteer properly means reading what they said and often
 * ringing a parent, which is not a thing to start doing over the top of a jar being counted.
 *
 * Nothing is rendered when nothing is waiting. It used to say "No requests waiting · 4
 * already dealt with", which is a permanent box telling somebody there is nothing to do.
 */
export function RequestsInbox(): ReactNode {
  const { role } = useSession()
  // Nobody off the roster can read requests — the rules see to that — so the listener is
  // not even started for them.
  if (!runsTheEvent(role)) return null
  return <PendingAlert />
}

function PendingAlert(): ReactNode {
  const { pathFor } = useEvent()
  const { loading, open } = useRequestActions()

  if (loading || open.length === 0) return null

  const oldest = open[0]
  return (
    <div className="note warning">
      <div className="row" style={{ justifyContent: 'space-between', gap: '0.6rem' }}>
        <div>
          <strong>
            {open.length} request{open.length === 1 ? '' : 's'} waiting for an answer
          </strong>
          <div className="small">
            Sent by volunteers from their pass links.
            {oldest && (
              <>
                {' '}
                The oldest came in{' '}
                {new Date(oldest.createdAt).toLocaleString('en-CA', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                .
              </>
            )}
          </div>
        </div>
        <a className="btn" href={pathFor('notifications')}>
          Open notifications
        </a>
      </div>
    </div>
  )
}
