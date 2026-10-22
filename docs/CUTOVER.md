# Cutover runbook (I10 rehearsal, I11 go-live)

Who this is for: the owner (not technical) and the orchestrator. Every step says **OWNER** or **ORCH** (orchestrator). Nothing in
this page is a secret. Keys and passwords are typed or pasted by the person named, into the place named, and never into chat,
a file in the repository, or CI.

Related pages: `IMPORT.md` (the loader, the review lists), `SUPABASE.md` (backups, restore), `HOSTING.md` (Vercel, alias),
`BUILD_PLAN.md` section 5 (the plan this follows), `AUDIT_ORDER_LIFECYCLE.md` (open items in its section 5).

Names used below: **old** = the legacy Supabase project (`vptyhluvgnjpvkcbhxsf`). It is only ever read, then frozen. **new** = the v2
project (`yafbphagorydbitfgfmg`). The loader refuses the old project by design.

Targets: the **rehearsal** (same steps, with a practice import) must finish in **under 2 hours**. The real cutover aims at the
same time, with a 30 minute reserve.

---

## 1. T-1 day checklist (all must be ticked; the orchestrator reads it back to the owner)

| # | Check | Who | Done when |
|---|---|---|---|
| 1 | **Key rotation done.** The old project's `service_role` key was rotated in its dashboard (Settings, API) before anything was extracted. The new project's key was never put in the repo, CI or chat. | OWNER | Owner says "rotated"; ORCH notes the date in `DECISIONS.md` (no key text). |
| 2 | **Final backup verified.** The latest `backup.yml` run is green (GitHub, Actions, Backup). The owner downloaded the newest `backup-<date>` artifact and decrypted it with his private age key; the folder holds `public.dump`, `counts.tsv`, `migrations.txt`. ORCH restored it into a local stack: last line `restore ok: N tables, every row count matches`. The owner also downloaded the receipt files (old dashboard, Storage, `gst-receipts`), because backups do not hold files. | OWNER + ORCH | Both lines seen. See `SUPABASE.md`, "Restore, step by step". |
| 3 | **Practice import clean twice.** Two dry runs in a row with the same dump and mapping files: no new review items, every money line in `report.md` shows difference 0, totals unchanged between the two runs. | ORCH runs the report; OWNER runs the live load (types the key) | ORCH confirms "identical". |
| 4 | **Owner sign-off recorded.** The review lists (company merges, vendor parse, PO clashes, price basis, duplicates, FBR mismatches, category mapping) were reviewed; the mapping files are committed (names only); a dated sign-off line is in `docs/` (I08). | OWNER decides, ORCH records | Commit exists on `main`. |
| 5 | **Blocking items closed.** `AUDIT_ORDER_LIFECYCLE.md` section 5, items 1 to 6, are merged. Item 4 (month-end checks counting all history, B3) must be fixed, or the opening bank-tick step in section 3 must be used. The owner re-confirms that no customer ever withholds tax at source (audit Y3). | ORCH; OWNER answers Y3 | Items merged; Y3 answer written down. |
| 6 | **No month is closed** in the new project (the loader refuses otherwise). | ORCH | Money, Month-end, Checklist: "No month is closed yet". |
| 7 | **Staff accounts created.** Settings, **Team**, **Add person** (Full name, Email, Role, Job title, Phone), then **Create account**. The app shows each generated password once; the owner hands it over in person. Roles: Admin, Sales or Engineer. | OWNER (admin) | Everyone is Active in Team. Each person signs in once at a desk and sets their own password (Settings, Change password). |
| 8 | **Phones installed.** The app is on each phone's home screen (Android: browser menu, Install app; iPhone: Share, Add to Home Screen). Test: open it, sign in, Today loads, open Capture. | OWNER with each person | Each person confirmed. |
| 9 | **Hosting ready.** The v2 Vercel project deploys from `main`; `VITE_SUPABASE_URL` and the anon key are set; the final address and the `allowed_origins` plan are written down (`HOSTING.md`, "After the first deploy"). The Cloudflare Pages fallback config is untouched. | ORCH | A preview opens and signs in. |
| 10 | **Quiet time booked** outside office hours, and the freeze message sent (section 2). | OWNER | Message sent. |

If any row is not ticked, do not start. There is no deadline.

---

## 2. Cutover day timeline

Times run from the moment the owner says "freeze". Target total about 1 h 45 min; the rehearsal must stay under 2 h.

| Time | Step | Who | Target |
|---|---|---|---|
| day before | Send the freeze message (below). | OWNER | 5 min |
| 0:00 | **Freeze the old CRM** (2.1). | OWNER | 10 min |
| 0:10 | **Final dump of the old project.** Run the dump query from `IMPORT.md` ("The query for the dump") in the old project's SQL editor (read-only), save it as `import/.data/dump/dump.json`; download the `gst-receipts` files into `import/.data/dump/storage/gst-receipts/`. Copy the dump and the files to **two places**: this is the permanent archive. | OWNER | 20 min |
| 0:30 | **Local report on the final dump** (data stays on the laptop): `npm run import:report -- --dump import/.data/dump --mappings import/.data/mappings --as-of <today>`. Compare with the last practice run; only the expected new rows differ. | ORCH | 10 min |
| 0:40 | **Import run into the new project** (2.2). | OWNER types the key; ORCH watches | 20 min |
| 1:00 | **Verification** (2.3). | ORCH reads; OWNER looks at screens | 20 min |
| 1:20 | **Opening bank-tick decision** (section 3). | OWNER decides; ORCH runs | 5 min |
| 1:25 | **Owner sign-off** of the verification. ORCH records date and time in `DECISIONS.md`. | OWNER | 5 min |
| 1:30 | **Close the old months**: `close_months_through(last month)` (section 4). | ORCH | 5 min |
| 1:35 | **Switch on** (2.4). | ORCH; OWNER checks | 10 min |
| 1:45 | Tell staff; start the watch list (section 6). | OWNER | |

Staff message (WhatsApp, the day before): "Tomorrow from <time> the old CRM stops accepting entries. Do not enter anything in it.
Write what you need to remember on paper or in a WhatsApp note to yourself. The new CRM opens at about <time + 2 hours>. Your
login details are in your hand already."

### 2.1 Freeze the old CRM

Goal: nobody can add or change anything in the old CRM. Do step 1; add step 2 only if people keep trying.

1. **OWNER, in the old project's SQL editor** (Supabase dashboard, SQL editor): revoke INSERT, UPDATE and DELETE on all `public`
   tables from `authenticated` (BUILD_PLAN section 5, T-0 step 2). Reads still work, so old screens open and show data. It is
   reversible with the matching GRANT. ORCH gives the owner the exact statement in the session; the owner types it himself. This is
   the only thing ever run against the old project.
2. **OWNER, optional, Vercel:** in the old app's Vercel project, Settings, Deployment Protection, turn on password protection (or
   remove the domain under Settings, Domains). Do not delete the project. Undo by reversing the setting.
3. **ORCH checks the freeze:** the owner signs in to the old app and tries one edit (it must fail), then opens one screen (it must load).

### 2.2 Import run (commands)

All commands run in the repository folder on the owner's laptop. The key is pasted into a hidden prompt and is not stored.

```
# OWNER types; ORCH watches the screen or the output the owner reads aloud
export IMPORT_TARGET_URL='https://yafbphagorydbitfgfmg.supabase.co'
read -rs IMPORT_SERVICE_ROLE_KEY && export IMPORT_SERVICE_ROLE_KEY
npm run import:load -- --dump import/.data/dump --mappings import/.data/mappings \
  --i-know-this-is-live --allow-project-ref yafbphagorydbitfgfmg
unset IMPORT_SERVICE_ROLE_KEY
```

Pass: the program reads everything back and exits with no error. It refuses if a month is closed, an expense category is missing,
or the money does not reconcile (old = new + left out).

Fail: go to section 5. Re-running is safe: each run first removes what the previous run left behind.

### 2.3 Verification

1. **ORCH** compares `report.md` with the practice run: row counts per table, payments in, expenses (total and per category),
   order value against item net, invoice net and GST. Every difference must be 0.
2. **ORCH** counts rows in the new project (SQL editor, read-only) against `report.json`: companies, RFQs, orders, invoices,
   payments, expenses.
3. **OWNER looks at these screens** (signed in as admin on the new app):
   - **Money, Receivables:** open the three biggest customers; each balance matches your own records.
   - **Money, GST register:** this year's GST total matches the figure you know from FBR; open two old invoices.
   - **Money, Expenses:** this month's total looks right; open one with a receipt photo.
   - **Orders:** open five orders you know. Check the customer PO number, items and suppliers; each shows "Imported from the old CRM".
   - **RFQs:** the open RFQs are the ones you expect; the next RFQ number is the old highest plus one.
   - **Companies:** search three customers; no duplicate names.
   - Orders showing "Price basis unknown" have a **Resolve price basis** action: resolve now or later.
4. **Spot check the 17 seed orders** (BUILD_PLAN section 5): ORCH lists them, OWNER opens each.
5. Anything off: do not continue. Note it; fix the mapping and repeat 2.2, or stop (section 5).

### 2.4 Switch on

1. **ORCH:** point the production address at the v2 Vercel project (alias or custom domain; `HOSTING.md`). Run Actions, Deploy
   functions with `allowed_origins` set to the final address (the value is replaced, not merged). Add the address to Supabase
   Authentication URL settings if sign-in redirects are used.
2. **ORCH:** hard-refresh a deep link such as `/rfqs`; it must load.
3. **OWNER:** sign in from the home-screen app on the phone; Today loads.
4. **OWNER (Team):** the three smoke test accounts (`SUPABASE.md`) may stay. Deactivating them makes the Smoke check fail at
   sign-in on purpose, so deactivate only if you stop wanting that check.
5. **OWNER:** tell staff the new CRM is open. The old link is not used again.

---

## 3. Opening bank-tick decision

Why: every imported payment and expense is a bank item that is **not ticked** (history is not ticked). Without a decision the
month-end checklist and Today's close item would show thousands of permanent "not ticked" checks (audit B3).

The owner decides one date, in words: **"Everything before <date X> is reconciled."** Usually the first day of the first month you
will tick against a real bank statement.

- **If the B3 code fix is merged** (month-end checks count only from the go-live month): nothing to run. ORCH checks that last
  month's checklist shows sensible numbers and skips the SQL.
- **If not**, ORCH runs this once in the new project's SQL editor, after the import and before closing months, and records the
  date in `DECISIONS.md`. It sets the statement month on bank items dated before X that are still unticked:

```sql
-- ORCH. Replace 2026-11-01 with date X. Run once. Bank items only; cash items are never ticked.
update public.payments_in
   set bank_month = date_trunc('month', received_on)::date
 where paid_via = 'bank' and bank_month is null and received_on < date '2026-11-01';
update public.expenses
   set bank_month = date_trunc('month', paid_on)::date
 where paid_via = 'bank' and bank_month is null and paid_on < date '2026-11-01';
```

  Check: **Money, Month-end, Bank tick** for the last month before X shows "Everything ticked". FBR deposits
  (`invoices.tax_bank_month`) are handled the same way only if the GST/FBR check is still noisy; ask the owner first. The audit
  log records these edits.

This proves nothing about the bank balance. From month X on, the owner really ticks against the statement.

---

## 4. Close the old months

After the owner's sign-off, and **never before the final import** (the loader refuses a closed month):

1. **ORCH** (admin session, new project SQL editor). `<last month>` is the first day of the last full month, for example `2026-10-01`:

```sql
select public.close_months_through(date '2026-10-01');
```

   The same is possible in the app: **Money, Month-end, Checklist**, then **Close <month>**. The warning counts are shown; none
   blocks the close. If earlier months are still open the app offers closing through the chosen month.
   Migration 0089 locks the imported months (earliest money month through `qtech.imported_through`, August 2026 unless the
   owner moves it) as "Imported" where imported money rows exist; if it ran before the import, run
   `select qtech_private.lock_imported_months(date '2026-08-01');` as postgres after the import instead.
2. **Check:** on the Checklist, "Closed months" lists every month through the last one, each with a **Reopen** button.
3. Closing freezes payments, expenses and invoices dated in those months. A mistake is fixed with **Reopen** (admin, audited), then close again.

---

## 5. Rollback plan

The old project is never written to, except the freeze. So going back is always possible.

**Case A: the import fails or the numbers do not reconcile (nothing is live yet).**

1. Do not switch on. The production address still points at the old app.
2. **OWNER** undoes the freeze in the old SQL editor (the matching GRANT; ORCH gives the exact text) and removes any Vercel password protection. Staff use the old CRM again; tell them.
3. **ORCH** reads the program's error and the review lists, fixes the mapping or the loader, and the rehearsal repeats. Nothing is lost: each load first removes the previous run's imported rows.
4. If the new project's data is damaged by something other than the import (a wrong SQL run, say): **restore from backup.** ORCH decrypts the newest backup (the owner supplies his private age key on his own laptop; it is never uploaded) and restores as in `SUPABASE.md`, "Restore, step by step". The last line must read `restore ok: N tables, every row count matches`. Then re-run the import.

**Case B: problems found after switch on, inside the rollback window (day 0 to day 3).**

1. Decide with the owner whether it can be fixed forward in hours. Prefer that.
2. If not: **OWNER** re-grants writes on the old project (the GRANT), **ORCH** points the address back to the old app. Anything entered in v2 meanwhile is re-keyed by hand, which is why the window is short.
3. After day 3: fix forward only.

**Archive.** Keep the final dump and the receipt files in two places until the old project is deleted (about day 90). The old project
pauses itself after 7 days idle; the owner can restore it from its dashboard.

---

## 6. Day 1 and week 1 watch list

| When | What to look at | Who | Normal / what to do |
|---|---|---|---|
| Day 1, every 2 hours | Everyone can sign in; Today loads on each phone. | OWNER | "Cannot sign in": Settings, Team, **Reset password**. |
| Day 1 | First real RFQ pasted and floated (Sales). | OWNER | If someone is stuck, send the matching guide from `docs/guides/`. |
| Day 1 | An engineer captures a photo on a real order. | OWNER | Capture saves; it appears on the RFQ or order. |
| Day 1 evening | The night's Backup run is green and has an artifact. | ORCH | Red: fix before the next night. |
| Day 1 | The next RFQ number is the old highest plus one. | ORCH | Otherwise report. |
| Day 2 | Today size. Hundreds of items means imported history is raising rules. | OWNER reports; ORCH tunes | Stale RFQs: bulk close with a reason (`stale_rfqs` list). |
| Day 2 to 3 | Imported orders with "Price basis unknown". | OWNER | Resolve the ones that appear in daily work. |
| Day 3 | Rollback window ends; decide to stay. | OWNER | Record the decision. |
| Week 1 | Payment reminders: pick two real overdue orders, **Copy and mark reminded**. | OWNER | The text has the right invoice numbers and balance. |
| Week 1 | Expense entry used daily by the admin, receipts as photos. | OWNER | |
| Week 1 | First statement month: **Money, Month-end, Bank tick** against the real statement; compare "Ticked, money in" and "Ticked, money out" with the statement totals. | OWNER | A difference means a missing or wrong item. |
| Week 1 | Nightly parity and remote checks green (Actions). | ORCH | Red: investigate. No schema changes in the dashboard. |
| Week 1 | Scheduled jobs still run (GitHub switches them off after 60 days with no repository activity). | ORCH | Re-enable the workflow if needed. |
| Week 1 | Anything staff log twice (minimal logging rule). | OWNER | Report it: fewer fields, never more. |

---

## 7. The ten owner actions, in cutover order

1. Rotate the old project's `service_role` key (Settings, API) before any extraction.
2. Download the newest encrypted backup and prove you can decrypt it with your private age key; download the receipt files from the old dashboard.
3. Run the live practice imports (type the key into the hidden prompt) until two runs in a row are clean.
4. Review the lists and sign off: merges, vendor parse, PO clashes, price basis, duplicates, FBR mismatches, categories. Answer the tax-withholding question.
5. Create the staff accounts on Team (**Add person**), hand over passwords in person, and install the app on every phone.
6. Send staff the freeze time.
7. Freeze the old CRM (the freeze statement in the old SQL editor, optional Vercel password protection), run the dump query, download the receipts; store both in two places.
8. Type the key for the final import, then check the verification screens (Receivables, GST register, Expenses, Orders, RFQs, Companies).
9. Decide date X for the opening bank-tick, then sign off so months through last month are closed.
10. Switch on: confirm the live address works on your phone, tell staff, decide on the smoke accounts, then run the day 1 and week 1 watch list.
