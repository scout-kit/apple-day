import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { fullName, isNumbered } from '../domain/types'
import type { Jar, Person } from '../domain/types'
import { jarNumberFromScan } from '../lib/qr'
import { Modal } from './Modal'
import { QrScanner } from './QrScanner'

/**
 * Hand a jar to someone as they head out.
 *
 * Typed or scanned — the label carries the jar's number, so scanning is the fast path when
 * a queue of youth is waiting at the table. The number is checked against what is already
 * out before anything is written, because two jars with the same number on the same day is
 * exactly the mess this app exists to prevent.
 */
export function IssueJarDialog({
  person,
  locationName,
  slotLabel,
  jarsOut,
  suggestedNumber,
  onIssue,
  onClose,
}: {
  person: Person
  locationName: string
  slotLabel: string
  /** Jars already out today, for the clash check and the summary. */
  jarsOut: Jar[]
  suggestedNumber: number
  onIssue: (jarNumber: number) => void
  onClose: () => void
}): ReactNode {
  const [value, setValue] = useState(String(suggestedNumber))
  const [scanning, setScanning] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const number = Number(value)
  const valid = Number.isInteger(number) && number > 0

  /** Only numbered jars can clash; money recorded without one has no number to reuse. */
  const numbered = useMemo(() => jarsOut.filter(isNumbered), [jarsOut])
  const clash = useMemo(
    () => (valid ? numbered.find((j) => j.jarNumber === number) : undefined),
    [numbered, number, valid],
  )

  const submit = (): void => {
    if (!valid) {
      setNote('Enter the number printed on the jar.')
      return
    }
    if (clash) {
      setNote(`Jar ${number} is already out. Count it in before sending it out again.`)
      return
    }
    onIssue(number)
  }

  const onScan = (scanned: string): void => {
    setScanning(false)
    const parsed = jarNumberFromScan(scanned)
    if (parsed === null) {
      setNote(`That code is not a jar label: ${scanned.slice(0, 40)}`)
      return
    }
    setValue(String(parsed))
    setNote(null)
    // Scanning is the whole point of the label — no second confirmation step.
    if (!numbered.some((j) => j.jarNumber === parsed)) onIssue(parsed)
    else setNote(`Jar ${parsed} is already out. Count it in before sending it out again.`)
  }

  return (
    <Modal
      title={`Send ${fullName(person)} out`}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!valid || clash !== undefined} onClick={submit}>
            Issue jar {valid ? number : ''}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">
          {locationName} · {slotLabel}. Issuing the jar marks them as out collecting.
        </p>

        {scanning ? (
          <QrScanner onDetected={onScan} onClose={() => setScanning(false)} />
        ) : (
          <div className="row">
            <label style={{ flex: '1 1 8rem' }}>
              Jar number
              <input
                ref={inputRef}
                type="number"
                min="1"
                inputMode="numeric"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value)
                  setNote(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
            </label>
            <button style={{ alignSelf: 'end' }} onClick={() => setScanning(true)}>
              Scan label
            </button>
          </div>
        )}

        {clash && (
          <div className="note error">
            Jar {number} is already out with someone. Pick another, or count that one in
            first.
          </div>
        )}
        {note && !clash && <div className="note warning">{note}</div>}

        <p className="small muted">
          A jar that has been counted in can go straight back out.{' '}
          {numbered.length} jar{numbered.length === 1 ? '' : 's'} out at the moment
          {numbered.length > 0 &&
            `: ${numbered
              .map((j) => j.jarNumber)
              .sort((a, b) => a - b)
              .join(', ')}`}
          .
        </p>
      </div>
    </Modal>
  )
}
