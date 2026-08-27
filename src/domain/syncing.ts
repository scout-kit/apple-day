/**
 * Saying whether what somebody just did has reached the server.
 *
 * Offline persistence means a check-in taken with no bars is accepted, shown, and sent when
 * a signal comes back. That is the right behaviour and it has one cost: a jar counted into a
 * dead connection looks exactly like a jar counted into a live one. The person at the table
 * has no way to tell, so they cannot know whether to write it on their hand as well.
 *
 * The flag is about a write, where `useOnline` is about the connection. They are different
 * questions and both get asked: a tab can be online with a queue still draining, and offline
 * with nothing outstanding at all — in which case there is nothing to worry anybody about.
 */

export interface SyncState {
  /** Whether any write made here is still waiting to be acknowledged. */
  saving: boolean
}

/**
 * What the flag says, or nothing at all.
 *
 * Nothing is the common case, and a flag that is always up is furniture. The wording differs
 * by connection because the two mean different things to somebody deciding whether to trust
 * the screen: online, a queue is draining and will be gone in a moment; offline, it is
 * waiting for something that may not come for an hour.
 */
export function syncLabel(state: SyncState, online: boolean): string | null {
  if (!state.saving) return null
  return online ? 'Saving…' : 'Not sent'
}

/**
 * The longer version, for the tooltip.
 *
 * Says the reassuring part outright — this survives the page being closed, because the queue
 * is on the device rather than in the tab — since the instinct otherwise is to sit and stare
 * at it, or worse, to do it again somewhere else.
 */
export function syncTitle(state: SyncState, online: boolean): string {
  if (!state.saving) return 'Everything you have done here has reached the server.'
  return online
    ? 'Something you did here has not reached the server yet. It is kept on this device and is being sent.'
    : 'Something you did here has not reached the server yet. It is kept on this device — including if you close this page — and goes as soon as there is a signal.'
}
