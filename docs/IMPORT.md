# Importing the old CRM's data (P8)

Status: **I01 to I05 are built and tested against synthetic fixtures only.** No real data has been read, and nothing has been
written to any live project. I06 (assumption checklist), I07 (dry run 1) and everything after it need the owner's dump and the
owner's hands. This page is the runbook for those steps.

## Preconditions (read these before any live step)

These are conditions, not suggestions. If one is not true, stop.

1. **The legacy `service_role` key is rotated first.** It has been in the old repo's history; treat it as exposed. Rotate it in the
   old project's dashboard (Settings, API) before anyone extracts anything, and never put the new key in this repository, in CI, or
   in a chat.
2. **The owner is present** for every step that touches a live project (the extraction, each dry run, the cutover). The loader asks
   for explicit flags precisely so that it cannot run by accident or from a script someone else started.
3. **Nothing is ever written to the old project.** It is the source and the archive. The loader refuses it by its project ref, with
   or without flags. The only action on it is the freeze at cutover (BUILD_PLAN section 5), which the owner types himself in its SQL editor.
4. **Raw data stays on the owner's machine**, in `import/.data/` (gitignored). The dump, the receipt files and the review CSVs
   (which name real companies) are never committed, pasted into a pull request, or uploaded to CI. Only the reviewed mapping files
   (`import/mappings/*.csv`, names only) are committed, at I08.
5. **Credentials come from the environment, never from a file.** `IMPORT_TARGET_URL` and `IMPORT_SERVICE_ROLE_KEY` are read from the
   shell that runs the command. The program reads no `.env` file and takes neither value as an argument (shell history).
6. **Backups are live** (R13) before the first live load, and **no month is closed** in the target (the loader refuses otherwise:
   there is no service-role bypass of the month lock). Close months only after sign-off: `close_months_through(last month)`.
7. **Migrations 0055 and 0056 are on the target project.** They add the two service-role-only helpers the loader needs
   (`import_purge_audit`, and `import_reset_numbers` with a floor per number series). Push them through the protected
   `remote.yml` job like any migration.

## What is built

```
import/
  src/
    cli.ts                  report | load | extract-live
    extract/                dump reader (JSON file or folder), live extractor (a refusing stub)
    transform/              pure functions: companies, rfqs, orders, money, and the entry point transformAll()
    load/guard.ts           decides whether the loader may talk to a database
    load/loader.ts          delete the previous run's rows, insert, purge its audit rows, read back
    report/report.ts        report.md, report.json, one CSV per review list
    i06/checklist.ts        the section 8 assumptions as confirmed / adjusted / unknown, from a dump
    mappings.ts             reads the reviewed lists
  dump/dump.sql            the read-only script the owner runs in the old project's SQL editor
  dump/make-old-schema.mjs a stand-in old schema from a dump (for the load test of dump.sql)
  mappings/*.template.csv   the lists the owner fills in (names only)
  fixtures/legacy/          a SYNTHETIC copy of the old database (dump.json + a receipt file)
  fixtures/mappings/        the reviewed lists for the fixtures
  test/                     unit tests, and the load test that runs in db.yml
```

* **Extract.** Today only a dump file is read. `LiveExtractor` (old project REST API with an admin session) is an interface that
  refuses to run, with or without flags, until I07: the owner runs that extraction on his own machine.
* **Transform.** `transformAll(dump, mappings, { asOf, v2Users })` is pure: no clock, no network, no database. The same input gives
  the same ids, rows and review lists, whatever order the dump lists its rows in (unit tested).
* **Load.** Service role. Idempotent and additive (below).
* **Report.** Counts, old against new money totals, and the review CSVs.

### The ids and the "legacy marker"

Every id the import makes is a **version 5 UUID** (SHA-1, one fixed namespace) built from the old row's id (a company's id comes
from its normalised name, because companies are matched by name; a merged order takes the id of its earliest member). Everything v2
creates is a random **version 4** UUID. So "is this row ours?" is "is its id version 5?", which works for tables with no
`legacy_source` column too (sites, contacts, brands, attachments, recurring expenses). On tables that do have `legacy_source`, the
loader also requires it to be set before it deletes.

### What a load run does, in order

1. Refuses unless the guard allows the target (below), no month is closed, and every expense category the data names exists.
2. **Refuses, deleting nothing,** if any row v2 made points at an imported row (it would be changed or deleted by step 4).
3. Reads the people from the target's `users` table (the mapping `users.csv` says who is who).
4. Deletes every imported row of the previous run, in reverse foreign-key order, and the receipt files it stored.
5. **Reuses** a company, brand or site that v2 already holds under the same normalised name (a trial RFQ for the same customer):
   imported rows point at the v2 record, which is never edited or deleted.
6. Handles unique keys v2 already uses: an RFQ customer reference, a PO number, an invoice number. The imported row is flagged
   (`customer_ref_duplicate`, `po_shared`, `number_duplicate`), still imported, and listed in `trial_duplicates.csv` or `po_clashes.csv`.
7. Makes Q-Tech's own number series continue (`import_reset_numbers`, 0056): the RFQ, order, quotation and supplier PO counters
   are each set to max(highest number in use, highest imported Q-Tech number) + 1. The transform finds the highest imported
   number from the old `rfq_number` values shaped like ours (`RFQ-0177` is RFQ 177, `QT-0042` is quotation 42), so after an
   import whose highest RFQ was RFQ-0177 the next RFQ is RFQ-0178, and a dry run does not use up numbers. Orders and supplier
   POs have no old number to read, so their floor is 0 (they continue after whatever v2 holds; the PO start value is the
   owner's Q5 setting).
8. Inserts, in foreign-key order, in batches. A failing batch is retried row by row so the message names the row.
9. Copies the receipt files into the `gst-receipts` bucket (from `storage/gst-receipts/` next to the dump).
10. Removes the audit rows its own writes caused (`import_purge_audit`: only version 5 ids, only rows written with no signed-in user).
    That includes the rows of the tables with no id column (brand links, engineer links), found through the import id they contain. Audit rows of a person's later edits are kept.
11. **Reads everything back** and compares row counts and Σ payments, Σ expenses, Σ invoice net and GST with the transform.

A run is **not atomic** (the API has no multi-statement transaction). Re-running is always safe: step 4 removes whatever a run that
stopped half way left behind. 

### The guard

`assertTargetAllowed` (unit tested) is the only gate:

* The **legacy project** (`vptyhluvgnjpvkcbhxsf`) is refused outright, in the URL, the key, or the key's `ref` claim, with or without flags.
* A **local stack** (`localhost`, `127.0.0.1`, `::1`, `*.localhost`) needs no flags.
* A **hosted project** needs `--i-know-this-is-live` **and** `--allow-project-ref <ref>` with the URL's ref. The key must be a
  service-role key for that same project. Any other host is refused.

## Trying it on the fixtures (works today)

```
npm run import:report -- --dump import/fixtures/legacy --mappings import/fixtures/mappings --as-of 2025-03-01
```

writes `report.md`, `report.json` and the review CSVs to `import/.data/out/`. To load them into a local stack:

```
npx supabase start && npx supabase db reset
eval "$(npx supabase status -o env | sed 's/^/export /')"
IMPORT_TARGET_URL="$API_URL" IMPORT_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
  npm run import:load -- --dump import/fixtures/legacy --mappings import/fixtures/mappings --as-of 2025-03-01
```

(the fixture mapping `users.csv` names the seed users of `supabase/seed.sql`). `db.yml` does exactly this twice, in its last step,
and checks that the second run changes nothing, v2 rows survive, and row security still holds. `npm run import:fixtures`
rebuilds `import/fixtures/legacy/dump.json` from `build-legacy-dump.mjs`.

## I06 and I07: making the dump and the first dry run (owner)

1. Rotate the legacy key (precondition 1; the steps are in "Rotating the old project's keys" below). Restore the old project from the dashboard if it has paused.
2. In the **old** project's SQL editor, paste and run `import/dump/dump.sql` (read-only, one SELECT; see "The dump script" below) and save the
   result as `import/.data/dump/dump.json`.
3. Download the `gst-receipts` bucket's files from the old dashboard into `import/.data/dump/storage/gst-receipts/<same path>`.
4. **I06:** run `npm run import:i06 -- --dump import/.data/dump` (see "The I06 checklist" below) and settle every adjusted or unknown item.
5. Fill in the mapping files (copy each `import/mappings/*.template.csv` to the name without `.template`, in `import/.data/mappings/`
   for now): `users.csv` first (it names who is who), then the rest as the review
   lists suggest.
6. **Dry run first on a local stack** with the real dump (the data never leaves the laptop), then read the lists.
7. **I07, dry run 1 into the new project.** With the owner present:

```
export IMPORT_TARGET_URL='https://<new-project-ref>.supabase.co'
read -rs IMPORT_SERVICE_ROLE_KEY && export IMPORT_SERVICE_ROLE_KEY      # paste the key; it is not echoed or stored
npm run import:load -- --dump import/.data/dump --mappings import/.data/mappings \
  --i-know-this-is-live --allow-project-ref <new-project-ref>
unset IMPORT_SERVICE_ROLE_KEY
```

The program refuses unless the money reconciles (old = new + left out on every line), and exits non-zero if the read-back
disagrees. Dry runs 2 and 3 (I09) are the same command; two in a row must produce no new review items and unchanged totals.

### The dump script

`import/dump/dump.sql` is one script: paste the whole file into the old project's SQL editor and run it. It is a single `SELECT`
(a test checks that it contains no statement that writes or changes anything) and returns one row with one column, `dump`: the
JSON the reader expects.

* It reads each table with `to_jsonb(row)`, so whatever columns the old table really has are the columns you get. Nothing is named,
  so a column that drifted into production without a migration comes through, and a missing one cannot stop the script.
* A table the old project does not have comes out empty and is listed under `meta.tables_missing`.
* `users.password` (a plain-text password in the old schema) is removed. `employees`, `attendance`, `follow_up_actions`,
  `cost_lines` and `audit_log` are counted, not copied (HR data and machine-generated rows the new model drops).
* `catalog` records the shape of the old database for the I06 checklist: columns and types, check and unique constraints, triggers,
  functions, views, cron jobs (name and schedule only), login providers (counts only), storage buckets. No keys, passwords, e-mail
  addresses or cron command text.
* If the result is too big for the editor, edit the line `'all'::text as parts` to `'a'`, run, save as `dump.json`; change it to
  `'b'`, run, save as `dump-b.json` in the same folder. The reader joins them. (A few hundred orders is well under a megabyte, so one
  run is normal.)

Save the cell's value as `import/.data/dump/dump.json` (in the results grid, click the cell and use the copy button, or export
the result as JSON). Never commit it. The load test in `db.yml` proves the script: it builds a stand-in "old" schema from the
fixtures in the CI database, runs `dump.sql` against it in a read-only transaction, reads the output with the real reader, and
checks that the transform of it equals the transform of the fixtures.

### The I06 checklist

```
npm run import:i06 -- --dump import/.data/dump
```

prints each of the 25 section 8 assumptions as **confirmed** (the data agrees), **adjusted** (the data disagrees; the evidence says
what and what the import does about it) or **unknown** (the dump cannot tell; the evidence says what to check by hand: the Postgres
version of the new project, the free-tier slot, the exchange-rate terms), each with the numbers behind it, and writes `i06.md` next to
the report. Every item must end confirmed, or adjusted with the fix linked, before I07.

### Performance

`import/test/perf.test.ts` (in `ci.yml`) builds a dump 50 times the size of the fixture (about 7,000 source rows), runs the whole
transform, the report and the checklist, and fails if that takes more than two minutes. It takes well under a second today; the
budget is there to catch an accidental quadratic loop.

## Rotating the old project's keys (do this before any extraction)

Why: the old project's `service_role` key sat in the old repository's history. Anyone who ever saw it can read and change all the
old data. Rotating makes every old key stop working. It takes about 15 minutes and you can do it in the same sitting as the
dump. **Do it with the old CRM's users warned**: it signs everyone out.

**Before you start**
1. Tell the team the old CRM will sign everyone out for a few minutes. Nobody should be mid-entry.
2. Open the old project's dashboard (the one that is not `yafbphagorydbitfgfmg`) and the old CRM's project in Vercel in two tabs.
3. If the old project has paused, press Restore project and wait until it says Healthy.

**In the Supabase dashboard (old project)**
There are two layouts; use the one you see.
* *If Project Settings has an **API Keys** page with two tabs, "Publishable and secret API keys" and "Legacy anon, service_role API keys":*
  1. Open Project Settings, API Keys.
  2. On the "Publishable and secret API keys" tab, create a publishable key and a secret key. Copy the publishable key; you will give it to Vercel below. You do not need the secret key at all.
  3. On the "Legacy anon, service_role API keys" tab, switch the legacy keys off (Disable). This is what kills the old leaked `service_role` and `anon` keys.
  4. If the page also offers to change the JWT signing keys or "JWT secret", do it as well: open Project Settings, JWT Keys (or API, JWT Settings), and Generate a new secret / rotate. This signs everyone out and makes any key signed with the old secret useless.
* *If Project Settings, API shows "JWT Settings" and "Project API keys" on one page:*
  1. Open Project Settings, API.
  2. Under JWT Settings, press Generate a new JWT secret and confirm. Supabase issues a new `anon` and a new `service_role` key at the same time; the old ones stop working.
  3. Copy the new `anon` key (the "public" one). Do not copy or save the `service_role` key anywhere.

**What stops working, and what to fix**
* **Everyone is signed out of the old CRM.** Their sessions were signed with the old secret. They sign in again with the same e-mail and password. Nothing is lost.
* **The old CRM on Vercel stops loading data** until it has the new anon (or publishable) key. In Vercel: the old CRM's project, Settings, Environment Variables, find the variable that holds the Supabase anon key (it is named like `VITE_SUPABASE_ANON_KEY`; the URL variable does not change), edit its value to the new key for Production (and Preview if it has one), save, then Deployments, the latest one, the three dots, Redeploy. The key is baked into the build, so a redeploy is required.
* **Edge Functions of the old project** (for example the user-creation function) read the project's keys from the platform, so they pick up the new ones. If creating a user from the Team page fails afterwards, redeploy that function from the dashboard (Edge Functions, the function, Deploy).
* **Your own copies**: any local `.env` file of the old repo, any script or note that holds the old keys. Delete the old keys there; they no longer work and must not be reused. Never paste the new `service_role` key into a chat, an issue, or this repository.
* **The import does not need any key**: the dump is made in the SQL editor, which uses your dashboard login.

**Check that it worked** (five minutes)
1. *The old keys are dead.* In PowerShell, with the old project URL and an OLD anon key you still have (from a note or the old Vercel settings screen history):
   `Invoke-WebRequest -Uri "https://<old-project-ref>.supabase.co/rest/v1/clients?select=id&limit=1" -Headers @{ apikey = "<old anon key>"; Authorization = "Bearer <old anon key>" }`
   It must fail with 401 (Invalid API key or JWT). Do the same with the old `service_role` key if you have it: also 401.
2. *The new key works.* The same request with the new anon key must NOT be 401. It returns an empty list `[]` (or 401/permission-style "no access" for a table that anonymous users may not read, which is also correct): the point is that it is not "Invalid API key".
3. *The old CRM works again.* Open the old CRM in a private window, sign in, and open the RFQs page: data loads. If it shows an empty app or "Invalid API key", the Vercel variable or the redeploy was missed.
4. *Nothing else still uses the old key.* In the old project's dashboard, Logs, API Edge / Postgres logs: after the rotation there should be no requests with the old key succeeding.
5. Write the date and that all four checks passed in the I08 sign-off note in `docs/`.

## What the owner reviews (I08)

Each list is a CSV in the report folder: `table, old_id, label, detail` (`invoice_duplicates` and `still_owed` add their own columns). The decisions go into the mapping files (names only; no
phone numbers, e-mail addresses or amounts), which are then committed; the sign-off is recorded in `docs/`.

| List | What it is | Decide | Edit |
|---|---|---|---|
| `company_merges` | Which old names became which company and site, plus **possible duplicates** that differ only in spelling or legal suffix | Is it one company? | `company_merge.csv` (`old_name,company,site`) |
| `vendor_parse` | Vendor names parsed into company and brand, and composite names left as they are (`name_unparsed`) | Is "X (via Y)" really Y carrying X? | `vendor_parse.csv` (`old_name,company,brand,country`) |
| `po_clashes` | Orders of one company sharing a PO number. PO 000001 is already merged; any other is kept apart with `po_shared` until you say | merge or po_shared | `po_clashes.csv` |
| `stale_rfqs` | Open RFQs quoted more than 180 days before the run | Bulk close, with which reason (done in the app after cutover) | none |
| `trial_duplicates` | Imported RFQs, invoices that collide with, or look like, a record entered in v2 | Keep or delete the trial one | in the app |
| `fbr_mismatches` | GST rows whose FBR status and dates disagree | Which is right | in the app after import |
| `cost_double_counts` | Orders with both supplier payments and an Inventory/Procurement expense, and payable payments linked to an expense | Is the cost counted twice? | delete the duplicate in the app |
| `basis_unknown` | Every order whose old value could not be proven to be net (`value_basis_unknown`), with a hint when the GST invoice suggests it is gross | Resolve each: net or gross | the admin's "Resolve price basis" in the app |
| `unparseable_dates` | A date the program could not read, or a due date before the received date | Correct it | in the app |
| `no_offer_phrases` | RFQ notes that say a supplier "could not find offer" | Tag it | in the app |
| `category_unmapped` | Expense categories with no new category (they land in Other, flagged) | Which category | `expense_categories.csv` (`legacy_category,category`) |
| `margin_anomalies` | Sale about equal to, or below, cost | Is the cost right | in the app |
| `storage_missing` | Receipt files not in the dump, or over 5 MB | Fetch them | the dump folder |
| `invoice_duplicates` | Bookkeeping invoices matched to a GST invoice (not imported), and same-PO rows of another customer (not matched), with both amounts and their ratio | Is it the same sale? | `company_merge.csv` when a customer name is missing |
| `still_owed` | Every imported old invoice with an open balance | Paid or still owed | `legacy_invoice_status.csv` (`invoice_number,status`) |
| `settled_before_cutover` | An invoice with no order that is paid in full (old status, or `paid` in `legacy_invoice_status.csv`): imported with `settled_before_cutover` = true, no payment (columns: invoice number, customer, date, gross, reason `status` or `owner_list`) | Nothing: it counts as received before the new system | |
| `payments_not_placed` | An invoice with no order that the old status says is paid only in part (a payment needs an order; the rest is in `still_owed`) | Nothing, or settle it in `legacy_invoice_status.csv` | |
| `dropped_rows` | Every row that could not be imported, with the reason | Nothing, unless it matters | |
| `warnings` | For example a non-empty `documents` table | Look | |

## The numbers that must agree

`report.md` has one table: **payments in (from payment rows, and from paid status), expenses (in total and per category), order value against item net, invoice net and GST**,
each as old, new, left out, difference. The difference must be 0 on every line; "left out" lists only rows that cannot be imported
(a zero or negative amount, a row linked to nothing). A second table lists every order that has invoices: item net against
invoice net, which must agree wherever the basis is proven (it deliberately shows the difference for an order flagged
`value_basis_unknown`).

## Assumptions (DATA_MODEL section 8): what the old code settles, and what only the dump can

Read from the old repository (not from any live project):

* **#10** `received_date` and `tcs_receipt_date` are not fields of the old GST form (it has TCS departure date, Client received on,
  TCS receipt number), so they are probably always empty. Imported anyway (`copy_received_on`; `tcs_receipt_date_differs` flags a
  disagreement with the departure date). The dump decides whether `copy_received_on` can go.
* **#15** The old register computes GST as `round(amount x 18 / 118)` per **invoice**, in whole rupees, from an amount that
  **includes** GST. The import therefore reads `gst_invoices.amount` as **gross** and takes net = amount - gst_amount. (This corrects
  a reading of the old table as net; the old screens label it "Amount (incl GST)".)
* **#16** The old code only knows 18%: no exempt rate exists in its forms or checks. Every imported item is 18%. The dump confirms
  there is no other rate in use.
* **#8** The old reconciliation code states that bookkeeping `invoices`, `payment_records` and `payables` are dead tables no page
  reads or writes. Consistent with the plan; the dump says whether they hold more than seed rows.
* **#23** `supplier_quotes.received_at` is set to the time the quote was **typed in** (RFQDetailPage), not asked of the supplier, so
  it is not a reliable reply date. It is not imported as one; legacy quote lines stay out of reply-time medians.
* **#1** The twelve tables without DDL are read tolerantly (a missing column is treated as empty). Their exact shape still needs the dump.

Only the dump can settle: #2 (date formats and how many fail), #3 and #4 (duplicate counts), #5 and #25 (currencies in
`supplier_quotes`; the transform flags every row `currency_unverified` regardless), #6 (status values), #7 (cost double counts),
#9, #11, #12, #13, #14, #19, #20, #21, #22. #17, #18, #24 are about the new project and the exchange-rate source, not the import.

## Choices made in the transforms that the owner may want to change

Each is one small rule in `import/src/transform/`, covered by a test.

1. **Which RFQ numbers are the customer's own (confirmed).** `rfq_number` becomes `customer_ref` unless it looks like Q-Tech's own series (`RFQ-12`, `QT-12`, `QTECH12`). A repeat of a customer reference on the same company keeps only the first (`customer_ref_duplicate`).
2. **Composite vendor names (confirmed).** A vendor name is flagged `name_unparsed` only when it looks composite (brackets, "via", a slash) and is not in `vendor_parse.csv`; plain names import as they are without a flag, so the list stays short.
3. **The GST register wins over a bookkeeping invoice of the same sale (owner, 2026-10-19).** A bookkeeping invoice (old
   `invoices`, INV-2024-xxx) is a duplicate when, for the same customer (resolved through `company_merge.csv`, so the Ghani Glass
   plants count as one), its PO equals one of the PO numbers of a `gst_invoices` row. Its PO comes from its notes ("PO 251809."),
   else its order's `customer_po_number`, else the order's notes ("PO# 251809"); a register cell may list several ("253074 &
   252993 & 254040"); "PO", "#", spaces and case are ignored. A duplicate is not imported: it is in `dropped_rows` ("duplicate of
   GST invoice <n>") and in `invoice_duplicates.csv` (bookkeeping number, PO, its amount, GST number, GST gross, ratio) so you can
   check each match; its amount is counted under "left out" on the Invoice net line. The same PO on a register row of a
   **different** customer is not a match; it is listed there too (`match` = "not matched: customer differs") so a missing
   `company_merge.csv` line shows up. A register row with no order link takes the order of its twin when all its twins point to
   one order (`order_from_bookkeeping_twin`); one spanning several orders stays with the company.
   **Old invoices with no GST split** (bookkeeping invoices with no GST twin, `orders.invoice_number`) import as before, with net = the old amount and GST = 0.
   The review flag `invoice_basis_unknown` ("check whether this amount includes GST") is put **only on invoices linked to an
   order (customer PO)**. An invoice with no order link (a bookkeeping invoice that names only a customer) imports without that
   flag; its original row stays in `legacy_source`, so it is still traceable. *This is my reading of the owner's rule; correct it
   here if it is wrong.* The orders those invoices belong to carry `value_basis_unknown` as before, and resolving an order's basis
   rewrites its item prices, not these invoices, so the admin may need to correct the invoice as well.
4. **A payment the old database holds is a payment received**, imported with `paid_via` = bank and `bank_month` empty. Cash is
   not flagged, even where the old `payment_method` says Cash (it stays in `legacy_source`). Same for expenses (A6.2).
   **So is a paid status (owner, 2026-10-19).** The old database has almost no payment rows; "paid" lives in
   `invoices.payment_status` and `orders.status`. (a) A bookkeeping invoice marked Paid becomes a payment of its `amount_paid` on
   the invoice it ends up as: itself, or its GST twin. If all twins of a GST invoice are Paid, the GST invoice is paid in full (its
   gross); otherwise (Partial) the amount recorded, capped at the GST gross, flagged `payment_partial_legacy`. A register row
   spanning several orders gets one payment per twin, on the twin's order (`payment_on_twin_order`). (b) An order marked
   `payment_received`: every invoice of it with no payment yet is paid in full (`paid_per_order_status`). Never where payment rows
   exist for that invoice or order (no double count). Date: the old invoice due date, else the order's `payment_due_date`, else
   invoice date + payment terms, else invoice date, never after the run date; every such payment is flagged
   `payment_date_estimated`. Bank, not ticked, credited to nobody (rule 5). A payment needs an order. **An invoice with no order
   that is paid in full (owner, 2026-10-19) is settled before cutover:** no fake order and no fake bank payment; the invoice is
   imported with `settled_before_cutover` = true (migration 0068), listed in `settled_before_cutover.csv` (reason `status` or
   `owner_list`), and the database treats it as fully received: not in "who owes us" (`aging_as_of`), never overdue, never
   reminded. It is still a sale and output GST (GST register, `v_gst_month`). One paid only in part is listed in
   `payments_not_placed.csv` and counted as left out (its rest is in `still_owed.csv`). These payments have their own
   reconciliation line ("Payments in, from paid status": old = new + left out + settled before cutover) and notes in `report.md`;
   the loader's read-back also checks that exactly the transform's invoices carry the mark.
   **Everything else old and unpaid is listed, not assumed:** `still_owed.csv` has every imported invoice left with an open
   balance (number, customer, date, gross, open, PO, linked to an order or not). Answer it in the optional
   `import/.data/mappings/legacy_invoice_status.csv` (template `import/mappings/legacy_invoice_status.template.csv`,
   `invoice_number,status`): `paid` records a payment of what is open (`paid_per_owner_list`, date = invoice date + terms, never
   after the run date, `payment_date_estimated`); `owed` keeps it open and off the list; an invoice with no line stays open and
   listed. No file = no lines.
5. **Credit for old sales: nobody, for now.** `credited_user_id` is NULL on every imported payment, so none of them counts toward
   anyone's target (`v_payment_net` marks them `unattributed`; a load-test checks this). The `owner_reliable` column of `users.csv`
   and the `owner_unreliable` flag and `owner_attribution` list are gone: `users.csv` now only says who is who (an old `owner_reliable`
   column is ignored). The owner's `owner_id` on old RFQs and orders is kept as recorded and carries no credit.
   **TODO (owner decision, later):** who gets credit for old sales; the admin can assign credit per payment afterwards.
6. **One quote line per supplier and item.** The old quotes are RFQ-level, so several quotes from one supplier on one RFQ land on
   the same item; the newest wins and the others are listed in `dropped_rows` (confirmed by the owner).
7. **Payable payments that repeat a supplier payment** (same amount, same day, same supplier) are counted once.
8. **Mixed-status merged orders** (PO 000001): the merged leg counts as delivered only when every member order was; its date is the latest.
9. **Received.** There is no Received step (owner, 2026-10-15): the leg's `received_on` is its `delivered_on`.
10. **Family tags** are created for every product type in the old data, including those only on rows that could not be imported.
