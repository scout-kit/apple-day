import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  build: {
    // The firebase vendor chunk is ~550 kB raw / ~133 kB gzipped and cannot be trimmed
    // much further — it is the SDK. Raising the threshold keeps the build output clean so
    // a real regression is noticeable.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // Firebase is the bulk of the bytes and changes rarely — its own chunk means it
        // stays cached across deploys instead of being re-downloaded with every edit.
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // Rules tests need the emulator and are run separately via `npm run test:rules`.
    exclude: ['test/rules/**', 'node_modules/**'],
    /*
      Give jsdom a real origin.

      Without one it serves `about:blank`, whose origin is opaque — and `localStorage` on an
      opaque origin throws `SecurityError` rather than returning null. Any file that touches
      it then dies whole, in setup, before a single assertion runs.

      Whether that happens is left to whatever default the resolved toolchain has, so the
      suite passed on one machine and lost two files and twenty-three tests on another.
      Pinning it here makes the answer the same everywhere.
    */
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
  },
})
