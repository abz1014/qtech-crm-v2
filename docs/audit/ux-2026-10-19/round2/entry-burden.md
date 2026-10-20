# Data-entry burden audit: Q-Tech CRM v2

- **Code read:** `origin/main` at 33d10e7 (2026-10-20), read-only. In-progress branches were skimmed with `git show` / `git diff`: `ux/rfqs`, `ux/orders`, `ux/money-today`, `ux/foundation`.
- **The yardstick:** the owner's goal, "reduce work and logging ... keep information detail ... help the sales engineer ... proper bookkeeping" (DECISIONS.md:6, :10). Engineers must not log every detail.
- **The targets:** FE-2 tap targets (BUILD_PLAN.md:472-500) and the A6 targets (BUILD_PLAN.md:831-844). The journeys e2e asserts them (`e2e/journeys/*.spec.ts`).
- **What the e2e counts miss:** they record mouse presses and named keys only (`e2e/journeys/support.ts:39-46`). Typing done with `fill()` is invisible to them unless a spec counts it by hand. The fixtures are also ideal: clean two-item enquiries, suppliers pre-ticked, and every price present.
- **Why this audit adds real-world counts:** the e2e counts are the happy-path minimum.

**Volumes assumed (per month):**
- RFQs and quoting:
  - 30 RFQs at 4 items each. About 22 arrive as text (email or WhatsApp) and about 8 as a PDF, Excel file or photo.
  - About 20 are floated to 3 suppliers each.
  - About 45 supplier replies: about 20 pasteable text, about 25 PDF or image.
  - 30 quotation issues, including revisions.
  - About 20 RFQs are closed or lost.
- Orders and money:
  - 6 orders, which make about 9 supplier legs and POs.
  - 10 invoices and 10 customer payments.
  - 40 expenses: 6 supplier payments, 5 recurring and about 29 small spends.
  - About 60 bank lines.
- Chases: about 77 (40 supplier, 25 customer, 8 payment, 4 goods).

**Unit times:**

| Action | Time |
|---|---|
| Tap | 2 s |
| Type-ahead pick | 6 s |
| Typed number | 6–10 s, with the time to read where it comes from |
| Short text | 12 s |
| Switch to WhatsApp or email, find the chat, paste, send | 20 s |
| Open a record | 5 s |

---

## 1. Verdict and score

**Score: 7 / 10 for "low data-entry burden".** The happy path is about a 9. Real-world input (PDFs, photos, email signatures, outbound messages) is about a 5.

**Why it is not lower:**
- **Defaults:**
  - Every date defaults to today.
  - Currency is never typed.
  - Invoice number, net and GST are pre-filled.
  - The payment amount is the balance due.
  - The PSID deposit amount is the GST amount.
  - PO prices fall back from order to quote to last PO.
  - PO terms come from the supplier's last PO.
  - Order payment terms come from the customer's last order.
  - The commissioning toggle is guessed.
  - The supplier on each order line is the rank-1 quote.
  - The expected delivery date comes from a database trigger (0067).
- **Asserted counts:**
  - Win: 2 taps.
  - Issue PO: 2 taps.
  - Invoice: 2 taps.
  - Full payment: 2 taps.
  - Placed or delivered: 1 tap each.
  - A whole TCS/FBR month: 3 taps + 1 PSID paste.
  - Burst expenses: 1 amount + Enter, and 5 spends with 0 mouse.
  - Close month: 2 taps.
- **Engineers type almost nothing.** "Delivered today", "Mark done today" and Capture photos are 1–4 taps (`e2e/journeys/engineer.spec.ts:148,164,173`).

**Why it is not higher:**
1. **Anything that arrives as a document is retyped.** Customer enquiries and supplier quotations that come as a PDF, Excel file or photo yield no text. Every item, price and lead time is typed (`IntakeScreen.tsx:190` reads `text/plain` only; there is no PDF or OCR library in `package.json`).
2. **The enquiry parser trips on real emails.** Signature blocks, "Our ref" lines and phone numbers become items, multi-line items lose their quantity, and WhatsApp "[date] Name:" prefixes stay in the text. Customer ref, due date and company are never read from the paste. The raw paste is discarded (`parseItems.ts:129-161`; `rfqs/api.ts:101-114` has no notes field).
3. **The quotation is the heaviest screen.** Each line needs a selling price (only "last sold" / "last quoted" chips; no supplier price × factor), a quoted lead time (deliberately never pre-filled, DECISIONS.md:53), and delivery and payment terms. The terms are blank on every first issue: they come only from the previous revision (`IssueQuotationDialog.tsx:167-169`).
4. **Every outbound message is copy, switch app, find the chat, paste.** That covers asks, chases, reminders, the PO and the quotation PDF on desktop. The channel preference only picks the wording (`src/lib/useChannelPreference.ts`).
5. **The sales-tax invoice document is out of scope** (DECISIONS.md:39). If it is still made in Excel or Word, every line, the customer NTN/STRN and the totals are retyped from what the CRM already holds.
6. **The bank is ticked one line at a time**, with no statement paste (DECISIONS.md:69), and there are no batch actions on the rollups (recurring, costs complete).
7. **One designed pre-fill is not wired.** The supplier-payment "still owed on the leg" amount exists in `ExpenseDialog` (doc comment at `:46-53`, test `ExpenseDialog.test.tsx:58`), but no caller passes it (`LegsPanel.tsx:349`). "We owe suppliers" has no Pay link.

---

## 2. Per-job inventory

Notation:
- **T** = a field the user types; **C** = a choice (pick or tick); **taps** include opening the dialog.
- "min" is the asserted or best case; "real" is a realistic case.
- Estimated time is per month at the volumes above.

### J1. Log an RFQ (email, WhatsApp text, photo or PDF): sales, engineers allowed

**Entry points:**
- RFQs "New RFQ" (`board/BoardPage.tsx:146`).
- The company page (pre-fills the company).
- The palette.
- Capture "Start a new RFQ", then "Continue to intake" (`capture/tiles.ts:9`, `CaptureSheet.tsx:546-563`).

| Field | Kind | Req | Pre-fill / source |
|---|---|---|---|
| Company | T search + C | **yes** | `?company=` only (`IntakeScreen.tsx:139-145`). Never guessed from the paste. |
| New company: name, city, contact | T ×1–3 | name | name = the search text (`CreateCompanyInline.tsx:18-31`) |
| Site, contact | C | no | auto when exactly one exists (`IntakeScreen.tsx:252-253`) |
| Items (description, qty, unit) | paste | ≥1 item | `parsePaste` (`parseItems.ts`). Qty 1 when none is found. |
| Brand, family per item | C | no | guessed from names already on file |
| Quotation due (bid due) | date | no | blank; often written in the email |
| Customer reference | T | no | blank; often in the email |
| Top priority | C | no | off |
| GST | — | — | 18% (`intakeModel.ts:60-71`) |

**Counts:**
- **min:** ≤3 actions + 1 paste (asserted, `e2e/rfqs/intake.spec.ts:136`).
- **real, text enquiry from a known customer:**
  - 6–10 taps: delete about 5 signature or "ref" rows that parsed as items.
  - 2–4 typed: ref, due date, a quantity fixed on a multi-line item.
  - 1 company pick.
  - About 1.5 min.
- **New customer:**
  - The company step alone is 3 actions (`intake.spec.ts:358-378`).
  - In all, about 15–20 clicks and 6–9 typed fields.
  - Over the FE-2 target, and not asserted end to end.
- **PDF, Excel or photo enquiry:**
  - The file attaches, but no text comes out of it.
  - Every item is typed: 4 descriptions + 4 quantities.
  - About 3.5 min.
- **Estimated time: about 60 min/month.**

**Re-typed facts:**
- Company and contact (both are in the signature).
- Customer ref and due date.
- The quantity of multi-line items.
- Every item of a document enquiry.

**Capture gaps:**
- Capture cannot create a new company: `onCreate` is never passed (`CaptureSheet.tsx:549-560`).
- With any open question waiting, every capture defaults to "Answer a question" (`capture/model.ts:73-80`). So a one-tap Save of a new enquiry can file it as an answer. Undo exists.
- Dropping a file on `/rfqs/new` does nothing (`CaptureProvider.tsx:171,183-198`).

### J2. Ask suppliers (float): sales or engineers

**Entry points:**
- At intake: "Write the enquiry", then "Copy & mark floated to N" (`IntakeScreen.tsx:681-683`).
- On the RFQ page: "Copy enquiry for N suppliers" (`SuppliersToAsk.tsx:111-120`).

**Fields:**
- Supplier ticks (C). Only "supplied this item before" is pre-ticked (`supplierSuggestion.ts:312`).
- An unlisted supplier (T + C), at intake only. On the RFQ page the empty state only links to Companies (`SuppliersToAsk.tsx:73-83`).
- The message is generated (`enquiryDraft.ts`).

**Counts:**
- **min:** 2 taps (asserted).
- **real:** 2–4 taps, then **N pastes outside the app** (about 20 s each).
- Estimated time: 20 × (10 s + 3 × 20 s) ≈ **23 min/month**.

**Re-typed:** supplier names when none is suggested. A hand-added supplier does not learn the brand, so it is not suggested next time.

### J3. Customer and site questions: all roles

- **Adding questions:** paste the questions (1 paste + 1 tap). They are split per line (`clarifications.ts:15-30`).
- **Asking the customer:** "Copy" (1 tap), then send outside the app.
- **Answering:** a photo answer is 2–3 taps with nothing typed. A typed answer is 2 taps + text.
- **Gap:** questions added through Capture carry no supplier (`CaptureSheet.tsx:274`), so "Copy answers for supplier" never fires for them.
- Estimated time: about 10 min/month.

### J4. Record supplier prices: sales or engineers

The parser's own header says "the engineer pastes" the reply (`replyParse.ts:3`). This screen is the one engineers may touch most.

| Field per reply | Kind | Req | Pre-fill / source |
|---|---|---|---|
| Price per item | T, or paste + Accept | ≥1 | `parseSupplierReply` on a paste (`replyParse.ts`). Reads price, currency, lead time, stock, MOQ, validity and regrets. |
| Currency | C (chips) only when unknown | yes | last reply currency, else last leg currency, else country (DECISIONS.md:177) |
| Lead time, stock | T | no | parsed from a paste |
| Can't quote | 1 tap + reason | — | one reason per inquiry (`SupplierReplies.tsx:423`) |
| FX rate | — | — | nightly auto-fetch (DECISIONS.md:48). Never blocks saving. |

**Counts:**
- **min:** paste + Accept = 2 taps; typed = 1 price per item + 1 tap (both asserted, `sales.spec.ts:223-240`).
- **real, PDF quote:** open the PDF, then 4 prices + 1 lead time + Save, about 55 s. On a phone there is no way to paste from a PDF.
- Estimated time: 20 × 25 s + 25 × 55 s ≈ **31 min/month**.

### J5. Issue a quotation: sales, engineers allowed (DECISIONS.md:176)

**Entry point:** the RFQ page "Issue quotation" (on ux/rfqs it is never disabled for want of a supplier price).

| Field | Kind | Req | Pre-fill / source |
|---|---|---|---|
| Include item | C | ≥1 | ticked when something prices it (`IssueQuotationDialog.tsx:155`) |
| Unit price, net PKR, per line | T or chip | **yes** per included line | chips "Last sold to this customer" / "Last quoted"; "Best reply ≈ PKR n each" is shown, but **never a price** |
| GST per line | C | — | 18% or the item's last rate |
| Lead time we quote, per line | T | no | **never pre-filled**; suppliers' lead times shown as a hint (DECISIONS.md:53, `:553`) |
| Addressed to | C | no | the RFQ contact, or the previous revision's |
| Valid until | date | no | `company_profile.quotation_validity_days` |
| Delivery, payment terms | T | no | **previous revision only** (`:167-169`), so blank on every first issue |
| Standard terms | T | no | company profile |

**Counts:**
- **min:** 1 price per item + Issue + Share; 3 mouse presses including the open (asserted, `sales.spec.ts:292-316`).
- **real, new item, 4 lines:**
  - 4 prices typed, each worked out from the supplier price × the landed-cost and margin factor in someone's head or on a calculator.
  - 4 lead times typed.
  - 2 terms typed.
  - Issue, Share, then send the PDF outside the app.
  - About 2.4 min.
- Estimated time: **about 72 min/month, the largest bucket.**

**Re-typed facts:**
- The supplier's lead time, retyped in another form per line.
- Payment terms typed as text here, then again as a number of days at Mark won (pre-filled there from the last order, not from this text).

### J6. Quotation sent, close or lose: sales

- **Quotation sent:** issuing marks it sent (0 extra taps). A verbal quotation is 1 tap on main, **2 taps on ux/rfqs** (More, then the item; an accepted consequence of "one green button").
- **Close or lose:** 2 taps with a suggested reason (`rfqs/lib/closeDefaults.ts`), but the RFQ must be opened first.
- **On Today:** "Decision overdue" only says "Open the RFQ" (`today/ContextPane.tsx:575`). Only the 3-chases banner offers an inline close (`:900-935`).
- Estimated time: about 4 min/month. More important is the old CRM's pile of 50 dead RFQs.

### J7. Mark won, creating the order: sales

**Fields** (`orders/ConvertDialog.tsx`):
- Supplier per line: C, pre-set to rank 1.
- Split: optional, 1 tap + 1 quantity.
- Needs commissioning: C, guessed (`:460-465`).
- Customer PO number: T, optional (`:467-472`).
- Payment terms in days: pre-filled from the customer's last order, else the default (`:474-496`).

**Counts:**
- **min:** 2 taps, nothing typed (asserted, `sales.spec.ts:381-404`).
- **real:** 2 taps + the PO number typed, about 30 s.
- There is no way to attach the customer's PO file here; that is a separate Capture.

**Direct WhatsApp order with no past order:** this has to go through New RFQ, then Issue quotation (the only path that writes `quoted_unit_price_net`), then Mark won. "Repeat a past order" (`NewOrderDialog.tsx`) needs a source order.

### J8. Issue a supplier PO: sales or admin

**Fields:**
- Price per line: pre-filled from order, quote or last PO; typed only when nothing knows it.
- Currency: locked from the leg.
- Incoterm, delivery terms, payment terms: from the supplier's last PO, else the company profile.
- Ship to: from the company profile.

**Counts:** 2 taps, nothing typed (asserted). Issuing also marks the leg placed (`IssuePoDialog.tsx:57`). Then the PDF is sent outside the app.

**Estimated time:** about 5 min/month.

### J9. Mark placed or delivered

- 1 tap each (asserted). The PO marks the leg placed. The expected date comes from the database trigger (0067).
- There is no "mark all supplier orders delivered" for a multi-leg order (rare at 9 legs a month).
- Estimated time: about 2.5 min/month.

### J10. Commissioning

- **Admin or sales:** "Edit" opens a dialog with the date, the engineer pick and Save, about 4 actions (`CommissioningPanel.tsx:164-190`).
- **Engineer:** "Mark done today" is 1 tap with nothing typed. "Change planned date" is ≤2 taps. Notes are optional.
- **On ux/money-today:** Today shows the engineer's own jobs (`job_commissioning`, `job_on_site`). Nothing extra is typed.

### J11. Create an invoice: admin or sales

- **Fields:** the order (C, when opened from the register), number (series), date (today), net and GST (from the order's lines less earlier invoices), due date. Net is editable for a part invoice (`CreateInvoiceDialog.tsx:28-31,231`).
- **Counts:** 2 taps, nothing typed (asserted, `sales.spec.ts:489-500`).
- **Outside the CRM:** the sales-tax invoice document itself (DECISIONS.md:39). If it is typed in Excel or Word, that means about 5–8 min per invoice re-entering the customer, NTN/STRN, PO number, lines, quantities, rates and GST. **Not verified:** the docs do not say how invoices are produced today.

### J12. GST register steps: TCS sent, PSID, deposited, receipt

**Per month** (`GstRegisterPage.tsx:37-45`):
- Tick the month (1).
- "Sent by TCS today" (1).
- Paste the PSID and press Enter.
- "Deposited today" (1).
- Upload the FBR receipt once per PSID group (T1, DECISIONS.md:174).
- The deposit amount defaults to GST.

**Per-invoice fields** (`InvoiceDetailDialog.tsx`): consignment number, client received, notes. All are optional.

**Counts:** ≤3 taps + 1 paste per PSID group (asserted). About 3 min/month.

### J13. Record a customer payment: admin only

- **Fields** (`RecordPaymentDialog.tsx:121-153`): amount = the balance due, date = today, paid via = bank, reference optional. Credit goes to the order owner automatically (`payments/api.ts:112`).
- **Counts:** 2 taps, nothing typed (asserted, `sales.spec.ts:513-524`). When recorded late, the date is typed.
- **One transfer that pays several orders:** one dialog per order. There is no customer-level payment.
- Estimated time: about 3.5 min/month, plus a later bank tick.

### J14. Expenses and supplier payments: admin only

**Burst sheet** (`BurstSheet.tsx`):
- Fields: amount (T), category (2–3 letters; carries over from the row above), date (today), paid via (from the category), note (T, optional), order (optional), photo (optional).
- 5 spends: 5 amounts + 6 keys with 0 mouse (asserted, `admin.spec.ts:117-119`).

**Supplier payment from a supplier order (leg):**
- Pre-filled: category (Supplier payment), payee and leg.
- The amount is typed. The "still owed" pre-fill is designed but unwired (`LegsPanel.tsx:349`).

**Input tax:** the field is collapsed and its number is typed (`InputTax.tsx`).

**Recurring:** "Record" is 1 tap per template (`RecurringPanel.tsx:102`). There is no "record all".

**Estimated time:** about 12 min/month.

### J15. Bank tick ("Match bank statement"): admin

- 1 tap per line or per PSID group (asserted). Running totals are shown. There is no statement paste (DECISIONS.md:69) and no "tick all shown".
- About 60 lines × 6–8 s ≈ **7 min/month**, plus matching by eye against the statement.

### J16. Month-end close: admin

- Read the 7 checks (`monthEnd/model.ts:62-133`).
- Each settled order needs "Mark costs complete" on its own order page. The Margins list has no action (`margins/MarginsPage.tsx:42`).
- "Use as the expected cost" is a manual tap per order (`costs/MarginPanel.tsx:273`).
- Close takes 2 taps.
- Estimated time: about 8 min/month.

### J17. Chasing customers, suppliers and payments

From Today: select the item, then "Copy message and mark chased" (1 tap, asserted, `sales.spec.ts:248-260`), then switch app, find the chat, paste, send.

| Chase | Where | Taps |
|---|---|---|
| Supplier | the Today item or the RFQ page | 1 |
| Payment reminder | Today or the reminder panel (admin and sales) | 1 |
| Goods | Today or the supplier-order row | 1 |

**Estimated time:** about 77 × 25 s ≈ **32 min/month**, about 80% of it outside the app.

**Total in-app time** at these volumes is about **4.7 h per month for the whole team (about 65 min per week)**, plus any invoice document typed outside. The largest buckets:

| Bucket | Time per month |
|---|---|
| Quotations (J5) | 72 min |
| RFQ intake (J1) | 60 min |
| Chasing (J17) | 32 min |
| Supplier prices (J4) | 31 min |
| Asking suppliers (J2) | 23 min |
| Everything else together | ≈ 60 min |

---

## 3. The same fact typed more than once

| Fact | First entry | Entered again | Times typed today | Could be |
|---|---|---|---|---|
| Customer company and contact | intake: typed search, or new company typed | — | 1 (it is in the email signature) | 0 (a chip from contact email or phone) |
| Customer ref, due date | intake, typed | — | 1 (it is in the email body) | 0 (read from the paste) |
| Items and quantities | paste; **typed for a PDF or photo** | the sales-tax invoice document, outside the CRM | 0–1 in the CRM, +1 outside | 0 |
| Supplier price | reply: paste or typed | carried to ranking, order, PO, cost estimate | 1 (typed for PDF quotes) | 0–1 |
| Supplier lead time | reply | our "lead time we quote", typed per line | 2 | 1 tap |
| Selling price | quotation, typed per line | carried to order, invoice, payment, reminder | 1 (+1 on an outside invoice) | 1 tap (a chip) |
| Payment terms | quotation text (typed, first issue) | Mark won days (pre-filled from the last order) | 1–2 | 0–1 |
| Customer PO number | Mark won or order header | the outside invoice document | 1 (+1) | 1 |
| Invoice number, amounts | pre-filled | the outside invoice document | 0 (+1) | 0 |
| PSID | 1 paste per group | — | 1 paste | 1 paste |
| Supplier payment amount | the PO total is known | typed as the PKR bank debit | 1 | confirm a pre-fill |
| Customer payment amount, date | pre-filled | date typed when recorded late | 0–1 | 0 (from a statement paste) |
| Every bank item | recorded | ticked one by one against the statement | +1 tap each | ticked by matching |

---

## 4. What engineers are asked to log

- **Nothing required beyond 1-tap stamps.** "Delivered today", "Mark done today", "Change planned date" and Capture photo or text (3–4 taps). Site notes are optional. Engineers make no money request and do no money entry.
- **But engineers may run RFQs.** Intake, ask suppliers, supplier replies and even quotations are open to them (`0007_rfqs.sql:104`; DECISIONS.md:176). There they carry the full J1/J4/J5 burden. `replyParse.ts:3` assumes the engineer pastes the replies.
- **Flag:** a misfiled Capture. The "Answer a question" default (`capture/model.ts:73-80`) can turn a WhatsApp enquiry into a wrong "answered" stamp. Undo is the only guard.
- **Flag:** stale guide. `docs/guides/ENGINEER.md` still describes the old labels (Bids/Sourcing tabs, "Procurement legs"). That is a learnability cost, not a typing cost.

---

## 5. In-progress branches: effect on entry burden

- **ux/rfqs:**
  - Intake drafts are kept on the device with a leave guard (`lib/intakeDraftStore.ts`, `useLeaveGuard.ts`). This stops lost work from being retyped.
  - One green button by state. Issue quotation is never disabled.
  - The replies panel is open while a reply is expected, so there is no tap before typing.
  - **Cost:** a verbal "Quotation sent" goes from 1 tap to 2 (accepted in its DECISIONS entry).
  - No new fields, no parser change, no Capture change.
- **ux/orders:** one primary step per order page (the next leg stamp can be the header button), a "Next step" column and plain words. `GoodsChaseDialog` remembers WhatsApp or Email. No field changes.
- **ux/money-today:** Money on 2 levels, and Margins and Exceptions inside the month-end checklist (put any batch "costs complete" there). Engineer jobs on Today, and channel preference in reminders and Today. No entry changes.
- **ux/foundation:** bigger text and controls. No entry change (more scrolling on phones, so keep defaults visible above the fold).

---

## 6. The 15 biggest reductions, ranked by weekly time saved

Saved time uses the volumes above. Risk means risk to bookkeeping accuracy. "Conflict" checks the approved UX plan (DECISIONS 2026-10-19 and 2026-10-20 entries) and other standing decisions.

| # | Change | Where (code) | Saves / week | Effort | Bookkeeping risk | Conflict |
|---|---|---|---|---|---|---|
| 1 | **Sales-tax invoice PDF from the invoice record.** Same renderer as the quotation and PO; the customer's NTN/STRN typed once per customer. Removes retyping lines, PO number and totals into Excel or Word, and the CRM and the paper invoice can no longer disagree. | new `src/features/money/invoices/pdf/*` (copy `quotations/pdf/*`), `InvoiceDetailDialog.tsx`, `CreateInvoiceDialog.tsx`; migration adding `companies.ntn/strn` | **8–13 min** (only if invoices are typed outside today; **verify first**) | M | Low. One source of numbers improves accuracy. FBR invoice fields must be checked. | **Yes, DECISIONS.md:39** and DATA_MODEL K ("sales-tax invoice PDFs stay out"). Needs owner reversal. Not the UX plan. |
| 2 | **"Open in WhatsApp / Email" with the message.** `wa.me/<contact phone>?text=` or `mailto:`, beside Copy, for ask suppliers, every chase, payment reminders, goods chase and questions. The user still presses Send. | `src/lib/useChannelPreference.ts` (+ an `openChannel` helper), `rfqs/useAskSuppliers.ts`, `SuppliersToAsk.tsx`, `IntakeParts.tsx`, `SuppliersAsked.tsx`, `ClarificationsPanel.tsx`, `today/ContextPane.tsx`, `payments/ReminderPanel.tsx`, `orders/GoodsChaseDialog.tsx`; reads `contacts.phone/email` | ≈ 6 | S–M | None | **Soft, DECISIONS.md:13 and :21** ("app never sends", "WhatsApp sending" out of scope). It does not send, but needs an owner line. Value grows as supplier contact phones get filled (they are empty in the seed). |
| 3 | **PDF text in the browser** (pdf.js, free, lazy chunk). Feeds the existing parsers: enquiry PDF to `parsePaste` at intake and Capture; supplier quote PDF to `parseSupplierReply` with a "Read a PDF" button. Nothing is saved until "Looks right" or "Accept". | new `src/lib/pdfText.ts`; `IntakeScreen.tsx:190`, `CaptureSheet.tsx`, `SupplierReplies.tsx` / `PasteReply.tsx`; `vercel.json` CSP worker-src (check) | ≈ 6 | M | None | None. Not AI, no paid API, outside the 300 KB initial budget. |
| 4 | **Quotation: lead-time and terms one-taps.** A chip per line, "Supplier says 3 weeks → quote 4–5 weeks", and "Same lead time for all lines". Delivery and payment terms pre-filled on a first issue from **this customer's last quotation**, else company-profile defaults. | `quotations/IssueQuotationDialog.tsx:167-169, :553`; `quotations/api.ts` (last quotation by company); optional `company_profile` default text | ≈ 5.5 | S | None | **Soft, DECISIONS.md:53** ("not pre-filled"). A chip is a tap, not a pre-fill; one DECISIONS line. |
| 5 | **Enquiry paste parser and header facts:** stop at the sign-off; drop phone- or email-only lines; fold "Make:/Range:/Qty:" lines into the item above; strip WhatsApp "[date] Name:" prefixes; read "Ref/Enquiry No/PR-" and "required by/closing" into ref and due date with a "From the paste" label; offer the company as a chip by matching email, domain or phone against contacts; keep the raw paste in the RFQ notes. | `rfqs/lib/parseItems.ts:129-161`; new `rfqs/lib/enquiryFacts.ts`; `IntakeScreen.tsx` (`source` labels); `rfqs/api.ts:101-114` `FloatInput` + `float_rfq` (or `appendNote` after save, as `CaptureSheet.tsx:286-288` does) | ≈ 5 | S–M | None. Keeping the raw paste improves the record. | None |
| 6 | **Selling-price chip "Best reply × your usual factor".** The factor is learnt from past orders for this brand or customer (selling ÷ supplier PKR), or set in Settings. "Apply to all lines" is one tap. The chip never auto-fills; its source is shown. | `IssueQuotationDialog.tsx` (chip row at `:493-510`); a new SQL function (admin and sales; NULL for engineers) over `order_items` / `customer_price_memory` | ≈ 5 (more if pricing is done in Excel today) | M | None to the books (a price is still confirmed) | **Partial: the A8 override and DECISIONS.md:176.** Engineers never see the spread, so engineers get no factor chip. |
| 7 | **Paste the bank statement.** Auto-match amount and date to unticked items, shown for one-tap confirm. Unmatched debits become draft burst rows (amount, date and note pre-filled; category guessed from earlier notes). Late payment dates get corrected. | `money/bank/model.ts`, `BankTickPage.tsx`, `TickPanel.tsx`; `money/expenses/BurstSheet.tsx` (accept draft rows) | ≈ 2.5 | M–L | Medium. A false match must never tick silently: always a confirm list, never changing amounts. | **Yes, DECISIONS.md:69** ("no CSV import"). Needs owner reversal. |
| 8 | **Capture fixes:** allow "Create company" (`onCreate`); pre-select "Start a new RFQ" when the text parses into items and has no question lines; ask which supplier raised captured questions; accept file drop and paste on `/rfqs/new`. | `capture/CaptureSheet.tsx:274, :549-560`; `capture/model.ts:73-80`; `rfqs/ClarificationParts.tsx` (QuestionRow tag); `app/capture/CaptureProvider.tsx:171,183-198` | ≈ 2, and **removes wrong "answered" stamps** | S | Lowers the risk | None |
| 9 | **Supplier suggestions that learn:** "Ask someone not listed" on the RFQ-page card and dialog, and one tick "they carry <brand>" when a supplier is added by hand. | `rfqs/SuppliersToAsk.tsx:73-83`, `SupplierPicker.tsx:258-277`; `company_brands` insert | ≈ 1.2 | S–M | None | None |
| 10 | **Lose or close without opening the RFQ:** inline "Lost: price / competitor / no reply / Keep waiting" on Today's "Decision overdue" (reuse the close mutation of the 3-chases banner, `ContextPane.tsx:900-935`), plus "Close all N expired quotations" on the board. | `today/ContextPane.tsx:575`, `rfqs/board/BoardPage.tsx` | ≈ 1, and keeps the pipeline from rotting (the old CRM had 50 dead RFQs) | S | None (Undo) | Low. Make them secondary buttons under "one primary button". |
| 11 | **Batch the rollups:** "Record all N due" for recurring expenses; multi-select "Mark costs complete" on the month-end Margins check; set the expected cost once from the supplier-price estimate when the order is created, instead of a tap per order. | `money/expenses/RecurringPanel.tsx:102`; `money/margins/MarginsPage.tsx` (inside the month-end checklist on ux/money-today); `money/costs/api.ts:108` `fillExpectedCost` called after convert or PO issue | ≈ 1 | S | Low. "Costs complete" is a judgement, so show the list with figures before confirm. | None (placed inside the approved checklist) |
| 12 | **Photo OCR** (tesseract.js, free, in-browser) for photo enquiries, nameplates and image quotes, fed to the same parsers. | `src/lib/ocr.ts` (new), `CaptureSheet.tsx`, `IntakeScreen.tsx`, `SupplierReplies.tsx` | ≈ 1–2 (low confidence: phone photos read poorly) | L | Low (review screen) | **Likely, DECISIONS.md:21** ("AI features" removed). Owner decision. |
| 13 | **Wire the designed supplier-payment pre-fill:** pass `amount` and `amountNote` ("still owed on <supplier order>": PO total less tagged payments; exact for PKR, a labelled estimate at today's rate for foreign currency); add "Pay" on each "We owe suppliers" row. | `orders/LegsPanel.tsx:349`; `money/monthEnd/ReportPages.tsx` (We owe), linking `/money/expenses?add=1&order=&leg=&amount=` (`ExpensesPage.tsx:14`) | ≈ 0.5 | S | **Improves** it: payee, leg and amount stay consistent | None |
| 14 | **One payment for several orders:** "Record payment" at the customer level on "Who owes us", allocated oldest first with the split shown. Writes one `payments_in` row per order. | `money/payments/ReceivablesPage.tsx`, `RecordPaymentDialog.tsx`, `payments/api.ts` | ≈ 0.4 | M | Low–medium (the allocation must be visible and editable) | None |
| 15 | **Small one-taps:** input tax "18% included" chip (amount × 18/118); Mark won's terms in days read from the quotation's payment-terms text; customer PO number read from a captured PO's text. | `money/expenses/InputTax.tsx`; `orders/ConvertDialog.tsx:474-496`; `capture/CaptureSheet.tsx` (order destination) | ≈ 0.5 | S | Low (shown as a pre-fill with its source) | None |

**Two things worth doing whatever the ranking:**
- **Count typed fields in the journeys** (`e2e/journeys/support.ts`), so FE-2 regressions in typing show up.
- **Assert the full new-customer intake** (it misses ≤3 actions today, `intake.spec.ts:358-378`).

**What 1–6 would do together:** remove most of the remaining typing in the two largest buckets, quoting and intake, and most of the app switching in chasing. That is about 30–40 min per week, roughly half of the in-app time. Items 1, 2, 7 and 12 need an owner decision because they touch standing decisions (DECISIONS.md:39, :13/:21, :69, :21). Items 3–6, 8–11 and 13–15 fit the current decisions and the approved UX plan.

---

## 7. What would make it a 10

1. **Documents in, data out:**
   - A PDF, Excel sheet or photo of an enquiry or a supplier quote becomes reviewed rows with one confirm (items 3 and 12).
   - Email intake for the repeat corporate customers (Fauji Cement, Ibrahim Fibres, Ghani Glass, Sapphire send structured enquiries). A zero-cost route: a Gmail Apps Script or Cloudflare Email Worker that posts to a Supabase Edge Function, which opens a draft RFQ. The legacy discovery called this the only way input arrives (`Qtech-CRM-fresh/docs/discovery/02_findings.md` §4).
2. **The enquiry paste reads what is written:** company, contact, ref, due date and multi-line items, with the raw text kept (item 5).
3. **Quotations propose every number:** price chip, lead-time chip, terms from this customer's last quotation (items 4 and 6), so a quotation for known items is review plus Issue.
4. **Every outbound message is one tap into the right chat** (item 2), and the sales-tax invoice comes out of the CRM (item 1).
5. **Books reconcile from the statement:** paste it, confirm the matches, accept the drafted expenses (item 7), with batch actions on every rollup (item 11).
6. **Every designed pre-fill is wired** (item 13), and **every FE-2 test counts typing**, not just taps.
