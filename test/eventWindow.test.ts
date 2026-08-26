import { describe, expect, it } from 'vitest'
import {
  activeDays,
  buildAllSlots,
  buildSlots,
  DAY_LABEL,
  DEFAULT_SCHEDULE,
  formatOpenRange,
  hourOptions,
  isHoursRecorded,
  isOpenDuring,
  isOpenOn,
  parseAvailability,
  parseSlotLabel,
} from '../src/domain/slots'
import { DAYS, completeAvailability } from '../src/domain/types'
import type { SchedulingWindow } from '../src/domain/types'

/**
 * Per-event scheduling windows, and location hours recorded independently of them.
 *
 * Both were hardcoded before: the grid was fixed at Friday 17:00–21:00 / Saturday
 * 07:00–15:00, and a location's opening hours could only be expressed as a subset of
 * those same slots — so there was no way to say "this shop is open until 22:00, we just
 * do not staff it that late".
 */

const LONGER: Partial<Record<'fri' | 'sat', SchedulingWindow>> = {
  fri: { startMin: 16 * 60, endMin: 21 * 60 },
  sat: { startMin: 7 * 60, endMin: 17 * 60 },
}

describe('an event defines its own hours', () => {
  it('defaults to how 2025 actually ran', () => {
    expect(buildSlots('fri').map((s) => s.id)).toEqual([
      'fri-1700', 'fri-1800', 'fri-1900', 'fri-2000',
    ])
    expect(buildSlots('sat')).toHaveLength(8)
  })

  it('adds columns when a year runs longer', () => {
    const fri = buildSlots('fri', LONGER)
    expect(fri).toHaveLength(5)
    expect(fri[0]!.id).toBe('fri-1600')
    expect(buildSlots('sat', LONGER)).toHaveLength(10)
    expect(buildAllSlots(LONGER)).toHaveLength(15)
  })

  it('keeps slot ids stable when the window changes', () => {
    // Widening must not rename the slots people are already assigned to, or every
    // existing assignment would be orphaned.
    const before = buildSlots('fri').map((s) => s.id)
    const after = buildSlots('fri', LONGER).map((s) => s.id)
    for (const id of before) expect(after).toContain(id)
  })

  it('parses form times against the event window, not a fixed one', () => {
    // 4pm is outside the default Friday window but inside a year that starts at 16:00.
    expect(parseSlotLabel('fri', '4:00 - 5:00')).toMatchObject({ ok: false })
    expect(parseSlotLabel('fri', '4:00 - 5:00', LONGER)).toMatchObject({
      ok: true, slotId: 'fri-1600',
    })

    // Saturday to 5pm: "4:00 - 5:00" resolves to the afternoon, not 4am.
    expect(parseAvailability('sat', '4:00 - 5:00', LONGER).slotIds).toEqual(['sat-1600'])
  })

  it('still refuses a time no reading of the window can place', () => {
    expect(parseSlotLabel('fri', '11:00 - 12:00', LONGER)).toMatchObject({
      ok: false, reason: 'outsideWindow',
    })
  })
})

describe('location hours are recorded, not inferred from the schedule', () => {
  const slot = buildSlots('sat')[2]! // 09:00–10:00

  it('needs the whole slot inside the opening hours', () => {
    expect(isOpenDuring({ openMin: 8 * 60, closeMin: 17 * 60 }, slot)).toBe(true)
    expect(isOpenDuring({ openMin: 9 * 60, closeMin: 10 * 60 }, slot)).toBe(true)
    // Opens at 09:30 — a youth sent for the 9am hour stands at a locked door.
    expect(isOpenDuring({ openMin: 9 * 60 + 30, closeMin: 17 * 60 }, slot)).toBe(false)
    // Closes at 09:30 — same problem at the other end.
    expect(isOpenDuring({ openMin: 8 * 60, closeMin: 9 * 60 + 30 }, slot)).toBe(false)
  })

  it('treats a missing or backwards range as closed', () => {
    expect(isOpenDuring(null, slot)).toBe(false)
    expect(isOpenDuring(undefined, slot)).toBe(false)
  })

  it('can describe hours well outside what we staff', () => {
    // The Copperpot Coffee case: open long past when anyone is scheduled.
    const allNight = { openMin: 0, closeMin: 24 * 60 }
    expect(buildAllSlots().every((s) => isOpenDuring(allNight, s))).toBe(true)
    // Reads as the Copperpot Coffee note in the workbook did, rather than "12:00 PM".
    expect(formatOpenRange(allNight)).toBe('Open 24 hours')
    expect(formatOpenRange({ openMin: 17 * 60, closeMin: 24 * 60 })).toBe('5:00 PM – midnight')
    expect(formatOpenRange(null)).toBe('Closed')
    expect(formatOpenRange({ openMin: 7 * 60, closeMin: 21 * 60 })).toBe('7:00 AM – 9:00 PM')
  })

  it('offers every half hour, ending at midnight', () => {
    const options = hourOptions(30)
    expect(options).toHaveLength(49)
    expect(options[0]!.label).toBe('12:00 AM')
    expect(options.at(-1)).toEqual({ min: 1440, label: 'midnight' })
  })
})

describe('the board reconciles the two', () => {
  it('only offers hours a location is open for', () => {
    // The reconciliation is the board withholding a picker on a closed hour, not a warning
    // after the fact — the warning was removed as a restatement of what the cell shows.
    const open = { openMin: 18 * 60, closeMin: 21 * 60 }
    const fridaySlots = buildSlots('fri', { fri: { startMin: 17 * 60, endMin: 21 * 60 } })

    expect(isOpenDuring(open, fridaySlots[0]!)).toBe(false)
    expect(isOpenDuring(open, fridaySlots[1]!)).toBe(true)
  })

  it('treats a location open wider than the scheduling window as open throughout', () => {
    const generous = { openMin: 6 * 60, closeMin: 23 * 60 }
    const fridaySlots = buildSlots('fri', { fri: { startMin: 17 * 60, endMin: 21 * 60 } })
    expect(fridaySlots.every((slot) => isOpenDuring(generous, slot))).toBe(true)
  })

  it('leaves DEFAULT_SCHEDULE alone when a caller mutates its own window', () => {
    const mine = { ...DEFAULT_SCHEDULE, fri: { startMin: 0, endMin: 60 } }
    expect(buildSlots('fri', mine)).toHaveLength(1)
    expect(buildSlots('fri')).toHaveLength(4)
  })
})

describe('the whole week is available', () => {
  it('knows all seven days, Sunday first', () => {
    expect(DAYS).toEqual(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])
    expect(DAYS.map((d) => DAY_LABEL[d])).toEqual([
      'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
    ])
  })

  it('runs an event on days other than Friday and Saturday', () => {
    // The 2023 review: "Jack's Sunday brunch would generate a lot."
    const withSunday = {
      fri: { startMin: 17 * 60, endMin: 21 * 60 },
      sat: { startMin: 7 * 60, endMin: 15 * 60 },
      sun: { startMin: 9 * 60, endMin: 13 * 60 },
    }
    expect(activeDays(withSunday)).toEqual(['sun', 'fri', 'sat'])

    const slots = buildAllSlots(withSunday)
    expect(slots.filter((s) => s.day === 'sun').map((s) => s.id)).toEqual([
      'sun-0900', 'sun-1000', 'sun-1100', 'sun-1200',
    ])
    // Week order, so the board's columns read the way a calendar does.
    expect(slots[0]!.day).toBe('sun')
    expect(slots.at(-1)!.day).toBe('sat')
  })

  it('runs a weekend-only event with no Friday at all', () => {
    const satSun = {
      sat: { startMin: 8 * 60, endMin: 12 * 60 },
      sun: { startMin: 10 * 60, endMin: 14 * 60 },
    }
    expect(activeDays(satSun)).toEqual(['sun', 'sat'])
    expect(buildSlots('fri', satSun)).toEqual([])
    expect(buildAllSlots(satSun)).toHaveLength(8)
  })

  it('ignores a day whose window is empty or backwards', () => {
    expect(activeDays({ mon: { startMin: 600, endMin: 600 } })).toEqual([])
    expect(activeDays({ mon: { startMin: 900, endMin: 600 } })).toEqual([])
    expect(buildSlots('mon', { mon: { startMin: 900, endMin: 600 } })).toEqual([])
  })

  it('refuses to parse a time for a day the event does not run', () => {
    const fridayOnly = { fri: { startMin: 17 * 60, endMin: 21 * 60 } }
    expect(parseSlotLabel('sun', '10:00 - 11:00', fridayOnly)).toMatchObject({
      ok: false, reason: 'outsideWindow',
    })
    expect(parseAvailability('sun', '10:00 - 11:00', fridayOnly).slotIds).toEqual([])
  })

  it('records location hours on a day nobody is scheduled', () => {
    // A shop's Wednesday hours are a fact whether or not we ever staff a Wednesday.
    const wednesday = { openMin: 9 * 60, closeMin: 17 * 60 }
    const slot = buildSlots('wed', { wed: { startMin: 10 * 60, endMin: 11 * 60 } })[0]!
    expect(isOpenDuring(wednesday, slot)).toBe(true)
    expect(formatOpenRange(wednesday)).toBe('9:00 AM – 5:00 PM')
  })

  it('treats a day absent from openHours as closed', () => {
    const slot = buildSlots('sat')[0]!
    expect(isOpenDuring(({} as Record<string, never>)['sat'], slot)).toBe(false)
  })
})

describe('is a day recorded as open', () => {
  const hours = {
    fri: { openMin: 17 * 60, closeMin: 21 * 60 },
    sat: null,
    mon: { openMin: 600, closeMin: 600 },
    tue: { openMin: 900, closeMin: 600 },
  }

  it('is true only for a day with a real range', () => {
    expect(isOpenOn(hours, 'fri')).toBe(true)
  })

  it('is false for a day that was never recorded', () => {
    // The case that broke the UI: absent is not null, and `range !== null` was true for
    // every day the workbook never mentioned — five of seven on a typical location.
    expect(isOpenOn(hours, 'sun')).toBe(false)
    expect(isOpenOn(hours, 'wed')).toBe(false)
    expect(isOpenOn({}, 'fri')).toBe(false)
  })

  it('is false for a day explicitly marked closed', () => {
    expect(isOpenOn(hours, 'sat')).toBe(false)
  })

  it('is false for a zero-length or backwards range', () => {
    expect(isOpenOn(hours, 'mon')).toBe(false)
    expect(isOpenOn(hours, 'tue')).toBe(false)
  })

  it('agrees with what the row displays', () => {
    // The switch and the text are driven by the same question, so they cannot disagree.
    for (const day of DAYS) {
      const shown = formatOpenRange(hours[day as keyof typeof hours])
      expect(isOpenOn(hours, day)).toBe(shown !== 'Closed')
    }
  })
})

describe('expanding availability for storage', () => {
  it('returns every day, with empty arrays for the untouched ones', () => {
    const expanded = completeAvailability({ fri: ['fri-1700'] })
    expect(Object.keys(expanded).sort()).toEqual([...DAYS].sort())
    expect(expanded.fri).toEqual(['fri-1700'])
    // Not omitted — an omitted key survives a merged write and clearing becomes a no-op.
    expect(expanded.sat).toEqual([])
    expect(expanded.sun).toEqual([])
  })

  it('turns clearing everything into seven explicit empties', () => {
    const expanded = completeAvailability({})
    for (const day of DAYS) expect(expanded[day]).toEqual([])
  })

  it('treats an explicitly emptied day the same as an absent one', () => {
    expect(completeAvailability({ fri: [] }).fri).toEqual([])
  })

  it('does not invent or drop slots on a day that has them', () => {
    const slots = ['sat-0900', 'sat-1000', 'sat-1100']
    expect(completeAvailability({ sat: slots }).sat).toEqual(slots)
  })
})

describe('recorded versus unrecorded hours', () => {
  const hours = {
    fri: { openMin: 17 * 60, closeMin: 21 * 60 },
    sat: null,
  }

  it('counts a real range as recorded', () => {
    expect(isHoursRecorded(hours, 'fri')).toBe(true)
  })

  it('counts an explicit closed-all-day as recorded', () => {
    // This is the distinction the schedule board acts on: somebody said closed, so
    // scheduling there needs a deliberate override.
    expect(isHoursRecorded(hours, 'sat')).toBe(true)
    expect(isOpenOn(hours, 'sat')).toBe(false)
  })

  it('does not count a day nobody mentioned', () => {
    for (const day of ['sun', 'mon', 'tue', 'wed', 'thu'] as const) {
      expect(isHoursRecorded(hours, day)).toBe(false)
    }
    expect(isHoursRecorded({}, 'fri')).toBe(false)
  })

  it('is independent of whether the range is usable', () => {
    // A nonsense range is still a recorded decision, and reads as closed.
    const nonsense = { mon: { openMin: 900, closeMin: 600 } }
    expect(isHoursRecorded(nonsense, 'mon')).toBe(true)
    expect(isOpenOn(nonsense, 'mon')).toBe(false)
  })
})
