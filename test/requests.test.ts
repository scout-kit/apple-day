import { describe, expect, it } from 'vitest'
import {
  REQUEST_CHOICES,
  readRequest,
  requestSummary,
  waiting,
} from '../src/domain/requests'

/**
 * What a volunteer asked for from their pass.
 *
 * The whole point is that somebody reads them. A collection no screen looks at means the
 * volunteer sees "sent" and the organizers never hear about it.
 */

describe('reading a request', () => {
  it('reads what a pass wrote', () => {
    expect(
      readRequest('r1', {
        passToken: 'tok123',
        kind: 'cancel',
        message: 'soccer runs late',
        createdAt: 5,
      }),
    ).toEqual({
      id: 'r1',
      passToken: 'tok123',
      kind: 'cancel',
      slotId: '',
      message: 'soccer runs late',
      createdAt: 5,
      handledAt: null,
      handledBy: '',
      // Empty on anything written before the address was recorded against it.
      handledByEmail: '',
    })
  })

  it('is waiting until an organizer deals with it', () => {
    expect(readRequest('r1', {}).handledAt).toBeNull()
    expect(readRequest('r1', { handledAt: 9, handledBy: 'uid' }).handledAt).toBe(9)
  })

  it('falls back to a question for a kind it does not know', () => {
    // A kind nothing can render would drop the request out of the list silently, which is
    // the failure this whole file exists to prevent.
    expect(readRequest('r1', { kind: 'refund' }).kind).toBe('question')
  })

  it('names the shift it is about, when the volunteer said which', () => {
    // Without this a "cannot make it" is a name and a sentence, and the organizer cannot
    // tell whether the Friday or the Saturday is the problem.
    expect(readRequest('r1', { slotId: 'sat-0900' }).slotId).toBe('sat-0900')
  })

  it('means all their shifts when no shift is named', () => {
    expect(readRequest('r1', {}).slotId).toBe('')
  })

  it('survives a document missing everything', () => {
    const r = readRequest('r1', {})
    expect(r.passToken).toBe('')
    expect(r.message).toBe('')
    expect(r.createdAt).toBe(0)
  })
})

describe('requestSummary', () => {
  it('says what happened in words', () => {
    expect(requestSummary('cancel')).toBe('cannot make it')
    expect(requestSummary('swap')).toBe('asked to swap')
    expect(requestSummary('noShow')).toBe('reported a no-show')
    expect(requestSummary('question')).toBe('asked a question')
  })
})

describe('the queue', () => {
  const req = (id: string, createdAt: number, handledAt: number | null = null) =>
    readRequest(id, { passToken: 't', kind: 'cancel', createdAt, ...(handledAt ? { handledAt } : {}) })

  it('holds only what is still waiting', () => {
    expect(waiting([req('a', 1), req('b', 2, 9)]).map((r) => r.id)).toEqual(['a'])
  })

  it('is oldest first, so Wednesday is not stuck behind an hour ago', () => {
    expect(waiting([req('new', 100), req('old', 1)]).map((r) => r.id)).toEqual(['old', 'new'])
  })

  it('is empty when everything has been dealt with', () => {
    expect(waiting([req('a', 1, 9)])).toEqual([])
  })
})

describe('what a volunteer can ask for', () => {
  it('offers the things somebody actually asks, in the order they think of them', () => {
    expect(REQUEST_CHOICES.map((c) => c.label)).toEqual([
      'Ask to swap',
      'Cannot make it',
      'Need a hand',
      'Something else',
    ])
  })

  it('does not offer reporting somebody else absent', () => {
    // That is an organizer's judgement about another person, not a request from one.
    expect(REQUEST_CHOICES.map((c) => c.kind)).not.toContain('noShow')
  })

  it('keeps a catch-all, so a form that cannot say the problem is not the end of it', () => {
    // Otherwise the answer is a phone call nobody logged.
    expect(REQUEST_CHOICES.map((c) => c.kind)).toContain('question')
  })

  it('reads each kind back in words', () => {
    for (const choice of REQUEST_CHOICES) {
      expect(requestSummary(choice.kind), choice.kind).not.toBe('')
    }
    expect(requestSummary('help')).toBe('needs a hand')
  })

  it('survives a kind written before the list grew', () => {
    expect(readRequest('r1', { kind: 'help' }).kind).toBe('help')
  })
})
