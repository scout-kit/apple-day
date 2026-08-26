# Apple Day

Scheduling, day-of operations and fundraising totals for a Scouts Apple Day — the shifts,
the jars, the money, and the personal link every volunteer gets.

Runs entirely on the Firebase **Spark** (free) plan: Firestore, Auth and Hosting, with no
Cloud Functions and no Cloud Storage. Everything is client-side, and `firestore.rules` is
the whole authorization layer.

The project pages in [`docs/`](docs/index.html) walk through the screens with mock views —
publish them by pointing GitHub Pages at the `docs/` folder on the default branch.

## Getting started

Node 20+ and a JDK 11+ — the Firestore emulator needs Java. `make doctor` checks both.

```bash
make up        # installs, starts the emulator, seeds it, serves the app
```

Click **Organizer sign in**, then grant yourself access:

```bash
make admin                          # every signed-in account
make admin EMAIL=you@example.com    # or one of them
```

Signing in is not enough on its own, and the grant cannot be done ahead of time: your
account id does not exist until you have signed in once. The app picks it up live — no
reload, no signing in again. Without it you get a screen saying so.

`make down` stops everything. The grant is part of the emulator snapshot, so it survives a
restart and you only do it once.

To see what a brand-new deployment looks like, `make firstrun` starts a second, empty
emulator on its own ports and serves the app against it at `localhost:5174`. Your own data
is untouched. `make firstrun-down` stops it.

`make help` lists everything. The ones worth knowing:

| Target | Does |
|---|---|
| `make up` / `make down` | start or stop the emulator and dev server together |
| `make check` | typecheck, both test suites, and the production build |
| `make test` | domain and render tests (fast, no emulator) |
| `make test-rules` | security rules against the emulator |
| `make admin` / `make organizer` | grant access to a signed-in account |
| `make firstrun` | an empty sandbox, to see the first-run experience |
| `make deploy GROUP=<alias>` | every check, then deploy hosting and rules |

No Firebase project or billing account is needed for local work. The emulator snapshots to
`./seed` on shutdown and reloads on the next start, so seeding is a one-off.

The hosting emulator sits on port **5050** rather than Firebase's default 5000, because
macOS ControlCenter holds 5000. Development does not use it — Vite serves the app.

## Screens

Organizer screens are addressed as `/e/<event>/<screen>`, so a copied link opens the event
it came from rather than whichever one the recipient's browser last used. A bare
`/<screen>` resolves to the current event.

**Running** — `schedule-board`, `people`, `day-of`, `jars`, `reminders`
**Records** — `money`, `history`, `reconcile`
**Setup** — `events`, `locations`, `library`, `import`
**Admin** — `access`, `sections`, `audit`

Admin covers who gets in, what every year is shaped by, and the record of what everybody
did. Everything else is open to organizers.

The one public route is `/p/:token`, a volunteer's own shifts. It is in the entry bundle;
every organizer screen is lazy-loaded. Opening a pass downloads roughly 190 KB gzipped and
reads exactly one Firestore document — about 1,900 page loads inside Spark's 360 MB daily
transfer.

## Layout

```
src/domain/     pure logic, no Firebase imports —
                types, slots, metrics, validation, importer, publishing
src/lib/        Firestore, auth, mail, QR, CSV — everything facing outward
src/ui/         screens and components
firestore.rules the entire authorization layer
test/           unit and render tests; test/rules/ needs the emulator
scripts/        emulator seeding
```

`src/domain` has no Firebase dependency, so the calculations run in milliseconds and the
storage layer can be reasoned about separately. `domain/publishing.ts` lives there
specifically because it decides what a volunteer is handed — the pass is the only document
reachable without an account, so a bug in it is a privacy incident rather than a display
glitch.

## Tests

```bash
make check             # everything: typecheck, both suites, production build
make test              # domain and render tests, no emulator
make test-rules        # security rules against the Firestore emulator
```

`make test` includes a regression suite built from a real year's results
(`test/fixtures/appleDay2025.ts`). It holds the dollar figures and drops the names. The
suite asserts the app reproduces the spreadsheet's totals where the spreadsheet was right,
and deliberately diverges where it was wrong:

| Workbook said | Correct | Why |
|---|---|---|
| One shop ranked twice, $177.88/hr and $165.46/hr | One row, $1,526.41 | The two day sheets spelled the name differently; the totals grouped by string |
| $86.55/hr, rank 4 of 12 | Unrankable, listed as an anomaly | `IF(F17>0, E17/F17, E17)` fell back to the raw total when hours were 0 |
| Friday: 3 hours | 4 person-hours | `COUNTA` counted filled cells; one cell held two siblings |
| Saturday: 25 person-hours | 56 | The hours sheet scanned five of eight slots |
| Reconciliation "balanced" | Friday short $86.55 | A card total and bushel sales were summed into one column |

Grouping by id rather than by display string is what removes most of that class of defect.

## Jars

A jar is a physical tin with a number on it, reused every day and every year.

1. **Issued** on the Day of screen as somebody heads out — typed or scanned. That same act
   sets their shift to *out collecting*, because handing the jar over is the moment they
   go out. Someone can take several.
2. **Counted** on the Jars screen when they come back. It never asks where the jar went or
   who had it; both came from the issue.

`amount` is `null` while a jar is out, not `0`. A jar on the street is not a jar that came
back empty, and conflating them drags a location's revenue per hour down mid-event.
Outstanding jars are surfaced on the Money and Totals screens instead.

A jar still out can be **taken back** — wrong number, wrong person, never actually left.
The record is deleted, since an uncounted jar holds nothing, and the shift reverts only if
it was their last.

One jar covers a stretch of consecutive shifts at one location, and its takings are
credited to all of them. Crediting only the shift it left on would give the whole evening
to the first hour.

There are no hand-entered cash or card totals: every jar is counted once, so the split is
derived. Only bushel sales and the bank deposit stay manual, because no jar can know them.

## Events, locations and hours

Three things that are one thing in a spreadsheet:

- **An event** is a named thing — "Apple Day, October 4–5 2026", "Spring bottle drive" —
  not a year. Its id is a slug of the name, fixed at creation, so renaming never breaks a
  link. It owns its signups, schedule, jars, money and passes, and chooses which days it
  runs and the hours staffed on each. Those become the board's columns. Friday evening and
  Saturday are only the defaults.
- **The library** holds facts about real places, shared by every year: address, map link,
  site contact, and the shop's actual opening hours for any day of the week. A shop open
  until 22:00 is recorded that way even if you only staff until 20:00 — that is what lets
  the board warn you about sending a youth to a locked door.
- **A year's locations** is which library places that year uses, each with an on/off switch
  and a priority, both per-year. Setting up a new year copies the previous list and
  switches off what closed.

## Reminders

Reminders go out from an organizer's own Gmail, over OAuth in the browser, because Spark
has no Cloud Functions to send from. Mail arrives from somebody the parents recognise and
replies reach a human. Exporting a file is always available as a fallback and counts as a
send in the ledger, since the mailing tool does the telling.

A parent with more than one child gets one message covering all of them. The wording is
editable and shared across events; templates live in `domain/reminderText.ts`.

Shift **times** are in reminders. Shift **locations** are not — see Access.

## Access

Two kinds, no server.

- **The roster** — Google sign-in, gated on an `admins/{uid}` document that is not
  client-writable. Admins change what is shared between years; organizers run the event.
  Anybody who works a screen, base ops included, holds one of these.
- **Volunteers** — open their personal pass link. No account and no session.

A pass is a capability document at `passes/{token}`, where the token is a 22-character
random id. `get` by exact id is open; `list` is closed. Knowing the link is the credential,
and it reaches exactly that one document. Passes are scoped to one person's own shifts and
are rotated every event.

Nobody is told where they are going until they report to base. A pass names its location
only after an organizer has checked that person in, so a forwarded link never says where a
named child will be standing.

### The first account, in a new project

A fresh deployment has an empty Firestore and nobody on the roster, so the first person to
sign in is refused. There is no way in the app can offer, and offering one would be a hole.
It is granted once, by hand:

1. Sign in to the deployed app with the account that should be the first admin. You will be
   told you have no access; copy the **account id** it shows.
2. In the Firebase console, under **Firestore Database**, create a collection `admins` with
   a document whose id is that account id:

   | field | type | value |
   |---|---|---|
   | `email` | string | the address |
   | `addedAt` | number | `0` |

   Leave `level` out. An entry without one is a full admin.
3. The app notices on its own — the refused screen becomes the app, without signing in
   again.

Everybody after that is invited from the **Access** screen by address, which is the only
route the app offers. Locally, `make admin` and `make organizer EMAIL=…` do the same job
against the emulator.

## Deploying

Each group gets its own Firebase project, so their data is separate at the only boundary
that is actually enforced. Vite inlines the config at build time, so one build belongs to
one project — reusing a build across projects points one group's site at another group's
data, and it looks entirely normal while it does so.

That is why the build and the deploy take the same name, from one command:

```bash
make deploy GROUP=waterloo
```

`GROUP` is an alias in `.firebaserc`, and each alias needs a matching `.env.<alias>`.
Neither file is committed — they describe one installation rather than the app. Copy
`.firebaserc.example` and `.env.example` and fill them in. `make deploy-all` walks every
alias in turn.

Firestore should be created in `northamerica-northeast2` (Toronto). **The region is
permanent once set.**

## Data handling

Nothing in this repository is anybody's data. There is no sample roster and no shop list:
`data/locations.seed.json` and `data/local/people.json` are yours to write if you want the
emulator pre-filled, and both are gitignored. `make firstrun` starts an empty one instead.

A real roster is minors' names and parent contact details, so `.gitignore` also excludes
spreadsheets and any `*.responses.csv`. Nothing derived from one belongs here.

The audit log records names, section and pairing — never parent contact details. It is
read by admins and kept for years, and no question anybody asks of it needs a phone number.

Audit entries are create-only by rule, so removing an event is never quite total: "who
removed 2025" is exactly what a log is for.

## Known constraints

- No server-side sending. Reminders go through an organizer's own mailbox over OAuth, or
  out as a file. Automating them from a server needs the Blaze plan.
- No Cloud Storage. CSV, PDF and QR generation all happen in the browser.
- Hosting transfer on Spark is 360 MB/day, which is the quota worth watching. Keep the
  bundle small and avoid large images and font files.
- App Check is not enabled.
