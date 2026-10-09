import { describe, expect, it } from 'vitest'
import { summariseIssues, validateSchedule } from '../src/domain/validation'
import type { ScheduleIssue } from '../src/domain/validation'
import {
  fridayAssignments2025,
  locations2025,
  people2025,
  signups2025,
  slots2025,
} from './fixtures/appleDay2025'

/**
 * Friday only, with an empty signup list so each test sees just its own signal: the
 * fixture's signups cover both days, so against a Friday-only board every Saturday
 * volunteer would report no shift. Tests that exercise that check pass their own signups.
 */
function run(overrides: Partial<Parameters<typeof validateSchedule>[0]> = {}): ScheduleIssue[] {
  return validateSchedule({
    locations: locations2025,
    people: people2025,
    signups: [],
    assignments: fridayAssignments2025,
    slots: slots2025,
    ...overrides,
  })
}

const codes = (issues: ScheduleIssue[]) => issues.map((i) => i.code)

describe('the 2025 Friday schedule as actually built', () => {
  it('raises nothing at all', () => {
    // Nothing here is worth an organizer's attention: an empty location is visible on the
    // board, and somebody working a location alone is normal.
    expect(run()).toEqual([])
  })
})

describe('double booking', () => {
  it('is an error when one person is in two places in the same hour', () => {
    const assignments = [
      ...fridayAssignments2025,
      {
        id: 'clash', slotId: 'fri-1700', locationId: 'kelmont', personId: 'y01',
        status: 'planned' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null,
      },
    ]
    const issues = run({ assignments })
    const clash = issues.find((i) => i.code === 'doubleBooked')!

    expect(clash.severity).toBe('error')
    expect(clash.message).toContain('2 locations')
    expect(clash.assignmentIds).toHaveLength(2)
  })

  it('is only a warning when the same person is listed twice in one place', () => {
    const assignments = [
      ...fridayAssignments2025,
      {
        id: 'dupe', slotId: 'fri-1700', locationId: 'braemar-640', personId: 'y01',
        status: 'planned' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null,
      },
    ]
    const clash = run({ assignments }).find((i) => i.code === 'doubleBooked')!
    expect(clash.severity).toBe('warning')
    expect(clash.message).toContain('listed twice')
  })

  it('ignores a swapped-out assignment, which is the point of swapping', () => {
    const assignments = [
      ...fridayAssignments2025.map((a) =>
        a.personId === 'y01' && a.slotId === 'fri-1700'
          ? { ...a, status: 'swapped' as const }
          : a,
      ),
      {
        id: 'replacement', slotId: 'fri-1700', locationId: 'braemar-640', personId: 'y02',
        status: 'confirmed' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null,
      },
    ]
    expect(codes(run({ assignments }))).not.toContain('doubleBooked')
  })
})

describe('stated availability', () => {
  it('warns when someone is scheduled outside the slots they offered', () => {
    const signups = signups2025.map((s) =>
      s.personId === 'y01' ? { ...s, availability: { fri: ['fri-2000'], sat: [] } } : s,
    )
    const issue = run({ signups }).find((i) => i.code === 'outsideAvailability')!
    expect(issue.message).toContain('did not sign up')
    expect(issue.personIds).toEqual(['y01'])
  })

  it('warns when they offered no hours at all on that day', () => {
    /*
      Reported from the running app: putting somebody on a shift they had not signed up for
      did not always warn. This is the case it missed, and it is the strongest one there is
      — somebody who said "Friday only" placed on a Saturday shift.

      The check read an empty list for that day as "nothing stated, so nothing to
      contradict" and moved on. It is the opposite: they stated their hours, and none of
      them are this one.
    */
    const signups = signups2025.map((s) =>
      s.personId === 'y01' ? { ...s, availability: { fri: [], sat: ['sat-0900'] } } : s,
    )
    const raised = run({ signups }).filter((i) => i.code === 'outsideAvailability')

    expect(raised.length).toBeGreaterThan(0)
    expect(raised.every((i) => i.personIds[0] === 'y01')).toBe(true)
    expect(raised[0]!.message).toContain('did not offer any Friday hours')
  })

  it('warns when they signed up and offered nothing anywhere', () => {
    // A form response with every box left unticked. Worth saying rather than passing over in
    // silence.
    const signups = signups2025.map((s) =>
      s.personId === 'y01' ? { ...s, availability: { fri: [], sat: [] } } : s,
    )
    const raised = run({ signups }).filter((i) => i.code === 'outsideAvailability')

    expect(raised.length).toBeGreaterThan(0)
    expect(raised[0]!.message).toContain('without offering any hours')
  })

  it('still says nothing about somebody who never filled the form in', () => {
    /*
      A walk-in, or a name added by hand. They stated nothing to contradict, and reporting
      it puts a line on the board for every shift of an imported year — the 2025 archive has
      no signups at all, so this was tried and it buried the warnings that matter.
    */
    expect(run({ signups: [] })).toEqual([])
  })

  it('says nothing about a shift at an hour the location is shut', () => {
    // The board hatches a closed hour and withholds its picker, so getting a shift there
    // took a deliberate override. Repeating it as a warning adds nothing.
    const locations = locations2025.map((l) =>
      l.id === 'braemar-640'
        ? { ...l, openHours: { fri: { openMin: 18 * 60, closeMin: 21 * 60 }, sat: null } }
        : l,
    )
    expect(run({ locations })).toEqual([])
  })
})

describe('pairing', () => {
  /**
   * Two shifts in one hour at two different shops.
   *
   * What a split actually is, so every test below is about a pair who really are out at
   * the same time in different places. Asserted rather than skipped: a test that quietly
   * does nothing when the fixture changes shape is a test that passes for the wrong reason.
   */
  const sameHour = (slotId = 'fri-1800') => {
    const inHour = fridayAssignments2025.filter((a) => a.slotId === slotId)
    const here = inHour[0]
    const there = inHour.find((a) => here && a.locationId !== here.locationId)
    if (!here || !there) throw new Error(`the fixture no longer staffs two shops at ${slotId}`)
    return { here, there }
  }

  /** The pairing recorded on one of them, on both, or on neither. */
  const pairUp = (a: string, b: string, both = true) =>
    people2025.map((p) => {
      if (p.id === a) return { ...p, pairWithPersonId: b }
      if (both && p.id === b) return { ...p, pairWithPersonId: a }
      return p
    })

  it('warns once when a pair is split, naming both', () => {
    // 2024 encoded this as "(w/ Boyan please)" inside the youth's name field.
    const { here, there } = sameHour()
    const split = run({ people: pairUp(here.personId, there.personId) }).filter(
      (i) => i.code === 'splitPair',
    )

    expect(split).toHaveLength(1)
    expect(split[0]!.personIds).toEqual(
      [here.personId, there.personId].sort(),
    )
  })

  it('checks a pairing recorded on only one of them', () => {
    // Whichever way round the ids sort. An earlier version reported each pair from the
    // lower id and skipped the higher, so a one-sided pairing was checked or ignored purely
    // by how the two ids happened to compare.
    const { here, there } = sameHour()
    for (const [holder, partner] of [
      [here.personId, there.personId],
      [there.personId, here.personId],
    ] as const) {
      const split = run({ people: pairUp(holder, partner, false) }).filter(
        (i) => i.code === 'splitPair',
      )
      expect(split.length, `${holder} -> ${partner}`).toBeGreaterThan(0)
      expect(split[0]!.personIds).toEqual(expect.arrayContaining([holder, partner]))
    }
  })

  it('does not warn twice for a pairing recorded on both', () => {
    const { here, there } = sameHour()
    // One pair, one warning, even though both sides point at each other.
    expect(
      run({ people: pairUp(here.personId, there.personId) }).filter(
        (i) => i.code === 'splitPair',
      ),
    ).toHaveLength(1)
  })

  it('ignores a person paired with themselves', () => {
    const people = people2025.map((p) =>
      p.id === 'y01' ? { ...p, pairWithPersonId: 'y01' } : p,
    )
    expect(run({ people }).filter((i) => i.code === 'splitPair')).toEqual([])
  })

  it('stays quiet when the pair is in one plaza, at different doors', () => {
    /*
      The point of the whole thing. Two siblings asked to stay together do not have to be at
      the same door: a plaza with a grocer at one end and a chemist at the other is one place
      to the parent dropping them off, and a door each covers twice the footfall.
    */
    const [first, second] = [...new Set(fridayAssignments2025.map((a) => a.locationId))]
    const locations = locations2025.map((l) =>
      l.id === first || l.id === second ? { ...l, groupCode: 'LINDEN' } : l,
    )

    const pairedAcross = fridayAssignments2025.filter(
      (a) => a.locationId === first || a.locationId === second,
    )
    const [here, there] = [
      pairedAcross.find((a) => a.locationId === first)!,
      pairedAcross.find((a) => a.locationId === second && a.slotId === pairedAcross[0]!.slotId),
    ]
    // Asserted rather than skipped: a test that quietly does nothing when the fixture
    // changes shape is a test that passes for the wrong reason.
    if (!there) throw new Error('the fixture no longer staffs both doors in one hour')

    const people = people2025.map((p) => {
      if (p.id === here.personId) return { ...p, pairWithPersonId: there.personId }
      if (p.id === there.personId) return { ...p, pairWithPersonId: here.personId }
      return p
    })

    const split = run({ people, locations }).filter((i) => i.code === 'splitPair')
    expect(split.map((i) => i.personIds)).not.toContainEqual(
      expect.arrayContaining([here.personId, there.personId]),
    )
  })

  it('still warns when the two areas are different', () => {
    const { here, there } = sameHour()
    const locations = locations2025.map((l) =>
      l.id === here.locationId ? { ...l, groupCode: 'LINDEN' }
      : l.id === there.locationId ? { ...l, groupCode: 'FARMERS' }
      : l,
    )

    expect(
      codes(run({ people: pairUp(here.personId, there.personId, false), locations })),
    ).toContain('splitPair')
  })

  it('does not treat two shops with no area as one', () => {
    /*
      Everything in the library starts with a blank code. Reading that as a group called ""
      would put every ungrouped shop in one enormous area, and a pair split across two ends
      of town would report nothing at all — the exact warning this is meant to keep.
    */
    const blank = locations2025.map((l) => ({ ...l, groupCode: '' }))
    const { here, there } = sameHour()

    expect(
      codes(run({ people: pairUp(here.personId, there.personId, false), locations: blank })),
    ).toContain('splitPair')
  })

  it('names the area to fix rather than the one shop', () => {
    // "not at Linden Plaza" says any door in it will do; naming one shop reads as an order.
    const { here, there } = sameHour()
    const locations = locations2025.map((l) =>
      l.id === here.locationId ? { ...l, groupCode: 'LINDEN' } : l,
    )

    const split = run({
      people: pairUp(here.personId, there.personId, false),
      locations,
    }).filter((i) => i.code === 'splitPair')
    expect(split[0]!.message).toContain('LINDEN')
  })

  /**
   * The hour decides it, and availability answers for the hour.
   *
   * A pair is split when both are out in one hour in different places, or when one is out
   * and the other said they were free for it and has been left off. The partner simply
   * missing from a shift is neither: most often they never offered the hour, and a warning
   * against every shift the sibling who *was* free had been given buried the warnings worth
   * reading on a board that was correct.
   */
  describe('when the partner is not on this shift', () => {
    /** A real youth who is simply not on the fixture's Friday board at all. */
    const ABSENT = 'y30'

    const withPartner = (holder: string, partner: string) =>
      people2025.map((p) => (p.id === holder ? { ...p, pairWithPersonId: partner } : p))

    const splits = (...args: Parameters<typeof run>) =>
      run(...args).filter((i) => i.code === 'splitPair')

    it('says nothing when the partner is out in a different hour', () => {
      /*
        The case this was reported from. Both of them are on the board — one at seven, the
        other not — so a rule about whether the partner has *any* shift does not catch it.
        The partner is not somewhere else at seven; they are not out at seven.
      */
      const { here } = sameHour('fri-1900')
      const elsewhere = fridayAssignments2025.find(
        (a) => a.slotId !== here.slotId && a.personId !== here.personId,
      )!

      expect(splits({ people: withPartner(here.personId, elsewhere.personId) })).toEqual([])
    })

    it('says nothing when the partner never offered that hour', () => {
      /*
        Said in the data rather than inferred from the board: the partner signed up for the
        six o'clock hour and nothing else, and is paired with somebody working seven. There
        is no arrangement of the board that would satisfy a warning about it — the hour is
        not one of theirs to work.
      */
      const { here } = sameHour('fri-1900')
      const partner = fridayAssignments2025.find((a) => a.slotId === 'fri-1800')!.personId
      const signups = [
        {
          id: 'su-partner', personId: partner,
          availability: { fri: ['fri-1800'], sat: [] },
          attendingWithYouth: true, notes: '', sourceRow: 1, importedAt: 0,
        },
      ]

      expect(splits({ people: withPartner(here.personId, partner), signups })).toEqual([])
    })

    it('says nothing when the partner has no shift at all', () => {
      expect(splits({ people: withPartner('y01', ABSENT) })).toEqual([])
    })

    it('says nothing whichever of them the pairing was recorded on', () => {
      // The ids sort either way round, and the check reads from the lower one — so without
      // this the silence would depend on how two ids happen to compare.
      for (const [holder, partner] of [
        ['y01', ABSENT],
        [ABSENT, 'y01'],
      ] as const) {
        expect(
          splits({ people: withPartner(holder, partner) }),
          `${holder} -> ${partner}`,
        ).toEqual([])
      }
    })

    it('says nothing once per shift rather than once in total', () => {
      // The shape of the complaint: one sibling who is not out this hour, and a warning
      // against every hour the other one works.
      const busy = [
        ...fridayAssignments2025,
        { id: 'extra-1', slotId: 'fri-1900', locationId: 'kelmont', personId: 'y01',
          status: 'planned' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null },
        { id: 'extra-2', slotId: 'fri-2000', locationId: 'kelmont', personId: 'y01',
          status: 'planned' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null },
      ]
      expect(splits({ people: withPartner('y01', ABSENT), assignments: busy })).toEqual([])
    })

    it('warns the moment the two of them share an hour', () => {
      /*
        The other half of the rule, and why this is a gate rather than a deletion: two
        people out in the same hour and not in the same place is what the warning is for.
      */
      const { here } = sameHour('fri-1700')
      const together = [
        ...fridayAssignments2025,
        { id: 'late', slotId: here.slotId, locationId: 'kelmont', personId: ABSENT,
          status: 'planned' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null },
      ]
      const split = splits({
        people: withPartner(here.personId, ABSENT),
        assignments: together,
      })

      expect(split).toHaveLength(1)
      expect(split[0]!.personIds).toEqual(expect.arrayContaining([here.personId, ABSENT]))
    })

    it('speaks up once the partner says they are free then', () => {
      /*
        The hour is the question, and availability is how it is answered. The same board as
        the test above, plus a signup putting the partner's name against the hour their
        sibling works: they could be standing beside them and are not, which is something an
        organizer can act on.

        It does not replace `noShifts`. That one says this volunteer is going unused; this
        one says where to use them.
      */
      const signups = [
        {
          id: 'su-absent', personId: ABSENT,
          availability: { fri: ['fri-1700'], sat: [] },
          attendingWithYouth: true, notes: '', sourceRow: 99, importedAt: 0,
        },
      ]
      const issues = run({ people: withPartner('y01', ABSENT), signups })
      const split = issues.filter((i) => i.code === 'splitPair')

      expect(split).toHaveLength(1)
      expect(split[0]!.message).toContain('is free during')
      expect(split[0]!.personIds).toEqual(expect.arrayContaining(['y01', ABSENT]))
      // And the other warning is still its own: once, about them, by name.
      expect(issues.filter((i) => i.code === 'noShifts')).toHaveLength(1)
    })

    it('speaks up for a partner who is working elsewhere that evening', () => {
      /*
        The case this was reported from, the other way round. The partner is on the board —
        just not in this hour — and has said they are free for it. Being busy at six is no
        reason not to be put beside their sibling at seven.
      */
      const { here } = sameHour('fri-1900')
      const partner = fridayAssignments2025.find((a) => a.slotId === 'fri-1800')!.personId
      const signups = [
        {
          id: 'su-partner', personId: partner,
          availability: { fri: ['fri-1800', 'fri-1900'], sat: [] },
          attendingWithYouth: true, notes: '', sourceRow: 1, importedAt: 0,
        },
      ]
      const split = splits({ people: withPartner(here.personId, partner), signups })

      // The seven o'clock hour they both could work, and not the six they do not share.
      expect(split).toHaveLength(1)
      expect(split[0]!.message).toContain('7:00 PM')
      expect(split[0]!.message).toContain('is free during')
    })

    it('reads availability from either end of the pairing', () => {
      // The check works the pair from the lower id, so without this the warning would
      // appear or not according to how two ids happen to sort.
      const { here } = sameHour('fri-1900')
      const partner = fridayAssignments2025.find((a) => a.slotId === 'fri-1800')!.personId
      const signups = [
        {
          id: 'su-partner', personId: partner,
          availability: { fri: ['fri-1900'], sat: [] },
          attendingWithYouth: true, notes: '', sourceRow: 1, importedAt: 0,
        },
      ]

      for (const [holder, other] of [
        [here.personId, partner],
        [partner, here.personId],
      ] as const) {
        expect(
          splits({ people: withPartner(holder, other), signups }),
          `${holder} -> ${other}`,
        ).toHaveLength(1)
      }
    })

    it('counts a shift somebody did not turn up for as being out', () => {
      // A no-show was rostered: the pair really was put in two places that hour, and the
      // board still has the row. Only a swapped-away row is gone.
      const { here } = sameHour('fri-1700')
      const noShow = [
        ...fridayAssignments2025,
        { id: 'absent-row', slotId: here.slotId, locationId: 'kelmont', personId: ABSENT,
          status: 'noShow' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null },
      ]
      expect(
        codes(run({ people: withPartner(here.personId, ABSENT), assignments: noShow })),
      ).toContain('splitPair')
    })

    it('does not count a shift handed to somebody else', () => {
      // Swapped away is not on the board — the same rule every other check here follows.
      const { here } = sameHour('fri-1700')
      const swapped = [
        ...fridayAssignments2025,
        { id: 'given-away', slotId: here.slotId, locationId: 'kelmont', personId: ABSENT,
          status: 'swapped' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null },
      ]
      expect(
        codes(run({ people: withPartner(here.personId, ABSENT), assignments: swapped })),
      ).not.toContain('splitPair')
    })
  })

  it('stays quiet when the pair is together', () => {
    const people = people2025.map((p) => {
      if (p.id === 'y02') return { ...p, pairWithPersonId: 'y03' }
      if (p.id === 'y03') return { ...p, pairWithPersonId: 'y02' }
      return p
    })
    expect(codes(run({ people }))).not.toContain('splitPair')
  })
})

describe('people and places that fall through the cracks', () => {
  it('names volunteers who offered time and got no shift', () => {
    const signups = [
      {
        id: 'su-keen', personId: 'y99',
        availability: { fri: ['fri-1700', 'fri-1800'], sat: [] },
        attendingWithYouth: true, notes: '', sourceRow: 99, importedAt: 0,
      },
    ]
    const people = [
      ...people2025,
      {
        id: 'y99', firstName: 'Keen', lastName: 'Volunteer', section: 'cubs' as const,
        parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
      },
    ]
    const issue = run({ signups, people }).find(
      (i) => i.code === 'noShifts' && i.personIds.includes('y99'),
    )!
    expect(issue.message).toContain('offered 2 slots')
  })

})

describe('ordering and summary', () => {
  it('puts errors first so the board banner leads with them', () => {
    const assignments = [
      ...fridayAssignments2025,
      {
        id: 'ghost', slotId: 'fri-1700', locationId: 'does-not-exist', personId: 'nobody',
        status: 'planned' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null,
      },
    ]
    const issues = run({ assignments })
    expect(issues[0]!.severity).toBe('error')
    expect(codes(issues)).toContain('unknownReference')

    const summary = summariseIssues(issues)
    expect(summary.error).toBeGreaterThan(0)
  })
})

describe('what is deliberately not reported', () => {
  it('says nothing about an empty location', () => {
    // Visible on the board as an empty cell; a warning on top of that is noise.
    const issues = validateSchedule({
      locations: locations2025,
      people: people2025,
      signups: [],
      assignments: [],
      slots: slots2025,
    })
    expect(issues).toEqual([])
  })

  it('says nothing about somebody working a location alone', () => {
    const alone = [
      {
        id: 'solo', slotId: 'fri-1700', locationId: 'braemar-640', personId: 'y01',
        status: 'planned' as const, whereabouts: 'here' as const, checkedInAt: null, checkedOutAt: null,
      },
    ]
    expect(run({ assignments: alone })).toEqual([])
  })
})
