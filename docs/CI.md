# CI: what runs when

Goal: the project costs $0. The repository is public, so standard GitHub-hosted runners are free and unlimited. CI is still gated by path
so runs stay fast and quick to read: a docs-only push runs nothing.

| Workflow | Runs on | Cost when it runs |
|---|---|---|
| `ci.yml` (lint, tokens, typecheck, unit, import transforms and guard, build) | every push except docs-only (`docs/**`, `*.md`) | about 3 min |
| `ci.yml` gallery job (visual + axe) | main, manual, or when `src/ui`, `src/dev`, `src/index.css`, `tailwind.config.ts`, `e2e/gallery*`, `e2e/__screenshots__`, `playwright.config.ts`, `package*.json` change | about 4 min |
| `db.yml` | every push, only if `supabase/**`, `src/types/database.ts`, `import/**`, `package*.json` or the workflow changed (its last step is the import load test, I01) | about 6 min |
| `functions.yml` | every push; paths `supabase/functions/**`, `supabase/migrations/**` | about 6 min |
| `e2e.yml` (all DB suites, incl. `search`, plus `pwa`) | every push, path-gated; up to 8 parallel shards, each with its own stack boot, only suites whose paths changed; the final job `E2E` is the one result | about 20 min on a full run (planned shards 20.0 to 20.2 min; job timeout 40 min) |
| `ci.yml` build job, bundle budget step (P04) | every push except docs-only | seconds; fails if the initial JS is over 300 KB gzip, and prints the PDF chunk and service-worker precache sizes in the run summary |
| `e2e.yml` suite `perf` (P04, registered in `.github/e2e-suites.yml`) | when `e2e/perf/**` or a shared path changes | about 5 min (Lighthouse, 7 screens, desktop and phone) |
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

Suites are defined in ONE file, `.github/e2e-suites.yml`: each key is a Playwright project, its paths say when it runs, an optional `# weight=N`
(measured seconds, median of 5 shard runs on 2026-10-22; refresh from the `##[group]suite` log timestamps when suites change a lot) balances shards. The `shared` key (`src/**`, `e2e/support/**`, migrations, seed, config, `playwright.config.ts`, `package*.json`, the workflow,
this file, `scripts/ci/e2e-*`) runs every suite; anything else runs just the suites whose own paths changed. `dorny/paths-filter` reads that file, then
`scripts/ci/e2e-matrix.py` packs the chosen suites into up to 8 shards (longest first, about 950 s of tests each, plus about 270 s of fixed cost per shard for runner, `npm ci`, Supabase start and build, so about 20 min planned). Every shard is its own job
(`E2E shard N`): it boots its own Supabase stack, builds once, and runs its suites one after another with `supabase db reset` between them
(`scripts/ci/e2e-run.sh`; a failing suite does not stop the others, the shard fails at the end). A final job named `E2E` needs all shards and is the single
result to read or require (green also when no suite needed to run). Reports upload per shard as `playwright-e2e-shard-N`.

Suites defined there include `month-end` (M10, M05: the checklist, the six reports and their CSV, close and reopen, role access) next to the ones named in `playwright.config.ts`.

Why shards: a stack boot is about 100 to 145 s and every reset about 27 s, and since the hunt suites joined the tests themselves are about 125 min in total (7,500 s), so running them in
8 parallel jobs (free on a public repo, standard runners are unmetered) keeps a full run near 20 min. Shard balance is the real timing fix: the old weights were guesses (the hunt suites were planned at 700 s but take 350 to 900 s, `hunt-edges-clicks` 780 s and `hunt-edges-probe` 900 s), so shard 5 planned 22 min of tests and ran 27 min against a 30 min limit. `timeout-minutes` is now 40, only as a safety margin. Suites still run with `E2E_SUITE=db` (one worker, one database per stack), so tests are unchanged.

The `capture` suite (R22, `e2e/capture/`) is a database suite like the others (reset, then the same build) but runs with service workers allowed, because the Android share target is a POST the worker answers. The `pwa` suite (R21, `e2e/pwa/`) needs no database and no reset: it reuses the same production build to check the manifest, the service worker, its shell-only precache, offline open and Chrome's installability. It is the only project with service workers allowed. Lighthouse is not run (version 12 dropped the PWA audit); Chrome's own installability check replaces it.

Add a suite: a project in `playwright.config.ts` (`testMatch`, viewport and so on), and ONE key in `.github/e2e-suites.yml` named exactly like the project, with its paths and a `# weight=`. Nothing in `e2e.yml` changes. (A suite needing extra tools, like poppler, is added by name in `scripts/ci/e2e-run.sh`.)
The `journeys` suite (P03, `e2e/journeys/`) is the regression net: three whole working days, one spec per role (sales: a pasted enquiry to a payment on the books; engineer: Today to delivered, with a network-log check that no money is ever requested or returned; admin: burst expenses, bank tick, margins, close and reopen a month), each holding every step to its FE-2 interaction count. It runs whenever `src/**` or any other shared path changes (the `all` rule above), or when `e2e/journeys/**` changes, after its own database reset, and installs poppler to read the stored PDFs. Each role signs in once and the saved session is reused (`e2e/journeys/support.ts`). A count over its target is reported as a soft failure naming the step, the count and the target.

Locally, several at once: `E2E_SUITE=db npx playwright test --project=auth --project=companies`.

## Performance and accessibility (P04)

- **Bundle budget:** `scripts/bundle-budget.mjs` (run in the `ci.yml` build job after `npm run build`) walks `dist/index.html` and its static imports, gzips them and fails above 300 KB. It also reports the lazy PDF chunk (not on first load, not precached) and the service worker precache, and fails if the PDF chunk ever enters the precache.
- **Perf flake (LCP):** the 2.5 s LCP limit is unchanged. A single simulated Lighthouse run on a shared runner sometimes lands a few percent over (2.56 to 2.58 s on the RFQ page with nothing wrong). `e2e/perf/perf.spec.ts` therefore runs a screen once; only when that run is over the limit (or has no LCP) it runs twice more and judges the screen on the median of the three. A genuinely slow screen still fails, a clean screen costs no extra time, and the log prints a line when the median was used.
- **Accessibility:** the `perf` suite runs the real Lighthouse accessibility category (lighthouse 12.8.2, installed with `npm i --no-save` in that step so it is not a project dependency) on Today, RFQ board, RFQ detail, order detail, Money GST register, Month-end and Settings, desktop and phone, and fails below 95. Lighthouse cannot sign in, so Playwright signs in inside a persistent Chromium profile with the debugging port open and Lighthouse attaches to it with storage kept. The axe checks (WCAG 2.2 AA plus best practice) in every other suite stay as they were.
- **CSP:** `scripts/ci/e2e-run.sh` exports `E2E_CSP=1` for every suite, so every suite runs under the production Content-Security-Policy (see docs/HOSTING.md).
- Locally: `npm i --no-save lighthouse@12.8.2`, then `E2E_CSP=1 E2E_SUITE=perf npx playwright test --project=perf` against a stack-backed build.

## Forcing a full run

Actions, pick the workflow (CI, E2E, DB or Functions), Run workflow on the branch. Dispatch runs everything unconditionally
(for CI, leave `update_baselines` off). Pushes to `main` always run everything.

## Secrets and forks

Push workflows (`ci`, `db`, `functions`, `e2e`) use no secrets and only `contents: read`. The only workflows that read secrets are
`remote.yml` and `deploy-functions.yml` (`workflow_dispatch` only, behind the `production` environment's approval) and `backup.yml` (schedule or dispatch, `backup` environment limited to main; it holds only the database password and project ref, and encrypts before uploading anything). Do not add `pull_request_target`
or put a secret in a push or PR workflow. In the repository settings, keep "Run workflows from fork pull requests" requiring approval.
