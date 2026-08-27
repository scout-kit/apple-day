import { describe, expect, it } from 'vitest'
import { syncLabel, syncTitle } from '../src/domain/syncing'

/**
 * Whether what somebody just did has reached the server.
 *
 * Offline persistence means a jar counted into a dead connection is accepted, shown, and sent
 * later — which is right, and which made an unsent count look exactly like a sent one. The
 * person at the table could not tell whether to write it on their hand as well.
 */

describe('the flag', () => {
  it('says nothing when there is nothing outstanding', () => {
    // The common case. A flag that is always up is furniture.
    expect(syncLabel({ saving: false }, true)).toBeNull()
    expect(syncLabel({ saving: false }, false)).toBeNull()
  })

  it('says it is going, when there is a connection to go over', () => {
    expect(syncLabel({ saving: true }, true)).toBe('Saving…')
  })

  it('says it has not gone, when there is not', () => {
    /*
      A different thing to somebody deciding whether to trust the screen: a queue draining
      over a live connection is gone in a moment, and one waiting for a signal may sit there
      for an hour.
    */
    expect(syncLabel({ saving: true }, false)).toBe('Not sent')
  })
})

describe('what the tooltip says', () => {
  it('reassures rather than alarms, when nothing is waiting', () => {
    expect(syncTitle({ saving: false }, true)).toMatch(/reached the server/)
  })

  it('says the queue survives the page being closed', () => {
    /*
      Said outright, because the instinct otherwise is to sit and stare at it — or worse, to
      do the same thing again on somebody else's phone, and count the money twice.
    */
    expect(syncTitle({ saving: true }, false)).toMatch(/including if you close this page/)
  })

  it('does not promise that offline, when there is a connection', () => {
    // Online it is already going; the sentence about closing the page would be noise.
    expect(syncTitle({ saving: true }, true)).not.toMatch(/close this page/)
    expect(syncTitle({ saving: true }, true)).toMatch(/kept on this device/)
  })
})
