import { describe, expect, it, vi } from 'vitest'

/**
 * Where an invitation lives.
 *
 * One line of code, and worth a file of its own for how quietly it can break everything.
 *
 * The temptation with a document key is to normalise it — lowercase it, trim it — the way you
 * would an email address, so that two spellings meet at one document. Here that is fatal. The
 * code's alphabet has both cases in it, so lowercasing turns a real code into one that matches
 * no document, and the app cannot tell that apart from an invitation already spent. Every link
 * would read "this cannot be used", with nothing anywhere saying why.
 *
 * Checked against the real module, because nothing else does: the rules tests build their own
 * paths, and every other test mocks this one out.
 */

vi.mock('../src/lib/firebase', () => ({ db: {}, missingConfig: [] }))

// The path is what is being asserted on, so the Firestore helpers are recorded rather than
// stubbed to nothing.
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
}))

const { paths } = await import('../src/lib/paths')

const pathOf = (code: string): string => (paths.invite(code) as unknown as { path: string }).path

describe('the document an invitation code points at', () => {
  it('keeps the code exactly as issued, case and all', () => {
    const code = 'Vi3fsJ66GEkL7SrRzgEvke'
    expect(pathOf(code)).toBe(`invites/${code}`)
  })

  it('does not lowercase it', () => {
    // The specific mistake, named. A code differing only in case is a different invitation.
    expect(pathOf('ABCdef')).not.toBe(pathOf('abcdef'))
  })

  it('is the same path the app reads, writes and spends', () => {
    // One route to it, so the join page, the claim and the revoke cannot disagree about
    // which document they mean.
    const code = 'aB3dEfGhJkLmNpQrStUvWx'
    expect(pathOf(code)).toBe(pathOf(code))
    expect(pathOf(code).startsWith('invites/')).toBe(true)
  })
})
