# Security review (P9)

Date: 2026-10-19. Scope: everything added since migration 0038 (0038 to 0056), plus the older objects those touch: the
month lock (0027, 0028), the money views (0015, 0018), storage buckets and policies (0012, 0022, 0026), the
`admin-users` Edge Function, the import tool (`import/`), the PWA share target and Capture store, the CSP
(`public/_headers`, `vercel.json`), the GitHub workflows, and the committed tree of this public repository.

Method: every finding below was read in the code. Where the database can show it, a pgTAP test shows it:
`supabase/tests/0057_security_hardening.test.sql` proves the fix of H-1, adds schema-wide guards, and records each
medium or low database finding as the secure behaviour inside `todo_start`/`todo_end` (it fails today, which is the
demonstration, without failing the run; it turns green when the gap is fixed). The S14 matrix
(`0025_access_matrix.test.sql`) gains the rows for H-1. Nothing was run against the live project.

The roles the review checks against: admin sees everything; sales see invoices, the GST register and order balances;
engineers never see money (payments, expenses, costs, margins, cash, invoices); a deactivated user and anon get nothing.

## Summary

| ID | Severity | Finding | Status |
|---|---|---|---|
| H-1 | High | Any staff member could replace or re-point the PDF of an issued quotation or supplier PO, with any content type | **Fixed in 0057** |
| M-1 | Medium | A closed month's net income, team credit and target progress still change when order data changes, including by engineers | **Fixed in 0065** (closed-month P&L also frozen at close by 0058) |
| M-2 | Medium | Any staff member can reassign an order's owner, which decides who is credited with the next payment (targets) | **Fixed in 0065** |
| M-3 | Medium | Selling prices are hidden from engineers by the app only; the database grants them to all staff (section 10) | **Owner decision 2026-10-22** (replaces 2026-10-19): engineers see no prices and the app no longer fetches them; DB grants unchanged (residual) |
| L-1 | Low | Actor columns can be named by the caller: the chase actor (0048) and every `created_by` | **Fixed in 0065** |
| L-2 | Low | anon keeps Supabase's default grants on the sequences in `public` | **Fixed in 0065** |
| L-3 | Low | pg_net's `net.http_get` keeps Supabase's execute grant to anon and authenticated | **Cannot be changed by the project** (platform grant); not reachable |
| L-4 | Low | The share target accepts a cross-site form POST to `/capture` | **Mitigated** (draft only, capped; app) |
| L-5 | Low | Capture drafts and RFQ recents stay on the device after sign-out | **Fixed** (app) |
| L-6 | Low | Files attached to a closed month (GST receipts, expense receipts) are not locked | **Fixed in 0065** |
| L-7 | Low | `rfq-files`, `gst-receipts` and `expense-receipts` accept any content type | **Fixed in 0065** |
| I-1 | Info | Auth settings in `config.toml` are weak; the live values are set in the dashboard and were not checked | Owner checklist in Round 2 |
| I-2 | Info | No secrets and no real customer data found in the committed tree | No action |

No critical finding. Checked and found sound: see "Reviewed and clean" at the end. Round 2 (migration 0065, the app changes for
L-4 and L-5, and the owner's M-3 decision) is in "Round 2: the fixes" below; the finding sections keep the original
evidence.

## H-1 (High, fixed): issued quotation and PO PDFs could be replaced by any staff member

**Evidence.**
- `generated-docs` storage policy (0012, 0022): `qtech_objects_update` was `can_access_bucket(bucket_id)`, which is true
  for every active role, so sales and engineers could overwrite any object, including the stored PDF of an issued
  document. The app uploads with `upsert: true` (`src/features/quotations/api.ts` `storePdf`,
  `src/features/purchaseOrders/api.ts`), which is an UPDATE when the object exists.
- `lock_issued_document()` (0022) froze every column of an issued quotation or PO except `pdf_path`, for everyone, so
  any staff member could point an issued document at another object or clear it.
- The bucket had no `allowed_mime_types`, so the uploader chose the content type.
- The app opens a stored PDF by `storage.download()` and `URL.createObjectURL(blob)` in a new tab
  (`QuotationsPanel.tsx`, `useOpenPoPdf.ts`, `IssuePoDialog.tsx`). The blob keeps the response content type, so a file
  stored as `text/html` renders as a page on the app's own origin. The CSP that a blob document inherits
  (`script-src 'self'`) blocks its scripts, but the page itself (a fake sign-in form, misleading content) still renders.

**Impact.** The PDF is what the customer or the supplier receives. An engineer or a sales user could silently replace
an issued quotation (prices, terms) or PO, or swap which file a document points at, and the next person who opens or
shares it sends the altered file. The database row stays "issued and frozen", so nobody would look.

**Fix (migration 0057).**
1. `generated-docs` accepts `application/pdf` only.
2. `qtech_objects_update` is recreated: in `generated-docs`, an object that a quotation or PO `pdf_path` points at can be
   updated (overwritten, moved, renamed) by an admin only. Objects nobody points at stay open to all staff, so first
   generation (upload with upsert, then set `pdf_path`) is unchanged for sales and engineers.
3. `lock_issued_document()`: staff can attach the first PDF (NULL to a path) or write the same path again; changing or
   clearing an attached path is admin only (errcode 42501). Writes with no signed-in user are not limited.

**Proof.** pgTAP `0057_security_hardening.test.sql` part 1 (engineer and sales refused on overwrite, move,
re-point and clear (an upload with upsert onto an existing object is checked by the same UPDATE policy); first attach and unreferenced objects still work; deactivated writes nothing; admin can still do
all of it) and S14 rows `generated-docs [issued]` (admin SU, sales S, engineer S), `quotations [pdf_attached]` and
`purchase_orders [pdf_attached]` (U admin only).

**Residual.** A staff member can still upload a PDF of their own for a revision whose PDF has not been generated yet
and attach it first. It must now be a PDF, it is audited on the row (`audit_log` keeps who set `pdf_path`), and an
admin can replace it.

## M-1 (Medium): closed-month figures still move after the month is closed

**Evidence.** The month lock (0027) freezes the payment, expense and invoice rows dated in a closed month. But the net
portion of a payment is derived at read time (0015 `v_order_basis`, `v_payment_net`; 0028 `v_month_pnl`,
`v_month_team`; 0018 `my_target_progress`) from data the lock does not cover:
- `orders.legacy_flags`: adding `value_basis_unknown` removes the payment from net income; any staff role can update
  orders (section 10: orders SIU for sales and engineers), which also bypasses the admin-only `resolve_value_basis`;
- the item lines (`order_items.gst_rate`, extra lines), editable by all staff, while the order has no invoice;
- a later invoice on the same order (sales, in an open month) switches the basis from items to invoices.

**Demonstration.** Todo test M-1: a payment in January 2020, the month closed, then an engineer sets
`value_basis_unknown` on the order and January's `net_in` changes.

**Impact.** The P&L, team credit and target progress of a month the owner signed off can change later, and by roles
that never see money. Every change is in `audit_log`, so it is detectable, not silent.

**Fix (recommended).** Snapshot at close: `close_month` / `close_months_through` write each payment's `net_portion`,
`gst_portion` and `excluded_reason` into a `closed_payment_net` table (admin only); `v_payment_net` reads the snapshot
for closed months; `reopen_month` deletes it. Independently, make `orders.legacy_flags` admin-only (column grant or a
trigger), since `resolve_value_basis` is meant to be the only way to change the value basis.

## M-2 (Medium): order owner decides target credit and anyone can change it

**Evidence.** `set_payment_credited_user()` (0010) copies `orders.owner_id` into `payments_in.credited_user_id` when
the admin records a payment. `orders.owner_id` is updatable by sales and engineers (section 10: orders SIU), with no
rule on who may set it.

**Impact.** A sales user or an engineer can make an order theirs just before the admin records its payment, and the
payment counts towards their quarterly target (`my_target_progress`, `v_month_team`). Audited, but the admin's
payment dialog does not show who will be credited.

**Fix (recommended).** Either allow `owner_id` changes only by an admin or the current owner (trigger), or show and
confirm the credited person in the admin's Record payment dialog. Both are small.

## M-3 (Medium, owner decision): selling prices are hidden from engineers by the app only

**Evidence.** The A8 owner override says selling price and spread are for admin and sales only, and the app follows it
on orders (`money` flag in `src/features/orders/*`) and in the ranking (`showSell`). The database does not:
section 10 grants all staff `rfq_items.quoted_unit_price_net`, `order_items.unit_price_net`, `quotations` (lines and
totals), the quotation PDFs in `generated-docs`, the totals of `v_order_state` / `v_order_items_total`, and
`customer_price_memory()` (0041: `sold_price`, `quoted_price`). Supplier prices are also all staff, so an engineer can
compute the spread that `rank_item_quotes()` (0049) returns as NULL. The same holds for the customer PO text that
`search_all()` (0054) hides from engineers: `orders.customer_po_number` is readable directly.

**Impact.** An engineer with the browser's developer tools (or the REST API and their own token) reads every selling
price and spread. The RFQ page already shows the Quotations panel, with prices, to engineers.

**Fix.** This needs the owner to decide what engineers may see. If selling prices must be confidential, moving them to
admin-and-sales tables (or behind definer functions) is a schema change across RFQs, quotations and orders, and
section 10 must change first. If not, the A8 wording should say the rule is a display rule. No migration was made.

**Owner decision 2026-10-22 (replaces the 2026-10-19 acceptance below).** Engineers see NO prices anywhere: selling prices,
quote prices, supplier prices, totals, exchange rates and any PKR or currency amount, on every screen, dialog, PDF button and
palette result. They still see items, quantities, brands, suppliers' names, dates, sites and jobs. The app now also stops
FETCHING prices for an engineer (one rule, `seesPrices(role)` in `src/app/session.ts`):

- RFQ page: the quote lines are read without `unit_price` and the rates (`listInquiries`), the quotations without `lines`,
  `net_total` and `gst_total`; `rank_item_quotes`, `supplier_item_memory`, `customer_price_memory`, `v_fx_latest` and the
  quote-items read are never requested. The items panel shows who replied with lead time and stock only; replies are read-only
  (entering one is entering a price); Issue quotation, Revise, Mark won, Open PDF and Share are admin and sales only, and the
  `?issue=1` / `?won=1` links open nothing for an engineer.
- New RFQ and Ask more suppliers: no supplier memory (prices) is read. Capture: no "This is a supplier's reply".
- Company page (supplier record): no price or rate column is read or shown.
- Today: no target tile and no `my_target_progress` read. Settings: Exchange rates is admin and sales (no-access page for an
  engineer; the Settings home shows no rates).
- Orders, Money, invoices, POs and the search palette were already gated and are unchanged.

**Residual (accepted until a follow-up).** The database grants are unchanged: section 10 still lets an engineer read
`supplier_quote_lines.unit_price`, `rfq_items.quoted_unit_price_net`, `quotations` lines and totals, `order_items` prices,
`purchase_orders` totals, the money columns of `v_order_state` / `v_order_items_total`, the RPCs above and the stored PDFs in
`generated-docs`, through the REST API with their own token. Closing that is the column-level move described under Fix
(admin-and-sales tables, or role-guarded views and definer functions). The e2e suites prove the app side: verify-roles crawls
every route as the engineer with no price allowance (any amount on screen, or any selling or supplier price in an API answer,
fails) and the engineer journey and verify/roles walk refuse every price read; the API column sweep reports the residual.

## L-1 (Low): actor columns can be named by the caller

The 0048 triggers set `last_asked_by` / `last_chased_by` only when the update does not name the column, so any staff
member can record a chase in a colleague's name (todo test L-1), and the columns are not set on insert at all. Every
`created_by` column is a plain `default auth.uid()`, so it can be set or changed by the caller. `audit_log.changed_by`
is always `auth.uid()` and stays the source of truth. **Fix:** accept a named actor other than `auth.uid()` only when
the count goes down (an Undo), and set the actor on insert; make `created_by` immutable and forced to `auth.uid()` for
signed-in callers.

## L-2 (Low): anon keeps the default grants on sequences

Supabase's default privileges give anon USAGE, SELECT and UPDATE on new sequences (the RFQ and order identities,
`quotation_number_seq`, `po_number_seq`). PostgREST exposes no sequence function, so this is not reachable today.
**Fix:** `revoke all on all sequences in schema public from anon;` (todo test L-2).

## L-3 (Low): pg_net is callable by anon and authenticated

0038 enables pg_net, whose Supabase install grants execute on `net.http_get` / `net.http_post` to anon and
authenticated. The `net` schema is not in the API's exposed schemas, so no client can reach it today; it would turn a
future SQL injection into server-side requests. Only the nightly FX job (postgres, via pg_cron) needs it.
**Fix:** revoke execute on the `net` functions from anon and authenticated after the extension is created (todo test
L-3).

## L-4 (Low): the share target accepts a cross-site POST

`src/sw.ts` / `src/lib/capture/shareTarget.ts` store any same-origin POST to `/capture`, including a form posted from
another site, and open the Capture sheet with that text and those files. Nothing is saved to the database until the
person chooses a destination, so the impact is a planted draft and unbounded IndexedDB use. **Fix:** refuse requests
whose `Sec-Fetch-Site` is `cross-site` or `same-site` (a real share has `none`), and cap the number and size of files.

## L-5 (Low): Capture data outlives the session

Capture drafts (IndexedDB, 7 days) and the RFQ recents (localStorage) are not cleared on sign-out, so on a shared
device the next person sees them. **Fix:** clear both in `session.signOut()`.

## L-6 (Low): attachments of a closed month are not locked

The month lock covers the money rows only. Sales can delete or replace a GST receipt (`gst-receipts`) of an invoice in
a closed month, and an admin an expense receipt. Audited on `attachments`, but the storage object is overwritten in
place. **Fix:** refuse attachment deletes and storage updates for a parent dated in a closed month (same pattern as
`enforce_month_lock`).

## L-7 (Low): three buckets accept any content type

`rfq-files`, `gst-receipts` and `expense-receipts` have no `allowed_mime_types`. They are opened through signed URLs on
the Supabase origin, never as blobs on the app origin, so there is no app-origin impact. **Fix:** allow images, PDF and
the office formats the intake accepts.

## I-1 (Info): auth settings to check on the live project

`supabase/config.toml` (local stack) has `minimum_password_length = 6`, no password requirements,
`secure_password_change = false` and email confirmations off. Passwords are generated by `admin-users` (16 characters),
but a person can change their own password with only a session token. Confirm in the dashboard before go-live: minimum
length 12, secure password change on, sign-up off (it is off in config), and the JWT expiry.

## I-2 (Info): secrets and data in the public tree

Scanned the current tree (not history) for JWTs, `sb_secret_` keys, private keys, connection strings with passwords and
age keys: none; the matches are test strings and the CI-local `postgres:postgres` URL. Phone numbers are the 555 test
range or zeros, emails are `.example` / `.test` / `.invalid`. Company names in mockups and fixtures are invented
(supplier brand names such as Meacon are public manufacturers). Review screenshots were spot-checked and show CI
fixture data. The mockup company profile shows NTN `3827149-5`: the owner should confirm it is not Q-Tech's real NTN
(an NTN is public registration data, so this is not a secret either way). `.env*`, `import/.data/` and `backups/` are
git-ignored, and `supabase/.temp` is ignored by `supabase/.gitignore`.

## Round 2: the fixes (migration 0065, 2026-10-19)

One rule decides who is limited: the database role `authenticated`, which is a signed-in person calling through the
API, directly or through a SECURITY INVOKER function. The new triggers do not limit the service role (import,
`admin-users`), postgres (pg_cron, migrations) or SECURITY DEFINER functions, the same as every other trigger in this
schema. pgTAP `0065_security_recommendations.test.sql` proves each fix. The four todo tests in 0057 are now real tests,
and S14 has the new rows.

- **M-1.** `orders.legacy_flags`: adding or removing `value_basis_unknown` on an order happens only inside
  `resolve_value_basis`, for everyone including an admin. It marks its own transaction with a setting the API cannot
  reach. Any other legacy flag, and an insert that carries flags, is admin only. On `order_items`, the money fields
  (`qty`, `unit_price_net`, `gst_rate`, `is_service`, `order_id`, `supplier_order_id`, `supplier_unit_price`) and all
  inserts and deletes are limited to admin and sales. The order page only offers these edits to those two roles
  (`OrderItemsPanel`, `canEdit && money`). An engineer can write them only in the transaction that created the order.
  That is what `convert_rfq_to_order` and `create_repeat_order` do when an engineer marks an RFQ won or repeats an
  order: `orders.created_at` equals that transaction's `now()`, which no later request can reproduce. Descriptions,
  units and positions stay open to everyone. As a result `split_order_item` is admin and sales only (S14). Sales can
  still edit a line on an order whose payment falls in a closed month, or invoice it later. That no longer moves a
  closed month, because the 0058 snapshot freezes the P&L at close.
- **M-2.** `orders.owner_id` and `rfqs.owner_id` are changed by an admin only. The RFQ is included because convert
  copies the RFQ owner into the order. Sales may take an order or RFQ that has no owner (NULL to themselves). The app
  only sets owners when it creates a row.
- **M-3.** Owner decision 2026-10-22 (replaces the 2026-10-19 acceptance, when engineers could see selling prices on
  quotation screens): engineers see no prices at all, and the app does not fetch them for an engineer (see the M-3 section).
  The database keeps section 10 as it is for now: that is the recorded residual. `rank_item_quotes` returning NULL selling
  price and spread to engineers stays.
- **L-1.**
  - `created_by`, on every table that has it, is set to the caller on insert and can never be rewritten (one trigger
    per table, `<table>_force_created_by`).
  - `order_costs.costs_complete_by` is the caller when costs are marked complete, and NULL when they are reopened.
  - The chase actor (0048):
    - On insert it is kept only if the caller names themselves; otherwise it is NULL.
    - A chase records the caller, whatever name the update gives.
    - An Undo (the count goes down, or the stamp moves back or is cleared) leaves NULL. The earlier chaser cannot be
      proven, and no name is better than a wrong one.
    - No other update can change it.
  - `signatory_id` on quotations and POs is left as chosen, because a document may be signed by someone else.
- **L-2.** anon loses every privilege on the sequences in `public`, and the default privileges no longer give it any on
  new sequences.
- **L-3.** This cannot be changed from the project. Supabase's pg_net install grants execute on the `net` functions,
  and USAGE on schema `net`, to anon and authenticated, as `supabase_admin`. CI showed the ACL of `net.http_get` is
  `supabase_admin`'s. Migrations, and the dashboard SQL editor, run as `postgres`, which is not a superuser and cannot
  revoke a grant it did not make. The `net` schema is not in the API's exposed schemas, so no client can call these
  functions. The pgTAP test now holds that this project never adds such a grant itself. If the owner wants it removed,
  only Supabase support can do it; it is not worth a ticket while the schema stays unexposed.
- **L-4.** Nothing changed for the request itself. A `Sec-Fetch-Site` check cannot be tested against Android's share
  sheet in CI, and a wrong guess would break WhatsApp share. What a POST to `/capture` stores is only a draft on that
  device; nothing reaches the database until the signed-in person picks a destination and taps Save. The service worker
  now keeps at most 10 files, 25 MB and 20,000 characters per share (`src/lib/capture/shareTarget.ts`, unit tested).
- **L-5.** Sign-out first clears every Capture draft in IndexedDB and the recent RFQs and orders in localStorage
  (`src/lib/capture/forget.ts`, unit tested). This applies both to the account menu's Sign out and to the automatic
  sign-out of a deactivated person. A share that arrives while nobody is signed in is still kept for the next sign-in,
  as designed.
- **L-6.** Receipts are locked once the month of their invoice (`invoice_date`) or expense (`paid_on`) is closed:
  - The attachment cannot be changed or removed. It fails with P0001, the month-lock message.
  - Its stored file cannot be overwritten or deleted. The storage policies enforce this through the new
    `receipt_locked(bucket, name)`, which answers NULL to anyone who cannot use the bucket.
  - A new receipt can still be added, because October's tax receipt arrives in November.
  - Like the 0027 lock, this binds an admin too: reopen the month first.
- **L-7.** `rfq-files`, `gst-receipts` and `expense-receipts` accept JPEG, PNG, WebP, GIF, HEIC, HEIF, PDF, Word,
  Excel, PowerPoint, plain text, CSV and `application/octet-stream`. The last one stays because a phone often sends
  HEIC with no type and legacy receipts may have none; a browser downloads such a file instead of rendering it. HTML,
  SVG and script types are refused.

### I-1: live Auth settings for the owner to check

These are on the Supabase dashboard for project yafbphagorydbitfgfmg, under Authentication, on the pages named below.
The values are what this project needs; change any setting that differs.

- [ ] **Sign In / Providers, Email:** "Allow new users to sign up" **off**, because only an admin creates people.
- [ ] **Sign In / Providers, Email:** "Confirm email" can stay off, because `admin-users` creates accounts already
      confirmed. "Secure email change" **on**, so an email change needs both addresses to confirm.
- [ ] **Sign In / Providers:** anonymous sign-ins **off**, and every provider other than Email **off**.
- [ ] **Attack Protection (passwords):** minimum password length **12** (generated passwords are 16); password
      requirements at least **letters and digits**.
- [ ] **Attack Protection:** "Prevent use of leaked passwords" **on**. This is the HaveIBeenPwned check. If the plan
      does not offer it, note that here; the generated passwords still apply.
- [ ] **Attack Protection:** secure password change (reauthentication) **on**, so a stolen session cannot change the
      password without a recent sign-in.
- [ ] **Sessions:** JWT expiry **3600 s** (1 hour) or less; refresh-token reuse detection **on**.
- [ ] **URL Configuration:** the Site URL is the live app URL, and the redirect URLs list only the live app (no
      localhost).
- [ ] **Rate Limits:** keep the defaults for sign-in and token refresh (the app sends no email).

## Round 3: roles verification fixes (fix/security-roles, migration 0078, 2026-10-20)

- **BUG-RV-01 (High).** `legacy_source` carried the old CRM row (order value, cost, GST, quoted price) on tables engineers
  read. 0078 moves the raw row to `legacy_archive.legacy_rows` (not exposed by the API, no client role, owner only) by a
  trigger on all 11 tables; the column keeps `{"imported": true, "table": ...}`. The company page reads only
  `imported:legacy_source->imported`. Proof: pgTAP 0902 (engineer reads no money in any `legacy_source`; no role reads the
  archive), 0903, import load test I01, e2e verify-roles (api + browser).
- **BUG-RV-02.** `legacy_source`: insert or change by a signed-in person is refused (`guard_legacy_columns`, 0068 pattern).
- **BUG-RV-03.** `legacy_flags`: insert with flags or change is admin only on all 11 tables (orders keeps 0065).
- **BUG-RV-04.** Palette recents are stored per person (`qtech.palette.recent.<user id>`) and wiped on sign-out.
- **BUG-RV-05.** admin-users allows localhost origins only with `ALLOW_DEV_ORIGINS=1` (set by
  `supabase/functions/local.env` for local serve and CI only; never in production).
- **BUG-RV-06.** A session that ends without Sign out (expired or revoked token) wipes the device data like Sign out
  (capture and intake drafts, recents, persisted query cache); the wipe runs once.
- **BUG-RV-07.** Add line (and the other Add dialogs) lock while sending and send a client id per opening; a retry is
  idempotent.

## Reviewed and clean

- 0038 FX job: all five functions are SECURITY DEFINER with an empty search_path and no client execute (S14);
  `fx_fetch_log` is admin read only; URLs are fixed in the function; manual rates are never overwritten.
- 0039 `users.phone`: a column grant plus a policy (own row, or admin); nothing else on `users` is writable.
- 0041 `customer_price_memory`, 0043 `po_line_prefill`, 0049 `rank_item_quotes` / `supplier_item_memory`, 0050
  `split_order_item` / `convert_rfq_to_order`, 0054 `search_all`: SECURITY INVOKER, empty search_path, no anon execute,
  no money table read (subject to M-3: the database still returns selling and supplier prices to an engineer; the app never
  asks, 2026-10-22).
- 0042 order attachments: one parent per row, bucket matches parent, the policy for non-invoice, non-expense parents
  is "every active role", as section 10 says.
- 0044 `next_invoice_number`: admin and sales only (42501 for others).
- 0048 triggers: SECURITY INVOKER, no client execute (actor naming is L-1).
- 0053 report views: security invoker plus the admin-and-sales filter; no money column.
- 0055 / 0056 import helpers: SECURITY DEFINER, execute for `service_role` only; purge limited to version 5 ids and
  rows with no signed-in user.
- Schema-wide (new guards in 0057's test): no function in `public` executable by anon or PUBLIC (any overload), every
  SECURITY DEFINER function pins an empty search_path, RLS on every table, every view security invoker, no public
  bucket, no policy granted to anon or PUBLIC.
- `admin-users`: the caller's token is verified, the caller must be an active admin on every action, CORS allowlist,
  no-store responses, generated passwords never audited, last-admin rule checked in the function and the database.
- Import tool: refuses the legacy project by URL, key and `ref` claim; a hosted target needs two explicit flags and a
  matching service-role key; the key comes from the environment only and is never printed.
- Workflows: no `pull_request` / `pull_request_target`; secrets only in environment-gated, manual or main-only jobs;
  inputs reach shell steps through `env`, not inline expressions; backups are encrypted before upload.
- CSP: `script-src 'self' 'wasm-unsafe-eval'`, `connect-src` limited to the project, `frame-ancestors 'none'`,
  `form-action 'self'`, `base-uri 'self'`; `style-src 'unsafe-inline'` is the one relaxation (needed by the UI
  libraries). The service worker has no fetch handler and caches no Supabase response.
