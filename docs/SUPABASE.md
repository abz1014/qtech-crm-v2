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
  `db push --dry-run` plan, assert parity, compare remote types. Changes nothing.
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
`::error::` lines name the version that is missing or extra. The last step diffs
remote-generated types against `src/types/database.ts`; on failure both files are
uploaded as the `remote-types-diff` artifact.
