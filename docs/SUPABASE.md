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
(shadow database on the runner) and fails if anything is printed. The remote
types are generated and uploaded as the `remote-types` artifact for reference only;
they do not gate the run (hosted and local generators format differently).

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

3. Copy the printed password into your password manager, sign in, and set up everyone else from Team.
4. Close the window (or `Remove-Item Env:SUPABASE_SERVICE_ROLE_KEY`). A second run refuses.

Nothing here ever runs in CI against a remote project.

## The `admin-users` Edge Function (A01)

Source: `supabase/functions/admin-users/`. Actions: `create`, `reset_password`, `set_role`,
`deactivate`, `reactivate`, `list`. The caller must be an active admin (checked in the function on every
call); generated passwords are returned once and never stored or logged; every change except `list`
writes an `audit_log` row with the acting admin as `changed_by`.

Secret to set before deploying (names only; deployment is a separate, owner-run step):
`ALLOWED_ORIGINS` = comma-separated site origins allowed to call it from a browser (for example the
Vercel production URL). Local dev origins (`localhost:5173`, `localhost:4173`) are always allowed.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by the platform.

CI (`functions.yml`) runs the Deno unit tests and an integration test against `supabase functions serve`.
