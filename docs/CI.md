# CI: what runs when

Goal: the project costs $0. The repository is public, so standard GitHub-hosted runners are free and unlimited. CI is still gated by path
so runs stay fast and quick to read: a docs-only push runs nothing.

| Workflow | Runs on | Cost when it runs |
|---|---|---|
| `ci.yml` (lint, tokens, typecheck, unit, build) | every push except docs-only (`docs/**`, `*.md`) | about 3 min |
| `ci.yml` gallery job (visual + axe) | main, manual, or when `src/ui`, `src/dev`, `src/index.css`, `tailwind.config.ts`, `e2e/gallery*`, `e2e/__screenshots__`, `playwright.config.ts`, `package*.json` change | about 4 min |
| `db.yml` | every push, only if `supabase/**`, `src/types/database.ts`, `package*.json` or the workflow changed | about 6 min |
| `functions.yml` | every push; paths `supabase/functions/**`, `supabase/migrations/**` | about 6 min |
| `e2e.yml` (all DB suites, incl. `search`) | every push, path-gated; one stack boot, only suites whose paths changed | about 8 to 14 min |
| `remote.yml`, `deploy-functions.yml` | manual only, owner approval | not part of the budget |

Rules applied everywhere:

- A newer push to the same branch cancels the older run (`concurrency`; `remote.yml` and `deploy-functions.yml` keep their own non-cancelling groups).
- No `pull_request` trigger: a push to a PR branch already runs the checks; a second run on the merge ref doubled the cost.
- Playwright browsers are cached (`~/.cache/ms-playwright`, keyed on the Playwright version). Supabase Docker images are not cached:
  restoring a ~1.5 GB tar costs about as much as pulling, and counts against the 10 GB cache cap.

## e2e.yml

A `changes` job (`dorny/paths-filter@v3.0.2`) decides per suite. Shared paths (`src/**`, `e2e/support/**`, migrations, seed, config,
`playwright.config.ts`, `package*.json`, the workflow) run every suite; `e2e/auth/**`, `e2e/companies/**`, `e2e/rfqs/board.spec.ts`,
`intake.spec.ts` and `detail.spec.ts` run just their own. Then ONE job starts Supabase once, builds once, and runs the chosen suites
one after another, resetting the database between them.

Add a suite: a project in `playwright.config.ts`, a filter and an output in `e2e.yml`, a step.
Locally, several at once: `E2E_SUITE=db npx playwright test --project=auth --project=companies`.

## Forcing a full run

Actions, pick the workflow (CI, E2E, DB or Functions), Run workflow on the branch. Dispatch runs everything unconditionally
(for CI, leave `update_baselines` off). Pushes to `main` always run everything.

## Secrets and forks

Push workflows (`ci`, `db`, `functions`, `e2e`) use no secrets and only `contents: read`. The only workflows that read secrets are
`remote.yml` and `deploy-functions.yml`: `workflow_dispatch` only, behind the `production` environment's approval. Do not add `pull_request_target`
or put a secret in a push or PR workflow. In the repository settings, keep "Run workflows from fork pull requests" requiring approval.
