import { describe, expect, it } from 'vitest'
import { sectionParticipation } from '../src/domain/metrics'
import { parseSection } from '../src/domain/importer'
import {
  DEFAULT_SECTIONS,
  matchSection,
  sectionFor,
  slugifySection,
  sortSections,
  youthSections,
} from '../src/domain/sections'
import type { SectionDef } from '../src/domain/sections'
import { assignments2025, people2025, slots2025 } from './fixtures/appleDay2025'

/**
 * Sections as configuration.
 *
 * Which sections a group runs is not this app's business: names differ between groups,
 * Scouts Canada has changed them before, and a group might add Rovers or drop one for a
 * year. Hard-coding five meant a rename was a code change and an unfamiliar section could
 * not be recorded at all.
 */

const ROVERS: SectionDef = {
  id: 'rovers',
  name: 'Rovers',
  youth: true,
  order: 5,
  tone: 'purple',
  aliases: ['rover'],
}

describe('naming a section', () => {
  it('makes a key-safe id from a name', () => {
    expect(slugifySection('Rovers')).toBe('rovers')
    expect(slugifySection('Timber Wolves')).toBe('timber-wolves')
    expect(slugifySection('Éclaireurs')).toBe('eclaireurs')
  })

  it('never produces an empty id', () => {
    expect(slugifySection('!!!')).toBe('section')
  })
})

describe('matching whatever the form called it', () => {
  it('matches the id, the name and an alias', () => {
    expect(matchSection('beavers', DEFAULT_SECTIONS)?.id).toBe('beavers')
    expect(matchSection('Beavers', DEFAULT_SECTIONS)?.id).toBe('beavers')
    expect(matchSection('beaver', DEFAULT_SECTIONS)?.id).toBe('beavers')
  })

  it('ignores punctuation and the surrounding noise a form export adds', () => {
    expect(matchSection(' [Cubs]', DEFAULT_SECTIONS)?.id).toBe('cubs')
    expect(matchSection('CUBS ', DEFAULT_SECTIONS)?.id).toBe('cubs')
  })

  it('tolerates a plural either way round', () => {
    expect(matchSection('Venture', DEFAULT_SECTIONS)?.id).toBe('venturers')
    expect(matchSection('Ventures', DEFAULT_SECTIONS)?.id).toBe('venturers')
  })

  it('keeps Scouter out of Scouts', () => {
    // The workbook's substring counting folded every Scouter into Scouts.
    expect(matchSection('Scouter', DEFAULT_SECTIONS)?.id).toBe('scouters')
    expect(matchSection('Scouts', DEFAULT_SECTIONS)?.id).toBe('scouts')
  })

  it('matches a section the group added itself', () => {
    const mine = [...DEFAULT_SECTIONS, ROVERS]
    expect(matchSection('Rovers', mine)?.id).toBe('rovers')
    expect(matchSection('rover', mine)?.id).toBe('rovers')
    // And not against the built-in list, which is the point.
    expect(matchSection('Rovers', DEFAULT_SECTIONS)).toBeNull()
  })

  it('returns nothing for something unrecognisable', () => {
    expect(matchSection('Explorers', DEFAULT_SECTIONS)).toBeNull()
    expect(matchSection('', DEFAULT_SECTIONS)).toBeNull()
  })

  it('is what the importer uses', () => {
    expect(parseSection('Rovers', [...DEFAULT_SECTIONS, ROVERS])).toBe('rovers')
    expect(parseSection('Rovers')).toBeNull()
  })
})

describe('ordering and youth', () => {
  it('sorts by the group’s own order', () => {
    const shuffled: SectionDef[] = [
      { ...ROVERS, order: 3 },
      { ...DEFAULT_SECTIONS[0]!, order: 1 },
      { ...DEFAULT_SECTIONS[1]!, order: 2 },
    ]
    expect(sortSections(shuffled).map((s) => s.id)).toEqual([
      'beavers',
      'cubs',
      'rovers',
    ])
  })

  it('falls back to the name when two share an order', () => {
    const tied: SectionDef[] = [
      { ...ROVERS, name: 'Zebras', order: 1 },
      { ...DEFAULT_SECTIONS[0]!, name: 'Apples', order: 1 },
    ]
    expect(sortSections(tied).map((s) => s.name)).toEqual(['Apples', 'Zebras'])
  })

  it('separates youth from adult leaders', () => {
    expect(youthSections(DEFAULT_SECTIONS).map((s) => s.id)).toEqual([
      'beavers', 'cubs', 'scouts', 'venturers',
    ])
  })

  it('stands in for an id with no definition, rather than dropping it', () => {
    const orphan = sectionFor('timber-wolves', DEFAULT_SECTIONS)
    expect(orphan.name).toBe('timber-wolves')
    expect(orphan.tone).toBe('grey')
  })
})

describe('participation follows the configured list', () => {
  it('reports a row per configured section, in order', () => {
    const { rows } = sectionParticipation(
      people2025,
      assignments2025,
      slots2025,
      DEFAULT_SECTIONS,
    )
    expect(rows.map((r) => r.section)).toEqual([
      'beavers', 'cubs', 'scouts', 'venturers', 'scouters',
    ])
  })

  it('reports a section the group added', () => {
    const people = people2025.map((p, i) => (i === 0 ? { ...p, section: 'rovers' } : p))
    const { rows } = sectionParticipation(people, assignments2025, slots2025, [
      ...DEFAULT_SECTIONS,
      ROVERS,
    ])
    expect(rows.find((r) => r.section === 'rovers')?.people).toBe(1)
  })

  it('still counts hours for a section that has been removed', () => {
    // Dropping a section from the list must not quietly remove its hours from the totals.
    const people = people2025.map((p, i) => (i === 0 ? { ...p, section: 'rovers' } : p))
    const { rows, totalHours } = sectionParticipation(
      people,
      assignments2025,
      slots2025,
      DEFAULT_SECTIONS,
    )
    const orphan = rows.find((r) => r.section === 'rovers')
    expect(orphan).toBeDefined()
    expect(orphan!.hours).toBeGreaterThan(0)
    expect(rows.reduce((sum, r) => sum + r.hours, 0)).toBeCloseTo(totalHours, 5)
  })

  it('counts youth hours from the youth flag, not a hard-coded list', () => {
    // Make Venturers adult leaders and the youth figure must drop accordingly.
    const asAdults = DEFAULT_SECTIONS.map((s) =>
      s.id === 'venturers' ? { ...s, youth: false } : s,
    )
    const before = sectionParticipation(people2025, assignments2025, slots2025, DEFAULT_SECTIONS)
    const after = sectionParticipation(people2025, assignments2025, slots2025, asAdults)

    const venturerHours = before.rows.find((r) => r.section === 'venturers')!.hours
    expect(venturerHours).toBeGreaterThan(0)
    expect(after.youthHours).toBeCloseTo(before.youthHours - venturerHours, 5)
    // The overall total is unchanged: only the youth split moved.
    expect(after.totalHours).toBe(before.totalHours)
  })

  it('shares still sum to one', () => {
    const { rows } = sectionParticipation(
      people2025,
      assignments2025,
      slots2025,
      DEFAULT_SECTIONS,
    )
    expect(rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1, 10)
  })
})
