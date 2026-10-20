# Q-Tech CRM — Frozen Data Model

Status: FROZEN — approved by owner 2026-10-13

Sources: original model + Revision 1 + Amendment A2 (2026-10-13) + Amendment A2b (2026-10-13) + Amendment A3 (2026-10-13)

This is one merged document: the planner's original model with Revision 1 applied in place. Section numbers are kept so tasks can cite them (§2.17, §5a, §10). Passages added or replaced by Revision 1 are marked "(Revision 1)" where practical. Passages added or changed by Amendment A2 are marked "(Amendment A2)". Passages added or changed by Amendment A2b (which reconciles the two A2 versions) are marked "(Amendment A2b)". Passages changed by Amendment A3 (minimal entry burden) are marked "(Amendment A3)"; where A3 conflicts with older text, A3 wins.


Repo checked on `phase0/stabilise`. Claims are tagged **FACT** (seen in the repo or the brief), **INFERENCE**, **ASSUMPTION** or **PROPOSED**.

Evidence I relied on beyond the brief:
- **FACT** — `seed_historical_data.sql` holds 17 RFQs, 17 orders, 17 invoices, 17 expenses and 5 payables.
- **FACT** — Customer PO 000001 is split into two orders, "Unit A" and "Unit B", each with its own invoice (INV-0001/INV-0002).
- **FACT** — The seed header says `order_value` = "Sales Invoice … incl. GST". HANDOVER §8 proves it is net on 4 live rows. The two sources contradict each other.
- **FACT** — The PO 2224 expense note says total landing cost is 200,000, but the amount stored is 150,000.
- **FACT** — `rfq_line_items.product_type` holds product families ("Flow Meter", "Proximity Switch").
- **FACT** — `20260922_one_order_per_rfq.sql` contradicts PRODUCT_BIBLE §18 ("An RFQ may spawn multiple orders").
- **FACT** — Current RLS shuts engineers out of RFQs, enquiries and orders (write), and all finance tables are admin-only.
- **FACT** — `reconciliation.ts` labels `invoices`, `payment_records` and `payables` as dead in the live app.

---

## 1. Entity list (30 tables: 24 after Revision 1, plus 4 added by Amendment A2, plus 2 added by Amendment A6)

> **Amendment A6 (monthly bookkeeping) supersedes this document wherever it conflicts, and adds `expense_categories` and `closed_months` (rows 29 and 30 below). Read "Amendment A6" at the end before building anything that touches money. Notes marked "superseded by A6" in the sections below point to it.**

| # | Table | Purpose |
|---|---|---|
| 1 | `users` | Staff profile. Mirrors `auth.users`; holds role and deactivation. |
| 2 | `companies` | Every external organisation: customers, suppliers, agents, forwarders. Its role is derived, not flagged. |
| 3 | `company_sites` | Plants or branches of a company (Ghani Glass KHI / LHR, IFL Head Office). |
| 4 | `contacts` | People at a company, so the owner knows who to chase and on which channel. |
| 5 | `brands` | Short names of brands and product families. This is a tag list, not a catalog. |
| 6 | `company_brands` | "Who carries Belimo" and the standing shortlist per product family. |
| 7 | `rfqs` | A customer request for a price, with a due date and an owner. |
| 8 | `rfq_items` | The items asked for. Replaces the old one-line text cram. |
| 9 | `supplier_inquiries` | One float of one RFQ to one supplier. |
| 10 | `supplier_quote_lines` | A supplier's answer per item: price in its own currency, lead time, origin, stock. |
| 11 | `clarifications` | One open technical question on an RFQ, tracked from asked to answered to relayed. |
| 12 | `orders` | The customer's order. An RFQ is optional. |
| 13 | `order_items` | Sold lines: quantity, net unit price, GST rate, and which procurement leg supplies it. |
| 14 | `supplier_orders` | Procurement leg: one supplier's part of one customer order. Holds the goods dates. |
| 15 | `order_engineers` | Engineers assigned to commissioning. |
| 16 | `invoices` | Sales-tax invoice. Also the GST register row, carrying the TCS and FBR filing tracks. |
| 17 | `payments_in` | Money received from customers against an order. |
| 18 | `expenses` | All money out: supplier payments, freight, clearing, commissioning, overheads. |
| 19 | `recurring_expenses` | Monthly overhead templates (Salaries and similar). |
| 20 | `attachments` | Files on RFQs and clarifications (nameplate photos, RFQ documents) and GST receipts. |
| 21 | `snoozes` | The only persisted part of the work list. |
| 22 | `audit_log` | Append-only change history. Kept as it is today. |
| 23 | `order_costs` | Admin-only cost data for an order, split off `orders`: the expected cost and the "costs complete" mark. |
| 24 | `targets` | Quarterly target per person, measured in net cash received. |
| 25 | `fx_rates` | PKR rate per currency per day. Used only to compare and display prices. |
| 26 | `quotations` | Issued customer quotation: an unchangeable snapshot with a number and revision. The PDF is stored. |
| 27 | `purchase_orders` | Issued supplier PO for one procurement leg: an unchangeable snapshot in the supplier's currency. The PDF is stored. |
| 28 | `company_profile` | One row holding Q-Tech's letterhead and legal details, used by the PDFs and text generators. |
| 29 | `expense_categories` | *(Amendment A6)* Expense categories with a group (overhead / order cost / not in P&L), sort order, active flag and default paid-via. |
| 30 | `closed_months` | *(Amendment A6)* One row per month the owner has closed. Locks payments, expenses and invoices dated in that month. |

Derived objects. All views use `security_invoker = true`. **Every view that exposes money also carries an explicit `current_user_role()` filter.** Underlying row security alone is not enough: if a user can't see some of the rows a view sums, the view returns a wrong number rather than nothing.

- Views: `v_company_roles`, `v_rfq_state`, `v_inquiry_state`, `v_order_state`, `v_invoice_state`, `v_gst_register`. *(Amendment A2: plus `v_fx_latest`, `v_supplier_activity`, `v_supplier_stats`.)*
- Admin-only views: `v_order_money`, `v_cash_month`, `v_payment_net`, `v_target_progress`. *(Amendment A6: plus `v_month_pnl`, `v_month_expense_category`, `v_month_team`, and the functions `aging_as_of()`, `payables_as_of()`, `month_end_status()`; `v_gst_month` is readable by admin and sales. See A6.3.)*
- Two narrow functions that run with owner rights, so they can read money tables the caller can't (`SECURITY DEFINER`, `STABLE`, fixed `search_path`; EXECUTE granted to `authenticated`, revoked from `public`/`anon`):
  - `order_receivables()`: payment status for admin and sales only.
  - `my_target_progress()`: the caller's own target, for any active user.
- *(Amendment A2)* Added derived objects:
  - `v_fx_latest`
  - `v_supplier_activity`
  - `v_supplier_stats`
  - the function `supplier_item_memory()` (security invoker)

The work list is computed in app code from these views, with snoozes subtracted.

---

## 2. Entities in full

### Shared conventions

These are defined once here and marked in the tables below:

- **[std]**
  - `id uuid PK DEFAULT gen_random_uuid()`
  - `created_at timestamptz NOT NULL DEFAULT now()`
  - `created_by uuid NULL DEFAULT auth.uid()`, FK to `users`, ON DELETE RESTRICT. NULL only on imported rows.
- **[upd]** — `updated_at timestamptz NOT NULL DEFAULT now()`, maintained by a trigger. It is only on roots where staleness does work (rfqs, orders, companies), e.g. "nothing touched in 40 days".
- **[L]** — present only on imported tables:
  - `legacy_flags text[] NOT NULL DEFAULT '{}'`
  - `legacy_source jsonb NULL` (the untouched original row)
  - One mechanism handles every import caveat. New rows always have an empty flag array.
- **Types**
  - Money in PKR is `numeric(14,2)`.
  - Supplier unit prices are `numeric(14,4)`, because foreign-currency unit prices can carry 4 decimals.
  - Quantities are `numeric(12,3)`, because cable is sold in metres.
- **Dates**
  - Business dates are `date`, read as Asia/Karachi. The default is `(now() AT TIME ZONE 'Asia/Karachi')::date`, not `current_date`, which would be UTC.
  - System stamps are `timestamptz`.
- **Empty text** — no `''` defaults anywhere. Absent means NULL. This kills the `NOT NULL DEFAULT ''` class of bugs the 0922 migration had to work around.

S = stored, D = derived.

### 2.1 `users`

| Field | Type | Null | Default | S/D | Purpose |
|---|---|---|---|---|---|
| id | uuid PK | no | — | S | Equals `auth.users.id`. FK to auth.users, ON DELETE RESTRICT. |
| name | text | no | — | S | Display name, and the author shown on records. |
| role | text | no | — | S | CHECK in ('admin','sales','engineer'). Read by `current_user_role()`. |
| deactivated_at | timestamptz | yes | NULL | S | When set, `current_user_role()` returns NULL, so RLS fails closed. The account is also banned in auth. |
| created_at | timestamptz | no | now() | S | |
| job_title | text | yes | — | S | Signatory line on quotation and PO PDFs. Set through the `admin-users` function. |

- **Cut:** `email`. It lives in `auth.users`, and the admin Edge Function returns it, so keeping a copy would only drift. `password` is already gone.
- **Edge Function `admin-users`** (extends `create-user`; service role; caller must be an active admin). Actions:
  - `create`
  - `reset_password` — generates a password and returns it once.
  - `set_role`
  - `deactivate` — sets a ban and revokes sessions with `auth.admin.signOut`.
  - `reactivate`
  - Guard: the system must always keep at least one active admin.

### 2.2 `companies` — [std] [upd] [L]

| Field | Type | Null | Default | S/D | Purpose |
|---|---|---|---|---|---|
| name | text | no | — | S | Unique case-insensitively. Prevents duplicate companies. |
| country | text | yes | — | S | Shown on the float shortlist (China vs Europe trade-off on price and lead time). |
| notes | text | yes | — | S | Everything else, including industry and lead source from legacy data. |
| is_customer / is_supplier | — | — | — | **D** | `v_company_roles`. Customer = has an RFQ or order. Supplier = has an inquiry, a supplier order, a `company_brands` row, or is a payee on an expense. |
| is_prospect | — | — | — | **D** | Customer side with no non-cancelled order. |

- **Cut:**
  - `industry` — record only.
  - `address` — moves to sites.
  - `contact_person`, `phone`, `email` — move to contacts.
  - Prospect `status`/`follow_up_date` — that was nagging.
  - Hand-set role flags — the role is derivable from facts.

### 2.3 `company_sites` — [std]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| company_id | uuid FK companies CASCADE | no | — | |
| name | text | no | — | "Karachi", "Head Office". Unique per company, case-insensitive. |
| address | text | yes | — | Delivery address. |

Created inline by typing a new name. The site does work: repeat-order lookup and history are per plant, while totals still roll up to the company.

### 2.4 `contacts` — [std]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| company_id | uuid FK companies CASCADE | no | — | |
| site_id | uuid FK company_sites SET NULL | yes | — | |
| name | text | no | — | |
| phone | text | yes | — | Also the WhatsApp number. |
| email | text | yes | — | |
| notes | text | yes | — | Role, and whether WhatsApp is acceptable. |

All contact fields are optional. **FACT:** all vendor contact fields in the seed are empty, so nothing may require them.

### 2.5 `brands` — [std]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| name | text | no | — | "Belimo", "Siemens", "Flow meters". Unique case-insensitively. |
| kind | text | no | 'brand' | CHECK in ('brand','family'). Brand = maker; family = product family for shortlists. Seeded from legacy `product_type`. |

This is not a catalog: no models, SKUs or prices, and rows grow only when typed. Typos are fixed by merging (admin RPC `merge_brands`).

### 2.6 `company_brands`

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| company_id | uuid FK companies CASCADE | no | — | PK part. |
| brand_id | uuid FK brands CASCADE | no | — | PK part. |
| created_at | timestamptz | no | now() | |
| created_by | uuid | yes | auth.uid() | NULL when written by the trigger or import. |

- **Auto-learnt (PROPOSED):** an AFTER INSERT trigger on `supplier_quote_lines` upserts (supplier, item.brand_id) and (supplier, item.family_id). "Who supplied it before" therefore feeds "who carries it" for free.
- **Cut:** a relationship type (manufacturer / distributor / agent). It goes in company notes; nothing computes on it.

### 2.7 `rfqs` — [std] [upd] [L]

| Field | Type | Null | Default | S/D | Purpose |
|---|---|---|---|---|---|
| number | bigint | no | identity | S | Internal "RFQ-0177", generated at no cost. |
| company_id | uuid FK companies RESTRICT | no | — | S | |
| site_id | uuid FK sites SET NULL | yes | — | S | |
| contact_id | uuid FK contacts SET NULL | yes | — | S | Who to chase. |
| customer_ref | text | yes | — | S | Customer's RFQ number. Present on only 3 of 17, so optional. |
| received_on | date | no | today (PKT) | S | |
| due_on | date | yes | — | S | Bid deadline. Editable because it slips. A sort key and risk signal only. NULL is allowed for relationship enquiries. |
| owner_id | uuid FK users RESTRICT | no* | `auth.uid()` *(Amendment A3)* | S | The person who chases. *NULL allowed only with the legacy flag `owner_unknown`. |
| is_priority | boolean | no | false | S | "TOP PRIORITY" (4 of 17 in the seed). One-tap sort boost. |
| quoted_on | date | yes | — | S | When Q-Tech bid. Overwritten on re-send ("sent offer again"). |
| closed_on | date | yes | — | S | Set by a human when the customer says no, or when the owner gives up. |
| close_reason | text | yes | — | S | CHECK in ('competitor','price','no_reply_to_clarification','customer_cancelled','could_not_source','we_were_late','other'). |
| close_note | text | yes | — | S | |
| notes | text | yes | — | S | |
| quoted total, won, sourcing state, clarification state | — | — | — | **D** | Views; see §5. |

- **Cut:**
  - `estimated_value` and `quoted_price` — **FACT:** 0 or NULL on all 176 RFQs.
  - `quote_expiry_date` — record only.
  - `status` — derived instead.
  - `converted_order_id` — circular; replaced by `orders.rfq_id`.
  - Free-text `company_name`/`phone`/`email` — replaced by FKs.
  - `channel` — the copy formatter offers email and WhatsApp buttons, so storing the channel does no work.
  - `original_due_on` — `audit_log` already keeps slip history.

### 2.8 `rfq_items` — [std] [L]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| rfq_id | uuid FK rfqs CASCADE | no | — | |
| position | smallint | no | 0 | Display order. |
| description | text | no | — | Model, spec and size, as written. |
| brand_id | uuid FK brands RESTRICT | yes | — | Drives the supplier suggestion. |
| family_id | uuid FK brands RESTRICT | yes | — | CHECK target kind='family' (enforced in app). Drives the shortlist. |
| qty | numeric(12,3) | no | 1 | CHECK > 0. |
| unit | text | yes | — | "pcs", "m". Matters for cable. |
| quoted_unit_price_net | numeric(14,2) | yes | — | Optional bid price. Pre-fills the order on conversion. Quote total is derived from it. |
| gst_rate | numeric(5,2) | no | 18 | CHECK 0–100. The quotation needs totals per line. `convert_rfq_to_order` copies it to `order_items.gst_rate`. |
| quoted_lead_time | text | yes | — | Lead time printed on the quotation line ("ex-stock", "6–8 weeks from PO").<br>**Not pre-filled.** The chosen supplier's `lead_time` is shown beside it as a hint, because the customer's lead time = supplier time + shipping + clearance. *(Amendment A2b)* |
| model_tokens | text[] | no | generated | `GENERATED ALWAYS AS (model_tokens(description)) STORED`, with a GIN index. *(Amendment A2b)* |

**Cut:** `target_price` (all NULL in the seed), and a separate `model` column (text search on description covers it; the generated `model_tokens` column above is derived, not typed).

**(Amendment A2b)** `model_tokens(text)` is an IMMUTABLE SQL function:
1. Upper-case the text and split on whitespace and commas.
2. Strip `- . /` from each token.
3. Keep a token only if it has ≥ 4 characters, at least 1 letter and at least 1 digit.
4. Drop unit and range patterns: `^\d+(V|VAC|VDC|MA|MM|CM|M|KV|KW|W|HZ|BAR|PSI|C)$` and `^\d+\d+MA$` (for example "420MA").

Examples:
- "Hach HQ1110 portable meter" → {HQ1110}
- "Position transmitter PMA-18-F0200-X" → {PMA18F0200X}
- "24V actuator" → {}

### 2.9 `supplier_inquiries` — [std] [L]

| Field | Type | Null | Default | S/D | Purpose |
|---|---|---|---|---|---|
| rfq_id | uuid FK rfqs CASCADE | no | — | S | |
| supplier_id | uuid FK companies RESTRICT | no | — | S | UNIQUE(rfq_id, supplier_id). |
| sent_on | date | yes | — | S | Stamped by the "Copy enquiry text" action. NULL means shortlisted but not yet sent. |
| last_chased_on | date | yes | — | S | Stamped by the "Copy chase text" action. |
| no_offer_on | date | yes | — | S | "Floated but could not find offer". A real outcome, distinct from never floated (no row) and from silence. |
| last_relayed_at | timestamptz | yes | — | S | Stamped by "Copy answers for this supplier". Drives "supplier X waiting". |
| notes | text | yes | — | S | |
| chase_count | smallint | no | 0 | S | Incremented by `stamp_supplier_chase`. After 2 chases, Today suggests floating to another supplier. |
| quote_received_on | — | — | — | **D** | `min(line.created_at)::date`. |

- **Cut:**
  - `email_draft` — the text is regenerated from the items.
  - `status` — derived.
  - `follow_up_date` — the work-list rule replaces it.
  - Per-item "asked for" subset — quote lines show coverage. An item that every responder skipped surfaces as "uncovered".

### 2.10 `supplier_quote_lines` — [std] [L]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| inquiry_id | uuid FK supplier_inquiries CASCADE | no | — | |
| rfq_item_id | uuid FK rfq_items CASCADE | no | — | UNIQUE(inquiry_id, rfq_item_id). Partial quotes are simply missing rows. |
| unit_price | numeric(14,4) | no | — | CHECK > 0. |
| currency | char(3) | no | **none** | CHECK `~ '^[A-Z]{3}$'`. No default, which kills the hardcoded-PKR bug. The UI pre-fills from the inquiry's previous line. |
| lead_time | text | yes | — | "4–6 weeks", "ex-stock". Free text because that is how suppliers write it. |
| origin | text | yes | — | Country of origin and authenticity ("Genuine Siemens, DE"). |
| in_stock | boolean | yes | — | Current stock availability. |
| notes | text | yes | — | |
| fx_rate_pkr | numeric(14,6) | yes | trigger | PKR per 1 unit of `currency`, captured when the line is entered.<br>• A BEFORE INSERT trigger fills it from `v_fx_latest`, but only if it was left empty.<br>• PKR gives 1. No rate gives NULL.<br>• Editable.<br>Used for **history and supplier memory only** ("at the time"). Live comparison never uses it (§5c). *(Amendment A2b)* |
| fx_rate_on | date | yes | trigger | The date of that rate. *(Amendment A2b)* |

- **Cut:**
  - `moq` and `validity_days` (validity defaulted to 30 and meant nothing) — they go in notes.
  - `is_selected` — selection is recorded by the order leg's supplier at conversion.
  - FX rate as a costing input — no costing engine. *(Amendment A2b: the captured `fx_rate_pkr` above is for history and supplier memory only, never for costing or live comparison.)*
- Supplier price revisions overwrite the line; `audit_log` keeps the old value.

### 2.11 `clarifications` — [std] (decision C)

| Field | Type | Null | Default | S/D | Purpose |
|---|---|---|---|---|---|
| rfq_id | uuid FK rfqs CASCADE | no | — | S | |
| raised_by_inquiry_id | uuid FK supplier_inquiries SET NULL | yes | — | S | Which supplier asked. NULL means Q-Tech's own question. |
| question | text | no | — | S | One question. Captured by pasting the supplier's message; one line becomes one row. |
| first_asked_at | timestamptz | yes | — | S | Stamped the first time it goes into a "Copy questions for customer" bundle. |
| last_asked_at | timestamptz | yes | — | S | Stamped on every bundle or chase. Drives "asked 6 days ago". |
| ask_count | smallint | no | 0 | S | Incremented by `stamp_clarification_ask`. After 3 asks with no answer, Today offers "close as no reply to clarification" as a one-click choice. It never closes on its own. |
| answer | text | yes | — | S | Q-Tech's rewritten answer, the one relayed to suppliers. The raw answer stays in email/WhatsApp, or is an attachment if it is an image. *(Amendment A3: text is optional; a photo alone is enough. See A3-1.)* |
| answered_at | timestamptz | yes | — | S | Per question, so staged answers resolve piecemeal. |
| withdrawn_at | timestamptz | yes | — | S | No longer relevant, e.g. that supplier was dropped. |
| state | — | — | — | **D** | Not yet asked / asked-open / answered / withdrawn. |

**Cut:**
- A bundle/message entity. A shared `last_asked_at` stamp is the implicit bundle.
- Per-supplier relay rows. `inquiry.last_relayed_at` compared with `answered_at` is enough.
- Raw customer answer text.

### 2.12 `orders` — [std] [upd] [L]

| Field | Type | Null | Default | S/D | Purpose |
|---|---|---|---|---|---|
| number | bigint | no | identity | S | "ORD-0038". |
| company_id | uuid FK companies RESTRICT | no | — | S | |
| site_id | uuid FK sites SET NULL | yes | — | S | Delivery site; key for "same as last year". |
| contact_id | uuid FK contacts SET NULL | yes | — | S | |
| rfq_id | uuid FK rfqs RESTRICT | yes | — | S | NULL for WhatsApp and repeat orders. Not unique (see F). |
| owner_id | uuid FK users RESTRICT | no* | `auth.uid()` *(Amendment A3)* | S | The salesperson. Carried across from the RFQ on conversion. *NULL only with flag `owner_unknown`. |
| customer_po_number | text | yes | — | S | WhatsApp orders may get a PO later. |
| ordered_on | date | no* | today (PKT) | S | PO date, or the date confirmed on WhatsApp. *NULL only with flag `undated`. Replaces `confirmed_date` and `customer_po_date`. |
| payment_terms_days | integer | yes | — | S | CHECK ≥ 0. Drives the overdue rule. |
| needs_commissioning | boolean | no | false | S | Known at order time. |
| commissioning_planned_on | date | yes | — | S | Engineer's work list. |
| commissioning_done_on | date | yes | — | S | |
| cancelled_on | date | yes | — | S | The customer cancelled the PO. |
| notes | text | yes | — | S | |
| net, gst, gross, invoiced | — | — | — | **D** | `v_order_state`, visible to all staff (derived from item prices, which staff can already see). |
| settled, receivable, actual cost, margin | — | — | — | **D** | `v_order_money`, admin only. |
| goods/payment/commissioning state | — | — | — | **D** | `v_order_state`. |

> These fields (`expected_cost_pkr`, `costs_complete_at`, `costs_complete_by`) move to `order_costs` (§2.12a). Engineers have full read/write on `orders`, and row security can't hide columns, so cost has to live in its own table.

- **Cut:**
  - `vendor_id` — moves to legs.
  - `product_type` — moves to items.
  - `order_value` and `cost_value` — replaced by derived values plus `expected_cost_pkr`.
  - `status` — derived.
  - `delivery_date` — moves to legs.
  - `payment_due_date` — derived.
  - `invoice_number`/`invoice_date` — move to `invoices`.
  - `order_gst_amount` — derived.
  - `ops_dismissed` — replaced by snoozes.
  - `material_cost`, `engineering_cost`, `logistics_cost`, `overhead_cost`, `total_cost`, `profit`, `profit_margin` — dead; `total_cost` sums to 0 across all 37 orders (**FACT**).
- **Legacy-only flag:** `value_basis_unknown` lives in `legacy_flags`. While it is set, the order is excluded from margin and GST totals and gets a badge. The admin RPC `resolve_value_basis(order, 'net'|'gross')` rewrites item prices (gross is divided by 1 + rate) and clears the flag.

### 2.12a `order_costs` (new) — [std]: created_at, created_by, updated_at

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| order_id | uuid PK, FK orders CASCADE | no | — | One row per order. Created the first time an admin enters a cost. If there's no row, cost is unknown and margin is provisional. |
| expected_cost_pkr | numeric(14,2) | yes | — | The single pricing-basis cost figure. CHECK ≥ 0. |
| costs_complete_at | timestamptz | yes | — | Admin's "costs complete" mark. Margin stays provisional until it is set. |
| costs_complete_by | uuid FK users RESTRICT | yes | — | Who set the mark. |

**Why a separate table:** the alternative is column-level permissions. In Supabase, admins and staff log in as the same database role (`authenticated`), so a column restriction would hide the cost from admins too. A 1:1 side table is the smallest model that works.

### 2.13 `order_items` — [std] [L]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| order_id | uuid FK orders CASCADE | no | — | |
| position | smallint | no | 0 | |
| description | text | no | — | |
| brand_id / family_id | uuid FK brands RESTRICT | yes | — | Repeat-order search and supplier suggestion. |
| qty | numeric(12,3) | no | 1 | CHECK > 0. |
| unit | text | yes | — | |
| unit_price_net | numeric(14,2) | no | — | CHECK ≥ 0. Ex-GST. |
| gst_rate | numeric(5,2) | no | 18 | CHECK 0–100. 0 = exempt. Per-order exemption is a UI action that sets every line. The rate is stored per line, so history survives rate changes. |
| is_service | boolean | no | false | Commissioning or service charge. Has no goods leg. |
| supplier_order_id | uuid FK supplier_orders SET NULL | yes | — | Which leg supplies it. NULL and not a service means "not yet sourced". |
| rfq_item_id | uuid FK rfq_items SET NULL | yes | — | Lineage, for the quote-vs-sale comparison. |
| supplier_unit_price | numeric(14,4) | yes | — | CHECK ≥ 0. The working purchase price, in the leg's `supplier_orders.currency`.<br>**Filled by:** `convert_rfq_to_order` (from the chosen quote line) or `create_repeat_order` (copied from the source order).<br>**Overwritten by:** `issue_purchase_order` with the prices actually issued.<br>Editable. *(Amendment A2b)* |
| model_tokens | text[] | no | generated | Same as on `rfq_items`. GIN index. *(Amendment A2b)* |

Line net, line GST and line gross are derived. Rounding: GST is rounded to whole rupees per line (PROPOSED; to be validated against the 4 GST-linked live invoices).

### 2.14 `supplier_orders` (procurement leg) — [std] [L]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| order_id | uuid FK orders CASCADE | no | — | |
| supplier_id | uuid FK companies RESTRICT | no | — | |
| inquiry_id | uuid FK supplier_inquiries SET NULL | yes | — | The quote it came from. |
| reference | text | yes | — | Q-Tech's PO number or the supplier's PI, quoted when chasing. |
| placed_on | date | yes | — | NULL triggers the work item "place PO with X". |
| expected_on | date | yes | — | From lead time. Triggers "goods late from X". |
| received_on | date | yes | — | Goods arrived at Q-Tech. |
| delivered_on | date | yes | — | Delivered to the customer. Partial delivery across legs comes for free. |
| currency | char(3) | yes | — | CHECK `^[A-Z]{3}$`. **The single source of truth for the leg's currency.** Set from the quote line on conversion, copied on repeat, editable. Required before a PO can be issued. *(Amendment A2b)* |

**Cut:** the supplier amount (prices live per line in `order_items.supplier_unit_price`; the total is calculated) and leg status (derived from dates). Currency is reinstated by Amendment A2b: one supplier quotes in one currency, so the leg is the natural home. *(Amendment A2b)*

### 2.15 `order_engineers`

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| order_id | uuid FK orders CASCADE | no | — | PK part. |
| user_id | uuid FK users RESTRICT | no | — | PK part. Gives the engineer the "My jobs" view and the RLS right to update their own commissioning dates. |

**Cut:** per-engineer `site_location` (the order's site covers it), `start_date`/`expected_completion` (moved to order-level commissioning dates), and `commissioning_status` (derived).

### 2.16 `invoices` (sales-tax invoice and GST register) — [std] [upd] [L]

| Field | Type | Null | Default | S/D | Purpose |
|---|---|---|---|---|---|
| order_id | uuid FK orders RESTRICT | yes* | — | S | *Required for new rows (app). NULL only for unlinked legacy register rows. |
| company_id | uuid FK companies RESTRICT | yes | — | S | Only used when `order_id` is NULL. CHECK (order_id IS NOT NULL OR company_id IS NOT NULL). |
| number | text | no* | — | S | *NULL only with a legacy flag. Partial UNIQUE. |
| invoice_date | date | no* | `today_pkt()` *(Amendment A3)* | S | The GST-register clock. |
| net_amount | numeric(14,2) | no | — | S | Legal figure; pre-filled from items. Stored because the invoice is the external truth FBR sees. |
| gst_amount | numeric(14,2) | no | — | S | CHECK ≥ 0 and ≤ net_amount. |
| copy_received_on | date | yes | — | S | TCS track step 1. Meaning to validate (§8). *(Amendment A3: kept for now; verify against live data at the I06 import, see A3-3.)* |
| tcs_sent_on | date | yes | — | S | TCS step 2. |
| tcs_number | text | yes | — | S | Consignment number. |
| client_received_on | date | yes | — | S | TCS step 4. *(Amendment A3: optional and not in the entry flow; no Today rule reads it. See A3-3.)* |
| psid | text | yes | — | S | FBR track. |
| wasif_receipt_on | date | yes | — | S | Replaces both the boolean and the date column. |
| tax_deposited_on | date | yes | — | S | |
| tax_deposit_amount | numeric(14,2) | yes | — | S | |
| ~~tax_deposit_bank~~ | — | — | — | — | **Dropped (Amendment A3, A3-2).** Use `notes`. |
| notes | text | yes | — | S | |
| last_reminded_on | date | yes | — | S | Stamped when someone copies a payment reminder. The Today item then drops away for 7 days. Only admin and sales can see it (engineers have no access to `invoices`). |
| reminder_count | smallint | no | 0 | S |  |
| tax_bank_month | date | yes | — | S | *(Amendment A6, A6.1)* The bank tick for the FBR deposit: the first day of the statement month. CHECK first day of a month. The UI ticks a whole PSID group at once. Stays editable after the month closes. |
| settled_before_cutover | boolean | no | false | S | *(Migration 0068, owner decision 2026-10-19)* An imported invoice with no order, paid before the new system: fully received (open 0, not overdue, not remindable; `aging_as_of()` leaves it out, `stamp_payment_reminder()` skips it). Still a sale and output GST. CHECK true only with `legacy_source` set and `order_id` NULL. Set by the import (service role) only: a trigger refuses any insert or change of it by a signed-in user. |
| gross, courier_state, fbr_state | — | — | — | **D** | `v_invoice_state`. |

> Every invoice goes to FBR; there is one GST register and no provincial (SRB/PRA) tax. `order_items.gst_rate` stays at 18 by default, 0 for exempt items. Only admin and sales can see invoices; engineers have no access (§10).

- **Cut:**
  - `client_name`, `supplier_company`, `customer_po_number`, `item_name`, `item_number`, `product_detail` — derivable from the order.
  - `delivery_challan_number` — record only; kept in `legacy_source`.
  - `fbr_status` — derived.
  - `wasif_receipt_received` — derived from the date.
  - `wasif_receipt_file_path` — moves to `attachments`.
  - `tcs_receipt_date` — pending validation (likely the same as `tcs_sent_on`).
- Old `invoices` and `orders.invoice_number`/`invoice_date` merge into this table.

*(Amendment A2)* `order_receivables()` gains `last_reminded_on` (the latest across the order's invoices) and `reminder_count`.

### 2.17 `payments_in` — [std] [L]

created_at, created_by, legacy flags and legacy source as before.

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| order_id | uuid FK orders RESTRICT | no | — | Payments are recorded against the order, because advances arrive before the invoice. |
| received_on | date | no | `today_pkt()` *(Amendment A3)* | The date cash is counted (cash-basis revenue), and the date that places the payment in a target quarter. |
| amount | numeric(14,2) | no | — | CHECK > 0. **Gross**: the money actually received, GST included. Customers pay the full invoice amount and deduct nothing (owner, FACT). |
| credited_user_id | uuid FK users RESTRICT | yes | set from `orders.owner_id` when the payment is recorded | Whose target this payment counts towards. Copied once so that reassigning an order later doesn't rewrite past quarters. Admin can change it. NULL means unattributed (some legacy rows). |
| reference | text | yes | — | Cheque or bank-transfer reference. |
| paid_via | text | no | `'bank'` | *(Amendment A6, A6.1)* CHECK in ('bank', 'cash'). Only bank items are ticked. |
| bank_month | date | yes | — | *(Amendment A6, A6.1)* The statement month this payment was ticked against; NULL = not ticked. CHECK first day of a month, and CHECK `bank_month IS NULL OR paid_via = 'bank'`. Stays editable after the month closes. |
| voided_at, voided_by, void_reason | timestamptz, uuid FK users, text | yes | — | *(0073)* Soft void: the row stays as history and is left out of every money figure. Written only by `void_payment` / `correct_payment` (reason required) and cleared only by `restore_payment` (Undo: the same admin, within 10 minutes). A voided row cannot be changed, ticked or deleted. |
| corrects_payment_id | uuid FK payments_in RESTRICT | yes | — | *(0073)* Set on the new row `correct_payment` makes: the voided payment it replaces. The correction keeps that payment's credited person (NULL stays NULL). |

**Removed:** `tax_withheld` (the owner confirms no withholding happens) and `payment_method`.

The net portion of a payment is not stored; it is calculated by `v_payment_net` (§5).

*(Amendment A6)* Once a month is closed, `payments_in` rows dated (`received_on`) in it can't be inserted, changed or deleted, except for `bank_month`.

### 2.18 `expenses` (all money out) — [std] [L]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| paid_on | date | no | `today_pkt()` *(Amendment A3)* | Cash-out clock. |
| amount_pkr | numeric(14,2) | no | — | CHECK > 0. What left the bank. *(Amendment A6: still the bank debit, which may include recoverable input tax; the cost is `amount_pkr − input_tax_pkr`.)* |
| ~~category~~ | — | — | — | **Superseded by A6.** The free-text column is dropped (no live data yet). Use `category_id`. |
| category_id | uuid FK expense_categories RESTRICT | no | — | *(Amendment A6, A6.1)* Replaces the free-text `category`. The category's group (overhead / order cost / not in P&L) is what the reports use. A trigger rejects an insert, or a category change, to an inactive category; legacy rows (non-empty `legacy_flags`) are exempt. |
| paid_via | text | no | — | *(Amendment A6)* CHECK in ('bank', 'cash'). A BEFORE INSERT trigger fills it from the category's `default_paid_via` when left NULL. |
| input_tax_pkr | numeric(14,2) | no | 0 | *(Amendment A6)* CHECK between 0 and `amount_pkr`. Optional, normally 0. The cost used in the P&L and in order margin is `amount_pkr − input_tax_pkr`. |
| bank_month | date | yes | — | *(Amendment A6)* The statement month this expense was ticked against; NULL = not ticked. CHECK first day of a month, and CHECK `bank_month IS NULL OR paid_via = 'bank'`. Stays editable after the month closes. |
| description | text | yes | — | |
| order_id | uuid FK orders RESTRICT | yes | — | Tagging to an order makes it order cost. Actual cost = sum of these. |
| supplier_order_id | uuid FK supplier_orders RESTRICT | yes | — | For supplier payments, ties the payment to a leg. |
| payee_id | uuid FK companies RESTRICT | yes | — | Supplier, forwarder, subcontractor. |
| reference | text | yes | — | |
| recurring_id | uuid FK recurring_expenses SET NULL | yes | — | |
| period | char(7) | yes | — | YYYY-MM. UNIQUE(recurring_id, period). |

This replaces `expenses`, `supplier_payments`, `payables` and `payable_payments`. One table, one cost rule, one cash-out rule.

*(Amendment A6)* Expense categories are now a table (`expense_categories`), `paid_via` and `bank_month` exist for the bank tick, `input_tax_pkr` makes the tick match the bank debit, and receipt photos are allowed (attachments, below). Once a month is closed, expenses dated (`paid_on`) in it are locked except for `bank_month`. See A6.

**Cut:** `payment_method`, `updated_by`, `updated_at` (`audit_log` covers them), and foreign-currency amount (no payables module).

### 2.19 `recurring_expenses` — [std]

Kept as today (VERIFIED shape):
- `label text NOT NULL`
- ~~`category text NOT NULL`~~ *(superseded by A6: `category_id uuid NOT NULL`, FK RESTRICT to `expense_categories`, same as expenses)*
- `amount numeric(14,2) NOT NULL` CHECK > 0
- `day_of_month smallint` CHECK 1–28
- `active boolean DEFAULT true`
- `start_month char(7) NULL` (was `''`)
- `notes`

It does work: "Salaries for October not yet recorded" is derived from a template that has no expense row for the period.

### 2.20 `attachments` — [std] (decision D)

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| bucket | text | no | — | CHECK in ('rfq-files','gst-receipts'). *(Superseded by A6: also 'expense-receipts'.)* |
| path | text | no | — | UNIQUE(bucket, path). Format `{parent_id}/{uuid}.{ext}`. |
| file_name | text | no | — | Original name. |
| mime_type | text | no | — | |
| size_bytes | integer | no | — | CHECK ≤ 5 MB. |
| rfq_id | uuid FK rfqs CASCADE | yes | — | |
| clarification_id | uuid FK clarifications SET NULL | yes | — | Requires `rfq_id`. |
| invoice_id | uuid FK invoices CASCADE | yes | — | |
| expense_id | uuid FK expenses CASCADE | yes | — | *(Amendment A6)* Receipt photo on an expense. Admin only. |
| order_id | uuid FK orders CASCADE | yes | — | *(R22, migration 0042)* A file kept with an order (a customer PO scan, a photo from site). Bucket `rfq-files`, all staff. |

CHECKs:
- `(rfq_id IS NOT NULL)::int + (invoice_id IS NOT NULL)::int = 1` *(superseded by A6: three parents, `(rfq_id IS NOT NULL)::int + (invoice_id IS NOT NULL)::int + (expense_id IS NOT NULL)::int = 1`)*
- `clarification_id IS NULL OR rfq_id IS NOT NULL`
- bucket matches parent

Storage objects are deleted by the app after a cascade (orphan sweep acceptable).

> *(Superseded by A6: one new parent type, `expense_id`, with the private bucket `expense-receipts`, 5 MB limit, admin only.)*
>
> No new parent types (before A6). Images and text shared in from WhatsApp (F-4) attach to an RFQ or a clarification through the existing columns. Generated PDFs are not attachments. They live in a new private bucket, `generated-docs`, and are referenced by `pdf_path` on `quotations` and `purchase_orders`.

### 2.21 `snoozes`

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| id | uuid PK | no | gen_random_uuid() | |
| user_id | uuid FK users CASCADE | no | auth.uid() | |
| rule | text | no | — | Work-list rule key, e.g. `chase_customer_clarification`. |
| subject_id | uuid | no | — | Polymorphic, no FK. Orphans are harmless. |
| until_on | date | no | — | |
| created_at | timestamptz | no | now() | |

UNIQUE(user_id, rule, subject_id).

### 2.22 `audit_log`

Unchanged shape:
- `id`, `table_name`, `record_id`, `action` CHECK insert/update/delete
- `changed_by`, `changed_at`
- `old_value jsonb`, `new_value jsonb`

Append-only, no client grants, trigger on every business table. It replaces all `updated_by` columns and quote-revision history.

### 2.23 `targets` (new) — [std]: created_at, created_by, updated_at

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| user_id | uuid FK users RESTRICT | no | — | Whose target. Can be any role: admin, sales or engineer. |
| year | smallint | no | — | CHECK between 2020 and 2100. |
| quarter | smallint | no | — | CHECK between 1 and 4. Calendar quarters, the same as today's dashboard (FACT: `DashboardPage.tsx:49`). |
| target_net_pkr | numeric(14,2) | no | — | CHECK > 0. Net cash, GST excluded. |
| note | text | yes | — | Optional. |

Constraint: UNIQUE(user_id, year, quarter). Only admins can write to this table.

"Achieved" is never stored. It is always calculated from `v_payment_net`, so it can't drift from the payments.

### 2.24 `fx_rates` (new, Amendment A2; replaced by Amendment A2b)

Has the standard id / created_at / created_by columns.

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| currency | char(3) | no | — | CHECK `~ '^[A-Z]{3}$'` and ≠ 'PKR'. |
| rate_pkr | numeric(14,6) | no | — | PKR for 1 unit. CHECK > 0. |
| as_of | date | no | today in PKT | |
| source | text | no | 'manual' | CHECK in ('auto','manual'). |

- **Uniqueness:** UNIQUE(currency, as_of, source). Re-entering a manual rate on the same day updates that day's manual row.
- **Automatic rows** are written nightly with the service-role key by task R23.
  - Source: open.er-api.com (**ASSUMPTION:** its terms allow this use; checked in §8 item 24), with one fallback source configured.
  - Currencies fetched: USD, EUR and CNY, plus every currency seen on a quote line in the last 12 months.
- **Manual rows** can be entered by any staff member: inline at a quote line ("Rate for USD? last 278.40 on 3 Oct · auto"), or on Settings › Exchange rates. Use manual entry for the bank's TT rate, or when the fetch has failed.
- **Derived view `v_fx_latest`:**
  - Returns one row per currency: the latest `as_of`, and on the same day **manual is preferred over auto**.
  - Columns: currency, rate_pkr, as_of, source, age_days, and the staleness band.
  - Bands are unchanged: fresh ≤ 7 days, stale 8–30, unusable > 30.
  - A manual rate applies for its own day only. The next day's automatic rate replaces it unless someone re-enters a manual one.
- **If every fetch fails,** nothing new is written. The rates age, and the staleness bands make the gap visible. No separate alerting is needed beyond the failed nightly job.
- Rates are market information, not company money, so engineers may enter them.

### 2.25 `quotations` (new, Amendment A2)

Has the standard columns.

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| rfq_id | uuid FK rfqs RESTRICT | no | — | An issued document blocks deletion of its RFQ. |
| number | integer | no | — | Taken from `quotation_number_seq` on the first issue for this RFQ. Re-issues reuse it. Displayed as `QT-YY-NNNN` (format pending Q5). |
| revision | smallint | no | 0 | The R0, R1, … suffix on re-issue. |
| issued_on | date | no | today in PKT | Issuing stamps `rfqs.quoted_on`. |
| valid_until | date | no | — | Default is `issued_on + company_profile.quotation_validity_days`. |
| contact_id | uuid FK contacts SET NULL | yes | — | Who the quotation is addressed to. |
| lines | jsonb | no | — | Snapshot. Each element holds `rfq_item_id`, `description`, `qty`, `unit`, `unit_price_net`, `gst_rate`, and **`lead_time`** (copied from `rfq_items.quoted_lead_time`; Amendment A2b). CHECK: an array with at least one element. |
| net_total | numeric(14,2) | no | — | Calculated by the RPC from `lines`. The client does not supply it. |
| gst_total | numeric(14,2) | no | — | Same: calculated by the RPC. |
| delivery_text | text | yes | — | e.g. "4–6 weeks from PO". |
| payment_terms | text | yes | — | |
| notes | text | yes | — | |
| signatory_id | uuid FK users RESTRICT | no | auth.uid() | |
| pdf_path | text | yes | — | Set after upload. NULL means "generate the PDF again". |

- UNIQUE(number, revision).
- **The record can't be changed after it is issued:** a trigger rejects any UPDATE except to `pdf_path`.
- Gross total is derived.
- State is derived: an open RFQ whose `valid_until` has passed shows as expired.
- Quotations are issued only through the RPC `issue_quotation`.
  - It requires every item to have `quoted_unit_price_net`.
  - It copies the RFQ's current prices into the snapshot.
- **Cut:** *(Amendment A2b: per-line lead time is no longer cut; it is `lead_time` in each `lines` element. `delivery_text` stays for general delivery wording.)*
  - a separate quotation-lines table (the JSON snapshot is never queried line by line)
  - bank details on the quotation (Q5 recommends they appear on invoices only)

### 2.26 `purchase_orders` (new, Amendment A2)

Has the standard columns.

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| supplier_order_id | uuid FK supplier_orders RESTRICT | no | — | The procurement leg this PO is for. |
| number | integer | no | — | Taken from `po_number_seq` on the first issue for this leg. Displayed as `PO-YY-NNNN`. |
| revision | smallint | no | 0 | |
| issued_on | date | no | today in PKT | Issuing stamps `supplier_orders.placed_on` if it is still empty. |
| currency | char(3) | no | — | **A frozen copy** of `supplier_orders.currency`, taken at issue. A record of what the document said, not a second source of truth. *(Amendment A2b)* |
| lines | jsonb | no | — | Snapshot. Each element holds `order_item_id`, `description`, `qty`, `unit`, `unit_price`, and `price_source`, one of 'order', 'quote', 'last_po' or 'typed' *(Amendment A2b adds 'order')*. |
| total | numeric(14,2) | no | — | Calculated by the RPC, in `currency`. |
| incoterm | text | yes | — | EXW, FOB, CIF, DAP, … |
| delivery_terms | text | yes | — | |
| payment_terms | text | yes | — | |
| ship_to | text | yes | — | Default is Q-Tech's address from `company_profile`. |
| notes | text | yes | — | |
| signatory_id | uuid FK users RESTRICT | no | auth.uid() | |
| pdf_path | text | yes | — | |

- UNIQUE(number, revision).
- The same trigger makes the record unchangeable except for `pdf_path`.
- `supplier_orders.reference` stays as it is, holding the supplier's PI number.
- **Where PO prices come from.** `issue_purchase_order` refuses to run if `supplier_orders.currency` is NULL. Each line is pre-filled from the first available source:
  1. `order_items.supplier_unit_price` → label `order`
  2. the supplier's quote line for the linked RFQ item → `quote`
  3. the last PO line to the same supplier for a "same model" or "same item" match (§5c tiers 0 and 1) → `last_po`
  4. blank, for the user to type → `typed`
- `price_source` is CHECKed by the RPC against ('order','quote','last_po','typed') and shown as a label on each line.
- On issue, the RPC **writes the issued unit prices back** to `order_items.supplier_unit_price`, so the order always holds the agreed price. *(Amendment A2b)*

### 2.27 `company_profile` (new, Amendment A2; single row)

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| id | smallint PK | no | 1 | CHECK `id = 1`. The row is created by a migration. |
| legal_name | text | yes | — | PDF generation is blocked until this and `address` are set. |
| address | text | yes | — | |
| phone | text | yes | — | |
| email | text | yes | — | |
| website | text | yes | — | |
| ntn | text | yes | — | |
| strn | text | yes | — | |
| bank_name | text | yes | — | Only printed on PO and reminder texts if Q5 says so. |
| bank_account_title | text | yes | — | Same rule. |
| bank_iban | text | yes | — | Same rule. |
| quotation_validity_days | smallint | no | 30 | |
| quotation_terms | text | yes | — | Standard terms printed on quotations. |
| po_terms | text | yes | — | Standard terms printed on POs. |
| updated_at | timestamptz | no | now() | |
| updated_by | uuid FK users | yes | — | |

### Global cut list

| Cut | Reason |
|---|---|
| prospects | A prospect is a company with no won order. |
| follow_up_actions | 552 of 552 were never edited. Replaced by rules plus snoozes. |
| cost_lines, costing_config | Costing removed; `cost_lines` has 1 row. |
| budgets | Out of scope; table has no policies. |
| payables, payable_payments, payment_records, supplier_payments | Folded into `expenses` / `payments_in`. |
| employees, attendance | HR cut. Salaries stays as an expense category. |
| documents | Unknown shape, zero app usage. |
| quarterly_targets | Record-only KPI, not in the confirmed workflow. Dropped unless the owner objects (§9 note). *(Revision 1: superseded. The old company-level rows are dropped, but a per-person `targets` table is added, §2.23, §7.)* |

---

## 3. Relationship diagram

```
auth.users 1─1 users ──(RESTRICT; users are never deleted, only deactivated)──< every created_by / owner_id / order_engineers.user_id

companies 1─< company_sites (CASCADE)        companies 1─< contacts (CASCADE)
companies >─< brands via company_brands (CASCADE both sides)

companies 1─< rfqs (RESTRICT)   sites/contacts 1─< rfqs (SET NULL)
rfqs 1─< rfq_items (CASCADE) >── brands (RESTRICT, nullable brand_id/family_id)
rfqs 1─< supplier_inquiries (CASCADE) >── companies[supplier] (RESTRICT)   UNIQUE(rfq,supplier)
supplier_inquiries 1─< supplier_quote_lines (CASCADE) >── rfq_items (CASCADE)  UNIQUE(inquiry,item)
rfqs 1─< clarifications (CASCADE) >── supplier_inquiries [raised_by] (SET NULL, 0..1)
rfqs 1─< attachments (CASCADE);  clarifications 1─< attachments (SET NULL)

rfqs 0..1─< orders (RESTRICT)   companies 1─< orders (RESTRICT)
orders 1─< order_items (CASCADE) >── rfq_items (SET NULL, 0..1)
orders 1─< supplier_orders (CASCADE) >── companies[supplier] (RESTRICT)
supplier_orders 1─< order_items (SET NULL, 0..1)   supplier_orders >── supplier_inquiries (SET NULL, 0..1)
orders >─< users via order_engineers (CASCADE order / RESTRICT user)

orders 1─< invoices (RESTRICT)  1─< attachments (CASCADE)
orders 1─< payments_in (RESTRICT)
orders 1─< expenses (RESTRICT, nullable)   supplier_orders 1─< expenses (RESTRICT, nullable)
companies 1─< expenses.payee_id (RESTRICT)   recurring_expenses 1─< expenses (SET NULL)
users 1─< snoozes (CASCADE)
```

**Additions (Revision 1):**

```
orders 1─0..1 order_costs (CASCADE; admin-only)
users 1─< targets (RESTRICT)                     UNIQUE(user,year,quarter)
users 1─< payments_in.credited_user_id (RESTRICT, nullable)
```

Revision 1 note. The existing rule still holds: an order with an invoice, payment or expense can't be deleted. `order_costs` cascades only because it is a purely internal 1:1 row.

**Additions (Amendment A2):**

```
rfqs 1─< quotations (RESTRICT)   contacts 1─< quotations (SET NULL)   users 1─< quotations.signatory (RESTRICT)
supplier_orders 1─< purchase_orders (RESTRICT)   users 1─< purchase_orders.signatory (RESTRICT)
fx_rates — no FKs (keyed by currency code); company_profile — singleton, no FKs in
```

An issued quotation or PO blocks deletion of its RFQ or leg. That is the same rule as for money facts: the document exists outside the system.

Delete rules that matter:
- **Money facts block deletion.** An order with an invoice, a payment or an expense cannot be deleted; cancel it with `cancelled_on` instead.
- **Companies are never cascade-deleted.** This reverses PRODUCT_BIBLE §18, where deleting a client cascaded to its money records. Duplicates are fixed by the admin RPC `merge_companies`, which reassigns every FK, then deletes.

---

## 4. Constraints and invariants

### Enforced by the database

**Uniqueness:**
- `lower(btrim(companies.name))`
- `brands.name` (case-insensitive)
- `(company_id, lower(sites.name))`
- `rfqs(company_id, customer_ref) WHERE customer_ref IS NOT NULL`. A re-sent RFQ (deadline extension) lands on the existing record.
- `invoices(number) WHERE number IS NOT NULL` — Q-Tech's own series, globally unique.
- `orders(company_id, customer_po_number) WHERE customer_po_number IS NOT NULL AND NOT ('po_shared' = ANY(legacy_flags))`
  - Scoped per company, because PO numbers are the customer's own series.
  - The exemption exists because of **FACT** PO 000001 A/B; see §7.
- `supplier_inquiries(rfq_id, supplier_id)`
- `supplier_quote_lines(inquiry_id, rfq_item_id)`
- `expenses(recurring_id, period)`
- `snoozes(user_id, rule, subject_id)`
- `attachments(bucket, path)`

**CHECKs:**
- Amounts > 0 (payments, expenses, quote prices); item price ≥ 0; quantities > 0.
- `gst_rate` between 0 and 100.
- `gst_amount ≤ net_amount`.
- Currency matches `^[A-Z]{3}$`.
- Role, `close_reason`, brand `kind`, attachment bucket enums.
- `close_reason IS NOT NULL` iff `closed_on IS NOT NULL` (a lost RFQ must carry a reason, as today).
- `answer IS NULL OR answered_at IS NOT NULL` *(Amendment A3, A3-1; replaces "iff")*.
- NOT (`answered_at` AND `withdrawn_at` both set).
- `last_asked_at ≥ first_asked_at`.
- Legacy escape hatches:
  - `ordered_on IS NOT NULL OR 'undated' = ANY(legacy_flags)`
  - `owner_id IS NOT NULL OR 'owner_unknown' = ANY(legacy_flags)`
  - same pattern for `invoices.number` and `invoice_date`
- Attachment parent rule (§2.20).

**Other:**
- FKs and delete rules as in §3.
- `audit_log` is append-only (no grants).
- RLS on every table via `current_user_role()`. That function returns NULL for deactivated users.

**Additions (Revision 1):**
- `targets`:
  - UNIQUE(user_id, year, quarter).
  - CHECKs: quarter between 1 and 4, year in range, target > 0.
- `order_costs.expected_cost_pkr` ≥ 0.
- `payments_in.credited_user_id`: a BEFORE INSERT trigger fills it from `orders.owner_id` when it's left empty.
- Every money view filters on the user's role (see §1). The definer functions return rows only to the roles named in §10, and only for an active caller: `current_user_role()` returns NULL for deactivated users, so they get nothing.
- Row-security rules that do real work:
  - Staff can delete a `supplier_inquiries` row only while it hasn't been sent (`sent_on IS NULL`). Once it has been sent, only an admin can delete it.
  - An attachment on an invoice is visible to admin and sales only.
  - `targets` rows other than your own are visible to admin only.

### Enforced by app code or RPC (cross-row rules)

**Rules:**
- An RFQ with a non-cancelled order must not also be closed. Showing it as "won" overrides `closed_on`, and the clash is flagged.
- `family_id` must point at a `kind='family'` brand.
- `invoices.order_id` is required for new rows.
- An expense's `supplier_order_id` must belong to its `order_id`.
- Over-payment warnings: Σ`payments_in.amount` > gross target (Revision 1: no longer uses `tax_withheld`), and invoiced gross > order gross. These reuse `reconciliation.ts`, adapted to the new views.
- At least one active admin.

**Transactional RPCs** (SECURITY INVOKER, the existing pattern):
- `convert_rfq_to_order` — order, items, legs.
- `create_repeat_order(from_order_id)` — copies items, last prices and last suppliers.
- `merge_companies`, `merge_brands` (admin).
- `resolve_value_basis` (admin).
- *(Revision 1)* Engineers can now call `convert_rfq_to_order` and `create_repeat_order`. Both still run with the caller's own permissions (SECURITY INVOKER) and never write to `order_costs`.

**Idempotency:** the client generates the new order's UUID. A double submit then hits the primary key and returns the existing row. This replaces the unapplied `one_order_per_rfq` partial index, which wrongly forbids one RFQ producing two customer POs.

**Additions (Amendment A2):**

**Enforced by the database:**
- `fx_rates`:
  - the currency CHECK
  - rate > 0
  - *(Amendment A2b)* CHECK on `source`; UNIQUE(currency, as_of, source) (replaces UNIQUE(currency, as_of))
- `quotations` and `purchase_orders`:
  - UNIQUE(number, revision)
  - `lines` must be a non-empty array
  - every field except `pdf_path` is locked after insert (trigger)
  - totals are calculated only inside the issuing RPC
- `company_profile`: CHECK `id = 1`.
- The new counters are ≥ 0.
- Number gaps from sequence rollbacks are accepted. These are not tax documents; invoices keep their own numbering.

**Transactional RPCs** (security invoker; the client generates the id, so a double submit is idempotent):
- `issue_quotation(rfq_id, …)`: snapshots the prices, assigns number and revision, stamps `quoted_on`.
- `issue_purchase_order(supplier_order_id, lines, currency, …)`: snapshots the lines, assigns number and revision, stamps `placed_on`.
- `stamp_clarification_ask(clarification_ids[])`: sets `first_asked_at` if empty and `last_asked_at` = now, and increments `ask_count`. This replaces the plain timestamp update described in R09.
- `stamp_supplier_chase(inquiry_id)`: sets `last_chased_on` and increments `chase_count`.
- `stamp_payment_reminder(invoice_ids[])`: sets `last_reminded_on` and increments `reminder_count`. Callable by admin and sales only; row security on `invoices` enforces this.

**Additions (Amendment A2b):**

**Database:**
- The FX-capture trigger on `supplier_quote_lines` fills the rate only when the field is NULL, so an edited rate is kept. Skips rows with `legacy_source` set (imports).
- `model_tokens()` is IMMUTABLE, with GIN indexes on both `model_tokens` columns.

**Functions:**
- `convert_rfq_to_order` also fills `order_items.supplier_unit_price` and `supplier_orders.currency` from the chosen quote line.
- `create_repeat_order` copies both.
- `issue_purchase_order`:
  - Requires the leg currency.
  - Copies it into `purchase_orders.currency`.
  - Writes the issued prices back to the order items.

**Enforced by app code:**
- The text generators and the PDF renderers are pure functions with snapshot tests.
- Prices are compared through the rule in §5c.

---

## 5. Status design — independent dimensions, all derived unless marked HAND

| Entity | Dimension | Values | Derived from |
|---|---|---|---|
| **RFQ** | Outcome | open / won / closed | won = a non-cancelled order with this `rfq_id`. closed = `closed_on` (**HAND**, with reason). Otherwise open. A passed `due_on` never changes it. |
| | Sourcing | not floated / floated-awaiting / partly covered / covered / no offer anywhere | Inquiries (`sent_on`, `no_offer_on`) and quote lines per item. "Uncovered item" = every responder skipped it. |
| | Clarification | none / to ask (count) / waiting on customer (count, days since `last_asked_at`) / answers to relay (per supplier) | `clarifications` vs `inquiry.last_relayed_at`. |
| | Bid *(changed, Amendment A2)* | to bid / bid sent / quotation expired | `quoted_on` is stamped by `issue_quotation`, or by the manual "mark bid sent" when no PDF was issued. Expired = the latest quotation's `valid_until` has passed and the RFQ is still open. |
| | Deadline risk | days to `due_on`; overdue badge | `due_on`. A sort key only. |
| **Supplier inquiry** | Contact *(changed, Amendment A2)* | shortlisted / sent / chased ×n | `sent_on`, `last_chased_on`, `chase_count`. |
| | Response | awaiting / quoted (n of m items) / no offer | Quote lines; `no_offer_on` (**HAND**). |
| | Blocked | has open questions it raised / answers waiting to relay | Clarifications. |
| **Clarification** | single *(changed, Amendment A2)* | to ask / asked ×n / answered / withdrawn | Timestamps. Each is stamped by a copy action or **HAND** (answer, withdraw). Plus `ask_count`. |
| **Order** | Lifecycle | active / cancelled / done | `cancelled_on` (**HAND**). done = every other dimension terminal. |
| | Lifecycle "done" | — | For admin, every dimension must be finished. Engineers and sales see "done" computed from the dimensions they can see (goods, commissioning, invoicing for sales). The view computes this per role so that a hidden dimension never counts as finished. |
| | Goods *(changed, Amendment A2)* | n/a (all service) / to source / to place / on order / late / received / partly delivered / delivered; "to place" ends when the PO is issued | Items without a leg; legs' `placed_on`, `expected_on`, `received_on`, `delivered_on` (the minimum across legs).. `placed_on` is stamped by `issue_purchase_order`, or entered by hand. |
| | Commissioning | n/a / to plan / planned / done | `needs_commissioning`, `commissioning_planned_on`, `commissioning_done_on`. |
| | Invoicing | not invoiced / part / fully invoiced | Σ invoice gross vs items gross. |
| | Payment *(admin; sales through `order_receivables()`; hidden from engineers)* | unpaid / part / settled / overdue | settled means Σ`payments_in.amount` ≥ the gross target, allowing ₨1 for rounding. The gross target is the invoiced gross if any invoice exists, otherwise the gross from the items. Overdue means the earliest invoice date plus `payment_terms_days` is before today and the order isn't settled. An imported invoice with no date (flag `undated`) is dated, for the due date and the aging only, by its order date, else the day it was imported (0076). |
| | Costs *(admin only)* | provisional / complete | `order_costs.costs_complete_at`. Actual cost = Σ expenses tagged to the order. Expected cost = `order_costs.expected_cost_pkr`. |
| | Data trust | ok / basis unknown / estimated dates | `legacy_flags`. |
| **Invoice** | Courier (TCS) | not started / copy received / sent / delivered to client | `copy_received_on`, `tcs_sent_on`, `client_received_on` *(Amendment A3: the last is optional and not in the entry flow)*. |
| | FBR | pending / generated / receipt received / deposited | The furthest step reached:<br>• deposited if `tax_deposited_on` is set<br>• receipt received if `wasif_receipt_on` is set<br>• generated if `psid` is set, or the row carries the legacy flag `fbr_generated_legacy`<br>• otherwise pending<br>If a later step is set without an earlier one (e.g. deposited with no PSID), it shows as the later step and is reported as an exception.<br>`needsFbrAttention` becomes: `tax_deposited_on` is empty AND the invoice month is before the current month. |
| | Reminder (new; admin and sales only) | not reminded / reminded n× (last date) | `last_reminded_on`, `reminder_count`. |
| **Company** | Role | customer / supplier / both / prospect | `v_company_roles`. |
| **FX rate** | Staleness (new) | fresh / stale / unusable | `v_fx_latest.age_days`, using the bands ≤ 7, 8–30 and > 30 days. |
| **Quote line** | Captured rate *(Amendment A2b)* | captured (rate, date) / none | `fx_rate_pkr`, `fx_rate_on`. Display only, labelled "at the time". |
| **Expense / payment** | — | none | They are facts, so they carry no status. |

Why not something simpler: three states (dropping "generated") would hide the step where the team waits on the tax agent. The PSID is already typed in, so that state costs no input.

**Money clocks** — shown separately, never combined:

1. **Cash month** (`v_cash_month`, admin only).
   - Money in uses `payments_in.received_on` and shows gross received, the GST portion, and net received.
   - Money out uses `expenses.paid_on`.
   - Payments excluded from the net calculation (see the net-portion rule) still count in gross, and their net is shown as "unresolved".
2. **GST register** (`v_gst_register`, admin and sales). Uses `invoices.invoice_date`. It's the only register; everything is FBR.
3. **Whole-life order margin** (`v_order_money`, admin only).
   - Margin = net sale − Σ expenses tagged to the order, **with no adjustment**. *(Superseded by A6: use the net cost `amount_pkr − input_tax_pkr`; identical while input tax is 0.)*
   - Expenses are recorded at true cost and **never include recoverable input tax** (owner, FACT). GST is outside margin on both sides. *(Superseded by A6: `amount_pkr` is the bank debit and may include input tax. The cost is `amount_pkr − input_tax_pkr`, so the rule still holds. Margin = net sale − Σ(`amount_pkr − input_tax_pkr`).)*
   - Net sale is the invoiced net if any invoice exists, otherwise the net from the items.
   - Marked PROVISIONAL until `costs_complete_at` is set. Excluded while the order is flagged `value_basis_unknown`.
4. **Targets** (§5a). Net cash by `received_on` quarter, counted to `credited_user_id`. GST is excluded from targets, the same as from profit.

### 5a. Net portion of a payment (`v_payment_net`, admin only; also read inside `my_target_progress()`)

For each payment *p* on order *o*:

- **Which figures to use (N = net, G = gross):**
  - If the order has at least one invoice: N = Σ `invoices.net_amount` and G = Σ (`net_amount` + `gst_amount`).
  - Otherwise: N = Σ line net (`qty × unit_price_net`, rounded to 2 decimals) and G = N + Σ line GST (each line's GST rounded per §2.13).
- **The calculation:** `net_portion = round(p.amount × N ÷ G, 2)`. The GST portion is `p.amount − net_portion`.
- **Exempt lines** (`gst_rate` = 0) add the same amount to N and G, so the share comes out right automatically. A fully exempt order gives N ÷ G = 1, meaning the whole payment counts as net.
- **The share is recalculated every time, never frozen.** A payment received before the invoice is valued from the items until the invoice exists, then from the invoice. For a single-rate order (every order seen so far) the share is identical either way. It can only move when an order has mixed rates and is partly invoiced, which is negligible.
- **Why share the payment out rather than match it to a specific invoice:** payments are recorded against orders, and advances come before invoices. Matching to invoices would need a payment-to-invoice allocation table, which is paperwork that changes nothing when every line is 18%.
- **A payment is left out of net totals, with a reason, when:**

| Reason | Condition | What to do |
|---|---|---|
| `basis_unknown` | The order is flagged `value_basis_unknown`. | Exclude rather than guess. Only legacy orders carry this flag, so current quarters are almost never affected. Resolving the order's basis brings the payment back in automatically. |
| `zero_value` | G = 0. | — |
| `unattributed` | `credited_user_id` is empty. | Counts in company net cash but in nobody's target. |

- **Over-payments** count at face value and are reported by reconciliation. There is no cap, because capping would hide the error.
- **Refunds** are out of scope (CHECK amount > 0).

### 5b. Target progress

- **`my_target_progress()`** is available to every active user. It returns exactly one row, for the caller and the current Asia/Karachi calendar quarter:

| Column | Meaning |
|---|---|
| year, quarter, quarter_end | The current quarter. |
| target_net | NULL if no target has been set. |
| achieved_net | Σ net_portion of the caller's credited payments received this quarter. |
| gap | max(target − achieved, 0). |
| on_pace_net | target × days elapsed ÷ days in quarter. |
| behind_pace | max(on_pace − achieved, 0). |
| excluded_count | How many of the caller's payments this quarter are excluded. A count only, no amounts. |

  It takes no parameters, so the caller can't ask about anyone else. It exposes no payment rows, order totals or costs. Engineers can see how far behind they are without being able to read any money table.
- **`v_target_progress`** (admin only): the same columns for every user and any quarter.
- **Who sees whose progress.** Recommendation: **admin sees everyone; each user sees only their own.**
  - Showing a colleague's achieved net cash would reveal per-person revenue, which is the money data the owner has kept admin-only.
  - With 3–5 people, a leaderboard would identify everyone directly.
  - If the owner wants a team view later, it can be added as a function that returns percentages only.
- **On the home screen** this is a status tile ("₨X behind pace, Y days left"), not a task. A target creates no work-list items and sends no reminders. Constant nagging is why the old CRM was abandoned.

**Work-list routing (Revision 1):**

| Rule | Shown to |
|---|---|
| "Payment overdue on ORD-n" (with balance) | The order owner if they are sales; otherwise admin. Engineer-owned orders route to admin, because engineers can't see money. |
| "Costs not marked complete" / "expected cost missing" | Admin only. |
| FBR and TCS items | Admin and sales. |
| Everything on the RFQ, supplier, clarification, goods and commissioning side | The record's owner, whatever their role. |

**Removed:** the "settled includes tax_withheld" wording everywhere.

**Home-screen line** (decision C test): "2 questions unanswered · asked customer 6 days ago · bid due in 4 days · Red Lion/Four Stars waiting". Every piece is one query over `clarifications`, `rfqs.due_on` and `supplier_inquiries`. No field exists solely to produce it.


### 5c. Price comparison and supplier memory (Amendment A2; amended by Amendment A2b)

**Price comparison for one RFQ item** (pure function `comparePrices`, used on reply rows and in the convert dialog):
1. **All quote lines in the same currency:** compare them directly in that currency. No rate is needed.
2. **Mixed currencies:** convert each line at **today's** rate from `v_fx_latest` *(Amendment A2b; the captured `fx_rate_pkr` is never used for live comparison)*, provided the rate is fresh or stale (≤ 30 days old).
   - A line whose rate is unusable or missing is shown in its own currency, marked "not compared — no current USD rate", and offers the inline rate entry.
   - "Lowest" is only marked when at least 2 lines are comparable.
   - A stale rate shows an amber note, e.g. "rate 12 days old".
3. **How amounts are displayed:** original currency first, then "≈ PKR …" with the rate date as a tooltip.
4. **Expected cost suggestion (admin only):** Σ qty × `order_items.supplier_unit_price` × today's rate, per leg currency; uses PO line totals when a PO has been issued *(Amendment A2b basis)*. Labelled "supplier price only — excludes freight, duty, service". It pre-fills `order_costs.expected_cost_pkr` but never overwrites a value already entered. This is display and suggestion only. There is no landed-cost calculation; the costing engine stays removed.
5. **History displays** (memory cards, the company page, reprints) show the captured rate: "USD 412 ≈ PKR 114,700 *at the time* (3 Oct)". If no rate was captured (legacy rows, or no rate existed at entry), show the original currency only. *(Amendment A2b)*

**Supplier memory** is derived only: no input, no score, and facts shown as counts.

**When a past item counts as "the same item".** There is no catalog, so the match is decided against the target `rfq_item` (its brand B, family F and description D). The tier is always shown in the UI as a label.

| Tier | Label | Rule |
|---|---|---|
| 0 | "same model" | Shares at least one `model_tokens` element with the target, AND brand equal when both brands are set. Cross-brand token matches never count, because short codes collide across makers. *(Amendment A2b)* |
| 1 | "same item" | Brand equal to B (when B is set) AND `similarity(norm(D), norm(D′)) ≥ 0.45` (pg_trgm), OR, when B is empty: family equal to F AND similarity ≥ 0.60. `norm()` lowercases the text, strips quantities, units and punctuation, and collapses spaces. |
| 2 | "same brand" | Brand equal to B. |
| 3 | "same family" | Family equal to F. |
| — | supplier-level | No item match; only the supplier's overall stats are shown. |

**`v_supplier_activity`** has one row per sent inquiry (sent within the last 24 months):
- supplier_id, rfq_id
- sent_on
- first_reply_on = min(first quote line `created_at::date`, `no_offer_on`)
- replied, quoted, no_offer (booleans)
- reply_days = first_reply_on − sent_on, in calendar days
- is_legacy = `legacy_source IS NOT NULL` on the inquiry, or on any of its quote lines

**`v_supplier_stats`** has one row per supplier. Every rate is stored as a numerator and a denominator, never as a percentage alone.

| Metric | Definition | When shown |
|---|---|---|
| asked | Count of sent inquiries that are old enough to judge: sent at least 7 days ago, or already replied. | Always shown as a count. |
| replied | The part of `asked` that got a reply (a quote, or a declared no-offer). | Shown as "replied r of a". If a < 3, raw facts only, e.g. "asked twice, 1 reply". |
| no_offer | The part of `asked` that ended in a declared no-offer. | "couldn't offer n of a"; shown only when n ≥ 1. |
| median_reply_days | Median `reply_days` over **non-legacy** replied rows only. Imported rows are excluded because their `created_at` is the import date, not the reply date. | Only when there are ≥ 3 such rows. Shown as "usually logs a reply in ~N days". |
| chosen | Among items this supplier quoted where the item was later ordered (from anyone, order not cancelled): how many were ordered on a leg with this supplier. | "chosen c of k times the item was ordered"; only when k ≥ 1. Never shown as a percentage. |
| deliveries | Legs with `expected_on` and `received_on` set; late = `received_on > expected_on`. | "late l of d"; the median days late only when l ≥ 3. |
| last_contact | max(`sent_on`, `last_chased_on`, `last_relayed_at::date`, PO `issued_on`). | Always shown. |
| brands | `company_brands` | Always shown. |

**`supplier_item_memory(p_supplier_ids uuid[], p_brand_id, p_family_id, p_description)`** returns, for each supplier, its best tier plus:
- the last quote: price, currency, ≈ PKR **at the time** (captured rate; Amendment A2b), date, qty, lead-time text, and the tier
- the last PO price: same fields, taken from the `purchase_orders.lines` snapshot
- *(Amendment A2b)* the last ordered price: taken from the latest `purchase_orders.lines` snapshot. Where no PO was ever issued, use `order_items.supplier_unit_price` on a leg with this supplier, labelled "agreed on order, no PO issued".
- the two most recent lead-time strings, verbatim (they are free text, so there is no median)

How legacy rows feed memory:

| Legacy flag | Treatment |
|---|---|
| Any imported row | Counts towards asked, replied, no_offer and chosen. |
| `currency_unverified` | The price is **hidden** and shown as "price on file, currency unverified". |
| `item_guessed` | Excluded from tier 1 and tier 2 matches; still counts at supplier level. |

Prices older than 18 months show their age prominently, e.g. "Mar 2025 — 19 months ago".

**Display rules:**
- Never a single composite score.
- Never a percentage without its counts.
- Below the thresholds above, show only the raw fact or "no history yet".
- Each card has a provenance footnote, e.g. "includes imported history · 2 prices hidden (currency unverified)".
- **Order of suggestions** in intake stays by reason: supplied before, then carries the brand, then family shortlist; ties broken by most recent contact. Memory statistics never reorder the list, because sorting on them would be a hidden score.
  - *(Amendment A2b, wording clarified, not a rule change)* "Supplied this item before" means a tier 0 or tier 1 match on a past procurement leg with this supplier. It is the only reason that pre-ticks. The order of reasons, the tie-break by most recent contact, and "memory never reorders" are all unchanged.

**Performance:**
- Plain SQL, no materialized views.
- Indexes:
  - pg_trgm GIN indexes on `rfq_items.description` and `order_items.description`
  - B-tree indexes on `supplier_inquiries(supplier_id, sent_on)` and `supplier_quote_lines(rfq_item_id)`
- Budget: p95 < 150 ms for `supplier_item_memory` on a fixture 10× today's volume (≈ 1.5k inquiries, 1.2k quote lines).
- Intake loads `v_supplier_stats` once when a company is chosen, and calls `supplier_item_memory` per item, debounced by 300 ms.
- If the budget fails in the future, the fallback is a materialized `v_supplier_stats` refreshed after writes.

**Fixtures to add (Amendment A2b)** (to S19 and R17):
- (k) "Hach HQ1110 portable meter" against "HQ1110 pH/EC meter with probes", both brand Hach → tier 0.
- (l) "24V actuator" produces no tokens, so no tier 0.
- (m) Brand A "XK2040" against brand B "XK2040" → not tier 0.
- (n) A memory card shows the captured rate "at the time". A legacy line with a NULL rate shows the original currency only.

**Work-list rules that use the stamps.** Thresholds are constants in code. Snoozes still apply. All day counts below are business days. *(Amendment A2b: replaces "a just-stamped item drops out of the list until its threshold passes".)*
- A just-stamped item moves to a dimmed **Waiting** group at the foot of the Today list, showing "chased n days ago · next nudge on {date}".
- It returns to the active list when its threshold passes.
- The Waiting group is collapsed by default when it holds more than 5 items.
- Snoozed items stay hidden entirely: a snooze is the user's choice, while Waiting is the system's cooldown.
- The thresholds, business-day counting, the shorter cooldown when the bid is due soon, and the escalation suggestions in the table are unchanged.


| Rule | Due when | Escalation (a suggestion, never automatic) |
|---|---|---|
| Customer clarification chase | Open asked questions and `last_asked_at` ≥ 3 days ago (≥ 1 day if the bid is due within 3 days). | `ask_count` ≥ 3 → "3 chases, no answer — close as no reply?" |
| Supplier chase | No quote and no no-offer, and the time since `last_chased_on` (or `sent_on` if never chased) is ≥ max(2, the supplier's median reply days + 1 when there are ≥ 3 replies), OR the reply-by date has passed. | `chase_count` ≥ 2 → "float to another supplier", listing the next suggestions with their memory one-liners. |
| Payment reminder (admin and sales) | The order is overdue and (`last_reminded_on` is empty or ≥ 7 days ago). | Shows `reminder_count`. Engineer-owned orders route to admin, as before. |
| Quotation expired (low priority) | Open RFQ whose latest quotation has passed `valid_until`. | "re-confirm supplier prices before re-issuing" |

---

## 6. Decisions A–N

### A. New Supabase project — RECOMMENDED

- **Problem solved:** Today the repo cannot rebuild the database; 12 core tables have no DDL (FACT). Building the new schema inside the drifted project keeps that problem.
  - A fresh project built only from `supabase/migrations/` proves reproducibility the moment it applies.
  - It doubles as the staging environment you lack (Docker will not start, FACT).
- **Why better than the same project:**
  - The new tables would collide by name with live `orders`, `rfqs` and `users`. You would need a second schema, PostgREST schema exposure, duplicated RLS and helper functions, and you would still need a baseline dump of the old `public` schema to rebuild anything.
  - With a new project, the old one becomes a frozen, read-only archive and the rollback target.
- **Complexity added:**
  - 3–5 admin password resets (the admin-initiated reset flow already being built).
  - Copying the `gst-receipts` bucket (small; files are under about 300 KB).
  - An import script (needed anyway for the transforms in §7).
  - Re-deploying the Edge Function and changing two Vercel env vars.
  - User UUIDs change; the import maps old to new by email.
- **Justified at this size:** Yes. The cost is a few hours of cutover. The benefit is that every later migration is testable on an empty project.
- **If skipped:** You build on a schema nobody can reproduce, and the 0922-style "count duplicates first, then maybe skip" migrations become permanent.
- **Cutover:**
  1. Dry-run the import repeatedly; it is idempotent (truncate the new tables, re-import).
  2. Freeze the old project (revoke authenticated writes).
  3. Run the final import.
  4. Admin creates the users.
  5. Switch env vars.
  6. Keep the old project for 90 days plus a `pg_dump` archive. It will auto-pause on the free tier, which is fine.
- **ASSUMPTION:** the org has a free project slot (the free tier allows 2 active projects).

### B. Companies: one table, derived roles, plus sites and contacts

- **Problem solved:** Agents, distributors and customers are all just organisations. Ghani Glass KHI/LHR must aggregate up to one company while staying distinct per plant. Today's 3 Ghani rows (FACT) split the history.
- **Why better:**
  - Separate clients/vendors/prospects tables duplicate companies that are both, and need converting a prospect to a client (that was paperwork).
  - Hand-set role flags drift. Derived roles cost zero input.
  - A supplier added to a shortlist before any float counts as a supplier through `company_brands`.
- **Complexity added:** 2 small tables (sites, contacts) and one view.
- **Justified:** Sites carry real history (FACT: separate KHI/LHR rows). Contacts tell the owner who to chase.
- **If skipped:** Sites become text fragments ("KHI", "Karachi"), and "same as last year for that plant" breaks.

### C. Clarifications: one record per question, captured by paste, stamped by copy actions

- **Problem solved:** ~20 of 43 losses came from this loop (FACT). Questions are answered in stages, so only per-question state can count "2 unanswered".
- **Why better than a thread:** A thread or log of messages cannot answer "which questions are still open", and supplier X's questions cannot be told apart from Y's. A bundle/message entity is the other candidate, but the shared `last_asked_at` stamp already is the bundle.
- **Input cost:**
  - Paste the supplier's text and it splits into lines.
  - "Copy questions for customer" puts the bundle on the clipboard and stamps the asked times.
  - Type the rewritten answer, which is the text you would have written to the supplier anyway; optionally attach a photo.
  - "Copy answers for supplier X" stamps the relay time.
  - Nothing is entered purely to record.
- **Complexity added:** 1 table, 4 timestamps, and one timestamp on inquiries.
- **Justified:** This is the highest-ROI loop in the data.
- **If skipped:** The dominant loss mechanism stays invisible, as it was before.

### D. Attachments: two attach points only

The two attach points are RFQ/clarification and the GST invoice receipt. Storage uses two private buckets with a 5 MB cap and the existing client-side compression (`imageCompress.ts`).

- **Problem solved:** Answers arrive as nameplate photos (FACT). These must sit next to the question for the engineer rewriting the answer. GST receipts are already uploaded (FACT).
- **Why better than unrestricted attachments:** Allowing files everywhere invites a document-management system. The old blanket ban (PRODUCT_BIBLE §4) contradicts what is already deployed.
- **Why better than keeping the receipt as a path column:** One table and one RLS model instead of per-table file columns.
- **Complexity added:** 1 table, 1 new bucket, storage policies mirroring table RLS.
- **Justified:** Yes, on free-tier storage (1 GB at roughly 300 KB per file).
- **Not in MVP:** Expense and commissioning receipts. The CHECK pattern makes adding `expense_id` a one-column migration if the owner wants it. *(Reversed by A6: expense receipt photos are allowed, admin only, bucket `expense-receipts`.)*
- **If skipped:** Photos stay in WhatsApp, and the engineer rewriting the answer cannot see them in context.

### E. Brands and families as tags with a supplier link

- **Problem solved:** "Who carries Belimo" is answerable without a catalog. Today brand is encoded in vendor names ("DEAO China (Siemens Distributor)", FACT).
- **Why better than a free-text array on companies:** RFQ and order items need the same identity in order to auto-suggest suppliers. Merges fix typos once.
- **Complexity added:** 2 tables, plus the auto-learn trigger from quote lines.
- **Justified:** The supplier shortlist pre-fill is concrete daily work: who supplied it before, who carries the brand, and the family shortlist.
- **If skipped:** Supplier choice stays in people's heads, and new staff cannot float.

### F. Orders: optional RFQ, order items, procurement legs, per-item supplier quotes

- **Orders without an RFQ:** `rfq_id` is nullable. `create_repeat_order` copies the last order's items, prices and suppliers. That is the "same as last year" motion, and it is the most do-work feature in the model.
- **One RFQ to many orders:** Allowed (partial awards). Double submits are blocked by the client-generated id, not by a unique index. The unapplied `20260922_one_order_per_rfq.sql` is superseded.
- **Challenging the owner's shape** ("each item linked to its own supplier order"):
  - Kept, but grouped: items point to a leg, a leg is one supplier within one order, and dates live on the leg.
  - Simpler alternative considered: `supplier_id` plus dates on each item.
    - It repeats PO, receive and deliver dates on every line from the same shipment.
    - It gives supplier payments nothing to attach to.
  - Simpler still: one supplier per order, the old rule.
    - Fits all 17 seeded orders (FACT).
    - But it forces split orders (PO 000001 A/B), which breaks one invoice per PO and per-PO receivables.
  - Verdict: the leg table earns its place for multi-supplier orders and partial delivery. It costs one row per supplier per order, which in practice is almost always exactly one.
- **Per-item supplier quotes:** `supplier_quote_lines` per (inquiry, item), with currency required and no default. Partial quotes are rows that simply are not there.
- **Complexity added:** 3 tables (items, legs, quote lines).
- **If skipped:**
  - Multi-item RFQs stay crammed into one line.
  - Foreign-currency quotes stay mislabelled as PKR.
  - Partial supplier coverage stays unexpressible. All three are confirmed defects.

### G. Status as independent derived dimensions (§5)

- **Problem solved:** The real states are orthogonal (FACT: "received & delivered" vs "payment received" vs partial). One enum forces false choices and gets stuck: 79 RFQs sat in "quoted" (FACT).
- **Why better than hand-maintained statuses:** A status changes as a side effect of facts already entered (a payment, a date). It cannot go stale, and nothing asks the user to "update status".
- **Hand-set values:** Only the decisions the outside world makes: RFQ closed + reason, bid sent, no offer, order cancelled, costs complete, engineer dates.
- **Complexity added:** Views instead of columns, using `security_invoker` so RLS holds.
- **If skipped:** You rebuild the status drift that made the old app untrustworthy.
- **Visibility by role (Revision 1):** Visibility now depends on role. The payment and cost dimensions are hidden from engineers, so each role's view computes "done" only from the dimensions that role can see. A hidden dimension never counts as finished.

### H. Quote versioning — amended by Amendment A2

- Still no general versioning.
- A **revision now exists as a row** in `quotations` or `purchase_orders`, and only when a document is actually issued.
- `rfq_items.quoted_unit_price_net` stays as the working copy.
- Why: a document a customer or supplier holds must never change underneath them. A snapshot row is the cheapest guarantee.

**Original rationale (retained from the frozen model):**

- **Evidence:**
  - `quoted_price` is 0 or NULL on all 176 RFQs (FACT).
  - The only revision-like notes are "sent offer again", which is a re-send, not a re-price.
- **What to do instead:** Re-quoting overwrites `rfq_items.quoted_unit_price_net` and `quoted_on`. `audit_log` keeps the prior values.
- **Complexity avoided:** A versions table, "current version" pointers, and comparison UI.
- **Revisit** only if negotiated revisions become routine. The model then adds `rfq_quote_versions` without touching items.

### I. Per-person quarterly targets on net cash (Revision 1)

- **Problem solved.** The owner wants each person to see how far behind their own target they are. The measure is cash actually received, with GST excluded, matching how profit is measured. That gives people a reason to chase payment, not just to win the order.
- **Why this is better than simpler options:**
  - Company-level targets (the old table) can't show any individual their own gap.
  - Booked order value (the old metric) rewards orders that are never paid.
  - Storing "achieved" would drift away from the actual payments.
  - A self-view that runs with owner rights is the smallest way to give engineers their own number without opening money tables to them.
- **Complexity added:**
  - one table (`targets`)
  - one column (`payments_in.credited_user_id`, plus the trigger that fills it)
  - one admin view (`v_payment_net`)
  - one admin view (`v_target_progress`)
  - one definer function (`my_target_progress()`)
- **Justified at this size.** Yes. The target is entered once a quarter by an admin, and everything else is calculated from payments that are recorded anyway.
- **If skipped.** The owner tracks targets in his head or in Excel, and engineers can't see their position at all.

### J. Currency conversion: nightly automatic rates, manual override, rate captured on each line. *(Amendment A2b; replaces the manual-only version)*
- **Problem:** "Lowest price" compared USD, CNY and EUR as raw numbers, which is wrong.
- **Why better than the alternatives:**
  - *Manual-only rates* depend on someone typing them. They go stale silently, and the comparison quietly degrades.
  - A nightly **server-side** fetch types nothing. It adds no CSP entry (the browser never calls the rate service) and puts no outage in the user's path.
  - The objection that "the API gives the interbank rate, but Q-Tech pays its bank's rate" is answered by **manual override**, which wins on its day.
  - *Comparing at captured rates* would compare suppliers who quoted on different days at different rates, so live comparison uses today's rate.
  - The captured rate keeps history honest ("what it cost then").
- **Complexity added:** 1 table, 1 view, 1 trigger, 2 columns, one step in the nightly job, the inline prompt.
- **Justified at this size:** yes. A handful of currencies, no recurring input.
- **If skipped:** wrong supplier choices, wrong cost suggestions, and misleading price history.
- **Note:** The costing engine stays removed. PKR figures are only ever a display or a suggestion.

### K. Customer quotation and supplier PO PDFs.

This reverses the non-goal "no PDF generation", for these two documents only. Sales-tax invoice PDFs stay out.
- **Problem:** the team produces these documents by hand today. The app already holds every field they need.
- **Why client-side `@react-pdf/renderer`:**
  - It lays out tables and typography like a page component, which is good enough for a branded letterhead.
  - It is lazy-loaded (only fetched when the user generates a document), so the ≤ 300 KB initial JS budget is untouched.
  - Rejected — an Edge Function: cold starts, embedding fonts on the server, harder debugging.
  - Rejected — `window.print()`: inconsistent output, and poor on phones.
- **Sharing:** on a phone, the "Share…" button opens the operating system's share sheet with the PDF (Web Share API with files), so the user can send it in WhatsApp themselves. The app still never sends anything.
- **Complexity added:** 3 tables (`quotations`, `purchase_orders`, `company_profile`), 2 RPCs, 1 bucket, a lazy-loaded chunk of roughly 0.4–0.5 MB gzipped (INFERENCE; measured in task R20).
- **If skipped:** documents are typed by hand outside the system, and the prices on them drift from the records.

### L. Chase texts on the clipboard.
- **Problem:** chasing is where most deals are lost (about 20 of 43 losses). Writing each chase by hand is friction.
- **What it is:** pure text generators plus atomic "stamp" RPCs. Stamps both prevent nagging and drive the escalation suggestions.
- **The new counters are justified** because they drive the "close?" and "float elsewhere?" suggestions. Without them, the last-chased date alone can't tell a first chase from a fifth.
- **Engineers never receive payment texts:** the generator's data comes from `order_receivables()` and `invoices`, and engineers can call or read neither.

### M. Share-in as an installable web app, with one Capture sheet on every platform. *(Amendment A2b; replaces the earlier version)*
- **Problem:** Customers' answers arrive as WhatsApp text and nameplate photos on phones.
- **Design:** One **Capture sheet**, the same on every platform, offering:
  - a native paste zone ("tap and hold → Paste"; the system paste avoids the clipboard-permission prompt and accepts images)
  - a photo/file picker
  - drag-and-drop and paste on desktop (for WhatsApp Desktop users)
  - a destination chooser with recents: RFQs opened in the last 24 hours, plus the user's own RFQs that have open questions. Destinations: answer a question / new supplier questions split into lines / add to RFQ notes / start a new RFQ.
- **Entry points:** the Capture button in the top bar, RFQ detail, and the clarifications panel.
- **Android:** Web Share Target adds "Q-Tech CRM" to WhatsApp's share sheet. The service worker accepts the POST, keeps the payload in IndexedDB and opens the same sheet. Three taps.
- **iPhone:** Safari has no share targets (FACT). The path is Copy → switch to the app → Paste → choose destination: four or five taps, the same sheet, not a lesser one.
- **Shared rules:**
  - Payloads survive a login redirect.
  - Local copies are cleared after **7 days**.
  - Images are compressed with `imageCompress` and capped at 5 MB.
  - The service worker caches the **app shell only**, never API or data responses.
- **Rejected: an iOS Shortcut.**
  - A Shortcut can only open a URL, and on iOS that opens Safari, not the installed web app. Safari keeps a separate login, so the user lands on a login screen.
  - Images can't travel in a URL.
  - Posting straight to the API would mean storing an auth token inside the Shortcut.
  - Revisit only if Apple adds share-target support.
- **Complexity added:** a manifest, a shell-only service worker, one route, one sheet. No schema change.
- **Q4 is closed** (the team uses both Android and iPhone).

### N. Supplier memory: derived, honest, never a score (§5c)

- **Problem:** supplier choice lives in people's heads.
- **Why better:**
  - A composite score hides its reasoning, and the owner rejects scores.
  - Manual supplier ratings would be paperwork.
  - Derived counts cost no input.
- **Complexity added:** 2 views, 1 function, the trigram indexes. *(Amendment A2b: plus the `model_tokens` function, 2 generated columns, 2 GIN indexes; the 'same model' tier is the strongest match because a shared model code is clearer to the user than text similarity.)*
- **Expected value curve:** close to empty before cutover. It becomes useful once roughly 140 legacy inquiries and 124 quotes are imported, and grows with use.
- **If skipped:** the intake suggestions give a reason but no evidence.

---

## 7. Migration mapping (old project → new; import script; every run reproducible)

| Old table | Destination | Transform rules | Flags / drops |
|---|---|---|---|
| users | users + new auth users | Match by email. Admin creates auth users and issues one-time passwords. Keep an old-id → new-id map in the script (not persisted). | — |
| clients | companies (+ company_sites + contacts) | Owner reviews a merge list (e.g. "Ghani Glass", "(KHI)", "(LHR)" become one company with 2 sites; "IFL Head Office" becomes IFL plus a Head Office site). Non-empty contact fields become a contact. `industry` → notes. `address` → site address. | `legacy_source` keeps the original row. |
| prospects | companies | Dedupe against clients by normalised name. `lead_source` → notes. | Drop `status`, `follow_up_date`, `assigned_to`, `converted_client_id`. |
| vendors | companies + brands + company_brands | Reviewed parse list: "Red Lion USA (via Four Stars)" becomes company Four Stars with brand Red Lion; "DEAO China (Siemens Distributor)" becomes DEAO with brand Siemens; "XIAMEN TONGKONG (Moxa Taiwan)" becomes XIAMEN TONGKONG with brand Moxa. `products_supplied` → family tags where they match, else notes. `country` kept. | Unparsed names import as-is, flagged `name_unparsed`. |
| rfqs | rfqs | See the rules after this table. | Drop `estimated_value`, `quoted_price`, `quote_expiry_date`, `converted_order_id`, and the text identity fields once matched. |
| rfq_line_items | rfq_items | `specification` → description. `product_type` → family brand. `quantity` → qty. | Drop `target_price`. |
| supplier_inquiries | supplier_inquiries | `sent_at` → `sent_on` (parsed). Old `no_response` status means silence and is left derived; it is NOT mapped to `no_offer_on`. "Floated but could not find offer" phrases in RFQ notes are surfaced for manual tagging. | Drop `email_draft` (kept in `legacy_source`), `follow_up_date`. |
| supplier_quotes | supplier_quote_lines | Old quotes are RFQ-level. If the RFQ has exactly 1 item, link to it; otherwise link to the first item. `lead_time_days` → text. | Flag `item_guessed` on multi-item RFQs. Flag `currency_unverified` on every row (the hardcoded-PKR bug). Drop `moq`, `validity_days`, `is_selected`. |
| orders | orders + order_items + supplier_orders + **order_costs** | As before, except:<br>• `cost_value` → `order_costs.expected_cost_pkr` (one row per order where cost_value > 0).<br>• **PO 000001 Unit A and Unit B are merged (owner decision):**<br>&nbsp;&nbsp;– one order with `customer_po_number` 000001, `ordered_on` = the earlier date, one supplier order (XIAMEN TONGKONG)<br>&nbsp;&nbsp;– two items: "Moxa Serial-Ethernet Converter x2 — Unit A" and "… — Unit B", each qty 1 at 73,986<br>&nbsp;&nbsp;– both invoices (INV-0001 and -009, or their live GST-register equivalents) attached to the merged order<br>&nbsp;&nbsp;– all payments and expenses from both old orders moved to the merged order<br>&nbsp;&nbsp;– `legacy_source` holds both original rows<br>• **batch A** (no PO) and **batch B** (PO 90222) stay as separate orders. They don't clash on PO number, so they don't need the `po_shared` flag.<br>• Any *other* PO-number clash found in the live data goes to the owner as a merge-or-flag decision. | `po_shared` is used only if such clashes exist. |
| order_engineers | order_engineers + order commissioning dates | `needs_commissioning` = true. `start_date` → `commissioning_planned_on`. Status completed → `commissioning_done_on`. | Estimated done date flagged `dates_estimated`. Drop `site_location` (→ notes). |
| gst_invoices | invoices + attachments | As before. `fbr_status` maps as follows:<br>• Pending → none of the FBR dates set<br>• 'Generated' or 'Fully Generated' → generated (`psid` as stored); if `psid` is empty, add flag `fbr_generated_legacy` so the row still shows as generated<br>• 'Receipt Received' and 'Deposited' → checked against `wasif_receipt_on` and `tax_deposited_on`<br>Any remaining disagreement is flagged `fbr_status_mismatch`. | Same as before. |
| invoices (bookkeeping) | invoices, only where the order has no gst_invoices row and no `orders.invoice_number` | `invoice_amount` treated per the order's basis rule. | `amount_paid` NOT turned into payments; flagged `paid_per_old_invoice` if payments_in disagrees. Seed rows likely exist (17). |
| payment_records | — | Dead (FACT: no page reads it). | If rows exist and are not duplicated in order_payments, import as payments_in with flag `from_payment_records`. |
| order_payments | payments_in | `payment_date` → `received_on`; `reference` kept.<br>`credited_user_id`:<br>• the order's `owner_id` when the order isn't flagged `owner_unknown` or `owner_unreliable`<br>• otherwise empty (unattributed); admin can assign it afterwards<br>**No `tax_withheld`.** | Drop `payment_method`. |
| supplier_payments | expenses | category "Supplier payment"; `order_id`; `supplier_order_id` = the single imported leg; `payee_id` = the leg's supplier. | — |
| payables, payable_payments | expenses (payments only) | `payable_payments` with no supplier_payments equivalent → expenses. | Payables themselves dropped (module out). |
| expenses | expenses | `date` text → `paid_on`. Category kept. *(Superseded by A6.2: legacy category text maps to `category_id` through `mappings/expense_categories.csv`; unmapped rows get the flag `category_unmapped`; `paid_via` = 'bank', `bank_month` NULL.)* `vendor_id` → `payee_id`. `order_id` kept. | Flag `cost_possible_double_count` on orders that have both an "Inventory/Procurement" expense and supplier_payments. Flag `invalid_date` when parsing fails. |
| recurring_expenses | recurring_expenses | `''` → NULL. | — |
| follow_up_actions | — | Dropped. 552 machine-generated rows, never edited (FACT). | — |
| quarterly_targets | **targets** structure; **the old rows are dropped** | The old rows were company-level (year, quarter, target_value) and measured booked order value by PO date. The new target is per person and measured in net cash.<br>• Splitting an old company target across people would invent attribution.<br>• The old figures measure a different thing, so carrying them over would make old and new quarters look comparable when they aren't.<br>The old rows stay in the archive dump. At cutover, the admin enters the current quarter's per-person targets. | — |
| cost_lines, costing_config | — | Dropped (feature removed; 1 row). | — |
| budgets | — | Dropped. | — |
| employees, attendance | — | Dropped (HR cut). Export a CSV to the archive. | — |
| audit_log | — | Not migrated (old ids). Kept in the archive dump. | — |
| documents | — | Dropped. Verify it has 0 rows first. | — |

**rfqs rules:**
- `client_id` or `company_name` → `company_id`; site inferred from the merge list; contact fields → contact.
- `rfq_number`: if it looks customer-issued → `customer_ref`; otherwise kept in `legacy_source`.
- `due_on`: from `quote_deadline`, else parsed from a "Due: dd/mm/yyyy" note.
- `quoted_on` = `quote_sent_date`. Where that is NULL (52 of 79 quoted, FACT), use `rfq_date`.
- `assigned_to` → `owner_id`.
- priority high → `is_priority`.
- lost → `closed_on` = best available date. Reason mapping: price → price; competitor_won → competitor; poor_follow_up → we_were_late; other → other. Notes are not auto-classified.
- converted → won is derived through the order link.
- **Flags:**
  - `due_date_parsed`
  - `due_before_received` (the seed has "31/01/2024" on a 2025 RFQ)
  - `quoted_date_estimated`
  - `closed_date_estimated`
  - `owner_unknown` / `owner_unreliable` (seed rows all attributed to the admin)
- 50 or so stale open RFQs (FACT) import as open. A first-run clean-up screen lists those quoted more than 180 days ago for bulk close with reason `no_reply_to_clarification` or `other` (owner's one click).

**orders rules:**
- `ordered_on` = coalesce(`customer_po_date`, `confirmed_date`); if both NULL, flag `undated`.
- `sales_person_id` → `owner_id`.
- `order_value` → one item: qty 1, description from `product_type` + notes, `unit_price_net` = `order_value`, `gst_rate` 18.
- **Basis:**
  - If a linked gst_invoice proves net (difference ≤ 1) → no flag.
  - Otherwise flag `value_basis_unknown`.
  - Never converted silently.
- `cost_value` → `expected_cost_pkr`. *(Revision 1: lands in `order_costs.expected_cost_pkr`, §2.12a; see the §7 `orders` row.)*
- `vendor_id` → a leg.
- Old status → leg dates estimated from the best available timestamps, flagged `dates_estimated`. `delivery_date` maps to `delivered_on` only if the status says delivered; otherwise it maps to `expected_on`.
- `invoice_number`/`invoice_date` → an invoices row if no gst_invoice exists.
- Status payment_received but no payments → flag `paid_per_status_no_payment_rows`. Payments are never invented.
- Orders sharing (company, PO number), e.g. 000001 A/B → owner chooses: merge into one order with 2 invoices, or keep both with flag `po_shared`. *(Revision 1: decided. PO 000001 Unit A/B are merged; batch A stays separate; see the §7 `orders` row.)*
- **Drops:** dead costing columns, `profit`, `ops_dismissed`, `order_gst_amount` (used only for basis resolution), `payment_due_date`.
- Sale ≈ cost anomalies are flagged as `margin_anomaly` (e.g. PO 2224: note says 200,000 total landing, amount 150,000; PO 13378 is a negative-margin order).

**Additions (Amendment A2):**

| Old | New | Rule |
|---|---|---|
| — | fx_rates | Not imported. The nightly job (R23) seeds automatic rates from the day it goes live. Admin overrides only if the bank rate differs materially. *(Replaces "admin enters USD, EUR and CNY at cutover".)* Legacy quotes with `currency_unverified` aren't converted. *(Amendment A2b)* |
| — | quotations, purchase_orders | None. Legacy `rfqs.quoted_on` stands. Legacy `supplier_orders.reference` stays as text. Supplier POs issued from now on use `po_number_seq` (starting value from Q5). |
| — | company_profile | Entered by the owner (Q5). |
| supplier_quotes | supplier_quote_lines (unchanged) | Memory rules apply: legacy rows are excluded from reply-time medians; `currency_unverified` prices are hidden; `item_guessed` rows are excluded from item tiers. |
| rfq_line_items | rfq_items | `gst_rate` = 18. |
| supplier_quotes (add) | supplier_quote_lines.fx_rate_pkr / fx_rate_on | Set to NULL on import. History shows the original currency only. The FX-capture trigger skips rows whose `legacy_source IS NOT NULL`, so imported lines keep NULL rates without disabling any trigger (orchestrator correction: disabling triggers needs elevated privileges and is fragile). History shows the original currency only. *(Amendment A2b)* |
| orders (add) | order_items.supplier_unit_price, supplier_orders.currency | Left NULL; legacy supplier prices are unreliable. Repeat orders from legacy orders therefore start with blank prices. *(Amendment A2b)* |

---

## 8. Assumptions to validate against the live dump

1. Columns, types and nullability of the 12 tables without DDL match `database.types.ts` RECONSTRUCTED entries. In particular: `rfqs.quote_deadline`, `rfq_number`, `loss_reason`/`loss_notes` exist; `orders.confirmed_date` is timestamptz.
2. The format of text date columns (`rfq_date`, `sent_at`, `payment_date`, gst dates): YYYY-MM-DD vs other. Count unparseable values.
3. Duplicate counts on `rfq_number`, `customer_po_number`, `gst_invoice_number` (the pre-flight queries in `20260922_unique_business_identifiers.sql`).
4. RFQs with more than one order (the pre-flight in `one_order_per_rfq`).
5. Whether live `supplier_quotes` has any item-level link, and the distinct values of `currency`.
6. The set of `orders.status` values actually present, and which rows have order_payments.
7. For each order: does supplier_payments overlap with "Inventory/Procurement" expenses (double-count)?
8. Are bookkeeping `invoices`, `payment_records`, `payables` and `payable_payments` seed-only or also live? Compare to order_payments.
9. `gst_invoices`: number of rows, how many are linked to an order, and how many say 'Generated' or 'Fully Generated' but have an empty `psid`. Those need the `fbr_generated_legacy` flag.
10. The meaning of `gst_invoices.received_date`, and whether `tcs_receipt_date` always equals `tcs_sent_date`.
11. `gst-receipts` bucket object count and total size; every `wasif_receipt_file_path` resolves.
12. `documents` row count = 0; any live triggers, functions, views or cron jobs absent from the repo.
13. Number of users, their emails and roles; no non-email auth providers.
14. Distinct `clients.company_name` / `vendors.name`, to build the merge and parse lists.
15. GST rounding on the 4 net-proven invoices (per line vs per invoice).
16. Whether any order has GST other than 18% or 0 (exempt orders exist?).
17. Postgres version ≥ 15 on the new project (needed for `security_invoker` views).
18. Free-tier project slot available, and the Edge Function secrets list (`ALLOWED_ORIGINS`) to carry over.
19. For fully paid live orders, Σ `order_payments` should be within ₨1 of invoice net + GST. That confirms customers pay the full gross amount, and also confirms the net basis of `order_value`. Any shortfall becomes a reconciliation item, not a model change.
20. PO 000001: find the live rows (orders, invoices or GST-register rows, payments, expenses) for both units, so the merge in §7 captures every row.
21. How many rows `quarterly_targets` has and what they contain (archived only).
22. How reliable `orders.sales_person_id` is in the live data. Owners marked unreliable lead to unattributed payments, which affect past target results only.
23. In live `supplier_quotes`, does `received_at` hold real reply dates? If it does, import it as the effective reply date, so legacy rows can feed `median_reply_days` (the rule in §5c would then be relaxed).
24. open.er-api.com: confirm its terms allow a nightly server-side fetch, and compare its PKR rate against one week of the bank's TT selling rate. If the gap is above 2%, recommend manual override as the norm for USD. *(Amendment A2b)*
25. Which currencies appear in `supplier_quotes`, and do they include real non-PKR rows? This decides how big the `currency_unverified` problem is. *(renumbered from 24 by Amendment A2b)*

---

## 9. Blocking questions for the owner

**Closed by the owner:**

1. Engineers work the CRM → option (a). Applied in §10.
2. Customers pay the full gross amount and withhold nothing. `tax_withheld` is dropped; settled and receivable are measured on gross; margin and targets on net.
3. Every invoice goes to FBR; there is one register and no provincial tax.
4. FBR has a single "generated" state; legacy 'Generated' and 'Fully Generated' both map to it.
5. PO 000001 Unit A/B are merged; batch A stays separate.
6. Expenses are true cost, with no input-tax adjustment to margin.
7. Quarterly targets are kept, now per person and measured in net cash (§2.23, §5a, §5b, §6 I).

**New blocking questions:** none.

**Confirmations (don't block the build):**

1. **What sales can see of money.** Recommendation: sales keep **invoices** and the **GST register** (read and write), and get **`order_receivables()`** for every order:
   - That gives them each order's gross due, settled, balance, due date and overdue status.
   - No payment rows, expenses, costs, margin, cash month, or other people's targets.
   - Why:
     - Sales already have the GST register and the receipt bucket today (FACT: the current `gst_invoices` and `gst-receipts` access rules allow admin and sales), which suggests they do the TCS and FBR paperwork.
     - They also chase customers for payment on orders they own, and that needs the balance.
     - Cost and margin are what the owner wants protected, and sales gets neither.
   - If the owner says sales don't handle the GST paperwork: remove invoices from sales and keep only `order_receivables()`.
2. **Quarters are calendar quarters** (Jan–Mar = Q1), the same as today's dashboard. If targets should follow Pakistan's July–June fiscal year instead, that's a change to `my_target_progress()` only; the table doesn't change.

---

## 10. Access-control matrix

**Key:**
- S = read, I = insert, U = update, D = delete; — = no access.
- "own" = rows where `user_id` or `credited_user_id` is the caller.
- Deactivated users get nothing anywhere, because `current_user_role()` returns NULL for them.
- Access is checked twice: once in the app, and again in the database's row-security rules on every table.

| Table / object | Admin | Sales | Engineer | Notes |
|---|---|---|---|---|
| users | S | S | S | Writes only through the `admin-users` Edge Function (service role, admin caller). |
| companies | SIUD | SIU | SIU | Delete is admin-only, through `merge_companies`. |
| company_sites | SIUD | SIUD | SIUD | Delete is blocked if anything still references the site (FK). |
| contacts | SIUD | SIUD | SIUD | |
| brands | SIUD | SIU | SIU | Delete is admin-only, through `merge_brands`. |
| company_brands | SIUD | SIUD | SIUD | |
| rfqs | SIUD | SIU | SIU | *(0065)* `owner_id` is changed by an admin; sales may take an RFQ that has no owner. |
| rfq_items | SIUD | SIUD | SIUD | |
| supplier_inquiries | SIUD | SIU + D¹ | SIU + D¹ | ¹ Staff can delete only while `sent_on` is empty. |
| supplier_quote_lines | SIUD | SIUD | SIUD | Supplier prices are visible to engineers (owner (a)). |
| clarifications | SIUD | SIUD | SIUD | |
| orders | SIUD | SIU | SIU | No money columns are left on `orders`. Delete is also blocked once money is attached. *(0065)* `owner_id` is changed by an admin (sales may take an unowned order); `legacy_flags` is admin only, and `value_basis_unknown` changes only through `resolve_value_basis`. |
| order_items | SIUD | SIUD | SU¹ | Sale prices are visible to all staff (owner, 2026-10-19). ¹ *(0065)* An engineer writes quantities, prices, GST, the service flag, the leg and the supplier price, and adds or deletes lines, only in the transaction that creates the order (convert, repeat). |
| supplier_orders | SIUD | SIUD | SIUD | Delete is blocked if expenses are attached (FK). |
| order_engineers | SIUD | SIUD | SIUD | |
| **order_costs** | SIUD | — | — | |
| invoices *(changed, Amendment A2)* | SIUD | SIU | — | Sales' update now also covers the reminder stamp. See confirmation 1 in §9. *(A6)* Core columns locked for a closed month; stamps, `tax_bank_month` and notes stay editable. |
| payments_in | SIUD | — | — | *(A6)* Locked for a closed month, except `bank_month`. |
| expenses | SIUD | — | — | *(A6)* Locked for a closed month, except `bank_month`. |
| recurring_expenses | SIUD | — | — | |
| **expense_categories** *(A6)* | SIUD | — | — | Delete blocked while in use (RESTRICT); deactivate instead. |
| **closed_months** *(A6)* | S | — | — | Written only through the admin RPCs `close_month`, `close_months_through`, `reopen_month`. Audited. |
| attachments (parent is an RFQ or clarification) | SIUD | SIUD | SIUD | Storage bucket `rfq-files`: same rules. |
| attachments (parent is an invoice) | SIUD | SIUD | — | Storage bucket `gst-receipts`: admin and sales, as today. *(0065)* Once the invoice's month is closed, the attachment and its file cannot be changed or removed (a receipt can still be added). |
| attachments (parent is an expense) *(A6)* | SIUD | — | — | Storage bucket `expense-receipts`: admin only, private, 5 MB. *(0065)* Locked like invoice receipts once the expense's month is closed. |
| attachments (parent is an order) *(R22)* | SIUD | SIUD | SIUD | Storage bucket `rfq-files`: same rules as RFQ files. One parent per row: RFQ, order, invoice or expense. |
| snoozes | own SIUD | own SIUD | own SIUD | |
| **targets** | SIUD | S own | S own | |
| audit_log | S | — | — | Append-only; written only by triggers. |
| v_company_roles, v_rfq_state, v_inquiry_state, v_order_state | S | S | S | Show net, GST and gross from items only. |
| v_invoice_state, v_gst_register | S | S | — | |
| `v_gst_month` *(A6)* | S | S | — | Its input-tax column is NULL for sales. |
| `v_month_pnl`, `v_month_expense_category`, `v_month_team`, `aging_as_of()`, `payables_as_of()`, `month_end_status()` *(A6)* | S | — | — | Explicit admin check inside each. |
| RPCs `close_month`, `close_months_through`, `reopen_month` *(A6)* | ✓ | — | — | Run as the caller; admin check inside; audited. |
| v_order_money, v_cash_month, v_payment_net, v_target_progress | S | — | — | Explicit admin check inside each view. |
| `order_receivables()` (definer) | ✓ | ✓ | — | Returns gross due, settled, balance, due date and overdue. No cost or margin. |
| `my_target_progress()` (definer) | ✓ (own) | ✓ (own) | ✓ (own) | No parameters; always the caller and the current quarter. |
| RPCs `convert_rfq_to_order`, `create_repeat_order` | ✓ | ✓ | ✓ | Run with the caller's permissions; never write to `order_costs`. |
| RPCs `merge_companies`, `merge_brands`, `resolve_value_basis` | ✓ | — | — | |
| fx_rates | SIUD | SIU² | SIU² | ² Insert and update are allowed only where `source = 'manual'`. Automatic rows are written by the R23 nightly job using the service-role key, which bypasses RLS. |
| `model_tokens()` | ✓ | ✓ | ✓ | Immutable helper with no data access. |
| order_items.supplier_unit_price, supplier_orders.currency | SIU | SIU | SIU¹ | Covered by the existing rules on those tables. Supplier prices are visible to engineers. ¹ *(0065)* An engineer writes `supplier_unit_price` only on a new order (see order_items). |
| company_profile | SU | S | S | Singleton row, no insert or delete. |
| quotations | SIUD | SIU¹ | SIU¹ | ¹ UPDATE limited to `pdf_path` by the trigger. *(0057)* Staff attach the first PDF; re-pointing or clearing an attached `pdf_path` is admin only. Same for `purchase_orders`. |
| purchase_orders | SIUD | SIU¹ | SIU¹ | Supplier prices are visible to engineers, consistent with §10. |
| bucket `generated-docs` | SIUD | SIU | SIU | Private. *(0057)* PDF only; an object an issued document points at is updated by an admin only. |
| v_fx_latest, v_supplier_activity, v_supplier_stats, `supplier_item_memory()` | S | S | S | Security invoker. Every underlying table is already readable by all staff. |
| `customer_price_memory(rfq_id)` (R19, migration 0037) | X | X | X | Security invoker. The issue-quotation price chips: last sold to this customer and last quoted, same model or same item. Reads orders, order items, quotations and RFQ items, all readable by all staff. |
| RPCs `issue_quotation`, `issue_purchase_order`, `stamp_clarification_ask`, `stamp_supplier_chase` | ✓ | ✓ | ✓ | |
| RPC `stamp_payment_reminder` | ✓ | ✓ | — | |
| RPCs `void_payment`, `correct_payment`, `restore_payment` *(0073)* | ✓ | — | — | Run as the caller; admin check inside; refused in a closed month and on a bank-ticked payment; audited. |
| users.job_title | via `admin-users` | — | — | |

S14 (the access-matrix test) and S16 (the remote anonymous-denial smoke test) now cover **28 tables** *(superseded by A6: 30 tables; each A6 task adds its own rows to the S14 matrix data)*.

---


## Amendment A3: minimal entry burden (2026-10-13)

Standing rule from the owner: logging must be as limited as possible, because if engineers waste time logging every detail the CRM becomes useless again. Required fields are the true minimum, dates default to today, and context pre-fills. The build-plan rule is FE-2 (`BUILD_PLAN.md`). Where A3 conflicts with text above, A3 wins. The owner delegated the calls on `tax_deposit_bank`, `client_received_on` and monthly batch stamping (`DECISIONS.md`).

### Schema changes

**A3-1. `clarifications` (§2.11).**
- Replace CHECK (`answer IS NOT NULL` iff `answered_at IS NOT NULL`) with CHECK (`answer IS NULL OR answered_at IS NOT NULL`).
- The app requires an answer **or** an attachment on the clarification before it stamps `answered_at`. This is app/RPC logic; the CHECK only forbids text without a stamp.
- When only a photo was given, the relay text to suppliers reads "see attached photo".

**A3-2. `invoices` (§2.16).** Drop `tax_deposit_bank`. Use `notes` instead.

**A3-3. `invoices` dates (§2.16).**
- `copy_received_on` is kept for now. Mark it "verify against live data at the I06 import; drop if unused or identical to `tcs_sent_on`".
- `client_received_on` is kept as optional. It is not in the entry flow, and no Today rule reads it.

**A3-4. Defaults and stamping RPCs.**
- `rfqs.owner_id` and `orders.owner_id` DEFAULT `auth.uid()`. Converting an RFQ carries its owner across.
- `payments_in.received_on`, `expenses.paid_on` and `invoices.invoice_date` DEFAULT `today_pkt()`.
- `invoices.tax_deposit_amount` defaults to `gst_amount` when the deposit date is stamped (done inside the stamping RPC, not as a column default).
- Batch stamping RPCs for the TCS and FBR tracks, each taking a set of invoice ids:
  - sent by TCS today;
  - PSID;
  - deposited today.
- Single-invoice stamping still works (the same RPCs with one id). GST, TCS and FBR steps are stamped in monthly batches.

### App-behaviour notes (no schema change)

- **Leg dates:** one next-step stamp button: Mark placed / Received today / Delivered today. Delivered fills `received_on` if it is empty.
- **`expected_on`** is suggested from `placed_on` plus the upper bound of the chosen quote line's lead time.
- **Engineer commissioning** is one tap: "Mark done today". The planned date is a separate small action. Scope, gate pass and site phone are **not** fields; use order notes and contacts.
- **Missing FX rate** never blocks saving a price. The line shows "not compared, no rate".
- **Price chips:** the last price sold to this customer and the last price quoted.
- **`payment_terms_days`** defaults to the company's last order.
- **PO incoterm and terms** default to the supplier's last PO, else `company_profile`.
- **Invoice number** pre-fills as the next number in the series.
- **Payment in:** amount = balance due, date = today.
- **Expense context pre-fills:** from a leg, the category is supplier payment and the payee and leg are filled; from an order, the last category used.
- **Close reason** is pre-filled from context.
- **Supplier goods-chase text** includes `supplier_orders.reference`.

---

---

## Amendment A6: monthly bookkeeping (2026-10-14)

Approved by the orchestrator on 2026-10-14. Where A6 conflicts with text above, **A6 wins**. It adds `expense_categories` and `closed_months` (30 tables), changes `expenses`, `payments_in`, `invoices`, `recurring_expenses` and `attachments`, and adds the month lock and the monthly views. Decisions are in `DECISIONS.md`; tasks (S20–S23, M10–M13, D15) and the UI tap targets are in `BUILD_PLAN.md` Amendment A6.

**Built state it was planned against** (main `db8d3ed` plus branch `p1/s19-s14`): money tables are in migration 0010 (`expenses.category` is free text, no paid-via, no bank tick); attachment parents are only RFQ/clarification and invoice; `v_cash_month` is in 0015, admin only; stamp RPCs are in 0020 and run as the calling user; S19 takes migration 0024 and S14's matrix test is `tests/0025_access_matrix.test.sql`.

A6 adds four migrations, **0025–0028**: categories, bank ticks and receipt photos, month close, monthly reports. None of it touches S19 or S14; A6 branches start from main and rebase after `p1/s19-s14` merges.

**Input tax:** decided "yes" (claimed), to be confirmed by the owner at the D15 review. The optional `input_tax_pkr` field is shown only on Supplier payment, Clearing and Freight, collapsed by default. If the owner says no, hide the field; the column stays 0 and nothing else changes.

### A6.0 Answers to the seven questions

| # | Answer |
|---|---|
| 1 | **A table, `expense_categories`**, with a group (overhead / order cost / not in P&L), sort order, an active flag and a default paid-via. `expenses.category_id` is a foreign key, so pgTAP can enforce it (FK plus an active-category trigger). Free text can't carry the group the reports need, and renaming a category would mean rewriting rows. |
| 2 | **Yes, one field: `paid_via`** ('bank' or 'cash') on expenses and on payments in. It is **defaulted from the category** (snacks and fuel default to cash), so it normally costs zero taps. Only bank items appear in the tick list. There is no cash book. |
| 3 | **Columns, not a table:** `bank_month date` (the statement month the item was ticked against) on `payments_in` and `expenses`, plus `invoices.tax_bank_month` for FBR deposits. Who ticked and when is already in `audit_log`. |
| 4 | **A `closed_months` table** plus lock triggers on payments, expenses and invoices, and admin RPCs to close and reopen, all audited. Tick and filing-stamp columns stay editable after a month closes. The import runs before any month is closed (see A6.2). |
| 5 | **Views and functions** as specified in A6.3, all admin-only with the explicit role check. The exception is the GST month summary, which admin and sales can both see, because sales already see the register. Checklist: `month_end_status()`. |
| 6 | **Owner salary goes under Salaries** (it is in the P&L). **Drawings and loan principal repayments go to a "Not in P&L" group,** shown below the result as "after drawings". Loan interest goes under Bank charges. Loans or capital *received* aren't recorded in the MVP (`payments_in` needs an order), so they never show up and need no tick. This doesn't need the owner. |
| 7 | **A Month-end tab in Money** (checklist, reports, bank tick, close button) and **burst expense entry**. Tap targets are in A6.5. **One mockup is needed (D15)** before building M10–M13, with a mini review by the owner. |


### A6.1 Schema changes (new migrations after S19's 0024)

#### 0025_expense_categories (task S20)

**`expense_categories` (new table)**
- Standard columns: id, created_at, created_by.
- `name text NOT NULL`, unique on `lower(btrim(name))`.
- `grp text NOT NULL`, CHECK in ('overhead', 'order_cost', 'non_pnl').
- `default_paid_via text NOT NULL DEFAULT 'bank'`, CHECK in ('bank', 'cash').
- `sort smallint NOT NULL DEFAULT 0`.
- `active boolean NOT NULL DEFAULT true`.
- Deleting a category that is in use is blocked by RESTRICT; deactivate it instead.

**Seed rows** (name: group, default paid via):

| Group | Category | Default paid via |
|---|---|---|
| Overhead | Salaries | bank |
| Overhead | Rent | bank |
| Overhead | Utilities | bank |
| Overhead | Fuel & travel | cash |
| Overhead | Office supplies & snacks | cash |
| Overhead | Courier & postage | cash |
| Overhead | Repairs & maintenance | cash |
| Overhead | Bank charges | bank |
| Overhead | Taxes & fees | bank |
| Overhead | Other | bank |
| Order cost | Supplier payment | bank |
| Order cost | Freight | bank |
| Order cost | Clearing | bank |
| Order cost | Commissioning | cash |
| Order cost | Subcontractor | bank |
| Not in P&L (PROPOSED additions) | Owner drawings | bank |
| Not in P&L (PROPOSED additions) | Loan repayment | bank |

**Changes to `expenses`:**
- `category text` is replaced by `category_id uuid NOT NULL`, FK RESTRICT. There is no live data yet, so the text column is simply dropped.
- `paid_via text NOT NULL`, CHECK in ('bank', 'cash'). A BEFORE INSERT trigger fills it from the category's `default_paid_via` when it is left NULL.
- `input_tax_pkr numeric(14,2) NOT NULL DEFAULT 0`, CHECK between 0 and `amount_pkr`.
  - **Why:** `amount_pkr` must equal the bank debit or the tick can't match.
  - The cost used in the P&L and in order margin is `amount_pkr − input_tax_pkr`. This keeps the earlier decision that costs exclude recoverable input tax. It is optional and normally 0.
  - Margin views are amended to use the net cost.

**Other changes:**
- `recurring_expenses.category` becomes `category_id`, the same way.
- A trigger rejects inserting an expense, or changing its category, to an inactive category. Legacy rows (non-empty `legacy_flags`) are exempt.
- `v_order_money` uses the net cost. This is a `create or replace` of the 0015 view; results are unchanged while input tax is 0.

#### 0026_bank_and_receipts (task S21)

**Bank ticks:**
- `payments_in.paid_via text NOT NULL DEFAULT 'bank'`, same CHECK.
- `payments_in.bank_month date` and `expenses.bank_month date`, both CHECK first day of the month. NULL means not ticked.
- A CHECK on both tables: `bank_month IS NULL OR paid_via = 'bank'`.
- `invoices.tax_bank_month date`: the tick for the FBR deposit. The UI ticks a whole PSID group at once.

**Receipt photos on expenses** (the owner's "optional receipt photo"; this reverses "expense receipts out of MVP"):
- `attachments.expense_id uuid`, FK CASCADE to expenses.
- The `one_parent` and `bucket_matches_parent` CHECKs are extended for the new parent.
- New private bucket `expense-receipts`, 5 MB limit.
- Attachment rows and storage objects with an expense parent are **admin only**.

#### 0027_month_close (task S22)

**`closed_months` (new table)**
- `month date PK`, CHECK first day of the month.
- `closed_at timestamptz NOT NULL DEFAULT now()`.
- `closed_by uuid NOT NULL DEFAULT auth.uid()`.
- `note text`.
- Audit trigger attached.
- Reopening deletes the row. The audit log keeps the history.

**`month_is_closed(d date)`** is a STABLE function. Lock triggers run BEFORE INSERT, UPDATE and DELETE and check both the OLD and the NEW date:

| Table | Date column | Columns that stay editable after close |
|---|---|---|
| payments_in | received_on | `bank_month` |
| expenses | paid_on | `bank_month` |
| invoices | invoice_date | Everything except number, invoice_date, net_amount, gst_amount, order_id, company_id. So the TCS and FBR stamps, `tax_bank_month`, `last_reminded_on`, `reminder_count`, `notes` and `client_received_on` stay editable. October's filing happens in November. |

A blocked change raises errcode **P0001** with the message "September 2026 is closed. An admin can reopen it." U07 maps this to plain wording.

**RPCs** (run as the caller; admin check inside):

| RPC | Behaviour |
|---|---|
| `close_month(p_month)` | Refuses the current month or a future month. Refuses if an earlier month that has money rows is still open; the UI then offers `close_months_through`. |
| `close_months_through(p_month)` | Closes every open month up to and including `p_month`. One tap closes all imported history. |
| `reopen_month(p_month, p_note default null)` | Reopens one month. The note is optional. |

#### 0028_month_reports (task S23)

The views and functions in A6.3.

**Entity count goes from 28 to 30** (`expense_categories`, `closed_months`). DATA_MODEL §1, §2.16–2.20 and §10 are updated in place with "A6" notes.


### A6.2 How the existing machinery interacts with the month lock

- **Stamp RPCs** (`stamp_payment_reminder`, `stamp_tcs_sent`, `stamp_fbr_psid`, `stamp_tax_deposited`) only touch exempt invoice columns, so **they need no change**. They are tested in a closed month.
- **`issue_purchase_order`, `convert_rfq_to_order` and the other order RPCs** don't write locked tables, so they are unaffected.
- **Recurring "record this month"** in a closed month is refused. That is correct behaviour.
- **Import (I-series):**
  - All dry runs and the final load happen while **no month is closed**. Add this to the cutover runbook: the new project closes no month before the final import.
  - After the owner signs off, he runs `close_months_through(last month)` once.
  - A re-import later would need a reopen, which is audited. There is **no trigger bypass for the service role**, deliberately, so the lock has no hidden hole.
  - The expenses transform (I05) maps legacy category text to `category_id` through a reviewed `mappings/expense_categories.csv`, e.g. Inventory/Procurement → Supplier payment, Travel → Fuel & travel, Office Expenses → Office supplies & snacks, anything else → Other.
  - Unmapped rows get the flag `category_unmapped`.
  - Legacy rows get `paid_via` 'bank', and **their `bank_month` stays NULL**, because history isn't ticked.


### A6.3 Monthly views and functions (0028)

All use `security_invoker`. Each carries `where public.current_user_role() = 'admin'` unless noted.

| Object | Columns / rule |
|---|---|
| `v_month_pnl` | Per month:<br>• **Money in:** `net_in` (net portion of payments, from `v_payment_net`), `gst_in` (shown, not revenue), `unresolved_gross`.<br>• **Money out**, using net cost = amount − input tax: `order_costs`, `overheads`, `result = net_in − order_costs − overheads`, `non_pnl_out`, `after_drawings = result − non_pnl_out`.<br>• **Cash lines:** `cash_out_total` (sum of `amount_pkr`), `input_tax`. |
| `v_month_expense_category` | month, group, category, total net cost, gross paid, count. Feeds "water, snacks, salaries, fuel". |
| `aging_as_of(p_date)` | Per order and per invoice, as of `p_date`:<br>• Invoices dated ≤ p_date; payments received ≤ p_date.<br>• Payments are applied **first-in, first-out to the oldest invoice of the order**.<br>• Remaining gross is bucketed by days since invoice date: 0–30 / 31–60 / 61–90 / 90+.<br>• Advances on orders not yet invoiced are listed as "advance held", not as negative aging. |
| `payables_as_of(p_date)` ("we owe") | Per placed leg (`placed_on` ≤ p_date) on a non-cancelled order:<br>• **committed:** latest PO total, or else Σ qty × `supplier_unit_price`, in the leg's currency, converted at the rate on or before p_date.<br>• **paid:** Σ `amount_pkr` of "Supplier payment" expenses on that leg dated ≤ p_date.<br>• **owed:** ≈ committed − paid.<br>• Rows with owed within 3% of committed are shown as "settled (≈)"; negative owed is clamped at 0 with a flag. |
| `v_gst_month` (admin **and sales**) | Per invoice month:<br>• Invoice count, net, GST.<br>• PSID set count; deposited count and amount.<br>• GST still to deposit.<br>• `input_tax` from expenses by `paid_on` month, shown separately as "input tax paid (for the tax agent)". This one column is shown to admin only, so the view's input-tax column is NULL for sales.<br>Output GST and input tax are never netted together here; the filing stays with the tax agent. |
| `v_month_team` | Per month and per credited user: net cash credited. Next to it, quarter-to-date from `v_target_progress`. |
| `month_end_status(p_month)` | Returns the checklist counts below. |

**Checklist from `month_end_status(p_month)`.** Nothing blocks closing except the month-order rule in A6.1. Every item is a warning with a count and a jump link.

| Check | Rule |
|---|---|
| Bank items unticked | `paid_via = 'bank'`, dated ≤ month end, `bank_month` NULL. In-transit items are expected. |
| FBR deposits unticked | `tax_deposited_on` ≤ month end and `tax_bank_month` NULL. |
| Uncategorised | Category "Other" with no description; an order-cost category with no order tag; or the legacy flag `category_unmapped`. |
| Recurring not recorded | Active template with no expense for this period. |
| Provisional margins | Orders settled on or before month end without `costs_complete_at`. |
| FBR pending | Invoices dated in this month or earlier with no `tax_deposited_on`. |
| Unresolved payments | Payments counted in gross but not yet split into net, i.e. their order's value basis is unknown or zero (`v_payment_net.excluded_reason` is `basis_unknown` or `zero_value`). |


### A6.6 Acceptance tests (pgTAP unless marked)

### S20
- 17 categories are seeded with the right groups.
- A duplicate name differing only in case is rejected.
- An insert with an inactive category is rejected; a legacy row with an inactive category is accepted.
- Deleting a category that is in use is blocked; deactivating it works.
- `paid_via` is filled from the category: "Office supplies & snacks" gives cash.
- `input_tax_pkr` greater than the amount is rejected.
- `v_order_money` cost = Σ(amount − input tax).
- Engineer and sales get 0 rows from `expense_categories`.

### S21
- `bank_month` is refused on a cash item, and refused unless it is the first day of a month.
- An expense attachment with a non-admin caller is denied, for both the row and the storage object.
- The `one_parent` CHECK holds with three parents.
- The bucket–parent pairing is enforced.

### S22
- **Inside a closed month:**
  - Inserting, updating or deleting a payment or expense is refused with P0001.
  - Moving a payment's date *into* a closed month is refused.
  - Ticking `bank_month` succeeds.
- **Invoices in a closed month:**
  - Changing `net_amount` is refused.
  - `stamp_tcs_sent`, `stamp_fbr_psid`, `stamp_tax_deposited` and `stamp_payment_reminder` succeed.
  - Setting `tax_bank_month` succeeds.
- **Close and reopen:**
  - `close_month` on the current month is refused.
  - `close_month` with an earlier open month that has rows is refused.
  - `close_months_through` closes all of them.
  - `reopen_month` is admin only, and writes an audit row.
  - Sales and engineer are refused on every close RPC.

### S23
Each scenario is a named fixture.
- **P&L:** a fixture month with one GST payment, one exempt payment, overheads, order costs, input tax and a drawing gives the expected net in, result and after-drawings figures to the paisa.
- **Aging:**
  - Two invoices and a partial payment are applied first-in, first-out; the buckets land at days 29/31/61/91.
  - An advance on an uninvoiced order is listed separately.
- **Payables:**
  - A USD leg with a PO, converted at the rate on the month end, with one part payment, gives the expected owed figure.
  - A leg within 3% of fully paid shows "settled".
  - A leg on a cancelled order is excluded.
- **GST month:** sales see it, with input tax NULL.
- **Checklist:** each warning count is right on a fixture.
- **Access:** every new view gives 0 rows to non-admins.

### S14 data
Add rows for: `expense_categories`, `closed_months`, the attachment expense parent, the `expense-receipts` bucket, and the new views and RPCs.

### Playwright (M10–M13)
- The tap targets in A6.5.
- Burst entry of 5 rows done keyboard-only.
- A save rejected by a closed month shows the plain message and keeps the row's entries.

---

---

## Amendment A7: parity fields (migration 0039)

Optional data the approved mockups show. Every column is nullable; nothing is required of anyone and a screen shows the value only when it is there.

| Column | Type | Notes |
|---|---|---|
| `contacts.job_title` | text | "Procurement Manager" under the name; quotation "Attention" and chase signatures. |
| `companies.city` | text | The mockups show a city; `country` stays. |
| `rfqs.due_time` | time | Optional bid deadline time ("17:00"). `due_on` stays the date. |
| `users.phone` | text | Printed in signatures. Own row or admin may update (column grant and policy `users_update_phone`); it is the only writable `users` column. |
| `clarifications.rfq_item_id` | uuid, FK `rfq_items`, ON DELETE SET NULL | The item a question is about. |

`issue_quotation(p_quotation_id, p_rfq_id, p_valid_until, p_contact_id, p_delivery_text, p_payment_terms, p_notes, p_item_ids uuid[] default null)`: a partial quotation. Only the items in `p_item_ids` need a quoted price and are snapshotted; NULL means every item (unchanged). An empty array, or an id that is not an item of the RFQ, is an error. Section 10: `users.phone` own row U for all staff, any row U for admin; the function stays X for all staff.

### Critical Files for Implementation

- old CRM repo: supabase/migrations/seed_historical_data.sql
- old CRM repo: src/types/database.types.ts
- old CRM repo: supabase/migrations/20260729_t0_step2a_users_policy.sql
- old CRM repo: src/lib/finance/reconciliation.ts
- old CRM repo: supabase/functions/create-user/index.ts
- old CRM repo: supabase/migrations/20260729_t0_step2b_core_crm_policies.sql
- old CRM repo: supabase/migrations/20260731_gst_receipt_uploads.sql
- old CRM repo: src/lib/gst/fbr.ts
- old CRM repo: src/pages/DashboardPage.tsx

## Amendment A8: splitting an item across suppliers, and ranking supplier quotes (migrations 0049 and 0050)

No new table, no new column on an existing table. Owner overrides of 2026-10-15 are applied: no "Received" step on a leg (a leg goes Placed then Delivered; `supplier_orders.received_on` is kept equal to `delivered_on` by the app), and the selling price and spread are never returned to engineers.

### How a split is stored

Several `order_items` rows for one RFQ item (same `rfq_item_id`), each with its own `qty` and `supplier_order_id`. Nothing stops two lines sharing an `rfq_item_id`; the only rule added is in `convert_rfq_to_order` (below). Invoices, `v_order_money`, `v_order_basis`, `v_payment_net`, goods state, PO lines, `supplier_item_memory`, `customer_price_memory` and `create_repeat_order` need no change: they sum or copy lines and legs, so the parts add up to the same totals and a split is copied as a split.

### `rank_item_quotes(p_rfq_id uuid)` (0049)

SQL, STABLE, SECURITY INVOKER, fixed `search_path`. Every table it reads is readable by all active staff; `anon` has no execute. Section 10: X for admin, sales and engineer. One row per (RFQ item, quote line), ordered by item position, then rank (NULL last), then supplier name.

| Column | Meaning |
|---|---|
| `rfq_item_id`, `quote_line_id`, `supplier_id`, `item_qty` | The quote line and the quantity of the RFQ item. |
| `price`, `currency` | As quoted. |
| `fx_state` | `same_currency` (no conversion needed: PKR, or every line of the item in one currency), `fresh` (rate 7 days old or less), `stale` (8 to 30), `unusable` (over 30), `none` (no rate ever set). |
| `fx_rate_pkr`, `fx_rate_on`, `fx_age_days` | Today's rate from `v_fx_latest` used for the line (NULL for PKR or when none). |
| `pkr_unit_price` | `price` x rate, rounded to 2 places; PKR lines as quoted; NULL when no usable rate. |
| `comparable`, `rank` | `comparable` is false only when the item mixes currencies and this line has no usable rate. `rank` 1, 2, 3 among comparable lines; NULL otherwise. |
| `within_band`, `pct_above_best` | Within 2% of the lowest comparable price; the percentage above that price (0 for the best). |
| `sell_unit_net`, `sell_source`, `sell_order_number`, `sell_on` | **Admin and sales only; NULL for engineers.** `rfq_items.quoted_unit_price_net` (`quoted`), else the last price sold to this customer from `customer_price_memory` (`last_sold`, with that order's number and date), else `none`. |
| `spread_unit`, `spread_total` | **Admin and sales only; NULL for engineers.** `sell_unit_net - pkr_unit_price`, and that times `item_qty`. NULL without a selling price or a PKR figure. Before freight and duty; not the order margin. |
| `reliability_band`, `deliveries`, `on_time`, `late`, `median_days_late` | The supplier's legs with `expected_on` and a delivery date (`coalesce(delivered_on, received_on)`), all time. Band 1 proven (3 or more deliveries, on time at least 2/3), 2 unproven (fewer than 3), 3 often late. `median_days_late` only with 3 or more late. |
| `orders_count`, `orders_value_pkr`, `last_order_number`, `last_order_on`, `last_order_delivered_after_days` | Non-cancelled orders (not from this RFQ) with a leg for the supplier; value is qty x supplier price at today's rate where a usable rate exists (shown, never ranked on); the last order's leg days from placed to delivered (NULL if not delivered or not placed). |
| `replied`, `asked` | From `v_supplier_stats`. |
| `lead_time`, `in_stock` | For information; never used to rank. |

Ranking per item: comparable lines are sorted by (1) in the 2% band first; (2) inside the band by reliability band, then `orders_count` descending, then `last_order_on` descending (nulls last); outside the band by price; (3) price ascending, supplier name. The price compared is the raw price when the item has one currency, otherwise the PKR price.

### `supplier_item_memory` evidence columns (0049)

Appended to the result (the function is dropped and re-created because the result type changes; parameters and existing columns are unchanged):

| Column | Meaning |
|---|---|
| `evidence_tier` | The best tier (0 model, 1 item, 2 brand, 3 family) with a non-cancelled order that has a leg for the supplier. NULL when none. |
| `evidence_order_id`, `evidence_order_number` | The most recent such order at that tier. |
| `evidence_item_desc`, `evidence_qty` | The ordered line. |
| `evidence_placed_on`, `evidence_expected_on`, `evidence_delivered_on` | From the leg (delivered is `coalesce(delivered_on, received_on)`). |
| `evidence_delivered_after_days` | `delivered - placed`; NULL unless both exist. |
| `evidence_count_at_tier` | Legs with this supplier at that tier. |

### `convert_rfq_to_order` (0050)

Signature unchanged. New rules: when `quote_line_id` is left out the rank-1 line from `rank_item_quotes` is used (it was "the item's only line"); two entries for the same item that resolve to the same quote line are refused (22023, "split parts of an item must use different suppliers"). An item with no selling price is still refused. A split is two entries for one item, each with its own `qty` and `quote_line_id`.

### `split_order_item(p_item_id, p_qty, p_supplier_order_id default null, p_supplier_id default null, p_currency default null, p_supplier_unit_price default null) returns uuid` (0050)

SECURITY INVOKER. Moves `p_qty` of an order line to an existing leg of the same order (`p_supplier_order_id`), or to the leg for `p_supplier_id` and `p_currency` (the order's existing leg for that supplier and currency if there is one, else a new leg linked to the supplier's inquiry on the order's RFQ when it has one). Exactly one of the two is given. Needs `0 < p_qty < qty`; a service line is refused; the new line copies description, brand, family, unit, selling price, GST rate and `rfq_item_id`, and takes `p_supplier_unit_price` (NULL when not given: the source line's price belongs to another supplier); the source line keeps the remainder. Returns the new order line's id. Allowed after a PO was issued for the source leg (O07 shows "lines changed since PO"). Section 10: X for all staff.
