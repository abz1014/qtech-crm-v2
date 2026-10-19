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
| M-1 | Medium | A closed month's net income, team credit and target progress still change when order data changes, including by engineers | Recommendation (todo test) |
| M-2 | Medium | Any staff member can reassign an order's owner, which decides who is credited with the next payment (targets) | Recommendation |
| M-3 | Medium | Selling prices are hidden from engineers by the app only; the database grants them to all staff (section 10) | Owner decision |
| L-1 | Low | Actor columns can be named by the caller: the chase actor (0048) and every `created_by` | Recommendation (todo test) |
| L-2 | Low | anon keeps Supabase's default grants on the sequences in `public` | Recommendation (todo test) |
| L-3 | Low | pg_net's `net.http_get` keeps Supabase's execute grant to anon and authenticated | Recommendation (todo test) |
| L-4 | Low | The share target accepts a cross-site form POST to `/capture` | Recommendation |
| L-5 | Low | Capture drafts and RFQ recents stay on the device after sign-out | Recommendation |
| L-6 | Low | Files attached to a closed month (GST receipts, expense receipts) are not locked | Recommendation |
| L-7 | Low | `rfq-files`, `gst-receipts` and `expense-receipts` accept any content type | Recommendation |
| I-1 | Info | Auth settings in `config.toml` are weak; the live values are set in the dashboard and were not checked | Check before go-live |
| I-2 | Info | No secrets and no real customer data found in the committed tree | No action |

No critical finding. Checked and found sound: see "Reviewed and clean" at the end.

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

## Reviewed and clean

- 0038 FX job: all five functions are SECURITY DEFINER with an empty search_path and no client execute (S14);
  `fx_fetch_log` is admin read only; URLs are fixed in the function; manual rates are never overwritten.
- 0039 `users.phone`: a column grant plus a policy (own row, or admin); nothing else on `users` is writable.
- 0041 `customer_price_memory`, 0043 `po_line_prefill`, 0049 `rank_item_quotes` / `supplier_item_memory`, 0050
  `split_order_item` / `convert_rfq_to_order`, 0054 `search_all`: SECURITY INVOKER, empty search_path, no anon execute,
  no money table read (subject to M-3 for selling prices).
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
