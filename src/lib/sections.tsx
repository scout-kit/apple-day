import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_SECTIONS, sectionFor, sortSections } from '../domain/sections'
import type { SectionDef } from '../domain/sections'
import { useSectionDefs } from './repo'

/**
 * The group's sections, once, for the whole app.
 *
 * A context rather than a hook per component: a section pill appears hundreds of times on
 * the signups grid, and each one opening its own Firestore listener would be absurd.
 *
 * The default value is the built-in set, so a component rendered outside the provider — a
 * test, mostly — still has sections to work with instead of blank labels.
 */

export interface SectionsValue {
  sections: SectionDef[]
  /** Never misses: an unknown id comes back as a grey stand-in named after itself. */
  lookup: (id: string) => SectionDef
  loading: boolean
}

const SectionsContext = createContext<SectionsValue>({
  sections: DEFAULT_SECTIONS,
  lookup: (id) => sectionFor(id, DEFAULT_SECTIONS),
  loading: false,
})

export function SectionsProvider({ children }: { children: ReactNode }): ReactNode {
  const stored = useSectionDefs()

  const value = useMemo(() => {
    const sections = sortSections(stored.data)
    const byId = new Map(sections.map((s) => [s.id, s]))
    return {
      sections,
      lookup: (id: string) => byId.get(id) ?? sectionFor(id, sections),
      loading: stored.loading,
    }
  }, [stored.data, stored.loading])

  return <SectionsContext.Provider value={value}>{children}</SectionsContext.Provider>
}

export const useSections = (): SectionsValue => useContext(SectionsContext)
