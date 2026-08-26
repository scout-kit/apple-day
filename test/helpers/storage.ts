/**
 * A working `localStorage`, whatever the environment provides.
 *
 * jsdom's is not dependable across machines. On an opaque origin reading it throws
 * `SecurityError`; elsewhere it can exist but refuse writes; and which you get depends on
 * versions and defaults that are not pinned by anything in this repository. The same suite
 * passed here and failed there, twice, for reasons no amount of reading the code revealed.
 *
 * So the tests that care about storage bring their own. It is a real store with real
 * behaviour — set a value, read it back, clear it — not a stub returning null, which would
 * let "nothing was remembered" pass for the wrong reason.
 *
 * Installed on `window` before anything reads it, so the code under test sees an ordinary
 * browser store and needs no knowledge of any of this.
 */
export function useMemoryStorage(): Storage {
  const held = new Map<string, string>()

  const store: Storage = {
    get length() {
      return held.size
    },
    key: (index: number) => [...held.keys()][index] ?? null,
    getItem: (key: string) => held.get(String(key)) ?? null,
    setItem: (key: string, value: unknown) => void held.set(String(key), String(value)),
    removeItem: (key: string) => void held.delete(String(key)),
    clear: () => held.clear(),
  } as Storage

  Object.defineProperty(window, 'localStorage', {
    value: store,
    configurable: true,
    writable: true,
  })

  return store
}
