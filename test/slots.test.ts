import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHAPE,
  buildSlots,
  formatSlotLabel,
  parseAvailability,
  parseSlotLabel,
} from '../src/domain/slots'

describe('slot grid', () => {
  it('covers Friday evening and Saturday daytime', () => {
    expect(buildSlots('fri').map((s) => s.id)).toEqual([
      'fri-1700', 'fri-1800', 'fri-1900', 'fri-2000',
    ])
    // Eight slots — the workbook's `Hours` sheet only ever scanned five of them.
    expect(buildSlots('sat').map((s) => s.id)).toEqual([
      'sat-0700', 'sat-0800', 'sat-0900', 'sat-1000',
      'sat-1100', 'sat-1200', 'sat-1300', 'sat-1400',
    ])
  })

  it('labels for humans but keys in 24-hour time', () => {
    expect(formatSlotLabel(17 * 60, 18 * 60)).toBe('5:00 PM – 6:00 PM')
    expect(formatSlotLabel(12 * 60, 13 * 60)).toBe('12:00 PM – 1:00 PM')
  })
})

describe('parsing the workbook and form time labels', () => {
  it('disambiguates the same string across the two days', () => {
    // This single case is the defect: `8:00 - 9:00` meant 20:00 on Friday and 08:00 on
    // Saturday, and the spreadsheet had no way to tell them apart.
    expect(parseSlotLabel('fri', '8:00 - 9:00')).toMatchObject({ ok: true, slotId: 'fri-2000' })
    expect(parseSlotLabel('sat', '8:00 - 9:00')).toMatchObject({ ok: true, slotId: 'sat-0800' })
  })

  it('resolves 12-hour labels into the day window', () => {
    expect(parseSlotLabel('fri', '5:00 - 6:00')).toMatchObject({ ok: true, slotId: 'fri-1700' })
    expect(parseSlotLabel('sat', '12:00 - 1:00')).toMatchObject({ ok: true, slotId: 'sat-1200' })
    expect(parseSlotLabel('sat', '1:00 - 2:00')).toMatchObject({ ok: true, slotId: 'sat-1300' })
    expect(parseSlotLabel('sat', '2:00 - 3:00')).toMatchObject({ ok: true, slotId: 'sat-1400' })
  })

  it('tolerates the actual typos in the sheets', () => {
    // `Friday Schedule!G3` reads "500 - 6:00"; `Saturday Schedule!J3` reads "8:00 - 9;00".
    expect(parseSlotLabel('fri', '500 - 6:00')).toMatchObject({ ok: true, slotId: 'fri-1700' })
    expect(parseSlotLabel('sat', '8:00 - 9;00')).toMatchObject({ ok: true, slotId: 'sat-0800' })
  })

  it('accepts already-24-hour labels, so the form can be fixed without breaking imports', () => {
    expect(parseSlotLabel('fri', '17:00 – 18:00')).toMatchObject({ ok: true, slotId: 'fri-1700' })
    expect(parseSlotLabel('sat', '13:00 – 14:00')).toMatchObject({ ok: true, slotId: 'sat-1300' })
  })

  it('reports times outside the day rather than guessing', () => {
    expect(parseSlotLabel('fri', '9:00 - 10:00')).toMatchObject({ ok: false, reason: 'outsideWindow' })
    expect(parseSlotLabel('sat', '6:00 - 7:00')).toMatchObject({ ok: false, reason: 'outsideWindow' })
    expect(parseSlotLabel('fri', 'whenever')).toMatchObject({ ok: false, reason: 'unparseable' })
  })

  it('splits a multi-select answer and keeps the failures visible', () => {
    const good = parseAvailability('fri', '5:00 - 6:00, 6:00 - 7:00, 7:00 - 8:00')
    expect(good.slotIds).toEqual(['fri-1700', 'fri-1800', 'fri-1900'])
    expect(good.problems).toHaveLength(0)

    // The spreadsheet's COUNTIFS wildcards silently ignored anything unmatched. Here the
    // bad entry is returned so the importer can show it.
    const mixed = parseAvailability('sat', '9:00 - 10:00, sometime after lunch')
    expect(mixed.slotIds).toEqual(['sat-0900'])
    expect(mixed.problems).toHaveLength(1)
  })

  it('de-duplicates repeated slots', () => {
    expect(parseAvailability('fri', '5:00 - 6:00, 5:00 - 6:00').slotIds).toEqual(['fri-1700'])
  })
})

describe('reading back a label this app wrote', () => {
  /*
    The schedule shows shifts as "5:00 PM – 6:00 PM", and a signup form built from an event
    offers exactly those. So the app has to be able to read its own writing — and it could
    not: the clock parser had no am/pm at all, so every label it produced came back
    unreadable, and an organizer pasting the shift times into their form would have had
    every answer rejected.
  */
  const schedule = {
    fri: { startMin: 17 * 60, endMin: 21 * 60 },
    sat: { startMin: 9 * 60, endMin: 15 * 60 },
  }

  it('reads every shift of every day back to the shift it came from', () => {
    for (const day of ['fri', 'sat'] as const) {
      for (const slot of buildSlots(day, schedule, DEFAULT_SHAPE)) {
        const back = parseSlotLabel(day, slot.label, schedule, DEFAULT_SHAPE)
        expect(back.ok, `${day} ${slot.label}`).toBe(true)
        expect(back.ok && back.slotId, slot.label).toBe(slot.id)
      }
    }
  })

  it('survives an overlap, where shifts do not start on the hour', () => {
    const shape = { ...DEFAULT_SHAPE, shiftMinutes: 60, overlapMinutes: 15 }
    for (const slot of buildSlots('fri', schedule, shape)) {
      const back = parseSlotLabel('fri', slot.label, schedule, shape)
      expect(back.ok && back.slotId, slot.label).toBe(slot.id)
    }
  })
})

describe('am and pm', () => {
  const evening = { fri: { startMin: 17 * 60, endMin: 21 * 60 } }
  const morning = { sat: { startMin: 9 * 60, endMin: 15 * 60 } }

  it('takes the suffix as the answer, not a hint', () => {
    expect(parseSlotLabel('fri', '5:00 PM – 6:00 PM', evening)).toMatchObject({
      ok: true,
      slotId: 'fri-1700',
    })
  })

  it('refuses an hour the suffix puts outside the day', () => {
    /*
      Without this the reading was guessed from the window, so "7:00 PM" on a Saturday that
      runs 9 to 3 became 7am — an hour nobody offered, quietly added to the board. Out of
      hours is the honest answer.
    */
    expect(parseSlotLabel('sat', '7:00 PM', morning)).toMatchObject({
      ok: false,
      reason: 'outsideWindow',
    })
  })

  it('reads noon and midnight the way a clock does', () => {
    expect(parseSlotLabel('sat', '12:00 PM – 1:00 PM', morning)).toMatchObject({
      ok: true,
      slotId: 'sat-1200',
    })
  })

  it('takes the spellings people actually write', () => {
    for (const label of ['5:00 PM', '5:00pm', '5:00 p.m.', '5 PM', '5pm', '500 pm']) {
      expect(parseSlotLabel('fri', label, evening), label).toMatchObject({
        ok: true,
        slotId: 'fri-1700',
      })
    }
  })

  it('ignores a suffix that contradicts a 24-hour time', () => {
    // "17:00 PM" is somebody being thorough. Seventeen o'clock either way.
    expect(parseSlotLabel('fri', '17:00 PM', evening)).toMatchObject({
      ok: true,
      slotId: 'fri-1700',
    })
  })

  it('still guesses for a label that does not say', () => {
    // The old form exports had none, and they still have to work.
    expect(parseSlotLabel('fri', '5:00 - 6:00', evening)).toMatchObject({
      ok: true,
      slotId: 'fri-1700',
    })
  })
})
