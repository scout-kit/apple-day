import { collection, doc } from 'firebase/firestore'
import { db } from './firebase'

/**
 * Every Firestore path in one place, so a typo is a compile error rather than a 404.
 *
 * Anything scoped to one year takes `eventId` explicitly — no default. An implicit
 * "current event" here is how you end up writing 2027's assignments into 2026.
 */

export const paths = {
  admins: () => collection(db, 'admins'),
  admin: (uid: string) => doc(db, 'admins', uid),

  /**
   * Invitations, keyed by the code that claims them.
   *
   * Passed through exactly as given, and it has to be. The alphabet has both cases in it, so
   * normalising a code — lowercasing it, trimming it — turns a real one into one that matches
   * no document, and the app cannot tell that apart from an invitation already used. Every
   * link would read "this cannot be used", with nothing anywhere saying why.
   */
  invites: () => collection(db, 'invites'),
  invite: (code: string) => doc(db, 'invites', code),

  claim: (uid: string) => doc(db, 'claims', uid),

  /*
    Who changed what, in one collection rather than under each event.

    A question about the money is asked in one place — "what happened to jar 12" — and
    splitting the answer across per-event subcollections would mean knowing which year to
    look in before you could ask. Entries carry their own `eventId`, so the screen filters
    and the shared library's changes have somewhere to live too.
  */
  auditLog: () => collection(db, 'audit'),
  auditEntry: (id: string) => doc(collection(db, 'audit'), id),

  // ---- global library: facts about real places, shared by every year ----
  locations: () => collection(db, 'locations'),
  location: (id: string) => doc(db, 'locations', id),

  /** The group's sections — global, like the location library. */
  sections: () => collection(db, 'sections'),
  section: (id: string) => doc(db, 'sections', id),



  // ---- events ----
  events: () => collection(db, 'events'),
  event: (eventId: string) => doc(db, 'events', eventId),

  /** Which library locations this year uses, and in what order. */
  eventLocations: (eventId: string) => collection(db, 'events', eventId, 'eventLocations'),
  eventLocation: (eventId: string, locationId: string) =>
    doc(db, 'events', eventId, 'eventLocations', locationId),

  /**
   * The youth and leaders taking part in one event.
   *
   * Scoped to the event, not shared across years. A person is a fact about a particular
   * Apple Day — who signed up, who was rostered, whose parent to ring — and a system-wide
   * register of children would mean deleting somebody from this year leaves their name and
   * their parent's phone number behind indefinitely. Deleting them here deletes them.
   *
   * The cost, accepted deliberately: there is no identity spanning years, so no per-person
   * record across events. Locations still have one, which is where year-over-year lives.
   */
  people: (eventId: string) => collection(db, 'events', eventId, 'people'),
  person: (eventId: string, id: string) => doc(db, 'events', eventId, 'people', id),

  signups: (eventId: string) => collection(db, 'events', eventId, 'signups'),
  signup: (eventId: string, id: string) => doc(db, 'events', eventId, 'signups', id),

  assignments: (eventId: string) => collection(db, 'events', eventId, 'assignments'),
  assignment: (eventId: string, id: string) =>
    doc(db, 'events', eventId, 'assignments', id),

  jars: (eventId: string) => collection(db, 'events', eventId, 'jars'),
  jar: (eventId: string, id: string) => doc(db, 'events', eventId, 'jars', id),

  reconciliation: (eventId: string) =>
    doc(db, 'events', eventId, 'reconciliation', 'summary'),

  /**
   * Passes are top-level, not nested under the event.
   *
   * A pass is a capability: the 22-character token IS the credential, and it has to be
   * resolvable by someone who knows nothing else — a parent opening a QR code has no idea
   * which event id their shift belongs to. Each pass carries its own `eventId` field
   * instead. Tokens are globally unique, so there is no collision to worry about.
   */
  passes: () => collection(db, 'passes'),
  pass: (token: string) => doc(db, 'passes', token),

  /**
   * What the last publish wrote, so the app can tell whether the board has moved on since.
   *
   * Under the event, where only the roster can read it, and in its own subcollection rather
   * than on the event document — publishing is organizer work and the event itself is
   * admin-only.
   */
  publishState: (eventId: string) => doc(db, 'events', eventId, 'meta', 'publish'),

  swapRequests: (eventId: string) => collection(db, 'events', eventId, 'swapRequests'),
  swapRequest: (eventId: string, id: string) =>
    doc(db, 'events', eventId, 'swapRequests', id),

  /**
   * What has already been sent to whom.
   *
   * The id is built from the wording, what it was about, and the youth — see
   * `domain/reminders`. That makes "have we already told them this" a single lookup by id
   * rather than a query, which needs no index and cannot go stale.
   */
  /**
   * The wording of each reminder, where it has been changed from the built-in.
   *
   * Not under an event: how the group words a reminder is not a fact about one Apple Day,
   * and nobody wants to write it again every October. Absence means the built-in wording,
   * so nothing needs seeding and resetting is a delete.
   */
  reminderTemplates: () => collection(db, 'reminderTemplates'),
  reminderTemplate: (id: string) => doc(collection(db, 'reminderTemplates'), id),

  reminders: (eventId: string) => collection(db, 'events', eventId, 'reminders'),
  reminder: (eventId: string, id: string) => doc(db, 'events', eventId, 'reminders', id),
}
