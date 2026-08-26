import jsQR from 'jsqr'
import QRCode from 'qrcode'

/**
 * QR generation and scanning.
 *
 * Generation is used for the printable sheet: volunteer passes, jar labels and location
 * cards. Scanning is used inside the app by organizers — a volunteer never
 * needs the in-app scanner, because their phone's own camera opens the pass link.
 *
 * Camera access needs a secure context. `localhost` qualifies, a LAN IP does not, so
 * phone testing goes through a Hosting preview channel.
 */

export async function toQrDataUrl(text: string, size = 256): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>
}

type BarcodeDetectorConstructor = new (options?: {
  formats?: string[]
}) => BarcodeDetectorLike

function nativeDetector(): BarcodeDetectorLike | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector
  if (!ctor) return null
  try {
    return new ctor({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

export interface ScanController {
  stop: () => void
}

/**
 * Scan continuously from a video element, calling `onResult` with the first decode.
 *
 * Uses the platform `BarcodeDetector` where it exists (Chrome, Android) and falls back to
 * a pure-JS decode for Safari, which does not implement it.
 */
export function scanFromVideo(
  video: HTMLVideoElement,
  onResult: (value: string) => void,
  onError?: (error: Error) => void,
): ScanController {
  let stopped = false
  let stream: MediaStream | null = null
  const detector = nativeDetector()
  const canvas = document.createElement('canvas')

  const stop = (): void => {
    stopped = true
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
  }

  const tick = async (): Promise<void> => {
    if (stopped) return

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      try {
        if (detector) {
          const results = await detector.detect(video)
          const first = results[0]
          if (first?.rawValue) {
            onResult(first.rawValue)
            stop()
            return
          }
        } else {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx && canvas.width > 0 && canvas.height > 0) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const found = jsQR(image.data, image.width, image.height, {
              inversionAttempts: 'dontInvert',
            })
            if (found?.data) {
              onResult(found.data)
              stop()
              return
            }
          }
        }
      } catch (error) {
        onError?.(error as Error)
      }
    }

    requestAnimationFrame(() => void tick())
  }

  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: 'environment' } })
    .then(async (media) => {
      if (stopped) {
        media.getTracks().forEach((t) => t.stop())
        return
      }
      stream = media
      video.srcObject = media
      await video.play()
      void tick()
    })
    .catch((error: Error) => {
      onError?.(
        new Error(
          `Could not open the camera (${error.message}). Camera access needs HTTPS or localhost.`,
        ),
      )
    })

  return { stop }
}

/** Pull an object id (jar or location) out of a scanned value. */
function objectIdFromScan(value: string, kind: 'jar' | 'loc'): string | null {
  const match = new RegExp(`(?:^|[/:])${kind}[/:]([A-Za-z0-9_-]+)`).exec(value.trim())
  return match?.[1] ?? null
}

/**
 * The jar number from a scanned label.
 *
 * Labels carry the number alone — `jar:7` — because a jar is a physical tin reused every
 * day and every year. Encoding a day in the label would mean re-labelling the whole crate
 * each morning. A bare number is accepted too, for a hand-typed entry.
 */
export function jarNumberFromScan(value: string): number | null {
  const scanned = objectIdFromScan(value, 'jar') ?? value.trim()
  // Tolerates a legacy `fri-jar-12` label by taking its trailing number.
  const digits = /(\d+)\s*$/.exec(scanned)?.[1]
  if (!digits) return null
  const parsed = Number(digits)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}
