import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { nudgeItem } from '../domain/ordering'
import { DEFAULT_SECTIONS, SECTION_TONES, slugifySection } from '../domain/sections'
import type { SectionDef, SectionTone } from '../domain/sections'
import {
  deleteSection,
  reorderSections,
  saveSection,
  useAssignments,
  usePeople,
  useSectionDefs,
} from '../lib/repo'
import { ErrorNote, Loading } from './Bits'
import { Modal } from './Modal'
import { TagInput } from './TagInput'

const blank = (order: number): SectionDef => ({
  id: '',
  name: '',
  youth: true,
  order,
  tone: 'grey',
  aliases: [],
})

/**
 * The group's sections.
 *
 * Which sections exist is the group's business, not this app's: names differ between
 * groups, Scouts Canada has changed them before, and a group might run Rovers or drop a
 * section for a year. They are global — shared by every event — so participation stays
 * comparable year to year.
 *
 * Order is the order they appear everywhere else. `Youth` is what separates the youth-hours
 * figure from adult leaders, and what makes the schedule board warn about somebody being
 * left alone at a location.
 */
export function SectionsScreen(): ReactNode {
  const stored = useSectionDefs()
  const people = usePeople()
  const assignments = useAssignments()

  const [editing, setEditing] = useState<SectionDef | null>(null)
  const [saving, setSaving] = useState(false)
  const [writeError, setWriteError] = useState<Error | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<SectionDef | null>(null)

  const sections = stored.data
  /** Whether anything is configured yet, or these are still the built-in defaults. */
  const usingDefaults = useMemo(
    () =>
      sections.length === DEFAULT_SECTIONS.length &&
      sections.every((s, i) => s.id === DEFAULT_SECTIONS[i]?.id),
    [sections],
  )

  const headcount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const person of people.data) {
      counts.set(person.section, (counts.get(person.section) ?? 0) + 1)
    }
    return counts
  }, [people.data])

  /** Sections that people are recorded in but which are not configured. */
  const orphaned = useMemo(
    () => [...headcount.keys()].filter((id) => !sections.some((s) => s.id === id)),
    [headcount, sections],
  )

  const save = async (): Promise<void> => {
    if (!editing) return
    setSaving(true)
    try {
      await saveSection({
        ...editing,
        id: editing.id || slugifySection(editing.name),
        name: editing.name.trim(),
      })
      setEditing(null)
    } catch (error) {
      setWriteError(error as Error)
    } finally {
      setSaving(false)
    }
  }

  const nudge = (id: string, delta: number): void => {
    setWriteError(null)
    void reorderSections(nudgeItem(sections.map((s) => s.id), id, delta)).catch(
      (error: Error) => setWriteError(error),
    )
  }

  const remove = (section: SectionDef): void => {
    setWriteError(null)
    setConfirmDelete(null)
    void deleteSection(section.id).catch((error: Error) => setWriteError(error))
  }

  if (stored.loading || people.loading) return <Loading what="Loading sections" />

  return (
    <>
      <ErrorNote error={writeError ?? stored.error ?? people.error} />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1>Sections</h1>
            <p className="small muted" style={{ margin: 0 }}>
              Shared by every event, so participation stays comparable year to year.
            </p>
          </div>
          <button
            className="primary"
            onClick={() => setEditing(blank(sections.length + 1))}
          >
            Add section
          </button>
        </div>

        {usingDefaults && (
          <div className="note info">
            These are the built-in defaults, not yet saved. Editing or reordering any of
            them stores the whole set — after that they are yours to change.
          </div>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: '5rem' }}>Order</th>
                <th>Section</th>
                <th>Counts as</th>
                <th>Also known as</th>
                <th className="right">People</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sections.map((section, index) => (
                <tr key={section.id}>
                  <td className="order-cell">
                    <span className="pos">{section.order}</span>
                    <button
                      className="nudge"
                      aria-label={`Move ${section.name} up`}
                      disabled={index === 0}
                      onClick={() => nudge(section.id, -1)}
                    >
                      ▲
                    </button>
                    <button
                      className="nudge"
                      aria-label={`Move ${section.name} down`}
                      disabled={index === sections.length - 1}
                      onClick={() => nudge(section.id, 1)}
                    >
                      ▼
                    </button>
                  </td>
                  <td>
                    <span className={`pill tone-${section.tone}`}>{section.name}</span>
                    <div className="small muted mono">{section.id}</div>
                  </td>
                  <td className="small">
                    {section.youth ? 'youth' : <span className="muted">adult leader</span>}
                  </td>
                  <td className="small muted">
                    {section.aliases.length > 0 ? section.aliases.join(', ') : '—'}
                  </td>
                  <td className="right">{headcount.get(section.id) ?? 0}</td>
                  <td>
                    <div className="row" style={{ gap: '0.25rem' }}>
                      <button className="tiny" onClick={() => setEditing(section)}>
                        Edit
                      </button>
                      <button className="tiny" onClick={() => setConfirmDelete(section)}>
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {orphaned.length > 0 && (
          <div className="note warning">
            <strong>
              {orphaned.length} section{orphaned.length === 1 ? '' : 's'} in use but not
              configured
            </strong>
            <div className="small">
              People are recorded in {orphaned.join(', ')}. Their hours still count — add
              the section back, or move those people on the Signups screen.
            </div>
          </div>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? editing.name || 'Edit section' : 'New section'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button onClick={() => setEditing(null)}>Cancel</button>
              <button
                className="primary"
                disabled={saving || !editing.name.trim()}
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <div className="stack">
            <div className="row">
              <label style={{ flex: '2 1 12rem' }}>
                Name
                <input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="Rovers"
                />
              </label>
              <label style={{ flex: '1 1 8rem' }}>
                Colour
                <select
                  value={editing.tone}
                  onChange={(e) =>
                    setEditing({ ...editing, tone: e.target.value as SectionTone })
                  }
                >
                  {SECTION_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {tone}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="row">
              <span className={`pill tone-${editing.tone}`}>
                {editing.name.trim() || 'preview'}
              </span>
            </div>

            <label className="row" style={{ gap: '0.4rem' }}>
              <input
                type="checkbox"
                className="switch"
                checked={editing.youth}
                onChange={(e) => setEditing({ ...editing, youth: e.target.checked })}
              />
              <span>
                Youth section
                <span className="muted">
                  {' '}
                  — counted in youth hours, and warned about being left alone
                </span>
              </span>
            </label>

            <div>
              <label htmlFor="section-aliases">
                Also known as{' '}
                <span className="muted">
                  (spellings the form import should map here — comma or enter to add)
                </span>
              </label>
              <TagInput
                label="Also known as"
                values={editing.aliases}
                placeholder="rover"
                onChange={(aliases) => setEditing({ ...editing, aliases })}
              />
            </div>

            {!editing.id && editing.name.trim() && (
              <p className="small muted mono">id: {slugifySection(editing.name)}</p>
            )}
            {editing.id && (
              <p className="small muted">
                The id <span className="mono">{editing.id}</span> stays as it is — people are
                recorded against it, so renaming is safe.
              </p>
            )}
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title={`Remove ${confirmDelete.name}?`}
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="danger" onClick={() => remove(confirmDelete)}>
                Remove {confirmDelete.name}
              </button>
            </>
          }
        >
          <div className="stack">
            {(headcount.get(confirmDelete.id) ?? 0) > 0 ? (
              <div className="note warning">
                {headcount.get(confirmDelete.id)} {' '}
                {headcount.get(confirmDelete.id) === 1 ? 'person is' : 'people are'} recorded
                in {confirmDelete.name}. They keep it, and their hours still count — the
                section simply stops being offered for new entries, and shows as unconfigured
                until you add it back.
              </div>
            ) : (
              <p>Nobody is recorded in {confirmDelete.name}.</p>
            )}
            <p className="small muted">
              Past years are untouched: their participation figures are built from what each
              person's section was, not from this list.
              {assignments.data.length > 0 &&
                ' Shifts already scheduled are unaffected.'}
            </p>
          </div>
        </Modal>
      )}
    </>
  )
}
