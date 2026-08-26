import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { scanFromVideo } from '../lib/qr'

/**
 * In-app QR scanning, used by organizers to identify a jar or a location
 * without typing a number. Volunteers never need this — their phone's camera opens their
 * pass link directly.
 *
 * Camera access requires a secure context, so this works on localhost and on Hosting but
 * not over a bare LAN IP. The error message says so rather than failing silently.
 */
export function QrScanner({
  onDetected,
  onClose,
}: {
  onDetected: (value: string) => void
  onClose: () => void
}): ReactNode {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const controller = scanFromVideo(
      video,
      (value) => onDetected(value),
      (err) => setError(err.message),
    )
    return () => controller.stop()
    // onDetected is stable enough for this component's lifetime; re-running would
    // restart the camera mid-scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3>Scan a code</h3>
        <button className="tiny" onClick={onClose}>
          Close
        </button>
      </div>
      {error ? (
        <div className="note error">{error}</div>
      ) : (
        <p className="small muted">Point the camera at a jar label or location card.</p>
      )}
      <video ref={videoRef} className="scanner" muted playsInline />
    </div>
  )
}
