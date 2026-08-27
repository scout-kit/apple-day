import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { mapLink } from '../domain/maps'
import { moreLabel, nextShown, paged, PAGE } from '../domain/paging'
import {
  buildAudience,
  exampleRecipient,
  fullySent,
  sendHistory,
  sentFor,
} from '../domain/reminders'
import type {
  Audience,
  Recipient,
  ReminderAudience,
  Selection,
  SelectionKind,
} from '../domain/reminders'
import {
  audienceFor,
  DEFAULT_TEMPLATES,
  defaultTemplate,
  fillTemplate,
  isEdited,
  templatesFor,
  templateWith,
} from '../domain/reminderText'
import type {
  ReminderTemplate,
  TemplateContext,
  TemplateId,
  TemplateText,
} from '../domain/reminderText'
import { DAY_LABEL } from '../domain/slots'
import { contactLabel } from '../domain/support'
import type { Day } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import { deliver } from '../lib/mail'
import type { MailSender, OutgoingMessage, SendOutcome } from '../lib/mail'
import {
  channelConfigured,
  GOOGLE_CLIENT_ID,
  missingSetting,
  originLooksPublic,
  publicOrigin,
} from '../lib/mail/config'
import { csvSender } from '../lib/mail/csvExport'
import { gmailSender } from '../lib/mail/gmail'
import {
  pendingFor,
  recordSendInLog,
  recordSent,
  resetReminderTemplate,
  saveReminderTemplate,
  useReminderTemplates,
  useSentReminders,
} from '../lib/reminders'
import type { SendChannel } from '../lib/reminders'
import { useAssignments, useBaseLocation, usePasses, usePeople } from '../lib/repo'
import { useUrlState } from '../lib/urlState'
import { PLACEHOLDERS, templateProblem } from '../domain/reminderText'
import { Empty, ErrorNote, Loading, SectionPill } from './Bits'
import { PersonLink } from './PersonLink'
import { Modal } from './Modal'

/**
 * Telling people their shift is coming up.
 *
 * Three choices, kept apart: who it covers, which of those are filtered out, and what it
 * says. Nothing leaves until somebody has read the list and the exact wording and pressed
 * send — this is not a scheduler and is not meant to become one by accident.
 *
 * Mail goes from the organizer's own mailbox rather than from a service. There is no server
 * here to send from, and a reminder from somebody the parents recognise is worth more than
 * one from a no-reply address that half of them will never see.
 */

const CHANNELS: { id: SendChannel; label: string; note: string }[] = [
  {
    id: 'gmail',
    label: 'From my Gmail',
    note: 'Mail arrives from you, and replies come back to you.',
  },
  {
    id: 'csv',
    label: 'Download a file instead',
    note: 'The same messages, for whatever mailing tool you already use. Nothing is sent from here.',
  },
]

interface Finished {
  outcomes: SendOutcome[]
  skipped: number
  channel: SendChannel
}

export function RemindersScreen(): ReactNode {
  const { event, eventId, slots } = useEvent()
  const people = usePeople()
  const assignments = useAssignments()
  const passes = usePasses()
  const base = useBaseLocation()
  const wordings = useReminderTemplates()
  const alreadyOut = useSentReminders()

  const [kindParam, setKind] = useUrlState('for', 'event')
  const [dayParam, setDay] = useUrlState('day')
  const [slotParam, setSlot] = useUrlState('slot')
  /*
    Null means nobody has touched it, which is not the same as off.

    Each wording starts the filter where it makes sense — on, for a reminder about an hour
    that is about to begin — and that default has to be distinguishable from a deliberate
    "no, send it to everybody". A boolean cannot hold both.
  */
  const [chasing, setChasing] = useState<Audience | null>(null)
  const [wording, setWording] = useState<TemplateId | ''>('')
  const [channel, setChannel] = useState<SendChannel>('gmail')
  const [connectedAs, setConnectedAs] = useState('')
  const [shown, setShown] = useState(PAGE)

  const [reviewing, setReviewing] = useState(false)
  const [seen, setSeen] = useState<Recipient[]>([])
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState('')
  const [finished, setFinished] = useState<Finished | null>(null)
  /*
    Two, because they happen in two places and one of them is off screen.

    A failure to connect belongs beside the button that caused it, not four cards up the
    page where it reads as the button doing nothing. A failure while sending belongs in the
    dialog, or it renders behind it.
  */
  const [setupError, setSetupError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [drift, setDrift] = useState<string | null>(null)
  const [resendAnyway, setResendAnyway] = useState(false)
  const [wording2, setWording2] = useState<ReminderTemplate | null>(null)

  const loading =
    people.loading || assignments.loading || passes.loading || wordings.loading

  const days = useMemo(() => [...new Set(slots.map((s) => s.day))], [slots])
  const kind: SelectionKind = kindParam === 'day' || kindParam === 'slot' ? kindParam : 'event'
  const day = (dayParam || days[0] || '') as Day
  const slotId = slotParam || slots[0]?.id || ''

  const selection: Selection = useMemo(() => {
    if (kind === 'day') return { kind: 'day', day }
    if (kind === 'slot') return { kind: 'slot', slotId }
    return { kind: 'event' }
  }, [kind, day, slotId])

  /*
    The wording, and the audience it forces.

    A template that claims somebody has not checked in decides the filter rather than the
    checkbox does — otherwise the claim could be made false by leaving a control in the
    wrong place, and the person reading the email would be the one to find out.
  */
  const offered = templatesFor(kind)
  const chosenId: TemplateId =
    wording && offered.some((t) => t.id === wording)
      ? wording
      : defaultTemplate(kind, chasing ?? 'all')
  /*
    The built-in wording, with whatever has been saved over it.

    One renderer either way, so an edited wording cannot behave differently from the one it
    replaced — see `domain/reminderText`.
  */
  const template = templateWith(chosenId, wordings.data.get(chosenId))!
  const edited = isEdited(template)
  const audience: Audience = audienceFor(template, chasing)
  const audienceLocked = template.requiresAudience !== undefined

  const origin = publicOrigin()
  const originSafe = originLooksPublic(origin)

  const context: TemplateContext = useMemo(
    () => ({
      eventName: event?.name ?? 'Apple Day',
      occasion: occasionOf(selection, slots),
      supportLine: (event?.support ?? []).map(contactLabel).filter(Boolean).join(', '),
      /*
        Where to report, and everything the pass says about being there.

        Resolved through the shared hook: the base is deliberately not one of the year's
        selected locations, so looking it up among those finds nothing and empties the line.
      */
      meetingPoint: base.data?.name ?? '',
      /*
        The address as a link rather than as text. Derived the way publishing derives it, so
        a base with an address and no saved link still gets one — which is also why the
        address is never printed: it is already in here, in the form that can be pressed.
      */
      directions: base.data ? mapLink(base.data) : '',
      arrivalNote: event?.arrivalNote ?? '',
      supportNote: event?.supportNote ?? '',
      dueAt: dueAtOf(selection, slots),
    }),
    [event, selection, slots, base.data],
  )

  /*
    Everybody the current choices reach.

    One function, called two ways: memoized for the screen, and again by hand at the moment
    send is pressed. Two copies of these six lines is how the screen and the send quietly
    stop agreeing about who a reminder is for.
  */
  const build = (): ReminderAudience =>
    buildAudience(selection, audience, {
      people: people.data,
      assignments: assignments.data,
      slots,
      tokenByPerson: new Map(passes.data.map((p) => [p.personId, p.token])),
      origin,
    })

  const now = useMemo(
    () => (loading ? { recipients: [], unreachable: [] } : build()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loading, selection, audience, people.data, assignments.data, slots, passes.data, origin],
  )

  const senderFor = (c: SendChannel): MailSender & { finish?: () => void } =>
    c === 'gmail'
      ? gmailSender(GOOGLE_CLIENT_ID)
      : csvSender(`${event?.slug || eventId || 'apple-day'}-reminders.csv`)

  const needsMailbox = channel !== 'csv'
  const configured = channelConfigured(channel)

  /**
   * Ask for permission before anything is composed.
   *
   * Its own button rather than a step inside the send: a consent popup opened halfway
   * through a run is the one a browser is most likely to block, and it would strand the
   * send with some messages out and some not.
   */
  const connect = async (): Promise<void> => {
    setSetupError(null)
    try {
      const mail = senderFor(channel)
      await mail.connect()
      setConnectedAs(mail.sendingAs() || 'your mailbox')
    } catch (e) {
      setSetupError(e instanceof Error ? e.message : String(e))
    }
  }

  const openReview = (): void => {
    setSendError(null)
    setDrift(null)
    setResendAnyway(false)
    setFinished(null)
    setSeen(now.recipients)
    setReviewing(true)
  }

  /*
    Who has already had this exact reminder, from the live ledger.

    A listener rather than a read per person when the dialog opens: it costs the same, stays
    current while the dialog is open, and is what lets the list behind it be marked too.
  */
  const sentThis = useMemo(
    () => sentFor(alreadyOut.data, chosenId, selection),
    [alreadyOut.data, chosenId, selection],
  )
  const ledger = useMemo(() => new Set(sentThis.keys()), [sentThis])

  /** Who a press of send would actually reach, given the record and the duplicate choice. */
  const runs = useMemo(
    () =>
      seen
        .map((recipient) => ({
          recipient,
          youths: pendingFor(recipient, ledger, resendAnyway ? 'resend' : 'skip'),
        }))
        .filter((r) => r.youths.length > 0),
    [seen, ledger, resendAnyway],
  )

  /*
    How many have already had it — a fact about the record, not about the choice.

    It was `seen.length - runs.length`, which is zero the moment "send again" is ticked. So
    ticking the box removed the explanation *and the box*, and there was no way to untick it.
  */
  const alreadyHad = useMemo(
    () => seen.filter((r) => fullySent(r, ledger)).length,
    [seen, ledger],
  )
  const skipped = resendAnyway ? 0 : alreadyHad

  const send = async (): Promise<void> => {
    if (!eventId) return
    setSendError(null)

    /*
      Worked out again, and compared with what is on screen — before anything is sent.

      Somebody checking in while the list is open is the ordinary case, not the exotic one;
      that is what the day-of screen is for. So a change does not just get reported, it
      stops the send: the list is replaced, what moved is named, and it takes another press.
      By then the list on screen is the list that will go.
    */
    const fresh = build().recipients
    const before = new Set(seen.map((r) => r.email))
    const after = new Set(fresh.map((r) => r.email))
    const gone = [...before].filter((e) => !after.has(e)).length
    const joined = [...after].filter((e) => !before.has(e)).length

    if (gone > 0 || joined > 0) {
      setSeen(fresh)
      setDrift(
        [
          gone > 0 && `${gone} ${gone === 1 ? 'has' : 'have'} dropped out of the list`,
          joined > 0 && `${joined} ${joined === 1 ? 'has' : 'have'} joined it`,
        ]
          .filter(Boolean)
          .join(', ') + ' since you opened it. Nothing has been sent — check the list and send again.',
      )
      return
    }

    setDrift(null)
    setSending(true)
    setProgress('')

    try {
      const mail = senderFor(channel)
      if (!mail.isConnected()) await mail.connect()

      const messages: OutgoingMessage[] = runs.map(({ recipient, youths }) => ({
        to: recipient.email,
        subject: fillTemplate(template.subject, { ...recipient, youths }, context),
        body: fillTemplate(template.body, { ...recipient, youths }, context),
      }))
      const byEmail = new Map(runs.map((r) => [r.recipient.email, r.youths]))

      const outcomes = await deliver(
        mail,
        messages,
        async (message) => {
          await recordSent(eventId, chosenId, selection, byEmail.get(message.to) ?? [], channel)
        },
        (done, total) => setProgress(`${done} of ${total}`),
      )

      mail.finish?.()

      const ok = outcomes.filter((o) => o.ok).length
      await recordSendInLog(eventId, {
        templateLabel: template.label,
        occasion: context.occasion,
        addresses: ok,
        skipped,
        failed: outcomes.length - ok,
        channel,
      }).catch(() => undefined)

      setFinished({ outcomes, skipped, channel })
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  if (loading) return <Loading what="Reading the schedule" />

  const page = paged(now.recipients, shown)
  const covered = now.recipients.reduce((n, r) => n + r.youths.length, 0)
  const sentAlready = now.recipients.filter((r) => fullySent(r, ledger)).length
  const history = sendHistory(alreadyOut.data)

  return (
    <>
      <ErrorNote error={people.error ?? assignments.error ?? passes.error} />

      <div className="card">
        <h1>Reminders</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Nothing is sent on a timer. Choose who it goes to and what it says, read the list
          and the message, then send it yourself.
        </p>
      </div>

      {/*
        One card, two questions.

        Who it goes to and what it says are separate decisions and now look it. They were
        three stacked panels once, which pushed the answer — how many people this is — off
        the bottom of the screen; then one undifferentiated stack, which put the wording
        picker in the same row as the day picker as though they were the same question.
      */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Who it goes to</h2>

        {/* Only the two controls that answer that, so nothing shifts sideways when the
            second appears. The wording picker belongs in its own row. */}
        <div className="row">
          <label style={{ flex: '0 1 13rem' }}>
            Covering
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value)
                setWording('')
                setShown(PAGE)
              }}
            >
              <option value="event">The whole event</option>
              <option value="day">One day</option>
              <option value="slot">One shift</option>
            </select>
          </label>

          {kind === 'day' && (
            <label style={{ flex: '0 1 13rem' }}>
              Day
              <select value={day} onChange={(e) => setDay(e.target.value)}>
                {days.map((d) => (
                  <option key={d} value={d}>
                    {DAY_LABEL[d]}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kind === 'slot' && (
            <label style={{ flex: '0 1 13rem' }}>
              Shift
              <select value={slotId} onChange={(e) => setSlot(e.target.value)}>
                {slots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {DAY_LABEL[s.day]} {s.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {/*
          The label is the phrase and nothing else.

          Wrapping the explanation underneath makes the whole paragraph a click target, so
          reading the reason toggles the thing it is explaining.
        */}
        {/*
          The app's own toggle, which is what the other four of these use.

          A bare checkbox inside a `<label>` is caught by `label > input { width: 100%;
          display: block }` — the rule that makes a text field fill its label — so it
          rendered as a full-width box on a line of its own. `.switch` sets its own width and
          `flex: none`, which is what stops that; the margin the same rule adds has to go
          too, or the toggle sits a nudge below the words beside it.
        */}
        <label className="row" style={{ gap: '0.5rem', marginTop: '0.7rem' }}>
          <input
            type="checkbox"
            className="switch"
            style={{ marginTop: 0 }}
            /*
              Reads the audience that is actually in force, and writes the choice that
              produces it. Those agree now that "untouched" is its own state.
            */
            checked={audience === 'notCheckedIn'}
            disabled={audienceLocked}
            onChange={(e) => setChasing(e.target.checked ? 'notCheckedIn' : 'all')}
          />
          {/* Not muted: a `<label>` greys its contents, which on a whole phrase reads as
              disabled rather than as a caption. */}
          <span className="small" style={{ color: 'var(--text)' }}>
            Only those who have not checked in
          </span>
        </label>

        {filterNote(audienceLocked, chasing, template.defaultAudience) && (
          // Its own line, out of the label, and indented to sit under the phrase it explains.
          <p className="small muted" style={{ margin: '0.2rem 0 0 1.5rem' }}>
            {filterNote(audienceLocked, chasing, template.defaultAudience)}
          </p>
        )}

        <hr className="rule" />

        <div className="row between">
          <h2 style={{ margin: 0 }}>What it says</h2>
          {/* Beside the heading, not across a paragraph from it. */}
          <button className="tiny" onClick={() => setWording2(template)}>
            Edit wording
          </button>
        </div>

        <div className="row">
          <label style={{ flex: '1 1 20rem' }}>
            Wording
            <select
              value={chosenId}
              onChange={(e) => {
                setWording(e.target.value as TemplateId)
                // Back to whatever the new wording starts the filter at, until it is touched.
                setChasing(null)
              }}
            >
              {offered.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="small muted" style={{ margin: '0.4rem 0 0' }}>
          {template.blurb}
          {edited && <span className="mono"> · reworded by your group</span>}
        </p>
      </div>

      <div className="card">
        <div className="row between">
          <h2 style={{ margin: 0 }}>
            {now.recipients.length} {now.recipients.length === 1 ? 'address' : 'addresses'}
          </h2>
          {now.recipients.length > 0 && (
            <span className="small muted">
              covering {covered} on the schedule
              {context.occasion && ` · ${context.occasion}`}
            </span>
          )}
        </div>

        {sentAlready > 0 && (
          /*
            Said on the screen you choose from, not only in the dialog you press through to.

            "Have we already done this" is the question somebody arrives with, and it was
            only answerable by starting the thing they were checking on.
          */
          <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
            {sentAlready === now.recipients.length
              ? 'Everybody here has already had this reminder.'
              : `${sentAlready} of ${now.recipients.length} have already had this reminder.`}
          </p>
        )}

        {!originSafe && (
          <div className="note warning">
            Links would point at <span className="mono">{origin}</span>, which nobody outside
            this machine can open. Set <span className="mono">VITE_PUBLIC_ORIGIN</span> before
            sending anything real.
          </div>
        )}

        {now.recipients.length === 0 && now.unreachable.length > 0 && (
          <div className="note warning">
            Nobody covered by this has an email address on file, so there is nothing to send.
            The signup form has never asked for one — add addresses on the Signups screen, or
            fix the form and import again.
          </div>
        )}

        {now.recipients.length === 0 && now.unreachable.length === 0 ? (
          <Empty>Nobody is on this selection.</Empty>
        ) : (
          <>
            <ul className="log-list">
              {page.rows.map((r) => (
                <li key={r.email} className="log-card">
                  <div className="log-top">
                    <span className="small">
                      <strong>{r.parentName || r.email}</strong>
                    </span>
                    <span className="small muted nowrap">{r.email}</span>
                  </div>
                  {r.youths.map((y) => (
                    <div key={y.person.id} className="small">
                      {/* Their own page, like every other list of people here — a name
                          that is not a way through to the person is a dead end. */}
                      <PersonLink person={y.person} />{' '}
                      {/* And their section. Two troops send from this screen, and a list of
                          bare first names gives no way to tell whose youth is whose. */}
                      <SectionPill section={y.person.section} />
                      <span className="muted">
                        {' — '}
                        {y.shifts.map((s) => `${s.day} ${s.slotLabel}`).join(', ')}
                      </span>
                      {!y.passUrl && (
                        // Worth naming: the email still goes, but with no link in it.
                        <span className="muted"> · no pass yet</span>
                      )}
                      {/* Which of them have already had this exact reminder, and when.
                          Before, the list looked the same whether it went out an hour ago
                          or never — and you only found out after pressing Review. */}
                      {sentThis.has(y.person.id) && (
                        <span className="muted"> · sent {when(sentThis.get(y.person.id)!)}</span>
                      )}
                    </div>
                  ))}
                </li>
              ))}
            </ul>

            {page.hidden > 0 && (
              <div className="row center" style={{ marginTop: '0.6rem' }}>
                <button onClick={() => setShown((n) => nextShown(n, now.recipients.length))}>
                  {moreLabel(page.hidden)}
                </button>
              </div>
            )}

            {now.unreachable.length > 0 && (
              <>
                <h3 className="small" style={{ marginBottom: '0.2rem' }}>
                  Cannot be emailed ({now.unreachable.length})
                </h3>
                <p className="small muted" style={{ marginTop: 0 }}>
                  No address on file — ring these instead.
                </p>
                <ul className="shift-list">
                  {now.unreachable.map((u) => (
                    <li key={u.person.id}>
                      <span className="small">
                        {/* Especially here: this list exists so somebody can be chased, and
                            their page is where a number gets added if there is none. */}
                        <PersonLink person={u.person} />{' '}
                        <SectionPill section={u.person.section} />
                        {u.phone ? (
                          <>
                            {' — '}
                            <a href={`tel:${u.phone}`}>{u.phone}</a>
                          </>
                        ) : (
                          <span className="muted"> — no phone either</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>

      {now.recipients.length > 0 && (
        <div className="card">
          <div className="row">
            <label style={{ flex: '1 1 16rem' }}>
              How to send
              <select
                value={channel}
                onChange={(e) => {
                  setChannel(e.target.value as SendChannel)
                  setConnectedAs('')
                }}
              >
                {CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                    {/* Still selectable, so the reason can be read once it is chosen. */}
                    {channelConfigured(c.id) ? '' : ' — not set up'}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="small muted" style={{ margin: '0.4rem 0 0' }}>
            {CHANNELS.find((c) => c.id === channel)!.note}
          </p>

          {/*
            Said before it is pressed, not after.

            Whether a mailbox has been set up is known from the build, so an unusable button
            does not have to be pressed to find that out — which is what it looked like:
            the refusal was correct and reported at the top of the page, out of sight.
          */}
          {needsMailbox && !configured && (
            <div className="note warning">
              This app has not been set up to send from Gmail yet —{' '}
              <span className="mono">{missingSetting(channel)}</span> is not set. Until it is,
              choose <strong>Download a file instead</strong>, which needs no setup.
            </div>
          )}

          {/*
            Connecting is offered here rather than left to happen mid-send.

            Not required, though: pressing send without it still asks. This is the way to
            find out *which* mailbox before eighteen emails leave it, which is a mistake
            worth one button.
          */}
          {needsMailbox && (
            <div className="row" style={{ marginTop: '0.5rem', gap: '0.6rem' }}>
              <button disabled={!configured} onClick={() => void connect()}>
                {connectedAs ? 'Use a different mailbox' : 'Choose the mailbox'}
              </button>
              <span className="small muted">
                {connectedAs ? `Sending as ${connectedAs}` : 'Not connected yet'}
              </span>
            </div>
          )}

          {/* Beside the button that caused it. */}
          {setupError && <div className="note error">{setupError}</div>}

          <div className="row end" style={{ marginTop: '0.8rem' }}>
            <button className="primary" disabled={!configured} onClick={openReview}>
              Review and send
            </button>
          </div>
        </div>
      )}

      {wording2 && (
        <WordingDialog
          template={wording2}
          context={context}
          onClose={() => setWording2(null)}
        />
      )}

      {history.length > 0 && (
        /*
          What has gone out, rather than only whether this one has.

          The ledger is one row per youth per wording per selection — the right shape for
          "has this one had it" and the wrong shape for "what have we sent". Grouped, it
          answers the question somebody actually arrives with: did the Saturday reminders go?
        */
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Already sent</h2>
          <ul className="log-list">
            {history.map((h) => (
              <li key={`${h.templateId}__${h.selectionKey}`} className="log-card">
                <div className="log-top">
                  <span className="small">
                    <strong>{labelOf(h.templateId)}</strong>
                    <span className="muted"> · {readSelection(h.selectionKey, slots)}</span>
                  </span>
                  <span className="small muted nowrap">{when(h.lastAt)}</span>
                </div>
                <div className="small muted">
                  {h.people} {h.people === 1 ? 'person' : 'people'}
                  {h.by && ` · by ${h.by}`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewing && (
        <ReviewDialog
          template={template}
          context={context}
          runs={runs}
          alreadyHad={alreadyHad}
          ledgerLoaded={!alreadyOut.loading}
          channel={channel}
          sending={sending}
          progress={progress}
          drift={drift}
          sendError={sendError}
          finished={finished}
          resendAnyway={resendAnyway}
          setResendAnyway={setResendAnyway}
          onSend={send}
          onClose={() => {
            setReviewing(false)
            setFinished(null)
            setDrift(null)
          }}
        />
      )}
    </>
  )
}

/**
 * Why the not-checked-in filter is where it is, when that is worth saying.
 *
 * Nothing at all when it is simply off, or when somebody has set it by hand — a note under
 * a control they just used reads as an argument with them.
 */
function filterNote(
  locked: boolean,
  chosen: Audience | null,
  fallback: Audience | undefined,
): string {
  if (locked) return 'Always on for this wording, which says they have not checked in.'
  if (chosen === null && fallback === 'notCheckedIn') {
    return 'On for this wording: anybody already checked in is already there — most often because they worked the hour before at the same shop.'
  }
  return ''
}

/** The wording's name, or its id if it is one this app no longer has. */
const labelOf = (templateId: string): string =>
  DEFAULT_TEMPLATES.find((t) => t.id === templateId)?.label ?? templateId

/**
 * What a stored selection key was about, in words.
 *
 * Read back rather than stored as a label: a slot renamed since the send should read as it
 * reads now, and a key naming a shift the event no longer has should still say something
 * rather than nothing.
 */
function readSelection(key: string, slots: { id: string; day: Day; label: string }[]): string {
  if (key === 'event') return 'the whole event'
  if (key.startsWith('day-')) {
    const day = key.slice(4) as Day
    return DAY_LABEL[day] ?? day
  }
  if (key.startsWith('slot-')) {
    const id = key.slice(5)
    const slot = slots.find((sl) => sl.id === id)
    return slot ? `${DAY_LABEL[slot.day]} ${slot.label}` : id
  }
  return key
}

/**
 * When something was sent, written the way somebody scanning a list reads one.
 *
 * The same shape the notifications mailbox uses: a time for today, a date for anything
 * older, because "8:05 AM" answers "was that this morning" and a full date does not.
 */
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

/**
 * "Saturday", or nothing at all for the whole event.
 *
 * The day, even when an hour is what was selected. The hour decides who is written to; it is
 * not a fact about any of them. Somebody down for nine till eleven, nudged about the nine
 * o'clock, got a subject line reading "Your Saturday 9:00 AM shift" over a message whose
 * own lines said nine till eleven — and the subject is the half a parent reads.
 *
 * It cannot be their span either: one message goes to everybody the selection reaches, and
 * they do not all work the same stretch. Their own times are in the block, per person.
 */
/**
 * The hour a send was chosen by, when one was.
 *
 * Everybody an hour reaches is on that hour, so naming it is true of all of them — as a
 * reason for the email arriving, which is all it is. What none of them may work is that hour
 * and no more, which is why it is never allowed to stand in for the times.
 */
function dueAtOf(
  selection: Selection,
  slots: { id: string; label: string }[],
): string {
  if (selection.kind !== 'slot') return ''
  return slots.find((s) => s.id === selection.slotId)?.label ?? ''
}

function occasionOf(
  selection: Selection,
  slots: { id: string; day: Day }[],
): string {
  if (selection.kind === 'day') return DAY_LABEL[selection.day]
  if (selection.kind === 'slot') {
    const slot = slots.find((s) => s.id === selection.slotId)
    return slot ? DAY_LABEL[slot.day] : ''
  }
  return ''
}

function ReviewDialog({
  template,
  context,
  runs,
  alreadyHad,
  ledgerLoaded,
  channel,
  sending,
  progress,
  drift,
  sendError,
  finished,
  resendAnyway,
  setResendAnyway,
  onSend,
  onClose,
}: {
  template: ReminderTemplate
  context: TemplateContext
  runs: { recipient: Recipient; youths: Recipient['youths'] }[]
  alreadyHad: number
  ledgerLoaded: boolean
  channel: SendChannel
  sending: boolean
  progress: string
  drift: string | null
  sendError: string | null
  finished: Finished | null
  resendAnyway: boolean
  setResendAnyway: (v: boolean) => void
  onSend: () => Promise<void>
  onClose: () => void
}): ReactNode {
  const first = runs[0]
  const count = runs.length

  return (
    <Modal
      title={finished ? 'Sent' : template.label}
      onClose={onClose}
      footer={
        finished ? (
          <button className="primary" onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button onClick={onClose} disabled={sending}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={sending || !ledgerLoaded || count === 0}
              onClick={() => void onSend()}
            >
              {sending
                ? `Sending ${progress}…`
                : channel === 'csv'
                  ? `Download ${count} ${count === 1 ? 'message' : 'messages'}`
                  : `Send to ${count} ${count === 1 ? 'address' : 'addresses'}`}
            </button>
          </>
        )
      }
    >
      <div className="stack">
        {/* The list changed under them: nothing has gone, and it needs another press. */}
        {drift && <div className="note warning">{drift}</div>}
        {/* In here, because a message rendered behind an open dialog is a message nobody
            reads — and this is the one that says why the send stopped. */}
        {sendError && <div className="note error">{sendError}</div>}

        {finished ? (
          <Result finished={finished} />
        ) : !ledgerLoaded ? (
          <Loading what="Checking what has already gone out" />
        ) : (
          <>
            {alreadyHad > 0 && (
              /*
                In front of the decision, not in the summary afterwards.

                Stopping the second click is the whole purpose of the record, and it cannot
                do that if it is only consulted once the click has happened.
              */
              <div className="note">
                {alreadyHad} {alreadyHad === 1 ? 'address has' : 'addresses have'} already
                had this reminder and{' '}
                {resendAnyway ? 'will be sent it again' : 'will be skipped'}.
                <label className="row" style={{ gap: '0.5rem', marginTop: '0.4rem' }}>
                  {/* Same toggle as the filter, and for the same reason — see there. */}
                  <input
                    type="checkbox"
                    className="switch"
                    style={{ marginTop: 0 }}
                    checked={resendAnyway}
                    onChange={(e) => setResendAnyway(e.target.checked)}
                  />
                  <span className="small" style={{ color: 'var(--text)' }}>
                    Send again to anybody who has already had this
                  </span>
                </label>
              </div>
            )}

            {count === 0 ? (
              <Empty>Everybody on this selection has already had this reminder.</Empty>
            ) : (
              <>
                <div>
                  <strong className="small">
                    Going to {count} {count === 1 ? 'address' : 'addresses'}
                  </strong>
                  <ul className="shift-list" style={{ maxHeight: '9rem', overflow: 'auto' }}>
                    {runs.map(({ recipient, youths }) => (
                      <li key={recipient.email}>
                        <span className="small">
                          {recipient.email}
                          <span className="muted">
                            {' — '}
                            {youths.map((y) => y.person.firstName).join(', ')}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <strong className="small">
                    The message, as {first!.recipient.parentName || first!.recipient.email} will
                    get it
                  </strong>
                  <div className="small muted">
                    Subject:{' '}
                    {fillTemplate(
                      template.subject,
                      { ...first!.recipient, youths: first!.youths },
                      context,
                    )}
                  </div>
                  {/* Bounded, or a long body makes a dialog taller than the window. */}
                  <pre
                    className="small"
                    style={{
                      whiteSpace: 'pre-wrap',
                      margin: '0.4rem 0 0',
                      maxHeight: '14rem',
                      overflow: 'auto',
                    }}
                  >
                    {fillTemplate(
                      template.body,
                      { ...first!.recipient, youths: first!.youths },
                      context,
                    )}
                  </pre>
                  <p className="small muted" style={{ marginBottom: 0 }}>
                    Everybody else gets the same, with their own name, shifts and links.
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function Result({ finished }: { finished: Finished }): ReactNode {
  const sent = finished.outcomes.filter((o) => o.ok)
  const failed = finished.outcomes.filter((o) => !o.ok)
  const unrecorded = sent.filter((o) => o.error)

  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        {finished.channel === 'csv'
          ? `${sent.length} ${sent.length === 1 ? 'message' : 'messages'} written to the file.`
          : `${sent.length} sent.`}
        {finished.skipped > 0 && ` ${finished.skipped} skipped, already sent this.`}
        {failed.length > 0 && ` ${failed.length} failed.`}
      </p>

      {failed.length > 0 && (
        <div>
          <strong className="small">Did not send</strong>
          <ul className="shift-list">
            {failed.map((o) => (
              <li key={o.to}>
                <span className="small">
                  {o.to} <span className="muted">— {o.error}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Sending again will skip everybody who already had it, so only these go out.
          </p>
        </div>
      )}

      {unrecorded.length > 0 && (
        <div className="note warning">
          {unrecorded.length} went out but could not be written down, so sending again would
          send those a second time.
        </div>
      )}
    </div>
  )
}

/**
 * Rewording a reminder.
 *
 * The wording is the group's, not the app's — but the shape of it is not negotiable: a
 * message without `{{shifts}}` carries neither the times nor a link to their own page, so it
 * tells a parent nothing. That is the one thing this refuses to save.
 *
 * Nothing here can name a location. There is no placeholder for one, which is what makes
 * the rule hold however the wording is changed.
 */
function WordingDialog({
  template,
  context,
  onClose,
}: {
  template: ReminderTemplate
  context: TemplateContext
  onClose: () => void
}): ReactNode {
  /*
    Always the example, never somebody real.

    A real recipient is an arbitrary sample of one — the first address alphabetically — so
    the preview would change with the selection and might show the dullest case there is.
    The example is built to show what an edit is most likely to break: two children, joined
    names, a labelled block and a link each.
  */
  const sample = exampleRecipient()
  const [draft, setDraft] = useState<TemplateText>({
    subject: template.subject,
    body: template.body,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const problem = templateProblem(draft)
  const changed = draft.subject !== template.subject || draft.body !== template.body

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await saveReminderTemplate(template.id, draft, template.label)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const reset = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await resetReminderTemplate(template.id, template.label)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Wording: ${template.label}`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {isEdited(template) && (
            <button className="danger" disabled={busy} onClick={() => void reset()}>
              Back to the default
            </button>
          )}
          <button
            className="primary"
            disabled={busy || !changed || problem !== null}
            onClick={() => void save()}
          >
            {busy ? 'Saving…' : 'Save wording'}
          </button>
        </>
      }
    >
      <div className="stack">
        {error && <div className="note error">{error}</div>}

        {/*
          Said before the typing, not discovered after the saving.

          The wording is shared: one record, no event against it, used by every organizer in
          every year until somebody puts it back. Nothing in the dialog would otherwise
          suggest that — an editor opened from a screen that is otherwise all about this
          Saturday reads as though it belongs to this Saturday.
        */}
        <p className="small muted" style={{ margin: 0 }}>
          This is the wording everybody sends, in every year — not just this reminder. It
          keeps until somebody puts it back to the default.
        </p>

        <label>
          Subject
          <input
            value={draft.subject}
            onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
          />
        </label>

        <label>
          Message
          <textarea
            rows={10}
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem' }}
          />
        </label>

        {/*
          Chips rather than six bullets.

          The reference was taller than the field it described, which would push the preview
          off the bottom of a dialog whose point is now that both are visible at once. The
          description moved to a tooltip; the token is the part worth reading.
        */}
        <div className="row" style={{ gap: '0.3rem' }}>
          <span className="small muted">Fills in:</span>
          {PLACEHOLDERS.map((ph) => (
            <span key={ph.token} className="pill mono" title={ph.describes}>
              {`{{${ph.token}}}`}
            </span>
          ))}
        </div>

        {/*
          Refused rather than warned about. A saved wording is what everybody sends after
          this, so the one rule that makes a message useful is not a suggestion.
        */}
        {problem && <div className="note warning">{problem}</div>}

        {/*
          Under the fields, and live.

          Beside them would mean two panes of about three hundred pixels in a dialog forty-
          four rems wide, and the message is plain text whose line breaks matter — the editor
          would wrap at a width the real email never uses. Behind a tab would mean typing,
          switching, looking and switching back, which is the opposite of what a preview is
          for.
        */}
        <div>
          <strong className="small">How it will read</strong>
          <p className="small muted" style={{ margin: '0.1rem 0 0' }}>
            An example, with a parent who has two children on the list — everybody gets their
            own names, shifts and links.
          </p>
          <div className="small muted" style={{ marginTop: '0.3rem' }}>
            Subject: {fillTemplate(draft.subject, sample, context)}
          </div>
          <pre
            className="small"
            style={{
              whiteSpace: 'pre-wrap',
              margin: '0.3rem 0 0',
              padding: '0.5rem 0.6rem',
              background: 'var(--surface-2)',
              borderRadius: 'var(--radius)',
              maxHeight: '13rem',
              overflow: 'auto',
            }}
          >
            {fillTemplate(draft.body, sample, context)}
          </pre>
        </div>
      </div>
    </Modal>
  )
}
