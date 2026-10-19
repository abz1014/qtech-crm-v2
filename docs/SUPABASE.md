# Supabase

| Item   | Value                                      |
| ------ | ------------------------------------------ |
| Ref    | `yafbphagorydbitfgfmg`                     |
| URL    | `https://yafbphagorydbitfgfmg.supabase.co` |
| Region | Singapore (ap-southeast-1)                 |
| Plan   | Free                                       |

Remote changes happen ONLY via `supabase db push` from the protected CI job.
Never edit the schema in the dashboard. `supabase/config.toml` is for local/CI use
(signup disabled, no SMTP: the app sends no email).

## Not stored in this repo

- Database password
- Service-role key
- Supabase access token
- Anon key (goes only in the gitignored `.env.local`)

## Owner's one-time local steps (Windows PowerShell, from `qtech-crm-v2/`)

```powershell
npx supabase login
npx supabase link --project-ref yafbphagorydbitfgfmg
```

`login` opens the browser. `link` prompts for the DB password: type it yourself;
never paste it into chat or files.

## GitHub protected-environment secrets (set later)

Names only: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`.

```powershell
gh secret set SUPABASE_ACCESS_TOKEN --env production
gh secret set SUPABASE_DB_PASSWORD --env production
gh secret set SUPABASE_PROJECT_REF --env production
```

Each command prompts locally for the value.

## Remote push runbook (`remote.yml`, S15)

Manual only: Actions, Remote, Run workflow. The `production` environment needs
owner approval. There is no push or schedule trigger.

- `mode = check` (default): link, print `migration list`, print the
  `db push --dry-run` plan, assert parity, check schema drift, upload remote types. Changes nothing.
- `mode = push`: same, but applies pending migrations with `supabase db push`
  between the dry run and the parity check. Run `check` first and read the plan.

Guard: the first step fails the run unless `SUPABASE_PROJECT_REF` is
`yafbphagorydbitfgfmg`. It also fails explicitly for the old CRM project. The ref
and secrets are masked and never echoed.

Seed never goes remote: `supabase/seed.sql` holds local test fixtures. The job
never passes `--include-seed`, and it switches `[db.seed]` off in its throwaway
checkout of `config.toml` before any remote command. Local `db reset` is unchanged.

Reading the result: the parity step prints the list twice (before and after).
Each row is `local | remote | time`. Green means every file in
`supabase/migrations` is applied remotely and no remote-only version exists.
`::error::` lines name the version that is missing or extra.

The drift step runs `supabase db diff --linked --schema public,storage`
(shadow database on the runner) and fails if anything is left after the
allowlist filter (below). The remote
types are generated and uploaded as the `remote-types` artifact for reference only;
they do not gate the run (hosted and local generators format differently).

### Drift allowlist

`supabase/drift-allowlist.txt` lists platform-managed objects that the drift
step ignores. Each entry is `schema.name` of a function, with a comment above
it saying why. `scripts/filter-drift.sh` removes only the statements for those
functions (the `CREATE FUNCTION` block and its `GRANT`/`REVOKE` lines, plus the
`SET local check_function_bodies = off;` preamble when nothing else remains),
prints what it removed, and everything else still fails the run.

The first entry is `public.rls_auto_enable`. Supabase creates this event
trigger function when the "Automatic RLS" project option is on (it was enabled
at project creation). It enables RLS on new tables in `public`, is not in our
migrations, and is harmless. Do not add our own objects to the allowlist: put
them in a migration instead.

Test the filter locally with `bash scripts/drift-filter.test.sh`. It uses the
real output of run 38708549583 (`scripts/fixtures/drift-rls-auto-enable.sql`).

S15 acceptance: migration list matches; schema drift = none; remote types
artifact for reference.

## First admin (A02)

The Team screen needs an admin to sign in, and only an admin can create people, so the very first
admin is made once from your own machine with `scripts/bootstrap-admin.mjs`. It uses the service-role
key, creates the Auth user and the `users` row (role `admin`), writes an `audit_log` row (never the
password), and prints a generated password once. It refuses if any admin row already exists, and it
refuses a non-local URL unless you pass `--allow-remote`.

Local stack (safe to rehearse). A freshly reset local database already holds the fixture admin from
`seed.sql`, so the script will refuse there, which is the behaviour to expect:

```powershell
npx supabase start
npx supabase status -o env
# copy API_URL and SERVICE_ROLE_KEY from that output into this shell only
$env:SUPABASE_URL = "http://127.0.0.1:54321"
$env:SUPABASE_SERVICE_ROLE_KEY = "<service role key from status>"
node scripts/bootstrap-admin.mjs --name "Your Name" --email you@company.pk
```

Real project (owner only, once, at go-live; task A05 follows):

1. Take the service-role key from Dashboard > Project Settings > API. Type or paste it into this PowerShell
   window only. Never save it in a file, a `.env`, chat, or the repo.
2. Run with the real URL and the explicit flag:

```powershell
$env:SUPABASE_URL = "https://yafbphagorydbitfgfmg.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY = "<paste here>"
node scripts/bootstrap-admin.mjs --name "Your Name" --email you@company.pk --allow-remote
```

   That prints a generated password once. To choose your own instead, add `--prompt-password`: the script asks
   for the password in your terminal with nothing shown except `*` per character, asks a second time to confirm,
   and prints "Password set (not shown)." The password never appears in the command line, the output, a file or
   the audit log. It needs a real terminal (PowerShell or Windows Terminal); piped input is refused.

```powershell
node scripts/bootstrap-admin.mjs --name "Your Name" --email you@company.pk --allow-remote --prompt-password
```

   The password must be at least 12 characters and must not contain a common pattern (such as `password`,
   `123456` or `qtech`); otherwise it says why in plain words and asks again.

   If you deliberately want a short or simple first password and plan to change it straight after signing in,
   add `--allow-weak` (only valid together with `--prompt-password`). A weak password is then accepted with one
   warning line. The 8 character minimum still applies:

```powershell
node scripts/bootstrap-admin.mjs --name "Your Name" --email you@company.pk --allow-remote --prompt-password --allow-weak
```

3. Without `--prompt-password`, copy the printed password into your password manager. Either way, sign in, then
   change your password under Account menu > Change password (a weak one especially), and set up everyone else
   from Team.
4. Close the window (or `Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY`). A second run refuses.

Nothing here ever runs in CI against a remote project.

## The `admin-users` Edge Function (A01)

Source: `supabase/functions/admin-users/`. Actions: `create`, `reset_password`, `set_role`,
`deactivate`, `reactivate`, `list`. The caller must be an active admin (checked in the function on every
call); generated passwords are returned once and never stored or logged; every change except `list`
writes an `audit_log` row with the acting admin as `changed_by`.

Secret to set before deploying (names only; deployment is a separate, owner-run step):
`ALLOWED_ORIGINS` = comma-separated site origins allowed to call it from a browser (for example the
production URL (Vercel)). Local dev origins (`localhost:5173`, `localhost:4173`) are always allowed.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform.

CI (`functions.yml`) runs the Deno unit tests and an integration test against `supabase functions serve`.

## Deploying the `admin-users` function (`deploy-functions.yml`)

Manual only: Actions, Deploy functions, Run workflow. The `production` environment needs owner approval.
There is no push or schedule trigger.

1. Inputs: `allowed_origins` = comma-separated https origins that may call the function from a browser
   (for example the production URL (Vercel), `https://<name>.vercel.app`, or `https://crm.example.com`), and `function` = `admin-users`. Each origin must match
   `^https://[a-z0-9.-]+(:[0-9]+)?$`: no trailing slash, no wildcard, no path. The run fails before touching Supabase otherwise.
2. Guard: same as `remote.yml`. `SUPABASE_PROJECT_REF` must be `yafbphagorydbitfgfmg`; the old CRM project fails explicitly.
3. The job runs `supabase secrets set ALLOWED_ORIGINS=...`, then `supabase functions deploy admin-users`
   (JWT verification stays on, the platform default), then a smoke check:
   OPTIONS from the first allowed origin returns `Access-Control-Allow-Origin`; POST with no token returns 401;
   OPTIONS from `https://evil.example` returns no allow-origin header.
4. Needs the `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` secrets in the `production` environment.
   Run it again after changing the origin list; the secret is replaced, not merged. Local dev origins stay allowed regardless.

## Nightly FX rates (R23, migration 0038)

Runs inside Postgres with `pg_cron` + `pg_net` (free on the Free plan). No GitHub job, no service-role key anywhere
outside Supabase. The migration tries `create extension if not exists pg_net` and `pg_cron` itself; if the project
refuses, it only prints a notice. Then enable both under Database, Extensions, and run
`select public.schedule_fx_cron();` once in the SQL editor (safe to repeat; it replaces the two jobs).

- `fx-fetch` at 21:00 UTC (02:00 Karachi): queues two GETs, open.er-api.com first and the jsDelivr currency-api file as fallback.
- `fx-ingest` at 21:05 and 21:20 UTC: copies the answers out of `net._http_response`, uses the first source that gives
  sane rates, writes `source = 'auto'` rows (never touches manual rows) and records the provider in `fx_rates.provider`.
- A value is skipped when it is missing, not positive, or more than 50% away from the previous auto rate.

Checking it (Dashboard):

1. Database, Cron (Integrations, Cron): jobs `fx-fetch` and `fx-ingest`; open a job to see each run's status and message.
   Or SQL: `select jobname, schedule from cron.job;` and `select * from cron.job_run_details order by start_time desc limit 10;`
2. Raw HTTP answers (kept a few hours only): `select id, status_code, timed_out, error_msg, created from net._http_response order by created desc limit 5;`
3. What the job decided (admin): `select created_at, kind, source, currency, detail from public.fx_fetch_log where kind <> 'request' order by created_at desc limit 50;`
   An `error` row reading "no source gave usable rates" means tonight's refresh failed; the staleness bands in the app then age the rates.
4. The rates: `select * from public.v_fx_latest;`
5. Test now without waiting: `select public.fetch_fx_rates();` then, a minute later, `select public.ingest_fx_response();`.

## Backups (R13, `backup.yml`)

The Free plan has no platform backups, so the repository makes its own. Cost: $0 (public repo, standard runners).

**What is backed up.** The whole `public` schema, structure and data (`public.dump`: tables, sequences such as the quotation numbers,
views, functions, policies, grants), plus the data of `auth.users`, `auth.identities`, `storage.buckets` and `storage.objects`
(`authstorage.dump`). It also holds `counts.tsv` (a row count per table), `migrations.txt` (applied migration versions),
`roles.txt` and `manifest.txt`. Hosted Postgres does not allow a roles dump, and the platform roles are managed by Supabase,
so only custom roles are listed.

**What is NOT backed up: the files themselves.** Storage objects (RFQ files, GST receipts, expense receipts, generated PDFs)
live in object storage, not in the database. Downloading them needs either the service-role key (we do not put that in GitHub)
or a signed-in user session (that would mean an admin password in GitHub). Neither was accepted, so only the object
metadata is saved: after a loss you can see exactly which files existed (bucket, path, size, who, when). Generated PDFs
(quotations, purchase orders) can be regenerated from their stored lines. For the rest, download the buckets by hand from the dashboard
(Storage) now and then, until a read-only backup user exists (a possible follow-up: a dedicated role plus a signed-in-user mirror step).

**Where and how long.** Nightly at 01:30 Karachi (20:30 UTC), `backup.yml` makes one workflow artifact
`backup-<UTC date>`: `qtech-crm-<stamp>.tar.gz.age`, kept 30 days (about 30 copies; the cap on a public repo is 90 days). Artifacts of a
public repo can be downloaded by any signed-in GitHub user, which is why the file is encrypted with `age` to a PUBLIC key
before it leaves the runner. Without the private key it is unreadable. The workflow refuses to run with no recipient, and
refuses a recipient that is a private key. Size is small (the Free database is capped at 500 MB, and a custom-format dump is compressed);
artifact storage on a public repo is not billed. GitHub turns scheduled workflows off after 60 days without repository activity:
re-enable under Actions if that happens. A Release asset would be public and never expire, so it was not chosen.

**Connection.** Plain `pg_dump` (the postgres:17 image, so the version matches the server) through the Supabase session pooler,
`aws-N-<region>.pooler.supabase.com:5432` as user `postgres.<ref>`. The direct host `db.<ref>.supabase.co` is IPv6 only on the
Free plan and GitHub runners have no IPv6; the session pooler is IPv4 and keeps pg_dump's session semantics (the transaction
pooler on 6543 does not). The CLI's `supabase db dump` was not used: it needs `link`, which needs an access token (one more secret),
and it skips `auth`. `scripts/backup/find-pooler.sh` finds the host by trying the known regions; set the `SUPABASE_POOLER_HOST`
variable to skip the search.

**Restore drill (weekly, Monday 03:00 Karachi, and on dispatch).** The drill cannot decrypt (no private key on GitHub), so it makes its
own fresh dump of the live database, never uploads it, restores it into the CI local Supabase stack (migrations that are not live yet
are left out so the schema matches), and compares every row count with `counts.tsv`. The log prints only tables that differ.
The scripts themselves are tested on every change by `backup-checks.yml` (encryption round trip with a throwaway key, and
dump, wipe, restore, compare against the local stack with the seed), so a green drill means the live data restores with the same code.
Run the check on a quiet moment: a write between the dump and the count would show as a one-row difference; run it again.

### Orchestrator: create the `backup` environment (once)

```bash
R=abz1014/qtech-crm-v2
# environment limited to main, no required reviewers (a schedule cannot wait for approval)
gh api -X PUT repos/$R/environments/backup --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
JSON
gh api -X POST repos/$R/environments/backup/deployment-branches -f name=main -f type=branch
# secrets (values supplied by the owner; gh prompts, nothing goes in the shell history)
gh secret set SUPABASE_DB_PASSWORD  --env backup --repo $R
gh secret set SUPABASE_PROJECT_REF  --env backup --repo $R      # yafbphagorydbitfgfmg
# variables (not secret): the PUBLIC age key, and optionally the pooler host
gh variable set BACKUP_AGE_RECIPIENT  --env backup --repo $R --body 'age1....'
gh variable set SUPABASE_POOLER_HOST  --env backup --repo $R --body 'aws-0-<region>.pooler.supabase.com'   # optional
# first run, after the owner has made the key:
gh workflow run backup.yml --repo $R -f run=both
```

The pooler host is on the dashboard: Connect, Session pooler. The environment never holds a service-role key or an access token.

### Owner: make the key pair (Windows, once)

1. Download `age` for Windows (amd64 zip) from https://github.com/FiloSottile/age/releases, unzip to e.g. `C:\age\`.
2. In PowerShell: `cd C:\age; .\age-keygen.exe -o backup-key.txt`. It prints `Public key: age1...`. Give ONLY that line to the orchestrator (it is not secret).
3. `backup-key.txt` is the private key. Copy it to two places that are not GitHub and not this repo: a password manager entry (paste the file content) and
   an offline USB stick. Never email it, never commit it. If it is lost, every backup is unreadable; if it leaks, make a new pair and change the variable.
4. Test it once the first artifact exists: Actions, Backup, the run, download `backup-<date>`, unzip to get the `.age` file, then
   `.\age.exe -d -i backup-key.txt -o backup.tar.gz qtech-crm-<stamp>.tar.gz.age` and `tar -xzf backup.tar.gz` (Windows 10+ has `tar`).
   Inside is a folder with `public.dump`, `authstorage.dump`, `counts.tsv`, `migrations.txt`, `roles.txt`, `manifest.txt`.

### Restore, step by step (owner, real file)

Needs Docker Desktop (the same one the Supabase CLI uses) and the key.

1. Decrypt and unpack as above (or with Git Bash: `bash scripts/backup/decrypt.sh FILE.age backup-key.txt out`).
2. Practice locally first (recommended every few months): `npx supabase start`, `npx supabase db reset --local`, then in Git Bash
   `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=supabase_admin PGPASSWORD=postgres bash scripts/backup/restore.sh out/qtech-crm-<stamp>`.
   The last line must read `restore ok: N tables, every row count matches`. Check the app against it.
3. Real recovery into a NEW Supabase project: create the project, `npx supabase link`, `npx supabase db push` (migrations up to the versions in
   `migrations.txt`), then run `restore.sh` with that project's session-pooler details (`PGHOST`, `PGPORT=5432`, `PGUSER=postgres.<newref>`,
   `PGPASSWORD`, `PGSSLMODE=require`). Then re-deploy the Edge Function, point the app's env at the new project and re-upload files from your own copies.
   `restore.sh` replaces public, `auth.users`, `auth.identities` and `storage.*` rows, so never point it at a project you want to keep.
4. Users keep their passwords (the hashes are in `auth.users`).

## Smoke test (S16, `smoke.yml`)

A read-only check of the LIVE project, every night at 02:17 Pakistan time (and on demand: Actions, Smoke, Run workflow).
Cost: $0 (public repo, standard runners). Code: `scripts/smoke/` (`smoke.mjs`, the object list in `objects.mjs`, the role
rules in `expectations.mjs`).

**Part 1, needs nothing from you.**

- Pre-flight: the project must answer (auth health, then PostgREST with JSON). A paused, wrong or unreachable project FAILS the
  run; an unreachable project never counts as "denied".
- Anonymous denial: with only the public anon key, every public table, view and RPC must refuse (permission denied). The list is
  generated from `src/types/database.ts` on every run, so a new table or function is covered without editing anything. Two
  anonymous write attempts (role change on `users`, delete on `orders`) aim at an id that cannot exist.
- A table or function that the types name but the live project lacks fails with "object missing on the live project". That means
  the live database is behind `main` (a migration was not pushed, see "Remote push runbook"). A manual run can set `missing = warn`
  to report instead of fail.
- The anon key is public (it ships in the browser bundle). The workflow uses the repository variable `SMOKE_SUPABASE_ANON_KEY` if
  you set one, and otherwise reads it from the deployed app's public bundle (`SMOKE_APP_URL`, default `https://qtech-crm-v2.vercel.app`).
  The key must say role `anon` for project `yafbphagorydbitfgfmg`. If a `service_role` key is ever found in that bundle, the run
  fails with "SERVICE-ROLE KEY EXPOSED": rotate it at once.
- It refuses the old project (`vptyhluvgnjpvkcbhxsf`) and any URL that is not the new project.

**Part 2, needs the three test accounts (task A05, owner).** It signs in as an admin, a sales and an engineer test account and
checks the access matrix (DATA_MODEL section 10) for reads: staff-wide objects readable by all three, invoices and the GST views
not readable by the engineer, money objects (payments, expenses, audit log, month-end views) returning nothing to sales and
engineer. It also checks each account really has the role it is meant to have. Until the secrets exist it is skipped with a
notice and the run still passes on Part 1.

### Owner: make the three test accounts (once)

Use dedicated test people, never a real staff member. Use plausible private addresses you control, for example `smoke-admin@`,
`smoke-sales@`, `smoke-engineer@` on a domain you own, or plus-addresses of one mailbox (`you+smoke-admin@gmail.com`).

1. Sign in to the app as the admin. Open Team, then add three people: role Admin, role Sales, role Engineer, named
   "Smoke Admin", "Smoke Sales", "Smoke Engineer". The app shows each generated password once; copy it straight into your
   password manager. (If the Team screen is not available yet, the first admin can be made with `scripts/bootstrap-admin.mjs`
   as in "First admin (A02)"; the other two roles must come from Team.)
2. Add the six secrets to the `smoke` environment. Each command prompts locally for the value; nothing goes in chat or a file:

```powershell
gh secret set SMOKE_ADMIN_EMAIL --env smoke -R abz1014/qtech-crm-v2
gh secret set SMOKE_ADMIN_PASSWORD --env smoke -R abz1014/qtech-crm-v2
gh secret set SMOKE_SALES_EMAIL --env smoke -R abz1014/qtech-crm-v2
gh secret set SMOKE_SALES_PASSWORD --env smoke -R abz1014/qtech-crm-v2
gh secret set SMOKE_ENGINEER_EMAIL --env smoke -R abz1014/qtech-crm-v2
gh secret set SMOKE_ENGINEER_PASSWORD --env smoke -R abz1014/qtech-crm-v2
```

   (Or in the browser: Settings, Environments, `smoke`, Add environment secret.) The first workflow run creates the `smoke`
   environment if it does not exist yet. Afterwards, optionally restrict it to the `main` branch (Settings, Environments, `smoke`,
   Deployment branches), like `backup`. Do not add required reviewers: a schedule cannot wait for approval.
3. Run Smoke once by hand (Run workflow on `main`). The log line `Part 2: admin N/N read checks as expected` (and sales, engineer)
   confirms it. Task A05 is then done.
4. When the real team goes live, deactivate these three in Team only if you stop wanting the check; a deactivated account makes
   Part 2 fail at sign-in on purpose.

The workflow hands the secrets to the script on `main` only, masks the passwords in the log, and the script only reads.
