import { defineConfig } from 'vitest/config'

/**
 * Security-rules tests run against the Firestore emulator, so they get their own config:
 * they are slower than the pure-domain suite and must not run in the default `npm test`.
 * Launched via `npm run test:rules`, which starts the emulator around them.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/rules/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    // The emulator is a single shared Firestore instance; parallel files would collide.
    fileParallelism: false,
  },
})
