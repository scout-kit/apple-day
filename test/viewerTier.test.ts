import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { readTier } from '../src/domain/access'

// The tier helpers are pure; the module they live in reaches Firestore.
vi.mock('../src/lib/firebase', () => ({ missingConfig: [], auth: {}, db: {} }))

const { canSeeTheEvent, runsTheEvent } = await import('../src/lib/session')

/**
 * A third tier: on the roster, and able to change nothing.
 *
 * For somebody who is asked how the day went rather than running it — a treasurer, a
 * committee member. Without it they are given an organizer's account, which is how
 * read-only people end up able to edit the board.
 */

describe('reading a stored level', () => {
  it('names each tier rather than inferring it', () => {
    expect(readTier('admin')).toBe('admin')
    expect(readTier('organizer')).toBe('organizer')
    expect(readTier('viewer')).toBe('viewer')
  })

  it('reads an entry with no level as a full admin', () => {
    /*
      Those were written before there were tiers, when being on the roster meant everything.
      Reading them as the lesser thing would lock a group out of its own setup screens, and
      the rules default the same way — the two have to agree or the app offers a screen the
      database then refuses.
    */
    expect(readTier(undefined)).toBe('admin')
    expect(readTier(null)).toBe('admin')
    expect(readTier('')).toBe('admin')
  })

  it('reads a level nobody recognises as the least of them', () => {
    /*
      The trapdoor this replaced: "anything that is not an organizer is an admin" reads fine
      with two tiers and hands full access to a typo with three.
    */
    expect(readTier('treasurer')).toBe('viewer')
    expect(readTier('Admin')).toBe('viewer')
    expect(readTier(7)).toBe('viewer')
  })
})

describe('what each tier may do', () => {
  it('does not let a viewer run the event', () => {
    expect(runsTheEvent('viewer')).toBe(false)
    expect(runsTheEvent('admin')).toBe(true)
    expect(runsTheEvent('organizer')).toBe(true)
  })

  it('lets a viewer past the sign-in page', () => {
    expect(canSeeTheEvent('viewer')).toBe(true)
    expect(canSeeTheEvent('none')).toBe(false)
    expect(canSeeTheEvent('volunteer')).toBe(false)
  })
})

describe('the rules ask positively, so an unknown level cannot slip through', () => {
  const rules = readFileSync('firestore.rules', 'utf8')

  const body = (name: string): string => {
    const at = rules.indexOf(`function ${name}()`)
    expect(at, name).toBeGreaterThan(-1)
    return rules.slice(at, rules.indexOf('}', at))
  }

  it('names what an admin is, rather than what it is not', () => {
    // `!= 'organizer'` was true for every level that had not been invented yet.
    expect(body('isAdmin')).toContain("rosterLevel() == 'admin'")
    expect(body('isAdmin')).not.toContain('!=')
  })

  it('names what an organizer is', () => {
    const organizer = body('isOrganizer')
    expect(organizer).toContain("rosterLevel() == 'admin'")
    expect(organizer).toContain("rosterLevel() == 'organizer'")
    expect(organizer).not.toContain('!=')
  })

  it('lets anybody on the roster read', () => {
    expect(body('isViewer')).toContain('onRoster()')
  })
})
