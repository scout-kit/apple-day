import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { summariseMoney } from '../domain/metrics'
import { DAY_LABEL } from '../domain/slots'
import type { Reconciliation } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import { saveReconciliation, useJars, useReconciliation } from '../lib/repo'
import { ErrorNote, Loading, Money, Stat } from './Bits'

const EMPTY: Reconciliation = { bushelSales: 0, deposit: 0, notes: '' }

/**
 * What the event raised.
 *
 * Every figure here comes from the jars, each counted once with its location and youth
 * already attached from when it was issued. There is nothing to type in and nothing to
 * reconcile against — which is the point: the workbook kept a second, hand-assembled set
 * of totals, and the two being $86.55 apart went unnoticed because neither was obviously
 * the truth.
 *
 * Two things the jars cannot know stay editable: apples sold by the bushel, and what
 * actually reached the bank.
 */
export function ReconcileScreen(): ReactNode {
  const { event } = useEvent()
  const jars = useJars()
  const stored = useReconciliation()
  const [draft, setDraft] = useState<Reconciliation>(EMPTY)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!dirty && stored.data) setDraft(stored.data)
  }, [stored.data, dirty])

  const summary = useMemo(() => summariseMoney(jars.data, draft), [jars.data, draft])

  const update = (patch: Partial<Reconciliation>): void => {
    setDirty(true)
    setDraft((current) => ({ ...current, ...patch }))
  }

  const save = async (): Promise<void> => {
    if (!event) return
    setSaving(true)
    try {
      await saveReconciliation(event.id, draft)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }

  if (jars.loading || stored.loading) return <Loading what="Adding up the jars" />

  return (
    <>
      <ErrorNote error={jars.error ?? stored.error} />

      {summary.stillOut > 0 && (
        <div className="note warning">
          <strong>
            {summary.stillOut} jar{summary.stillOut === 1 ? '' : 's'} still out
          </strong>
          <div className="small">
            Money nobody has counted yet, so these are running totals rather than a result.
            Count them in on the Jars screen.
          </div>
        </div>
      )}

      <div className="card">
        <div className="stats">
          <Stat label="raised in total" value={<Money value={summary.grandTotal} />} />
          <Stat label="from jars" value={<Money value={summary.jarTotal} />} />
          <Stat label="cash" value={<Money value={summary.cash} />} />
          <Stat label="card" value={<Money value={summary.card} />} />
          <Stat label="bushel sales" value={<Money value={summary.bushelSales} />} />
        </div>
        <p className="small muted" style={{ marginTop: '0.5rem' }}>
          Cash and card come from how each jar was counted, so they always add up to the jar
          total. Card takings are already inside it and are never added again — double
          counting them is what made the old spreadsheet's grand total look like $6,089.06.
        </p>
      </div>

      <div className="card">
        <h2>By day</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th className="right">Jars</th>
                <th className="right">Cash</th>
                <th className="right">Card</th>
                <th className="right">Total</th>
              </tr>
            </thead>
            <tbody>
              {summary.days.map((row) => (
                <tr key={row.day}>
                  <td>
                    <strong>{DAY_LABEL[row.day]}</strong>
                    {row.stillOut > 0 && (
                      <div className="small" style={{ color: 'var(--warn)' }}>
                        {row.stillOut} still out
                      </div>
                    )}
                  </td>
                  <td className="right muted">{row.jarCount}</td>
                  <td className="right">
                    <Money value={row.cash} />
                  </td>
                  <td className="right">
                    <Money value={row.card} />
                  </td>
                  <td className="right">
                    <strong>
                      <Money value={row.jarTotal} />
                    </strong>
                  </td>
                </tr>
              ))}
              {summary.days.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No jars counted yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>What the jars cannot tell us</h2>
        <div className="row">
          <label style={{ flex: '1 1 10rem' }}>
            Bushel sales
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.bushelSales}
              onChange={(e) => update({ bushelSales: Number(e.target.value) || 0 })}
            />
          </label>
          <label style={{ flex: '1 1 10rem' }}>
            Deposited at the bank <span className="muted">(optional)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={draft.deposit}
              onChange={(e) => update({ deposit: Number(e.target.value) || 0 })}
            />
          </label>
        </div>

        {draft.deposit > 0 && summary.depositVariance !== 0 && (
          <div className="note warning">
            The deposit is <Money value={Math.abs(summary.depositVariance)} />{' '}
            {summary.depositVariance > 0 ? 'more' : 'less'} than the{' '}
            <Money value={summary.grandTotal} /> raised.
            {summary.stillOut > 0 && ' Some jars are still out, which would explain it.'}
          </div>
        )}
        {draft.deposit > 0 && summary.depositVariance === 0 && (
          <div className="note good">The deposit matches what was raised.</div>
        )}

        <label style={{ marginTop: '0.5rem' }}>
          Notes
          <textarea
            rows={3}
            style={{ width: '100%' }}
            value={draft.notes}
            placeholder="Anything worth remembering — a jar found later, a float, a bad count."
            onChange={(e) => update({ notes: e.target.value })}
          />
        </label>

        <div className="row" style={{ marginTop: '0.5rem' }}>
          <button className="primary" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>
    </>
  )
}
