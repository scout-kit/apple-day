// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { forgetInvite, pendingInvite, rememberInvite } from '../src/lib/pendingInvite'

/**
 * The invitation code held across signing in.
 *
 * Signing in with Google leaves the page, so the code has to survive the round trip
 * somewhere outside React. What it must not do is survive anything else: a stored code is a
 * grant sitting there waiting for whoever signs in next on that browser, and an account that
 * was never sent a link should never end up holding somebody else's tier.
 */

const KEY = 'apple-day:invite'

beforeEach(() => {
  sessionStorage.clear()
})

describe('holding one', () => {
  it('gives back what was put in', () => {
    rememberInvite('abcdefghijklmnopqrstuv')
    expect(pendingInvite()).toBe('abcdefghijklmnopqrstuv')
  })

  it('is nothing when nothing was stored', () => {
    expect(pendingInvite()).toBe('')
  })

  it('keeps the code exactly, case and all', () => {
    // The alphabet has both cases in it, so a code that comes back lowercased matches no
    // invitation — and that is indistinguishable from one already used.
    rememberInvite('Vi3fsJ66GEkL7SrRzgEvke')
    expect(pendingInvite()).toBe('Vi3fsJ66GEkL7SrRzgEvke')
  })

  it('is session storage, so it does not outlive the browser tab', () => {
    rememberInvite('abcdefghijklmnopqrstuv')
    expect(sessionStorage.getItem(KEY)).toBeTruthy()
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

describe('letting go of one', () => {
  it('forgets on request', () => {
    rememberInvite('abcdefghijklmnopqrstuv')
    forgetInvite()
    expect(pendingInvite()).toBe('')
  })

  it('expires, so a tab reused later does not claim it', () => {
    /*
      Somebody opens a link, gets distracted, and the tab is used for something else an hour
      on. Honouring the code then hands the invitation to whoever happens to sign in.
    */
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ code: 'abcdefghijklmnopqrstuv', at: Date.now() - 60 * 60 * 1000 }),
    )
    expect(pendingInvite()).toBe('')
  })

  it('is still good a couple of minutes on, which is the round trip', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ code: 'abcdefghijklmnopqrstuv', at: Date.now() - 2 * 60 * 1000 }),
    )
    expect(pendingInvite()).toBe('abcdefghijklmnopqrstuv')
  })

  it('clears an expired one out rather than being asked again', () => {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ code: 'abcdefghijklmnopqrstuv', at: Date.now() - 60 * 60 * 1000 }),
    )
    pendingInvite()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})

describe('something else in that slot', () => {
  it('ignores a bare string, and does not act on it', () => {
    // Whatever wrote it, it is not something to grant access on the strength of.
    sessionStorage.setItem(KEY, 'abcdefghijklmnopqrstuv')
    expect(pendingInvite()).toBe('')
  })

  it('ignores an entry with no time on it', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ code: 'abcdefghijklmnopqrstuv' }))
    expect(pendingInvite()).toBe('')
  })

  it('ignores unparseable rubbish', () => {
    sessionStorage.setItem(KEY, '{not json')
    expect(pendingInvite()).toBe('')
  })

  it('clears it out, so the same question is not asked twice', () => {
    sessionStorage.setItem(KEY, '{not json')
    pendingInvite()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})
