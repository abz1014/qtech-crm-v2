# Q-Tech CRM v2: how busy each screen is and how fast it can be read

Read-only audit, 2026-10-19. Scope: how much is on each screen, and how fast a busy, non-technical user can find what matters. Navigation paths and the type scale are covered by other reports.

**Evidence used**
- I looked at every PNG group in `docs/design/screens/`: today-b2, rfq-detail, ranking-split, intake-float, capture, order-detail, money, month-end, company, chase-texts, login-team-settings, quotation-pdf, po-pdf and components.
- Three screens have no mockup: the RFQ list, the Orders list and Reports. For these I used the built-app review screenshots in `docs/design/review/` (`p9-e2-fix/board-all-1440.png`, `p9-e2-fix/o04-orders-list-1440.png`, `o02-o04-o07/o04-orders-list-axe-375.png`, `p01/p01-reports-admin-1440.png`, `r01-r02/fixture-companies-list-1440.png`).
- I checked the source in `src/features/**` to confirm what really ships.
- I opened the live login page at 1366x768 in the browser and did not sign in.
- The built-in browser renders local mockup HTML without its CSS, so I measured widths from the PNGs and the Tailwind classes instead.

**What the counts and scores mean**
- **Counts** are for the populated frame. "First view" means one laptop screen, 1366x768, above the fold.
- **5-sec** means: can a new user say what the screen is for and what to do next within 5 seconds? 10 is best.
- **Scan** means how fast you can find a given fact or row. 10 is best.

---

## Per screen

### 1. Today (`today-b2-01..06`; `src/features/today/TodayScreen.tsx`, `ContextPane.tsx`, `TargetTile.tsx`)

**What the user is doing here:** working down today's list of jobs and sending the chase message for the selected one.

**What is on the screen** (today-b2-02, desktop):
- Actions: about 8 controls (4-way filter, WhatsApp/Email switch, the primary "Copy message and mark chased", Open RFQ, Snooze, Waiting toggle, target "Day 58" toggle) plus 14 clickable rows.
- Chips: 3 status chips in the pane header plus 9 due labels.
- Panels: 7 (list, target tile, 4-cell facts strip, date rail, Prepared for you, Open questions, What happened).
- Words: about 380 on the first view.

**Scores**
- 5-sec: **8**. Row titles are plain English ("Payment 12 days overdue", "Bid due today, 17:00") and each row is one job.
- Scan: **7**.
  - The right pane says the same facts three times. The chips say "Waiting on customer / Due soon / Partly covered". The cells say "Asked customer 6 days ago" and "Bid due in 4 days". The date rail says "Asked Sat 21 Nov" and "Bid due Tue 1 Dec".
  - That pushes the only job on the screen, "Copy message and mark chased", down to y≈997 in the 1440 frame. That is below the fold on a 1366x768 laptop.

**Top 3 simplifications**
1. **Remove the repeated facts so the draft and its button sit above the fold.** Keep the 4 cells; drop the chip row (`ContextPane.tsx` lines 256-259) and the date rail (`DateRail` at line 881), or fold the rail into the "Bid due" cell.
2. **On phones, move the target tile below the list.** On a phone (today-b2-06) the target tile and the 4-way filter take the first ~330 px, and the "Overdue or due today" group is not visible on the first screen at all. `TodayScreen.tsx` line 129 renders the tile above the list. Put it after the list, or shrink it to one line ("PKR 330,000 behind pace ›").
3. **Always start Waiting collapsed.** It is already dimmed, but with 5 items it opens fully (`WAITING_OPEN_MAX = 5`, line 46). That gives the user's to-do list and the system's cooldown list equal height (today-b2-02). Set the threshold to 0 and show the one-line "Waiting 5 · next nudge Mon 30 Nov".

### 2. RFQ list / board (no mockup; `review/p9-e2-fix/board-all-1440.png`; `src/features/rfqs/board/BoardPage.tsx`, `BoardParts.tsx`, `model.ts`)

**What the user is doing here:** finding an RFQ, or seeing which ones need work.

**What is on the screen**
- Actions: 13 controls above the table, in 3 toolbar rows:
  - a filter box;
  - Open/Closed;
  - Comfortable/Compact;
  - Mine/All;
  - a 5-way sourcing filter;
  - New RFQ.
- Columns: 8 (Company, Due, Items, Sourcing, Questions, Bid, Value, Owner).
- Chips: up to 3 per row, about 17 across 7 rows.
- Panels: 1.
- Words: about 180.

**Scores**
- 5-sec: **5**. Three chip columns compete, and none of them says what to do next. The Bid column reads "To bid" on 6 of 7 rows, so it carries almost no information. The filter says "Out for offers" while the chip says "Awaiting offers" (`model.ts` line 50 vs `src/lib/status.ts` line 49).
- Scan: **6**.

**Top 3 simplifications**
1. **Replace the Sourcing, Questions and Bid chip columns with one plain "Next step" column.** Examples: "Send to suppliers", "Waiting on 1 customer answer", "Send quotation". The rules already exist for Today (`src/features/today/rules.ts`). Keep the detailed chips on the RFQ page.
2. **Cut the toolbar from 3 rows to 1.** Remove the density switch (`BoardPage.tsx` lines 240-251; nobody on a 3-5 person team needs it). Put Mine/All and the state filter on one row, and move "Closed 27" to a link under the table.
3. **Use the same plain words in the filter and the chips:** "Not sent yet / Waiting for prices / All prices in / Nobody can supply". Rename "floated" everywhere a sales person reads it.

### 3. RFQ detail (`rfq-detail-01..08`; `RfqDetailScreen.tsx`, `RfqHeaderBlock.tsx`, `ItemsPanel.tsx`, `SuppliersAsked.tsx`, `ClarificationsPanel.tsx`, `AttachmentsPanel.tsx`)

**What the user is doing here:** logging supplier prices, chasing, answering questions, and issuing the quotation.

**What is on the screen** (rfq-detail-01)
- Actions: about 40+.
  - Header: 4 buttons in what ships (Issue quotation, Mark bid sent, Mark won, Bid and close ▾).
  - Items panel: Add item, 4 "Add reply", 9 row menus, Can't quote, Save reply/Cancel, and 2 "Copy enquiry text".
  - Right column: the chase switch and "Copy and mark chased", "Float to another supplier", "Copy answers", 3 "Answered with photo", "Copy questions for customer", "Copy chase text", and Add.
  - Quotations: Issue R2, Open PDF ×2, Share.
- Columns: a 6-cell header strip, a 5-column reply table per item, and a 6-column quotations table.
- Chips: about 25.
  - 6 in the header (Open, Partly covered, Waiting on customer 2, Answers to relay 1, Bid sent Thu 26 Nov, Due soon).
  - 4 item coverage chips, 2 "Lowest", 2 "not compared".
  - 6 supplier states in the right column, 3 question-group chips, and Current/Superseded.
- Panels: 6 (header strip, Items and supplier replies, Quotations, Suppliers asked, Questions for the customer, and Files, which ships but is not in the mockup).
- Words: about 1,400 on the page, about 350 on the first view.

**Scores**
- 5-sec: **3**. Six header chips give six separate states. Before a bid is sent the header has 4 buttons of equal weight and no green primary. "Mark won" appears before any quotation exists (`RfqHeaderBlock.tsx` lines 238-275).
- Scan: **4**.
  - Each reply row takes 3 lines: supplier + town/agent, price + "≈ PKR" + "USD 279.40, today's rate" or "rate from 3 days ago", and "Last price for this item: USD 412 ≈ PKR 114,700 at the time · Mar 2026 · same model".
  - At 1366 the left column is about 920 px wide (1fr next to a 340 px right column), so these lines wrap.
  - The right column is longer than the main column in rfq-detail-01 (about 1,700 px against 1,600 px), because the full 70-word chase message sits inside "Suppliers asked" in about 300 px of text width.

**Top 3 simplifications**
1. **Show 2 chips and one green button.** Chips: outcome plus the most urgent one ("Due in 4 days"). The coverage and question states already show inside their panels. The button depends on the RFQ's state:
   - no prices yet: Ask suppliers;
   - prices in: **Issue quotation**;
   - bid sent: **Mark won**.

   Move "Mark bid sent" into "Bid and close", where it already exists (lines 119-124).
2. **Cut each reply row to one line:** supplier, **PKR amount (bigger)**, lead time, stock.
   - Put the original currency, the rate and its age, and "Last price..." in a tap or hover tooltip (`ItemsPanel.tsx` reply cells around line 456).
   - Say "Lowest of the 3 with a rate. Compared in PKR at today's rates" once in the rate bar, not under every item.
3. **Make the right column a list, not a stack of work areas.** Show "Suppliers asked" as rows with a "Chase" button that opens the draft in a sheet, the same way it works on Today.
   - Collapse answered questions by default.
   - Show the Files panel only when files exist (`SuppliersAsked.tsx` line 219, `ClarificationsPanel.tsx`, `AttachmentsPanel.tsx`).

### 4. Supplier ranking / compare (`ranking-split-01..04, 12, 375`; `src/features/rfqs/ranking/RankParts.tsx`, `src/features/rfqs/lib/ranking/reasons.ts`)

**What the user is doing here:** deciding which supplier to buy each item from.

**What is on the screen** (ranking-split-01)
- Actions: about 26 (4 Add reply, 12 expand chevrons, 12 row menus, Add CNY rate).
- Columns: 8 (rank, Supplier, Price, In PKR at today's rate, Lead time, Stock, expand, menu).
- Chips: 12 rank squares, 4 "Ranked N prices", 4 "Lowest", plus "Not ranked" and the rate-age warnings.
- Panels: 1 large panel with 4 item tables, each with its own rule note.
- Words: about 1,300. An expanded supplier has 5-6 reason lines (about 60 words).

**Scores**
- 5-sec: **3**.
  - For item 1, the black "1" goes to ABC Traders at USD 1,985 while the green "Lowest" chip goes to Lahore Flow Systems at USD 1,960, ranked 2. A new user sees a contradiction.
  - The explanation (the "within 2%" rule) is a 12 px grey line repeated above each item.
- Scan: **4**.
  - The reasons are 12 px grey text on a grey block (`RankParts.tsx` line 95: `text-xs text-fg-2` on `bg-sunken`).
  - The phone layout (ranking-split-03) runs about 3,800 px for 4 items.

**Top 3 simplifications**
1. **Replace the rank squares plus the "Lowest" chip with one "Recommended" mark.** When it is not the cheapest, add one line on that row: "1.3% dearer, on time 4 of 4". The order of the rows already shows rank 2..n (`RankBadge` in `RankParts.tsx`).
2. **Start every row collapsed and cap the reasons at 3 lines.** Show only rank 1's one-line reason.
   - The order-evidence line ("Ordered Endress+Hauser Proline Promag 300 ×1 for ORD-0027, placed 3 Feb 2026, delivered after 9 days (expected 10)") belongs in the Memory card (`reasons.ts` full set).
   - "Spread ≈ PKR 59,400 each, PKR 118,800 for 2, against our quoted PKR 612,000. Supplier price only, before freight and duty." should become an admin-only "Margin each" number column.
3. **Show the rule once.** "Ranked by price in PKR at today's rate. Lines within 2% of the best are ordered by delivery record, then by order history" should be a "How is this ordered?" tooltip in the panel header, not repeated per item (`RankNoteBar`).

### 5. New-RFQ intake and float (`intake-float-01..07`, `ranking-split-10`; `src/features/rfqs/IntakeScreen.tsx`, `IntakeParts.tsx`)

**What the user is doing here:** pasting a customer's request, checking the items, picking suppliers, and copying the enquiry.

**What is on the screen**
- Actions:
  - Step 1: one field plus the paste zone.
  - Step 3: Change, Add item, Bid due, Customer ref, and the primary "Looks right: find suppliers".
  - Step 4: 6 checkboxes, 6 "Memory" toggles, Back, and the primary "Write the enquiry".
  - Step 5: 3 removable recipients, WhatsApp/Email, the primary "Copy & mark floated to 3", and Back.
- Columns: 5 in the items table (#, Qty, Description, Brand, Family).
- Chips: up to about 8 at step 4.
- Panels: 3 (the main column, a "This RFQ" box and a "Progress" box beside it).
- Words: about 70 at step 1, 200 at step 3, 350 at step 4.

**Scores**
- 5-sec: **8** at step 1 (the cursor is already in the company field) and **6** at step 4.
- Scan: **7**.

**Top 3 simplifications**
1. **Replace the side boxes "This RFQ" and "Progress" with a one-line step strip at the top.** The boxes repeat the page (Customer, Items, Bid due) and use about 290 px at 1366 (`IntakeParts.tsx` lines 52-70; shown at `lg` and above).
2. **Fix the supplier reason tags** "2 same model", "3 same item", "1 same brand". The number is the item number but reads as a count; write "Item 2: same model".
3. **Show 2 lines per supplier at step 4, not 3.** Keep the reason ("Supplied this item before") and one stats line, and move the order evidence into Memory.
   - Drop the "Family" column from step 3 unless it was guessed wrong.
   - Rename the button "Copy & mark floated to 3" to "Copy enquiry for 3 suppliers".

### 6. Capture (`capture-01..07`; `src/features/capture/CaptureSheet.tsx`, `CaptureParts.tsx`, `tiles.ts`)

**What the user is doing here:** filing a WhatsApp message or photo against an RFQ.

**What is on the screen**
- Actions: 4 option cards, 3 RFQ radios, "Search all RFQs", the question ticks, the primary Save, and Close.
- Chips: 0-1.
- Panels: 3 sections.
- Words: about 150 on a phone screen.

**Scores**
- 5-sec: **8**. The best guess is already selected, and the usual case is 3 taps with nothing typed.
- Scan: **7**.

**Top 3 simplifications**
1. **Show only the chosen option and hide the other three behind "Something else ▾".** With the guess pre-selected, the sheet then reads: what you captured → "Answer 2 questions on RFQ-0177, Indus Textile Mills" → Save. Each card's description is about 11 px grey (`tiles.ts`).
2. **Stop the sticky Save button covering the confirmation sentence.** In capture-01 frame 3 and capture-02 frame 4, the line "Answers 2 open questions on RFQ-0177: line size and flange rating, fluid temperature... Untick any that this..." is cut off behind the button. Move it above the RFQ list, or rely on the button label, which already says "Save answer to 2 questions".
3. **Rename "New supplier questions" to "Questions from a supplier".** As written it reads as "new suppliers".

### 7. Orders list (no mockup; `review/p9-e2-fix/o04-orders-list-1440.png`, `o04-orders-list-axe-375.png`; `src/features/orders/OrdersListPage.tsx`)

**What the user is doing here:** finding an order and spotting orders that need action.

**What is on the screen**
- Actions: 12 controls (3 tabs, Mine/All, 4 dropdown filters, search, density ×2, New order).
- Columns: 9 (Order, Customer, Goods, Commissioning, Invoicing, Payment, Gross, Owner, Ordered).
- Chips: 4 per row in 4 colours, including "n/a" chips.
- Words: about 120 with 3 rows.

**Scores**
- 5-sec: **5**. Nothing says what to do next. The user has to combine 4 chips per row (for example "To place · Planned · Not invoiced · Unpaid").
- Scan: **5**.
- On a 375 px phone, the 6 filter controls fill about 200 px before the first order.

**Top 3 simplifications**
1. **Replace the 4 status columns (lines 151-156) with one "Next step" column** ("Place PO with Dubai Instrumentation", "Invoice", "Chase payment, 12 days late"). Add an exception chip only when something is late.
2. **Replace the 4 dropdowns (lines 269-272) with one 3-way switch: Needs action / Waiting / All.** Put the per-status dropdowns behind a "Filters" button, collapsed on phones.
3. **Show a dash instead of "n/a" chips** (the status registry `n/a`, `src/lib/status.ts` lines 84 and 94), and drop the density switch.

### 8. Order detail (`order-detail-01..07`, `ranking-split-08/09`; `OrderHeaderBlock.tsx`, `OrderItemsPanel.tsx`, `LegsPanel.tsx`, `MoneyPanels.tsx`, `money/costs/MarginPanel.tsx`, `CommissioningPanel.tsx`)

**What the user is doing here:** pushing the order forward: placing the PO, marking goods received or delivered, invoicing, getting paid.

**What is on the screen** (admin, order-detail-01 plus what ships)
- Actions: about 45 interactive controls.
  - Header: Record payment, Add expense, Create invoice, and a "…" menu.
  - Items table, per row in what ships: a GST select, a Service checkbox and "Split line", ×8 rows. Plus Add line.
  - Each of the 3 supplier orders (called "legs"): Add expense, a next-step stamp, View PO or Issue PO, and Chase. Plus Add leg.
  - Margin: Edit, Mark costs complete, Add expense.
  - Invoices and payments: Record payment.
- Columns in the items table: 10 in the mockup. What ships for admin has 11 plus a buttons column (`OrderItemsPanel.tsx` lines 180-331).
- Chips: about 17 (Active, 5 status chips, 3 per supplier order × 3, Provisional, Planned).
- Panels: 7 (status strip, Items, Procurement legs, Commissioning, Margin, Invoices and payments, Files).
- Words: about 900 on the page, about 300 on the first view.

**Scores**
- 5-sec: **4**. There is no single main action. The admin header has 3 equal grey buttons, while the supplier orders show 3 green ones at once ("Delivered today", "Issue PO", "Received today").
- Scan: **4**.
  - **Cramped at 1366:** the fixed column widths add up to about 1,190 px of about 1,290 px available. The Item description, the most important column, gets about 100 px or the table scrolls sideways.
  - The status strip has about 15 words of prose per cell (about 75 words), which repeats the "Invoices and payments" panel.

**Top 3 simplifications**
1. **Default the items table to 5 columns:** Item, Qty, Line gross (PKR), Supplier price, Leg.
   - Put unit net, line GST, the GST select, the Service tick and "Split line" in a row "…" menu or behind a "Show tax columns" toggle.
   - The engineer view already does this: `columns = money ? [...] : [...base, ...tail]`, line 331. Keep that.
2. **One place for each action.**
   - "Add expense" appears 5 times (header, each of the 3 supplier orders, Margin), and "Record payment" twice (header and the Invoices panel).
   - Keep Add expense on the supplier orders, and keep Record payment in the header only.
   - Fold "Invoices and payments" into the Payment cell of the status strip (`OrderHeaderBlock.tsx` lines 197-207; `MoneyPanels.tsx`).
3. **One green button per page**, on the most urgent supplier order. The rest become secondary buttons.
   - Shrink each supplier order's 4-step date track ("Placed / Expected / Received / Delivered" plus "suggested from lead time 2 wks") to one line: "Placed 6 Nov · expected 20 Nov · received 19 Nov" (`LegsPanel.tsx` lines 270-340).

### 9a. Companies list (`review/r01-r02/fixture-companies-list-1440.png`; `src/features/companies/CompaniesPage.tsx`)

**What the user is doing here:** finding a company.

**What is on the screen**
- Actions: search, a 4-way filter, New company.
- Columns: 4.
- Chips: 1 per row.
- Words: about 90.

**Scores**
- 5-sec: **9**.
- Scan: **8**.

**Top 3 simplifications**
1. **Tone down the dark "Both" chip.** It is the heaviest mark on the page for the least useful fact.
2. **Show the city instead of "Pakistan"** on every row.
3. **Add a "Last activity" or "Open RFQs" column**, so the list says who is active.

### 9b. Company page (`company-01..04`; `src/features/companies/CompanyPage.tsx`, `SupplierRecordPanels.tsx`, `SitesPanel.tsx`, `BrandsPanel.tsx`)

**What the user is doing here:** checking a supplier's track record, or a customer's sites and history.

**What is on the screen** (supplier, company-01)
- Actions: about 10 (Float an RFQ here as primary, Edit, …, Add contact, All enquiries, links).
- Columns: 7 in Recent quotes and 5 in Deliveries.
- Chips: about 20 (8 outcomes, 4 deliveries, PO and Imported tags, the role chip) plus 2 rows of tick squares.
- Panels: 5 in the mockup, up to 8 in what ships. The side column adds Brands, Roles, "Money with them" and Notes (`CompanyPage.tsx` lines 241-276).
- Words: about 650.

**Scores**
- Supplier page: 5-sec **6**, Scan **6**.
- Customer page (company-04): 5-sec **8**. The sites grouping and the "Repeat order" button are clear.

**Top 3 simplifications**
1. **Drop the rows of tick squares (☑☑☑☑⊟⬚ and the delivery squares).** They need a legend that repeats the counts anyway. Keep "Replied 5 of 6 · quoted 4 · late 1 of 4" (`SupplierRecordPanels.tsx`).
2. **Turn the "Where this comes from…" footnote** (about 45 words on every supplier) and "Includes imported history" into an (i) tooltip.
3. **Trim the side column.**
   - The Roles panel repeats the header chip; drop it.
   - The Brands panel repeats "Brands" inside "What we know"; merge them.
   - Keep the column to Contacts, Open with them, and Money (admin only).

### 10a. Money: Receivables / "Order balances" (`money-06`, `money-10`, `money-12`; `src/features/money/payments/ReceivablesPage.tsx`, `ReminderPanel.tsx`, `src/features/money/MoneyScreen.tsx`)

**What the user is doing here:** seeing who owes money and sending the reminder.

**What is on the screen**
- Actions: about 12 (6 Money tabs, Open/Overdue/Settled, the rows, WhatsApp/Email, and the primary "Copy and mark reminded").
- Columns: 7.
- Chips: 1 per row.
- Panels: 3 (4 summary tiles, the table, the reminder pane).
- Words: about 400, of which the reminder is about 120.

**Scores**
- 5-sec: **7**. Overdue is in red and there is one green button.
- Scan: **7**.

**Top 3 simplifications**
1. **Open Money on this page.** `MoneyScreen.tsx` line 23 sends everyone to the GST register, which is the page sales users need least.
2. **Use one name.** It is "Receivables" for admin and "Order balances" for sales (`moneyTabs.ts` line 13). Call it "Who owes us" for both.
3. **Show Balance only on desktop**, with Gross due and Settled on hover, as the tablet layout already does (money-12).
   - Remove the 35-word rule footnote ("A reminder becomes due when…", line 250).

### 10b. Money: GST register (`money-01`, `02`, `11`; `src/features/money/invoices/GstRegisterPage.tsx`, `src/ui/StatusTrack.tsx`)

**What the user is doing here:** the admin stamps courier delivery and FBR deposits; sales look up an invoice.

**What is on the screen**
- Actions: Needs attention, search, Export, the primary "New invoice", and the rows. In month stamping: checkboxes, "Sent by TCS today", "Paste PSID once", "Add PSID", "Deposited today".
- Columns: 8 plus an alert column.
- Status marks: each row has 2 chips, each next to a 3-segment mini progress bar, so 4 status marks per row and 36 on 9 rows.
- Words: about 300.

**Scores**
- 5-sec: **6** for admin, **4** for sales.
- Scan: **5**.

**Top 3 simplifications**
1. **Show either the mini progress bar or the chip, not both.** `StatusTrack.tsx` line 32 renders a `StatusBadge` next to the bar.
2. **Use plain labels.** "Courier (TCS)" can be read as the tax term TCS, and "PSID", "Generated", "Receipt received" and "Copy received" mean nothing to a new user. Write "Sent to customer by courier" and "Tax deposited (PSID)", with the stages in a tooltip.
3. **Give sales a lighter view.** Sales do not stamp, so hide the TCS and FBR columns for them or show "My invoices" (invoice, customer, gross, paid?).
   - The tab count "9" is the total number of invoices, not the to-dos. Show the "Needs attention 3" count instead.

### 10c. Money: Expenses and burst entry (`month-end-13/14/15`; `src/features/money/expenses/ExpensesTab.tsx`, `BurstSheet.tsx`)

**What the user is doing here:** entering the day's small spends quickly.

**What is on the screen**
- Burst sheet: 7 cells per row (amount, category, date, paid via, note, photo, delete) and a 4-key legend.
- Words: about 200.

**Scores**
- 5-sec: **7**.
- Scan: **7**. Five expenses take 5 amounts and 5 keys.

**Top 3 simplifications**
1. **Remove the small grey labels inside the cells** ("most used / carried / today / from category"). That is 4 per row, 20 on a 5-row sheet; the dashed border already means "filled in for you".
2. **Hide the "Date" and "Paid via" cells until the user tabs into them.** They are almost always the default.
3. **Drop the header legend** ("Filled in for you / You typed this / Keyboard only: no mouse needed") for non-technical users.

### 10d. Money: Margins (`money-08`; `src/features/money/margins/MarginsPage.tsx`)

**What the user is doing here:** the admin sees how much was made per order.

**What is on the screen**
- Columns: 6.
- Chips: 1 per row.
- Words: about 160.

**Scores**
- 5-sec: **7**.
- Scan: **7**.

**Top 3 simplifications**
1. **Put Margin next to the customer, in a larger figure.** Today it is the 5th column.
2. **Merge "Expected cost" and "Actual cost so far" into one Cost column**, with the provisional mark.
3. **Say which orders the total covers.** The total row ("Costs complete · 2 orders") adds up 2 of the 6 visible rows; write "Total of 2 completed orders" in the row itself instead of the 40-word note below.

### 11. Month-end (`month-end-01..20`; `src/features/money/monthEnd/ChecklistPage.tsx`, `MonthEndNav.tsx`, `ReportPages.tsx`, `MoneyFrame.tsx`)

**What the user is doing here:** the admin checks the month and closes it.

**What is on the screen** (month-end-02)
- Actions: about 38.
  - 14 tabs in two rows: 6 Money tabs plus 8 Month-end tabs.
  - The month stepper and the primary "Close October".
  - 7 card links.
  - The Reports panel with 6 × (Open + Export CSV), so 12 buttons.
  - 3 "Reopen" buttons.
- Chips: 7 "Review"/"Clear" chips plus a 7-segment progress bar.
- Panels: 11.
- Words: about 600.

**Scores**
- 5-sec: **5**.
- Scan: **6**.
  - The two tab rows are 12 px grey text on a grey strip (`MoneyFrame.tsx` lines 54-61, `MonthEndNav.tsx` line 40, `text-xs`, 26 px tall).
  - P&L and Team figures carry paisa ("3,477,372.88").

**Top 3 simplifications**
1. **Use the phone layout on desktop as well.** The phone version (month-end-15) shows one row per check. List only the checks that have items, with "2 checks clear" as a single line.
2. **Remove two repeated panels.** The "Reports for October" panel repeats the 6 report tabs directly above it. The "What closing does" card repeats the confirmation dialog (month-end-03).
3. **Put all reports in one place.** Move the 6 month reports under the top-level "Reports" item (now a different set of RFQ reports), which removes the second tab row. Show whole rupees on screen; keep decimals in the CSV.
   - The Team report's target bars are almost invisible, grey on grey (month-end-11).

### 12. Reports (no mockup; `review/p01/p01-reports-admin-1440.png`; `src/features/reports/ReportsScreen.tsx`)

**What the user is doing here:** the owner sees how enquiries turn into orders.

**What is on the screen**
- Actions: sortable headers and 1 Export.
- Tables: 4, with 3, 7, 7 and 6 columns.
- Tiles: 16 summary tiles.
- Panels: 8 blocks.
- Words: about 250 on the first view, about 700 in total.

**Scores**
- 5-sec: **5**. Labels are jargon ("Float coverage and conversion", "Won when not floated", "Won of answered"). With little data, tiles show "n/a" and "0%".
- Scan: **6**. There is no period picker.

**Top 3 simplifications**
1. **Lead with 3 numbers** (won this quarter, win rate, top customers). Collapse the other sections under their headings.
2. **Rewrite the labels as plain questions** ("Did sending to more suppliers help us win?").
3. **Hide empty tiles** behind one "Not enough data yet" line, add a month/quarter picker, and merge with the Month-end reports (see 11).

### 13. Settings / Team (`login-team-settings-02..09`; `src/features/settings/TeamPage.tsx`, `SettingsLayout.tsx`, `CompanyProfilePage.tsx`)

**What the user is doing here:** the admin manages people, the company details and the rates.

**What is on the screen** (Team)
- Actions: Add person (primary), search, a 3-way filter, a 4-item menu per row, Reactivate.
- Columns: 4.
- Chips: 1 per row.
- Words: about 150.
- Settings navigation ships with 7 entries for admin (`SettingsLayout.tsx` lines 26-32); the mockup has 3.

**Scores**
- 5-sec: **8**.
- Scan: **8**.

**Top 3 simplifications**
1. **Show a chip only for "Deactivated"**, not "Active" on every row (`TeamPage.tsx` line 120).
2. **Split the 7 settings entries into two short groups:** "Company" (profile, targets, expense categories, exchange rates) and "You" (your details, password).
3. **Company profile** (login-team-settings-08): keep the two required fields at the top and collapse "Bank details" and "Tax registration" until opened. The "View only" tag wraps in the 220 px navigation (login-team-settings-09).

### 14. Login (`login-team-settings-01`; live `https://qtech-crm-v2.vercel.app/login` at 1366x768; `src/app/pages/SignInPage.tsx`)

**What the user is doing here:** signing in.

**What is on the screen**
- Actions: 2 fields, 1 eye toggle, 1 primary button.
- Words: about 22.

**Scores**
- 5-sec: **10**.
- Scan: **9**.

**Simplifications (none needed)**
1. Keep it as it is.
2. The logo's small tagline ("Automation Field Instruments & Electrical Power Quality") cannot be read at 44 px; use the logo without the tagline.
3. Phone: fine as drawn.

### 15. Quotation PDF (`quotation-pdf-01/02`, `po-pdf-01`; `src/features/quotations/pdf/QuotationDocument.tsx`, `src/features/purchaseOrders/pdf/PurchaseOrderDocument.tsx`)

**What the customer is doing here:** reading the price, the delivery terms and the validity.

**What is on the page**
- Columns: 8 (#, Description, Qty, Unit, Unit price PKR net, GST, Line net PKR, Lead time).
- Words: about 380 on 1 page.

**Scores**
- 5-sec: **8**.
- Scan: **8**. Clean, with the amount in words and the totals block set apart.

**Top 3 simplifications**
1. **Merge Qty and Unit** ("2 pcs"). That frees width for Lead time, which wraps ("8 to 10 weeks / from PO").
2. **Spell out the revision.** "Revision R2" plus "Supersedes QT-26-0042 R1 of 26 Nov 2026" uses internal codes; write "Revised quotation (2nd revision), replaces the one of 26 Nov".
3. **Pages 2-3 are already slim. Keep that.**

---

## Overall

### The 10 changes with the most impact, ranked

| # | Change | Where | Effort |
|---|---|---|---|
| 1 | **One green button per screen, chosen by state.**<br>RFQ: Ask suppliers → Issue quotation → Mark won.<br>Order: the most urgent supplier-order stamp.<br>Today: Copy and mark chased, above the fold. | `RfqHeaderBlock.tsx` 238-281, `OrderHeaderBlock.tsx` 194-240, `LegsPanel.tsx` 290-340, `ContextPane.tsx` 392-399 | S-M |
| 2 | **Order items table down to 5 columns.** Tax, GST select, Service and Split go behind a row menu or toggle. Fixes the item column squeezed to about 100 px at 1366. | `OrderItemsPanel.tsx` 180-331 | M |
| 3 | **"Next step" column instead of 3-4 status columns** on the RFQ and Orders lists. Reuse the Today rules. | `BoardPage.tsx` 120-134, `OrdersListPage.tsx` 149-163, `today/rules.ts` | M |
| 4 | **RFQ detail: 6 header chips down to 2. Reply rows down to 1 line,** with currency, rate and last price on tap. Footnotes said once. | `RfqHeaderBlock.tsx` 219-235, `ItemsPanel.tsx` | M |
| 5 | **Ranking: one "Recommended" mark, every row collapsed, the rule in one tooltip.** Removes the "1" versus "Lowest" contradiction. | `RankParts.tsx`, `reasons.ts` | S |
| 6 | **Remove repeated entry points and panels.**<br>Add expense ×5 → 1 place; Record payment ×2 → 1; Invoices panel goes into the status strip.<br>Company Roles and Brands panels; the Month-end "Reports for…" panel and "What closing does".<br>Today's chips and date rail. | `OrderHeaderBlock.tsx`, `MoneyPanels.tsx`, `CompanyPage.tsx` 241-276, `ChecklistPage.tsx` 302-307 and 447, `ContextPane.tsx` 256-259 | S |
| 7 | **Money opens on "Who owes us".** One name for admin and sales; GST register shows the bar or the chip, not both; sales get a simpler invoice list. | `MoneyScreen.tsx` 23, `moneyTabs.ts` 13, `StatusTrack.tsx` 32, `GstRegisterPage.tsx` 137-138 | S |
| 8 | **Month-end and Reports:** list only the checks with items; one Reports area instead of 8 sub-tabs plus a separate top-level Reports page; whole rupees on screen. | `ChecklistPage.tsx`, `MonthEndNav.tsx`, `ReportsScreen.tsx`, `ReportPages.tsx` | M |
| 9 | **Explanatory footnotes become (i) tooltips** (rule explanations shipped as UI text). For example:<br>Receivables 250 ("A reminder becomes due…").<br>GST register footer ("Every invoice goes to FBR, so this is the one register…").<br>Cash month ("This will not match the GST register, and it should not…").<br>Company "Where this comes from".<br>Margins note.<br>`RankNoteBar`. | many | M |
| 10 | **Plain words and fewer useless marks.** Floated / Out for offers / Awaiting offers become "Sent to suppliers / Waiting for prices"; Issue R2 → "Revise quotation"; leg A/B/C → "Supplier order"; PSID and TCS get a plain label.<br>Drop the "n/a" and "Active" chips and the density switches (RFQ list, Orders list). | `src/lib/status.ts` (85 values in 31 groups), `board/model.ts` 47-53, `BoardPage.tsx` 240-251, `OrdersListPage.tsx` | S |

### Patterns that repeat across the app

1. **Too many status chips.**
   - The status list has grown from the 59 values in 16 groups on the components sheet (components-02) to **85 values in 31 groups** in `src/lib/status.ts`.
   - Screens carry 4-6 chips per header (RFQ 6, Order 1+5) and 3-4 chip columns per list row.
   - "Open" and "Active" each mean different things in different places (RFQ, month and order; order and user).
   - Neutral, info and success chips differ mainly by colour and a 12 px icon (circle, circle with dot, circle with tick), so in a long column they blur together.
2. **Small grey text on grey backgrounds.** 12 px secondary text on the light grey panel or row backgrounds:
   - the ranking reasons (`RankParts.tsx` line 95);
   - the Waiting group (`TodayScreen.tsx` line 179);
   - the Money and Month-end tab strips (`MoneyFrame.tsx` line 54, `MonthEndNav.tsx` line 40);
   - every panel's sub-line and footnote;
   - the target bars in month-end-11, which are almost invisible.

   The contrast passes the accessibility minimum, but these lines carry facts users need, yet look like decoration.
3. **Two-column layouts are cramped at 1366.** RFQ detail, Order detail and the Company page all use a fixed 340 px side column; Intake has a 290 px one, and Receivables a 410 px reminder pane.
   - RFQ detail's side column holds a 70-word chase message about 40 characters wide and ends up longer than the main column.
   - The order items table's fixed widths leave about 100 px for the item name.
4. **Each screen says the same fact several times.**
   - Today: chips, cells and date rail.
   - RFQ: header chips, item coverage chips and the side-column states.
   - Order: the status strip prose and the Invoices panel.
   - Money: the 4 summary tiles repeat the table totals.
5. **Explanations of the design are shipped as UI text.** Nearly every panel has a sub-line plus a footnote explaining the rule behind it. These are useful in the design docs but tiring to read every day.
6. **No single main action.**
   - The RFQ header has 4 equal grey buttons before a bid is sent, and the Order admin header has 3 equal grey ones.
   - Meanwhile one order page can show 3-4 green buttons on its supplier orders.
7. **Tab counts mean different things.** Today 9 = need you; RFQs 14 = open; GST register 9 = all invoices; Receivables 6 = open orders; Month-end 5 = checks with items; Bank tick 7 = not ticked. A count does not reliably mean "to do".
8. **Internal codes before names.**
   - Page titles lead with mono codes ("RFQ-0177 Indus Textile Mills").
   - Rows lead with RFQ-, ORD-, INV-, PO- codes.
   - Supplier orders are called "leg A/B/C", and quotation revisions "R1/R2".
9. **Long phone pages.** Ranking on a phone is about 3,800 px for 4 items. On a phone, the Orders list shows 6 filter controls before the first order, and Today shows the target tile before the list.

### What is already good and should stay

- **Today's list:** plain-English job titles, one row per job, the due label on the right, Waiting dimmed and kept out of the count, an empty list shown as a done state ("Nothing needs you today").
- **Messages are written for the user.** One tap copies and records the chase, with a 10-second Undo: Today chases, supplier chases (chase-texts-02), payment reminders (money-06) and the intake enquiry.
- **Capture:** the best guess is pre-selected, 3 taps on Android with nothing typed, and the shared item is kept even if the session ends (capture-05).
- **Intake step 1:** one field with the cursor in it, and one paste splits the items with brand and quantity found.
- **Dialogs with 2 taps and everything pre-filled:** Record payment, Create invoice, Add expense from a supplier order (money-03/04/05), Mark won (rfq-detail-03), and close-month confirmation (month-end-03).
- **Role trimming.** What ships for engineers drops every price column on Order detail (`OrderItemsPanel.tsx` line 331) and gives them one green "Mark done today". Sales do not see Margins or Month-end.
- **Money formatting:** mono, right-aligned, PKR prefix, red for overdue, dashed underline for provisional (components-03).
- **Burst expense entry:** keyboard-first, with defaults carried down. Login and the Quotation PDF: minimal and clean.
- **Month-end on a phone** (month-end-15): one row per check with a count. This is the pattern the desktop checklist should copy.
