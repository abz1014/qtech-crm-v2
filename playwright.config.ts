import { defineConfig, devices } from '@playwright/test'

/*
 * One config, one project per suite. 'auth' (A03) signs in as the seeded fixture users against the
 * local CI stack; 'companies' (R02) drives the Companies screens signed in the same way, with data set up
 * through the REST API as the fixture users. Other suites (visual, journeys) add their own project here.
 *
 * Both projects need the local Supabase stack running and the app built with its URL and anon key:
 *   eval "$(npx supabase status -o env | sed 's/^/export /')"
 *   VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run build
 *   npx playwright test --project=auth     (or --project=companies)
 * The tests read API_URL, ANON_KEY and SERVICE_ROLE_KEY from the environment (local keys only).
 */
const PORT = 4173

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
      name: 'auth',
      testMatch: /auth\/.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'companies',
      testMatch: /companies\/.*\.spec\.ts/,
      // 1440 is the design width (FE-1); the review screenshots are taken at it.
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: `npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
