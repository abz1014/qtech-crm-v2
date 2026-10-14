import { defineConfig, devices } from '@playwright/test'

/*
 * One config, one project per suite. Other suites (auth A03, visual U09, journeys) add their own project
 * and, if they need another server, their own entry in `webServer` (it accepts a list).
 *
 * 'companies' (R02) runs against the local CI stack only (supabase start + db reset, seed fixtures):
 *   eval "$(npx supabase status -o env | sed 's/^/export /')"
 *   npx playwright test --project=companies
 * It needs API_URL and ANON_KEY in the environment, and serves the app with `vite` (a dev build) so the
 * shell takes the ?devRole= session; the data calls carry a real session for the seeded fixture user, so
 * Row Level Security is exercised for real. Once real sign-in is on main, `signInAs` in
 * e2e/support/stack.ts becomes a pass through the login form and the dev server can be a preview build.
 */
const PORT = 5174

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'companies',
      testMatch: /companies\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_SUPABASE_URL: process.env.API_URL ?? 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: process.env.ANON_KEY ?? '',
    },
  },
})
