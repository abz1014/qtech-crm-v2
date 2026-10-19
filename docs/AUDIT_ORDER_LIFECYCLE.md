# Order lifecycle audit (go-live review)

**Date:** 2026-10-19. **Auditor:** Opus auditor, read-only (no product code changed, no live system touched).

**Question from the owner:** "compare and check each process whether they are working properly or not and their proper testing and audit of how a order lifecycle works and is it helping us or not."

**Governing goal it is judged against** (DECISIONS 2026-10-14): reduce work and logging, while keeping the detail that helps the sales engineer and keeping proper bookkeeping.

## What was audited

The go-live state is `origin/main` at `778084b`, plus the two money branches the coordinator says merge within hours:

- `p6/m05-m10`, which brings the Month-end tab: checklist, close and reopen, six reports, CSV.
- `p6/m08-m09`, which brings four Today money rules and the payment reminder panel.

These were merged locally into a throwaway tree (`8ed4e89`, not pushed). Every claim below was read from that tree.

Sources read:
- `docs/BUILD_PLAN.md`: the FE-2 tap targets and amendments A3, A6 and A8.
- `docs/DATA_MODEL.md` and `docs/DECISIONS.md`.
- Every feature folder under `src/features/**`.
- The migrations and pgTAP tests under `supabase/**`.
- Every Playwright suite under `e2e/**`.

Nothing was run. The tests were read, not executed. CI state at the time of writing:

- The E2E run for the main merge `778084b` was still running.
- The last completed E2E run on main (2026-10-16, `c04ea32`) passed.
- The last completed run on `p6/m08-m09` (16 Oct) failed in `reports.spec.ts`. The Reports page saw a request to `expenses` that Today now makes on every page through the nav counts. A fix ("Reports e2e watches only the Reports page") was pushed at 06:12 today, and its run was in progress.

**Do not merge on assumption: check that the M08 run is green.**

How tap counts are reported:
- **"asserted"** means a Playwright test counts the taps or keys and fails if there are more.
- **"by reading"** means I counted from the code and no test enforces the number.

---

## 1. The verdict in one table

| # | Stage | Verdict vs WhatsApp + Excel | One-line reason |
|---|---|---|---|
| 1 | Enquiry arrives (WhatsApp, email, phone capture) | **Neutral, edging to helps** | One paste gives item rows. But the parser drops lines starting "Please…" or "Kindly…", Capture cannot create a new customer, and nothing arrives by itself. |
| 2 | RFQ created | **Helps** | ≤3 actions + 1 paste (asserted). The owner is set by default, the duplicate customer ref is caught, and Today nags while it is not floated. |
| 3 | Float to suppliers | **Helps** | Suppliers come pre-ticked from history with reasons. The enquiry text writes itself. Copy and "mark floated" are one tap (≤2 asserted). Sending is still a manual paste per supplier. |
| 4 | Supplier replies | **Helps** | Paste the reply and accept is ≤2 (asserted). The currency is never typed and the FX rate is captured. Risk: an unknown foreign supplier defaults to PKR. |
| 5 | Ranking | **Helps** | 0 taps, and the reasons are printed. Stale rates (8–30 days) still rank. The spread ignores freight and duty. |
| 6 | Quotation | **Helps** | ≤1 price per item + 2 taps (asserted), with a numbered and revised PDF and price-memory chips. No below-cost warning. Engineers can see selling prices here. |
| 7 | Chase (supplier, customer) | **Helps** | 1 tap copies the text and stamps the chase (asserted), and a collision line shows who else chased. There is no ready text to chase a customer for a decision after the bid. |
| 8 | Won / lost | **Helps** | Won: 2 taps and an order exists (asserted). Lost: 2 taps with a suggested reason (asserted). "Won" is not stored; it means an order exists. |
| 9 | Convert and split | **Helps** | Convert as is: 2 taps. Split: 4–5 interactions (asserted). Commissioning is OFF by default on every converted order; see risk C1. |
| 10 | Supplier PO | **Helps** | 2 taps (asserted), with the PDF and terms from the supplier's last PO. Price changes after the PO are not flagged. |
| 11 | Goods placed / delivered | **Helps if stamped, silent if not** | 1 tap each (asserted). The goods-late reminder needs an expected date, which repeat orders and manual legs never get. |
| 12 | Commissioning | **Neutral** | The engineer marks it done in 1 tap (asserted). But it is off unless someone remembers to switch it on, and nothing warns when it is planned but never done. |
| 13 | Invoice | **Helps** | 2 taps, nothing typed, with the number, net and GST pre-filled (asserted). The reminder to invoice has gaps (**being fixed**, see C3). |
| 14 | TCS / FBR | **Helps** | A whole month is 3 taps + 1 PSID paste (asserted). Each "deposited" without a receipt raises a permanent FBR-attention flag. |
| 15 | Payment in | **Helps** | Full payment: 2 taps (asserted), with the amount set to the balance. The reminder only fires if the order has payment terms; first orders from new customers usually do not. |
| 16 | Supplier payments and expenses | **Helps (strongly)** | 1 amount + Enter; five in a burst use 0 mouse (asserted). From a leg it is 2 taps. Expenses typed in the burst sheet cannot be tagged to an order, so margins look better than they are. |
| 17 | Margin and costs complete | **Neutral** | Provisional and final marks are honest. Costs can be marked complete with no expenses, and the reminder fires only for paid orders. |
| 18 | Bank tick | **Helps** | 1 tap per line or per PSID group (asserted). It does not reconcile to the statement balance. |
| 19 | Month-end close | **Helps, with one blocker for the import** | Close 2 taps, reopen 2 taps (asserted), and a real database lock. After the import, the checklist will count every legacy row as unticked forever (B3). |
| 20 | Reports | **Helps (management), not an accountant's ledger** | P&L, aging, we owe, GST/FBR and team, each 1 tap plus 1 for CSV (asserted). Cash basis, no opening balances, no cash-in-hand balance. |

**Overall:** the happy path is clearly faster than WhatsApp + Excel at every stage, and the tap targets are met and enforced by tests. The weakness is the unhappy path, in three ways:

- **Silent reminders.** Several Today reminders depend on a field a busy user will not fill (payment terms, expected date, the commissioning toggle, delivered). When the field is empty, the system says nothing, and silence reads as "all fine".
- **No way to correct mistakes.** There is no void, credit note, payment edit or invoice edit in the UI.
- **Engineers can see selling prices.** In the quotation screens, and by direct API call, which contradicts the A8 owner override.

**Go-live recommendation: go live for the RFQ and order side now. Hold the money side until improvements 1–6 in section 5 are in.** They are small or medium, and most of them close a silent gap.

---

## 2. The lifecycle, step by step

Each step has five parts:
- **Does:** what the user does.
- **Auto:** what the system does by itself.
- **Tests:** what is tested and what is not.
- **Verdict.**
- **Risks.**

### 2.1 Enquiry arrives (WhatsApp, email, phone capture)

**Does**
- *Desktop (WhatsApp Web or email):* copy the enquiry, open New RFQ, type and pick the company, paste anywhere on the page, then "Looks right: find suppliers". **≤3 actions + 1 paste, asserted** (`e2e/rfqs/intake.spec.ts:136-137`).
- *New customer inline:* ≤3 actions, asserted (`intake.spec.ts:360`). The company is saved as a prospect.
- *Android:* Share → Q-Tech → "Start a new RFQ" → pick the company → "Continue to intake", then the desktop steps. **No tap count is asserted for this path** (`e2e/capture/capture.spec.ts:339-358`).
- *Phone photo or text answer to an existing question:* Android 3 taps (`capture.spec.ts:126`), iPhone photo 3 (`:274`), iPhone text 5 (`:297`). These meet the FE-2 targets (Android ≤4, iPhone ≤6).
- Required fields: a company and one item. Everything else is optional.

**Auto**
- **Items from the paste.**
  - A paste turns into item rows, with the quantity and unit read and the brand guessed.
  - If any line has a list marker, only the marked lines are used.
  - Greetings, sign-offs and email headers are skipped.
- **Company matching:** "similar name" flags near-duplicates, and an exact duplicate (case-insensitive) is blocked.
- **Defaults:** received = today, and the owner is the person entering it. Site and contact fill in when there is only one.
- **Inbound:** there is none. No WhatsApp or email arrives by itself, by design (DECISIONS: "The app never sends email or WhatsApp"). The only way in is the Android share target; a share is held on that phone for 7 days.

**Tests**
- e2e:
  - `intake.spec.ts`: 13 tests, covering the canonical run, double tap, no suppliers, duplicate ref, inline company, similar name and float one item.
  - `capture.spec.ts`: 19 tests.
  - `capture/states.spec.ts`: 6 tests.
- Unit tests: `parseItems`, `intakeModel`, `capture/model`.
- **Not tested:**
  - pastes starting "Please" or "Kindly";
  - WhatsApp "[time] Name:" prefixes;
  - a signature block (name, phone, title) in an unmarked paste;
  - Excel rows like "Pump⇥2";
  - pasting twice;
  - capturing for a company not on file;
  - saving after coming back online;
  - the Android new-RFQ tap count.
- The real-phone test (`docs/testing/R24_DEVICE_TEST.md`) has **not been done**; its results table is blank.

**Verdict: neutral, edging to helps.** One paste beating retyping into Excel is a real gain. Three things give some of it back:
- The parser drops the most common Pakistani enquiry opening.
- Capture cannot create a new customer.
- There is no inbound channel.

**Risks**
- **E1 (bug, high impact).** `please\b|kindly\b` are in the skip list (`src/features/rfqs/lib/parseItems.ts:38`). "Please quote 2 nos ultrasonic level transmitter" gives **zero items**, and the e2e test accepts this (`capture.spec.ts:350`). The user retypes the item by hand, which is the very logging burden we are removing.
- **E2.** An unmarked paste turns signature lines (name, phone, designation) into items.
- **E3 (mis-filing).** When any candidate RFQ has an open question, Capture pre-selects "answer" with all questions ticked (`capture/model.ts:73-93`). A new enquiry shared from WhatsApp can be saved as the answer to someone else's question in one tap. Only the 10-second Undo protects against this.
- **E4.** Capture has no "new company" option (`CaptureSheet.tsx:555-566`).
  - Duplicate checks are substring plus first word, so "M/s ABC", "ABC Pvt Ltd" and "Al-Noor" vs "Al Noor" all create duplicate prospects.
  - Duplicates split customer history, price memory and the repeat-customer report.
- **E5.** A capture that is never saved lives only in that phone's storage for 7 days. The team never sees it.

### 2.2 RFQ → float to suppliers

**Does**
- "Write the enquiry", then "Copy & mark floated to N". **≤2 taps, asserted** (`intake.spec.ts:163`). The whole run, Undo included, is ≤15 (asserted, `:202`).
- Then, outside the app, open each supplier's chat or email, paste and send. The app does not count this, and it is still the biggest manual step.

**Auto**
- **Supplier suggestions** come in three groups: supplied this item before (pre-ticked), carries the brand, and shortlisted for the family. Each shows a plain reason and a track record, never a score.
- **Uncovered items** (no ticked supplier covers them) are flagged.
- **One enquiry text** goes to every supplier, in WhatsApp and email variants. It asks for price + currency, lead time, origin, stock and terms. The reply-by date is the bid due date minus 3 days, adjusted for weekends.
- **"Copy & mark floated"** saves the RFQ, its items and the inquiries in one atomic call.
  - A double tap is harmless.
  - A failed clipboard still saves the RFQ and offers "Copy again".
  - There is a 10-second Undo.
- **Today:** "Not floated" shows from the day the RFQ was received. "Chase supplier" fires after max(2 days, that supplier's median reply time + 1).

**Tests**
- e2e: intake as above; `board.spec.ts` (15 tests); `memory.spec.ts` (5).
- pgTAP: `0031_float_undo` (13 checks), `0024`, `0035` and `0036`.
- **Not tested:**
  - Undo after leaving the page or after midnight;
  - Undo when other inquiries on the RFQ were also floated today;
  - removing a recipient after saving;
  - the Today "not floated" rule end to end (unit tests only).

**Verdict: helps.** Pre-ticks from real order history plus a ready-made text is a genuine time saver over picking suppliers from memory.

**Risks**
- **F1.** Removing a supplier in the enquiry step after saving changes only the ticks on screen. `set_rfq_floated(true)` stamps **every** shortlisted inquiry as sent (`0031_float_undo.sql:103-106`). That supplier then counts as floated and is chased, and the toast count is wrong.
- **F2.** Undo works per RFQ, not per action. It also un-floats other inquiries stamped today, such as "Float item 2 to them". After midnight it silently changes nothing.
- **F3.** The email signature leaves out the user's job title and phone, although `useSignature` exists (`IntakeScreen.tsx:312, :480`).
- **F4 (skipped step).** If the user sends outside the app without tapping "mark floated", no chase reminder ever fires. Replies can only be attached to inquiries that exist.
- **F5.** The duplicate check is only (company, customer ref). It is case-sensitive and only applies when a ref is given. The same enquiry entered twice without a ref is not caught.

### 2.3 Supplier replies

**Does**
- *Typed:* one price per item, then Save. **Prices = items and 1 tap, asserted** (`e2e/rfqs/detail.spec.ts:132-133`). There is no currency picker; the test asserts the control does not exist (`:117`).
- *Pasted:* "Paste reply", then "Accept N offers". **≤2, asserted** (`:181`). Nothing is saved before Accept.
- *Can't quote:* 1 tap on a reason (`:268-279`). A regret message pasted in becomes "can't quote" by itself.
- *Clarifications:* a paste of questions plus 1 tap (`clarifications.spec.ts:111`). A photo answer is 2 taps and 0 typed (`:173-174`, target ≤3).

**Auto**
- **Currency** = the supplier's last currency, else a country map, else PKR.
- **FX rate:** captured on each line. Fresh is ≤7 days, stale 8–30, unusable >30. A missing rate never blocks the save; the line says "not compared, no rate".
- **Paste parsing** handles USD, CNY and EUR, "ex-stock" and "4–6 weeks". Ambiguous figures are flagged.

**Tests**
- e2e: `detail.spec.ts` (30 tests), `clarifications.spec.ts` (9).
- Unit tests: `replyParse`, `replySave`, `replySuggest`.
- pgTAP: 0008, 0032.
- **Not tested:**
  - changing the reply currency in the UI;
  - editing a saved price (the line keeps its old rate);
  - a foreign supplier with no country defaulting to PKR. `ranking.spec.ts:274-285` actually relies on this behaviour.

**Verdict: helps.** Turning a WhatsApp reply into stored, comparable lines in two actions is the single best feature for the sales engineer.

**Risks**
- **R1 (silent wrong currency).** A supplier with no country and no history defaults to PKR (`rfqs/lib/replyCurrency.ts:51`).
  - "USD 90" saved as PKR 90 becomes **rank 1**. It then flows into the convert pre-assignment and the PO.
  - The only hint is the grey text "PKR, no earlier reply".
- **R2.** Lead time and stock are one value per reply, not per item.

### 2.4 Ranking

**Does:** nothing. **0 taps to see it.** Opening the reasons of a row that is not first is 1 optional tap (asserted, `ranking.spec.ts:200`).

**Auto**
- Ranking is by PKR price at today's rate. Raw prices are compared when every line is in one currency.
- A 2% near-tie band, then the delivery record (proven / unproven / often late), then order history.
- The reasons are printed. Selling price and spread are NULL for engineers in `rank_item_quotes`.

**Tests**
- pgTAP 0049, named fixtures (a)–(i), 60 checks.
- e2e `ranking.spec.ts` (6 tests: sales, engineer, phone, live re-rank).
- **Not tested:**
  - a stale rate changing the order;
  - a rate older than 30 days;
  - a single foreign currency with no rate. It ranks on the raw price, but the note claims "in PKR at today's rate".

**Verdict: helps.** No tap, and it explains itself.

**Risks**
- **K1.** Stale rates (8–30 days) still rank, with only a label. A 2% band is narrower than a month of PKR movement.
- **K2.** The spread is the supplier price before freight and duty (`0049:358`), while the A8 text says "landed". A cheap China supplier can outrank a local stockist once freight is counted.
- **K3.** The delivery record counts legs of cancelled orders (`0049:466-477`).

### 2.5 Quotation

**Does**
- At most one typed price per item, or 0 if a price chip is tapped, then Issue and Share. **2 taps, asserted** (`quotation.spec.ts:161, :211`).
- Re-issue: the comment says 1 number + 2 taps, but this is **not counted** by any test.

**Auto**
- **Price chips:** "Last sold to this customer" and "Last quoted", plus a "Best reply ≈ PKR" hint.
- **Pre-filled:** GST 18%, validity from the company profile (default 30 days), contact and terms from the previous revision.
- **Number and revision:** QT-YY-NNNN, revisions R0 → R1.
- **PDF and expiry:** the PDF is stored. After `valid_until` the RFQ shows as "quotation expired", and Today says to re-confirm prices.

**Tests**
- e2e `quotation.spec.ts` (8 tests: issue, share, re-issue, expired, incomplete profile, long, partial).
- pgTAP: 0023, 0037.
- **Not tested:** the re-issue tap count; a price below the supplier cost; an engineer seeing the selling price (no test covers it, and one test does the opposite, see below).

**Verdict: helps.** A numbered PDF with memory of what this customer paid last time is a large step up from Excel.

**Risks**
- **Q1 (role leak, contradicts A8).** The Issue-quotation dialog and the quotations panel render for **every** role.
  - They show "Last sold" chips, net and gross.
  - `quotation.spec.ts:234-238` has an engineer tapping the "last sold" chip.
  - The A8 override says engineers see no selling price. `ranking.spec.ts:247` asserts that on the ranking panel only.
  - Engineers also see supplier prices, so they can work out the spread themselves.
  - **The owner must decide:** either engineers may quote (then amend A8), or the quotation screens must hide prices from them.
- **Q2.** There is no warning when the selling price is below the supplier price.
- **Q3.** Issuing writes the item prices before the issue call runs. If the call fails, the working prices have already changed.

### 2.6 Chase

**Does:** 1 tap copies the message and marks it chased, with Undo (asserted, `today.spec.ts:104`; `detail.spec.ts:356`). Bid sent is 1 tap (`detail.spec.ts:381`).

**Auto**
- Supplier chase: wait max(2 days, median + 1), and 1 day if the bid is close. It escalates to "float elsewhere" after 2 chases.
- Customer chase (clarifications): after 3 working days.
- Decision overdue: 10 working days after the bid.
- A collision line says "X chased this on …".

**Tests**
- e2e `today.spec.ts` (9 tests). It covers chase customer, goods late and payment overdue only.
- **Not tested end to end:** decision overdue, quotation expired, bid due, not floated, place PO, plan commissioning, delivered not invoiced, close month.

**Verdict: helps.** One-tap chase text plus a count replaces scrolling WhatsApp to remember who was asked.

**Risks**
- **H1.** "Decision overdue" tells the user to "chase the customer", but there is no ready-made follow-up text for a bid. Only clarification chases have a text.
- **H2.** "Mark bid sent" stops supplier chases, even when some suppliers have not replied.
- **H3.** Reminders go to the record's owner. If an owner is deactivated, their RFQs and orders reach nobody; admin does not see them (`today.spec.ts:229-233`).

### 2.7 Won / lost

**Does**
- **Won:** Mark won → Create order, **2 taps, nothing typed, asserted** (`orders.spec.ts:216, :277`).
- **Lost / close:** "Bid and close" → reason, **2 taps, asserted** (`detail.spec.ts:412`). A reason is suggested (could not source / no reply / we were late / price / other).

**Auto:** "won" is not a flag. It means a live order exists. A double submit makes one order.

**Tests:** as above. **Not tested:**
- any close reason other than "could not source";
- lost after an expired quotation;
- Mark won on a closed RFQ.

**Verdict: helps.**

**Risks**
- **W1.** "Mark won" still shows on a closed RFQ (`RfqHeaderBlock.tsx:263`). Using it causes an outcome clash.
- **W2.** If the customer said yes and nobody converted, the RFQ just sits under "decision overdue". There is no "won, not converted" prompt.
- **W3.** Cancelling the order later silently reopens the RFQ.
- **W4.** "Other" with no note leaves no trace of why the RFQ was lost. The close note is always empty from the UI.

### 2.8 Convert and split

**Does**
- **As is:** 2 taps (above).
- **Split to the next-ranked supplier:** 4 interactions, including 1 quantity (asserted, `split.spec.ts:161`).
- **Split to another supplier:** 5 (asserted, `:193`).
- **Split a line on the order page:** 4 (asserted, `:290`).
- The A8 target was "≤3 taps + 1 quantity", which these meet.

**Auto**
- Supplier per item = the rank-1 quote.
- Payment terms = the customer's last order.
- GST is copied from the RFQ item.
- The same quote line used twice is refused.

**Tests**
- e2e `orders.spec.ts` (21 tests), `split.spec.ts` (13).
- pgTAP 0050, fixtures (a)–(f).

**Verdict: helps.** Turning a won RFQ into an order with suppliers and legs in 2 taps is the clearest win of the system.

**Risks**
- **C1 (high).** **Commissioning is OFF on every converted order.** The convert dialog never sends `needs_commissioning`, and the RPC defaults it to false (`0050_split_order_item.sql:25, :147`; `orders/api.ts:271-290`). As a result:
  - "Plan commissioning" never fires.
  - The engineer's "Mark done today" button is hidden.
  - "Delivered, not invoiced" fires as soon as the goods arrive, even though the engineer has not commissioned the job.
  - Someone must remember Commissioning → Edit → toggle on every job that needs it.
- **C2.** Payment terms are optional and are only pre-filled from the customer's **previous** order. A first order from a new customer has no terms, so **payment overdue never fires for it** (see 2.13).

### 2.9 Supplier PO

**Does:** Issue PO → Issue PO. **2 taps, asserted** (`po.spec.ts:136`). It needs a price per goods line and a leg currency. Re-issue is 2 taps.

**Auto**
- Incoterm and terms come from the supplier's last PO, else the company profile.
- Line prices come from the order, then the quote, then the last PO.
- Issuing stamps "placed" and suggests the expected date.

**Tests:** e2e `po.spec.ts` (8 tests); pgTAP 0043. **Not tested:** cancelling after a PO; splitting after a PO through the dialog.

**Verdict: helps.**

**Risks**
- **P1.** "Changed since PO" compares lines and quantities only, never prices (`poChange.ts`).
- **P2.** Cancelling an order does nothing about issued POs and does not prompt "tell the supplier".
- **P3.** An engineer tapping "Mark placed" without a PO silently clears the "Place PO" reminder.

### 2.10 Goods placed / delivered

**Does:** Mark placed and Delivered today, **1 tap each, asserted** (`orders.spec.ts:317`; engineer `:444`). There is no Received step (owner decision); Delivered also fills `received_on`.

**Auto**
- The expected date = placed + the upper end of the quoted lead time.
- Goods-late chase text includes the PO reference.
- Today shows "Place PO" while a leg has no placed date, and "Goods N days late" after the expected date.

**Tests:** e2e `orders.spec.ts` legs (:284–:380). **Not tested:**
- partial delivery (one leg delivered, one open);
- goods late on a repeat order;
- delivered-not-invoiced after a split.

**Verdict: helps if stamped, silent if not.**

**Risks**
- **G1 (silent).** Goods late needs `expected_on`. Repeat and WhatsApp orders, and legs added by hand, never get one, because `create_repeat_order` does not copy the quote link (`0019`). "Ex-works, TBC" lead times give none either. For these legs, late goods are never raised.
- **G2.** If "delivered" is never stamped:
  - goods late fires forever;
  - delivered-not-invoiced never fires;
  - the order stays active forever.
- **G3.** A line with no supplier leg ("to source") triggers no rule at all. A leg with no lines still nags "Place PO".
- **G4.** Partial delivery inside a leg is not modelled. The workaround is to split the line first.

### 2.11 Commissioning

**Does:** the engineer taps "Mark done today": **1 tap, 0 typed, asserted** (`orders.spec.ts:420`). Changing the planned date is about 3 interactions; the target is ≤2 and **no test counts it**.

**Auto:** "Plan commissioning" shows on Today while it is needed and has no date.

**Verdict: neutral.** The tap is minimal, but because of C1 the feature is off unless someone switches it on.

**Risks**
- **M1.** There is no "commissioning overdue" rule. Once a planned date is set, nothing chases the job. If it is never marked done, "delivered, not invoiced" is blocked forever.

### 2.12 Invoice (reminder: **being fixed**)

**Does:** Create invoice → Create invoice. **2 taps, nothing typed, asserted** (`invoices-payments.spec.ts:105-106`). GST is 18% or exempt. The test asserts that a duplicate number is refused without losing the input.

**Auto**
- The number continues the series.
- Net and GST are what is left of the order after earlier invoices.
- The due date = invoice date + the order's payment terms.

**Tests**
- e2e `invoices-payments.spec.ts` (13 tests).
- pgTAP 0010, 0044, and 0027 (the invoice field lock).
- **Not tested:** editing or cancelling an invoice (no UI exists); credit notes (impossible, GST must be ≥ 0).

**Verdict: helps.**

**Risks**
- **C3 (being fixed: assigned by the coordinator).** "Delivered, not invoiced" needs every goods leg delivered **and** commissioning done or not needed. It does not fire for:
  - a part-invoiced order (no rule for the balance);
  - a service-only order with no commissioning;
  - an order whose engineer never marked commissioning done.
- **I1.** There is no void, credit note or invoice edit in the UI. Every mistake becomes an admin database edit. Sales can change invoice net and GST through the REST API (RLS allows it) although the UI does not offer it.
- **I2.** One typed or imported number with a different prefix redirects the number series (`0044:206-218`).
- **I3.** With mixed GST lines, editing the net does not recompute the GST.

### 2.13 TCS / FBR

**Does:** tick the month → "Sent by TCS today" → paste the PSID + Enter → "Deposited today". **3 taps + 1 key, asserted** (`invoices-payments.spec.ts:175-176`). Undo is tested.

**Auto**
- Batch stamps never overwrite an earlier date.
- The deposit amount defaults to the GST.
- Today (go-live tree): "N invoices not sent by TCS" and "FBR: N invoices need attention", for admin and sales.

**Tests:** e2e as above, plus `payment-reminder.spec.ts:169-201` for the TCS Today item; pgTAP 0020; 24 unit tests in `rulesMoney.test.ts`. **No e2e** for the FBR-attention item firing.

**Verdict: helps.** A month of FBR bookkeeping in about four actions.

**Risks**
- **T1.** The 3-tap "deposited" leaves every invoice flagged "deposit recorded without a receipt" (`0014:212`), and receipts are uploaded per invoice, not per PSID. In practice the FBR-attention item will **always** be on Today, which teaches people to ignore it. Fix: one receipt per PSID group, or stop treating a missing receipt as an exception.
- **T2.** "Not sent by TCS" only looks at the last 60 days (`rules.ts` `tcsWindowDays`). An invoice older than that drops out silently.

### 2.14 Payment in

**Does**
- Full payment: Record payment → Save. **2 taps, asserted** (`invoices-payments.spec.ts:233-234`).
- Part payment is tested (`:241`).
- Reminder (go-live tree): "Copy and mark reminded", 1 tap, with Undo (`payment-reminder.spec.ts:53-99`).

**Auto**
- Amount = the balance and date = today. Paid via defaults to bank.
- The credited salesperson = the order owner.
- Payment overdue goes to the sales owner, else to admin, with a 7-day cooldown.

**Tests**
- e2e as above; pgTAP 0015, 0018.
- **Not tested / impossible:**
  - overpayment (allowed; it is only seen in Exceptions);
  - one payment across several orders (impossible, a payment has one order);
  - editing or deleting a payment (no UI);
  - changing the credited user (no UI).

**Verdict: helps.**

**Risks**
- **Y1 (biggest silent gap).** `orders.payment_terms_days` is nullable. With no terms there is no due date, so **payment overdue never fires** (`0018:20, :98`). This covers every first order from a new customer unless someone types the terms in the convert dialog.
- **Y2.** Once an order is part-invoiced, the receivable becomes the invoiced total only. An advance for the whole order then shows as an overpayment.
- **Y3.** Withholding is not modelled, because the owner said none happens (`DATA_MODEL.md:449`). If a customer ever withholds income tax or sales tax at source, the payment arrives short, the balance never clears, and payment overdue nags forever. **Please re-confirm this with the owner before go-live.** It is common for Pakistani B2B buyers.

### 2.15 Supplier payments and expenses

**Does**
- **One expense:** amount + Enter, 0 mouse (asserted, `e2e/expenses/expenses.spec.ts:97-98`).
- **Five in a burst:** 5 amounts + 4 Enter + Ctrl+Enter, 0 mouse, one save (asserted, `:129-131`).
- **From a leg:** 2 taps, nothing typed (`:278-280`).
- **Recurring:** 1 tap (`:345-347`).
- **From an order:** only the category pre-fill is asserted, not the taps.

**Auto**
- The category is the previous row's, or the most used in the last 30 days. From a leg it is "Supplier payment". From an order it is the last category used on that order.
- Paid via follows the category.
- The input-tax field shows for Supplier payment, Freight and Clearing. Cost = amount − input tax.
- The database allows one recurring entry per template per month.
- Today (go-live tree): "N recurring expenses to record" for admin.

**Tests:** e2e `expenses.spec.ts` (17 tests, including the closed-month refusal); pgTAP 0025, 0026. **Not tested:** the input-tax totals in the GST/FBR report through the UI.

**Verdict: helps (strongly).** This is the flow the old CRM failed on, and it is now faster than typing into Excel.

**Risks**
- **X1.** The burst sheet has **no order or leg column**. A supplier payment typed there is never tagged to its order.
  - That order's margin is overstated.
  - "We owe" never sees the payment.
  - The only catch is the month-end "uncategorised" count.
- **X2.** Supplier payments are in PKR only. The FX gain or loss against the PO is invisible.
- **X3.** Recurring can only be recorded for the current month from the panel. A missed month has to be entered by hand.

### 2.16 Margin and costs complete

**Does:** "Mark costs complete" is 1 tap (not counted by a test).

**Auto**
- The expected cost is filled once from the estimate.
- The margin is marked provisional until costs are complete. An order with an unknown price basis is excluded and labelled.
- Today (go-live tree): "Costs not marked complete on N paid orders", for admin.

**Tests:** e2e `costs.spec.ts` (6 tests); `rulesMoney.test.ts`. **No e2e** for the Today item firing.

**Verdict: neutral.** The marks are honest, but the margin is only as good as the expense tagging (X1).

**Risks**
- **N1.** Costs complete has no check and no confirm. It can be set with zero expenses. Expenses tagged later silently change a "final" margin.
- **N2.** The reminder covers **paid** orders only. Unpaid orders with incomplete costs are invisible, and costs are freshest exactly then.
- **N3.** `order_costs` is not under the month lock, so a closed month's final margin can still move.

### 2.17 Bank tick

**Does:** 1 tap per line, and 1 tap per PSID group (asserted, `e2e/bank/bank.spec.ts:112-113, :140-144`). The month defaults to last month.

**Auto**
- Four running totals.
- Cash rows never appear.
- Older unticked items are listed after the month's own.

**Tests:** e2e `bank.spec.ts` (8 tests). The "closed month refused" test is **mocked** (`route.fulfill`, `:188-196`).

**Verdict: helps.**

**Risks**
- **BK1.** There is no input for the statement's opening and closing balance, so the tick proves totals, not the balance. There is only one bank account.
- **BK2.** Ticks and FBR stamps stay editable after close, by design. Sales can change `tax_bank_month`.

### 2.18 Month-end close (go-live tree)

**Does**
- Checklist → a check links to its fix in 1 tap (asserted, `e2e/month-end/month-end.spec.ts:89`).
- **Close: 2 taps** (asserted, `:214`). The dialog lists 7 warnings.
- **Reopen: 2 taps** (asserted, `:233`), with an optional note.

**Auto**
- **Seven warning checks,** none of which blocks: unticked bank items, FBR deposits unticked, uncategorised, recurring not recorded, provisional margins, FBR pending, unresolved payments.
- **Months close in order.**
- **The lock** is a database trigger on payments in, expenses and invoices.
  - It checks both the old and the new date, for admin too, with no bypass.
  - On payments and expenses, only the bank tick stays editable.
  - On invoices, only the number, date, amounts, order and company are frozen.
- **Reopening** is audited.
- **Today:** "Close {month}: n checks", admin only, days 1–10.

**Tests**
- pgTAP 0027: the lock on all three tables, stamps in a closed month, roles, reopen and re-close.
- e2e: `month-end.spec.ts` (8 tests); `expenses.spec.ts` covers the UI refusal for expenses.
- **Not tested:**
  - the UI refusal for payments and invoices;
  - reopen then re-close in e2e;
  - deliberately closing with checks still open;
  - any report on imported legacy data.

**Verdict: helps.** A real lock is something Excel never had.

**Risks**
- **B3 (blocks the import).** `bank_unticked` and `fbr_pending` count **all time** up to month end, with no start date (`0028_month_reports.sql:336-339`). The import sets every legacy row to `paid_via = bank` with `bank_month` empty (`DATA_MODEL.md` A6, "history isn't ticked"). After cutover:
  - the checklist and the Today close item will show thousands of permanent checks;
  - the checklist becomes noise.
  - Fix: count only from the go-live month, or have the import mark legacy rows as reconciled.
- **B1.** The UI decides between "Close" and "Close through" from months that have payments or expenses. The database also counts invoice months. If an earlier open month has only invoices, the user gets a generic error and no "Close through" option.
- **B4.** The Today item links to `/money`, which opens the GST register, not the checklist (`rules.ts:629`).
- **B5.** The Today item's "n" is the sum of all counts, not the number of checks (`today/api.ts:288`).
- **B6.** The item disappears after the 10th, and only the previous month is ever raised. A month left open longer is forgotten.
- **I1-lock.** Legacy invoices with no date escape the lock: closed-month checks treat a missing date as "not closed".
- **I2-drift.** A closed month's P&L can still change: net-in is recomputed from the order's **current** invoices. Changing a category's group changes it too.

### 2.19 Reports

**Does**
- Month-end reports: each 1 tap, and 2 taps with the CSV (asserted, `month-end.spec.ts:112, :116`). The tabs are P&L, Expenses by category, Aging, We owe, GST/FBR and Team.
- `/reports`: four count-only RFQ reports for admin and sales.

**Auto**
- **P&L** is on a cash basis. Money in is net of GST and costs are net of input tax. Drawings appear below the result.
- **GST/FBR** puts output GST (by invoice month) next to input tax (by payment month). The two are never netted.
- **Aging** applies payments first-in, first-out within the same order.
- **"We owe"** is an estimate from the PO total minus tagged supplier payments.
- **CSV** is formula-injection safe.

**Tests**
- pgTAP 0028 uses named fixtures (P&L, aging, payables, GST, team, checklist), checked to the paisa.
- e2e: `month-end.spec.ts`, `reports.spec.ts` (4 tests).

**Verdict: helps for managing the business; it is not an accountant's ledger.** Missing:
- opening balances, capital and loans;
- a cash-in-hand balance;
- bank-balance reconciliation;
- a balance sheet;
- supplier payables in foreign currency;
- sales-tax-return figures (no netting, input tax by payment date, no import-stage tax per GD).

Tell the accountant this explicitly.

**Risks**
- **RP1.** Expenses by category shows "paid via" from the category's **default**, not from the expense (`monthEnd/api.ts:126`).
- **RP2.** Aging ignores due dates and credit terms, and it drops overpayments.
- **RP3.** The Aging and We-owe CSV files are named by month, not by the as-of date the user picked.
- **RP4.** There is no UTF-8 BOM, so Urdu names may come out garbled in Excel. The repeat-customers CSV has no `.csv` extension.

---

## 3. Today: does every step have a safety net?

Today is what makes a minimal-logging system work: people stop logging because the app reminds them. The table shows, for each stage, whether a reminder exists and which empty field silences it.

| Stage | Today rule | Silenced when… | Effect |
|---|---|---|---|
| Not floated | not_floated | — | OK |
| Supplier not replied | chase_supplier | the user sent outside the app without "mark floated"; or "bid sent" was tapped early | Chases stop |
| Quotation not sent | bid_due | **the RFQ has no bid due date** (optional, no default) | **Nothing asks for the quotation** |
| Quotation sent, no decision | decision_overdue | — | OK, but there is no follow-up text |
| Won, not converted | (only decision_overdue) | — | Indirect |
| PO not placed | place_po | the item was never put on a leg ("to source") | **Silent** |
| Goods late | goods_late | **no expected date** (repeat orders, manual legs, "TBC") | **Silent** |
| Plan commissioning | plan_commissioning | **commissioning toggle off (the default)** | **Silent**, and the invoice reminder fires early |
| Commissioning done | — (no rule) | — | **No rule** |
| Invoice | delivered_not_invoiced | delivered never stamped; commissioning never done; part-invoiced; service-only | **Being fixed (C3)** |
| TCS | tcs_not_sent | invoice older than 60 days | Drops out silently |
| FBR deposit | fbr_attention | — (fires forever without a receipt) | Noise (T1) |
| Payment overdue | payment_overdue | **no payment terms on the order**; no invoice | **Silent** |
| Costs complete | costs_incomplete | the order is not fully paid | Late |
| Recurring | recurring_due | — | OK |
| Month close | close_month | after the 10th; months older than last month | Forgotten month |
| Owner left | all rules | the owner is deactivated | **Reaches nobody** |

The rolled-up money items (costs, FBR, TCS) are always shown as "ready" and never turn red. One snooze hides the whole batch.

**e2e coverage of Today:**
- Only chase customer, goods late and payment overdue are driven end to end in `today.spec.ts`, plus the TCS item in `payment-reminder.spec.ts`.
- The other rules are covered by unit tests only.

---

## 4. Roles, bookkeeping integrity, testing

### 4.1 Role leaks (engineers and money)

What holds, and is tested at the screen, network and database levels:
- Engineers never see the Money or Reports tabs.
- Engineers make no request to invoices, payments, expenses, costs, receivables or month-end (`orders.spec.ts:501`, `costs.spec.ts:209`, `invoices-payments.spec.ts:298`, `bank.spec.ts:204`, `month-end.spec.ts:146`, `today.spec.ts:186`, `payment-reminder.spec.ts:188`).
- Search hides invoice and PO numbers from engineers in SQL.
- Sales never see payment rows, expenses, margins or P&L.

Leaks:
1. **Selling prices in the quotation screens**, for engineers (Q1). This contradicts the A8 override. **Owner decision needed.**
2. **Through the API, not the screens.** RLS limits rows, not columns. An engineer calling the REST API directly can read:
   - `order_items.unit_price_net` and `supplier_unit_price`;
   - `rfq_items.quoted_unit_price_net`;
   - `customer_price_memory`;
   - `v_order_state` net, GST and gross;
   - the PO PDFs (with prices) in `generated-docs`.

   This is recorded in DECISIONS ("RLS still lets staff read item prices… the app does not ask"), so it is a known, accepted risk. It means engineer privacy depends on nobody opening the browser dev tools. It is acceptable for 3–5 trusted staff, but the owner should know.
3. **The engineer order page shows the customer PO number.** This contradicts the rule "no PO number for an engineer" that search enforces.
4. **Sales can change invoice amounts** through REST (the UI does not offer it).

### 4.2 Bookkeeping integrity

- **Closed months:** a strong database lock on payments, expenses and invoices, tested. Gaps:
  - invoices with no date;
  - order costs;
  - expense category groups;
  - P&L recomputed from current invoices.
- **GST:** output GST is by invoice date and input tax by payment date. They are never netted, by design; the accountant does the return.
- **Cash vs bank:**
  - Each payment and expense carries "paid via", and the bank tick lists bank items only.
  - There is **no cash-in-hand balance**. `v_cash_month` is never shown in the UI, and the P&L does not split by paid via.
- **Corrections:** there is no UI to void or edit an invoice, edit or delete a payment, or issue a credit note. With 3–5 users this will happen in the first month; decide who fixes it and how.

### 4.3 Testing and CI

- About 320 Playwright tests in 33 files (go-live tree), 52 pgTAP files, and unit tests.
- E2E runs on every push to every branch. The suites run against a fresh local Supabase, with a reset between suites.
- The repo has no branch-protection config, so it cannot be confirmed that a red E2E blocks a merge. **Turn branch protection on for main.**
- There is **no single journey test** from enquiry to payment, bank tick and close. Each spec seeds its own state through REST, so the hand-offs between stages are only tested piecewise. That is exactly where the silent gaps above live.

---

## 5. Ranked improvements

Ordered by work saved or risk removed, biggest first. **S** = small (hours), **M** = medium (a day or two), **L** = large.

1. **Make payment terms impossible to forget (S).** Default `payment_terms_days` to the company's last order, else a company default, else 30. Show it on the convert dialog. Without it, payment overdue (Y1) never fires on new customers.
2. **Ask "needs commissioning?" in the convert dialog (S).** Default it from the RFQ, or from the items' family. Fixes C1: the plan, done and invoice-timing rules all depend on it.
3. **Fix the item parser dropping "Please…" and "Kindly…" lines (S).** Only skip them when they hold no quantity and no product word. Add a test for a raw WhatsApp enquiry (E1).
4. **Scope the month-end checks to the go-live month, or mark imported rows as reconciled (S).** Without this, the checklist and Today are flooded after cutover (B3). **Must land before the import.**
5. **Decide engineer access to selling prices, then enforce it (S–M).** Either amend A8 (engineers quote), or hide the quote dialog's chips and totals from engineers and hide the customer PO on the order page (Q1, leak 3).
6. **Invoice reminder coverage (S, being fixed).** Cover part-invoiced orders, service-only orders and "commissioning planned but not done" (C3, M1).
7. **Default an expected date on every leg (S).** Repeat and manual legs: placed + the supplier's median days to delivery, else 14. Otherwise goods late is silent for exactly the WhatsApp repeat orders the owner cares about (G1).
8. **One end-to-end lifecycle journey test (M).** Enquiry paste → float → reply → quote → won → PO → delivered → invoice → TCS/FBR → payment → supplier expense → costs complete → bank tick → close, asserting the Today item that should appear at each hand-off.
9. **Add an order/leg column (or "tag to order") to the burst sheet, and flag untagged supplier payments on the order (M).** Margins and "we owe" are wrong without it (X1).
10. **One receipt per PSID group, or stop flagging a missing receipt (S).** Otherwise FBR attention is permanently on Today and gets ignored (T1).
11. **Close-month item (S).** Link it to `/money/month-end`, show the number of checks rather than the item total, and keep raising any older open month after the 10th (B4–B6).
12. **Foreign supplier currency guard (S).** If the supplier has no country and no history, ask for the currency once instead of assuming PKR (R1).
13. **Corrections path (M).** Void/credit-note an invoice (admin) and edit or delete a payment in an open month (admin), all audited. Without it, the first mistake goes to a database edit.
14. **Capture can create a new company, and stops defaulting to "answer" for multi-line enquiries (M).** E3 and E4.
15. **A "won, not converted" and "commissioning overdue" Today rule, plus a decision-follow-up chase text (M).** W2, M1, H1.
16. **Reassign the records of a deactivated owner to admin (S).** H3.
17. **Below-cost warning on the quotation, and "changed since PO" including prices (S).** Q2, P1.
18. **Stale-rate guard in ranking (S).** Treat rates older than 7 days as "not compared" for mixed-currency items, or widen the warning (K1).
19. **Accountant extras (L, post go-live).** Opening balances, a cash-in-hand balance, statement closing-balance reconciliation, UTF-8 BOM on CSV, and withholding if the owner's answer changes (Y3).

---

## 6. Untested critical paths

These are paths that matter for money or for a silent reminder, and that no test drives end to end:

1. The whole lifecycle in one journey. No such spec exists.
2. Payment overdue on an order with **no payment terms**. It silently never fires.
3. Convert → delivered → invoice reminder on an order that **needs commissioning**. Today the toggle is off by default.
4. A part-invoiced order and a service-only order reaching an invoice reminder (**being fixed**).
5. Goods late on a **repeat order** or a manual leg (no expected date).
6. A raw WhatsApp enquiry starting "Please quote…" through the parser.
7. Capture → new RFQ for a customer **not on file**, and Capture mis-filing a new enquiry as an answer.
8. Month-end checklist and close **after an import** of legacy rows.
9. The UI refusing an edit in a closed month for **payments and invoices**. Only expenses are tested, and the bank-tick refusal is mocked.
10. Close-through when an earlier open month has invoices only (B1).
11. Today items for decision overdue, quotation expired, bid due, place PO, plan commissioning, delivered not invoiced, close month, costs incomplete, FBR attention and recurring due. These are unit-tested but not driven end to end.
12. An engineer opening the quotation dialog, which currently shows selling prices.
13. Supplier reply currency defaulting to PKR for a foreign supplier with no country.
14. A stale or missing FX rate changing the ranking, and therefore the convert pre-assignment.
15. Overpayment and advance payments through the Record payment dialog, and aging with advances.
16. Cancelling an order after a PO was issued.
17. Real phones: the R24 device test is still blank.
