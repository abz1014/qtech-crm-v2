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

## Engineer role and the API pre-request (migration 0081)

Migration 0081 (owner decision 2026-10-22: engineers see no prices) creates the NOLOGIN role `qtech_engineer`, grants it to
`authenticator`, and sets PostgREST's `db-pre-request` on the `authenticator` role to `qtech_private.pre_request` (then
`notify pgrst, 'reload config'`). On the hosted project this arrives with the normal remote push. After the push, check in the
SQL editor: `select rolname, setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where rolname = 'authenticator';`
shows `pgrst.db_pre_request=qtech_private.pre_request`, and an engineer's `GET /rest/v1/rfq_items?select=*` answers 403 while
`select=description` answers 200. Nothing to set in the dashboard. A new table, view, function or policy must be granted to
`qtech_engineer` as well (pgTAP 0081 fails until it is), unless it is a price.

## Auth session settings (owner, dashboard)

`supabase/config.toml` configures only the local and CI stack: `supabase db push` does not carry Auth settings to the
hosted project. Set these once in the dashboard of project `yafbphagorydbitfgfmg` so it matches the repo:

| Where | Setting | Value |
| ----- | ------- | ----- |
| Authentication > Configuration > **Sessions** (older dashboards: Authentication > Settings > User Sessions) | **Refresh token reuse interval** | **120** seconds (the default is 10) |
| same page | Detect and revoke potentially compromised refresh tokens (refresh token rotation) | On (the default; keep it) |
| same page, if shown | Time-box user sessions, Inactivity timeout | Off / 0 (people stay signed in until they sign out; the phone app relies on it) |

The Management API names, for checking or setting it without the dashboard (`GET`/`PATCH /v1/projects/yafbphagorydbitfgfmg/config/auth`):
`security_refresh_token_reuse_interval: 120` and `refresh_token_rotation_enabled: true`.

Why 120: on patchy mobile data a token refresh can reach Auth and its reply be lost. The phone keeps the old refresh
token and tries again later (supabase-js waits out a 60 s cooldown after a failed refresh, then retries on its 30 s
tick). Past the reuse interval Auth treats that retry as a stolen token being replayed and revokes the whole session,
so the person is signed out for no reason. 120 s covers those retries. The cost is small: an already-used refresh token
stays usable for 2 minutes after its first use, and access tokens still expire after 1 hour (`jwt_expiry = 3600`).

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

**What is backed up, every night.**
1. The database, in `backup-<stamp>`: the whole `public` schema, structure and data (`public.dump`: tables, sequences such as the
   quotation numbers, views, functions, policies, grants); the two archive schemas `legacy_archive` and `audit_archive`
   (`archive.dump`; a plain `pg_dump -n public` leaves them out); and the data of `auth.users`, `auth.identities`,
   `storage.buckets` and `storage.objects` (`authstorage.dump`). Also `counts.tsv` (a row count per table), `checksums.tsv` (money
   sums and per-month counts, and a content hash of every table), `migrations.txt`, `roles.txt` and `manifest.txt`. Hosted Postgres does
   not allow a roles dump, and the platform roles are managed by Supabase, so only custom roles are listed. Everything in the dump
   is taken at ONE snapshot (`pg_export_snapshot` + `pg_dump --snapshot`), so the files agree with each other even while the app is
   being used. `manifest.txt` says `one_snapshot=yes`.
2. Every file in Storage (customer POs, supplier quotes, receipts, tax-deposit receipts, generated PDFs), in a second artifact
   `backup-files-<stamp>`: `qtech-files-<stamp>.tar.gz.age`, holding `files/<bucket>/<path>`, `files.tsv` (bucket, path, size as the
   database lists them) and `SHA256SUMS`. After the download the job checks that every file the database listed is there with the
   right size; a short backup fails the run.

Both artifacts are encrypted with `age` before upload (see "Where and how long"). The nightly run also prints the sizes in its
summary and records them in the app (Settings, Backups and usage).

**Files: the credentials.** The backup so far used one credential, the database password. That cannot read file contents (they
live in object storage, not in Postgres). The service-role key could, but it opens everything, so it is not used. Instead the
`backup` environment holds a **Supabase Storage S3 access key** (Dashboard, Storage, S3 Configuration, New access key). It reaches
Storage only (not the database, Auth or the REST API) and never goes to the browser or to Vercel. If the two secrets
(`STORAGE_S3_ACCESS_KEY_ID`, `STORAGE_S3_SECRET_ACCESS_KEY`) are missing, the nightly run still backs up the database, prints a
warning annotation "Files are NOT backed up", and Settings shows "files NOT backed up". It never pretends.

**Size and limits.** The Free plan caps Storage at 1 GB and the database at 500 MB, so a nightly artifact is at most about 1 GB
(files already compressed, so they are gzipped at level 1; the database dump is compressed by pg_dump). 30 nights of that is far below
what a public repository can hold, and artifacts on a public repository are not billed. The run's summary reports the sizes and
warns above 1.5 GB. If the plan is ever upgraded and files grow past that, make the files artifact incremental (only objects changed
since the last full copy, a full copy weekly); `files.tsv` and `SHA256SUMS` already carry what that needs.

**Deleted records keep their files for 30 days (migration 0120).** Deleting an RFQ, order, invoice, expense, a quotation or
PO revision, or a single attached file used to remove the stored files at once. Now a database trigger lists each file in
`qtech_private.pending_file_deletes` and the app removes nothing; the file stays at its own path. After the nightly backup has
uploaded the files, `scripts/backup/purge-trash.sh` removes the files that have been waiting more than 30 days, through the Storage S3
API, so a deleted file is always in at least one backup first. A path that a live record points at again is released, not removed.
Settings, Backups and usage shows how many files wait. To keep a file for good, re-attach it before the 30 days are over (the file is
still at its path), or take it from a backup. The deleted record itself is not restored by this; it is still gone from the database
(the audit log keeps the old rows). Not covered: the photos of an engineer's "I paid" claim (a separate bucket, removed when the claim
is withdrawn), and the upload that fails halfway (cleaned up at once, it never had a record).

**Where and how long.** Nightly at 01:30 Karachi (20:30 UTC), `backup.yml` makes the workflow artifacts `backup-<UTC date>` and
`backup-files-<UTC date>`, kept 30 days (about 30 copies; the cap on a public repo is 90 days). Artifacts of a public repo can be
downloaded by any signed-in GitHub user, which is why both files are encrypted with `age` to a PUBLIC key before they leave the
runner. Without the private key they are unreadable. The workflow refuses to run with no recipient, refuses a recipient that is a
private key, and fails if anything in the upload folder is not an age file. A Release asset would be public and never expire, so it
was not chosen.

**Connection.** Plain `pg_dump` (the postgres:17 image, so the version matches the server) through the Supabase session pooler,
`aws-N-<region>.pooler.supabase.com:5432` as user `postgres.<ref>`. The direct host `db.<ref>.supabase.co` is IPv6 only on the
Free plan and GitHub runners have no IPv6; the session pooler is IPv4 and keeps pg_dump's session semantics (the transaction
pooler on 6543 does not), which the single snapshot also needs. The CLI's `supabase db dump` was not used: it needs `link`, which needs
an access token (one more secret), and it skips `auth`. `scripts/backup/find-pooler.sh` finds the host by trying the known regions;
set the `SUPABASE_POOLER_HOST` variable to skip the search. The Storage S3 signing region is read from that host name
(`aws-0-ap-south-1...` means `ap-south-1`); set the `STORAGE_S3_REGION` variable to override.

**Restore drill (weekly, Monday 03:00 Karachi, and on dispatch).** The drill cannot decrypt (no private key on GitHub), so it makes its
own fresh dump of the live database, never uploads it, restores it into the CI local Supabase stack (migrations that are not live yet
are left out so the schema matches), and verifies the copy:
1. every row count matches `counts.tsv` (public, legacy_archive, audit_archive, auth users and identities, storage);
2. the **money checksums** match `checksums.tsv`: invoices (count, net, GST), payments in (count, total, total of the unvoided),
   expenses (count, total), and the count and sums per month of each, plus a content hash of every table, so a changed value that a
   row count would miss is caught;
3. every foreign key holds (a query per key, because the load runs with triggers off and the keys are enforced by triggers),
   constraints left NOT VALID are validated, no trigger is left disabled, and `session_replication_role` is back to `origin`;
4. a smoke query reads every view and calls the first functions on the restored copy.

The log prints only the NAMES of lines that differ, never a value or a sum (the repository is public). The result (passed or FAILED)
is written back to the live database for the app. The dump and the checks all use the same snapshot, so a write during the run cannot
show as a difference. (If a snapshot cannot be exported, the run says so with a warning and falls back to separate reads.)
The scripts themselves are tested on every change by `backup-checks.yml`: the encryption round trip with a throwaway key; dump, wipe,
restore and verify against the local stack with the seed, including that a changed amount, a missing row, an orphan row and a
disabled trigger are each caught; and the storage download, the encrypted files artifact, the 30-day trash and the purge, with files
uploaded through the local stack's S3 endpoint. So a green drill means the live data restores with the same code.

**Seeing it in the app.** Settings, Backups and usage (admin only) shows the last backup (date and sizes), the last drill, the files
waiting in the trash, the Free-plan meters and the monthly key check. To do shows an admin: a red row "Backup is N days old" when
the last successful backup is more than 2 days old (or none has ever reported since migration 0120), an amber row when the database
(500 MB) or Storage (1 GB) is 70% full, and a grey "Test-decrypt last night's backup" row every month. The sizes come from
`pg_database_size` and the sum of `storage.objects` metadata, through the admin-only function `admin_health()`.

**Schedules switch themselves off.** GitHub turns scheduled workflows off after 60 days without repository activity. `keepalive.yml`
runs on the 1st of every month and, with the built-in `GITHUB_TOKEN` (`actions: write`, no secret), calls "enable workflow" for the
backup, the smoke test and itself; that re-enables any that were off and restarts the 60-day clock of the others. If even that is off
(a very long quiet period before its first run), the app notices within two days: the last-backup time stops moving and To do turns red.
To fix by hand: Actions, pick the workflow, Enable workflow.

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
# Storage S3 access key (Dashboard, Storage, S3 Configuration, New access key). Storage only; this is NOT the service-role key.
gh secret set STORAGE_S3_ACCESS_KEY_ID      --env backup --repo $R
gh secret set STORAGE_S3_SECRET_ACCESS_KEY  --env backup --repo $R
# variables (not secret): the PUBLIC age key, and optionally the pooler host
gh variable set BACKUP_AGE_RECIPIENT  --env backup --repo $R --body 'age1....'
gh variable set SUPABASE_POOLER_HOST  --env backup --repo $R --body 'aws-0-<region>.pooler.supabase.com'   # optional
gh variable set STORAGE_S3_REGION      --env backup --repo $R --body '<project region, e.g. ap-south-1>'   # optional: read from the pooler host when empty
# first run, after the owner has made the key:
gh workflow run backup.yml --repo $R -f run=both
```

The pooler host is on the dashboard: Connect, Session pooler. The environment never holds a service-role key or an access token. After merging migration `0120` and the workflows to `main`, apply the migration to the live project (the status table, the trash and `admin_health()` live there), then dispatch `backup.yml` with `run=both` once to see the first files artifact and the first recorded status, and dispatch `keepalive.yml` once too.

### Owner: make the key pair (Windows, once)

1. Download `age` for Windows (amd64 zip) from https://github.com/FiloSottile/age/releases, unzip to e.g. `C:\age\`.
2. In PowerShell: `cd C:\age; .\age-keygen.exe -o backup-key.txt`. It prints `Public key: age1...`. Give ONLY that line to the orchestrator (it is not secret).
3. `backup-key.txt` is the private key. Copy it to two places that are not GitHub and not this repo: a password manager entry (paste the file content) and
   an offline USB stick. Never email it, never commit it. If it is lost, every backup is unreadable; if it leaks, make a new pair and change the variable.
4. Test it once the first artifact exists: Actions, Backup, the run, download `backup-<date>`, unzip to get the `.age` file, then
   `.\age.exe -d -i backup-key.txt -o backup.tar.gz qtech-crm-<stamp>.tar.gz.age` and `tar -xzf backup.tar.gz` (Windows 10+ has `tar`).
   Inside is a folder with `public.dump`, `archive.dump`, `authstorage.dump`, `counts.tsv`, `checksums.tsv`, `migrations.txt`, `roles.txt`, `manifest.txt`.
   The files artifact (`backup-files-<date>`) opens the same way and holds `files/<bucket>/<path>`.

### Owner: test-decrypt last night's backup (monthly, Windows)

A backup nobody can open is not a backup. Once a month, prove that your private key still opens last night's file. It takes five
minutes and needs no Docker. The app reminds you: To do shows "Test-decrypt last night's backup (monthly)" when 31 days have passed.

1. Open GitHub, the repository, Actions, **Backup**, and click the latest run with a green tick (it should be from last night).
2. Under Artifacts, download **backup-<date>** (the database, a few MB). Unzip it: you get one file `qtech-crm-<stamp>.tar.gz.age`.
   (**backup-files-<date>** holds the stored files; it is large, you do not need to download it every month.)
3. Get your private key out of your password manager: paste it into a file `C:\age\backup-key.txt` (or plug in the USB stick). Never
   save it inside the repository folder.
4. In PowerShell:

   ```powershell
   cd C:\age
   .\age.exe -d -i backup-key.txt -o backup.tar.gz C:\Users\<you>\Downloads\qtech-crm-<stamp>.tar.gz.age
   tar -xzf backup.tar.gz
   dir qtech-crm-<stamp>
   ```

5. The folder must list `public.dump`, `archive.dump`, `authstorage.dump`, `counts.tsv`, `checksums.tsv`, `migrations.txt`,
   `roles.txt` and `manifest.txt`. Open `manifest.txt` in Notepad: `created_utc` must be last night.
6. Delete the decrypted copy (`backup.tar.gz` and the folder) and, if the key lives in the password manager, the key file. The decrypted
   data is your customers' money records: do not leave it in Downloads.
7. In the app, Settings, Backups and usage, press **I opened a backup with my key today**. That records the date and clears the To do row.

If step 4 says "no identity matched", the key is not the one the backup was made for: stop, find the right key, or make a new pair
and change the `BACKUP_AGE_RECIPIENT` variable (older backups still need the older key, so keep both).

### Restore, step by step (owner, real file)

Needs Docker Desktop (the same one the Supabase CLI uses) and the key.

1. Decrypt and unpack as above (or with Git Bash: `bash scripts/backup/decrypt.sh FILE.age backup-key.txt out`).
2. Practice locally first (recommended every few months): `npx supabase start`, `npx supabase db reset --local`, then in Git Bash
   `PGHOST=127.0.0.1 PGPORT=54322 PGUSER=supabase_admin PGPASSWORD=postgres bash scripts/backup/restore.sh out/qtech-crm-<stamp>`.
   It must end with `restore verified: counts, checksums, foreign keys, triggers, views`. Check the app against it.
3. Real recovery into a NEW Supabase project: create the project, `npx supabase link`, `npx supabase db push` (migrations up to the versions in
   `migrations.txt`), then run `restore.sh` with that project's session-pooler details (`PGHOST`, `PGPORT=5432`, `PGUSER=postgres.<newref>`,
   `PGPASSWORD`, `PGSSLMODE=require`). Then re-deploy the Edge Function, point the app's env at the new project and put the files back from `backup-files-<date>` (upload each `files/<bucket>/<path>` to the same bucket and path, for example `aws s3 cp --recursive files/<bucket> s3://<bucket> --endpoint-url https://<newref>.supabase.co/storage/v1/s3` with a new S3 access key).
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
