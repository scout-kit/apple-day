import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Assignment, Person } from '../src/domain/types'

/**
 * What a re-publish does to a pass that was already showing a location.
 *
 * A pass hides where somebody is going until an organizer checks them in: everybody reports
 * to base first, that is where the jars and apples are, and a pass naming a shop invites a
 * youth to skip base and go straight there.
 *
 * Publishing wrote that flag as a flat `false`. Right for the first publish, when nobody has
 * arrived — and wrong for every one after it: re-publishing part-way through the Saturday,
 * or afterwards to correct something, took the locations off the pass of everybody already
 * standing at a door.
 */

interface Written {
  path: string
  data: Record<string, unknown>
}

let writes: Written[] = []

vi.mock('firebase/firestore', () => ({
  doc: (first: unknown, ...segments: string[]) => {
    const prefix = (first as { path?: string })?.path
    return { path: [prefix, ...segments].filter(Boolean).join('/') }
  },
  collection: (first: unknown, ...segments: string[]) => {
    const prefix = (first as { path?: string })?.path
    return { path: [prefix, ...segments].filter(Boolean).join('/') }
  },
  writeBatch: () => ({
    set: (ref: { path: string }, data: Record<string, unknown>) => {
      writes.push({ path: ref.path, data })
    },
    update: () => {},
    delete: () => {},
    commit: async () => undefined,
  }),
}))

vi.mock('../src/lib/firebase', () => ({
  db: {},
  missingConfig: [],
  auth: { currentUser: { uid: 'u-organizer', displayName: 'An Organizer', email: '' } },
}))

const { publish } = await import('../src/lib/publish')

const person = (id: string): Person => ({
  id, firstName: id, lastName: 'Volunteer', section: 'cubs',
  parentName: '', parentEmail: '', parentPhone: '', pairWithPersonId: null,
})

const shift = (over: Partial<Assignment>): Assignment => ({
  id: 'a1', slotId: 'fri-1700', locationId: 'braemar', personId: 'p1',
  status: 'planned', whereabouts: 'here', checkedInAt: null, checkedOutAt: null,
  ...over,
})

const run = async (assignments: Assignment[]): Promise<void> => {
  await publish('2026', {
    people: assignments.map((a) => person(a.personId)),
    assignments,
    locations: [
      {
        id: 'braemar', name: 'Braemar', address: '640 Linden Drive', mapsUrl: '',
        groupCode: '', siteContact: null, insurance: '', comments: '', openHours: {},
        aliases: [], lat: null, lng: null, active: true, priority: 1,
      },
    ],
    slots: [
      { id: 'fri-1700', day: 'fri' as const, startMin: 17 * 60, endMin: 18 * 60, label: '5:00 PM' },
    ],
    support: [],
    supportNote: '',
    arrivalNote: '',
  })
}

const passFor = (personId: string): Record<string, unknown> =>
  writes.find((w) => w.path.startsWith('passes/') && w.data.personId === personId)!.data

beforeEach(() => {
  writes = []
})

describe('publishing before anybody has arrived', () => {
  it('hides where they are going', () => {
    // The whole point of the flag: everybody reports to base first.
    return run([shift({ personId: 'p1' })]).then(() => {
      expect(passFor('p1').revealShifts).toBe(false)
    })
  })
})

describe('publishing again once the day has started', () => {
  it('keeps the location on the pass of somebody checked in', async () => {
    await run([shift({ personId: 'p1', status: 'checkedIn', checkedInAt: 1 })])
    expect(passFor('p1').revealShifts).toBe(true)
  })

  it('keeps it for somebody out collecting', async () => {
    // A jar being issued sends them out without a separate check-in press.
    await run([shift({ personId: 'p1', status: 'checkedIn', whereabouts: 'out' })])
    expect(passFor('p1').revealShifts).toBe(true)
  })

  it('keeps it for somebody already back at base', async () => {
    /*
      The case as reported: a completed schedule, re-published. They had been checked in and
      marked back again, and the pass went blank where the shop should be.
    */
    await run([shift({ personId: 'p1', status: 'checkedIn', whereabouts: 'back' })])
    expect(passFor('p1').revealShifts).toBe(true)
  })

  it('still hides it for somebody who has not turned up', async () => {
    await run([
      shift({ id: 'a1', personId: 'here', status: 'checkedIn' }),
      shift({ id: 'a2', personId: 'later', status: 'planned' }),
    ])
    expect(passFor('here').revealShifts).toBe(true)
    expect(passFor('later').revealShifts).toBe(false)
  })

  it('hides it again for somebody whose check-in was taken back', async () => {
    /*
      Read off the board rather than carried over from the old pass, so this follows a
      check-in both ways — somebody sent home should not be left holding a page that still
      names where to go.
    */
    await run([shift({ personId: 'p1', status: 'confirmed', whereabouts: 'here' })])
    expect(passFor('p1').revealShifts).toBe(false)
  })

  it('reveals on any shift they turned up for, not only the first', async () => {
    // A stretch of hours is one person; arriving for the second is arriving.
    await run([
      shift({ id: 'a1', personId: 'p1', slotId: 'fri-1700', status: 'planned' }),
      shift({ id: 'a2', personId: 'p1', slotId: 'fri-1700', status: 'checkedIn' }),
    ])
    expect(passFor('p1').revealShifts).toBe(true)
  })
})
