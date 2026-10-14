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
 */
const suite = process.env.E2E_SUITE === 'auth' ? 'auth' : 'gallery'
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
  // The auth suite shares one database: one worker, in order. The gallery suite is stateless.
  workers: suite === 'auth' ? 1 : process.env.CI ? 2 : undefined,
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
    { name: 'w1440', testMatch: /gallery\..*\.spec\.ts/, fullyParallel: true, use: { ...galleryUse, viewport: { width: 1440, height: 900 } } },
    { name: 'w375', testMatch: /gallery\..*\.spec\.ts/, fullyParallel: true, use: { ...galleryUse, viewport: { width: 375, height: 812 } } },
  ],
  webServer:
    suite === 'auth'
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
