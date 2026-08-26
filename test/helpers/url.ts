/**
 * Clear the address bar between tests.
 *
 * View state — which day, which shift, what was typed — lives in the URL now, so it is
 * shared mutable state exactly like a module-level fixture: one test leaving `?day=sat`
 * behind puts the next one on Saturday for no reason it can see.
 */
export function resetUrl(): void {
  window.history.replaceState(null, '', '/')
}
