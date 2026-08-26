import { describe, expect, it } from 'vitest'
import { isFatalClientFailure } from '../src/domain/clientFailure'

/**
 * A finished Firestore client, told apart from a failure worth retrying.
 *
 * Reported from the running app as a console full of identical errors: one failure that
 * could not recover, multiplied by every subscription retrying it four times.
 */

const REFUSAL = new Error(
  'refusing to open IndexedDB database due to potential corruption of the IndexedDB ' +
    'database data; this corruption could be caused by clicking the "clear site data" ' +
    'button in a web browser; try reloading the web page to re-initialize the IndexedDB ' +
    'database: lastClosedDbVersion=18, event.oldVersion=0, event.newVersion=18',
)

const TRANSACTION = new Error(
  "IndexedDB transaction 'Allocate target' failed: AbortError: Version change " +
    'transaction was aborted in upgradeneeded event handler.',
)

const ASSERTION = new Error(
  'FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: ca9) ' +
    'CONTEXT: {"ve":-1}',
)

const POISONED = new Error(
  'FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) ' +
    'CONTEXT: {"hc":"Error: FIRESTORE (11.10.0) INTERNAL ASSERTION FAILED: Unexpected ' +
    'state (ID: ca9) CONTEXT: {\\"ve\\":-1}"}',
)

describe('recognising a client that is finished', () => {
  it('recognises the offline store refusing to open', () => {
    expect(isFatalClientFailure(REFUSAL)).toBe(true)
  })

  it('recognises the transaction failure alongside it', () => {
    expect(isFatalClientFailure(TRANSACTION)).toBe(true)
  })

  it('recognises the broken invariant', () => {
    expect(isFatalClientFailure(ASSERTION)).toBe(true)
  })

  it('recognises the work queue refusing everything afterwards', () => {
    // Every subscription made after the first failure gets this one, for ever.
    expect(isFatalClientFailure(POISONED)).toBe(true)
  })

  it('does not mistake a denied read for it', () => {
    // The case that must keep retrying: a credential still on its way.
    expect(isFatalClientFailure(new Error('Missing or insufficient permissions.'))).toBe(
      false,
    )
    expect(
      isFatalClientFailure({ code: 'permission-denied', message: 'permission-denied' }),
    ).toBe(false)
  })

  it('does not mistake being offline for it', () => {
    // Worth retrying: the network comes back at a shop doorway.
    expect(
      isFatalClientFailure(new Error('Failed to get document because the client is offline.')),
    ).toBe(false)
  })

  it('survives whatever it is handed', () => {
    for (const junk of [null, undefined, '', 0, {}, []]) {
      expect(isFatalClientFailure(junk), String(junk)).toBe(false)
    }
  })
})
