/**
 * Whether a Firestore error means the client is finished rather than merely unlucky.
 *
 * An internal assertion failure poisons the SDK's work queue, and a corrupt IndexedDB store
 * will not open. Both last until the page is reloaded, so retrying either just fills the
 * console with one error per subscription per attempt. A denied read is a different matter
 * and is worth retrying — the credential may still be on its way.
 */
export function isFatalClientFailure(error: unknown): boolean {
  const message = String((error as { message?: unknown })?.message ?? error ?? '')
  return (
    /INTERNAL ASSERTION FAILED/.test(message) ||
    (/IndexedDB/i.test(message) &&
      /corrupt|refusing to open|Version change|upgradeneeded|transaction .* failed/i.test(
        message,
      ))
  )
}
