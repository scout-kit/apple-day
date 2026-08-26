import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  detectMapping,
  missingRequiredColumns,
  planImport,
  sectionCounts,
} from '../domain/importer'
import type { ColumnMapping, FieldName, ImportPlan, ImportProblem } from '../domain/importer'
import { DAY_LABEL } from '../domain/slots'
import { DAYS } from '../domain/types'
import { parseCsv, readFileAsText } from '../lib/csv'
import type { ParsedCsv } from '../lib/csv'
import { useEvent } from '../lib/eventContext'
import { useSections } from '../lib/sections'
import { applyImport, usePeople, useSignups } from '../lib/repo'
import { ErrorNote, Loading, SectionPill } from './Bits'
import { SignupFormCard } from './SignupFormCard'

const FIELD_LABELS: [FieldName, string, boolean][] = [
  ['youthName', 'Youth name', true],
  ['section', 'Section', true],
  ['parentName', 'Parent name', false],
  ['parentEmail', 'Parent email', false],
  ['parentPhone', 'Parent phone', false],
  ['attending', 'Parent attending', false],
  ['pairWith', 'Pair with', false],
  ['timestamp', 'Timestamp', false],
  ['notes', 'Notes', false],
]

function describeProblem(problem: ImportProblem): string {
  switch (problem.kind) {
    case 'missingName':
      return `Row ${problem.row}: has data but no youth name — skipped.`
    case 'unknownSection':
      return `Row ${problem.row}: "${problem.value}" is not a section I recognise — skipped.`
    case 'unparseableSlot':
      return `Row ${problem.row}: could not read the ${problem.day === 'fri' ? 'Friday' : 'Saturday'} time "${problem.detail.input}" (${problem.detail.reason}).`
    case 'noAvailability':
      return `Row ${problem.row}: ${problem.name} offered no times at all.`
    case 'supersededDuplicate':
      return `Row ${problem.row}: an earlier submission from ${problem.name}; keeping row ${problem.keptRow}.`
    case 'unresolvedPairHint':
      return `Row ${problem.row}: ${problem.name} asked to be paired with "${problem.hint}" — could not match that to one person, so set it on the board.`
  }
}

/**
 * Google Form CSV import.
 *
 * Intake stays on the form the families already know, so this screen is the seam. Two
 * things it will not do: guess at a column mapping without showing you, and drop a row
 * quietly. Everything it could not understand is listed before you commit, because the
 * spreadsheet's `COUNTIFS` wildcards silently ignored anything they could not match and
 * availability went missing without anyone noticing.
 */
export function ImportScreen(): ReactNode {
  const { event, slots } = useEvent()
  const { sections } = useSections()
  const eventDays = useMemo(
    () => DAYS.filter((d) => slots.some((s) => s.day === d)),
    [slots],
  )
  const people = usePeople()
  const signups = useSignups()

  const [csv, setCsv] = useState<ParsedCsv | null>(null)
  const [filename, setFilename] = useState('')
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const missing = useMemo(() => missingRequiredColumns(mapping), [mapping])

  const plan: ImportPlan | null = useMemo(() => {
    if (!csv || missing.length > 0) return null
    return planImport(csv.rows, {
      mapping,
      existingPeople: people.data,
      existingSignups: signups.data,
      importedAt: Date.now(),
      // So a group's own section names and aliases are what the import matches against.
      sections,
      // Times resolve against this year's own hours and its own shift shape — not a fixed
      // window and not hourly shifts on the hour.
      ...(event ? { schedule: event.schedule, shape: event } : {}),
    })
  }, [csv, mapping, missing, people.data, signups.data, event, sections])

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setError(null)
    setResult(null)
    try {
      const text = await readFileAsText(file)
      const parsed = parseCsv(text)
      setCsv(parsed)
      setFilename(file.name)
      setMapping(detectMapping(parsed.headers, eventDays))
    } catch (e) {
      setError(e as Error)
    }
  }

  const apply = async (): Promise<void> => {
    if (!plan || !event) return
    setApplying(true)
    setError(null)
    try {
      const { written } = await applyImport(
        event.id,
        [...plan.newPeople, ...plan.updatedPeople],
        plan.signups,
      )
      setResult(
        `Imported ${plan.newPeople.length} new ${plan.newPeople.length === 1 ? 'person' : 'people'}, ` +
          `updated ${plan.updatedPeople.length}, and recorded ${plan.signups.length} signups (${written} writes).`,
      )
    } catch (e) {
      setError(e as Error)
    } finally {
      setApplying(false)
    }
  }

  if (people.loading) return <Loading what="Loading the roster" />

  return (
    <>
      <ErrorNote error={error ?? people.error} />

      {/*
        Making the form comes before reading one back, and they are two ends of the same
        job — so they sit on the same screen, in that order.
      */}
      {event && <SignupFormCard event={event} sections={sections} />}

      <div className="card">
        <h1>Import signups</h1>
        <p className="muted small">
          Export the Google Form responses as CSV (in Sheets: File → Download → Comma
          separated values) and drop the file here. Importing the same file twice is safe —
          people are matched on name and section, not appended.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        {filename && (
          <p className="small muted">
            {filename} — {csv?.rows.length ?? 0} rows, {csv?.headers.length ?? 0} columns
          </p>
        )}
        {csv?.errors.length ? (
          <div className="note warning">
            <strong>The CSV itself had {csv.errors.length} problem(s)</strong>
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
              {csv.errors.slice(0, 5).map((e, i) => (
                <li key={i} className="small">{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {csv && (
        <div className="card">
          <h2>Which column is which?</h2>
          <p className="small muted">
            Guessed from the headers. The form's layout has changed every year, so check it.
          </p>
          <div className="table-wrap">
            <table>
              <tbody>
                {FIELD_LABELS.map(([field, label, required]) => (
                  <tr key={field}>
                    <td style={{ width: '14rem' }}>
                      {label}
                      {required && <span style={{ color: 'var(--bad)' }}> *</span>}
                    </td>
                    <td>
                      <select
                        value={mapping[field] ?? ''}
                        onChange={(e) =>
                          setMapping((m) => {
                            const next = { ...m }
                            if (e.target.value) next[field] = e.target.value
                            else delete next[field]
                            return next
                          })
                        }
                      >
                        <option value="">— not in this file —</option>
                        {csv.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
                {eventDays.map((day) => (
                  <tr key={day}>
                    <td style={{ width: '14rem' }}>{DAY_LABEL[day]} availability</td>
                    <td>
                      <select
                        value={mapping.days?.[day] ?? ''}
                        onChange={(e) =>
                          setMapping((m) => {
                            const days = { ...(m.days ?? {}) }
                            if (e.target.value) days[day] = e.target.value
                            else delete days[day]
                            return { ...m, days }
                          })
                        }
                      >
                        <option value="">— not in this file —</option>
                        {csv.headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {missing.length > 0 && (
            <div className="note error">
              Cannot import without {missing.join(' and ')}.
            </div>
          )}
          {mapping.parentEmail === undefined && mapping.parentPhone === undefined && (
            <div className="note warning">
              This file has no email or phone column. That is the gap the 2025 review
              flagged — without contact details there is no way to reach someone who does
              not turn up for their shift. Worth adding both as required questions on the
              form before the next send.
            </div>
          )}
        </div>
      )}

      {plan && (
        <>
          <div className="card">
            <h2>What this will do</h2>
            <div className="stats">
              <div className="stat">
                <div className="value">{plan.stats.rowsAccepted}</div>
                <div className="label">rows accepted</div>
              </div>
              <div className="stat">
                <div className="value">{plan.newPeople.length}</div>
                <div className="label">new people</div>
              </div>
              <div className="stat">
                <div className="value">{plan.updatedPeople.length}</div>
                <div className="label">updated</div>
              </div>
              <div className="stat">
                <div className="value">{plan.stats.peopleMatched}</div>
                <div className="label">already known</div>
              </div>
            </div>

            {plan.stats.noOp ? (
              <div className="note good">
                Nothing to do — this file matches what is already stored.
              </div>
            ) : (
              <div className="row" style={{ marginTop: '0.75rem' }}>
                <button className="primary" disabled={applying} onClick={() => void apply()}>
                  {applying ? 'Importing…' : 'Import'}
                </button>
              </div>
            )}
            {result && <div className="note good">{result}</div>}
          </div>

          {plan.problems.length > 0 && (
            <div className="card">
              <h2>{plan.problems.length} thing{plan.problems.length === 1 ? '' : 's'} to look at</h2>
              <p className="small muted">
                None of these stop the import. Nothing is discarded without appearing here.
              </p>
              <ul style={{ paddingLeft: '1.1rem' }}>
                {plan.problems.map((problem, i) => (
                  <li key={i} className="small">
                    {describeProblem(problem)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.newPeople.length > 0 && (
            <div className="card">
              <h2>New people</h2>
              <div className="small muted" style={{ marginBottom: '0.5rem' }}>
                {Object.entries(sectionCounts(plan.newPeople))
                  .filter(([, n]) => n > 0)
                  .map(([s, n]) => `${n} ${s}`)
                  .join(' · ')}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Section</th>
                      <th>Parent</th>
                      <th>Contact</th>
                      {eventDays.map((d) => (
                        <th key={d} className="right">
                          {DAY_LABEL[d].slice(0, 3)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plan.newPeople.map((person) => {
                      const signup = plan.signups.find((s) => s.personId === person.id)
                      return (
                        <tr key={person.id}>
                          <td>
                            {person.firstName} {person.lastName}
                            {person.pairWithPersonId && (
                              <span className="small muted"> · paired</span>
                            )}
                          </td>
                          <td>
                            <SectionPill section={person.section} />
                          </td>
                          <td className="small">{person.parentName || '—'}</td>
                          <td className="small">
                            {person.parentEmail || person.parentPhone ? (
                              <>
                                {person.parentEmail}
                                {person.parentEmail && person.parentPhone ? ' · ' : ''}
                                {person.parentPhone}
                              </>
                            ) : (
                              <span style={{ color: 'var(--warn)' }}>none</span>
                            )}
                          </td>
                          {eventDays.map((d) => (
                            <td key={d} className="right">
                              {signup?.availability[d]?.length ?? 0}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  )
}
