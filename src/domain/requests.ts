/**
 * What a volunteer asked for from their own pass.
 *
 * "Ask to swap" and "Can't make it" wrote a document into a collection no screen read, so
 * the volunteer got a confirmation and the organizers never heard about it. A request that
 * nobody sees is worse than no button at all: it tells somebody their message was received.
 */

export type RequestKind = 'swap' | 'cancel' | 'help' | 'noShow' | 'question'

/**
 * What a volunteer can ask for, in the order somebody thinks of them.
 *
 * `noShow` is not offered: it is for reporting somebody *else* absent, which is an
 * organizer's judgement rather than a request. `question` catches everything the list does
 * not, because a form that cannot express the actual problem gets answered by a phone call
 * nobody logged.
 */
export const REQUEST_CHOICES: { kind: RequestKind; label: string }[] = [
  { kind: 'swap', label: 'Ask to swap' },
  { kind: 'cancel', label: 'Cannot make it' },
  { kind: 'help', label: 'Need a hand' },
  { kind: 'question', label: 'Something else' },
]

/**
 * Whether a request is about one shift or about the whole event.
 *
 * Only two of these are about a shift. "Cannot make it" and "ask to swap" are both requests
 * to change one, and an organizer holding either needs to know which — without it, somebody
 * rostered on both days is a name and a sentence, and the only action on offer takes them
 * off both.
 *
 * The other two are not. "Need a hand" is about the person, and "something else" is
 * whatever the list could not express; asking which shift they refer to invites an answer
 * that is not true, and a stale one attached to a question reads as a claim about a shift
 * nobody was talking about.
 */
export function needsShift(kind: RequestKind): boolean {
  return kind === 'swap' || kind === 'cancel'
}

export interface VolunteerRequest {
  id: string
  /** Which pass sent it. Organizers join this to a person through their pass list. */
  passToken: string
  kind: RequestKind
  /**
   * Which shift it is about, or empty for all of them.
   *
   * Without this a "cannot make it" was just a name and a sentence: an organizer holding it
   * could not tell whether the Friday evening or the Saturday morning was the problem, and
   * the only action on offer took the volunteer off both.
   */
  slotId: string
  message: string
  createdAt: number
  /** When an organizer dealt with it, or null while it is still waiting. */
  handledAt: number | null
  /** The uid of whoever dealt with it — the only part anything can vouch for. */
  handledBy: string
  /**
   * And their address, stored rather than looked up.
   *
   * The roster is admin-readable only, and this is shown on a screen organizers work from,
   * so it cannot be resolved on the way out the way the audit log resolves its own — the
   * lookup would simply be denied. Written at the time instead, which also means it still
   * reads correctly for somebody who has since left the roster.
   *
   * Empty on requests dealt with before it was recorded.
   */
  handledByEmail: string
}

const KINDS: RequestKind[] = ['swap', 'cancel', 'help', 'noShow', 'question']

export function readRequest(id: string, d: Record<string, unknown>): VolunteerRequest {
  const kind = KINDS.includes(d.kind as RequestKind) ? (d.kind as RequestKind) : 'question'
  return {
    id,
    passToken: typeof d.passToken === 'string' ? d.passToken : '',
    kind,
    slotId: typeof d.slotId === 'string' ? d.slotId : '',
    message: typeof d.message === 'string' ? d.message : '',
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
    handledAt: typeof d.handledAt === 'number' ? d.handledAt : null,
    handledBy: typeof d.handledBy === 'string' ? d.handledBy : '',
    handledByEmail: typeof d.handledByEmail === 'string' ? d.handledByEmail : '',
  }
}

/** How to describe a request in a list, in words rather than a field name. */
export function requestSummary(kind: RequestKind): string {
  switch (kind) {
    case 'cancel':
      return 'cannot make it'
    case 'swap':
      return 'asked to swap'
    case 'help':
      return 'needs a hand'
    case 'noShow':
      return 'reported a no-show'
    default:
      return 'asked a question'
  }
}

/**
 * Requests still waiting, oldest first.
 *
 * Oldest first because the queue is worked through, not skimmed: somebody who wrote in on
 * Wednesday should not end up behind somebody who wrote in an hour ago.
 */
export function waiting(requests: VolunteerRequest[]): VolunteerRequest[] {
  return requests
    .filter((r) => r.handledAt === null)
    .sort((a, b) => a.createdAt - b.createdAt)
}
