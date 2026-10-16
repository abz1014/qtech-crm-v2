import { defineConfig } from 'vitest/config'

// The import tests need no browser: plain Node. `npm run test:import` runs the unit tests; the load test
// (import/test/load.int.test.ts) only runs when IMPORT_LOAD_TEST=1 and a local Supabase stack is up (db.yml).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['import/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
