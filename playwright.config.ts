import { defineConfig, devices } from '@playwright/test'

/*
 * One config, separate projects per suite. A suite brings its own server, chosen by E2E_SUITE
 * (default 'gallery'), because `--project` does not stop Playwright starting every webServer.
 *
 *  - gallery (U09): 'w1440' and 'w375' run the visual-regression and axe suites over /dev/gallery.
 *    The gallery is dev-only, so the server is a development-mode build served by `vite preview`
 *    (no DB, no HMR socket). Baselines are Linux-only, produced by CI on ubuntu-24.04, with no
 *    platform suffix. See docs/design/VISUAL_TESTS.md. Run: npx playwright test --project=w1440 --project=w375
 *
 *  - auth (A03): signs in as the seeded fixture users against the local CI Supabase stack, using the
 *    production build made with the stack's URL and anon key (.github/workflows/e2e.yml):
 *      eval "$(npx supabase status -o env | sed 's/^/export /')"
 *      VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run build
 *      E2E_SUITE=auth npx playwright test --project=auth
 *    The tests read API_URL and SERVICE_ROLE_KEY from the environment (local keys only).
 *
 *  - rfq-board (R06): the RFQ board over a fixture set of RFQs, with axe at 1440 and 375 and the review screenshots.
 *    Same server, build and stack as 'companies' (.github/workflows/e2e-rfq-board.yml):
 *      E2E_SUITE=rfq-board REVIEW_DIR=review-shots npx playwright test --project=rfq-board
 *
 *  - companies (R02): the Companies screens, signed in through the login form as the fixture users, with its data
 *    set up through the REST API as those users. Same server and build as 'auth' (.github/workflows/e2e-companies.yml):
 *      E2E_SUITE=companies REVIEW_DIR=review-shots npx playwright test --project=companies
 *    The tests read API_URL and ANON_KEY from the environment (local keys only). REVIEW_DIR, when set, collects the
 *    review screenshots.
 *
 *  - rfq-intake (R05): the intake = float screen on the same stack and build. Asserts the FE-2 interaction counts, the
 *    Undo, the double-tap guard and axe (WCAG 2.2 AA) at 1440 and 375 (.github/workflows/e2e-rfq-intake.yml):
 *      E2E_SUITE=rfq-intake REVIEW_DIR=review-shots npx playwright test --project=rfq-intake
 *
 *  - rfq-detail (R07): the RFQ detail page on the same stack and build. Reply capture, can't quote, the lowest mark, chase, close,
 *    the FE-2 counts, and axe (WCAG 2.2 AA) at 1440 and 375 (.github/workflows/e2e-rfq-detail.yml):
 *      E2E_SUITE=rfq-detail REVIEW_DIR=review-shots npx playwright test --project=rfq-detail
 *
 *  - rfq-memory (R17, R18): supplier memory in intake (one-liner, Memory card), the last-price chip on RFQ reply rows and the company
 *    page's What we know panels, with fixtures (k) to (n), the 200 ms card budget and axe at 1440 and 375 (.github/workflows/e2e-rfq-memory.yml):
 *      E2E_SUITE=rfq-memory REVIEW_DIR=review-shots npx playwright test --project=rfq-memory
 */
const dbSuites = ['auth', 'companies', 'rfq-board', 'rfq-intake', 'rfq-detail', 'rfq-memory']
const suite = dbSuites.includes(process.env.E2E_SUITE ?? '') ? (process.env.E2E_SUITE as 'auth' | 'companies' | 'rfq-board' | 'rfq-intake' | 'rfq-detail' | 'rfq-memory') : 'gallery'
const GALLERY_PORT = 5199
const AUTH_PORT = 4173

const galleryUse = {
  baseURL: `http://localhost:${GALLERY_PORT}`,
  browserName: 'chromium' as const,
  locale: 'en-GB',
  timezoneId: 'Asia/Karachi',
  colorScheme: 'light' as const,
  reducedMotion: 'reduce' as const,
  deviceScaleFactor: 1,
}

export default defineConfig({
  testDir: './e2e',
  // No platform suffix: there is exactly one set of gallery baselines, the one CI produces.
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  outputDir: 'test-results',
  forbidOnly: Boolean(process.env.CI),
  // The database suites share one database: one worker, in order. The gallery suite is stateless.
  workers: suite !== 'gallery' ? 1 : process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 },
  },
  use: { trace: 'retain-on-failure' },
  projects: [
    {
      name: 'auth',
      testMatch: /auth\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'companies',
      testMatch: /companies\/.*\.spec\.ts/,
      // 1440 is the design width (FE-1); the review screenshots are taken at it.
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        // 1440 is the design width (FE-1); the review screenshots are taken at it.
        viewport: { width: 1440, height: 900 },
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'rfq-board',
      testMatch: /rfqs\/board\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'rfq-intake',
      testMatch: /rfqs\/intake\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        viewport: { width: 1440, height: 900 },
        // The enquiry text is copied to the clipboard and read back to prove it.
        permissions: ['clipboard-read', 'clipboard-write'],
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'rfq-detail',
      testMatch: /rfqs\/detail\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        viewport: { width: 1440, height: 900 },
        // The chase text is copied to the clipboard and read back to prove it.
        permissions: ['clipboard-read', 'clipboard-write'],
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'rfq-memory',
      testMatch: /rfqs\/memory\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    { name: 'w1440', testMatch: /gallery\..*\.spec\.ts/, fullyParallel: true, use: { ...galleryUse, viewport: { width: 1440, height: 900 } } },
    { name: 'w375', testMatch: /gallery\..*\.spec\.ts/, fullyParallel: true, use: { ...galleryUse, viewport: { width: 375, height: 812 } } },
  ],
  webServer:
    suite !== 'gallery'
      ? {
          command: `npx vite preview --host 127.0.0.1 --port ${AUTH_PORT} --strictPort`,
          url: `http://127.0.0.1:${AUTH_PORT}/login`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        }
      : {
          command: `npm run build:e2e && npx vite preview --outDir dist-e2e --port ${GALLERY_PORT} --strictPort`,
          url: `http://localhost:${GALLERY_PORT}/`,
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
          env: { NODE_ENV: 'development' },
        },
})
