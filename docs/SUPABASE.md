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
