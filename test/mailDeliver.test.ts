import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deliver } from '../src/lib/mail'
import type { MailSender, OutgoingMessage } from '../src/lib/mail'

/**
 * Sending a run of messages.
 *
 * The behaviour worth pinning is what happens when one of them fails. A run that stopped at
 * the first bad address would leave the rest unsent and the organizer with no idea which —
 * one wrong address out of sixty should cost that one message and nothing else.
 */

const msg = (to: string): OutgoingMessage => ({ to, subject: 'Your shift', body: 'Hello' })

let sent: string[] = []
let recorded: string[] = []
let failOn: Set<string> = new Set()
let failRecordOn: Set<string> = new Set()

const sender = (): MailSender => ({
  channel: 'gmail',
  label: 'Gmail',
  connect: async () => {},
  isConnected: () => true,
  sendingAs: () => 'organizer@example.org',
  send: async (m) => {
    if (failOn.has(m.to)) throw new Error('550 mailbox unavailable')
    sent.push(m.to)
  },
})

const record = async (m: OutgoingMessage): Promise<void> => {
  if (failRecordOn.has(m.to)) throw new Error('permission denied')
  recorded.push(m.to)
}

beforeEach(() => {
  sent = []
  recorded = []
  failOn = new Set()
  failRecordOn = new Set()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

describe('a run that goes well', () => {
  it('sends every message and records every one', async () => {
    const out = await deliver(sender(), [msg('a@x.org'), msg('b@x.org')], record)
    expect(sent).toEqual(['a@x.org', 'b@x.org'])
    expect(recorded).toEqual(['a@x.org', 'b@x.org'])
    expect(out.every((o) => o.ok)).toBe(true)
  })

  it('records as it goes, not at the end', async () => {
    /*
      Why it matters: stop halfway — a closed tab, an expired token — and the ledger still
      matches what actually left, so a retry targets only the rest.
    */
    const order: string[] = []
    await deliver(
      { ...sender(), send: async (m) => { order.push(`sent ${m.to}`) } },
      [msg('a@x.org'), msg('b@x.org')],
      async (m) => { order.push(`recorded ${m.to}`) },
    )
    expect(order).toEqual([
      'sent a@x.org', 'recorded a@x.org',
      'sent b@x.org', 'recorded b@x.org',
    ])
  })

  it('reports progress as it works through them', async () => {
    const seen: string[] = []
    await deliver(sender(), [msg('a@x.org'), msg('b@x.org')], record, (done, total) =>
      seen.push(`${done}/${total}`),
    )
    expect(seen).toEqual(['1/2', '2/2'])
  })
})

describe('when one of them fails', () => {
  it('carries on with the rest', async () => {
    failOn = new Set(['b@x.org'])
    const out = await deliver(
      sender(), [msg('a@x.org'), msg('b@x.org'), msg('c@x.org')], record,
    )
    expect(sent).toEqual(['a@x.org', 'c@x.org'])
    expect(out.map((o) => o.ok)).toEqual([true, false, true])
  })

  it('never rejects, so the screen always gets a result', async () => {
    failOn = new Set(['a@x.org'])
    await expect(deliver(sender(), [msg('a@x.org')], record)).resolves.toBeDefined()
  })

  it('says why, in words worth showing somebody', async () => {
    failOn = new Set(['a@x.org'])
    const [only] = await deliver(sender(), [msg('a@x.org')], record)
    expect(only!.error).toContain('550 mailbox unavailable')
  })

  it('does not record a message that never went', async () => {
    // Recording it would make a retry skip somebody who was never told.
    failOn = new Set(['a@x.org'])
    await deliver(sender(), [msg('a@x.org')], record)
    expect(recorded).toEqual([])
  })

  it('falls back to something readable when the error has no message', async () => {
    const out = await deliver(
      { ...sender(), send: async () => { throw new Error('') } },
      [msg('a@x.org')], record,
    )
    expect(out[0]!.error).toBe('Unknown error')
  })
})

describe('when the message goes but the record does not', () => {
  it('counts as sent, because it was', async () => {
    /*
      The gap that must not be papered over. Calling it a failure invites somebody to send
      it again, and the parent has already had it — so it is reported as sent, with the
      problem attached, and the admin can see the record is missing.
    */
    failRecordOn = new Set(['a@x.org'])
    const [only] = await deliver(sender(), [msg('a@x.org')], record)
    expect(sent).toEqual(['a@x.org'])
    expect(only!.ok).toBe(true)
    expect(only!.error).toContain('not recorded')
  })

  it('still carries on with the rest', async () => {
    failRecordOn = new Set(['a@x.org'])
    await deliver(sender(), [msg('a@x.org'), msg('b@x.org')], record)
    expect(sent).toEqual(['a@x.org', 'b@x.org'])
  })
})

describe('an empty run', () => {
  it('does nothing and says nothing failed', async () => {
    expect(await deliver(sender(), [], record)).toEqual([])
  })
})
