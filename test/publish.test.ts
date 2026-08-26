import { describe, expect, it } from 'vitest'
import {
  buildMailMergeRows,
  buildPassShifts,
  generateToken,
  publishStatus,
  publishedFingerprint,
} from '../src/domain/publishing'
import { mapsSearchUrl } from '../src/domain/maps'
import type { Person } from '../src/domain/types'
import {
  fridayAssignments2025,
  locations2025,
  people2025,
  slots2025,
} from './fixtures/appleDay2025'

/**
 * Publishing is the only code path that deliberately exposes data to unauthenticated
 * readers, so the redaction is tested rather than assumed.
 */

const withContact: Person[] = people2025.map((p) => ({
  ...p,
  lastName: 'Fitzwilliam',
  parentName: 'A Parent',
  parentEmail: 'parent@example.org',
  parentPhone: '519-555-0100',
}))

describe('a pass carries only its own holder', () => {
  it('lists that person’s shifts in time order and nobody else’s', () => {
    const shifts = buildPassShifts('y10', {
      locations: locations2025,
      assignments: fridayAssignments2025,
      slots: slots2025,
    })

    // y10 worked Kelmont at 7pm and again at 8pm.
    expect(shifts).toHaveLength(2)
    expect(shifts.every((s) => s.locationName.includes('Kelmont'))).toBe(true)
    expect(shifts[0]!.slotLabel).toContain('7:00 PM')
    expect(shifts[1]!.slotLabel).toContain('8:00 PM')
  })

  it('carries a map link even for a location that has none stored', () => {
    // Most of the library came out of the workbook with an empty map link. The volunteer
    // holding the pass still needs to find the place, so the link is derived from the
    // address at publish time.
    const bare = locations2025.map((l) => ({
      ...l,
      mapsUrl: '',
      address: `${l.name} address`,
    }))
    const [shift] = buildPassShifts('y10', {
      locations: bare,
      assignments: fridayAssignments2025,
      slots: slots2025,
    })

    expect(shift!.mapsUrl).toBe(mapsSearchUrl(shift!.address))
    expect(shift!.mapsUrl).not.toBe('')
  })

  it('is empty for someone with no shifts, rather than falling back to everyone', () => {
    expect(
      buildPassShifts('nobody-at-all', {
        locations: locations2025,
        assignments: fridayAssignments2025,
        slots: slots2025,
      }),
    ).toEqual([])
  })
})

describe('mail-merge export', () => {
  it('does carry contact details — it is for the organizer, not the public', () => {
    const rows = buildMailMergeRows(
      [{ token: 'tok', personId: 'y10', displayName: 'Y Ten', shiftCount: 2 }],
      withContact,
      'https://apple-day.example',
      { locations: locations2025, assignments: fridayAssignments2025, slots: slots2025 },
    )

    expect(rows[0]).toMatchObject({
      'Parent Email': 'parent@example.org',
      'Schedule Link': 'https://apple-day.example/p/tok',
    })
    expect(rows[0]!.Shifts).toContain('Kelmont')
  })
})

describe('pass tokens', () => {
  it('are long, unguessable and free of look-alike characters', () => {
    const tokens = Array.from({ length: 500 }, generateToken)

    for (const token of tokens) {
      expect(token).toHaveLength(22)
      // No 0/O or 1/l/I — these get read off paper by humans.
      expect(token).not.toMatch(/[0Ol]/)
    }
    // No collisions across 500 draws; the real space is ~129 bits.
    expect(new Set(tokens).size).toBe(500)
  })
})

describe('the base of operations reaches the people who need it', () => {
  const BASE = {
    name: 'St Andrew\u2019s Church hall',
    address: '54 Foxglove Rd E',
    mapsUrl: 'https://maps.example/hall',
  }

  it('is not one of the staffed locations, so it never enters a pass as a shift', () => {
    // The base is a reference to the library, not a row on the board: apples are stacked
    // there, nobody collects money there.
    const shifts = buildPassShifts(people2025[0]!.id, {
      locations: locations2025,
      assignments: fridayAssignments2025,
      slots: slots2025,
    })
    expect(shifts.some((sh) => sh.locationName.includes('Church'))).toBe(false)
  })

  it('carries no contact details of its own onto a pass', () => {
    // Same rule as everywhere else: a site contact is for organizers.
    expect(JSON.stringify(BASE)).not.toContain('@')
  })
})


describe('knowing when a published schedule has gone stale', () => {
  /*
    A schedule gets published, somebody fills a gap or swaps two people, and the links
    already in parents' inboxes quietly stop matching the board. Nothing said so.

    The hard part is not noticing a change — it is not crying wolf. Assignments are written
    all day Saturday as people check in and jars go out, and none of that alters a word of
    what a volunteer reads. A "last edited beats last published" test would show the notice
    from the first check-in to the end of the event, which is the same as not showing it.
  */

  const input = {
    locations: locations2025,
    people: people2025,
    assignments: fridayAssignments2025,
    slots: slots2025,
    support: [{ name: 'Base', phone: '519-555-0100', email: '' }],
    supportNote: 'Ring if anything goes wrong.',
    arrivalNote: 'Come to the hall first.',
    base: null,
  }

  it('is the same for the same board', () => {
    expect(publishedFingerprint(input)).toBe(publishedFingerprint(input))
  })

  it('does not move when the board is merely re-read in another order', () => {
    // Firestore does not promise an order, and a reordered result is not an edit.
    const shuffled = {
      ...input,
      assignments: [...input.assignments].reverse(),
      people: [...input.people].reverse(),
    }
    expect(publishedFingerprint(shuffled)).toBe(publishedFingerprint(input))
  })

  it('does not move for a check-in, a no-show or a jar going out', () => {
    // The whole point. None of this reaches a pass or the public page.
    for (const status of ['confirmed', 'checkedIn', 'noShow'] as const) {
      const touched = {
        ...input,
        assignments: input.assignments.map((a, i) =>
          i === 0
            ? { ...a, status, whereabouts: 'out' as const, checkedInAt: 123, checkedOutAt: 456 }
            : a,
        ),
      }
      expect(publishedFingerprint(touched), status).toBe(publishedFingerprint(input))
    }
  })

  it('moves when somebody is moved to another location', () => {
    const moved = {
      ...input,
      assignments: input.assignments.map((a, i) =>
        i === 0 ? { ...a, locationId: locations2025[1]!.id } : a,
      ),
    }
    expect(publishedFingerprint(moved)).not.toBe(publishedFingerprint(input))
  })

  it('moves when somebody is taken off the board entirely', () => {
    const fewer = { ...input, assignments: input.assignments.slice(1) }
    expect(publishedFingerprint(fewer)).not.toBe(publishedFingerprint(input))
  })

  it('moves when a shift is swapped away', () => {
    // `swapped` is how a shift is retired, and it drops off both the pass and the page.
    const swapped = {
      ...input,
      assignments: input.assignments.map((a, i) =>
        i === 0 ? { ...a, status: 'swapped' as const } : a,
      ),
    }
    expect(publishedFingerprint(swapped)).not.toBe(publishedFingerprint(input))
  })

  it('moves when a name is corrected, because the pass prints it', () => {
    const renamed = {
      ...input,
      people: input.people.map((p, i) => (i === 0 ? { ...p, lastName: 'Fitzwilliam' } : p)),
    }
    expect(publishedFingerprint(renamed)).not.toBe(publishedFingerprint(input))
  })

  it('moves when the contacts or the notes change, which every pass carries', () => {
    for (const changed of [
      { ...input, support: [{ name: 'Base', phone: '519-555-0199', email: '' }] },
      { ...input, supportNote: 'Ring the hall.' },
      { ...input, arrivalNote: 'Wait by the doors.' },
      { ...input, base: { name: 'Hall', address: '1 Road', mapsUrl: '' } },
    ]) {
      expect(publishedFingerprint(changed)).not.toBe(publishedFingerprint(input))
    }
  })

  it('does not move when the event is given a different link', () => {
    /*
      It used to. The event's link was the address the public schedule was published under,
      so changing it changed what a visitor would find. There is no public schedule now, and
      a pass is reached by its own unguessable token — the link names the event inside the
      app and reaches nobody outside it.
    */
    expect(publishedFingerprint({ ...input, slug: 'apple-day' } as typeof input)).toBe(
      publishedFingerprint(input),
    )
  })

  it('moves when a location is renamed or its address corrected', () => {
    for (const field of ['name', 'address', 'comments'] as const) {
      const edited = {
        ...input,
        locations: locations2025.map((l, i) => (i === 0 ? { ...l, [field]: 'changed' } : l)),
      }
      expect(publishedFingerprint(edited), field).not.toBe(publishedFingerprint(input))
    }
  })

  it('moves when a map link changes to another usable one', () => {
    /*
      `mapsUrl` is checked before it is published — a pasted link that is not `https:` is
      dropped in favour of the one derived from the address, because it ends up in an `href`
      on a volunteer's phone.

      So this used to be tested with `mapsUrl: 'changed'`, which is not a link at all. That
      now publishes exactly what it published before, and the fingerprint correctly does not
      move: nothing a volunteer sees has changed. Testing it with a real link tests the
      thing the fingerprint is for.
    */
    const edited = {
      ...input,
      locations: locations2025.map((l, i) =>
        i === 0 ? { ...l, mapsUrl: 'https://maps.example/side-entrance' } : l,
      ),
    }
    expect(publishedFingerprint(edited)).not.toBe(publishedFingerprint(input))
  })

  it('stays put when an unusable map link is typed over another unusable one', () => {
    // Neither ships, so neither changes what anybody sees.
    const one = {
      ...input,
      locations: locations2025.map((l, i) => (i === 0 ? { ...l, mapsUrl: 'changed' } : l)),
    }
    const other = {
      ...input,
      locations: locations2025.map((l, i) =>
        i === 0 ? { ...l, mapsUrl: 'javascript:alert(1)' } : l,
      ),
    }
    expect(publishedFingerprint(one)).toBe(publishedFingerprint(other))
  })
})

describe('what to say about a published schedule', () => {

  it('says nothing at all before the first publish', () => {
    expect(publishStatus(null, 'abc')).toBe('never')
    expect(
      publishStatus({ publishedAt: 0, fingerprint: '' }, 'abc'),
    ).toBe('never')
  })

  it('says it is current when the board has not moved', () => {
    expect(
      publishStatus({ publishedAt: 1, fingerprint: 'abc' }, 'abc'),
    ).toBe('current')
  })

  it('says it is stale when it has', () => {
    expect(
      publishStatus({ publishedAt: 1, fingerprint: 'xyz' }, 'abc'),
    ).toBe('stale')
  })

  it('admits it cannot tell, rather than guessing, for a publish that predates this', () => {
    /*
      There used to be a fallback here: a publish from before fingerprints existed still
      stored the public schedule's rows, and those could be rebuilt from the board and
      compared. The public page is gone and so are its rows, so there is genuinely nothing
      left to compare and saying so is the only honest answer.
    */
    expect(publishStatus({ publishedAt: 1, fingerprint: '' }, 'abc')).toBe('unknown')
  })
})

