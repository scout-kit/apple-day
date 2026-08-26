import { describe, expect, it } from 'vitest'
import {
  buildAudience,
  fullySent,
  ledgerId,
  normaliseEmail,
  outstanding,
  selectionKey,
  sendHistory,
  sentFor,
} from '../src/domain/reminders'
import type { Selection, SentRecord } from '../src/domain/reminders'
import { DEFAULT_TEMPLATES, fillTemplate } from '../src/domain/reminderText'
import type { Assignment, Person, Slot } from '../src/domain/types'

/**
 * Who a reminder goes to.
 *
 * Worth testing hard and worth testing pure: the cost of getting this wrong is an email to
 * somebody's parent about a shift that is not theirs, or a second copy of one they already
 * had. None of it needs a browser.
 */

const SLOTS: Slot[] = [
  { id: 'fri-1700', day: 'fri', startMin: 1020, endMin: 1080, label: '5:00 PM' },
  { id: 'fri-1800', day: 'fri', startMin: 1080, endMin: 1140, label: '6:00 PM' },
  { id: 'sat-0900', day: 'sat', startMin: 540, endMin: 600, label: '9:00 AM' },
  { id: 'sat-1000', day: 'sat', startMin: 600, endMin: 660, label: '10:00 AM' },
]

const person = (id: string, first: string, over: Partial<Person> = {}): Person => ({
  id, firstName: first, lastName: 'Ramsahai', section: 'cubs',
  parentName: 'Ada Ramsahai', parentEmail: 'ada@example.org', parentPhone: '519-555-0100',
  pairWithPersonId: null, ...over,
})

const shift = (
  id: string, personId: string, slotId: string, over: Partial<Assignment> = {},
): Assignment => ({
  id, slotId, locationId: 'sobeys', personId,
  status: 'confirmed', whereabouts: 'here', checkedInAt: null, checkedOutAt: null, ...over,
})

const input = (people: Person[], assignments: Assignment[]) => ({
  people,
  assignments,
  slots: SLOTS,
  tokenByPerson: new Map(people.map((p) => [p.id, `tok-${p.id}`])),
  origin: 'https://appleday.example.org',
})

const EVENT: Selection = { kind: 'event' }
const SATURDAY: Selection = { kind: 'day', day: 'sat' }
const NINE: Selection = { kind: 'slot', slotId: 'sat-0900' }

describe('what the selection covers', () => {
  const people = [person('p1', 'Elliot'), person('p2', 'Boyan', { parentEmail: 'b@example.org' })]
  const assignments = [
    shift('a1', 'p1', 'fri-1700'),
    shift('a2', 'p1', 'sat-0900'),
    shift('a3', 'p2', 'sat-1000'),
  ]

  it('takes everybody with any shift, for the whole event', () => {
    const { recipients } = buildAudience(EVENT, 'all', input(people, assignments))
    expect(recipients.map((r) => r.email)).toEqual(['ada@example.org', 'b@example.org'])
  })

  it('takes only that day, for a day', () => {
    const { recipients } = buildAudience(SATURDAY, 'all', input(people, assignments))
    expect(recipients).toHaveLength(2)
    // Elliot works the Friday too, and a Saturday reminder must not mention it.
    const elliot = recipients[0]!.youths[0]!
    expect(elliot.shifts.map((s) => s.slotId)).toEqual(['sat-0900'])
  })

  it('takes only that hour, for a shift', () => {
    const { recipients } = buildAudience(NINE, 'all', input(people, assignments))
    expect(recipients.map((r) => r.email)).toEqual(['ada@example.org'])
  })

  it('leaves out a shift that has been swapped away', () => {
    /*
      Matches `buildPassShifts`, which is what fills a pass. A reminder naming a shift the
      pass does not show would send somebody to a location that is no longer theirs.
    */
    const swapped = [shift('a9', 'p1', 'sat-0900', { status: 'swapped' })]
    const { recipients } = buildAudience(SATURDAY, 'all', input([people[0]!], swapped))
    expect(recipients).toEqual([])
  })

  it('ignores a shift belonging to somebody no longer on the roster', () => {
    // A removal part-way through. There is nobody to send to.
    const orphan = [shift('a9', 'ghost', 'sat-0900')]
    const { recipients, unreachable } = buildAudience(SATURDAY, 'all', input(people, orphan))
    expect(recipients).toEqual([])
    expect(unreachable).toEqual([])
  })
})

describe('grouping a family into one message', () => {
  it('gives one email covering both children, with a link each', () => {
    /*
      The whole reason the unit is an address rather than a person. Two near-identical
      emails a second apart is how a parent learns to ignore them.
    */
    const people = [
      person('p1', 'Elliot', { parentEmail: 'ada@example.org' }),
      person('p2', 'Nadia', { parentEmail: 'ada@example.org' }),
    ]
    const { recipients } = buildAudience(
      SATURDAY, 'all',
      input(people, [shift('a1', 'p1', 'sat-0900'), shift('a2', 'p2', 'sat-1000')]),
    )

    expect(recipients).toHaveLength(1)
    expect(recipients[0]!.youths.map((y) => y.person.firstName)).toEqual(['Elliot', 'Nadia'])
    expect(recipients[0]!.youths.map((y) => y.passUrl)).toEqual([
      'https://appleday.example.org/p/tok-p1',
      'https://appleday.example.org/p/tok-p2',
    ])
  })

  it('groups two spellings of the same address', () => {
    // One parent, filling the form in twice, six months apart.
    const people = [
      person('p1', 'Elliot', { parentEmail: 'Ada@Example.org ' }),
      person('p2', 'Nadia', { parentEmail: ' ada@example.ORG' }),
    ]
    const { recipients } = buildAudience(
      SATURDAY, 'all',
      input(people, [shift('a1', 'p1', 'sat-0900'), shift('a2', 'p2', 'sat-0900')]),
    )
    expect(recipients).toHaveLength(1)
    expect(recipients[0]!.email).toBe('ada@example.org')
  })

  it('covers only the sibling the selection applies to', () => {
    const people = [
      person('p1', 'Elliot', { parentEmail: 'ada@example.org' }),
      person('p2', 'Nadia', { parentEmail: 'ada@example.org' }),
    ]
    const { recipients } = buildAudience(
      NINE, 'all',
      input(people, [shift('a1', 'p1', 'sat-0900'), shift('a2', 'p2', 'sat-1000')]),
    )
    expect(recipients[0]!.youths.map((y) => y.person.firstName)).toEqual(['Elliot'])
  })

  it('takes the greeting from whichever sibling has a parent named', () => {
    const people = [
      person('p1', 'Elliot', { parentName: '' }),
      person('p2', 'Nadia', { parentName: 'Ada Ramsahai' }),
    ]
    const { recipients } = buildAudience(
      SATURDAY, 'all',
      input(people, [shift('a1', 'p1', 'sat-0900'), shift('a2', 'p2', 'sat-0900')]),
    )
    expect(recipients[0]!.parentName).toBe('Ada Ramsahai')
  })
})

describe('who cannot be reached', () => {
  it('lists them apart, with a phone number where there is one', () => {
    // Not an error and not silence: the organizer rings these instead.
    const people = [person('p1', 'Elliot', { parentEmail: '', parentPhone: '519-555-0100' })]
    const { recipients, unreachable } = buildAudience(
      SATURDAY, 'all', input(people, [shift('a1', 'p1', 'sat-0900')]),
    )
    expect(recipients).toEqual([])
    expect(unreachable).toHaveLength(1)
    expect(unreachable[0]!.phone).toBe('519-555-0100')
  })

  it('counts whitespace as no address at all', () => {
    const people = [person('p1', 'Elliot', { parentEmail: '   ' })]
    const { unreachable } = buildAudience(
      SATURDAY, 'all', input(people, [shift('a1', 'p1', 'sat-0900')]),
    )
    expect(unreachable).toHaveLength(1)
  })

  it('still sends to somebody with no pass yet, without a link', () => {
    // Added since the last publish. Better a reminder with no link than no reminder.
    const people = [person('p1', 'Elliot')]
    const built = input(people, [shift('a1', 'p1', 'sat-0900')])
    built.tokenByPerson = new Map()
    const { recipients } = buildAudience(SATURDAY, 'all', built)
    expect(recipients).toHaveLength(1)
    expect(recipients[0]!.youths[0]!.passUrl).toBe('')
  })
})

describe('the not-checked-in filter', () => {
  const people = [person('p1', 'Elliot')]
  const only = (over: Partial<Assignment>) =>
    buildAudience(SATURDAY, 'notCheckedIn', input(people, [shift('a1', 'p1', 'sat-0900', over)]))
      .recipients

  it('keeps somebody who is expected', () => {
    expect(only({ status: 'confirmed' })).toHaveLength(1)
    expect(only({ status: 'planned' })).toHaveLength(1)
  })

  it('drops somebody who has arrived', () => {
    expect(only({ status: 'checkedIn' })).toEqual([])
  })

  it('drops somebody already marked absent', () => {
    // Chasing them is what the phone is for; a "we are expecting you" email is not true.
    expect(only({ status: 'noShow' })).toEqual([])
  })

  it('keeps somebody who worked one stretch and has not arrived for another', () => {
    /*
      Asked per run rather than across the lot. Somebody who did the Friday and has not
      turned up for the Saturday is still worth chasing about the Saturday — asking over
      both at once answers "arrived" and says nothing useful.
    */
    const { recipients } = buildAudience(EVENT, 'notCheckedIn', input(people, [
      shift('a1', 'p1', 'fri-1700', { status: 'checkedIn' }),
      shift('a2', 'p1', 'sat-0900', { status: 'confirmed' }),
    ]))
    expect(recipients).toHaveLength(1)
  })

  it('drops somebody who has arrived for a run spanning two hours', () => {
    // Consecutive shifts at one location are one stretch; checking in covers both.
    const { recipients } = buildAudience(SATURDAY, 'notCheckedIn', input(people, [
      shift('a1', 'p1', 'sat-0900', { status: 'checkedIn' }),
      shift('a2', 'p1', 'sat-1000', { status: 'confirmed' }),
    ]))
    expect(recipients).toEqual([])
  })
})

describe('the key a send is recorded under', () => {
  it('names what the reminder was about', () => {
    expect(selectionKey({ kind: 'event' })).toBe('event')
    expect(selectionKey({ kind: 'day', day: 'sat' })).toBe('day-sat')
    expect(selectionKey({ kind: 'slot', slotId: 'sat-0900' })).toBe('slot-sat-0900')
  })

  it('tells the whole event apart from a day and from an hour', () => {
    // Three different reminders about overlapping shifts; none is a repeat of another.
    const keys = [
      selectionKey({ kind: 'event' }),
      selectionKey({ kind: 'day', day: 'sat' }),
      selectionKey({ kind: 'slot', slotId: 'sat-0900' }),
    ]
    expect(new Set(keys).size).toBe(3)
  })
})

describe('what a message records', () => {
  it('carries the assignments, not the hours', () => {
    /*
      A shift can move to another location at the same hour. "We already told them about
      this" should be false when it has, and slot ids alone could not tell.
    */
    const people = [person('p1', 'Elliot')]
    const { recipients } = buildAudience(SATURDAY, 'all', input(people, [
      shift('a2', 'p1', 'sat-1000'),
      shift('a1', 'p1', 'sat-0900'),
    ]))
    expect(recipients[0]!.youths[0]!.assignmentIds).toEqual(['a1', 'a2'])
  })

  it('trims a trailing slash off the origin rather than doubling it', () => {
    const people = [person('p1', 'Elliot')]
    const built = { ...input(people, [shift('a1', 'p1', 'sat-0900')]), origin: 'https://x.org/' }
    const { recipients } = buildAudience(SATURDAY, 'all', built)
    expect(recipients[0]!.youths[0]!.passUrl).toBe('https://x.org/p/tok-p1')
  })
})

describe('normalising an address', () => {
  it('trims and lowercases', () => {
    expect(normaliseEmail('  Ada@Example.ORG ')).toBe('ada@example.org')
  })
})

describe('what has already been sent', () => {
  const recipient = (ids: string[]) => ({
    email: 'ada@example.org',
    parentName: 'Ada Ramsahai',
    youths: ids.map((id) => ({
      person: person(id, id), shifts: [], assignmentIds: [], passUrl: '',
    })),
  })

  it('is keyed by wording, what it was about, and the youth', () => {
    expect(ledgerId('shift_upcoming', SATURDAY, 'p1')).toBe('shift_upcoming__day-sat__p1')
  })

  it('treats different wording about the same shift as a different reminder', () => {
    /*
      The distinction the whole ledger exists for: "here are your shifts" and "you have not
      checked in" about the same hour are two things worth saying. Sending the same wording
      twice is the accident.
    */
    expect(ledgerId('shift_upcoming', NINE, 'p1')).not.toBe(ledgerId('not_checked_in', NINE, 'p1'))
  })

  it('treats the same wording about a different selection as a different reminder', () => {
    expect(ledgerId('shift_upcoming', SATURDAY, 'p1')).not.toBe(
      ledgerId('shift_upcoming', NINE, 'p1'),
    )
    expect(ledgerId('shift_upcoming', EVENT, 'p1')).not.toBe(
      ledgerId('shift_upcoming', SATURDAY, 'p1'),
    )
  })

  it('flags the same wording for the same shifts as a repeat', () => {
    expect(ledgerId('shift_upcoming', NINE, 'p1')).toBe(ledgerId('shift_upcoming', NINE, 'p1'))
  })

  it('skips an address only when every child on it has already had the message', () => {
    /*
      A parent whose second child went on the board this morning has not been told about
      that child. Skipping the address on the strength of the first would drop them
      silently, which is the failure the admin would never see.
    */
    const both = recipient(['p1', 'p2'])
    expect(fullySent(both, new Set(['p1']))).toBe(false)
    expect(fullySent(both, new Set(['p1', 'p2']))).toBe(true)
    expect(outstanding(both, new Set(['p1'])).map((y) => y.person.id)).toEqual(['p2'])
  })

  it('sends the whole message when nothing has gone yet', () => {
    expect(fullySent(recipient(['p1']), new Set())).toBe(false)
    expect(outstanding(recipient(['p1']), new Set())).toHaveLength(1)
  })
})

describe('what a reminder must never say', () => {
  it('carries the time of a shift and nothing about where it is', () => {
    /*
      The rule this protects is not local to the templates: nobody is told which shop they
      are on until they have reported to base and been checked in, which is what
      `revealShifts` guards on a pass (see `domain/passes`). An email cannot be taken back,
      so it is the one place that rule has to hold absolutely.

      Run through the real builder, with a real location on the assignment, so a field
      creeping back into the shift shape would surface here rather than in a mailbox.
    */
    const people = [person('p1', 'Elliot')]
    const { recipients } = buildAudience(
      EVENT, 'all', input(people, [shift('a1', 'p1', 'sat-0900')]),
    )
    const only = recipients[0]!

    // The shift knows when, and has nowhere to put where.
    expect(only.youths[0]!.shifts).toEqual([
      { slotId: 'sat-0900', day: 'Saturday', slotLabel: '9:00 AM' },
    ])

    const ctx = { eventName: 'Apple Day 2026', occasion: 'Saturday', supportLine: '' }
    for (const t of DEFAULT_TEMPLATES) {
      const text = `${fillTemplate(t.subject, only, ctx)} ${fillTemplate(t.body, only, ctx)}`
      expect(text, t.id).toContain('9:00 AM')
      for (const leak of ['sobeys', 'Sobeys', 'Parkside', 'maps.google']) {
        expect(text, `${t.id} leaked ${leak}`).not.toContain(leak)
      }
    }
  })

  it('keeps a shift whose location has been removed from the library', () => {
    /*
      It used to lose it. The shape came from `buildPassShifts`, which drops a shift it
      cannot resolve a location for — so a shop deleted from the library quietly took its
      shifts out of somebody's reminder. Now that no location is named, the time is all
      that was ever needed.
    */
    const people = [person('p1', 'Elliot')]
    const orphaned = [shift('a1', 'p1', 'sat-0900', { locationId: 'deleted-shop' })]
    const { recipients } = buildAudience(EVENT, 'all', input(people, orphaned))

    expect(recipients[0]!.youths[0]!.shifts.map((s) => s.slotLabel)).toEqual(['9:00 AM'])
  })
})

describe('reading back what has been sent', () => {
  const record = (over: Partial<SentRecord> = {}): SentRecord => ({
    templateId: 'shift_upcoming',
    selectionKey: 'day-sat',
    personId: 'p1',
    sentAt: 1000,
    sentByEmail: 'organizer@example.org',
    ...over,
  })

  it('finds who has had one particular reminder', () => {
    const found = sentFor(
      [record(), record({ personId: 'p2', sentAt: 2000 }), record({ selectionKey: 'event' })],
      'shift_upcoming',
      SATURDAY,
    )
    expect([...found.keys()].sort()).toEqual(['p1', 'p2'])
    expect(found.get('p2')).toBe(2000)
  })

  it('does not confuse one wording with another about the same shift', () => {
    // The distinction the ledger key exists for, read back the same way.
    const records = [record({ templateId: 'not_checked_in' })]
    expect(sentFor(records, 'shift_upcoming', SATURDAY).size).toBe(0)
    expect(sentFor(records, 'not_checked_in', SATURDAY).size).toBe(1)
  })

  it('does not confuse a day with an hour inside it', () => {
    const records = [record({ selectionKey: 'slot-sat-0900' })]
    expect(sentFor(records, 'shift_upcoming', SATURDAY).size).toBe(0)
    expect(sentFor(records, 'shift_upcoming', NINE).size).toBe(1)
  })

  it('groups a send into one line, however many people it reached', () => {
    /*
      The ledger is one row per youth — right for "has this one had it", wrong for "what
      have we sent". Grouped by the pair that makes one reminder a different reminder.
    */
    const [only] = sendHistory([
      record({ personId: 'p1', sentAt: 1000 }),
      record({ personId: 'p2', sentAt: 1500 }),
      record({ personId: 'p3', sentAt: 1200 }),
    ])
    expect(only!.people).toBe(3)
    // The last one to go, not the first — "when did this finish" is the useful reading.
    expect(only!.lastAt).toBe(1500)
  })

  it('keeps separate sends separate, newest first', () => {
    const lines = sendHistory([
      record({ sentAt: 1000 }),
      record({ templateId: 'not_checked_in', sentAt: 3000 }),
      record({ selectionKey: 'event', sentAt: 2000 }),
    ])
    expect(lines.map((l) => l.lastAt)).toEqual([3000, 2000, 1000])
  })

  it('has nothing to say before anything has been sent', () => {
    expect(sendHistory([])).toEqual([])
  })
})
