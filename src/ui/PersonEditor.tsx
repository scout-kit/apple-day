import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { freePersonId } from '../domain/importer'
import { fullName } from '../domain/types'
import type { Person } from '../domain/types'
import { useEvent } from '../lib/eventContext'
import { savePersonWithPairing, usePeople } from '../lib/repo'
import { useSections } from '../lib/sections'
import { Modal } from './Modal'
import { PersonPicker } from './PersonPicker'

/**
 * Their name, section, who to ring, and who they should be scheduled beside.
 *
 * Lifted out of the roster screen so the person page can offer the same thing. It was the
 * only place you could correct a misspelled name or a wrong phone number, which meant an
 * organizer looking somebody up — the screen you land on when a parent rings — had to go
 * back to the roster, find the row again, and edit it there.
 *
 * It owns its own save, including the pairing bookkeeping: a pairing is written on both
 * people, so changing one has to clear whoever either of them used to be paired with, or
 * the old partner is left pointing at somebody who is no longer pointing back.
 */
export function PersonEditor({
  person,
  adding = false,
  onClose,
  onSaved,
}: {
  person: Person
  adding?: boolean
  onClose: () => void
  onSaved?: (person: Person) => void
}): ReactNode {
  const { event } = useEvent()
  const people = usePeople()
  const { sections } = useSections()

  const [draft, setDraft] = useState<Person>(person)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [pairingAnchor, setPairingAnchor] = useState<DOMRect | null>(null)

  const save = async (): Promise<void> => {
    // People are stored under the event, so there is nowhere to write without one.
    if (!event) return
    setSaving(true)
    setError(null)
    try {
      // Somebody added by hand gets the same derived id the CSV importer would give them,
      // so a later form import matches this record instead of creating a second one.
      /*
        An id nobody else holds, for somebody being added.

        The derived id is name plus section, and two people can share both — so adding a
        second Luca to Scouts wrote over the first, and a youth vanished off the board with
        nothing said. Editing keeps whatever id the person already has.
      */
      const id =
        draft.id ||
        freePersonId(
          draft.firstName,
          draft.lastName,
          draft.section,
          people.data.map((p) => p.id),
        )

      // Anyone being dropped out of a pairing has to be cleared too: the person's previous
      // partner, and whoever the new partner was paired with before.
      const previous = people.data.find((p) => p.id === id)?.pairWithPersonId
      const newPartnersOld = draft.pairWithPersonId
        ? people.data.find((p) => p.id === draft.pairWithPersonId)?.pairWithPersonId
        : null

      const saved = { ...draft, id }
      await savePersonWithPairing(
        event.id,
        saved,
        [previous, newPartnersOld].filter((v): v is string => Boolean(v)),
      )
      onSaved?.(saved)
      onClose()
    } catch (e) {
      // Shown in the dialog rather than on the page behind it: you are looking at the form
      // you just pressed Save on, and a banner underneath the dialog is a banner nobody
      // reads.
      setError(e as Error)
    } finally {
      setSaving(false)
    }
  }

  /** Somebody already here with this name, in this section. Named so it can be said. */
  const namesake = useMemo(() => {
    const first = draft.firstName.trim().toLowerCase()
    const last = draft.lastName.trim().toLowerCase()
    if (!first && !last) return null

    const match = people.data.find(
      (p) =>
        p.id !== draft.id &&
        p.section === draft.section &&
        p.firstName.trim().toLowerCase() === first &&
        p.lastName.trim().toLowerCase() === last,
    )
    return match ? fullName(match) : null
  }, [people.data, draft.firstName, draft.lastName, draft.section, draft.id])

  return (
    <Modal
      title={adding ? 'Add someone' : fullName(person)}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button
            className="primary"
            disabled={saving || !draft.firstName.trim()}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="stack">
        {error && <div className="note error">{error.message}</div>}

        <div className="row">
          <label style={{ flex: '1 1 8rem' }}>
            First name
            <input
              value={draft.firstName}
              onChange={(e) => setDraft({ ...draft, firstName: e.target.value })}
            />
          </label>
          <label style={{ flex: '1 1 8rem' }}>
            Last name
            <input
              value={draft.lastName}
              onChange={(e) => setDraft({ ...draft, lastName: e.target.value })}
            />
          </label>
          <label style={{ flex: '0 1 8rem' }}>
            Section
            <select
              value={draft.section}
              onChange={(e) => setDraft({ ...draft, section: e.target.value })}
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
              {/* Somebody in a since-removed section keeps it until it is changed. */}
              {!sections.some((s) => s.id === draft.section) && (
                <option value={draft.section}>{draft.section}</option>
              )}
            </select>
          </label>
        </div>

        {/*
          Said, not prevented. Two people sharing a name and a section is ordinary, and this
          is the second record rather than an edit of the first — which is worth knowing at
          the moment it happens, because on the board they are two rows reading the same.
        */}
        {adding && namesake && (
          <p className="small" style={{ margin: 0, color: 'var(--warn)' }}>
            There is already {namesake} here. This adds a second person of that name — open
            the first from the roster if you meant to change them instead.
          </p>
        )}

        <div className="row">
          <label style={{ flex: '1 1 10rem' }}>
            Parent or guardian
            <input
              value={draft.parentName}
              onChange={(e) => setDraft({ ...draft, parentName: e.target.value })}
            />
          </label>
          <label style={{ flex: '1 1 12rem' }}>
            Email
            <input
              type="email"
              value={draft.parentEmail}
              onChange={(e) => setDraft({ ...draft, parentEmail: e.target.value })}
            />
          </label>
          <label style={{ flex: '1 1 9rem' }}>
            Phone
            <input
              inputMode="tel"
              value={draft.parentPhone}
              onChange={(e) => setDraft({ ...draft, parentPhone: e.target.value })}
            />
          </label>
        </div>

        <div>
          <label>
            Schedule alongside{' '}
            <span className="muted">(siblings and buddies stay together)</span>
          </label>
          {/* A search rather than a dropdown of everybody, for the same reason the
              schedule board uses one: ninety names cannot be scrolled usefully. */}
          <div className="row" style={{ marginTop: '0.15rem' }}>
            {draft.pairWithPersonId ? (
              <span className="chip" style={{ paddingLeft: '0.5rem' }}>
                {(() => {
                  const partner = people.data.find((p) => p.id === draft.pairWithPersonId)
                  return partner ? fullName(partner) : draft.pairWithPersonId
                })()}
                <button
                  className="x"
                  aria-label="Not paired with anybody"
                  onClick={() => setDraft({ ...draft, pairWithPersonId: null })}
                >
                  ×
                </button>
              </span>
            ) : (
              <span className="small muted">Nobody in particular</span>
            )}
            <button
              aria-haspopup="dialog"
              onClick={(e) => setPairingAnchor(e.currentTarget.getBoundingClientRect())}
            >
              {draft.pairWithPersonId ? 'Change' : 'Choose someone'}
            </button>
          </div>
          <p className="small muted" style={{ marginTop: '0.3rem' }}>
            Saved on both of them, so it reads the same from either side.
          </p>
        </div>

        {pairingAnchor && (
          <PersonPicker
            anchor={pairingAnchor}
            title={`Schedule ${draft.firstName || 'them'} alongside`}
            groups={[
              {
                label: 'Already paired with somebody',
                people: people.data.filter((p) => p.id !== draft.id && p.pairWithPersonId),
                hint: 'will be re-paired',
              },
              {
                label: 'Not paired',
                people: people.data.filter((p) => p.id !== draft.id && !p.pairWithPersonId),
              },
            ]}
            onPick={(personId) => {
              setDraft({ ...draft, pairWithPersonId: personId })
              setPairingAnchor(null)
            }}
            onClose={() => setPairingAnchor(null)}
          />
        )}

        <p className="small muted">
          {adding
            ? 'Availability is set on the roster grid once they are saved — click the hours they can work.'
            : 'Set the hours they can work by clicking them on the roster grid.'}
        </p>
      </div>
    </Modal>
  )
}
