# CI: what runs when

Goal: the project costs $0. The repository is public, so standard GitHub-hosted runners are free and unlimited. CI is still gated by path
so runs stay fast and quick to read: a docs-only push runs nothing.

| Workflow | Runs on | Cost when it runs |
|---|---|---|
| `ci.yml` (lint, tokens, typecheck, unit, import transforms and guard, build) | every push except docs-only (`docs/**`, `*.md`) | about 3 min |
| `ci.yml` gallery job (visual + axe) | main, manual, or when `src/ui`, `src/dev`, `src/index.css`, `tailwind.config.ts`, `e2e/gallery*`, `e2e/__screenshots__`, `playwright.config.ts`, `package*.json` change | about 4 min |
| `db.yml` | every push, only if `supabase/**`, `src/types/database.ts`, `import/**`, `package*.json` or the workflow changed (its last step is the import load test, I01) | about 6 min |
| `functions.yml` | every push; paths `supabase/functions/**`, `supabase/migrations/**` | about 6 min |
| `e2e.yml` (all DB suites, incl. `search`, plus `pwa`) | every push, path-gated; one stack boot, only suites whose paths changed | about 8 to 14 min |
| `ci.yml` build job, bundle budget step (P04) | every push except docs-only | seconds; fails if the initial JS is over 300 KB gzip, and prints the PDF chunk and service-worker precache sizes in the run summary |
| `e2e.yml` suite `perf` (P04) | with the other suites, when `e2e/perf/**` or a shared path changes | about 5 min (Lighthouse, 7 screens, desktop and phone) |
| `remote.yml`, `deploy-functions.yml` | manual only, owner approval | not part of the budget |
| `backup.yml` (R13) | nightly 20:30 UTC, drill weekly, manual; `backup` environment, main only | about 3 min nightly, 15 min drill |
| `smoke.yml` (S16) | nightly 21:17 UTC (02:17 Karachi), manual; `smoke` environment (Part 2 secrets only); read-only against the live project | about 1 min |
| `backup-checks.yml` | push touching `scripts/backup/**` or the backup workflows | about 8 min |

Rules applied everywhere:

- A newer push to the same branch cancels the older run (`concurrency`; `remote.yml` and `deploy-functions.yml` keep their own non-cancelling groups).
- No `pull_request` trigger: a push to a PR branch already runs the checks; a second run on the merge ref doubled the cost.
- Playwright browsers are cached (`~/.cache/ms-playwright`, keyed on the Playwright version). Supabase Docker images are not cached:
  restoring a ~1.5 GB tar costs about as much as pulling, and counts against the 10 GB cache cap.

## e2e.yml

A `changes` job (`dorny/paths-filter@v3.0.2`) decides per suite. Shared paths (`src/**`, `e2e/support/**`, migrations, seed, config,
`playwright.config.ts`, `package*.json`, the workflow) run every suite; `e2e/auth/**`, `e2e/companies/**`, `e2e/rfqs/board.spec.ts`,
`intake.spec.ts`, `detail.spec.ts`, `memory.spec.ts`, `quotation.spec.ts` (suite `rfq-quotation`, which also installs poppler to read and render the stored PDFs) `e2e/today/**`, `e2e/money-books/**` (suite `money-books`: M01, M02), `e2e/money-books/**` (suite `money-books`: M01, M02), `e2e/month-end/**` (suite `month-end`, M10 and M05: the checklist, the six reports and their CSV, close and reopen with the closed-month sentence, role access), `e2e/expenses/**` (suite `expenses`, M03 and M11: the Add expense dialog, burst entry, recurring, the closed-month refusal, role access), `e2e/search/**`, `e2e/bank/**` (suite `bank`, M12: the bank tick, role access, closed-month ticking), `e2e/reports/**` (suite `reports`: P01, the four report views as admin, sales and engineer, with the network-log money check), `e2e/orders/**` (suite `orders`, which also installs poppler to read and render the stored supplier PO PDFs) and `e2e/settings/**` (suite `settings-admin`) run just their own. Then ONE job starts Supabase once, builds once, and runs the chosen suites
one after another, resetting the database between them.

The `capture` suite (R22, `e2e/capture/`) is a database suite like the others (reset, then the same build) but runs with service workers allowed, because the Android share target is a POST the worker answers. The `pwa` suite (R21, `e2e/pwa/`) needs no database and no reset: it reuses the same production build to check the manifest, the service worker, its shell-only precache, offline open and Chrome's installability. It is the only project with service workers allowed. Lighthouse is not run (version 12 dropped the PWA audit); Chrome's own installability check replaces it.

Add a suite: a project in `playwright.config.ts`, a filter and an output in `e2e.yml`, a step.
Locally, several at once: `E2E_SUITE=db npx playwright test --project=auth --project=companies`.

## Performance and accessibility (P04)

- **Bundle budget:** `scripts/bundle-budget.mjs` (run in the `ci.yml` build job after `npm run build`) walks `dist/index.html` and its static imports, gzips them and fails above 300 KB. It also reports the lazy PDF chunk (not on first load, not precached) and the service worker precache, and fails if the PDF chunk ever enters the precache.
- **Accessibility:** the `perf` suite runs the real Lighthouse accessibility category (lighthouse 12.8.2, installed with `npm i --no-save` in that step so it is not a project dependency) on Today, RFQ board, RFQ detail, order detail, Money GST register, Month-end and Settings, desktop and phone, and fails below 95. Lighthouse cannot sign in, so Playwright signs in inside a persistent Chromium profile with the debugging port open and Lighthouse attaches to it with storage kept. The axe checks (WCAG 2.2 AA plus best practice) in every other suite stay as they were.
- **CSP:** the whole e2e job runs with `E2E_CSP=1`, so every suite runs under the production Content-Security-Policy (see docs/HOSTING.md).
- Locally: `npm i --no-save lighthouse@12.8.2`, then `E2E_CSP=1 E2E_SUITE=perf npx playwright test --project=perf` against a stack-backed build.

## Forcing a full run

Actions, pick the workflow (CI, E2E, DB or Functions), Run workflow on the branch. Dispatch runs everything unconditionally
(for CI, leave `update_baselines` off). Pushes to `main` always run everything.

## Secrets and forks

Push workflows (`ci`, `db`, `functions`, `e2e`) use no secrets and only `contents: read`. The only workflows that read secrets are
`remote.yml` and `deploy-functions.yml` (`workflow_dispatch` only, behind the `production` environment's approval) and `backup.yml` (schedule or dispatch, `backup` environment limited to main; it holds only the database password and project ref, and encrypts before uploading anything). Do not add `pull_request_target`
or put a secret in a push or PR workflow. In the repository settings, keep "Run workflows from fork pull requests" requiring approval.
