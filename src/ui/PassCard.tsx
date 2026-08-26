import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { toQrDataUrl } from '../lib/qr'

/**
 * One volunteer's own link, with the QR that opens it.
 *
 * Shown wherever somebody is being looked up rather than only on the printable sheet: a
 * parent rings to say the link does not work, and the person who answers wants to read it
 * back, send it again, or hold the code up to a phone — without printing a sheet of ninety
 * to find one.
 *
 * A pass only exists once the schedule has been published, so the caller renders this only
 * when there is one. Nothing here mints or guesses a token.
 */
export function PassCard({ token, name }: { token: string; name: string }): ReactNode {
  const url = `${window.location.origin}/p/${token}`
  const [qr, setQr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    // Drawn in the browser: there is no server to render it, and it must not reach one —
    // the URL is the credential.
    void toQrDataUrl(url, 220).then((data) => {
      if (!cancelled) setQr(data)
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return (
    <div className="card">
      <h2>Their link</h2>
      <p className="small muted">
        This is the link they were sent when the schedule was published. It is a key, not
        just an address: anyone holding it sees this volunteer’s shifts, so send it to them
        rather than posting it anywhere.
      </p>

      <div className="row" style={{ alignItems: 'flex-start', gap: '1rem' }}>
        <div className="qr-card no-print" style={{ flex: '0 0 auto' }}>
          {qr ? (
            <img src={qr} alt={`QR code opening ${name}’s pass`} />
          ) : (
            <span className="small muted">Drawing…</span>
          )}
          <div className="cap">{name}</div>
        </div>

        <div className="stack" style={{ flex: '1 1 14rem', minWidth: 0 }}>
          <a className="mono small" href={url} style={{ wordBreak: 'break-all' }}>
            {url}
          </a>
          <div className="row">
            <button
              className="tiny"
              onClick={() => {
                /*
                  Clipboard access is refused outside a secure context and can be denied
                  outright, so the button says what happened either way rather than
                  appearing to work.
                */
                void navigator.clipboard
                  ?.writeText(url)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a className="btn tiny" href={url} target="_blank" rel="noreferrer">
              Open it
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
