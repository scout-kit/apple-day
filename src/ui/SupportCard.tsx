import type { ReactNode } from 'react'
import { contactLabel } from '../domain/support'
import type { SupportContact } from '../domain/support'

/**
 * Who to contact on the day, as shown to a volunteer or a parent.
 *
 * On a volunteer's pass. It was shared with the public schedule, which is gone.
 * Phone numbers are `tel:` links and emails `mailto:` links, because this is read on a phone
 * in a car park with one bar of signal and nobody is retyping a number.
 */
export function SupportCard({
  contacts,
  note = '',
  heading = 'Need help on the day?',
}: {
  contacts: SupportContact[]
  /** The organizers' own words, from the event. Empty means nothing is added. */
  note?: string
  heading?: string
}): ReactNode {
  if (contacts.length === 0 && note.trim() === '') return null

  return (
    <div className="card">
      <strong>{heading}</strong>
      <ul className="contact-list">
        {contacts.map((contact, i) => (
          <li key={i}>
            <span className="contact-name">{contactLabel(contact)}</span>
            <span className="contact-links">
              {/* The name may already be the number, when that is all there is; showing it
                  twice reads as two contacts. */}
              {contact.phone && contactLabel(contact) !== contact.phone && (
                <a href={`tel:${contact.phone}`}>{contact.phone}</a>
              )}
              {contact.phone && contactLabel(contact) === contact.phone && (
                <a href={`tel:${contact.phone}`}>Call</a>
              )}
              {contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}
            </span>
          </li>
        ))}
      </ul>
      {note.trim() !== '' && (
        // The organizers' words, not the app's. Kept as typed, including line breaks.
        <p className="small" style={{ marginTop: '0.35rem', whiteSpace: 'pre-line' }}>
          {note.trim()}
        </p>
      )}
    </div>
  )
}
