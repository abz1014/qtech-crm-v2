# Q-Tech CRM v2: build plan

Status: APPROVED by owner 2026-10-13. Q1 = (a) real trial data kept; Q2 = (a) GitHub protected-environment secrets; Q3 deferred to go-live. Amendment A1 appended (design direction, approved 2026-10-13). Amendment A2 appended (Gate 1 result and features F-1 to F-7, approved 2026-10-13). Amendment A2b appended (reconciliation of the two A2 versions, approved by orchestrator 2026-10-13).

**Based on:** the approved data model (original document plus Revision 1) and the owner decisions you sent.
**Facts checked in the old repo:**
- Its CI runs lint, typecheck, unit tests and build on Node 20.
- `src/test/rls.integration.test.ts` has a reachability pre-flight and two tiers (anonymous, then a sales test account).
- Both logo files exist at the paths given.
- The current dashboard uses calendar quarters (`DashboardPage.tsx:49`).

## 0. Three choices that shape this plan

1. **The "no Docker" problem is solved in CI, not on the laptop.**
   - **INFERENCE:** GitHub's `ubuntu-latest` runners ship with Docker, so `supabase start` and `supabase db reset` can run there.
   - Every push therefore rebuilds the whole database from zero in a temporary Supabase stack. It then runs the pgTAP database tests, the access-matrix test and Playwright, and regenerates the TypeScript types.
   - This temporary CI stack acts as our staging environment. The free plan's two-project limit stops mattering.
   - This is verified first, in task F06. If it fails, there is a fallback (§7, risk R1).
2. **The import reads the old project live, through its REST API, using an admin login.** That is how discovery was done.
   - So the import does not need the database dump at all.
   - The dump is only needed for two things: checking the schema assumptions in §8 of the data model, and the permanent archive.
   - The import can therefore be built and tested early, against fixtures taken from `seed_historical_data.sql`. Only the final verification and the dry runs wait for the owner.
3. **Today and search grow phase by phase; they are not a late phase.**
   - The early-use milestone is only worth trying if it includes the line "2 questions unanswered · asked customer 6 days ago · bid due in 4 days · supplier X waiting".
   - So Today v1 ships with the RFQ slice. Order rules and money rules are added as their phases land.

---

## 1. Folder and repository setup

```
Qtech-CRM-fresh/                      ← old repo (reference only, read-only for workers)
  .gitignore                          + "/qtech-crm-v2/"
  eslint.config.js                    + ignores: ["qtech-crm-v2/**"]
  vitest.config.ts                    + exclude: ["qtech-crm-v2/**", ...defaults]
  qtech-crm-v2/                       ← NEW, own .git, own GitHub private repo
    .github/workflows/
      ci.yml            lint · typecheck · unit · build (clean clone ⇒ catches phantom deps)
      db.yml            supabase start → db reset (from zero) → db lint → test db (pgTAP) → gen types diff → e2e
      remote.yml        manual/protected: db push · migration-list parity · remote smoke
      nightly.yml       scheduled: remote smoke (also keep-alive) · encrypted backup · weekly restore drill
    supabase/
      config.toml       auth: enable_signup=false, email provider confirmations off, site_url
      migrations/       0001_… sequential; the ONLY source of schema truth
      tests/            pgTAP *.test.sql + access_matrix.sql (+ matrix data)
      seed.sql          TEST-ONLY fixtures (auth users admin/sales/engineer/deactivated + sample rows); never pushed remote
      functions/admin-users/
    src/
      app/              router, providers (QueryClient, auth session), role landing
      ui/               six primitives + shadcn subset + tokens
      features/         auth · team · companies · rfqs · orders · money · targets · today · search · reports
      lib/              dates · csvExport · imageCompress · fbr · reconciliation · status · money · rules/
      types/database.ts GENERATED in CI from local stack (committed; CI fails on drift)
    import/             extract · transform (pure) · load · review · mappings/ (owner-reviewed CSV/JSON) · fixtures/
      .data/            GITIGNORED: extracted live rows, dump, review outputs with contact data
    public/brand/       logo-wordmark.png · logo-mark.png · favicon set
    docs/               DATA_MODEL.md (approved model + Revision 1, merged) · DECISIONS.md · BRAND.md · RUNBOOK_CUTOVER.md · BACKUP.md
    .nvmrc  .gitignore (.env*, import/.data/, backups/)  vercel.json
```

**Keeping the two repos apart:**
- The parent repo ignores the folder in git, ESLint and Vitest.
- **Phantom-dependency hazard (FACT):** Node looks for packages by climbing up the folder tree. Code in v2 could quietly import a package that only exists in the old repo's `node_modules`. Three guards stop this:
  - CI always runs on a clean clone of the v2 repo alone.
  - ESLint rule `import/no-extraneous-dependencies`.
  - `tsconfig` sets `typeRoots: ["./node_modules/@types"]`.
- Workers read old files by path (`../src/lib/...`). Every file copied across gets a provenance header naming its source path and commit.

**Migrations as the single source of truth:**
- Files are numbered in sequence and never edited once they have been pushed to the remote project. Fixes always go forward in a new file.
- Each table enables RLS and creates its policies **in the same file** that creates it, so no table ever exists unprotected.
- CI's `db reset` applies every migration to an empty database on every push. That is the proof the schema can be rebuilt.
- The remote project only ever receives migrations through `supabase db push`, run from the protected `remote.yml` job. Nobody makes schema changes in the dashboard.
- A parity check (`supabase migration list` against the repo) runs nightly and fails on drift.

---

## 2. Phases

| Phase | Goal | Exit criteria |
|---|---|---|
| **P0 Foundation** | Repo, CI, Supabase project, Vercel, brand, copied assets | • `ci.yml` is green on a clean clone.<br>• `db.yml` is green with zero migrations, which proves Docker works on the runner.<br>• The new project exists, with signups disabled.<br>• Vercel preview deploys work.<br>• Brand tokens are committed. |
| **P1 Schema + access** (in parallel with P2) | All 24 tables, views, functions and RPCs, plus RLS for the access matrix (§10) | • Migrations apply from zero in CI.<br>• All pgTAP tests pass, including the full matrix of 24 tables × 3 roles × 4 operations, plus anonymous access.<br>• Types are generated.<br>• The migrations are pushed to the remote project and the parity check is green.<br>• The remote smoke test passes with the three test accounts. |
| **P2 UI primitives** | Tokens, page shell, and the six primitives built once | • A gallery route shows every primitive in every state.<br>• The axe accessibility check is clean.<br>• Lint bans arbitrary font sizes and raw `<table>` in pages. |
| **P3 Accounts** | Login, role landing, Team admin, `admin-users` function | • The three test accounts each land on the right screen.<br>• Reset shows the new password exactly once.<br>• A deactivated user is signed out and gets nothing back from the database.<br>• The system will not allow the last admin to be removed. |
| **P4 RFQ milestone** (early use) | Companies, intake and float, RFQ board and detail, reply capture, clarifications, attachments, Today v1, search v1, **backups live** | • The scripted intake-and-float scenario takes ≤ 15 interactions (Playwright).<br>• The owner's timed run takes ≤ 30 s.<br>• The collision line renders from real records.<br>• A nightly encrypted backup and one successful restore drill exist.<br>• Real users are invited to try it. |
| **P5 Orders** | Convert RFQ to order, WhatsApp order, repeat order, procurement legs, commissioning, Today v2 | • "Same as last year" creates an order in ≤ 3 interactions after picking the source order.<br>• The goods and commissioning statuses come from the views.<br>• The convert and repeat functions survive a double submit with no duplicate. |
| **P6 Money** | Invoices and GST register, payments, expenses, costs and margin, cash month, targets, reconciliation, Today v3 | • The net-portion test cases pass.<br>• Each role sees exactly what §10 allows, checked in the UI and by Playwright per role.<br>• `my_target_progress()` shows on the Today tile. |
| **P7 Hardening** | Reports, search v2, end-to-end runs for three roles, performance and accessibility pass | • End-to-end journeys are green for all three roles.<br>• The Lighthouse accessibility score is ≥ 95 on key screens.<br>• The CSP allows only the new Supabase host. |
| **P8 Import + cutover** | Import track (starts after P1; only the live-data tasks wait), dry runs, owner review lists, cutover | • Two consecutive dry runs are clean.<br>• Row counts and money totals reconcile.<br>• The owner signs the review lists and the cutover checklist.<br>• The old project is frozen and archived. |

**Challenged and changed from the suggested order:**
- UI primitives run **in parallel** with the schema work.
- Accounts move **after** the primitives, because the Team screen needs Dialog, Form and DataTable.
- Today and search grow in each phase.
- The import framework starts right after P1, as a parallel track.
- Backups are a **P4 exit gate**, because the milestone may hold real data (open question Q1).

---

## 3. Task breakdown

**Legend:**
- **∥** = can run in parallel with the other tasks in the same group letter.
- **OWNER** = needs the owner to act or decide.
- **DUMP / LIVE** = needs the live dump, or the owner's admin session on the old project.
- **Model §** refers to the approved data model and Revision 1.

### P0 Foundation

| ID | Goal → deliverable | Inputs | Acceptance | Deps | ∥ | Flag |
|---|---|---|---|---|---|---|
| F01 | Parent repo ignores v2: changes to `.gitignore`, `eslint.config.js`, `vitest.config.ts` | Parent configs | With a dummy file in v2, parent `git status` is clean. Parent lint and test counts are unchanged. | — | a | OWNER commits (parent repo on branch `phase0/stabilise`) |
| F02 | Scaffold v2: Vite, React 18, TS strict, Tailwind, shadcn subset, TanStack Query 5, RHF, Zod, supabase-js, Vitest, ESLint, `.nvmrc` 20, `git init` | Old `package.json` for versions | `npm ci && npm run lint typecheck test build` passes. No dependency outside the 6 primitives' needs. | — | a | |
| F03 | GitHub private repo, `ci.yml` (shape copied from old CI, `--max-warnings=0`) | Old `.github/workflows/ci.yml` | First PR shows green CI on a clean clone. | F02 | | OWNER creates the repo and grants access |
| F04 | Create the Supabase project (free plan). Auth: signups off, email confirmations off, no SMTP. | — | Project reference, anon key and URL are recorded in `.env.local` (gitignored). Service role key and access token go to GitHub secrets (pending Q2). | — | a | OWNER (region: recommend Mumbai, ap-south-1) |
| F05 | `supabase init`, `config.toml` matching F04 settings, project link | F04 | `supabase db diff --linked` shows no drift on an empty project. | F02, F04 | | |
| F06 | `db.yml`: start a local stack on the runner, reset, `db lint`, `test db`, generate types and diff them | — | Green on a trivial migration. A deliberately broken migration in a test PR fails the job (screenshot in the PR). **Validates the Docker-on-runner assumption.** | F03, F05 | | |
| F07 | Brand: copy `1.png` and `2.png` into `public/brand/`. Extract exact hex values (pixel sampling script, kept out of the bundle). Write `docs/BRAND.md` and Tailwind tokens (green, deep green, black, white, grey). Favicon set from the square mark. | Logo paths from the coordinator | Hex values are documented. WCAG contrast table: green on white for text and for buttons; if a pair fails AA, use the darker green for text. Favicon renders. | F02 | a | |
| F08 | Copy the vetted libraries with provenance headers and their tests: `dates.ts`, `csvExport.ts`, `imageCompress.ts`, `gst/fbr.ts` (rewritten to the new derived FBR state), ErrorBoundary, `vercel.json` headers (CSP pointed at the new Supabase host) | Old `src/lib/*`, `vercel.json` | Copied tests pass. `fbr.ts` takes `tax_deposited_on` instead of `fbr_status`. | F02 | a | |
| F09 | `docs/DATA_MODEL.md`: merge the original model and Revision 1 into one frozen document. `DECISIONS.md` index. | Coordinator supplies both texts | No section is contradicted by Revision 1. Section numbers are kept, so tasks can cite them. | F02 | a | |
| F10 | Vercel project linked to the v2 repo: preview and production, env vars, headers | F08 | securityheaders.com grade A on the preview. Login page loads. | F03, F08 | | OWNER (Vercel access) |

### P1 Schema and access

All tasks share these rules:
- A migration plus pgTAP tests ship in the same PR.
- Role simulation in tests uses `set local role authenticated` with `request.jwt.claims` set to the fixture user ids from `seed.sql`.

| ID | Deliverable | Model § | Acceptance | Deps | ∥ |
|---|---|---|---|---|---|
| S01 | Helpers: `current_user_role()` (returns NULL if deactivated or unknown), `today_pkt()`, `set_updated_at()`, `audit_log` table and generic audit trigger function | 2.22, 4 | Tests: the role function returns NULL for deactivated users. `today_pkt()` gives the right date at 23:30 UTC. `audit_log` has no client grants. | F06 | |
| S02 | `users` plus RLS; `seed.sql` with auth fixtures (admin, sales, engineer, deactivated) | 2.1, §10 | Every role can read. All client writes are denied. | S01 | |
| S03 | companies, company_sites, contacts, brands, company_brands; unique indexes; RLS | 2.2–2.6 | Case-insensitive duplicate name is rejected. Matrix rows pass. | S02 | b |
| S04 | rfqs, rfq_items, supplier_inquiries, supplier_quote_lines (currency has no default; brand auto-learn trigger), clarifications; CHECKs; RLS including "staff may delete an inquiry only while `sent_on` is empty" | 2.7–2.11 | A quote line without currency is rejected. The trigger upserts company_brands. A sales user can't delete a sent inquiry. The answer/answered_at pair CHECK holds. | S03 | |
| S05 | orders, order_items, supplier_orders, order_engineers, order_costs; legacy escape CHECKs; RLS | 2.12–2.15, R1 §2.12a | `ordered_on` is NULL only with the `undated` flag. Engineer gets 0 rows from order_costs. Deleting an order is blocked by attached money (tested after S06). | S04 | |
| S06 | invoices, payments_in (credited-user trigger), expenses, recurring_expenses; RLS | 2.16–2.19, R1 §2.17 | `credited_user_id` defaults to the order owner. Engineer gets 0 rows. Sales can read and write invoices but can't see payments. | S05 | |
| S07 | targets plus RLS (admin writes; others read only their own row) | R1 §2.23 | Sales sees only their own row. Duplicate (user, year, quarter) is rejected. | S02 | b |
| S08 | attachments, the `rfq-files` and `gst-receipts` buckets, storage policies | 2.20 | Parent-exactly-one CHECK holds. Engineer can't read the gst bucket. Files over 5 MB are rejected by the bucket limit. | S04, S06 | |
| S09 | Attach audit triggers to every business table | 2.22 | Insert, update and delete each write one audit row with `changed_by`. | S06, S07, S08 | |
| S10 | Non-money views (security invoker): v_company_roles, v_rfq_state, v_inquiry_state, v_order_state (role-aware "done"), v_invoice_state, v_gst_register | §5, R1 §5 | Fixture rows cover every state value in §5. The FBR state follows the furthest-step rule, including the `fbr_generated_legacy` flag. | S09 | c |
| S11 | Money views with an explicit admin check: v_payment_net, v_order_money, v_cash_month, v_target_progress | R1 §5, §5a | Net-portion cases: invoiced vs items, partly exempt, fully exempt (ratio 1), `basis_unknown` excluded, G = 0, unattributed. **A non-admin gets 0 rows, never wrong totals.** | S09 | c |
| S12 | Definer functions `order_receivables()` and `my_target_progress()` (fixed search_path, grants) | R1 §5b, §10 | Engineer is refused `order_receivables`. `my_target_progress` returns only the caller's row. Quarter boundaries are correct at 00:30 PKT on 1 Apr. Deactivated users get nothing. **S12 also creates `snoozes`** (DATA_MODEL §2.21, migration 0017, own-row RLS, audit trigger; no earlier task did). | S11 | |
| S13 | RPCs: `convert_rfq_to_order`, `create_repeat_order`, `merge_companies`, `merge_brands`, `resolve_value_basis`, and **`float_rfq`** (atomic: create RFQ, items and inquiries, then stamp `sent_on`; PROPOSED, no schema change) | §4, R1 §4 | A second call with the same client-generated id returns the same order. Merge moves every foreign key. Resolving to gross divides prices by 1 + rate. | S10 | |
| S14 | Access-matrix test: §10 encoded once as data; every (table, role, op) plus anonymous is asserted | R1 §10 | Matrix data reviewed line by line against §10. All assertions pass. | S13, S12 | |
| S15 | Push to the remote project through the protected `remote.yml` job; parity check; schema drift check; remote types as reference | — | `migration list` matches; schema drift = none; remote types artifact for reference. | S14 | | 
| S16 | Port the remote smoke suite: reachability pre-flight (an unreachable project must FAIL), anonymous denial on all 24 tables, three-role read checks; run nightly | Old `rls.integration.test.ts` | Fails when given a placeholder URL. Green against the remote project. | S15, A05 | |

S15 is OWNER-gated (secrets, Q2).

### P2 UI primitives

Runs after F02 and F07, in parallel with P1.

| ID | Deliverable | Acceptance | Deps | ∥ |
|---|---|---|---|---|
| U01 | Tokens: light theme, brand green only for primary action and active state, mono plus `tabular-nums` utility, hairline dividers. Lint bans `text-[…]` and raw `<table>` in `features/**`. | Lint fails on a planted violation. | F07 | |
| U02 | Page shell: 6-item nav filtered by role (Today, RFQs, Orders, Companies, Money, Reports), ErrorBoundary, routing, role landing (adapted from old `roleRoutes`/`navConfig`) | An engineer never sees Money. Snapshot of the nav per role. | U01 | d |
| U03 | Dialog: one wrapper (Radix), focus trap, aria labels, Esc and close return focus | axe check is clean. Keyboard test. | U01 | d |
| U04 | DataTable: dense, sortable, keyboard row navigation, empty-state slot ("goal state" text), CSV export through `csvExport` | 1,000 rows render in under 100 ms (virtualised if needed). CSV formula-injection test passes. | U01 | d |
| U05 | Status module: one registry (dimension → value → label, tone) fed by view outputs, plus StatusBadge | Every §5 value has an entry. A unit test fails on an unknown value. | U01 | d |
| U06 | Money: net / GST / gross rendering, PKR grouping, foreign-currency variant, "provisional" and "basis unknown" marks, mono tabular figures | Snapshot tests. Never shows a margin without the provisional mark when costs aren't complete. | U01 | d |
| U07 | Form: RHF + Zod; submit guard (disabled while pending plus client-generated id); maps Postgres errors 23505 / 23503 / 23514 to plain messages | Double-click test produces one request. Unique-violation message is shown. | U01 | d |
| U08 | ⌘K palette shell (cmdk) with pluggable sources | Opens with ⌘K and Ctrl+K. Keyboard-only use works. | U03 | |
| U09 | `/dev/gallery` route (dev builds only) showing every primitive and state, plus a Playwright axe run | Zero axe violations. | U02–U08 | |

### P3 Accounts

| ID | Deliverable | Acceptance | Deps | ∥ | Flag |
|---|---|---|---|---|---|
| A01 | `admin-users` Edge Function: create, reset_password (generated, returned once), set_role, deactivate (ban plus `signOut`), reactivate, list (with emails). Admin check runs on the server. CORS allow-list. Last-admin guard. Adapted from old `create-user`. | Deno tests. Integration test in CI with `functions serve`: a non-admin gets 403, and the last admin can't be demoted. `admin-users` writes an `audit_log` row for each create, set_role, deactivate, reactivate and reset_password, with the acting admin as `changed_by` (never the password). | S02 | e | |
| A02 | First-admin bootstrap script (service role, run locally) plus runbook entry | Creates the auth user and users row. Refuses if an admin already exists. | S02 | e | |
| A03 | Login, session, role resolution through TanStack Query, deactivated user forced out, role landing | Playwright: all three test users land correctly. A deactivated user is signed out on the next request. | U02, S02 | | |
| A04 | Team screen: list, create (password shown once, copy button), reset, change role, deactivate or reactivate | Playwright as admin. Sales and engineer get 404 or redirect. | A01, A03, U03, U04, U07 | | |
| A05 | Create test admin, sales and engineer accounts on the remote project. Store credentials in GitHub secrets and `.env.test.local`. | The S16 smoke test logs in as each. | A02, S15 | | OWNER (secrets) |

### P4 RFQ milestone

| ID | Deliverable | Acceptance | Deps | ∥ |
|---|---|---|---|---|
| R01 | Data-layer conventions: query-key factory, typed hooks per view, invalidation map; reference implementation on companies | Documented in `src/features/README.md`. No React context holds server state (lint rule or review). | U07, S10 | |
| R02 | Companies: list, detail (sites, contacts, brands carried, history placeholder), inline create used by intake, admin merge | Inline create from intake in 1 dialog. Merge moves RFQs (end-to-end test). | R01 | f |
| R03 | Supplier suggestion: a pure function that turns items (brand, family) and history into ranked suppliers, each with **a plain reason, never a score**. Only "supplied this before" is pre-ticked. | Unit tests per reason type. No numeric score is exposed. | R01 | f |
| R04 | Enquiry-draft generator (pure): one text for every ticked supplier. Lists item, qty, unit, spec. Asks for unit price + currency, lead time, origin/authenticity, stock, MOQ/validity/payment terms. Reply-by = due − 3 days (never earlier than tomorrow). `Spec:` left blank when unknown. Email and WhatsApp formatting variants. | Snapshot tests. A test asserts the generator **never** writes text into Spec that wasn't in the item. | — | f |
| R05 | Intake = float screen: company, site, contact, customer ref, due date, items (multi-line paste becomes rows), suggestions, draft, **"Copy & mark floated to N"** (copies to clipboard, calls `float_rfq`), 10-second undo (sets `sent_on` back to NULL, which is an allowed update) | Playwright canonical scenario: ≤ 15 interactions. Undo restores the "shortlisted" state. Works with no suppliers ticked (save only). | R02, R03, R04, S13 | |
| R06 | RFQ board: sorted by due date and priority, owner filter, state columns from v_rfq_state | Status values come only from the U05 registry. | R01 | f |
| R07 | RFQ detail: items; one inline row per supplier for reply capture (price + currency defaulting to the supplier's last currency, else a country map; lead time; stock); one-click "can't quote" reasons (`no_offer_on` plus a fixed phrase in notes); lowest price per item marked; coverage (uncovered items); mark bid sent; close with reason | No modal for reply capture. Currency is always explicit. An "uncovered item" fixture is shown. | R06 | |
| R08 | Paste-to-parse for supplier replies: offers price, currency and lead time for the engineer to accept; never commits on its own | Unit tests on 10 or more sample replies (USD/CNY/EUR, "ex-stock", "4–6 weeks"). | R07 | g |
| R09 | Clarifications panel: paste splits into questions (tagged by supplier); "Copy questions for customer" stamps asked times; answer entry plus image; "Copy answers for supplier X" stamps `last_relayed_at`; withdraw | End-to-end run of the staged-answer flow. The collision-line data is correct. | R07, R10 | |
| R10 | Attachments: upload to `rfq-files` (compression, 5 MB, mime list), viewer, delete | A 6 MB file is refused. A HEIC file is accepted. | R07 | g |
| R11 | Today v1: rules as pure functions over view rows (chase customer, relay answers, not floated, chase supplier, bid due, decision overdue), minus snoozes, routed to the RFQ owner; collision line; snooze (own rows) | Unit test per rule. The empty state reads as the goal state. Snoozed items disappear until their date. `snoozes` itself is created by S12 (migration 0017, with its audit trigger and RLS), so R11 only reads and writes it. | R09, U05 | |
| R12 | Search v1: companies, contacts, RFQ numbers, customer refs | Results in under 300 ms on 1,000 rows. Role-safe. | U08, R02 | g |
| R13 | **Backups live (§6)**: nightly encrypted dump plus storage sync; weekly restore drill into the CI stack | One artifact exists. A drill restores it and the row counts match. | S15 | g |
| R14 | Milestone release to the v2 production URL; real trial accounts; one-page guide | The owner confirms the trial has started. Feedback on the draft test is collected (see below). | R05–R13 | |

R13 is OWNER-gated (Q2). R14 needs OWNER input: names and emails.

The draft test after the trial: if engineers paste the draft and edit only Qty and Spec, keep it. If they rewrite the body, remove the draft feature rather than tune it.

### P5 Orders

| ID | Deliverable | Acceptance | Deps | ∥ |
|---|---|---|---|---|
| O01 | Convert RFQ to order: supplier per item pre-filled from the lowest quote; items grouped into legs; calls `convert_rfq_to_order` | Double submit gives one order. Legs are grouped by supplier. | R07 | h |
| O02 | WhatsApp order (no RFQ) and repeat order: find past orders by company, site or item text, then `create_repeat_order` | ≤ 3 interactions after choosing the source order. | R02 | h |
| O03 | Order detail: items (GST rate per line, exempt-all toggle, service flag), legs (placed, expected, received, delivered, reference), commissioning (needs it, engineers, planned, done), cancel | Status badges come from v_order_state. Engineer can edit commissioning fields. | O01 | |
| O04 | Orders list with filters per dimension | Filter combinations, end-to-end. | O03 | i |
| O05 | Today v2 rules: place PO, goods late, plan commissioning, delivered but not invoiced (admin and sales) | Unit tests. Engineer doesn't see the invoicing rule. | O03, R11 | i |
| O06 | Company history per site (orders and RFQs) | Ghani KHI and LHR are shown separately under one company. | O03 | i |

### P6 Money

| ID | Deliverable | Acceptance | Deps | ∥ |
|---|---|---|---|---|
| M01 | Invoices and GST register (admin and sales): create from an order (net and GST pre-filled), TCS track, FBR track, receipt upload to `gst-receipts` | The FBR state is derived. `needsFbrAttention` is ported and its tests pass. | O03 | j |
| M02 | Payments in (admin) plus receivables through `order_receivables()` (admin and sales) | Settled is computed against gross. Sales sees balances but no payment rows. | O03 | j |
| M03 | Expenses (admin): tag to order, leg and payee; category suggestions mapped to procurement / commissioning / overhead; recurring templates with "due this month" | Recurring due item appears in Today v3. | O03 | j |
| M04 | Order costs and margin panel (admin): expected cost, mark costs complete, v_order_money with Money marks | Provisional mark shown until complete. A `basis_unknown` order is excluded and labelled. | M03 | |
| M05 | Cash-month report (admin) and GST register report (admin and sales), CSV export | Gross, GST and net columns. The unresolved-net row is shown. | M02, M03 | k |
| M06 | Targets: admin grid (user × quarter); Today tile from `my_target_progress()` (behind pace, days left; **a tile, not a task**) | Engineer sees only their own tile, and no money tables are fetched (network log assertion). | M02, S12 | k |
| M07 | Reconciliation ported to the new views; admin exceptions panel | Old test cases adapted and passing. | M04 | k |
| M08 | Today v3 money rules: payment overdue (to owner if sales, else admin), costs incomplete, FBR attention, TCS not sent, recurring due | Unit tests on routing per role. | M01–M04 | |

M06 is OWNER-gated: the owner enters the target values.

### P7 Hardening

| ID | Deliverable | Acceptance | Deps | ∥ | Flag |
|---|---|---|---|---|---|
| P01 | Reports (3–4, all from views): RFQ outcomes by close reason, float coverage and conversion, clarification turnaround, repeat customers | Each report matches a hand-computed fixture. | R11, O04 | l | OWNER (light: confirm the report list) |
| P02 | Search v2: PO numbers, invoice numbers (invoice numbers hidden from engineers) | Role test. | M01, R12 | l | |
| P03 | Playwright journeys for the three roles on the CI stack | Green in `db.yml`. *(A6: also asserts the A6 tap targets and the keyboard-only 5-row burst entry; see Amendment A6.)* | M08 | l | |
| P04 | Performance and accessibility pass; CSP tightened; bundle budget | Lighthouse accessibility ≥ 95; initial JS ≤ 300 KB gzip. | P03 | | |

### P8 Import and cutover

I01–I05 start after S06 and run in parallel with P2–P7.

| ID | Deliverable | Acceptance | Deps | ∥ | Flag |
|---|---|---|---|---|---|
| I01 | Import framework (Node TS):<br>• **extract**: old project REST API with an admin session, or the dump<br>• **transform**: pure functions<br>• **load**: service role, deterministic UUIDv5 from old ids; idempotent: delete only rows with a legacy source, reinsert; never touches rows created in v2; companies matched by normalised name<br>• **report**: counts, totals, review CSVs<br>Fixtures built from `seed_historical_data.sql`. | A run against the fixtures twice gives identical ids and counts. Rows created in v2 survive. | S06 | m | |
| I02 | Transforms: companies, sites, contacts, prospects, vendors (driven by the reviewed `mappings/company_merge.csv` and `vendor_parse.csv`) | Ghani's 3 rows become 1 company with 2 sites. "Red Lion USA (via Four Stars)" becomes Four Stars carrying Red Lion. | I01 | m | |
| I03 | Transforms: RFQs (due-date parse, flags, owner reliability), items, inquiries, quote lines (`item_guessed`, `currency_unverified`) | The "31/01/2024" fixture gets the `due_before_received` flag. | I01 | m | |
| I04 | Transforms: orders → items, legs, order_costs; basis resolution against GST invoices; **merge PO 000001 Unit A/B into one order with 2 invoices**; batch A/B kept separate; other flags | 17 seed orders become 16 orders. Invoice totals reconcile. | I01 | m | |
| I05 | Transforms: invoices (from gst_invoices, bookkeeping invoices, `orders.invoice_number`), payments (credited user), expenses (supplier_payments, payable_payments, double-count flag), recurring, order_engineers, storage file copy, `fbr_status` mapping | Money totals: old Σ equals new Σ, per category, on the fixtures. | I01 | m | |
| I06 | §8 assumption checklist (22 items) answered from the dump's schema and from queries | Every item marked confirmed, or adjusted with a linked fix. | I01 | | **DUMP**, OWNER runs |
| I07 | Dry run 1 against live data into the new project; review CSVs produced: company merges, vendor parse, PO clashes, RFQs quoted more than 180 days ago, possible duplicates with trial RFQs, FBR mismatches, possible cost double counts, basis unknown, unparseable dates | Report reconciles row counts per table and Σ money in and out. | I02–I06 | | **LIVE**, OWNER runs the extraction |
| I08 | Owner reviews the lists; mappings committed (names only, no contact data) | Owner sign-off recorded in `docs/`. | I07 | | OWNER |
| I09 | Dry run 2 (and more as needed) until two runs in a row are clean | No new review items. Totals unchanged. | I08 | | LIVE |
| I10 | Cutover rehearsal plus runbook (§5) | A timed rehearsal under 2 hours. | I09, P04 | | OWNER |
| I11 | Cutover | §5 checklist complete. | I10, Q3 | | OWNER |

---

## 4. Testing strategy

| Layer | Where | What | Gate |
|---|---|---|---|
| Unit | CI (`ci.yml`) | Rules, draft generator, parsers, suggestion ranking, status registry, Money/Form primitives, import transforms on fixtures, copied libraries | Every PR |
| Database | CI (`db.yml`): temporary Supabase on the GitHub runner | Migrations from zero (`db reset`), `db lint`, pgTAP for constraints, triggers, views, RPCs and definer functions, the **access matrix** (24 tables × admin/sales/engineer × S/I/U/D, plus anonymous), and a type-drift diff | Every PR |
| Edge function | CI: Deno tests plus `functions serve` on the CI stack | Admin gate, last-admin guard, password shown once | Every PR touching functions |
| End-to-end | CI: CI stack seeded from `seed.sql` + `vite preview` + Playwright | Journeys for the three roles; intake interaction count; "money never fetched" network assertion for engineers | Every PR from P4 on |
| Remote | `remote.yml` (manual, protected) and `nightly.yml` | Pre-cutover: migration parity, reachability pre-flight, anonymous denial, three-role reads plus write smoke on rows tagged as test. **Post-cutover: parity, pre-flight, anonymous denial only.** Test accounts are deactivated at cutover so they never appear in pickers or targets; write-path RLS is proven only on the CI stack. | Nightly + every push to remote |
| Restore drill | `nightly.yml`, weekly | Decrypt the latest backup, restore into the CI stack, compare row counts | Weekly |
| Manual | Owner on the Vercel preview or production | Acceptance per phase; timed intake run | Phase exit |

**How roles are tested:**
- On the CI stack, by setting JWT claims for the fixture users in pgTAP. This covers every operation, including writes.
- On the remote project, by logging in with the three test accounts. This happens only before cutover.

**How "migrations apply from zero" is proven:** `db reset` on every PR, and parity with the remote project nightly.

**The free plan needs no staging project,** because the CI stack is staging. If the old project is deleted after the archive window, the freed slot can optionally host a remote staging project (§5).

---

## 5. Data import and cutover

**Import approach** (I01–I05):
- Pure transforms, deterministic UUIDv5 ids, review lists as CSV.
- **Additive and idempotent:** each run deletes and reinserts only rows that carry a legacy source, in reverse foreign-key order, and never touches rows created in v2. This matters because the milestone trial may already hold real RFQs (Q1).
- Audit rows written during an import are removed afterwards by a service-role cleanup step, so the history isn't flooded.
- Raw extracted data lives only in the gitignored `import/.data/`.
- Extraction runs on the owner's machine, with his admin session or dump. No credentials enter the repo or CI.

**Sequence:**

| When | Step |
|---|---|
| T-21 | The owner provides the dump (**DUMP**). I06 checklist. Dry run 1. Review CSVs to the owner. |
| T-14 | The owner returns the reviewed lists: company merges, vendor parse, PO clashes (000001 is already decided), bulk close of stale RFQs with a default reason, FBR mismatches, possible duplicates of trial RFQs. Dry run 2. |
| T-7 | Dry run 3 must equal dry run 2 (two clean runs in a row). Rehearse the runbook. Create real staff accounts (names and emails from the owner). Train people at a desk, in person; passwords are handed over in person. |
| T-0 | 1. Announce the freeze.<br>2. **Freeze the old project:** the owner runs, in the SQL editor, a statement revoking INSERT, UPDATE and DELETE on all public tables from `authenticated`. Reversible with GRANT.<br>3. The owner takes the final `pg_dump` and downloads the storage files. These two are the **permanent archive**; store them in 2 places.<br>4. Final import.<br>5. Verification report: counts, Σ payments in, Σ expenses, Σ invoices net and GST, open receivables, spot-check of the 17 seed orders.<br>6. The owner signs off.<br>7. Point the `qtech-crm.vercel.app` alias at the v2 Vercel project; update the Edge Function's `ALLOWED_ORIGINS`.<br>8. Deactivate the test accounts. |
| T+0…T+3 | **Rollback window.** Re-grant writes on the old project and point the alias back. Anything entered in v2 during the window is re-keyed by hand, which is why the window is kept short. After T+3: fix forward only. |
| T+90 | The old project is frozen and pauses itself after 7 days idle (expected; **ASSUMPTION:** paused free projects can be restored for 90 days). After the owner verifies the archive is complete, he deletes the old project. The free slot can optionally become a remote staging project. |

The free tier's two-project limit is respected throughout: old (frozen) plus new, and never a third.

**LIVE-dependency risk:** the old project may itself be paused when we need to extract. The owner restores it from the dashboard before each dry run.

---

## 6. Backups and the free-tier pause

| Option | Cost | Restore quality | Off-platform copy | Notes |
|---|---|---|---|---|
| a. Supabase Pro | US$25/month | Daily backups kept 7 days, restorable from the dashboard; no pausing | No | Removes the pause risk entirely. |
| b. Nightly GitHub Action: `supabase db dump` (schema + data) plus storage sync, **encrypted with age** to the owner's key and a CI drill key; kept as a 90-day artifact, copied weekly to a private backup repo or the owner's Drive | Free | Full, proven by the weekly drill | Yes | Needs the DB URL as a GitHub secret (Q2). Also keeps the project awake. |
| c. Owner's PC, Windows Task Scheduler, same dump to OneDrive | Free | Full | Yes | The password stays local, but the PC must be on. No automatic drill. |
| d. Admin CSV export of money tables each month | Free | **Not a restore**; human-readable only | Yes | Useful for the tax agent regardless. |

**Recommendation:**
- **(b) from the P4 milestone onward.** It becomes mandatory as soon as real data exists.
- **Plus (a) at go-live.** The CRM is the company's only bookkeeping record. US$25 a month buys freedom from pausing and dashboard restores.
- Keep (b) after go-live as the off-platform copy.
- (d) can be added as a convenience.
- **If the owner refuses to put any credentials in GitHub, use (c) and accept manual drills.**
- **Pause:** during the build, the nightly smoke test (a real query) keeps the project active. **ASSUMPTION:** API activity counts as activity for pausing. Verify this in the first week by watching the dashboard.

---

## 7. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R1 | `supabase start` fails on GitHub runners (resources, image pulls) | Low / high | F06 proves it first. Fallback: `supabase db start` (Postgres only) plus a small auth-schema stub for `auth.uid()`; Playwright then runs against preview deploys before cutover only. |
| R2 | Phantom dependencies from the parent folder | Medium / medium | Clean-clone CI, ESLint rule, `typeRoots`. |
| R3 | Real trial data on the free plan with no backups | Medium / high | R13 is a P4 exit gate. If Q1 = practice data, the gate moves to go-live. |
| R4 | The intake-draft hypothesis fails | Medium / low | A falsifiable test is defined; the cut path is cheap (it's a pure function plus one panel). |
| R5 | Live data is messier than the seed suggests (the dump comes late) | High / medium | The import is isolated, review lists are bounded, and flags are used instead of guesses. Cutover has no deadline. |
| R6 | Owner review bandwidth (lists, accounts, secrets) | Medium / medium | OWNER tasks are batched per phase. Nothing else waits on them except S15/A05/R13/R14/I-series. |
| R7 | Remote and repo drift through dashboard edits | Low / high | Nightly parity check; runbook rule "no schema changes in the dashboard". |
| R8 | Time-zone bugs at day or quarter edges | Medium / medium | `today_pkt()` in SQL, `dates.ts` in the client; boundary tests in S12 and the rules. |
| R9 | Free limits (500 MB DB, 1 GB storage) | Low / medium | Image compression, 5 MB cap; storage usage shown on the admin page (later). |
| R10 | Old project paused or unavailable during extraction | Medium / low | The owner restores it before each dry run. The dump is the second source. |

---

## 8. Open questions (only those that block)

**Q1. Is the P4 trial on real RFQs (kept) or practice data (wiped)?**
- This blocks the R13 gate and the import's additive design.
- (a) **Real and kept.** The import merges into it, and backups are live before the trial.
- (b) Practice data, wiped before import. Simpler, but it can't test whether the system does real work.
- **Recommendation: (a).** **FACT:** no RFQ has been entered in the old app since 28 Aug, so double entry is unlikely. The import already handles it via the duplicate-RFQ review list.

**Q2. Where do the new project's credentials live** (DB URL, service role key, access token for `db push`, the parity check, backup option b)?
- This blocks F04, S15, A05 and R13.
- (a) **GitHub Actions secrets in a protected environment** (the owner approves each production push).
- (b) Owner's machine only: manual pushes, backup option (c).
- **Recommendation: (a).** The owner's rule about not sharing his DB password concerned the old project. This is a new, purpose-made secret, and it can be rotated at cutover.

**Q3. Pro or export before go-live?** The owner already plans to decide this.
- It is listed only as a **go-live gate**. It blocks I11, not the build.
- **Recommendation:** Pro plus option (b).

Everything else has defaults: Supabase region (Mumbai), the report list (P01), and the domain (move the existing alias).

---

### Critical files for implementation
- old CRM repo: src/test/rls.integration.test.ts
- old CRM repo: .github/workflows/ci.yml
- old CRM repo: supabase/functions/create-user/index.ts
- old CRM repo: supabase/migrations/seed_historical_data.sql
- old CRM repo: src/lib/dates.ts

---

# Amendment A1 — Design direction (approved by owner 2026-10-13)

> Correction (orchestrator): lucide is NOT yet installed in qtech-crm-v2 (F08 finding). D01 specifies the icon set; U01 installs it.

# Build plan amendment: design direction and frontend quality

The new design phase (PD) sits between P0 and P2. The owner signs off the look on mockups at two review gates before any primitive is built. The schema phase (P1) and the import track never wait for it. Each block below says which section of the build plan it replaces or extends.

## §0: add choice 4

> 4. **Design comes before code.** No UI code is written until the owner has approved the mockups (PD). Every frontend task invokes the `frontend-design:frontend-design` skill before writing code. The target feel is calm, precise and refined, in the spirit of Linear, the Stripe dashboard and the Vercel dashboard. The density stays, but it has to look deliberate and polished. No default shadcn look, and none of the old app's glass or glow.

## §1 Folder structure: add under `qtech-crm-v2/docs/`

```
    docs/
      DESIGN_SYSTEM.md        ← the spec P2 implements (written in PD, frozen at gate G2)
      design/
        tokens.css            ← SINGLE source of design tokens (CSS custom properties)
        mockups/*.html        ← source of every approved artifact (self-contained, imports ../tokens.css)
        screens/*.png         ← approved reference screenshots, desktop 1440 + mobile 375 where specified
        ARTIFACTS.md          ← artifact link, version and approval date per screen
```

**How tokens get into the code:**
- The design tasks write `docs/design/tokens.css` and never touch `src/`.
- **U01** copies those tokens into `src/index.css` and maps them in `tailwind.config.ts`.
- A CI token-parity script fails the build if any token value in `src/index.css` differs from `docs/design/tokens.css`.
- So the code has exactly one source for tokens, and the designers never edit code.

**Webfont:** if the design adds one, **self-host it** (e.g. `@fontsource`, a Latin subset, `font-display: swap`). Then the CSP keeps `font-src 'self'` and there is no third-party host to allow. This touches F08 and P04.

## §2 Phases: insert a row between P0 and P2, and amend P2

| Phase | Goal | Exit criteria |
|---|---|---|
| **PD Design direction** | The owner approves the visual direction and the high-fidelity mockups of the key screens. | Both gates are passed: G1 (direction) and G2 (all screens). Approval is recorded in `docs/DECISIONS.md`. Every approved artifact has its HTML source committed. `DESIGN_SYSTEM.md` is frozen. |
| P2 UI primitives (amended) | Build the approved system exactly. | Exit criteria as before, plus: the gallery matches the mockups side by side, and visual-regression baselines are committed. |

## §3: new task group, PD Design direction

**Rules that apply to every D task:**

1. **Invoke the skills first.** Invoke `frontend-design:frontend-design` and the `artifact-design` skill before designing anything.
2. **Publish as a Claude Design artifact.** The owner must be able to view it and comment from any device.
3. **Commit the source.** The HTML/CSS goes to `docs/design/mockups/`; the link and version go to `ARTIFACTS.md`.
4. **Data is realistic but fictionalised.** Use instrumentation brands, PKR amounts, PO and part numbers, and the shapes of the seed data. **Do not use real customer names** in artifacts that may be visible by link (see risk D-R4).
5. **Brand inputs are fixed:**
   - deep green **#1a7b46** for primary actions and text
   - brand green **#429446** for non-text only (focus, active state, logo)
   - teal for success
   - light theme by default
   - 4px radius
   - monospace with tabular figures for all numbers and identifiers
6. **What the designer may refine:** neutrals, the type scale, and a single webfont.

| ID | Deliverable | Acceptance | Deps | ∥ |
|---|---|---|---|---|
| D01 | **Design system spec.** `DESIGN_SYSTEM.md` and `tokens.css` covering:<br>• type scale (sizes, weights, line heights; mono and tabular rules)<br>• 4px spacing rhythm<br>• elevation (hairlines first; at most 2 shadow levels, used only for overlays)<br>• neutral ramp<br>• semantic tones for **every §5 status value**<br>• focus ring<br>• motion (durations, easing; transform and opacity only; honours `prefers-reduced-motion`)<br>• icons: **lucide** (already a dependency), one stroke width, defined sizes<br>• density: one default; DataTable also gets a compact mode<br>A spec-sheet artifact shows all of it. | • Contrast table: every text/background pair meets WCAG AA.<br>• The fixed brand inputs are honoured.<br>• Every status value in the U05 registry has a tone.<br>• No token is left unused or duplicated. | F07, F09 | a |
| D02 | **Today, in two alternative directions.** Both stay within D01, so the owner chooses rather than iterates from scratch. Each shows:<br>• populated, with the clarification collision line and the target tile<br>• empty (the goal state)<br>• loading (skeleton)<br>• error<br>• mobile at 375px | All 5 states in both directions. The collision line reads cleanly at 1440 and at 375. | D01 | a* |
| **G1** | **Owner gate: direction.** The owner comments on D01 and D02 and picks one direction. At most 2 iteration rounds. | Approval quote, date and artifact versions recorded in `DECISIONS.md`. | D01, D02 | — |
| D03 | **Intake and float, the 30-second flow,** as a storyboard. Frames:<br>• empty<br>• company typed (with the inline create)<br>• items pasted and split into rows<br>• suggestions with plain reasons; only "supplied before" is ticked<br>• the draft, with `Spec:` visibly left blank<br>• "Copy & mark floated to N" with the 10-second undo toast | • The interaction count is annotated and comes to ≤ 15.<br>• No numeric scores anywhere. | G1 | b |
| D04 | **RFQ detail.** Shows:<br>• items with coverage (uncovered item flagged)<br>• inline supplier reply rows (price, currency, lead time, stock), lowest price marked, "can't quote" reasons<br>• clarifications panel (to ask / asked / answered / relay pending), an answer with an image attachment<br>• bid and close actions<br>States: empty, loading, error. Mobile at 375px. | • Reply capture has no modal.<br>• All 3 states are shown.<br>• Mobile layout is usable: one column, sticky actions. | G1 | b |
| D05 | **Order detail with its status dimensions.** Shows items with GST per line, procurement legs, commissioning, and each dimension's badges. Two role variants: admin (with the margin panel) and engineer (no money shown anywhere). | The engineer variant contains no money figure apart from sale and supplier prices (per Revision 1 §10). | G1 | b |
| D06 | **Money / GST register (admin).** Shows the register table with the TCS and FBR tracks, receivables, the cash-month summary, and the margin panel with the provisional and basis-unknown marks. Also the sales variant: invoices plus receivables only. | • Money is shown as net / GST / gross everywhere.<br>• Numbers align on tabular figures. | G1 | b |
| D07 | **Login and Team screen.** Shows the login (no "forgot password"; it says "ask your admin"), the Team list, the create dialog with the password shown once, deactivation confirm, and role change. | Covers the full A04 flow. | G1 | b |
| D08 | **Component states sheet**, the spec P2 builds against. Shows every state of: Dialog, DataTable (dense and compact, sorted, empty, loading), StatusBadge (all tones), Money variants, Form (validation, unique-violation, submitting), the ⌘K palette, toast with undo, and the empty-state pattern. | Every primitive state that appears in D02–D07 also appears here. | G1 | b |
| **G2** | **Owner gate: all screens.** The owner reviews D03–D08 together, as one batch. At most 2 rounds. | Approval recorded in `DECISIONS.md`. | D03–D08 | — |
| D09 | **Freeze and hand-off.** Commit the final HTML; export reference PNGs to `screens/`; freeze `DESIGN_SYSTEM.md`; write a screen → primitive inventory; fill `ARTIFACTS.md`. | • Every approved artifact version has its source committed.<br>• The inventory names a primitive for every UI element. | G2 | — |

*D01 and D02 run as one task or back to back, since D02 depends on D01.

## §3 P2: amended acceptance criteria

These criteria are added to every U task:

- **U-std rules:**
  - (i) Invoke the `frontend-design:frontend-design` skill before writing code.
  - (ii) Build to `DESIGN_SYSTEM.md` and D08. No ad hoc colours, sizes or shadows; lint enforces this.
  - (iii) The PR includes Playwright screenshots of the primitive beside the matching D08 reference PNG, at the same viewport.
  - (iv) Every state shown in D08 is implemented.

| ID | Change |
|---|---|
| U01 | The **only task that writes tokens into code**: from `docs/design/tokens.css` into `src/index.css` and `tailwind.config.ts`. Adds the CI token-parity check. Self-hosts the webfont if D01 chose one. Lint also bans arbitrary colours (`bg-[#…]`) and shadows outside the tokens. |
| U02–U08 | Plus U-std. Acceptance now reads "matches D08 side by side; any deviation is listed in the PR and approved by the orchestrator". Deps: **G2/D09** as well as U01. |
| U09 | The gallery covers every D08 state. **Visual-regression baselines** are committed (Playwright `toHaveScreenshot` on the gallery at 1440 and 375). Later changes to a primitive must update a baseline deliberately. axe still shows zero violations. |

## §3 P3–P7: standing rule FE-1

Add this at the top of P3:

> **FE-1 (applies to A03, A04, R02, R05, R06, R07, R09, R10, R11, R12, O01–O04, O06, M01–M06, M07 (panel), P01, P02, P04, and any future UI task). Workers must not skip it.**
> 1. Invoke `frontend-design:frontend-design` before writing UI code, and follow it.
> 2. Build to the approved mockup (D02–D07). A screen that has no mockup (RFQ board, orders list, companies, expenses, targets, reports) is composed from `DESIGN_SYSTEM.md` and the nearest approved mockup.
>    - If it needs a **pattern that isn't in the system**, the worker publishes a small delta artifact and gets the owner's approval first.
>    - Otherwise no new design review is needed.
> 3. Use primitives and tokens only. The lint rules from U01 apply.
> 4. Empty, loading and error states are required on every screen.
> 5. The PR includes desktop screenshots at 1440. Today, RFQ detail and intake also need mobile screenshots at 375; every other screen must work at 768. Each screen gets a Playwright screenshot baseline.
> 6. Review gate: the orchestrator checks each PR against the mockup. Any deviation is listed in the PR and either fixed or accepted explicitly.

> **FE-2: Entry burden (applies with FE-1 to every create/edit flow; Amendment A3). Workers must not skip it.**
> 1. Every create/edit flow lists its required fields in the commit.
> 2. Dates default to today, and context pre-fills.
> 3. Missing data blocks only the payoff that needs it. No completeness percentages and no nags.
> 4. Each flow has a Playwright interaction-count test against its target below.
> 5. Any new required field needs a `DECISIONS.md` entry.
>
> | Flow | Target |
> |---|---|
> | *(A6)* Bookkeeping flows: expense entry, bank tick, month close, reports, CSV | See "A6.5 UI and FE-2 tap targets" in Amendment A6 below; they are part of this table. |
> | New RFQ desktop | ≤3 actions + 1 paste |
> | Capture | Android ≤4 taps, iPhone ≤6 |
> | Float | ≤2 taps |
> | Supplier reply | paste+accept ≤2, else ≤1 typed price per item, currency never typed |
> | Can't quote / bid sent | 1 tap |
> | Issue quotation | ≤1 price per item + 2 taps |
> | Win | ≤2 taps |
> | Lose | ≤2 taps |
> | Issue PO (priced) | ≤2 taps |
> | Mark placed/received/delivered | 1 tap each |
> | Engineer commissioning done | 1 tap, 0 typed |
> | Change planned date | ≤2 taps |
> | Expense from a leg/order | 1 amount + ≤2 taps |
> | Recurring expense | 1 tap |
> | Invoice | ≤2 taps |
> | TCS/FBR month | ≤3 taps + 1 PSID paste |
> | Full payment | ≤2 taps |
> | Chase | 1 tap |
> | Photo answer | ≤3 taps, 0 typed |

Two existing tasks also change:
- **P04:** add a polish pass (spacing, alignment and motion audit against `DESIGN_SYSTEM.md`) and confirm the CSP needs no third-party font host.
- **F08:** note that the CSP will be revisited if a webfont is chosen, but self-hosting means no change is needed.

## §2/§3 Dependencies: what PD blocks and what proceeds

| Blocked by PD | Proceeds in parallel with PD (no design dependency) |
|---|---|
| **G2/D09** blocks all of U01–U09, and therefore every screen task in P3–P7. | P0 apart from F07 (F07 *feeds* PD). |
| **D07** blocks A03 (login) and A04 (Team). | **All of P1 (S01–S16)**. |
| | A01, A02, A05. |
| | Pure-logic tasks R03, R04, R08, and the rule functions inside R11. Their UI wiring waits for U. |
| | R13 (backups). |
| | I01–I05 (import track). |

**Revised critical path:** F07 → D01/D02 → G1 → D03–D08 → G2 → D09 → U01 → U02–U08 → A03/A04 and the P4 screens. P1 runs alongside and must finish before R05.

## §7 Risks: add these rows

| # | Risk | Mitigation |
|---|---|---|
| D-R1 | Owner review bandwidth stalls PD | • Only **2 gates**, and reviews are batched (G2 reviews 6 artifacts at once).<br>• At most 2 rounds per gate. After that the orchestrator proposes the final version and the owner approves or rejects.<br>• Comments go directly on the artifacts, from any device.<br>• P1 and the import track keep the build moving in the meantime. |
| D-R2 | "Beautiful" becomes open-ended scope creep | • Definition of done is "matches the approved mockup and `DESIGN_SYSTEM.md`".<br>• New patterns need a small delta artifact.<br>• Polish beyond the mockups is limited to the single P04 pass.<br>• No animation unless it carries meaning (state change, undo, focus). |
| D-R3 | Code drifts away from the mockups | • Token-parity check in CI.<br>• Gallery and screen screenshot baselines.<br>• Side-by-side screenshots required in every PR. |
| D-R4 | Published artifacts expose real customer and supplier relationships | • Fictionalised but realistic data in every mockup.<br>• Check artifact visibility settings before sharing links. |
| D-R5 | Visual polish costs performance (webfont, motion, effects) | • Self-hosted, subset webfont.<br>• Motion uses transform and opacity only.<br>• The P04 bundle budget (≤ 300 KB gzip initial JS) and Lighthouse checks are unchanged. |
| D-R6 | Density and beauty conflict on data-heavy screens (register, RFQ detail) | • D01 defines a compact mode for DataTable only.<br>• D04 and D06 are the stress tests: if they work at 1440 with real-length data, the system holds. |

## §8 Open questions

None added. The webfont is the designer's call within D01, self-hosted by default. Artifact visibility is handled under D-R4.

---

# Amendment A2 — Gate 1 result and features F-1 to F-7 (approved by owner 2026-10-13)

> Owner answers since A2 was written: Q4 = (b) the team uses BOTH Android and iPhone — build the Android share target AND a first-class in-app share-in for iPhone (R22 ships fully). Q5 (letterhead/legal content) still open — blocks only R19, O07, A06 releases.

### §1 Folder structure: additions

```
src/lib/texts/        enquiry · clarificationChase · supplierChase · paymentReminder (pure, snapshot-tested; email + WhatsApp variants)
src/lib/fx/           comparePrices · format (pure)
src/lib/memory/       one-liner selection · threshold rules (pure)
src/features/pdf/     lazy chunk: renderer, Letterhead, QuotationDoc, PurchaseOrderDoc; fonts in public/fonts/ (Geist TTF)
src/features/share-in/  share-in route + chooser
public/manifest.webmanifest   src/sw.ts (injectManifest)   ← app shell precache + share-target POST handler only
```

Two more `vercel.json` entries:
- CSP gains `manifest-src 'self'` and `worker-src 'self'`.
- `sw.js` is served with `Cache-Control: no-cache`.

### PD Design direction: amendments (everything stays in the single **G2** batch)

**G1 is recorded as passed:** direction **B**. Rule for G2 mockups: in dense tables and in PDFs, show the currency as "PKR". **Geist has no ₨ glyph.**

| ID | Change / new | Acceptance |
|---|---|---|
| D02b (new) | Today B fixes: the target tile shows the worked maths (target 6.0M, achieved 3.45M, 58 of 92 days → pace 3.78M, behind 0.33M); context-pane chase-draft states (draft / copied + undo / just chased, so the item drops away). | The tile's figures recompute correctly from the stated inputs; the reviewer checks the arithmetic. |
| D03 (amended) | Intake suggestions carry memory one-liners and a memory card (expanded state). Low-data states: "no history yet" and "asked twice, 1 reply". | No percentage anywhere without its counts. No score. The tier label is visible. |
| D04 (amended) | Supplier reply rows show the original price and ≈ PKR with the rate date; stale (amber) and missing-rate states, with the inline rate prompt; lowest price only among comparable lines; a memory chip with "last price for this item"; supplier-chase and clarification-chase panels. | Mixed USD/CNY fixture rendered. The "not compared" state shown. |
| D05 (amended) | Order detail: the "Issue PO" flow on a leg, with price-source labels (quote / last PO / typed) and the currency. | The engineer variant shows supplier prices and still no margin. |
| D06 (amended) | Payment-reminder panel (admin and sales variants), showing reminder count and last date. | No payment figures in the engineer variant (there is no engineer variant of this screen). |
| D07 (amended) | Settings: company profile (admin), exchange rates (staff), job title on the Team screen. | |
| D10 (new) | Quotation PDF layout, A4: letterhead, number and revision, date, validity, customer + site + contact, customer ref, items with net and GST, totals net/GST/gross, delivery, payment terms, standard terms, signatory. | Printed at 100% it is legible; 30 lines flow onto page 2 with the table header repeated. |
| D11 (new) | Supplier PO PDF layout, A4: supplier (and the brand it acts as agent for), PO number and revision, lines in the supplier's currency, incoterm, delivery and payment terms, ship-to, signatory. | Same as D10. |
| D12 (new) | Share-in flow on a phone at 375px: Android share sheet → chooser (answer a question / new supplier questions / add to RFQ notes / start a new RFQ) → confirmation; login-resume state; iOS fallback panel (paste text + pick photos). | Every chooser path ends in at most 3 taps after the share. |
| D13 (new) | Chase-text panels: customer clarification chase, supplier chase, payment reminder, each with an email/WhatsApp toggle; polite Pakistani business English (the owner reviews the wording here). | The owner approves the template wording at G2. |
| D14 (new) | Company page section "What we know" for suppliers: brands carried, enquiry counts, recent quotes table (original currency + PKR, outcome), deliveries; low-data and legacy-provenance states. | Same honesty rules as D03. |

G2 depends on D02b–D14.

### §3 Task breakdown: changes to existing tasks

| ID | Change |
|---|---|
| S04 | Add `rfq_items.gst_rate`, `supplier_inquiries.chase_count`, `clarifications.ask_count`. |
| S06 | Add `invoices.last_reminded_on` and `reminder_count`. `order_receivables()` (S12) returns both. |
| S13 | Add the RPCs `stamp_clarification_ask`, `stamp_supplier_chase`, `stamp_payment_reminder`. `convert_rfq_to_order` copies `gst_rate`. |
| S14 / S16 | Cover 28 tables. |
| R07 | The "lowest price" mark goes through `comparePrices` (R15). |
| R09 | "Copy questions for customer" calls `stamp_clarification_ask`. |
| R11 | Today v1 uses the stamp rules in §5c and the escalation suggestions. Built as direction B: a 420 px list plus a context pane that holds the prepared chase draft; on mobile the pane folds into an accordion. |
| M04 | Expected-cost suggestion from PO lines × FX, which never overwrites an existing value. |
| P04 | Measure the PDF chunk and the service worker. Initial JS stays ≤ 300 KB gzipped. |

### §3 Task breakdown: new tasks

Every UI task below follows FE-1.

| ID | Deliverable | Acceptance | Deps | ∥ | Flag |
|---|---|---|---|---|---|
| S17 | `fx_rates` and `v_fx_latest`; `company_profile` singleton with RLS; `users.job_title`. | Same-day re-entry updates the row. Staleness bands are tested at 7, 8, 30 and 31 days. Profile is updatable only by admin. Attach the audit trigger, or add a justified exclusion to 0013's coverage test. (`fx_rates`, `company_profile`) | S03 | b | |
| S18 | `quotations`, `purchase_orders`, both number sequences, the lock trigger, the `issue_*` RPCs, and the `generated-docs` bucket. | An UPDATE of anything except `pdf_path` is rejected. Re-issue keeps the number and increments the revision. Issuing stamps `quoted_on` / `placed_on`. Totals come from the RPC, and a mismatched total sent by the client is ignored. Double submit gives one row. Attach the audit trigger, or add a justified exclusion to 0013's coverage test. (`quotations`, `purchase_orders`) | S05, S08, S17 | | |
| S19 | Supplier memory: pg_trgm, the indexes, `v_supplier_activity`, `v_supplier_stats`, `supplier_item_memory()`. | The fixture tests listed after this table pass. p95 < 150 ms on the 10× fixture. | S18 | | |
| R15 | Exchange rates in the UI: inline rate prompt on reply rows; Settings › Exchange rates; the ≈ PKR display; `comparePrices` (pure). | Unit tests: same-currency comparison without rates; mixed currencies with fresh, stale and unusable rates; fewer than 2 comparable lines means no "lowest" mark. Playwright: entering a missing rate updates the ranking. | R07, S17 | g | |
| R16 | Text generators for the clarification chase and the supplier chase (email and WhatsApp variants); the Today B context pane with "Copy and mark chased"; undo within 10 s. | Snapshot tests. The generator never invents a spec or an answer. After a stamp the item leaves Today until its threshold. The escalation suggestion appears at ask_count 3 and chase_count 2. | R11, S13 | g | OWNER wording at G2 (D13) |
| R17 | Supplier memory in intake: one-liner per suggestion (selected from §5c in priority order), expandable memory card, "last price for this item" chip on RFQ reply rows. | Fixture tests through the UI; memory never reorders the suggestions (test). Low-data copy matches D03. | R05, S19 | | |
| R18 | Company page section "What we know" (supplier side). | Matches D14. Legacy provenance footnote shown. | R02, S19 | g | |
| R20 | PDF foundation: lazy-loaded `@react-pdf/renderer`, Geist TTF embedded, Letterhead component from `company_profile`, upload to `generated-docs`, a Share button (Web Share with files, falling back to download). | Initial bundle unchanged (build report). The chunk loads only on demand. Generating a test document takes < 3 s on a mid-range Android phone (manual check). Generation is blocked with a clear message until the profile is complete. | U09, S18 | g | |
| R19 | Quotation: issue dialog (edit prices and GST into `rfq_items`, validity, delivery, terms, contact), `issue_quotation`, the PDF per D10, re-issue as a new revision, quotation list on the RFQ page. | The PDF matches D10. Re-issue doesn't change the previous revision's PDF or row. `quoted_on` is stamped. | R20, R07 | | OWNER Q5 (content) |
| A06 | Settings: company profile (admin), job title on the Team screen. | Only admin can edit; all staff can read. | A04, S17 | | OWNER Q5 |
| R21 | PWA base: manifest (brand icons, theme colour), service worker with an app-shell precache only (**no API or data caching**), install prompt, CSP and headers. | Lighthouse "installable" passes. A test asserts the service worker caches no Supabase response. | U02 | h | |
| R22 | Share-in: the service worker handles the share-target POST → payload kept in IndexedDB for up to 24 h → `/share-in` chooser (answer a question / new supplier questions split into lines / add to RFQ notes / start a new RFQ with the items paste pre-filled). Images compressed with `imageCompress` and limited to 5 MB. If the session has expired, login and then resume. **iOS and desktop fallback:** the same chooser, reached from an in-app "Share in" button with paste and photo picking. | Android manual test on a real device: text and 1–3 images from WhatsApp land on the chosen record. Playwright covers the fallback path. The payload is cleared after use or after 24 h. | R21, R09, R10 | | **OWNER Q4** decides whether the share-target part ships |
| O07 | Supplier PO: "Issue PO" on a leg; line prices pre-filled quote → last PO → typed, each with its source label; currency; incoterm and terms; ship-to defaulted from the profile; PDF per D11; revisions. | Price-source test for each of the 3 sources. `placed_on` is stamped. A repeat order with no quote is pre-filled from the last PO. | O03, R20, S19 | i | OWNER Q5 |
| M09 | Payment-reminder generator (invoice numbers, gross, received, balance, days overdue; bank details only if Q5 says so) plus `stamp_payment_reminder` plus the Today rule. | Engineers can't reach the panel or the RPC (route and RLS tests). The item reappears 7 days after the last reminder. | M02, M08, S13 | k | |

**Supplier-memory fixture tests (S19 and R17), all named:**
- (a) 0 inquiries → "no history yet"
- (b) 2 inquiries, 1 reply → raw facts, no rate
- (c) 5 asked, 4 replied with non-legacy reply days [1,2,2,5] → "replied 4 of 5", median 2
- (d) legacy-only replies → no median shown
- (e) a `currency_unverified` quote → price hidden, reply still counted
- (f) an `item_guessed` quote → absent from tier 1/2, present at supplier level
- (g) "Belimo LF24-SR actuator" against "BELIMO LF24 SR actuator 24V" → tier 1; against "Belimo damper" → tier 2
- (h) an item quoted by A and B, ordered from B → B "chosen 1 of 1", A "chosen 0 of 1"; a cancelled order doesn't count
- (i) an inquiry sent 3 days ago with no reply → not counted in `asked`
- (j) legs late [3, 9, 12] days → "late 3 of 3, median 9 days"

### §2 Phases: changes

| Phase | Added scope |
|---|---|
| P1 | S17, S18, S19. |
| P4 | R15, R16 and R17 before R14, because they make the trial useful. R18, R19, R20, R21 and R22 make up **P4b, "RFQ completion"**, and do not block the R14 trial start. R22's share-target part waits for Q4. |
| P5 | O07. |
| P6 | M09. |

The **P4 exit** gains: mixed-currency comparison is correct; chase stamps stop the nagging; memory renders within budget.

### §7 Risks: additions

| # | Risk | Mitigation |
|---|---|---|
| R11 | Supplier memory looks empty until import | Expected and labelled "no history yet". Its value arrives at cutover; the trial measures the draft and chase features instead. |
| R12 | The PDF chunk is large or slow on cheap phones | Lazy-loaded, measured in R20 and P04. Fallback: generate on desktop. |
| R13 | iPhone users get no share-sheet entry | The in-app fallback works on every platform. Q4 decides whether the Android-only share target is worth building. |
| R14 | A stale exchange rate misleads a choice | Staleness bands, the amber note, and no comparison beyond 30 days. |
| R15 | Generated text sounds wrong for the customers | The owner reviews the wording at G2 (D13). Templates are constants and cheap to change. |

---

# Amendment A2b — Reconciliation of the two A2 versions (approved by orchestrator 2026-10-13)

> This supersedes any conflicting text in Amendment A2. The task-ID mapping table below is authoritative; v2-only IDs (X01, C01, W01, Q01, K01…) do not exist. Orchestrator correction: the FX-capture trigger skips imported rows (legacy_source set) instead of being disabled during import.

### PD design tasks (all still inside the one G2 batch)

| ID | Change |
|---|---|
| D02-B fix | Also show the **Waiting** group: dimmed, "chased n days ago · next nudge on …", collapsed when there are more than 5 items. |
| D04 | FX labels: today's "≈ PKR" on reply rows versus the captured "at the time" in memory chips; the inline rate prompt shows source (auto or manual) and age. |
| D05 | A supplier-price column on order items in the leg's currency, and the leg currency field. |
| D10 | A per-line **lead-time** column on the quotation. |
| D12 | Redrawn as the **Capture sheet** at 375 px for Android and iPhone, plus desktop at 1440 (drag-drop and paste).<br>Acceptance: the iPhone path is ≤ 2 taps longer than Android; the login-resume state is shown; recents are shown. |

### Task scope changes (no new IDs)

| ID | Added scope | Added acceptance |
|---|---|---|
| S04 | `rfq_items.quoted_lead_time`, `rfq_items.model_tokens` + GIN, the `model_tokens()` function | Unit cases for `model_tokens` (the §2.8 examples, plus the unit and range exclusions). |
| S05 | `order_items.supplier_unit_price`, `order_items.model_tokens` + GIN, `supplier_orders.currency` | — |
| S13 | `convert_rfq_to_order` and `create_repeat_order` fill or copy the supplier price and the leg currency | Conversion copies the price and currency from the chosen quote line. |
| S17 | `fx_rates.source`, the new uniqueness, `v_fx_latest` with manual-over-auto, the quote-line FX columns and capture trigger. **Dependencies become S03 + S04.** | Manual beats auto on the same day; the next day's auto beats yesterday's manual. The trigger fills only NULLs. PKR gives 1. No rate gives NULL. Staleness band tests unchanged. |
| S18 | `issue_purchase_order`: requires the leg currency, freezes it, applies the 4-source pre-fill order, writes prices back to the order items | Price-source test for all 4 sources. The write-back is verified. Refuses when the currency is NULL. |
| S19 | Tier 0 "same model". Memory uses captured rates. The "last ordered price" fallback. | Fixtures (k)–(n) pass. |
| R15 | Rate source (auto or manual) shown. Manual-override entry. Captured-versus-today labelling in history displays. | — |
| R16 | Waiting group and its cooldown display. Covers the old v2 C01/C02 scope. | With a fake clock, a chased item → Waiting → back on the active list on the threshold date. Bid due within 3 days shortens the wait. |
| R17 | Tier 0 labels; memory chips "at the time". Covers K01. | Fixtures (k)–(n) through the UI. |
| R18 | Covers K02. | — |
| R19 | Per-line `quoted_lead_time` (supplier lead time shown as a hint) in the dialog and the snapshot. Covers Q03. | The PDF prints the per-line lead time. The hint never auto-fills the field. |
| R20 | Covers Q02. | — |
| R21 | Covers W01. | — |
| R22 | Rebuilt as the Capture sheet (§6 M): every entry point, desktop drag-drop and paste, recents, 7-day local retention (was 24 h). Covers W02/W03. | End-to-end for each destination. A simulated share-target POST in Chromium. Native paste of an image in Chromium. Payload survives a login redirect. Purged after 7 days. |
| A06 | Covers Q01; uses `job_title`. | — |
| O07 | 4-source pre-fill including `order`; edits the leg currency. Covers Q04. | — |
| M04 | The expected-cost suggestion uses supplier prices × today's rate, or PO totals once a PO has been issued. | — |
| M09 | Covers C03. | — |

### New tasks

| ID | Deliverable | Acceptance | Deps | ∥ | Phase |
|---|---|---|---|---|---|
| R23 | Nightly FX fetch: a step in `nightly.yml`, service role, writes `auto` rows from open.er-api.com with one fallback source; currencies = USD/EUR/CNY plus those seen on quote lines in the last 12 months | Running twice in one day writes no duplicates. A failing source makes the job fail (red). It never writes `manual` rows. | S17, S15, R13 | g | P4 (before R14) |
| R24 | Real-device test of share-in and capture: Android Chrome (install, WhatsApp → Share) and iPhone Safari (install to the home screen, Copy → Paste, photo pick). Written test script; results recorded in `docs/` | Both paths complete on the team's own phones; tap counts recorded; the iPhone path is ≤ 2 taps longer than Android. | R21, R22 | | P4b; OWNER (team phones) |

ID mapping for reviewers. Every v2-only ID is absorbed, so no duplicates remain:

| Version 2 ID | A2b ID |
|---|---|
| X01 | R15 |
| X02 | R23 |
| C01, C02 | R16 |
| C03 | M09 |
| W01 | R21 |
| W02, W03 | R22 |
| W04 | R24 |
| Q01 | A06 |
| Q02 | R20 |
| Q03 | R19 |
| Q04 | O07 |
| K01 | R17 |
| K02 | R18 |
| v2's S17 | S19 |

### §2 Phases: changes

- **P4 (before R14):** add R23.
- **P4b:** add R24.

### §7 Risks: add

| # | Risk | Mitigation |
|---|---|---|
| A2b-R1 | The free rate service changes its terms, disappears, or drifts from the bank rate | One fallback source; manual override wins on its day; staleness bands make missing updates visible; comparisons still work on stale rates (with a label) and stop only at "unusable" (> 30 days). |
| A2b-R2 | The supplier price on the order and the issued PO diverge | Issuing a PO writes its prices back to the order items, so there is one working price; the PO snapshot is the record of what was sent. |

---

# Amendment A3: Minimal entry burden (owner standing rule, 2026-10-13)

> Source: the owner's rule that logging be as limited as possible. Schema changes are in `DATA_MODEL.md` Amendment A3. The standing rule **FE-2** is defined under FE-1 above and applies to every UI task listed in FE-1.

### Task acceptance additions

| ID | Added acceptance |
|---|---|
| S04 | Apply A3-1: the clarification CHECK is `answer IS NULL OR answered_at IS NOT NULL` (replaces the "answer/answered_at pair CHECK holds" wording). Apply the A3-4 defaults: `rfqs.owner_id` DEFAULT `auth.uid()`. |
| S06 | Apply A3-2 (no `tax_deposit_bank`), A3-3 (`copy_received_on` kept pending I06 verification; `client_received_on` optional), and the A3-4 defaults: `invoices.invoice_date`, `payments_in.received_on` and `expenses.paid_on` DEFAULT `today_pkt()`. |
| S13 | Apply A3-4: `convert_rfq_to_order` carries `owner_id` across (and `orders.owner_id` DEFAULT `auth.uid()`); batch stamping RPCs for the TCS and FBR tracks (sent by TCS today, PSID, deposited today) over a set of invoice ids, with `tax_deposit_amount` defaulting to `gst_amount` when the deposit date is stamped. Single-invoice stamping still works. |
| R07 | No blocking rate prompt: a missing FX rate never blocks saving a price; the line shows "not compared, no rate". |
| R09 | Photo-only answers: an answer or an attachment is enough to stamp answered; the relay text reads "see attached photo". Photo answer is at most 3 taps, 0 typed. |
| R16 | Supplier goods-chase text includes `supplier_orders.reference` when set. |
| R19 | Price chips: the last price sold to this customer and the last price quoted. |
| O01 | Terms default: `payment_terms_days` defaults to the company's last order. |
| O03 | Stamp buttons per leg (Mark placed / Received today / Delivered today; Delivered fills `received_on` if empty). `expected_on` suggested from `placed_on` plus the upper bound of the chosen quote line's lead time. Engineer commissioning is one tap, "Mark done today"; the planned date is a separate small action; no scope, gate pass or site phone fields. |
| O07 | PO terms default: incoterm and terms from the supplier's last PO, else `company_profile`. |
| M01 | Invoice number pre-fills as the next in the series. Batch TCS/FBR stamping UI (at most 3 taps + 1 PSID paste per month). Deposit amount defaults to the GST amount. |
| M02 | Payment defaults: amount = balance due, date = today. |
| M03 | Expense pre-fills: from a leg, category is supplier payment and payee/leg are filled; from an order, the last category used. Recurring expense is 1 tap. |
| P03 | Interaction-count assertions (FE-2 targets) for the journeys of all three roles. |

Mapping notes: the real task IDs matched the brief by content, so no remapping was needed. Judgement calls: the A3-4 `owner_id` defaults are split between S04 (RFQ default) and S13 (conversion RPC carries the owner); price chips go to R19 (the quotation task), though R17 (supplier memory chips) is a plausible alternative; the "supplier goods-chase text includes `supplier_orders.reference`" note has no task in the brief and probably belongs with R16 (chase text generators), so it is stated in DATA_MODEL A3 only.

---

# Amendment A4: S12 / S13 worker notes (2026-10-13)

- **S12** creates `snoozes` (migration 0017). R11 no longer owns it.
- **S12** `order_receivables(p_order_id default null)` and `my_target_progress()` repeat the section 5a net-portion maths because the admin-only money views cannot be read from a definer function (their `current_user_role() = 'admin'` filter sees the caller). Any change to `v_order_basis` / `v_payment_net` must be mirrored in `0018_definer_functions.sql`; the 0018 tests pin the two together.
- **S14**: the access matrix must include the extra admin-only view `v_order_basis` (created in 0015 as a helper for `v_payment_net`; it is not listed in DATA_MODEL §10), and the new functions `order_receivables` (admin, sales), `my_target_progress` (all active roles), plus the S13 RPCs: `float_rfq`, `convert_rfq_to_order`, `create_repeat_order`, `stamp_clarification_ask`, `stamp_supplier_chase` (all staff); `stamp_payment_reminder`, `stamp_tcs_sent`, `stamp_fbr_psid`, `stamp_tax_deposited` (admin, sales); `merge_companies`, `merge_brands`, `resolve_value_basis` (admin). `my_target_progress_at` is a test seam granted to nobody.
- **S18** must add `quotation_expired` to `v_rfq_state.bid_state` (0014 ships only `to_bid` / `bid_sent`).

---

# Amendment A5: S17 / S18 worker notes (2026-10-13)

- **S18 done in 0023:** `v_rfq_state.bid_state` now returns `quotation_expired` (latest quotation lapsed, RFQ still open: not won, not closed) and exposes `quotation_valid_until`. The A4 item is closed.
- **S14 matrix must add:** tables `fx_rates` (SIUD admin; SIU sales and engineer for `source = 'manual'` only), `company_profile` (S all staff, U admin, no I/D), `quotations` and `purchase_orders` (SIU all staff, D admin; UPDATE only of `pdf_path`, enforced by the lock trigger); the view `v_fx_latest` (all staff); the bucket `generated-docs` (SIU all staff, D admin); the functions `set_fx_rate`, `issue_quotation`, `issue_purchase_order` (all staff) and `item_text_norm` (all staff, helper). `capture_quote_line_fx()` is a trigger function with no client grant. The audit trigger now covers 26 tables.
- **S17 captures even an unusable rate** on a quote line (the stored `fx_rate_on` shows its age); only a currency with no rate at all leaves both columns NULL.
- **S19** can reuse `item_text_norm(text)` as the section 5c `norm()`.
- **R23** (nightly FX fetch) is not part of S17: it needs the service role and an external API, and stays with its own task.

---

# Amendment A6: monthly bookkeeping (approved 2026-10-14)

> Schema and rules are in `DATA_MODEL.md` Amendment A6. Decisions are in `DECISIONS.md` (2026-10-14). The A6 branches start from main and rebase after `p1/s19-s14` merges, keeping migration numbers 0025–0028. Input tax is decided "yes" and is confirmed with the owner at the D15 review.

## A6 task table (A6.7)

| ID | Deliverable | Deps | ∥ | Phase |
|---|---|---|---|---|
| S20 | 0025_expense_categories (A6.1) plus tests | S19/S14 merged (rebase only; no logic dependency) | n | P1-late |
| S21 | 0026_bank_and_receipts plus tests | S20 | n | P1-late |
| S22 | 0027_month_close plus tests, and the cutover-runbook line "close no month before the final import" | S21 | | P1-late |
| S23 | 0028_month_reports plus tests (named fixtures) | S22 | | P1-late |
| D15 | Mockup and mini-gate (A6.8) | — | b | PD (in parallel with S20–S23) |
| M03 (amended) | Expense form uses `category_id` and `paid_via` (defaulted), plus input tax as a collapsed optional field | S20 | | P6 |
| M10 | Month-end tab: checklist, close/reopen, report tabs, CSV | S23, D15, M05 | k | P6 |
| M11 | Burst expense entry (desktop sheet plus phone list, photo) | S21, D15, M03 | k | P6 |
| M12 | Bank tick screen (in/out lists, PSID groups, running totals) | S21, D15 | k | P6 |
| M13 | Category admin: rename, reorder, (de)activate, group, default paid via | S20 | k | P6 |
| M05 (amended) | Cash month moves under the Month-end reports; the GST register keeps its own tab | — | | P6 |
| M08 (amended) | Rule A6.4 | S23 | | P6 |
| I05 (amended) | Category mapping file plus the `category_unmapped` flag; `paid_via` = bank, `bank_month` NULL for legacy | S20 | m | P8 |
| I11 runbook | After sign-off: `close_months_through(last month)` | S22 | | P8 |

S20–S23 don't block any current work. They run on their own branch from main and rebase after `p1/s19-s14` merges, keeping the numbers 0025–0028.

---

## M08 Today rule (A6.4, amends M08)

- **Admin only:** "Close {previous month}: n checks". It appears from the 1st to the 10th of each month while that month is open.
- Snoozable. Never more than one item.

---

## A6.5 UI and FE-2 tap targets (added to FE-2 above and to the P03 assertions)

### Burst expense entry (M11): a sheet in Money › Expenses, keyboard-first

- **Rows:** amount → category → date → paid via → note → photo.
- **Defaults:**
  - category = the previous row's category; the first row uses the most-used category of the last 30 days
  - date = today
  - paid via = the category's default
- **Keys:** Enter adds a row; Tab moves between cells; type-ahead on category (2–3 letters); Ctrl+Enter saves all.
- **Saving:** one bulk PostgREST insert, atomic, with client-generated ids so a double submit can't duplicate.
- **Phone:** a list version where the photo button opens the camera, compressed with `imageCompress` before upload.

### Bank tick (M12): Month-end › Bank

- Pick the statement month.
- Two lists, money in and money out. Money out also shows FBR deposits grouped by PSID.
- Each list has unticked items first, plus older unticked items.
- One tap per row.
- Running ticked totals for in and out, so the owner can compare them with the statement totals.

### Month-end tab (M10)

- Checklist counts with links.
- Report tabs: P&L, expenses by category, aging, we owe, GST/FBR, team.
- CSV export of every report through `csvExport`.
- **"Close September"**: one confirmation that shows the warning counts.
- Reopen, from the closed-months list.

### A6 tap targets

| Event | Target |
|---|---|
| One expense, default category | 1 amount + Enter |
| Different category | + 2–3 letters |
| Photo | + 2 taps |
| Five small spends in a burst | ≤ 5 amounts + 6 keys, 0 mouse |
| Tick a bank item | 1 tap |
| Tick a whole PSID group | 1 tap |
| Close month (checklist reviewed) | 2 taps |
| Reopen | 2 taps |
| Monthly report viewed | 1 tap (tab) |
| CSV export | 1 tap |

---

## D15 brief (A6.8)

**D15: Month-end and burst entry** (one artifact, reviewed by the owner in a mini-gate, at most 2 rounds)

- **Desktop 1440:**
  - Month-end tab with the checklist, close confirmation, closed state and reopen.
  - P&L, Expenses by category ("water, snacks, salaries, fuel" grouped), Aging, We owe, GST/FBR and Team report tabs.
  - Bank tick lists, including a PSID group and running totals.
  - Burst-entry sheet with defaults visible and an inline closed-month error.
- **Phone 375:** burst list with camera.
- **States:** empty month, everything ticked (the goal state), loading, error.
- **Interaction counts** annotated on each flow (FE-2).
- **Constraints:**
  - Money component, PKR in dense tables.
  - No percentages without counts.
  - Not-in-P&L lines visually set apart below the result.

---

# Amendment A8: splitting an item across suppliers, and ranking supplier quotes (approved 2026-10-15)

> Schema and function details are in `DATA_MODEL.md` Amendment A8. Decisions are in `DECISIONS.md` (2026-10-16). Migration numbers: **0049** (S24) and **0050** (S25); 0043 to 0048 belong to other branches. The owner approved the D16 ranking mockup (`docs/design/mockups/g2-ranking-split.html`, "ranking ok") and four overrides, which win over anything else in this amendment:
>
> - Ranking: best margin first (the same as the lowest landed PKR price per item), a 2% tie band, then delivery reliability, then order history. Evidence lines cite order number, date and days to delivery ("delivered after N days").
> - The spread and the selling price are visible to admin and sales only. Engineers see the supplier prices plus the reliability and history reasons, but no selling price and no spread.
> - There is no "Received" step on a supplier leg: a leg goes Placed, then Delivered. `received_on` is set equal to `delivered_on` (the app already writes both). Every "received after N days" is "delivered after N days" (`delivered_on - placed_on`); on time means `delivered_on <= expected_on`; "not received yet" is "not delivered yet".
> - Splitting needs no new table: several `order_items` rows for one RFQ item, each with its own quantity and leg.

## A8.1 What changes

| Area | Change |
|---|---|
| Split storage | Several `order_items` rows share one `rfq_item_id`, each with its own `qty` and `supplier_order_id`. Invoices, money views, goods state, PO lines, supplier memory, `customer_price_memory` and `create_repeat_order` are unchanged (a split is copied as a split). |
| `rank_item_quotes(p_rfq_id)` | New SQL function (S24): every quote line of the RFQ with its PKR price at today's rate, its rank, the near-tie band, delivery reliability, order history and (admin and sales only) the selling price and spread. One source of truth for convert, the RFQ page and the convert dialog. |
| `supplier_item_memory` | Gains evidence columns (S24): the most recent non-cancelled order at the best tier with a leg for the supplier, with order number, placed and delivered dates and the days from placed to delivered. New output columns only. |
| `convert_rfq_to_order` | Signature unchanged (S25). Gains a duplicate guard (two entries for one item may not use the same quote line) and infers the rank-1 quote line instead of "the only line". |
| `split_order_item` | New RPC (S25): splits an order line by quantity onto another or a new leg, for orders with no RFQ and for splitting after conversion. |
| Suggestion order | Float suggestions are re-ordered by track record inside the reason groups. This supersedes the A2b rule "memory never reorders". The pre-tick rule is unchanged: only "supplied this item before" is ticked. |

## A8.2 Ranking rules (per RFQ item)

1. **Price in PKR.** If every line on the item is in one currency, compare the raw prices (no rate needed). Otherwise convert each line at today's rate from `v_fx_latest`: fresh (7 days or less) and stale (8 to 30) are used, a stale one with a note. Unusable (over 30 days) or no rate: `comparable = false`, rank NULL, listed last.
2. **Margin (primary).** Lowest comparable price first. Our selling price is the same whichever supplier we buy from, so this is the same order as best margin.
3. **Near-tie band.** A line within **2%** of the best price is tied with it.
4. **Reliability (first tie-break), inside the band and for exact ties outside it.** From the supplier's legs with `expected_on` and a delivery date, all time. Band 1 proven (3 or more deliveries, on time at least 2/3), band 2 unproven (fewer than 3 deliveries, no claim made), band 3 often late (3 or more, on time under 2/3).
5. **Order history (second tie-break).** Non-cancelled orders with the supplier, other than orders from this RFQ: order count descending, then last order date descending. Order value is shown, never ranked on.
6. **Final.** Price ascending, then supplier name.
7. **Selling price and spread (admin and sales only).** `rfq_items.quoted_unit_price_net`, else the last price sold to this customer (`customer_price_memory`), else none. Spread is the selling price minus the PKR supplier price, before freight and duty.

No combined score is computed or shown; the rank is a sort order and every key is printed as a reason.

## A8.3 Tasks (amended)

| ID | Deliverable | Deps | Acceptance |
|---|---|---|---|
| **D16** | Done: `docs/design/mockups/g2-ranking-split.html`, approved by the owner ("ranking ok"). | | |
| **S24** | Migration **0049**: `rank_item_quotes()` and the evidence columns on `supplier_item_memory`; S14 rows; the money-safety assertion (an engineer's result has no selling price and no spread). | 0038/0039 merged | pgTAP named fixtures (a) to (i), see below. |
| **S25** | Migration **0050**: `convert_rfq_to_order` duplicate guard and rank-1 inference; `split_order_item()`; S14 rows. | S24 | pgTAP named fixtures (a) to (f), see below. |
| **R25** | Ranked comparison on RFQ detail plus `lib/ranking/reasons.ts` (the one module that composes the reason strings). Selling price and spread shown to admin and sales only. | S24, D16 | 0 extra taps to see the ranking. |
| **R26** | Float suggestion re-order plus evidence lines in intake and the memory card (extends R17). | S24, D16 | Pre-ticks unchanged. |
| **O08** | Convert dialog: split editor and rank-1 pre-assignment (O01 amended). | S25, D16, O01 merged | Split is 3 taps or fewer plus 1 quantity typed; convert with no changes is still 2 taps. |
| **O09** | Order detail: split grouping ("split across N suppliers"), a "Split line" action running `split_order_item`, selling price edited once for the group, the "changed since PO" indicator (shared with O07). Legs show Placed and Delivered only. | S25, D16, O03 merged | Split line is 3 taps or fewer plus 1 quantity typed. |
| **P03 (amended)** | Adds interaction-count assertions for the split and the convert. | O08 | Green in `db.yml`. |

### S24 acceptance (named fixtures)

| Fixture | Expected |
|---|---|
| (a) Same currency | Lines in one currency rank on the raw price with no rate. |
| (b) Mixed currencies | USD and CNY with fresh rates rank on PKR. A stale rate still ranks, `fx_state = 'stale'`. No rate (or an unusable one): `comparable = false`, rank NULL. |
| (c) Near-tie band | 1.5% apart: the proven supplier ranks first although dearer. 3% apart: the cheaper ranks first. |
| (d) Reliability bands | 2 of 2 on time is band 2; 5 of 6 is band 1; 2 of 6 is band 3; a leg with no `expected_on` is not a delivery. |
| (e) History tie-break | Equal price and band: more orders wins, then the more recent order. A cancelled order does not count. |
| (f) Spread | The quoted price is used; without it the last price sold to this company; with neither, spread NULL and `sell_source = 'none'`. |
| (g) Item coverage | A partial quote ranks only the items the supplier quoted. |
| (h) Memory evidence | The newest order at the best tier with the right days to delivery; family-only match gives `evidence_tier = 3`; not delivered yet gives NULL days. |
| (i) Access | Every active role can execute it; anonymous cannot. **Money safety:** for an engineer `sell_*` and `spread_*` are NULL; for admin and sales they are filled. |

### S25 acceptance (named fixtures)

| Fixture | Expected |
|---|---|
| (a) Two-part convert | Item X x6 from quote A and x4 from quote B: two lines, two legs, order net equals the unsplit total. |
| (b) Same quote twice | The same quote line used twice for one item is refused (22023). |
| (c) Inference | With `p_items` NULL the rank-1 line is chosen per item. |
| (d) `split_order_item` | 4 of 10 moved to a new leg: quantities 6 and 4, selling price copied, totals unchanged. |
| (e) Refusals | A quantity of the whole line or more, a service line, and a quantity of 0 or less are refused. |
| (f) Repeat order | Copies the split. |

Playwright (with R25, R26, O08): the ranking and reason strings as in the fixtures; a split convert within 3 taps plus 1 quantity creates two legs and each PO gets one line per part; float suggestions in the D16 order citing the evidence string.
