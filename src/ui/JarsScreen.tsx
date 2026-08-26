import { useMemo, useState } from 'react'
import { useUrlState } from '../lib/urlState'
import type { ReactNode } from 'react'
import { isCounted, isNumbered } from '../domain/types'
import { DAY_LABEL } from '../domain/slots'
import { todaysEventDay } from '../domain/today'
import { DAYS, fullName } from '../domain/types'
import type { Day, Jar, PaymentMethod } from '../domain/types'
import { sharesShiftWith } from '../domain/jars'
import { useEvent } from '../lib/eventContext'
import { jarNumberFromScan } from '../lib/qr'
import {
  countJar,
  deleteJar,
  recordMoney,
  reopenJar,
  unissueJar,
  useJars,
  useLocations,
  usePeople,
} from '../lib/repo'
import { useSession } from '../lib/session'
import { ErrorNote, Loading, Money, Stat } from './Bits'
import { JarLabels } from './JarLabels'
import { LocationLink } from './LocationLink'
import { PersonLink } from './PersonLink'
import { Modal } from './Modal'
import { LocationField, PersonField } from './PickerField'
import { QrScanner } from './QrScanner'
import { RequestsInbox } from './RequestsInbox'

/**
 * Counting jars back in.
 *
 * Jars go out from the day-of screen, carrying who took them and where they went, so the
 * usual path is short: scan the label, type the total, done. Nothing has to be retyped —
 * which is the fix for the workbook's jar sheet, where the location and the youth were
 * written again at counting time from memory and no two rows spelled a name the same way.
 *
 * Everything is still editable here, pre-filled with what the jar already says. A jar
 * arriving at the table knows where it has been *usually*; it does not know that somebody
 * grabbed the wrong one, or that the money was recorded against the wrong shop. Correcting
 * that used to mean deleting the record and entering it again, which loses the audit trail
 * for the sake of a typo.
 */
export function JarsScreen(): ReactNode {
  const { user, role } = useSession()
  const { event, slots } = useEvent()
  const locations = useLocations()
  const people = usePeople()
  const jars = useJars()

  /*
    Null until somebody picks a day, so the default can follow the date.

    Hardcoding 'fri' meant the first thing anybody did on Saturday morning was reach for the
    day switch — a wrong screen shown to somebody in a hurry on the busiest morning of the
    year. A choice, once made, sticks: the organizer looking at Friday's numbers on the
    Saturday is not second-guessed.
  */
  const [dayParam, setDayParam] = useUrlState('day')
  const selectedDay = (dayParam || null) as Day | null
  const setSelectedDay = (d: Day | null): void => setDayParam(d ?? '')
  const eventDays = useMemo(
    () => DAYS.filter((d) => slots.some((s) => s.day === d)),
    [slots],
  )
  /** Today, when today is a day of this event; otherwise the first day it runs. */
  const defaultDay = useMemo(
    () => (event ? todaysEventDay(event, new Date()) : null),
    [event],
  )
  const day =
    selectedDay && eventDays.includes(selectedDay)
      ? selectedDay
      : (defaultDay ?? eventDays[0] ?? 'sat')

  const [counting, setCounting] = useState<Jar | null>(null)
  /*
    The rest of what a jar says, editable while it is being counted.

    Counting used to take an amount and a method only, so correcting a jar that had been
    written against the wrong shop meant deleting the record and typing it in again.
  */
  const [countLocation, setCountLocation] = useState('')
  const [countPerson, setCountPerson] = useState('')
  const [countNote, setCountNote] = useState('')
  /*
    A search over what has been counted.

    Sixty jars by the end of a Saturday, newest first. Finding the one somebody is asking
    about — by its number, by the shop, or by whose it was — meant reading down the whole
    list, which is the moment a busy table gives up and writes it on paper instead.
  */
  const [countedSearch, setCountedSearch] = useUrlState('find')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [scanning, setScanning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  /** A counted jar awaiting confirmation, and what is about to happen to it. */
  const [confirming, setConfirming] = useState<{
    jar: Jar
    action: 'delete' | 'reopen'
  } | null>(null)
  const [manual, setManual] = useState<{
    locationId: string
    personId: string
    jarNumber: string
    amount: string
    method: PaymentMethod
    note: string
  } | null>(null)

  const personById = useMemo(
    () => new Map(people.data.map((p) => [p.id, p])),
    [people.data],
  )
  const locationById = useMemo(
    () => new Map(locations.data.map((l) => [l.id, l])),
    [locations.data],
  )

  const dayJars = useMemo(() => jars.data.filter((j) => j.day === day), [jars.data, day])
  const out = useMemo(
    () =>
      dayJars
        .filter((j) => j.status === 'out')
        .sort((a, b) => (a.jarNumber ?? 0) - (b.jarNumber ?? 0)),
    [dayJars],
  )
  const counted = useMemo(
    () => dayJars.filter(isCounted).sort((a, b) => b.countedAt - a.countedAt),
    [dayJars],
  )

  const dayTotal = useMemo(
    () => Math.round(counted.reduce((sum, j) => sum + j.amount, 0) * 100) / 100,
    [counted],
  )

  /**
   * Which trip this record is, when a jar went out more than once.
   *
   * Two rows both labelled "jar 7" are indistinguishable otherwise, and telling them apart
   * is the whole point of recording the trips separately.
   */
  const tripLabel = (jar: Jar): string => {
    if (!isNumbered(jar)) return ''
    const trips = dayJars
      .filter((j) => j.jarNumber === jar.jarNumber)
      .sort((a, b) => a.issuedAt - b.issuedAt || a.countedAt - b.countedAt)
    if (trips.length < 2) return ''
    return `· trip ${trips.findIndex((j) => j.id === jar.id) + 1} of ${trips.length}`
  }

  const locationName = (jar: Jar): string =>
    locationById.get(jar.locationId)?.name ?? jar.locationId

  const personName = (jar: Jar): string | null => {
    const who = jar.personId ? personById.get(jar.personId) : null
    return who ? fullName(who) : null
  }

  /** Both at once, for the places that are describing a jar in a sentence. */
  /**
   * The counted jars a search is asking for.
   *
   * Matched on the jar number, the location and the person — every word has to appear
   * somewhere, so "12 sob" finds jar 12 at Braemar, the same way the pickers behave.
   */
  const countedShown = useMemo(() => {
    const terms = countedSearch.toLowerCase().split(/\s+/).filter(Boolean)
    if (terms.length === 0) return counted
    return counted.filter((jar) => {
      const haystack = [
        isNumbered(jar) ? String(jar.jarNumber) : 'no jar',
        locationName(jar),
        personName(jar) ?? '',
        jar.note,
      ]
        .join(' ')
        .toLowerCase()
      return terms.every((term) => haystack.includes(term))
    })
  }, [counted, countedSearch, locationById, personById])

  const describe = (jar: Jar): string => {
    const who = personName(jar)
    return `${locationName(jar)}${who ? ` · ${who}` : ''}`
  }

  const doDelete = (jar: Jar): void => {
    if (!event) return
    setConfirming(null)
    void deleteJar(event.id, jar).catch((error: Error) => setMessage(error.message))
  }

  const doReopen = (jar: Jar): void => {
    if (!event) return
    setConfirming(null)
    void reopenJar(event.id, jar).catch((error: Error) => setMessage(error.message))
  }

  /**
   * Whether this is the only jar still out against its shift.
   *
   * Both counting in and taking back need it: the shift comes back only when the last jar
   * does. Somebody who went out with three and has handed in one is still out.
   */
  const isTheirLastJar = (jar: Jar): boolean =>
    // Any jar still out against *any* shift of the same stretch counts: consecutive hours
    // at one location are one trip, so a second jar handed over for the later hour means
    // they are still out there.
    jars.data.filter(
      (j) => j.status === 'out' && j.id !== jar.id && sharesShiftWith(j, jar),
    ).length === 0

  /** Undo an issue. The shift reverts only if this was their last jar. */
  const takeBack = (jar: Jar): void => {
    if (!event) return
    setMessage(null)
    void unissueJar(event.id, jar, isTheirLastJar(jar)).catch((error: Error) =>
      setMessage(`Could not take jar ${jar.jarNumber} back: ${error.message}`),
    )
    if (counting?.id === jar.id) setCounting(null)
  }

  /**
   * Record money by hand.
   *
   * Covers a jar that went out without being issued, and money that never went through one:
   * bushel sales at a location, a donation, a card tap away from the table. A jar number is
   * optional — without one the money is still attributed to the location, which is what
   * matters for the ranking.
   */
  const submitManual = (): void => {
    if (!event || !manual) return

    const value = Number(manual.amount)
    if (!manual.locationId) {
      setMessage('Pick a location.')
      return
    }
    if (!Number.isFinite(value) || value < 0) {
      setMessage('That amount does not look right.')
      return
    }

    const typedNumber = manual.jarNumber.trim()
    let jarNumber: number | null = null
    if (typedNumber) {
      const parsed = Number(typedNumber)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setMessage('A jar number has to be a whole number, or left blank.')
        return
      }
      // Only a jar that is out right now is a conflict. An earlier trip that has been
      // counted is history, and the same jar going out again is the normal course of a day.
      if (dayJars.some((j) => j.jarNumber === parsed && j.status === 'out')) {
        setMessage(`Jar ${parsed} is out with somebody. Count it in first.`)
        return
      }
      jarNumber = parsed
    }

    void recordMoney(
      event.id,
      {
        jarNumber,
        day,
        locationId: manual.locationId,
        personId: manual.personId || null,
        amount: Math.round(value * 100) / 100,
        method: manual.method,
        note: manual.note.trim(),
      },
      user?.uid ?? 'unknown',
    ).catch((error: Error) => setMessage(`Could not record that: ${error.message}`))

    setMessage(
      jarNumber === null
        ? 'Money recorded.'
        : `Jar ${jarNumber} recorded.`,
    )
    setManual(null)
  }

  const startCounting = (jar: Jar): void => {
    setCounting(jar)
    setAmount(jar.amount === null ? '' : String(jar.amount))
    setMethod(jar.method)
    setCountLocation(jar.locationId)
    setCountPerson(jar.personId ?? '')
    setCountNote(jar.note)
    setMessage(null)
  }

  const submit = (): void => {
    if (!event || !counting) return
    const value = Number(amount)
    if (!Number.isFinite(value) || value < 0) {
      setMessage('That amount does not look right.')
      return
    }

    const jar = counting
    // Fired without waiting: the local cache applies it at once, and a `setDoc` promise
    // stays pending for as long as the connection is down — which at base ops is normal.
    void countJar(
      event.id,
      jar,
      {
        amount: Math.round(value * 100) / 100,
        method,
        locationId: countLocation,
        personId: countPerson || null,
        note: countNote,
      },
      user?.uid ?? 'unknown',
      isTheirLastJar(jar),
    ).catch((error: Error) => setMessage(`Jar ${jar.jarNumber} failed to save: ${error.message}`))

    setMessage(`Jar ${jar.jarNumber} counted.`)
    setCounting(null)
    setAmount('')
  }

  const onScan = (scanned: string): void => {
    setScanning(false)
    const number = jarNumberFromScan(scanned)
    if (number === null) {
      setMessage(`That code is not a jar label: ${scanned.slice(0, 40)}`)
      return
    }

    // The trip currently out, not any earlier one: a jar can go out several times a day, so
    // matching on the number alone would reopen a trip that was already counted and closed.
    const outNow = dayJars.find((j) => j.jarNumber === number && j.status === 'out')
    if (outNow) {
      startCounting(outNow)
      return
    }

    const trips = dayJars.filter((j) => j.jarNumber === number)
    setMessage(
      trips.length === 0
        ? `Jar ${number} has not been issued ${DAY_LABEL[day].toLowerCase()}. Issue it on the Day of screen, or record the money by hand.`
        : `Jar ${number} is not out — its ${
            trips.length === 1 ? 'trip has' : `${trips.length} trips have`
          } been counted. Issue it again to send it back out.`,
    )
  }

  if (locations.loading || jars.loading) return <Loading what="Loading jars" />

  return (
    <>
      <ErrorNote error={jars.error ?? locations.error} />

      {/* Jars is where somebody stands all evening, so a request arriving mid-count has to
          be visible from here too. */}
      <RequestsInbox />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="row">
            {eventDays.map((d) => (
              <button
                key={d}
                className={day === d ? 'primary' : ''}
                onClick={() => setSelectedDay(d)}
              >
                {DAY_LABEL[d]}
              </button>
            ))}
          </div>
          <div className="stats">
            <Stat label="counted" value={<Money value={dayTotal} />} />
            <Stat label="jars in" value={counted.length} />
            <Stat
              label="still out"
              value={out.length}
              {...(out.length > 0 ? { tone: 'warn' as const } : {})}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button className="primary" onClick={() => setScanning(true)}>
            Scan a jar
          </button>
          <button
            onClick={() =>
              setManual({
                locationId: '',
                personId: '',
                jarNumber: '',
                amount: '',
                method: 'cash',
                note: '',
              })
            }
          >
            Record by hand
          </button>
          <span className="small muted">
            Jars are issued on the Day of screen — scanning one here counts it in.
          </span>
        </div>
        {message && <div className="note info" style={{ marginTop: '0.5rem' }}>{message}</div>}
      </div>

      {scanning && <QrScanner onDetected={onScan} onClose={() => setScanning(false)} />}

      {confirming &&
        (() => {
          const { jar, action } = confirming
          const what = isNumbered(jar) ? `jar ${jar.jarNumber}` : 'this money'
          const deleting = action === 'delete'
          return (
            <Modal
              title={deleting ? `Delete ${what}?` : `Put ${what} back out?`}
              onClose={() => setConfirming(null)}
              footer={
                <>
                  <button onClick={() => setConfirming(null)}>Cancel</button>
                  <button
                    className="danger"
                    onClick={() => (deleting ? doDelete(jar) : doReopen(jar))}
                  >
                    {deleting ? 'Delete' : 'Put back out'}
                  </button>
                </>
              }
            >
              <div className="stack">
                <p>
                  <strong>
                    <Money value={jar.amount} />
                  </strong>{' '}
                  from {describe(jar)}
                  {jar.note && ` — ${jar.note}`}.
                </p>

                {deleting ? (
                  <div className="note error">
                    This removes the amount from every total: the location's revenue and its
                    ranking, the day's figures, and the youth's own total. It cannot be
                    undone. If the figure is simply wrong, use Correct instead.
                  </div>
                ) : (
                  <div className="note warning">
                    The counted amount is cleared and {what} shows as out again, so it can be
                    counted afresh. Until then the money is not in any total.
                  </div>
                )}
              </div>
            </Modal>
          )
        })()}

      {manual && (
        <div className="card">
          <h2>Record money by hand</h2>
          <p className="small muted">
            For a jar that went out without being issued, or money that never went through a
            jar at all — bushel sales, a donation, a tap away from the table.
          </p>
          <div className="stack">
            <div className="row">
              <div style={{ flex: '2 1 14rem' }}>
                <label htmlFor="manual-location">Location</label>
                <LocationField
                  label="Location"
                  locations={locations.data.filter((l) => l.active)}
                  value={manual.locationId}
                  onChange={(locationId) => setManual({ ...manual, locationId })}
                />
              </div>
              <label style={{ flex: '0 1 9rem' }}>
                Jar number <span className="muted">(optional)</span>
                <input
                  type="number"
                  min="1"
                  inputMode="numeric"
                  placeholder="none"
                  value={manual.jarNumber}
                  onChange={(e) => setManual({ ...manual, jarNumber: e.target.value })}
                />
              </label>
            </div>

            <div className="row">
              <label style={{ flex: '1 1 8rem' }}>
                Amount
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  autoFocus
                  value={manual.amount}
                  onChange={(e) => setManual({ ...manual, amount: e.target.value })}
                  placeholder="0.00"
                />
              </label>
              <label style={{ flex: '0 1 9rem' }}>
                Method
                <select
                  value={manual.method}
                  onChange={(e) =>
                    setManual({ ...manual, method: e.target.value as PaymentMethod })
                  }
                >
                  <option value="cash">Cash</option>
                  <option value="square">Card (Square)</option>
                </select>
              </label>
              <div style={{ flex: '1 1 12rem' }}>
                <label>
                  Youth <span className="muted">(optional)</span>
                </label>
                <PersonField
                  label="Youth"
                  empty="Not recorded"
                  allowNone
                  people={[...people.data].sort((a, b) => fullName(a).localeCompare(fullName(b)))}
                  value={manual.personId}
                  onChange={(personId) => setManual({ ...manual, personId })}
                />
              </div>
            </div>

            <label>
              Note <span className="muted">(what this was)</span>
              <input
                value={manual.note}
                placeholder="bushel sales, donation at the door…"
                onChange={(e) => setManual({ ...manual, note: e.target.value })}
              />
            </label>

            <div className="row">
              <button className="primary" onClick={submitManual}>
                Record
              </button>
              <button onClick={() => setManual(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {counting && (
        <div className="card">
          <h2>Jar {counting.jarNumber}</h2>
          <p className="small muted">
            {describe(counting)}
            {counting.status === 'counted' && ' · already counted, this will correct it'}
          </p>
          <div className="row">
            <label style={{ flex: '1 1 8rem' }}>
              Amount
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
                placeholder="0.00"
              />
            </label>
            <label style={{ flex: '1 1 8rem' }}>
              Method
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                <option value="cash">Cash</option>
                <option value="square">Card (Square)</option>
              </select>
            </label>
          </div>

          {/* Everything else the jar says. Pre-filled with what it already says, so the
              common case is still type-the-amount-and-press-enter. */}
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <div style={{ flex: '2 1 13rem' }}>
              <label>Location</label>
              <LocationField
                label="Location"
                locations={locations.data}
                value={countLocation}
                onChange={setCountLocation}
              />
            </div>
            <div style={{ flex: '2 1 13rem' }}>
              <label>
                Youth <span className="muted">(optional)</span>
              </label>
              <PersonField
                label="Youth"
                empty="Not recorded"
                allowNone
                people={[...people.data].sort((a, b) => fullName(a).localeCompare(fullName(b)))}
                value={countPerson}
                onChange={setCountPerson}
              />
            </div>
          </div>

          <label style={{ display: 'block', marginTop: '0.5rem' }}>
            Note <span className="muted">(what this was, if it needs saying)</span>
            <input
              value={countNote}
              placeholder="bushel sales, donation at the door…"
              onChange={(e) => setCountNote(e.target.value)}
            />
          </label>

          {/*
            Changing who a jar belongs to does not move the hours it was out for: the shift
            it went out on is a separate record, and the hour-by-hour figures follow that.
            Said here rather than silently doing one or the other.
          */}
          {counting.assignmentIds.length > 0 && countPerson !== (counting.personId ?? '') && (
            <p className="small" style={{ color: 'var(--warn)' }}>
              This jar went out on a shift. Changing whose it is corrects the money against
              their name, but the hours it was out for stay with the shift it was issued on.
            </p>
          )}

          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button className="primary" onClick={submit}>
              Record {counting.jarNumber}
            </button>
            <button onClick={() => setCounting(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>Still out ({out.length})</h2>
        {out.length === 0 ? (
          <p className="muted">
            Every jar issued {DAY_LABEL[day].toLowerCase()} has been counted back in.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Jar</th>
                  <th>Where and who</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {out.map((jar) => (
                  <tr key={jar.id}>
                    <td className="mono">{jar.jarNumber}</td>
                    <td>{describe(jar)}</td>
                    <td>
                      <div className="row" style={{ gap: '0.25rem' }}>
                        <button className="tiny primary" onClick={() => startCounting(jar)}>
                          Count in
                        </button>
                        <button
                          className="tiny"
                          title="Take it back without counting — issued by mistake, or they never went out"
                          onClick={() => takeBack(jar)}
                        >
                          Take back
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Counted ({countedShown.length}{countedShown.length === counted.length ? '' : ` of ${counted.length}`})</h2>
          <input
            style={{ flex: '1 1 12rem', maxWidth: '20rem' }}
            placeholder="Find a jar, a location or a name…"
            aria-label="Search counted jars"
            value={countedSearch}
            onChange={(e) => setCountedSearch(e.target.value)}
          />
        </div>
        {counted.length === 0 ? (
          <p className="muted">Nothing counted yet.</p>
        ) : countedShown.length === 0 ? (
          <p className="muted">Nothing counted matches “{countedSearch}”.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Jar</th>
                  <th>Where</th>
                  <th>Who</th>
                  <th className="right">Amount</th>
                  <th>Method</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {countedShown.map((jar) => (
                  <tr key={jar.id}>
                    <td className="mono">
                      {isNumbered(jar) ? (
                        <>
                          {jar.jarNumber}
                          {tripLabel(jar) && (
                            <span className="muted small"> {tripLabel(jar)}</span>
                          )}
                        </>
                      ) : (
                        <span className="muted small">no jar</span>
                      )}
                    </td>
                    <td className="small">
                      <LocationLink name={locationName(jar)} locationId={jar.locationId} />
                      {jar.note && <div className="muted">{jar.note}</div>}
                    </td>
                    <td className="small">
                      {jar.personId ? (
                        <PersonLink
                          person={personById.get(jar.personId)}
                          personId={jar.personId}
                        />
                      ) : (
                        <span className="muted">not recorded</span>
                      )}
                    </td>
                    <td className="right">
                      <Money value={jar.amount} />
                    </td>
                    <td className="small muted">{jar.method}</td>
                    <td>
                      <div className="row" style={{ gap: '0.25rem' }}>
                        <button className="tiny" onClick={() => startCounting(jar)}>
                          Correct
                        </button>
                        {role === 'admin' && (
                          <>
                            <button
                              className="tiny"
                              title="Put it back out — issued or counted by mistake"
                              onClick={() => setConfirming({ jar, action: 'reopen' })}
                            >
                              Reopen
                            </button>
                            <button
                              className="tiny danger"
                              onClick={() => setConfirming({ jar, action: 'delete' })}
                            >
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Making the labels is a week-before job, so it is folded away until asked for. */}
      <JarLabels />
    </>
  )
}
