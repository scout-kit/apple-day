import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { describeJarNumbers, parseJarNumbers } from '../domain/jarLabels'
import { toQrDataUrl } from '../lib/qr'

/**
 * A printable sheet of numbered jar labels.
 *
 * Moved here from the Publish screen, where it sat beside volunteer passes and location
 * cards under one "printable sheet" switch. It has nothing to do with publishing a
 * schedule — it is something you do once, in the week before, with a stack of tins and a
 * roll of tape — and it belongs beside the screen that reads the labels back.
 *
 * One label per physical jar, numbered. The same tin goes out on any day of any year, so
 * the label carries no date: the app pairs the number with the day being worked, which is
 * what makes a jar number unique per day rather than for ever.
 *
 * Which jars is a field rather than a count, because reprinting three peeled-off labels is
 * as ordinary a job as labelling forty new tins. See `parseJarNumbers`.
 */
export function JarLabels(): ReactNode {
  const [which, setWhich] = useState('1-40')
  const [qrs, setQrs] = useState<Map<string, string>>(new Map())
  const [open, setOpen] = useState(false)

  const { numbers, problem } = useMemo(() => parseJarNumbers(which), [which])

  const items = useMemo(
    () =>
      numbers.map((number) => ({
        key: `jar-${number}`,
        value: `jar:${number}`,
        caption: `Jar ${number}`,
      })),
    [numbers],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const next = new Map<string, string>()
      for (const item of items) next.set(item.key, await toQrDataUrl(item.value, 220))
      if (!cancelled) setQrs(next)
    })()
    return () => {
      cancelled = true
    }
    // Drawn only once the sheet is open: two hundred QR codes is real work, and this sits
    // on the screen somebody has open all day Saturday.
  }, [items, open])

  return (
    <div className="card">
      <div className="row no-print" style={{ justifyContent: 'space-between' }}>
        <h2>Jar labels</h2>
        <div className="row">
          <button onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Make labels'}</button>
          {open && (
            <button disabled={items.length === 0} onClick={() => window.print()}>
              Print
            </button>
          )}
        </div>
      </div>

      {open && (
        <>
          {/*
            One field for both jobs.

            "How many" was right the week before and wrong every time after: a tin comes
            back dented, three labels peel off in the rain, somebody finds two more in a
            cupboard. Then you want 4, 12 and 17 — and re-printing forty to get three is
            how a roll of labels disappears.
          */}
          <label className="no-print small" style={{ maxWidth: '22rem' }}>
            Which jars
            <input
              value={which}
              onChange={(e) => setWhich(e.target.value)}
              placeholder="1-40, or 12,17,4"
            />
          </label>

          {/* Read back before it becomes paper: forty numbers cannot be checked at a
              glance, and runs fold up into something that can. */}
          <p className="small muted no-print" style={{ margin: 0 }}>
            {problem ? (
              <span style={{ color: 'var(--warn)' }}>{problem}</span>
            ) : (
              describeJarNumbers(numbers)
            )}
          </p>

          <div className="qr-sheet">
            {items.map((item) => (
              <div className="qr-card" key={item.key}>
                {qrs.get(item.key) ? (
                  <img src={qrs.get(item.key)} alt="" />
                ) : (
                  <div className="muted small">…</div>
                )}
                <div className="cap">{item.caption}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
