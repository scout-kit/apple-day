import type { SendChannel } from '../reminders'

/**
 * The one place anything leaves this app for somebody's inbox.
 *
 * Narrow on purpose. Everything upstream of it — who a reminder covers, what it says,
 * what has already gone out — is decided without knowing how it travels, so the day this
 * moves to a server the change is one module rather than a rewrite.
 *
 * There is no backend to send from: the free plan has no Cloud Functions. Instead the
 * browser holds a short-lived OAuth token for the organizer's own mailbox and posts each
 * message to Gmail directly. That is not a workaround so much as a better fit — mail
 * arrives from a person the parents recognise, replies reach a human rather than a no-reply
 * address, and it lands in the sender's own Sent folder.
 *
 * One provider, deliberately. A second would mean a second consent screen to keep working
 * and a second thing to test against, for a group that signs in with Google. The seam is
 * here so adding one is a module rather than a rewrite — not so that one is added.
 */

export interface OutgoingMessage {
  to: string
  subject: string
  /** Plain text. Nothing here is worth a layout, and it is read on a phone. */
  body: string
}

export interface SendOutcome {
  to: string
  ok: boolean
  /** Why it failed, in words an organizer can act on. */
  error?: string
}

export interface MailSender {
  channel: SendChannel
  label: string
  /**
   * Ask for permission to send, before anything is composed.
   *
   * Separate from `send` so consent is granted while the admin is looking at a button they
   * pressed, not in the middle of a run where a popup blocker would strand it half done.
   */
  connect: () => Promise<void>
  /** Whether a usable token is already in hand. */
  isConnected: () => boolean
  /** Who the mail will come from, once connected. Shown before sending. */
  sendingAs: () => string
  send: (message: OutgoingMessage) => Promise<void>
}

/**
 * How long to wait between messages.
 *
 * Sent one at a time rather than in parallel: Gmail rate-limits, and a burst of sixty is
 * exactly the shape it throttles. At this size the whole run is a few seconds
 * either way, so there is nothing to win by rushing it.
 */
const BETWEEN_SENDS_MS = 250

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

/**
 * Send each message in turn, reporting on every one.
 *
 * Never rejects. A run that stopped at the first failure would leave the rest unsent and
 * the admin with no idea which — one bad address out of sixty is a thing that happens, and
 * it should cost that one message and nothing else.
 *
 * `onSent` fires after each success, so the ledger is written as the run goes rather than
 * at the end. Stop halfway and the record still matches what actually left.
 */
export async function deliver(
  sender: MailSender,
  messages: OutgoingMessage[],
  onSent: (message: OutgoingMessage) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<SendOutcome[]> {
  const outcomes: SendOutcome[] = []

  for (const [index, message] of messages.entries()) {
    try {
      await sender.send(message)
      /*
        Recorded before the next one goes out, and a failure to record is not a failure to
        send: the message has left, and saying otherwise would invite somebody to send it
        again. Reported instead, so the gap is visible.
      */
      try {
        await onSent(message)
        outcomes.push({ to: message.to, ok: true })
      } catch (error) {
        outcomes.push({
          to: message.to,
          ok: true,
          error: `Sent, but not recorded: ${describe(error)}`,
        })
      }
    } catch (error) {
      outcomes.push({ to: message.to, ok: false, error: describe(error) })
    }

    onProgress?.(index + 1, messages.length)
    if (index < messages.length - 1) await pause(BETWEEN_SENDS_MS)
  }

  return outcomes
}

function describe(error: unknown): string {
  const message = String((error as { message?: unknown })?.message ?? error ?? '')
  return message || 'Unknown error'
}
