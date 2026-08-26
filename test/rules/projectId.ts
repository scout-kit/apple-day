/**
 * The project the rules tests run against — deliberately *not* the one `make up` uses.
 *
 * Every rules test calls `clearFirestore()` between cases, and that clears a whole
 * project. Sharing the dev project id meant pointing the suite at a running dev emulator
 * wiped the local database: locations, signups, a day's worth of hand-entered work. The
 * emulator keeps projects separate, so a distinct id makes that impossible rather than
 * merely discouraged.
 *
 * `singleProjectMode` is off in firebase.json for the same reason.
 */
export const RULES_PROJECT_ID = 'apple-day-rules-tests'
