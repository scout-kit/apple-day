import { useState } from 'react'
import type { ReactNode } from 'react'
import { PAGE, moreLabel, nextShown, paged } from '../domain/paging'
import { requestSummary } from '../domain/requests'
import type { VolunteerRequest } from '../domain/requests'
import { fullName } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import { Loading, SectionPill } from './Bits'
import { Modal } from './Modal'
import { requestHeadline, useRequestActions } from './RequestActions'
import type { RequestDetail } from './RequestActions'

/**
 * Everything volunteers have asked for this event.
 *
 * Per event, not app-wide: a request belongs to the Apple Day it was sent about, and last
 * year's swap is not something anybody needs surfacing while this year is being run.
 *
 * Laid out like a mailbox rather than a list of bullets. Each card carries enough to triage
 * at a glance — who, what, when, and the first of what they said — and opens for the rest:
 * the parent's phone number, every shift they are on, and the buttons. Answering somebody
 * properly usually means ringing a parent, so the details and the actions belong together in
 * one place rather than spread across a row on a working screen.
 */

/** A time, written the way somebody scanning a mailbox reads one. */
function when(at: number): string {
  const date = new Date(at)
  const today = new Date()
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return sameDay
    ? date.toLocaleTimeString('en-CA', { timeStyle: 'short' })
    : date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
}

function Card({
  detail,
  unread,
  onOpen,
}: {
  detail: RequestDetail
  unread: boolean
  onOpen: () => void
}): ReactNode {
  const { request, person } = detail
  return (
    <button className={`mail-card${unread ? ' is-unread' : ''}`} onClick={onOpen}>
      <span className="mail-dot" aria-hidden="true" />
      <span className="mail-body">
        <span className="mail-top">
          <span className="mail-from">
            {person ? fullName(person) : 'Somebody'}
            {person && <SectionPill section={person.section} />}
          </span>
          <span className="mail-when small muted">{when(request.createdAt)}</span>
        </span>
        <span className="mail-subject">{requestHeadline(detail)}</span>
        {request.message && <span className="mail-snippet small muted">{request.message}</span>}
      </span>
    </button>
  )
}

function Details({
  detail,
  busy,
  onClose,
  onMarkAbsent,
  onDone,
  onReopen,
}: {
  detail: RequestDetail
  busy: boolean
  onClose: () => void
  onMarkAbsent: (ids: string[], alsoClose: boolean) => void
  onDone: () => void
  onReopen: () => void
}): ReactNode {
  const { pathFor } = useEvent()
  const { request, person, shifts, standing } = detail
  const dealtWith = request.handledAt !== null

  return (
    <Modal
      title={requestHeadline(detail)}
      onClose={onClose}
      footer={
        <>
          {/*
            The only Close in the dialog, beyond the header's ✕. A second one in the body for
            a request already dealt with would put the same word on two buttons with nothing
            to tell them apart.
          */}
          <button onClick={onClose}>Close</button>
          {/*
            The way back, for the row pressed by mistake.

            Dealing with a request is otherwise the one thing here that cannot be undone, and
            a queue worked through on a Friday evening is exactly where the wrong row gets
            pressed — leaving a volunteer waiting on somebody who thinks they have answered.

            It touches nothing but the request, so it needs no confirming: nobody's shifts
            move, and marking it dealt with again is one press away.
          */}
          {dealtWith && (
            <button
              disabled={busy}
              title="Put it back on the waiting list. Nobody's shifts change."
              onClick={onReopen}
            >
              {busy ? 'Saving…' : 'Put back in the queue'}
            </button>
          )}
          {!dealtWith && (
            <>
              {standing.length > 1 && (
                <button
                  className="danger"
                  disabled={busy}
                  title={`Mark them absent for all ${standing.length} of their remaining shifts, and mark this request dealt with`}
                  onClick={() => onMarkAbsent(standing.map((sh) => sh.assignment.id), true)}
                >
                  No-show for all {standing.length}, and done
                </button>
              )}
              {standing.length === 1 && (
                <button
                  className="danger"
                  disabled={busy}
                  title="Mark them absent for that shift, and mark this request dealt with"
                  onClick={() => onMarkAbsent([standing[0]!.assignment.id], true)}
                >
                  No-show, and done
                </button>
              )}
              <button className="primary" disabled={busy} onClick={onDone}>
                {busy ? 'Saving…' : 'Done'}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="stack">
        <div>
          <div className="small muted">
            {requestSummary(request.kind)} ·{' '}
            {new Date(request.createdAt).toLocaleString('en-CA', {
              dateStyle: 'full',
              timeStyle: 'short',
            })}
          </div>
          {dealtWith && (
            <div className="small muted">
              Dealt with{' '}
              {new Date(request.handledAt!).toLocaleString('en-CA', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {/*
                The address, not the uid. A uid names nobody — it was showing
                "by gtQJ7d2k4jXChdHhHDKCk9n7ZIym", which is true and unreadable. Requests
                dealt with before it was recorded still have only the uid, and it is shown
                rather than hidden: an admin can match it on the access screen, which is
                more than a blank offers.
              */}
              {(request.handledByEmail || request.handledBy) &&
                ` by ${request.handledByEmail || request.handledBy}`}
            </div>
          )}
        </div>

        {request.message ? (
          <p style={{ whiteSpace: 'pre-line', margin: 0 }}>“{request.message}”</p>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            They did not add a message.
          </p>
        )}

        {/* Answering somebody usually means ringing their parent, so the number is here
            rather than two screens away. */}
        <div>
          <strong className="small">Who to contact</strong>
          {!person ? (
            <div className="small muted">
              This pass no longer matches anybody — they may have been removed from the event.
            </div>
          ) : (
            <div className="row" style={{ gap: '0.6rem' }}>
              <a className="small" href={pathFor(`person/${person.id}`)}>
                {fullName(person)}
              </a>
              {person.parentName && <span className="small muted">{person.parentName}</span>}
              {person.parentPhone && (
                <a className="small" href={`tel:${person.parentPhone}`}>
                  {person.parentPhone}
                </a>
              )}
              {person.parentEmail && (
                <a className="small" href={`mailto:${person.parentEmail}`}>
                  {person.parentEmail}
                </a>
              )}
              {!person.parentPhone && !person.parentEmail && (
                <span className="small" style={{ color: 'var(--warn)' }}>
                  No contact details on file.
                </span>
              )}
            </div>
          )}
        </div>

        <div>
          <strong className="small">Their shifts</strong>
          {shifts.length === 0 ? (
            <div className="small muted">Not on the board at all.</div>
          ) : (
            <ul className="shift-list">
              {shifts.map((sh) => (
                <li key={sh.assignment.id} className={sh.named ? 'is-named' : ''}>
                  <span className="small">
                    {sh.when} · {sh.locationName}
                    {sh.absent && <span className="muted"> · marked no-show</span>}
                  </span>
                  {!dealtWith && !sh.absent && (
                    <button
                      className="tiny"
                      disabled={busy}
                      title={`Mark them absent for ${sh.when} at ${sh.locationName}. Their other shifts stand, and this request stays open.`}
                      onClick={() => onMarkAbsent([sh.assignment.id], false)}
                    >
                      No-show for this shift
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {!dealtWith && (
          <p className="small muted" style={{ margin: 0 }}>
            Marking a no-show tells the board they are not coming, which is what makes the
            location show as short-staffed for that hour. A shift marked from the list above
            leaves this request open, because you may still need to find cover for it; the
            buttons below deal with the request at the same time. “Done” on its own marks it
            dealt with and keeps it on the record.
          </p>
        )}
      </div>
    </Modal>
  )
}

export function NotificationsScreen(): ReactNode {
  const { event } = useEvent()
  const { loading, open, closed, error, busy, detail, markAbsent, close, reopen } =
    useRequestActions()
  const [openId, setOpenId] = useState<string | null>(null)

  /*
    A page at a time, per section.

    Client-side, unlike the audit log, and for a reason rather than for want of effort: these
    are one event's requests and they arrive from sixty people, so the whole set is already
    in hand from a listener that has to be live anyway — somebody writing in while the
    mailbox is open should appear in it. Paging the fetch would buy nothing and cost the
    live view. The two counts are held apart because "Waiting" is worked through and "Dealt
    with" is only ever browsed.
  */
  const [waitingShown, setWaitingShown] = useState(PAGE)
  const [closedShown, setClosedShown] = useState(PAGE)

  if (loading) return <Loading what="Reading notifications" />

  const showing: VolunteerRequest | undefined = [...open, ...closed].find(
    (r) => r.id === openId,
  )

  const section = (
    title: string,
    list: VolunteerRequest[],
    unread: boolean,
    emptyNote: string,
    shown: number,
    showMore: () => void,
    blurb?: string,
  ): ReactNode => {
    const page = paged(list, shown)
    return (
      <div className="card">
        <h2>
          {title} ({list.length})
        </h2>
        {list.length === 0 ? (
          <p className="muted">{emptyNote}</p>
        ) : (
          <>
            {blurb && (
              <p className="small muted" style={{ marginTop: 0 }}>
                {blurb}
              </p>
            )}
            <div className="mail-list">
              {page.rows.map((request) => (
                <Card
                  key={request.id}
                  detail={detail(request)}
                  unread={unread}
                  onOpen={() => setOpenId(request.id)}
                />
              ))}
            </div>
            {page.hidden > 0 && (
              <div className="row center" style={{ marginTop: '0.8rem' }}>
                <button onClick={showMore}>{moreLabel(page.hidden)}</button>
              </div>
            )}
          </>
        )}
      </div>
    )
  }

  return (
    <>
      {error && <div className="note error">{error}</div>}

      <div className="card">
        <h1>Notifications</h1>
        <p className="small muted" style={{ margin: 0 }}>
          Everything volunteers have sent from their pass links
          {event ? ` for ${event.name}` : ''}. Open one to see what they said, who to ring,
          and what they are on.
        </p>
      </div>

      {section(
        'Waiting',
        open,
        true,
        'Nothing is waiting on anybody.',
        waitingShown,
        () => setWaitingShown((n) => nextShown(n, open.length)),
        'Oldest first, because the queue is worked through rather than skimmed: somebody who' +
          ' wrote in on Wednesday should not end up behind somebody from an hour ago.',
      )}

      {section(
        'Dealt with',
        closed,
        false,
        'Nothing has been dealt with yet.',
        closedShown,
        () => setClosedShown((n) => nextShown(n, closed.length)),
        'Kept rather than deleted. A deleted row is how a disagreement about what was said' +
          ' becomes unresolvable.',
      )}

      {showing && (
        <Details
          detail={detail(showing)}
          busy={busy === showing.id}
          onClose={() => setOpenId(null)}
          onMarkAbsent={(ids, alsoClose) => {
            markAbsent(showing, ids, alsoClose)
            if (alsoClose) setOpenId(null)
          }}
          onDone={() => {
            close(showing)
            setOpenId(null)
          }}
          onReopen={() => {
            reopen(showing)
            setOpenId(null)
          }}
        />
      )}
    </>
  )
}
