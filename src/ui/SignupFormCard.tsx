import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  buildSignupForm,
  describeSpec,
  formProblems,
  shiftSnapshot,
  staleFormWarning,
} from '../domain/signupForm'
import type { AppleDayEvent } from '../domain/types'
import type { SectionDef } from '../domain/sections'
import { GOOGLE_CLIENT_ID } from '../lib/mail/config'
import { connect, createForm } from '../lib/googleForms'
import type { CreatedForm } from '../lib/googleForms'
import { CopyButton } from './Bits'

/**
 * Building the form families fill in, from the event that will read it back.
 *
 * The form and the import are two ends of one job, which is why this sits above the import
 * rather than on a screen of its own. Both halves come from `domain/signupForm`: the button
 * that creates it through Google's API and the list somebody copies by hand describe the
 * same form, so the two cannot drift apart.
 *
 * The paste route is always offered. Creating it outright needs the Forms API enabled and a
 * scope added in the Google Cloud console, and a group should not have to touch any of that
 * to run an Apple Day.
 */
export function SignupFormCard({
  event,
  sections,
}: {
  event: AppleDayEvent
  sections: SectionDef[]
}): ReactNode {
  const [showing, setShowing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<CreatedForm | null>(null)
  const [error, setError] = useState<string | null>(null)

  /*
    What the form offered when it was built, kept so it can be checked against the event.

    The whole round trip rests on the options being this event's own shift labels. Change
    the hours afterwards and the form goes on offering times that no longer exist — families
    tick them, the import cannot resolve them, and the availability goes quietly missing.
  */
  const [builtWith, setBuiltWith] = useState<ReturnType<typeof shiftSnapshot> | null>(null)

  const spec = useMemo(() => buildSignupForm(event, sections), [event, sections])
  const problems = useMemo(() => formProblems(spec, event), [spec, event])
  const stale = builtWith ? staleFormWarning(builtWith, event) : null

  const canCreate = GOOGLE_CLIENT_ID !== ''

  const make = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await connect(GOOGLE_CLIENT_ID)
      const form = await createForm(spec)
      setMade(form)
      setBuiltWith(shiftSnapshot(event))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong>The signup form</strong>
          <p className="small muted" style={{ margin: '0.15rem 0 0' }}>
            Built from this event&apos;s days and shift times, and worded so the import reads
            it without being told which column is which.
          </p>
        </div>
      </div>

      {problems.length > 0 ? (
        <div className="note warning" style={{ marginTop: '0.6rem' }}>
          {problems.map((problem) => (
            <div key={problem}>{problem}</div>
          ))}
        </div>
      ) : (
        <>
          <div className="row" style={{ gap: '0.4rem', marginTop: '0.7rem' }}>
            {canCreate && (
              <button className="primary" disabled={busy} onClick={() => void make()}>
                {busy ? 'Building…' : 'Create it in Google Forms'}
              </button>
            )}
            <button onClick={() => setShowing(!showing)} aria-expanded={showing}>
              {showing ? 'Hide the questions' : 'Show me the questions'}
            </button>
          </div>

          {!canCreate && (
            <p className="small muted" style={{ marginTop: '0.5rem' }}>
              {/* Said plainly rather than hiding the reason: this is a one-off job in the
                  Google Cloud console, and knowing that is what makes it doable. */}
              Creating it outright needs the Google Forms API enabled and a client id set.
              Until then the questions below build the same form by hand.
            </p>
          )}
        </>
      )}

      {error && <div className="note error" style={{ marginTop: '0.6rem' }}>{error}</div>}

      {stale && <div className="note warning" style={{ marginTop: '0.6rem' }}>{stale}</div>}

      {made && !stale && (
        <div className="note info" style={{ marginTop: '0.6rem' }}>
          <p style={{ margin: 0 }}>
            Made. Send families the{' '}
            <a href={made.responderUri} target="_blank" rel="noreferrer">
              form link
            </a>
            , and{' '}
            <a href={made.editUri} target="_blank" rel="noreferrer">
              open it here
            </a>{' '}
            to change the wording or read the responses.
          </p>
          <p className="small muted" style={{ margin: '0.35rem 0 0' }}>
            When they are in, export the responses as CSV and bring the file back to this
            screen. Leave the question titles alone and the columns map themselves.
          </p>
        </div>
      )}

      {showing && (
        <div className="stack" style={{ marginTop: '0.7rem' }}>
          <div className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
            <CopyButton text={describeSpec(spec)} label="Copy all of it" />
            <span className="small muted">
              Titles have to match exactly — they are what the import matches on.
            </span>
          </div>

          <ol className="stack form-spec">
            {spec.questions.map((question) => (
              <li key={question.title}>
                <strong>{question.title}</strong>
                {question.required && <span className="pill small"> required</span>}
                <div className="small muted">{KIND_LABEL[question.kind]}</div>
                {question.help && <div className="small muted">{question.help}</div>}
                {question.options && (
                  <ul className="small">
                    {question.options.map((option) => (
                      <li key={option}>{option}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}

const KIND_LABEL: Record<string, string> = {
  text: 'Short answer',
  longText: 'Paragraph',
  choice: 'Multiple choice',
  checkboxes: 'Checkboxes',
}
