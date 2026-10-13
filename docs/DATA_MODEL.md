# Q-Tech CRM — Frozen Data Model

Status: FROZEN — approved by owner 2026-10-13

Sources: original model + Revision 1

This is one merged document: the planner's original model with Revision 1 applied in place. Section numbers are kept so tasks can cite them (§2.17, §5a, §10). Passages added or replaced by Revision 1 are marked "(Revision 1)" where practical.


Repo checked on `phase0/stabilise`. Claims are tagged **FACT** (seen in the repo or the brief), **INFERENCE**, **ASSUMPTION** or **PROPOSED**.

Evidence I relied on beyond the brief:
- **FACT** — `seed_historical_data.sql` holds 17 RFQs, 17 orders, 17 invoices, 17 expenses and 5 payables.
- **FACT** — Customer PO 253074 is split into two orders, "Unit A" and "Unit B", each with its own invoice (INV-2024-008/009).
- **FACT** — The seed header says `order_value` = "Sales Invoice … incl. GST". HANDOVER §8 proves it is net on 4 live rows. The two sources contradict each other.
- **FACT** — The PO 2224 expense note says total landing cost is 200,000, but the amount stored is 150,000.
- **FACT** — `rfq_line_items.product_type` holds product families ("Flow Meter", "Proximity Switch").
- **FACT** — `20260922_one_order_per_rfq.sql` contradicts PRODUCT_BIBLE §18 ("An RFQ may spawn multiple orders").
- **FACT** — Current RLS shuts engineers out of RFQs, enquiries and orders (write), and all finance tables are admin-only.
- **FACT** — `reconciliation.ts` labels `invoices`, `payment_records` and `payables` as dead in the live app.

---

## 1. Entity list (24 tables, down from 28)

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

Derived objects. All views use `security_invoker = true`. **Every view that exposes money also carries an explicit `current_user_role()` filter.** Underlying row security alone is not enough: if a user can't see some of the rows a view sums, the view returns a wrong number rather than nothing.

- Views: `v_company_roles`, `v_rfq_state`, `v_inquiry_state`, `v_order_state`, `v_invoice_state`, `v_gst_register`.
- Admin-only views: `v_order_money`, `v_cash_month`, `v_payment_net`, `v_target_progress`.
- Two narrow functions that run with owner rights, so they can read money tables the caller can't (`SECURITY DEFINER`, `STABLE`, fixed `search_path`; EXECUTE granted to `authenticated`, revoked from `public`/`anon`):
  - `order_receivables()`: payment status for admin and sales only.
  - `my_target_progress()`: the caller's own target, for any active user.

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
| owner_id | uuid FK users RESTRICT | no* | — | S | The person who chases. *NULL allowed only with the legacy flag `owner_unknown`. |
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

**Cut:** `target_price` (all NULL in the seed), and a separate `model` column (text search on description covers it).

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

- **Cut:**
  - `moq` and `validity_days` (validity defaulted to 30 and meant nothing) — they go in notes.
  - `is_selected` — selection is recorded by the order leg's supplier at conversion.
  - FX rate — no costing engine.
- Supplier price revisions overwrite the line; `audit_log` keeps the old value.

### 2.11 `clarifications` — [std] (decision C)

| Field | Type | Null | Default | S/D | Purpose |
|---|---|---|---|---|---|
| rfq_id | uuid FK rfqs CASCADE | no | — | S | |
| raised_by_inquiry_id | uuid FK supplier_inquiries SET NULL | yes | — | S | Which supplier asked. NULL means Q-Tech's own question. |
| question | text | no | — | S | One question. Captured by pasting the supplier's message; one line becomes one row. |
| first_asked_at | timestamptz | yes | — | S | Stamped the first time it goes into a "Copy questions for customer" bundle. |
| last_asked_at | timestamptz | yes | — | S | Stamped on every bundle or chase. Drives "asked 6 days ago". |
| answer | text | yes | — | S | Q-Tech's rewritten answer, the one relayed to suppliers. The raw answer stays in email/WhatsApp, or is an attachment if it is an image. |
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
| owner_id | uuid FK users RESTRICT | no* | — | S | The salesperson. *NULL only with flag `owner_unknown`. |
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

**Cut:** supplier amount and currency (payables module is out; the price is on the quote line), and leg status (derived from the dates).

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
| invoice_date | date | no* | — | S | The GST-register clock. |
| net_amount | numeric(14,2) | no | — | S | Legal figure; pre-filled from items. Stored because the invoice is the external truth FBR sees. |
| gst_amount | numeric(14,2) | no | — | S | CHECK ≥ 0 and ≤ net_amount. |
| copy_received_on | date | yes | — | S | TCS track step 1. Meaning to validate (§8). |
| tcs_sent_on | date | yes | — | S | TCS step 2. |
| tcs_number | text | yes | — | S | Consignment number. |
| client_received_on | date | yes | — | S | TCS step 4. |
| psid | text | yes | — | S | FBR track. |
| wasif_receipt_on | date | yes | — | S | Replaces both the boolean and the date column. |
| tax_deposited_on | date | yes | — | S | |
| tax_deposit_amount | numeric(14,2) | yes | — | S | |
| tax_deposit_bank | text | yes | — | S | |
| notes | text | yes | — | S | |
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

### 2.17 `payments_in` — [std] [L]

created_at, created_by, legacy flags and legacy source as before.

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| order_id | uuid FK orders RESTRICT | no | — | Payments are recorded against the order, because advances arrive before the invoice. |
| received_on | date | no | — | The date cash is counted (cash-basis revenue), and the date that places the payment in a target quarter. |
| amount | numeric(14,2) | no | — | CHECK > 0. **Gross**: the money actually received, GST included. Customers pay the full invoice amount and deduct nothing (owner, FACT). |
| credited_user_id | uuid FK users RESTRICT | yes | set from `orders.owner_id` when the payment is recorded | Whose target this payment counts towards. Copied once so that reassigning an order later doesn't rewrite past quarters. Admin can change it. NULL means unattributed (some legacy rows). |
| reference | text | yes | — | Cheque or bank-transfer reference. |

**Removed:** `tax_withheld` (the owner confirms no withholding happens) and `payment_method`.

The net portion of a payment is not stored; it is calculated by `v_payment_net` (§5).

### 2.18 `expenses` (all money out) — [std] [L]

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| paid_on | date | no | — | Cash-out clock. |
| amount_pkr | numeric(14,2) | no | — | CHECK > 0. What left the bank. |
| category | text | no | — | Free text with suggestions: Supplier payment, Freight, Clearing/Service, Commissioning – travel, Commissioning – subcontract, Commissioning – materials, Salaries, Utilities… The app maps known categories to procurement / commissioning / overhead. |
| description | text | yes | — | |
| order_id | uuid FK orders RESTRICT | yes | — | Tagging to an order makes it order cost. Actual cost = sum of these. |
| supplier_order_id | uuid FK supplier_orders RESTRICT | yes | — | For supplier payments, ties the payment to a leg. |
| payee_id | uuid FK companies RESTRICT | yes | — | Supplier, forwarder, subcontractor. |
| reference | text | yes | — | |
| recurring_id | uuid FK recurring_expenses SET NULL | yes | — | |
| period | char(7) | yes | — | YYYY-MM. UNIQUE(recurring_id, period). |

This replaces `expenses`, `supplier_payments`, `payables` and `payable_payments`. One table, one cost rule, one cash-out rule.

**Cut:** `payment_method`, `updated_by`, `updated_at` (`audit_log` covers them), and foreign-currency amount (no payables module).

### 2.19 `recurring_expenses` — [std]

Kept as today (VERIFIED shape):
- `label text NOT NULL`
- `category text NOT NULL`
- `amount numeric(14,2) NOT NULL` CHECK > 0
- `day_of_month smallint` CHECK 1–28
- `active boolean DEFAULT true`
- `start_month char(7) NULL` (was `''`)
- `notes`

It does work: "Salaries for October not yet recorded" is derived from a template that has no expense row for the period.

### 2.20 `attachments` — [std] (decision D)

| Field | Type | Null | Default | Purpose |
|---|---|---|---|---|
| bucket | text | no | — | CHECK in ('rfq-files','gst-receipts'). |
| path | text | no | — | UNIQUE(bucket, path). Format `{parent_id}/{uuid}.{ext}`. |
| file_name | text | no | — | Original name. |
| mime_type | text | no | — | |
| size_bytes | integer | no | — | CHECK ≤ 5 MB. |
| rfq_id | uuid FK rfqs CASCADE | yes | — | |
| clarification_id | uuid FK clarifications SET NULL | yes | — | Requires `rfq_id`. |
| invoice_id | uuid FK invoices CASCADE | yes | — | |

CHECKs:
- `(rfq_id IS NOT NULL)::int + (invoice_id IS NOT NULL)::int = 1`
- `clarification_id IS NULL OR rfq_id IS NOT NULL`
- bucket matches parent

Storage objects are deleted by the app after a cascade (orphan sweep acceptable).

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
  - The exemption exists because of **FACT** PO 253074 A/B; see §7.
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
- `answer IS NOT NULL` iff `answered_at IS NOT NULL`.
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

---

## 5. Status design — independent dimensions, all derived unless marked HAND

| Entity | Dimension | Values | Derived from |
|---|---|---|---|
| **RFQ** | Outcome | open / won / closed | won = a non-cancelled order with this `rfq_id`. closed = `closed_on` (**HAND**, with reason). Otherwise open. A passed `due_on` never changes it. |
| | Sourcing | not floated / floated-awaiting / partly covered / covered / no offer anywhere | Inquiries (`sent_on`, `no_offer_on`) and quote lines per item. "Uncovered item" = every responder skipped it. |
| | Clarification | none / to ask (count) / waiting on customer (count, days since `last_asked_at`) / answers to relay (per supplier) | `clarifications` vs `inquiry.last_relayed_at`. |
| | Bid | to bid / bid sent (`quoted_on`) | `quoted_on`, typed or stamped by "Mark bid sent". **HAND**, one tap. |
| | Deadline risk | days to `due_on`; overdue badge | `due_on`. A sort key only. |
| **Supplier inquiry** | Contact | shortlisted / sent / chased | `sent_on`, `last_chased_on`. |
| | Response | awaiting / quoted (n of m items) / no offer | Quote lines; `no_offer_on` (**HAND**). |
| | Blocked | has open questions it raised / answers waiting to relay | Clarifications. |
| **Clarification** | single | to ask / asked / answered / withdrawn | Timestamps. Each is stamped by a copy action or **HAND** (answer, withdraw). |
| **Order** | Lifecycle | active / cancelled / done | `cancelled_on` (**HAND**). done = every other dimension terminal. |
| | Lifecycle "done" | — | For admin, every dimension must be finished. Engineers and sales see "done" computed from the dimensions they can see (goods, commissioning, invoicing for sales). The view computes this per role so that a hidden dimension never counts as finished. |
| | Goods | n/a (all service) / to source / to place / on order / late / received / partly delivered / delivered | Items without a leg; legs' `placed_on`, `expected_on`, `received_on`, `delivered_on` (the minimum across legs). |
| | Commissioning | n/a / to plan / planned / done | `needs_commissioning`, `commissioning_planned_on`, `commissioning_done_on`. |
| | Invoicing | not invoiced / part / fully invoiced | Σ invoice gross vs items gross. |
| | Payment *(admin; sales through `order_receivables()`; hidden from engineers)* | unpaid / part / settled / overdue | settled means Σ`payments_in.amount` ≥ the gross target, allowing ₨1 for rounding. The gross target is the invoiced gross if any invoice exists, otherwise the gross from the items. Overdue means the earliest invoice date plus `payment_terms_days` is before today and the order isn't settled. |
| | Costs *(admin only)* | provisional / complete | `order_costs.costs_complete_at`. Actual cost = Σ expenses tagged to the order. Expected cost = `order_costs.expected_cost_pkr`. |
| | Data trust | ok / basis unknown / estimated dates | `legacy_flags`. |
| **Invoice** | Courier (TCS) | not started / copy received / sent / delivered to client | `copy_received_on`, `tcs_sent_on`, `client_received_on`. |
| | FBR | pending / generated / receipt received / deposited | The furthest step reached:<br>• deposited if `tax_deposited_on` is set<br>• receipt received if `wasif_receipt_on` is set<br>• generated if `psid` is set, or the row carries the legacy flag `fbr_generated_legacy`<br>• otherwise pending<br>If a later step is set without an earlier one (e.g. deposited with no PSID), it shows as the later step and is reported as an exception.<br>`needsFbrAttention` becomes: `tax_deposited_on` is empty AND the invoice month is before the current month. |
| **Company** | Role | customer / supplier / both / prospect | `v_company_roles`. |
| **Expense / payment** | — | none | They are facts, so they carry no status. |

Why not something simpler: three states (dropping "generated") would hide the step where the team waits on Wasif & Co. The PSID is already typed in, so that state costs no input.

**Money clocks** — shown separately, never combined:

1. **Cash month** (`v_cash_month`, admin only).
   - Money in uses `payments_in.received_on` and shows gross received, the GST portion, and net received.
   - Money out uses `expenses.paid_on`.
   - Payments excluded from the net calculation (see the net-portion rule) still count in gross, and their net is shown as "unresolved".
2. **GST register** (`v_gst_register`, admin and sales). Uses `invoices.invoice_date`. It's the only register; everything is FBR.
3. **Whole-life order margin** (`v_order_money`, admin only).
   - Margin = net sale − Σ expenses tagged to the order, **with no adjustment**.
   - Expenses are recorded at true cost and **never include recoverable input tax** (owner, FACT). GST is outside margin on both sides.
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

---

## 6. Decisions A–I

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
- **Not in MVP:** Expense and commissioning receipts. The CHECK pattern makes adding `expense_id` a one-column migration if the owner wants it.
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
    - But it forces split orders (PO 253074 A/B), which breaks one invoice per PO and per-PO receivables.
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

### H. Quote versioning — OUT of MVP

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
| orders | orders + order_items + supplier_orders + **order_costs** | As before, except:<br>• `cost_value` → `order_costs.expected_cost_pkr` (one row per order where cost_value > 0).<br>• **PO 253074 Unit A and Unit B are merged (owner decision):**<br>&nbsp;&nbsp;– one order with `customer_po_number` 253074, `ordered_on` = the earlier date, one supplier order (XIAMEN TONGKONG)<br>&nbsp;&nbsp;– two items: "Moxa Serial-Ethernet Converter x2 — Unit A" and "… — Unit B", each qty 1 at 73,986<br>&nbsp;&nbsp;– both invoices (INV-2024-008 and -009, or their live GST-register equivalents) attached to the merged order<br>&nbsp;&nbsp;– all payments and expenses from both old orders moved to the merged order<br>&nbsp;&nbsp;– `legacy_source` holds both original rows<br>• **Sapphire batch A** (no PO) and **batch B** (PO 90222) stay as separate orders. They don't clash on PO number, so they don't need the `po_shared` flag.<br>• Any *other* PO-number clash found in the live data goes to the owner as a merge-or-flag decision. | `po_shared` is used only if such clashes exist. |
| order_engineers | order_engineers + order commissioning dates | `needs_commissioning` = true. `start_date` → `commissioning_planned_on`. Status completed → `commissioning_done_on`. | Estimated done date flagged `dates_estimated`. Drop `site_location` (→ notes). |
| gst_invoices | invoices + attachments | As before. `fbr_status` maps as follows:<br>• Pending → none of the FBR dates set<br>• 'Generated' or 'Fully Generated' → generated (`psid` as stored); if `psid` is empty, add flag `fbr_generated_legacy` so the row still shows as generated<br>• 'Receipt Received' and 'Deposited' → checked against `wasif_receipt_on` and `tax_deposited_on`<br>Any remaining disagreement is flagged `fbr_status_mismatch`. | Same as before. |
| invoices (bookkeeping) | invoices, only where the order has no gst_invoices row and no `orders.invoice_number` | `invoice_amount` treated per the order's basis rule. | `amount_paid` NOT turned into payments; flagged `paid_per_old_invoice` if payments_in disagrees. Seed rows likely exist (17). |
| payment_records | — | Dead (FACT: no page reads it). | If rows exist and are not duplicated in order_payments, import as payments_in with flag `from_payment_records`. |
| order_payments | payments_in | `payment_date` → `received_on`; `reference` kept.<br>`credited_user_id`:<br>• the order's `owner_id` when the order isn't flagged `owner_unknown` or `owner_unreliable`<br>• otherwise empty (unattributed); admin can assign it afterwards<br>**No `tax_withheld`.** | Drop `payment_method`. |
| supplier_payments | expenses | category "Supplier payment"; `order_id`; `supplier_order_id` = the single imported leg; `payee_id` = the leg's supplier. | — |
| payables, payable_payments | expenses (payments only) | `payable_payments` with no supplier_payments equivalent → expenses. | Payables themselves dropped (module out). |
| expenses | expenses | `date` text → `paid_on`. Category kept. `vendor_id` → `payee_id`. `order_id` kept. | Flag `cost_possible_double_count` on orders that have both an "Inventory/Procurement" expense and supplier_payments. Flag `invalid_date` when parsing fails. |
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
- Orders sharing (company, PO number), e.g. 253074 A/B → owner chooses: merge into one order with 2 invoices, or keep both with flag `po_shared`. *(Revision 1: decided. PO 253074 Unit A/B are merged; Sapphire batch A stays separate; see the §7 `orders` row.)*
- **Drops:** dead costing columns, `profit`, `ops_dismissed`, `order_gst_amount` (used only for basis resolution), `payment_due_date`.
- Sale ≈ cost anomalies are flagged as `margin_anomaly` (e.g. PO 2224: note says 200,000 total landing, amount 150,000; PO 13378 is a negative-margin order).

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
20. PO 253074: find the live rows (orders, invoices or GST-register rows, payments, expenses) for both units, so the merge in §7 captures every row.
21. How many rows `quarterly_targets` has and what they contain (archived only).
22. How reliable `orders.sales_person_id` is in the live data. Owners marked unreliable lead to unattributed payments, which affect past target results only.

---

## 9. Blocking questions for the owner

**Closed by the owner:**

1. Engineers work the CRM → option (a). Applied in §10.
2. Customers pay the full gross amount and withhold nothing. `tax_withheld` is dropped; settled and receivable are measured on gross; margin and targets on net.
3. Every invoice goes to FBR; there is one register and no provincial tax.
4. FBR has a single "generated" state; legacy 'Generated' and 'Fully Generated' both map to it.
5. PO 253074 Unit A/B are merged; Sapphire batch A stays separate.
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
| rfqs | SIUD | SIU | SIU | |
| rfq_items | SIUD | SIUD | SIUD | |
| supplier_inquiries | SIUD | SIU + D¹ | SIU + D¹ | ¹ Staff can delete only while `sent_on` is empty. |
| supplier_quote_lines | SIUD | SIUD | SIUD | Supplier prices are visible to engineers (owner (a)). |
| clarifications | SIUD | SIUD | SIUD | |
| orders | SIUD | SIU | SIU | No money columns are left on `orders`. Delete is also blocked once money is attached. |
| order_items | SIUD | SIUD | SIUD | Sale prices are visible to all staff. |
| supplier_orders | SIUD | SIUD | SIUD | Delete is blocked if expenses are attached (FK). |
| order_engineers | SIUD | SIUD | SIUD | |
| **order_costs** | SIUD | — | — | |
| invoices | SIUD | SIU | — | See confirmation 1 in §9. |
| payments_in | SIUD | — | — | |
| expenses | SIUD | — | — | |
| recurring_expenses | SIUD | — | — | |
| attachments (parent is an RFQ or clarification) | SIUD | SIUD | SIUD | Storage bucket `rfq-files`: same rules. |
| attachments (parent is an invoice) | SIUD | SIUD | — | Storage bucket `gst-receipts`: admin and sales, as today. |
| snoozes | own SIUD | own SIUD | own SIUD | |
| **targets** | SIUD | S own | S own | |
| audit_log | S | — | — | Append-only; written only by triggers. |
| v_company_roles, v_rfq_state, v_inquiry_state, v_order_state | S | S | S | Show net, GST and gross from items only. |
| v_invoice_state, v_gst_register | S | S | — | |
| v_order_money, v_cash_month, v_payment_net, v_target_progress | S | — | — | Explicit admin check inside each view. |
| `order_receivables()` (definer) | ✓ | ✓ | — | Returns gross due, settled, balance, due date and overdue. No cost or margin. |
| `my_target_progress()` (definer) | ✓ (own) | ✓ (own) | ✓ (own) | No parameters; always the caller and the current quarter. |
| RPCs `convert_rfq_to_order`, `create_repeat_order` | ✓ | ✓ | ✓ | Run with the caller's permissions; never write to `order_costs`. |
| RPCs `merge_companies`, `merge_brands`, `resolve_value_basis` | ✓ | — | — | |

---


### Critical Files for Implementation

- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\supabase\migrations\seed_historical_data.sql
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\src\types\database.types.ts
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\supabase\migrations\20260729_t0_step2a_users_policy.sql
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\src\lib\finance\reconciliation.ts
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\supabase\functions\create-user\index.ts
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\supabase\migrations\20260729_t0_step2b_core_crm_policies.sql
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\supabase\migrations\20260731_gst_receipt_uploads.sql
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\src\lib\gst\fbr.ts
- C:\Users\ABDULLAH SAJID\Desktop\Qtech-CRM-fresh\src\pages\DashboardPage.tsx
