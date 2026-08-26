import { toCsv, downloadFile } from '../csv'
import type { MailSender, OutgoingMessage } from './index'

/**
 * The route that always works.
 *
 * A client id may be unconfigured, or a consent screen may refuse on the morning of the
 * event. Neither is a reason for nobody to hear about their shift, so the same messages
 * come out as a file for whatever mailing tool the group already uses.
 *
 * It "sends" by collecting and writes once at the end, which keeps it inside the same
 * interface as a real mailbox — and an export counts as a send in the ledger, because the
 * mailing tool will do the telling.
 */
export function csvSender(filename: string): MailSender & { finish: () => void } {
  const collected: OutgoingMessage[] = []

  return {
    channel: 'csv',
    label: 'Export a file',
    isConnected: () => true,
    connect: async () => {},
    sendingAs: () => 'your own mailing tool',

    send: async (message: OutgoingMessage) => {
      collected.push(message)
    },

    /** Once at the end, not per message: sixty downloads is not a feature. */
    finish: () => {
      if (collected.length === 0) return
      downloadFile(
        filename,
        toCsv(
          collected.map((m) => ({
            Email: m.to,
            Subject: m.subject,
            Message: m.body,
          })),
        ),
      )
    },
  }
}
