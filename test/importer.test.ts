import { describe, expect, it } from 'vitest'
import {
  detectMapping,
  missingRequiredColumns,
  normaliseWhitespace,
  parseNameField,
  parseSection,
  personId,
  parseTimestamp,
  planImport,
} from '../src/domain/importer'
import type { ColumnMapping } from '../src/domain/importer'
import type { Person } from '../src/domain/types'

/** The exact header row of the hidden 2023 `Form Responses 1` sheet. */
const HEADERS_2023 = [
  'Timestamp', 'Youth Name', ' [Section]', ' [Friday]', ' [Saturday]',
  'Parent Name', 'I will attend with my youth',
]

/** The exact header row of the hidden 2024 `ResponsesFri` sheet — different order. */
const HEADERS_2024 = [
  'Timestamp', 'Youth Name', 'Section', 'Parent Name',
  'I will attend with my youth', 'Friday', 'Saturday', 'Note',
]

const HEADERS_2026 = [
  'Timestamp', 'Youth Name', 'Section', 'Parent Name', 'Email Address',
  'Cell Phone', 'I will attend with my youth', 'Friday', 'Saturday',
  'Pair with', 'Special requests',
]

describe('column detection across three years of form layouts', () => {
  it('maps the 2023 headers, brackets and all', () => {
    const mapping = detectMapping(HEADERS_2023)
    expect(mapping.youthName).toBe('Youth Name')
    expect(mapping.section).toBe(' [Section]')
    expect(mapping.days?.fri).toBe(' [Friday]')
    expect(mapping.days?.sat).toBe(' [Saturday]')
    expect(mapping.parentName).toBe('Parent Name')
    expect(mapping.attending).toBe('I will attend with my youth')
    expect(missingRequiredColumns(mapping)).toEqual([])
  })

  it('maps the 2024 headers despite the different order', () => {
    const mapping = detectMapping(HEADERS_2024)
    expect(mapping.days?.fri).toBe('Friday')
    expect(mapping.notes).toBe('Note')
    expect(missingRequiredColumns(mapping)).toEqual([])
  })

  it('picks up the email and phone columns the form is missing today', () => {
    const mapping = detectMapping(HEADERS_2026)
    expect(mapping.parentEmail).toBe('Email Address')
    expect(mapping.parentPhone).toBe('Cell Phone')
    expect(mapping.pairWith).toBe('Pair with')
  })

  it('refuses to proceed when the name or section column is absent', () => {
    expect(missingRequiredColumns(detectMapping(['Timestamp', 'Friday']))).toEqual([
      'youthName', 'section',
    ])
  })
})

describe('cleaning up the text the sheets actually contain', () => {
  it('collapses the tabs and padding that broke per-youth roll-ups', () => {
    // `Friday Jars!C16` held `"Barbara Liskov\tCubs"`, elsewhere the same youth was written
    // with eight spaces. Both had to normalise to the same thing.
    expect(normaliseWhitespace('  Barbara Liskov \t ')).toBe('Barbara Liskov')
    expect(normaliseWhitespace('"Margaret Hamilton"')).toBe('Margaret Hamilton')
    expect(normaliseWhitespace('Dennis Ritchie')).toBe('Dennis Ritchie')
  })

  it('accepts every spelling of a section', () => {
    expect(parseSection('Beavers')).toBe('beavers')
    expect(parseSection('Beaver')).toBe('beavers')
    expect(parseSection('Ventures')).toBe('venturers')
    expect(parseSection('Venturers')).toBe('venturers')
    // `Scouter` must not fold into `Scouts` — that was the Hours sheet's substring bug.
    expect(parseSection('Scouter')).toBe('scouters')
    expect(parseSection('Scouts')).toBe('scouts')
    expect(parseSection('mystery')).toBeNull()
  })

  it('lifts a pairing request out of the name field', () => {
    // Both shapes appear verbatim in the 2024 responses.
    expect(parseNameField('Ada Byron (w/ Ken please)')).toEqual({
      firstName: 'Ada', lastName: 'Byron', pairHint: 'Ken',
    })
    expect(parseNameField('Grace Hopper (with brother Toby in tow)')).toEqual({
      firstName: 'Grace', lastName: 'Hopper', pairHint: 'Toby',
    })
    expect(parseNameField('Plain Name')).toEqual({
      firstName: 'Plain', lastName: 'Name', pairHint: null,
    })
  })

  it('derives a stable id, so the same youth is the same record every year', () => {
    expect(personId('Ada', 'Byron', 'scouts')).toBe('p-ada-byron-scouts')
    // Accents fold, so the same youth is the same record however it was typed.
    expect(personId('Ádà', 'Byron', 'scouts')).toBe(personId('Ada', 'Byron', 'scouts'))
  })
})

// -------------------------------------------------------------------- importing

const mapping2024: ColumnMapping = detectMapping(HEADERS_2024)

function row(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Timestamp: '45560.9',
    'Youth Name': 'Alpha One',
    Section: 'Cubs',
    'Parent Name': 'Parent One',
    'I will attend with my youth': 'Yes',
    Friday: '5:00 - 6:00, 6:00 - 7:00',
    Saturday: '9:00 - 10:00',
    Note: '',
    ...overrides,
  }
}

describe('planImport', () => {
  it('turns a clean row into a person and a signup', () => {
    const plan = planImport([row()], { mapping: mapping2024, existingPeople: [] })

    expect(plan.problems).toEqual([])
    expect(plan.newPeople).toHaveLength(1)
    expect(plan.newPeople[0]).toMatchObject({
      firstName: 'Alpha', lastName: 'One', section: 'cubs', parentName: 'Parent One',
    })
    expect(plan.signups[0]!.availability).toEqual({
      fri: ['fri-1700', 'fri-1800'], sat: ['sat-0900'],
    })
    expect(plan.signups[0]!.attendingWithYouth).toBe(true)
    expect(plan.stats).toMatchObject({ rowsRead: 1, rowsAccepted: 1, peopleCreated: 1 })
  })

  it('is idempotent — importing the same file twice changes nothing', () => {
    const rows = [row(), row({ 'Youth Name': 'Beta Two', Section: 'Scouts' })]

    const first = planImport(rows, { mapping: mapping2024, existingPeople: [] })
    expect(first.stats.noOp).toBe(false)

    const second = planImport(rows, {
      mapping: mapping2024,
      existingPeople: first.newPeople,
      existingSignups: first.signups,
    })

    expect(second.newPeople).toEqual([])
    expect(second.updatedPeople).toEqual([])
    expect(second.stats.peopleMatched).toBe(2)
    expect(second.stats.noOp).toBe(true)
  })

  it('keeps the latest of two submissions and says which row it dropped', () => {
    const rows = [
      row({ Timestamp: '45560.1', Friday: '5:00 - 6:00' }),
      row({ Timestamp: '45566.9', Friday: '5:00 - 6:00, 6:00 - 7:00, 7:00 - 8:00' }),
    ]
    const plan = planImport(rows, { mapping: mapping2024, existingPeople: [] })

    expect(plan.signups).toHaveLength(1)
    expect(plan.signups[0]!.availability.fri).toHaveLength(3)

    const superseded = plan.problems.find((p) => p.kind === 'supersededDuplicate')!
    expect(superseded).toMatchObject({ row: 2, keptRow: 3 })
  })

  it('reports a bad section instead of importing half a record', () => {
    const plan = planImport([row({ Section: 'Explorers' })], {
      mapping: mapping2024, existingPeople: [],
    })
    expect(plan.newPeople).toEqual([])
    expect(plan.problems).toEqual([{ kind: 'unknownSection', row: 2, value: 'Explorers' }])
  })

  it('reports an unreadable time but still imports the rest of the row', () => {
    const plan = planImport([row({ Friday: '5:00 - 6:00, whenever really' })], {
      mapping: mapping2024, existingPeople: [],
    })

    expect(plan.newPeople).toHaveLength(1)
    expect(plan.signups[0]!.availability.fri).toEqual(['fri-1700'])
    expect(plan.problems.filter((p) => p.kind === 'unparseableSlot')).toHaveLength(1)
  })

  it('flags a form filled in with no time offered at all', () => {
    const plan = planImport([row({ Friday: '', Saturday: '' })], {
      mapping: mapping2024, existingPeople: [],
    })
    expect(plan.problems.some((p) => p.kind === 'noAvailability')).toBe(true)
    // Still imported — the organizer may chase them.
    expect(plan.newPeople).toHaveLength(1)
  })

  it('ignores blank trailing rows but reports a row with data and no name', () => {
    const plan = planImport(
      [row(), { ...row(), 'Youth Name': '' }, Object.fromEntries(HEADERS_2024.map((h) => [h, '']))],
      { mapping: mapping2024, existingPeople: [] },
    )
    expect(plan.problems.filter((p) => p.kind === 'missingName')).toHaveLength(1)
  })

  it('links a pairing hint when exactly one person matches', () => {
    const rows = [
      row({ 'Youth Name': 'Ada Byron (w/ Ken please)', Section: 'Scouts' }),
      row({ 'Youth Name': 'Ken Thompson', Section: 'Scouts' }),
    ]
    const plan = planImport(rows, { mapping: mapping2024, existingPeople: [] })

    const ada = plan.newPeople.find((p) => p.firstName === 'Ada')!
    expect(ada.pairWithPersonId).toBe(personId('Ken', 'Thompson', 'scouts'))
    expect(plan.problems.filter((p) => p.kind === 'unresolvedPairHint')).toEqual([])
  })

  it('refuses to guess when a pairing hint is ambiguous', () => {
    const rows = [
      row({ 'Youth Name': 'Ada Byron (w/ Ken please)', Section: 'Scouts' }),
      row({ 'Youth Name': 'Ken Thompson', Section: 'Scouts' }),
      row({ 'Youth Name': 'Ken Other', Section: 'Cubs' }),
    ]
    const plan = planImport(rows, { mapping: mapping2024, existingPeople: [] })

    const ada = plan.newPeople.find((p) => p.firstName === 'Ada')!
    expect(ada.pairWithPersonId).toBeNull()
    expect(plan.problems.filter((p) => p.kind === 'unresolvedPairHint')).toHaveLength(1)
  })

  it('fills in contact details on an existing person without losing their pairing', () => {
    const existing: Person = {
      id: personId('Alpha', 'One', 'cubs'),
      firstName: 'Alpha', lastName: 'One', section: 'cubs',
      parentName: 'Parent One', parentEmail: '', parentPhone: '',
      pairWithPersonId: 'p-someone-else-cubs',
    }
    const mapping = detectMapping(HEADERS_2026)
    const plan = planImport(
      [{
        Timestamp: '46000', 'Youth Name': 'Alpha One', Section: 'Cubs',
        'Parent Name': 'Parent One', 'Email Address': 'parent@example.org',
        'Cell Phone': '519-555-0100', 'I will attend with my youth': 'Yes',
        Friday: '17:00 - 18:00', Saturday: '', 'Pair with': '', 'Special requests': '',
      }],
      { mapping, existingPeople: [existing] },
    )

    expect(plan.newPeople).toEqual([])
    expect(plan.updatedPeople).toHaveLength(1)
    expect(plan.updatedPeople[0]).toMatchObject({
      parentEmail: 'parent@example.org',
      parentPhone: '519-555-0100',
      pairWithPersonId: 'p-someone-else-cubs',
    })
  })

  it('accepts 24-hour labels, so the form can be fixed mid-season', () => {
    const plan = planImport([row({ Friday: '17:00 – 18:00', Saturday: '13:00 – 14:00' })], {
      mapping: mapping2024, existingPeople: [],
    })
    expect(plan.problems).toEqual([])
    expect(plan.signups[0]!.availability).toEqual({ fri: ['fri-1700'], sat: ['sat-1300'] })
  })
})

describe('which of two submissions survives', () => {
  /*
    "Responder updated this value" is written in the margins of the workbook this replaces:
    a family fills the form in, then fills it in again with different hours. Only one signup
    can survive, and it has to be the one they meant.
  */
  const row = (timestamp: string, friday: string): Record<string, string> => ({
    Timestamp: timestamp,
    'Youth Name': 'Ada Byron',
    Section: 'Cubs',
    Friday: friday,
  })

  const mapping = {
    timestamp: 'Timestamp',
    youthName: 'Youth Name',
    section: 'Section',
    days: { fri: 'Friday' },
  }

  const run = (rows: Record<string, string>[]) =>
    planImport(rows, { mapping, existingPeople: [] })

  it('keeps the later submission when the file is oldest first', () => {
    // How a Google Form exports.
    const plan = run([
      row('2026-09-14 09:00:00', '5:00 - 6:00'),
      row('2026-09-20 10:00:00', '7:00 - 8:00'),
    ])
    expect(plan.signups[0]!.availability.fri).toEqual(['fri-1900'])
  })

  it('keeps the later submission when the file is newest first', () => {
    /*
      The one that was wrong. A form timestamp is text, and reading it as a number gives
      NaN for every row — so every row looked equally recent and whichever came last in the
      file won. Sort the export the other way and the family's replaced hours were the ones
      imported, with nothing on screen to say so.
    */
    const plan = run([
      row('2026-09-20 10:00:00', '7:00 - 8:00'),
      row('2026-09-14 09:00:00', '5:00 - 6:00'),
    ])
    expect(plan.signups[0]!.availability.fri).toEqual(['fri-1900'])
  })

  it('names the row it dropped and the one it kept', () => {
    const plan = run([
      row('2026-09-20 10:00:00', '7:00 - 8:00'),
      row('2026-09-14 09:00:00', '5:00 - 6:00'),
    ])
    const dropped = plan.problems.find((p) => p.kind === 'supersededDuplicate')
    expect(dropped).toMatchObject({ row: 3, keptRow: 2 })
  })

  it('reads a slash-dated timestamp', () => {
    const plan = run([
      row('9/14/2026 09:00:00', '5:00 - 6:00'),
      row('9/20/2026 10:00:00', '7:00 - 8:00'),
    ])
    expect(plan.signups[0]!.availability.fri).toEqual(['fri-1900'])
  })

  it('falls back to file order when there is no timestamp column at all', () => {
    // Nothing to compare, so the later row wins — which is right for an export in
    // submission order, and is the only honest answer for anything else.
    // The key is left out rather than set to undefined — with exact optional properties
    // those are different things, and a mapping says "not in this file" by omission.
    const { timestamp: _unmapped, ...noTimestamp } = mapping
    const plan = planImport([row('', '5:00 - 6:00'), row('', '7:00 - 8:00')], {
      mapping: noTimestamp,
      existingPeople: [],
    })
    expect(plan.signups[0]!.availability.fri).toEqual(['fri-1900'])
  })

  it('falls back to file order for a date it cannot read without guessing', () => {
    /*
      `14/09/2026` is the 14th of September to most of the world and nonsense to a parser
      expecting month first. Guessing which would quietly keep the wrong submission, so it
      does not guess.
    */
    const plan = run([
      row('14/09/2026 09:00:00', '5:00 - 6:00'),
      row('20/09/2026 10:00:00', '7:00 - 8:00'),
    ])
    expect(plan.signups[0]!.availability.fri).toEqual(['fri-1900'])
  })
})

describe('reading a submission time', () => {
  it('reads the forms this actually meets', () => {
    expect(parseTimestamp('2026-09-14 18:32:05')).toBeGreaterThan(0)
    expect(parseTimestamp('9/14/2026 18:32:05')).toBeGreaterThan(0)
    expect(parseTimestamp('2026-09-14T18:32:05Z')).toBeGreaterThan(0)
  })

  it('takes an epoch, which some exports write instead', () => {
    expect(parseTimestamp('1757880725')).toBe(1757880725)
  })

  it('is null rather than zero for anything it cannot read', () => {
    // Zero would make an unreadable row look like the oldest submission there is.
    expect(parseTimestamp('')).toBeNull()
    expect(parseTimestamp('   ')).toBeNull()
    expect(parseTimestamp('not a date')).toBeNull()
    expect(parseTimestamp('14/09/2026')).toBeNull()
  })

  it('orders two readable times correctly', () => {
    expect(parseTimestamp('2026-09-20 10:00:00')!).toBeGreaterThan(
      parseTimestamp('2026-09-14 09:00:00')!,
    )
  })
})
