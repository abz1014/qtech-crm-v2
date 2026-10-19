# CI: what runs when

Goal: the project costs $0. The repository is public, so standard GitHub-hosted runners are free and unlimited. CI is still gated by path
so runs stay fast and quick to read: a docs-only push runs nothing.

| Workflow | Runs on | Cost when it runs |
|---|---|---|
| `ci.yml` (lint, tokens, typecheck, unit, import transforms and guard, build) | every push except docs-only (`docs/**`, `*.md`) | about 3 min |
| `ci.yml` gallery job (visual + axe) | main, manual, or when `src/ui`, `src/dev`, `src/index.css`, `tailwind.config.ts`, `e2e/gallery*`, `e2e/__screenshots__`, `playwright.config.ts`, `package*.json` change | about 4 min |
| `db.yml` | every push, only if `supabase/**`, `src/types/database.ts`, `import/**`, `package*.json` or the workflow changed (its last step is the import load test, I01) | about 6 min |
| `functions.yml` | every push; paths `supabase/functions/**`, `supabase/migrations/**` | about 6 min |
| `e2e.yml` (all DB suites, incl. `search`, plus `pwa`) | every push, path-gated; up to 4 parallel shards, each with its own stack boot, only suites whose paths changed; the final job `E2E` is the one result | about 7 min on a full run (was 20 to 40) |
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
(rough seconds) balances shards. The `shared` key (`src/**`, `e2e/support/**`, migrations, seed, config, `playwright.config.ts`, `package*.json`, the workflow,
this file, `scripts/ci/e2e-*`) runs every suite; anything else runs just the suites whose own paths changed. `dorny/paths-filter` reads that file, then
`scripts/ci/e2e-matrix.py` packs the chosen suites into up to 4 shards (longest first, about 240 s of tests each). Every shard is its own job
(`E2E shard N`): it boots its own Supabase stack, builds once, and runs its suites one after another with `supabase db reset` between them
(`scripts/ci/e2e-run.sh`; a failing suite does not stop the others, the shard fails at the end). A final job named `E2E` needs all shards and is the single
result to read or require (green also when no suite needed to run). Reports upload per shard as `playwright-e2e-shard-N`.

Suites defined there include `month-end` (M10, M05: the checklist, the six reports and their CSV, close and reopen, role access) next to the ones named in `playwright.config.ts`.

Why shards: a stack boot is about 80 s and every reset about 27 s, but the tests themselves are about 8 min in total, so running them in
4 parallel jobs (free on a public repo) cuts a full run from 20+ min to about 7. Suites still run with `E2E_SUITE=db` (one worker, one database per stack), so tests are unchanged.

The `capture` suite (R22, `e2e/capture/`) is a database suite like the others (reset, then the same build) but runs with service workers allowed, because the Android share target is a POST the worker answers. The `pwa` suite (R21, `e2e/pwa/`) needs no database and no reset: it reuses the same production build to check the manifest, the service worker, its shell-only precache, offline open and Chrome's installability. It is the only project with service workers allowed. Lighthouse is not run (version 12 dropped the PWA audit); Chrome's own installability check replaces it.

Add a suite: a project in `playwright.config.ts` (`testMatch`, viewport and so on), and ONE key in `.github/e2e-suites.yml` named exactly like the project, with its paths and a `# weight=`. Nothing in `e2e.yml` changes. (A suite needing extra tools, like poppler, is added by name in `scripts/ci/e2e-run.sh`.)
Locally, several at once: `E2E_SUITE=db npx playwright test --project=auth --project=companies`.

## Forcing a full run

Actions, pick the workflow (CI, E2E, DB or Functions), Run workflow on the branch. Dispatch runs everything unconditionally
(for CI, leave `update_baselines` off). Pushes to `main` always run everything.

## Secrets and forks

Push workflows (`ci`, `db`, `functions`, `e2e`) use no secrets and only `contents: read`. The only workflows that read secrets are
`remote.yml` and `deploy-functions.yml` (`workflow_dispatch` only, behind the `production` environment's approval) and `backup.yml` (schedule or dispatch, `backup` environment limited to main; it holds only the database password and project ref, and encrypts before uploading anything). Do not add `pull_request_target`
or put a secret in a push or PR workflow. In the repository settings, keep "Run workflows from fork pull requests" requiring approval.
