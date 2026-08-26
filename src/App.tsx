import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useEvent } from './lib/eventContext'
import { missingConfig, signInWithGoogle, signOutEverywhere } from './lib/firebase'
import { JoinPage } from './ui/JoinPage'
import { runsTheEvent, useSession } from './lib/session'
import { useRequestActions } from './ui/RequestActions'
import type { Role } from './lib/session'
import { Loading } from './ui/Bits'
import { PublishWatch, RepublishFlag } from './ui/PublishNotice'
import { ThemeButton } from './ui/ThemeButton'
import { PassPage } from './ui/PassPage'

/**
 * The pass page is imported eagerly; every organizer screen is lazy.
 *
 * A volunteer opening their pass on a phone in a car park should not be downloading the
 * QR scanner, the CSV parser and nine admin screens to read three lines of text. Keeping
 * them out of the entry chunk also keeps daily Hosting transfer well inside Spark's
 * 360 MB, which is the only quota this app comes near.
 */
const ScheduleScreen = lazy(async () => ({ default: (await import('./ui/ScheduleScreen')).ScheduleScreen }))
const PeopleScreen = lazy(async () => ({ default: (await import('./ui/PeopleScreen')).PeopleScreen }))
const EventsScreen = lazy(async () => ({ default: (await import('./ui/EventsScreen')).EventsScreen }))
const SectionsScreen = lazy(async () => ({ default: (await import('./ui/SectionsScreen')).SectionsScreen }))
const LibraryScreen = lazy(async () => ({ default: (await import('./ui/LibraryScreen')).LibraryScreen }))
const DayOfScreen = lazy(async () => ({ default: (await import('./ui/DayOfScreen')).DayOfScreen }))
const JarsScreen = lazy(async () => ({ default: (await import('./ui/JarsScreen')).JarsScreen }))
const MoneyScreen = lazy(async () => ({ default: (await import('./ui/MoneyScreen')).MoneyScreen }))
const HistoryScreen = lazy(async () => ({ default: (await import('./ui/HistoryScreen')).HistoryScreen }))
const AccessScreen = lazy(async () => ({ default: (await import('./ui/AccessScreen')).AccessScreen }))
const NotificationsScreen = lazy(async () => ({ default: (await import('./ui/NotificationsScreen')).NotificationsScreen }))
const PersonScreen = lazy(async () => ({ default: (await import('./ui/PersonScreen')).PersonScreen }))
const LocationScreen = lazy(async () => ({ default: (await import('./ui/LocationScreen')).LocationScreen }))
const ReconcileScreen = lazy(async () => ({ default: (await import('./ui/ReconcileScreen')).ReconcileScreen }))
const AuditScreen = lazy(async () => ({ default: (await import('./ui/AuditScreen')).AuditScreen }))
const RemindersScreen = lazy(async () => ({ default: (await import('./ui/RemindersScreen')).RemindersScreen }))
const LocationsScreen = lazy(async () => ({ default: (await import('./ui/LocationsScreen')).LocationsScreen }))
const ImportScreen = lazy(async () => ({ default: (await import('./ui/ImportScreen')).ImportScreen }))

/**
 * Routes split two ways by who can reach them:
 *   /p/:token                — a volunteer's own pass, no account at all
 *   everything else          — an account on the roster
 */

interface NavEntry {
  screen: string
  label: string
  /** Hidden from an organizer entirely, rather than shown and refused. */
  adminOnly?: true
}

interface NavGroup {
  label: string
  screens: NavEntry[]
}

/** Anybody on the roster: organizers and admins alike. */
const RUNS: Role[] = ['admin', 'organizer']

/** Only the tier that looks after what is shared between years. */
const ADMIN: Role[] = ['admin']

/**
 * Screen names, resolved to `/e/<event>/<screen>` so every link carries its event.
 *
 * Grouped, because these are three different kinds of thing and one flat row of fourteen
 * links said they were all the same. Running the event is what somebody does on the night;
 * records are what the event was worth afterwards; setup is the shape of the thing, mostly
 * touched once a year by whoever is putting it together.
 *
 * The order within each group is the order the work happens in.
 */
const ORGANIZER_NAV: NavGroup[] = [
  {
    label: 'Running',
    screens: [
      { screen: 'schedule-board', label: 'Schedule' },
      { screen: 'people', label: 'Signups' },
      { screen: 'day-of', label: 'Day of' },
      { screen: 'jars', label: 'Jars' },
      /*
        With the working screens rather than under Setup: reminders are sent the evening
        before and on the morning itself, from the same sitting as the schedule board.
      */
      { screen: 'reminders', label: 'Reminders' },
    ],
  },
  {
    label: 'Records',
    screens: [
      { screen: 'money', label: 'Money' },
      { screen: 'reconcile', label: 'Totals' },
      { screen: 'history', label: 'History' },
    ],
  },
  {
    label: 'Setup',
    screens: [
      { screen: 'events', label: 'Events' },
      { screen: 'locations', label: 'Locations' },
      /*
        The shared library and the importer are organizers' work.

        Finding a shop's address is wrong is something that happens standing outside it, and
        importing the form is the fiddliest job of the year but not the most dangerous one —
        an organizer can already add and edit people by hand, one at a time. What stays
        behind the admin line below is not the wide work, it is the irreversible work.
      */
      { screen: 'library', label: 'Library' },
      { screen: 'import', label: 'Import' },
    ],
  },
  {
    /*
      Its own group, and last.

      These were scattered through the others behind an `adminOnly` flag, which made the
      menu a different shape for different people with no explanation of why — an organizer
      saw Setup with three of its entries missing and no way to know they existed. Gathered
      under one heading, the line is visible: who gets in, what every year is shaped by, and
      the record of what everybody did.
    */
    label: 'Admin',
    screens: [
      { screen: 'access', label: 'Access', adminOnly: true },
      { screen: 'sections', label: 'Sections', adminOnly: true },
      /*
        A record about the organizers themselves rather than a working screen, which is why
        it sits here and not beside the money it explains.
      */
      { screen: 'audit', label: 'Audit log', adminOnly: true },
    ],
  },
]

/**
 * The bell, with a dot when somebody is waiting.
 *
 * The alert on the working screens says what is waiting *now*; this is how anybody gets to
 * the rest of it, from wherever they happen to be. Rendered only for the roster, because
 * nobody else can read requests and a bell that never lights is furniture.
 */
function NotificationBell(): ReactNode {
  const { pathFor } = useEvent()
  const { open } = useRequestActions()

  return (
    <NavLink
      to={pathFor('notifications')}
      className="bell"
      aria-label={
        open.length === 0
          ? 'Notifications'
          : `Notifications, ${open.length} waiting`
      }
      title="Notifications"
    >
      {/* Drawn rather than an emoji: an emoji bell is a different picture on every
          platform, sits off the text baseline, and cannot take the colour of the bar it is
          in. This one is a stroke, so it inherits `currentColor`. */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </svg>
      {open.length > 0 && (
        <span className="bell-dot" aria-hidden="true">
          {open.length > 9 ? '9+' : open.length}
        </span>
      )}
    </NavLink>
  )
}

function EventPicker(): ReactNode {
  const { events, event, select } = useEvent()
  if (events.length === 0) return null
  return (
    <div className="event-picker">
      <select
        value={event?.id ?? ''}
        aria-label="Event"
        onChange={(e) => select(e.target.value)}
      >
        {events.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * Which account you are signed in as.
 *
 * Worth a control of its own because nothing else implies it. An invitation names no
 * address, so whoever opens the link gets in with whatever account they signed in with —
 * and plenty of people have more than one Google account and land in the wrong one without
 * noticing. The symptom is not an error: it is being told they have no access, or quietly
 * working somewhere they did not mean to.
 *
 * The button shows enough to recognise; the panel shows the whole address and the tier, so
 * "am I the right person here" is answerable without signing out to find out.
 */
export function AccountButton(): ReactNode {
  const { user, role } = useSession()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Closed by a click outside, the same way every other panel here is, and for the same
  // reason: a full-page backdrop swallows the scroll of whatever is under it.
  useEffect(() => {
    if (!open) return

    const closeIfOutside = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && !box.current?.contains(target)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('touchstart', closeIfOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('touchstart', closeIfOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!user) {
    return (
      <button className="primary tiny" onClick={() => void signInWithGoogle()}>
        Organizer sign in
      </button>
    )
  }

  /*
    The name if Google gave one, otherwise the whole address.

    A name is what somebody recognises themselves by, and it is short. Falling back to the
    full address rather than the part before the @ matters when two accounts differ only
    after it — a work and a personal address at the same name are exactly the pair people
    mix up, and cutting at the @ hides the half that tells them apart.

    Long ones are trimmed with an ellipsis by the stylesheet rather than here, so the
    trimming follows the space actually available. The full text is on the button as a
    tooltip and spelled out in the panel.
  */
  const label = user.displayName || user.email || 'Account'

  return (
    <div className="account" ref={box}>
      <button
        className="ghost tiny account-button"
        aria-expanded={open}
        title={user.email || undefined}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>

      {open && (
        <div className="card account-panel">
          <div className="small muted">Signed in as</div>
          <div className="account-email">{user.email || 'this account has no email address'}</div>
          {user.displayName && <div className="small muted">{user.displayName}</div>}

          <div className="small muted" style={{ marginTop: '0.5rem' }}>
            {role === 'admin'
              ? 'Admin — you can change who has access and how each year is set up.'
              : role === 'organizer'
                ? 'Organizer — you can build the schedule, run the day and record the money.'
                : 'This account has no access yet.'}
          </div>

          <button
            className="ghost"
            style={{ marginTop: '0.6rem' }}
            onClick={() => void signOutEverywhere()}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function Shell({ children }: { children: ReactNode }): ReactNode {
  const { role } = useSession()
  const { pathFor } = useEvent()
  /*
    Screens above this tier are hidden, not shown and refused.

    A link that always answers "not yours" invites the click every time. The screens are
    still protected — the rules are the real gate — this only stops offering them.

    Filtered per entry and then per group, which is what empties the Admin heading for an
    organizer rather than leaving it standing with nothing under it.
  */
  const nav: NavGroup[] = (runsTheEvent(role) ? ORGANIZER_NAV : [])
    .map((group) => ({
      ...group,
      screens: group.screens.filter((entry) => !entry.adminOnly || role === 'admin'),
    }))
    .filter((group) => group.screens.length > 0)

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          Apple<span>Day</span>
        </div>
        {runsTheEvent(role) && <EventPicker />}
        {runsTheEvent(role) && <NotificationBell />}
        {runsTheEvent(role) && <RepublishFlag />}
        <div className="spacer" />
        <ThemeButton />
        <AccountButton />
      </header>
      {nav.length > 0 && (
        <nav className="nav">
          {nav.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              <div className="nav-group-links">
                {group.screens.map(({ screen, label }) => (
                  <NavLink
                    key={screen}
                    to={pathFor(screen)}
                    className={({ isActive }) => (isActive ? 'active' : '')}
                  >
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      )}
      <main>{children}</main>
    </div>
  )
}

/**
 * Shown when the current visitor cannot reach the screen they asked for.
 *
 * Being signed in but unauthorized is a different situation from being signed out, and
 * conflating them is genuinely confusing — you click "sign in", it succeeds, and the page
 * offers you the same sign-in button again with no hint that a separate grant is needed.
 * So the signed-in case says what is missing and exactly how to fix it.
 */
/** Where signing in lands you: the current event's board, or the events screen if none. */
function Landing({ screen }: { screen: string }): ReactNode {
  const { events, loading, pathFor } = useEvent()
  if (loading) return <Loading what="Opening" />
  if (events.length === 0) {
    return (
      <div className="card">
        <h1>No events yet</h1>
        <p>
          Create one to get started — an Apple Day, a bottle drive, anything with a
          schedule.
        </p>
        <a className="btn primary" href="/events">
          Create an event
        </a>
      </div>
    )
  }
  return <Navigate to={pathFor(screen)} replace />
}

export function SignInPrompt(): ReactNode {
  const { user, discarded } = useSession()

  /*
    A build that went out without its Firebase config.

    Signing in then opens a popup and shuts it again, and the console says the API key is not
    valid — an error about a key, on a screen with no keys on it. `make deploy` checks for
    this before building, so reaching here means a build got out another way; say what is
    wrong rather than leaving somebody to guess from a popup that flickered.
  */
  if (missingConfig.length > 0) {
    return (
      <div className="card">
        <h1>This site was built without its Firebase settings</h1>
        <p>
          Signing in cannot work until it is built again. Nothing is wrong with your account.
        </p>
        <p className="small muted">
          Missing from the build:{' '}
          <span className="mono">{missingConfig.join(', ')}</span>
        </p>
        <p className="small muted">
          Whoever deployed this needs to fill those into <span className="mono">.env</span>{' '}
          for this group and run the deploy again. They are baked in when the site is built,
          so there is nothing to change on the server.
        </p>
      </div>
    )
  }

  if (user) {
    return (
      <div className="card">
        {/*
          Two sentences, and nothing to work on.

          This is shown to whoever signs in, which in a deployed app is mostly people who
          should not be here at all — so it says the fact and the one thing that changes it.
          Anything more reads as a problem to be solved from this screen, and there is
          nothing here to solve: no setting to check, no id to quote, no retry that helps.

          Not the address either. The topbar says which account this is, on every screen.
        */}
        <h1>Your account doesn&apos;t have access</h1>
        <p>To get in you need an invitation link from somebody who already has access.</p>
        <div className="row">
          <button className="ghost" onClick={() => void signOutEverywhere()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  /*
    The one screen that does not fill the window.

    Everywhere else wants the width — a board on an ultrawide should show more of the
    afternoon. This is a wordmark, a sentence and a button, and stretched across three
    thousand pixels it reads as a page that failed to load.
  */
  return (
    <div className="landing">
      <div className="card landing-card">
        <div className="landing-brand">
          Apple<span>Day</span>
        </div>
        <p className="landing-lead">
          The shifts, the doors, the jars and the money for a Scouts Apple Day.
        </p>

        {discarded && (
          /*
            Said plainly, because the alternative is a flicker that reads as a broken
            sign-in: an account with no invitation is created by signing in and deleted a
            second later, so what somebody sees is a press, a flash, and this page again.
          */
          <div className="note warning" style={{ textAlign: 'left' }}>
            <p style={{ margin: 0 }}>
              <strong>Your account doesn&apos;t have access.</strong>
            </p>
            <p className="small" style={{ margin: '0.35rem 0 0' }}>
              To get in you need an invitation link from somebody who already has access.
            </p>
          </div>
        )}

        <button className="primary landing-in" onClick={() => void signInWithGoogle()}>
          Sign in with Google
        </button>
        <p className="small muted landing-who">
          For organizers and leaders. You need an invitation the first time.
        </p>

        {/*
          The other half of who arrives here, and the half that should leave again.

          Most people opening this are volunteers who followed a link to the wrong place, or
          typed the address they saw on a poster. Telling them there is nothing here for them
          to sign in to saves the phone call.
        */}
        <div className="landing-volunteers">
          <strong className="small">Volunteering on the day?</strong>
          <p className="small muted" style={{ margin: '0.2rem 0 0' }}>
            You do not need an account. Open the link or scan the QR code you were sent — it
            has your shifts, where to go, and who to ring if something goes wrong.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Send a bare `/screen` to `/e/<event>/screen`.
 *
 * Keeps older links and typed URLs working, and means every address that ends up in
 * someone's history or a message names its event.
 */
function ScopeRedirect({ screen }: { screen: string }): ReactNode {
  const { pathFor, loading, events } = useEvent()
  const here = useLocation()

  if (loading) return <Loading what="Opening" />
  if (events.length === 0) return <Navigate to="/" replace />

  const target = pathFor(screen)
  /*
    Never redirect somewhere to itself.

    This route exists to send a bare `/schedule-board` on to `/e/2026/schedule-board`. When
    the target came back as the bare path again — which it did whenever no event was
    remembered — it navigated to itself and kept doing so until the browser gave up, with a
    blank page throughout.

    `pathFor` is fixed, so this should never fire. It stays because the failure it prevents
    is one nobody can diagnose from the screen: there is nothing on it.
  */
  if (target === here.pathname) return <Landing screen={screen} />

  return <Navigate to={target} replace />
}

/**
 * A screen that already holds the schedule, with the re-publish flag's bookkeeping beside it.
 *
 * The flag lives in the bar, on every screen, so working out whether the board has moved
 * since it was published has to be cheap. Hashing it on the spot would mean subscribing to
 * every location, person and assignment — a few hundred documents read to decide whether to
 * draw one small link. The hash is recorded here instead, by the screens that hold that data
 * anyway, and everywhere else compares two strings on one document.
 *
 * Wrapped at the route rather than called inside each screen, so a screen's own tests do
 * not have to know this exists in order to render it.
 */
function Watched({ children }: { children: ReactNode }): ReactNode {
  return (
    <>
      <PublishWatch />
      {children}
    </>
  )
}

function RequireRole({
  allow,
  children,
}: {
  allow: Role[]
  children: ReactNode
}): ReactNode {
  const { role, loading } = useSession()
  if (loading) return <Loading what="Checking your access" />
  if (!allow.includes(role)) {
    // Signed in, just not to this. Saying so beats a sign-in prompt to somebody who is
    // already signed in, which reads as if their account has stopped working.
    return runsTheEvent(role) ? <NotYours /> : <SignInPrompt />
  }
  return children
}

/** For somebody on the roster who has followed a link to a screen above their tier. */
function NotYours(): ReactNode {
  return (
    <div className="card">
      <h1>Not your screen</h1>
      <p className="muted">
        This one changes how the event itself is set up — the location library, the sections,
        the events. Those are shared across every year, so they are kept to the organizers
        who look after them. Ask one of them if something here needs changing.
      </p>
    </div>
  )
}

export function App(): ReactNode {
  const { role, loading } = useSession()

  return (
    <Routes>
      {/*
        Reachable without an account: a volunteer's own pass, by a token nobody can guess,
        carrying only their own shifts. There is no public schedule of any kind, redacted or
        otherwise.
      */}
      <Route path="/p/:token" element={<PassPage />} />
      {/*
        Accepting an invitation. Open to anybody, like a pass: the code in the link is the
        permission, and the page reads it before asking anyone to sign in.
      */}
      <Route path="/join/:code" element={<JoinPage />} />

      <Route
        path="/"
        element={
          <Shell>
            {loading ? (
              <Loading what="Starting up" />
            ) : runsTheEvent(role) ? (
              <Landing screen="schedule-board" />
            ) : (
              <SignInPrompt />
            )}
          </Shell>
        }
      />

      {(
        [
          // Running the event, and the records of it: anybody on the roster.
          ['schedule-board', <Watched key="s"><ScheduleScreen /></Watched>, RUNS],
          ['people', <Watched key="pe"><PeopleScreen /></Watched>, RUNS],
          ['money', <Watched key="m"><MoneyScreen /></Watched>, RUNS],
          ['history', <HistoryScreen key="h" />, RUNS],
          ['reconcile', <ReconcileScreen key="r" />, RUNS],
          ['audit', <AuditScreen key="ac" />, ADMIN],
          // A person, not a screen full of people. The id is in the path so the page can be
          // linked to from anywhere that names somebody.
          ['person/:personId', <Watched key="pn"><PersonScreen /></Watched>, RUNS],
          // Reached by name from every table that lists one, like a person's page.
          ['location/:locationId', <Watched key="loc"><LocationScreen /></Watched>, RUNS],
          // Reached by the bell rather than the nav: it is a place to go when something is
          // waiting, not one of the screens the event is run from.
          ['notifications', <NotificationsScreen key="n" />, RUNS],
          ['reminders', <RemindersScreen key="rm" />, RUNS],

          // Setup that spans every year. A wrong edit here is a wrong edit to all of them.
          // Readable by anybody on the roster; the screens themselves offer an organizer
          // nothing to press.
          ['events', <EventsScreen key="y" />, RUNS],
          ['locations', <LocationsScreen key="l" />, RUNS],

          ['library', <LibraryScreen key="lib" />, RUNS],
          ['sections', <SectionsScreen key="sec" />, ADMIN],
          ['import', <ImportScreen key="i" />, RUNS],
          ['access', <AccessScreen key="acc" />, ADMIN],

          // The day itself.
          ['jars', <JarsScreen key="j" />, RUNS],
          ['day-of', <Watched key="d"><DayOfScreen /></Watched>, RUNS],
        ] as [string, ReactNode, Role[]][]
      ).flatMap(([screen, element, allow]) => {
        const wrapped = (
          <Shell>
            <RequireRole allow={allow}>
              <Suspense fallback={<Loading />}>{element}</Suspense>
            </RequireRole>
          </Shell>
        )
        return [
          // The shareable form: the event is part of the address.
          <Route key={screen} path={`/e/:eventId/${screen}`} element={wrapped} />,
          // A bare path still works. The events screen renders directly, since it is how
          // the first event gets created and redirecting it would loop; everything else
          // resolves to whichever event is current.
          <Route
            key={`${screen}-bare`}
            path={`/${screen}`}
            element={screen === 'events' ? wrapped : <ScopeRedirect screen={screen} />}
          />,
        ]
      })}

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
