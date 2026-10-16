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
7. **Migration 0055 is on the target project.** It adds the two service-role-only helpers the loader needs (`import_purge_audit`,
   `import_reset_numbers`). Push it through the protected `remote.yml` job like any migration.

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
    mappings.ts             reads the reviewed lists
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
7. Restarts the RFQ and order number counters after the highest number v2 holds (`import_reset_numbers`), so a dry run does not
   use up numbers: RFQ-0177 is RFQ-0177 on every run.
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

1. Rotate the legacy key (precondition 1). Restore the old project from the dashboard if it has paused.
2. In the **old** project's SQL editor (a read-only query; it changes nothing), run the query below and save the result as
   `import/.data/dump/dump.json`. It leaves out `users.password` on purpose. If the editor cannot return one value that large,
   run it once per table (change the outer object to hold one table) and merge the pieces; `parseDump` only needs `{ "tables": { ... } }`.
   A table that does not exist in the old project (for example `documents`) is simply deleted from the list.
3. Download the `gst-receipts` bucket's files from the old dashboard into `import/.data/dump/storage/gst-receipts/<same path>`.
4. **I06:** answer the assumption checklist (below) from the dump and the report.
5. Fill in the mapping files (copy each `import/mappings/*.template.csv` to the name without `.template`, in `import/.data/mappings/`
   for now): `users.csv` first (it names who is who and which owners are only the seed attribution), then the rest as the review
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

### The query for the dump

```sql
select json_build_object(
  'meta', json_build_object('made_on', now(), 'note', 'dump for the v2 import'),
  'tables', json_build_object(
    'users',               (select coalesce(json_agg(t), '[]'::json) from (select id, name, email, role from public.users) t),
    'clients',             (select coalesce(json_agg(t), '[]'::json) from public.clients t),
    'prospects',           (select coalesce(json_agg(t), '[]'::json) from public.prospects t),
    'vendors',             (select coalesce(json_agg(t), '[]'::json) from public.vendors t),
    'rfqs',                (select coalesce(json_agg(t), '[]'::json) from public.rfqs t),
    'rfq_line_items',      (select coalesce(json_agg(t), '[]'::json) from public.rfq_line_items t),
    'supplier_inquiries',  (select coalesce(json_agg(t), '[]'::json) from public.supplier_inquiries t),
    'supplier_quotes',     (select coalesce(json_agg(t), '[]'::json) from public.supplier_quotes t),
    'orders',              (select coalesce(json_agg(t), '[]'::json) from public.orders t),
    'order_engineers',     (select coalesce(json_agg(t), '[]'::json) from public.order_engineers t),
    'gst_invoices',        (select coalesce(json_agg(t), '[]'::json) from public.gst_invoices t),
    'invoices',            (select coalesce(json_agg(t), '[]'::json) from public.invoices t),
    'payment_records',     (select coalesce(json_agg(t), '[]'::json) from public.payment_records t),
    'order_payments',      (select coalesce(json_agg(t), '[]'::json) from public.order_payments t),
    'supplier_payments',   (select coalesce(json_agg(t), '[]'::json) from public.supplier_payments t),
    'payables',            (select coalesce(json_agg(t), '[]'::json) from public.payables t),
    'payable_payments',    (select coalesce(json_agg(t), '[]'::json) from public.payable_payments t),
    'expenses',            (select coalesce(json_agg(t), '[]'::json) from public.expenses t),
    'recurring_expenses',  (select coalesce(json_agg(t), '[]'::json) from public.recurring_expenses t),
    'follow_up_actions',   (select coalesce(json_agg(t), '[]'::json) from public.follow_up_actions t),
    'quarterly_targets',   (select coalesce(json_agg(t), '[]'::json) from public.quarterly_targets t),
    'documents',           (select coalesce(json_agg(t), '[]'::json) from public.documents t)
  ),
  'storage', (select coalesce(json_agg(json_build_object('bucket', bucket_id, 'path', name,
                'size_bytes', (metadata ->> 'size')::bigint, 'mime_type', metadata ->> 'mimetype')), '[]'::json)
              from storage.objects where bucket_id = 'gst-receipts')
) as dump;
```

(The query was written from the old repository's types and migrations, not run against the live schema. If a column or table is
missing, the editor says so; fix the line.)

## What the owner reviews (I08)

Each list is a CSV in the report folder: `table, old_id, label, detail`. The decisions go into the mapping files (names only; no
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
| `owner_attribution` | A person who owns most of the records (probably the seed attribution) | Are their attributions real | `users.csv` (`owner_reliable`) |
| `storage_missing` | Receipt files not in the dump, or over 5 MB | Fetch them | the dump folder |
| `dropped_rows` | Every row that could not be imported, with the reason | Nothing, unless it matters | |
| `warnings` | For example a non-empty `documents` table | Look | |

## The numbers that must agree

`report.md` has one table: **payments in, expenses (in total and per category), order value against item net, invoice net and GST**,
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

1. **Which RFQ numbers are the customer's own.** `rfq_number` becomes `customer_ref` unless it looks like Q-Tech's own series (`RFQ-12`, `QT-12`, `QTECH12`). A repeat of a customer reference on the same company keeps only the first (`customer_ref_duplicate`).
2. **Composite vendor names.** A vendor name is flagged `name_unparsed` only when it looks composite (brackets, "via", a slash) and is not in `vendor_parse.csv`; plain names import as they are without a flag, so the list stays short.
3. **Invoices with no GST row** (bookkeeping invoices, `orders.invoice_number`): net = the old amount, GST = 0, flag `invoice_basis_unknown`, because nothing says whether the old amount included GST. Their orders are flagged `value_basis_unknown` too. Resolving the basis on an order rewrites its item prices, not these invoices, so the admin may need to correct the invoice as well.
4. **`paid_via` of legacy payments in is 'bank'** (the old `payment_method` is kept only in `legacy_source`), as for expenses (A6.2). If cash receipts matter for the bank tick, say so.
5. **Owner reliability** comes from `users.csv` (`owner_reliable`), not guessed. A person who owns 70% or more of the records is listed in `owner_attribution`.
6. **One quote line per supplier and item.** The old quotes are RFQ-level, so several quotes from one supplier on one RFQ land on the same item; the newest wins and the others are listed in `dropped_rows`.
7. **Payable payments that repeat a supplier payment** (same amount, same day, same supplier) are counted once.
8. **Mixed-status merged orders** (PO 000001): the merged leg counts as delivered only when every member order was; its date is the latest.
9. **Received.** There is no Received step (owner, 2026-10-15): the leg's `received_on` is its `delivered_on`.
10. **Family tags** are created for every product type in the old data, including those only on rows that could not be imported.
