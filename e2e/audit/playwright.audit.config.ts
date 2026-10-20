import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/*
 * The screen audit's own Playwright config, with one project, `audit` (docs/audit/SCREEN_AUDIT.md). It is kept out of
 * playwright.config.ts on purpose: it is not an E2E suite, never runs in the CI shards, and only runs from the manual
 * .github/workflows/screen-audit.yml (or by hand). Same server as the database suites: the production build (made with the local
 * stack's URL and anon key) served by `vite preview` on 4173.
 *
 *   eval "$(npx supabase status -o env | sed 's/^/export /')"
 *   VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run build
 *   npx playwright test -c e2e/audit/playwright.audit.config.ts
 *   node scripts/audit/report.mjs
 */
const root = fileURLToPath(new URL('../..', import.meta.url))
const PORT = 4173

export default defineConfig({
  testDir: '.',
  testMatch: /screens\.audit\.ts$/,
  outputDir: join(root, 'test-results', 'audit'),
  // One database, one browser: the captures run in order.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 10 * 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: join(root, 'playwright-report', 'audit') }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
    serviceWorkers: 'block',
    locale: 'en-GB',
    timezoneId: 'Asia/Karachi',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'audit', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    cwd: root,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
