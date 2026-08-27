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
  it('warns once when a pair is split, naming both', () => {
    // 2024 encoded this as "(w/ Boyan please)" inside the youth's name field.
    const people = people2025.map((p) => {
      if (p.id === 'y01') return { ...p, pairWithPersonId: 'y09' }
      if (p.id === 'y09') return { ...p, pairWithPersonId: 'y01' }
      return p
    })
    const split = run({ people }).filter((i) => i.code === 'splitPair')

    expect(split).toHaveLength(1)
    expect(split[0]!.personIds).toEqual(['y01', 'y09'])
  })

  it('checks a pairing recorded on only one of them', () => {
    // Whichever way round the ids sort. An earlier version reported each pair from the
    // lower id and skipped the higher, so a one-sided pairing was checked or ignored purely
    // by how the two ids happened to compare.
    for (const [holder, partner] of [
      ['y01', 'y09'],
      ['y09', 'y01'],
    ] as const) {
      const people = people2025.map((p) =>
        p.id === holder ? { ...p, pairWithPersonId: partner } : p,
      )
      const split = run({ people }).filter((i) => i.code === 'splitPair')
      expect(split.length, `${holder} -> ${partner}`).toBeGreaterThan(0)
      expect(split[0]!.personIds).toEqual(expect.arrayContaining([holder, partner]))
    }
  })

  it('does not warn twice for a pairing recorded on both', () => {
    const people = people2025.map((p) => {
      if (p.id === 'y01') return { ...p, pairWithPersonId: 'y09' }
      if (p.id === 'y09') return { ...p, pairWithPersonId: 'y01' }
      return p
    })
    // One pair, one warning, even though both sides point at each other.
    expect(run({ people }).filter((i) => i.code === 'splitPair')).toHaveLength(1)
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
    const byLocation = new Map(fridayAssignments2025.map((a) => [a.locationId, a]))
    const [first, second] = [...byLocation.keys()]
    const locations = locations2025.map((l) =>
      l.id === first ? { ...l, groupCode: 'LINDEN' }
      : l.id === second ? { ...l, groupCode: 'FARMERS' }
      : l,
    )
    const here = byLocation.get(first!)!
    const there = byLocation.get(second!)!

    const people = people2025.map((p) =>
      p.id === here.personId ? { ...p, pairWithPersonId: there.personId } : p,
    )
    expect(codes(run({ people, locations }))).toContain('splitPair')
  })

  it('does not treat two shops with no area as one', () => {
    /*
      Everything in the library starts with a blank code. Reading that as a group called ""
      would put every ungrouped shop in one enormous area, and a pair split across two ends
      of town would report nothing at all — the exact warning this is meant to keep.
    */
    const blank = locations2025.map((l) => ({ ...l, groupCode: '' }))
    const byLocation = new Map(fridayAssignments2025.map((a) => [a.locationId, a]))
    const [first, second] = [...byLocation.keys()]
    const here = byLocation.get(first!)!
    const there = byLocation.get(second!)!

    const people = people2025.map((p) =>
      p.id === here.personId ? { ...p, pairWithPersonId: there.personId } : p,
    )
    expect(codes(run({ people, locations: blank }))).toContain('splitPair')
  })

  it('names the area to fix rather than the one shop', () => {
    // "not at Linden Plaza" says any door in it will do; naming one shop reads as an order.
    const byLocation = new Map(fridayAssignments2025.map((a) => [a.locationId, a]))
    const [first, second] = [...byLocation.keys()]
    const locations = locations2025.map((l) =>
      l.id === first ? { ...l, groupCode: 'LINDEN' } : l,
    )
    const here = byLocation.get(first!)!
    const there = byLocation.get(second!)!

    const people = people2025.map((p) =>
      p.id === here.personId ? { ...p, pairWithPersonId: there.personId } : p,
    )
    const split = run({ people, locations }).filter((i) => i.code === 'splitPair')
    expect(split[0]!.message).toContain('LINDEN')
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
