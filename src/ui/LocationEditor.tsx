import { useState } from 'react'
import type { ReactNode } from 'react'
import { DAY_LABEL, hourOptions, hoursForNewDay, isOpenOn } from '../domain/slots'
import { mapsSearchUrl } from '../domain/maps'
import { DAYS } from '../domain/types'
import type { Location, OpenRange } from '../domain/types'
import { saveLocation, useLocations } from '../lib/repo'
import { Modal } from './Modal'
import { TagInput } from './TagInput'

/**
 * A location's own record: name, address, who to ring, opening hours, past names.
 *
 * Lifted out of the library screen so the location page can offer the same thing. It was
 * the only place a shop's address or its manager's number could be corrected, which meant
 * noticing a wrong number on a location's own page and then going to find the row again.
 *
 * The library spans every year, so an edit here is an edit to every year at once — that is
 * why writing it is admin-only, and why the caller decides whether to offer the button.
 */

/** Ids are derived from the name, so a new record matches whatever the importer would make. */
const slugifyLocation = (name: string): string =>
  name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

export function LocationEditor({
  location,
  onClose,
  onSaved,
}: {
  location: Location
  onClose: () => void
  onSaved?: (location: Location) => void
}): ReactNode {
  const [draft, setDraft] = useState<Location>(location)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  // Whether somebody asked for a hand-written map link on a record that has none stored.
  const [customLink, setCustomLink] = useState(false)

  const options = hourOptions(15)
  const derived = mapsSearchUrl(draft.address)

  /*
    A new location whose name lands on one already in the library.

    Ids come from the name, so saving would merge onto that record — quietly replacing its
    address, its opening hours and the past names holding four years of takings on one row.
    Two branches of the same chain are a real thing, and they need telling apart on a board
    anyway, so the answer is a different name rather than a second identical one.

    Only while adding. Editing a location keeps the id it already has.
  */
  const library = useLocations()
  const clash = (() => {
    if (draft.id || !draft.name.trim()) return null

    const wanted = slugifyLocation(draft.name)

    /*
      Two questions, and both matter.

      Landing on an existing id is the destructive one: that record would be merged over.
      Reading the same as an existing name is the confusing one — a board with two rows saying
      the same thing cannot be worked from, whatever the ids underneath say.

      Both are asked through the slug, so "Braemar — 640" and "Braemar - 640" are the same
      question. A location added here takes its id from its name; one that arrived by import
      need not, so checking only ids would miss every location that came in that way.
    */
    return (
      library.data.find((l) => l.id === wanted || slugifyLocation(l.name) === wanted) ?? null
    )
  })()

  const save = async (): Promise<void> => {
    const id = draft.id || slugifyLocation(draft.name)
    if (!id) return
    setSaving(true)
    setError(null)
    try {
      const saved = { ...draft, id }
      await saveLocation(saved)
      onSaved?.(saved)
      onClose()
    } catch (e) {
      // In the dialog, not on the page behind it: writing the library is admin-only, and
      // an organizer who gets here should be told why rather than watching nothing happen.
      setError(e as Error)
    } finally {
      setSaving(false)
    }
  }

  return (
          <Modal
        title={draft.id ? draft.name || 'Edit location' : 'New location'}
        onClose={() => {
          onClose()
        }}
        footer={
          <>
            <button
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              className="primary"
              disabled={saving || !draft.name.trim() || clash !== null}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        <div className="stack">
          {error && <div className="note error">{error.message}</div>}
          {clash && (
            <div className="note warning">
              There is already a location called <strong>{clash.name}</strong>. Saving this
              would write over it, so give this one a name that tells them apart — or close
              this and open that one to change it.
            </div>
          )}
          <div className="row">
            <label style={{ flex: '3 1 16rem' }}>
              Name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Braemar — 640 Linden Drive"
              />
            </label>
            <label style={{ flex: '0 1 7rem' }}>
              Group code
              <input
                value={draft.groupCode}
                onChange={(e) => setDraft({ ...draft, groupCode: e.target.value })}
              />
            </label>
          </div>

          <div className="row">
            <label style={{ flex: '2 1 14rem' }}>
              Address
              <input
                value={draft.address}
                onChange={(e) => setDraft({ ...draft, address: e.target.value })}
              />
            </label>
          </div>

          <div className="row">
            {draft.mapsUrl || customLink ? (
              <label style={{ flex: '2 1 14rem' }}>
                Map link
                <input
                  value={draft.mapsUrl}
                  onChange={(e) => setDraft({ ...draft, mapsUrl: e.target.value })}
                  placeholder="https://maps.google.com/…"
                />
              </label>
            ) : (
              <div className="small muted" style={{ flex: '2 1 14rem' }}>
                {derived ? (
                  <>
                    Map link made from the address.{' '}
                    <a href={derived} target="_blank" rel="noreferrer">
                      Check it
                    </a>
                  </>
                ) : (
                  'Add an address and the map link is made from it.'
                )}
              </div>
            )}
            <button
              className="tiny"
              onClick={() => {
                if (draft.mapsUrl) setDraft({ ...draft, mapsUrl: '' })
                setCustomLink(!draft.mapsUrl && !customLink)
              }}
            >
              {draft.mapsUrl || customLink ? 'Use the address' : 'Use a different link'}
            </button>
          </div>

          <div>
            <div className="small muted">
              When this place is actually open — independent of the hours we staff. Used
              to warn if someone is scheduled at a locked door.
            </div>
            {DAYS.map((day) => {
              const open = isOpenOn(draft.openHours, day)
              const range = open ? draft.openHours[day]! : null
              // Off stores an explicit null rather than removing the day: "closed" is a
              // decision the schedule board acts on, and deleting the key would demote
              // it to "nobody recorded it".
              const setRange = (next: OpenRange | null): void =>
                setDraft({
                  ...draft,
                  openHours: { ...draft.openHours, [day]: next },
                })
              return (
                <div className="row" key={day} style={{ marginTop: '0.35rem' }}>
                  <strong className="small" style={{ minWidth: '5rem' }}>
                    {DAY_LABEL[day]}
                  </strong>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={open}
                    aria-label={`Open on ${DAY_LABEL[day]}`}
                    onChange={(e) =>
                      // Switching one on copies the nearest day already open, so a shop that
                      // keeps the same hours all week is six switches rather than fourteen
                      // dropdowns. Every one of them is still editable afterwards.
                      setRange(e.target.checked ? hoursForNewDay(draft.openHours, day) : null)
                    }
                  />
                  {range ? (
                    <>
                      <select
                        value={range.openMin}
                        onChange={(e) =>
                          setRange({ ...range, openMin: Number(e.target.value) })
                        }
                      >
                        {options.map((o) => (
                          <option key={o.min} value={o.min}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="muted">to</span>
                      <select
                        value={range.closeMin}
                        onChange={(e) =>
                          setRange({ ...range, closeMin: Number(e.target.value) })
                        }
                      >
                        {options.map((o) => (
                          <option key={o.min} value={o.min}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      {range.closeMin <= range.openMin && (
                        <span className="small" style={{ color: 'var(--bad)' }}>
                          closes before it opens
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="small muted">closed</span>
                  )}
                </div>
              )
            })}
          </div>

          <label>
            Standing instructions <span className="muted">(shown to volunteers)</span>
            <input
              value={draft.comments}
              onChange={(e) => setDraft({ ...draft, comments: e.target.value })}
              placeholder="Outside on the sidewalk. Do not block the doors."
            />
          </label>

          <fieldset
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}
          >
            <legend className="small muted">Site contact</legend>
            <div className="row">
              {(['name', 'role', 'phone', 'email'] as const).map((field) => (
                <label key={field} style={{ flex: '1 1 9rem' }}>
                  {field}
                  <input
                    value={draft.siteContact?.[field] ?? ''}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        siteContact: {
                          name: '', role: '', phone: '', email: '',
                          ...draft.siteContact,
                          [field]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            Insurance
            <input
              value={draft.insurance}
              onChange={(e) => setDraft({ ...draft, insurance: e.target.value })}
              placeholder="Generic certificate supplied"
            />
          </label>

          <div>
            <label>
              Past names{' '}
              <span className="muted">
                (keeps year-over-year totals together — comma or enter to add)
              </span>
            </label>
            <TagInput
              label="Past names"
              values={draft.aliases}
              placeholder="Braemar Aldergrove"
              onChange={(aliases) => setDraft({ ...draft, aliases })}
            />
          </div>

          {!draft.id && draft.name && (
            <p className="small muted mono">id: {slugifyLocation(draft.name)}</p>
          )}
        </div>
      </Modal>
  )
}
