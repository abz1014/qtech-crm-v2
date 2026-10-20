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
 *  CI (.github/workflows/e2e.yml) boots ONE stack and runs the database suites one after another, each as its own
 *  invocation with a database reset between them (E2E_SUITE=db, or the suite's own name). To run several locally in one go:
 *      E2E_SUITE=db npx playwright test --project=auth --project=companies
 *
 *  - auth (A03): signs in as the seeded fixture users against the local CI Supabase stack, using the
 *    production build made with the stack's URL and anon key (.github/workflows/e2e.yml):
 *      eval "$(npx supabase status -o env | sed 's/^/export /')"
 *      VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run build
 *      E2E_SUITE=auth npx playwright test --project=auth
 *    The tests read API_URL and SERVICE_ROLE_KEY from the environment (local keys only).
 *
 *  - rfq-board (R06): the RFQ board over a fixture set of RFQs, with axe at 1440 and 375 and the review screenshots.
 *    Same server, build and stack as 'companies' (.github/workflows/e2e.yml):
 *      E2E_SUITE=rfq-board REVIEW_DIR=review-shots npx playwright test --project=rfq-board
 *
 *  - companies (R02): the Companies screens, signed in through the login form as the fixture users, with its data
 *    set up through the REST API as those users. Same server and build as 'auth' (.github/workflows/e2e.yml):
 *      E2E_SUITE=companies REVIEW_DIR=review-shots npx playwright test --project=companies
 *    The tests read API_URL and ANON_KEY from the environment (local keys only). REVIEW_DIR, when set, collects the
 *    review screenshots.
 *
 *  - rfq-intake (R05): the intake = float screen on the same stack and build. Asserts the FE-2 interaction counts, the
 *    Undo, the double-tap guard and axe (WCAG 2.2 AA) at 1440 and 375 (.github/workflows/e2e.yml):
 *      E2E_SUITE=rfq-intake REVIEW_DIR=review-shots npx playwright test --project=rfq-intake
 *
 *  - rfq-detail (R07, R09, R10): the RFQ detail page on the same stack and build; clarifications.spec.ts adds the questions panel and the files.
 *    Reply capture, can't quote, the lowest mark, chase, close, the FE-2 counts, and axe (WCAG 2.2 AA) at 1440 and 375 (.github/workflows/e2e.yml):
 *      E2E_SUITE=rfq-detail REVIEW_DIR=review-shots npx playwright test --project=rfq-detail
 *
 *  - rfq-quotation (R19): the Issue quotation dialog on the RFQ page, issue and re-issue (same number, new revision), the PDF stored in
 *    generated-docs, the company-profile block, the expired state, and axe (WCAG 2.2 AA) at 1440 and 375 (.github/workflows/e2e.yml):
 *      E2E_SUITE=rfq-quotation REVIEW_DIR=review-shots npx playwright test --project=rfq-quotation
 *
 *  - rfq-memory (R17, R18): supplier memory in intake (one-liner, Memory card), the last-price chip on RFQ reply rows and the company
 *    page's What we know panels, with fixtures (k) to (n), the 200 ms card budget and axe at 1440 and 375 (.github/workflows/e2e.yml):
 *      E2E_SUITE=rfq-memory REVIEW_DIR=review-shots npx playwright test --project=rfq-memory

 *  - rfq-ranking (R25, R26): the ranked comparison on the RFQ page (rank order, the 2% band, reliability, order history, the spread for sales and
 *    none for an engineer, no Received step), the float suggestions ordered by track record with the evidence line, and the memory card's
 *    evidence block, with the tap counts and axe at 1440 and 375 (.github/workflows/e2e.yml):
 *      E2E_SUITE=rfq-ranking REVIEW_DIR=review-shots npx playwright test --project=rfq-ranking
 *
 *  - today (R11, R16): the Today screen for all three roles on the same stack and build. The 1-tap chase (copy and mark chased), its
 *    10 s Undo, the Waiting group, role-aware items, and axe (WCAG 2.2 AA) at 1440 and 375 (.github/workflows/e2e.yml):
 *      E2E_SUITE=today REVIEW_DIR=review-shots npx playwright test --project=today
 *
 *  - capture (R22): the Capture sheet on the production build WITH the service worker (the share-target POST, paste, drop, the
 *    Capture button and the C key), the destinations, the tap counts and axe at 1440 and 375, on the same stack and build:
 *      E2E_SUITE=capture REVIEW_DIR=review-shots npx playwright test --project=capture
 *  - expenses (M03, M11): Money > Expenses for the admin: the one Add expense dialog (pre-fills from a leg and an order), the burst sheet
 *    (keyboard only, one atomic insert, receipt photo), input tax, recurring in one tap, the closed-month refusal (a month is closed
 *    first and reopened after), no access for sales and engineer, FE-2 tap counts, and axe at 1440 and 375:
 *      E2E_SUITE=expenses REVIEW_DIR=review-shots npx playwright test --project=expenses
 *
 *  - bank (M12): Money > Month-end > Bank tick for the admin: one tap ticks a payment, an expense or a whole PSID group (one request each), undo
 *    is the same tap, cash items never listed, older unticked items, the totals, ticking in a closed month, a refused write shown and put back,
 *    no access (and no request) for sales and engineer, and axe at 1440 and 375:
 *      E2E_SUITE=bank REVIEW_DIR=review-shots npx playwright test --project=bank
 *
 *  - month-end (M10, M05): Money > Month-end for the admin: the checklist and its links, the six reports (one tap each, one tap to CSV), close and reopen
 *    (two taps each) with the closed-month sentence, no access (and no request) for sales and engineer, axe at 1440 and 375:
 *      E2E_SUITE=month-end REVIEW_DIR=review-shots npx playwright test --project=month-end
 *  - money-costs (M04, M07): the Margin panel on the order page (supplier-price estimate that never overwrites, Provisional until costs are
 *    marked complete), Money > Margins, Money > Exceptions, and that sales and engineers get no money data (network log and Row Level
 *    Security), with axe at 1440 and 375:
 *      E2E_SUITE=money-costs REVIEW_DIR=review-shots npx playwright test --project=money-costs
 *
 *  - money-books (M01, M02: invoices, the GST register, month stamping, payments in, receivables, role access and axe at 1440 and 375):
 *      E2E_SUITE=money-books REVIEW_DIR=review-shots npx playwright test --project=money-books
 *
 *  - pwa (R21): the production build's manifest (valid, icons real), the service worker registering, its app-shell-only
 *    precache (nothing from Supabase), the offline shell and Chrome's own installability check. No database needed:
 *      E2E_SUITE=pwa npx playwright test --project=pwa
 *
 *  - perf (P04): Lighthouse accessibility (>= 95) on the seven main screens, no Content-Security-Policy violation and no repeated data
 *    request on Today and the RFQ page. Needs E2E_CSP=1 (the preview server then sends vercel.json's policy) and `npm i --no-save lighthouse@12.8.2`:
 *      E2E_CSP=1 E2E_SUITE=perf npx playwright test --project=perf
 *
 *  - search (R12): the command-palette search over companies, contacts, RFQ numbers and customer refs. One request per burst of
 *    keystrokes, stale requests dropped, engineer sees nothing money-related, and axe (WCAG 2.2 AA) at 1440 and 375:
 *      E2E_SUITE=search REVIEW_DIR=review-shots npx playwright test --project=search
 *
 *  - orders (O01, O03): Mark won creates the order (a double submit makes one), the order page for all three roles, the leg stamps with their
 *    tap counts, the engineer's one-tap commissioning, no price or money request for an engineer, the palette by order number and PO, and axe
 *    (WCAG 2.2 AA) at 1440 and 375:
 *      E2E_SUITE=orders REVIEW_DIR=review-shots npx playwright test --project=orders
 *
 *  - settings-admin (M06, M13): Settings > Targets (admin grid, copy last quarter, the person's own tile on Today, no access for sales and
 *    engineer) and Settings > Expense categories (rename, reorder, activate, group, paid via, in-use delete advice, deactivate hides it from
 *    new expenses), with axe at 1440 and 375:
 *      E2E_SUITE=settings-admin REVIEW_DIR=review-shots npx playwright test --project=settings-admin
 *  - journeys (P03): whole working days for the three roles, one spec each under e2e/journeys/ (sales: enquiry to payment; engineer: Today to
 *    delivered, with a network-log check that no money is ever fetched; admin: burst expenses, bank tick, margins, close and reopen a month),
 *    each asserting the FE-2 interaction counts at every step. Each role signs in once and the saved session is reused. Run on every push that
 *    touches src/** (the regression net), or when e2e/journeys/** changes:
 *      E2E_SUITE=journeys REVIEW_DIR=review-shots npx playwright test --project=journeys
 *
 *  - a11y: the cross-cutting accessibility suite (e2e/a11y): strict axe on the screens and overlays no feature suite covers, the
 *    owner's zoom bands (683x330, 780x600, 1093x560, 320x256), a Tab sweep on every main screen, focus after actions, live regions
 *    and single-key shortcuts. Signed in once as the admin. Its axe runs strict (A11Y_STRICT=1, set by the suite itself), which also
 *    fails on the reliably-real "needs review" results (e2e/support/axe.ts). Known failures are test.fail() with a BUG id:
 *      E2E_SUITE=a11y npx playwright test --project=a11y
 */
// 'db' selects the database-backed server for any combination of --project=<suite> flags. The per-suite values
// ('auth', 'companies', ...) pick the very same server and are kept so the older one-suite commands still work.
const dbSuites = ['db', 'auth', 'companies', 'rfq-board', 'rfq-intake', 'rfq-detail', 'rfq-quotation', 'rfq-memory', 'rfq-ranking', 'today', 'search', 'settings-admin', 'orders', 'expenses', 'capture', 'money-costs', 'money-books', 'bank', 'month-end', 'pwa', 'reports', 'journeys', 'perf', 'a11y']
const suite = dbSuites.includes(process.env.E2E_SUITE ?? '') ? 'db' : 'gallery'
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
  workers: suite === 'db' ? 1 : process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixelRatio: 0.002 },
  },
  // The worker is blocked everywhere except the 'pwa' project, so no other suite runs behind a cache.
  use: { trace: 'retain-on-failure', serviceWorkers: 'block' },
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
      testMatch: /rfqs\/(detail|clarifications)\.spec\.ts/,
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
      name: 'rfq-quotation',
      testMatch: /rfqs\/quotation\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        viewport: { width: 1440, height: 900 },
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'rfq-ranking',
      testMatch: /rfqs\/ranking\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'today',
      testMatch: /today\/.*\.spec\.ts/,
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
    {
      name: 'search',
      testMatch: /search\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'expenses',
      testMatch: /expenses\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'bank',
      testMatch: /bank\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'month-end',
      testMatch: /month-end\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'capture',
      testMatch: /capture\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow', screenshot: 'only-on-failure' },
    },
    {
      name: 'money-costs',
      testMatch: /money\/costs\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'orders',
      testMatch: /orders\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        viewport: { width: 1440, height: 900 },
        // The goods-chase text is copied to the clipboard and read back to prove it.
        permissions: ['clipboard-read', 'clipboard-write'],
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'reports',
      testMatch: /reports\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'settings-admin',
      testMatch: /settings\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
    },
    {
      name: 'money-books',
      testMatch: /money-books\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        viewport: { width: 1440, height: 900 },
        // The PSID is pasted from the clipboard, as a person would.
        permissions: ['clipboard-read', 'clipboard-write'],
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'pwa',
      testMatch: /pwa\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, serviceWorkers: 'allow', screenshot: 'only-on-failure' },
    },
    {
      name: 'perf',
      testMatch: /perf\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: 0,
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${AUTH_PORT}`, viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'journeys',
      testMatch: /journeys\/.*\.spec\.ts/,
      fullyParallel: false,
      // A journey is one long test that signs in once per role; a retry starts a fresh journey with its own unique records.
      retries: process.env.CI ? 1 : 0,
      timeout: 300_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        viewport: { width: 1440, height: 900 },
        // Enquiry, chase and reply texts are copied to the clipboard and read back, and a reply is pasted from it, as a person would.
        permissions: ['clipboard-read', 'clipboard-write'],
        screenshot: 'only-on-failure',
      },
    },
    {
      name: 'a11y',
      testMatch: /a11y\/.*\.spec\.ts/,
      fullyParallel: false,
      retries: process.env.CI ? 1 : 0,
      timeout: 90_000,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://127.0.0.1:${AUTH_PORT}`,
        viewport: { width: 1440, height: 900 },
        // Animations off, as axe and the focus checks need settled styles (the design system honours it).
        reducedMotion: 'reduce',
        // The 1-tap chase copies its message to the clipboard.
        permissions: ['clipboard-read', 'clipboard-write'],
        screenshot: 'only-on-failure',
      },
    },
    { name: 'w1440', testMatch: /gallery\..*\.spec\.ts/, fullyParallel: true, use: { ...galleryUse, viewport: { width: 1440, height: 900 } } },
    { name: 'w375', testMatch: /gallery\..*\.spec\.ts/, fullyParallel: true, use: { ...galleryUse, viewport: { width: 375, height: 812 } } },
  ],
  webServer:
    suite === 'db'
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
