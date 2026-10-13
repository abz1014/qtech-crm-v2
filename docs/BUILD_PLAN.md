# Q-Tech CRM v2: build plan

Status: APPROVED by owner 2026-10-13. Q1 = (a) real trial data kept; Q2 = (a) GitHub protected-environment secrets; Q3 deferred to go-live. Amendment A1 appended (design direction, approved 2026-10-13).

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
| S12 | Definer functions `order_receivables()` and `my_target_progress()` (fixed search_path, grants) | R1 §5b, §10 | Engineer is refused `order_receivables`. `my_target_progress` returns only the caller's row. Quarter boundaries are correct at 00:30 PKT on 1 Apr. Deactivated users get nothing. | S11 | |
| S13 | RPCs: `convert_rfq_to_order`, `create_repeat_order`, `merge_companies`, `merge_brands`, `resolve_value_basis`, and **`float_rfq`** (atomic: create RFQ, items and inquiries, then stamp `sent_on`; PROPOSED, no schema change) | §4, R1 §4 | A second call with the same client-generated id returns the same order. Merge moves every foreign key. Resolving to gross divides prices by 1 + rate. | S10 | |
| S14 | Access-matrix test: §10 encoded once as data; every (table, role, op) plus anonymous is asserted | R1 §10 | Matrix data reviewed line by line against §10. All assertions pass. | S13, S12 | |
| S15 | Push to the remote project through the protected `remote.yml` job; parity check; remote types equal local | — | `migration list` matches. Generated remote types are identical. | S14 | | 
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
| A01 | `admin-users` Edge Function: create, reset_password (generated, returned once), set_role, deactivate (ban plus `signOut`), reactivate, list (with emails). Admin check runs on the server. CORS allow-list. Last-admin guard. Adapted from old `create-user`. | Deno tests. Integration test in CI with `functions serve`: a non-admin gets 403, and the last admin can't be demoted. | S02 | e | |
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
| R11 | Today v1: rules as pure functions over view rows (chase customer, relay answers, not floated, chase supplier, bid due, decision overdue), minus snoozes, routed to the RFQ owner; collision line; snooze (own rows) | Unit test per rule. The empty state reads as the goal state. Snoozed items disappear until their date. | R09, U05 | |
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
| P03 | Playwright journeys for the three roles on the CI stack | Green in `db.yml`. | M08 | l | |
| P04 | Performance and accessibility pass; CSP tightened; bundle budget | Lighthouse accessibility ≥ 95; initial JS ≤ 300 KB gzip. | P03 | | |

### P8 Import and cutover

I01–I05 start after S06 and run in parallel with P2–P7.

| ID | Deliverable | Acceptance | Deps | ∥ | Flag |
|---|---|---|---|---|---|
| I01 | Import framework (Node TS):<br>• **extract**: old project REST API with an admin session, or the dump<br>• **transform**: pure functions<br>• **load**: service role, deterministic UUIDv5 from old ids; idempotent: delete only rows with a legacy source, reinsert; never touches rows created in v2; companies matched by normalised name<br>• **report**: counts, totals, review CSVs<br>Fixtures built from `seed_historical_data.sql`. | A run against the fixtures twice gives identical ids and counts. Rows created in v2 survive. | S06 | m | |
| I02 | Transforms: companies, sites, contacts, prospects, vendors (driven by the reviewed `mappings/company_merge.csv` and `vendor_parse.csv`) | Ghani's 3 rows become 1 company with 2 sites. "Red Lion USA (via Four Stars)" becomes Four Stars carrying Red Lion. | I01 | m | |
| I03 | Transforms: RFQs (due-date parse, flags, owner reliability), items, inquiries, quote lines (`item_guessed`, `currency_unverified`) | The "31/01/2024" fixture gets the `due_before_received` flag. | I01 | m | |
| I04 | Transforms: orders → items, legs, order_costs; basis resolution against GST invoices; **merge PO 253074 Unit A/B into one order with 2 invoices**; Sapphire A/B kept separate; other flags | 17 seed orders become 16 orders. Invoice totals reconcile. | I01 | m | |
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
| T-14 | The owner returns the reviewed lists: company merges, vendor parse, PO clashes (253074 is already decided), bulk close of stale RFQs with a default reason, FBR mismatches, possible duplicates of trial RFQs. Dry run 2. |
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
| d. Admin CSV export of money tables each month | Free | **Not a restore**; human-readable only | Yes | Useful for Wasif & Co regardless. |

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
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\src\test\rls.integration.test.ts
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\.github\workflows\ci.yml
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\supabase\functions\create-user\index.ts
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\supabase\migrations\seed_historical_data.sql
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\src\lib\dates.ts

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
