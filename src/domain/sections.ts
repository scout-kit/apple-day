/**
 * The group's sections, as data rather than a fixed list.
 *
 * Which sections a group runs is not a property of this app: names differ between groups
 * and countries, Scouts Canada has changed them before, and a group might add Rovers or
 * drop one entirely. Hard-coding five of them meant a rename was a code change and an
 * unfamiliar section could not be recorded at all.
 *
 * Sections are global, like the location library — shared by every event, so year-over-year
 * participation stays comparable.
 */

/** A named colour from the app's palette, so a section reads consistently in both themes. */
export const SECTION_TONES = [
  'amber',
  'green',
  'red',
  'blue',
  'purple',
  'grey',
] as const
export type SectionTone = (typeof SECTION_TONES)[number]

export interface SectionDef {
  /** Stable, URL and key safe. Never changes once people reference it. */
  id: string
  name: string
  /**
   * Youth, as opposed to an adult leader. Drives the youth-hours figure and which
   * sections the board warns about being left alone at a location.
   */
  youth: boolean
  order: number
  tone: SectionTone
  /** Spellings the CSV import should map to this section. */
  aliases: string[]
}

/**
 * What a group starts with — the sections this one was running in 2025.
 *
 * Also the fallback when nothing is configured, so the app is usable before anyone visits
 * the sections screen.
 */
export const DEFAULT_SECTIONS: SectionDef[] = [
  { id: 'beavers', name: 'Beavers', youth: true, order: 1, tone: 'amber', aliases: ['beaver'] },
  { id: 'cubs', name: 'Cubs', youth: true, order: 2, tone: 'green', aliases: ['cub'] },
  { id: 'scouts', name: 'Scouts', youth: true, order: 3, tone: 'red', aliases: ['scout'] },
  {
    id: 'venturers',
    name: 'Venturers',
    youth: true,
    order: 4,
    tone: 'blue',
    aliases: ['venturer', 'venture', 'ventures'],
  },
  {
    id: 'scouters',
    name: 'Scouters',
    youth: false,
    order: 5,
    tone: 'grey',
    aliases: ['scouter', 'leader', 'parent', 'adult'],
  },
]

/** A URL and key safe id from a section name. */
export function slugifySection(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return slug || 'section'
}

export const sortSections = (sections: SectionDef[]): SectionDef[] =>
  [...sections].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))

export const youthSections = (sections: SectionDef[]): SectionDef[] =>
  sections.filter((s) => s.youth)

/**
 * Match a section from whatever the form or a spreadsheet called it.
 *
 * Tries the id, the name, then any recorded alias, ignoring case, punctuation and
 * pluralisation — which is what turns "Beaver", "beavers" and " [Beavers]" into one
 * section, and keeps "Scouter" from folding into "Scouts".
 */
export function matchSection(raw: string, sections: SectionDef[]): SectionDef | null {
  const key = raw.toLowerCase().replace(/[^a-z]/g, '')
  if (!key) return null

  for (const section of sortSections(sections)) {
    const candidates = [section.id, section.name, ...section.aliases].map((c) =>
      c.toLowerCase().replace(/[^a-z]/g, ''),
    )
    if (candidates.includes(key)) return section
    // Tolerate a trailing plural either way round: "cub" against "cubs".
    if (candidates.some((c) => c === `${key}s` || `${c}s` === key)) return section
  }
  return null
}

/** The section a person belongs to, or a stand-in so a stale id still renders. */
export function sectionFor(id: string, sections: SectionDef[]): SectionDef {
  return (
    sections.find((s) => s.id === id) ?? {
      id,
      name: id,
      youth: true,
      order: 999,
      tone: 'grey',
      aliases: [],
    }
  )
}
