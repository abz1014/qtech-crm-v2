# Copy audit: every word a user reads in qtech-crm-v2

Date: 2026-10-20. Read-only audit. Nothing in the repo was edited, committed or checked out.

| Tag | Ref audited | Head |
|---|---|---|
| main | origin/main | eb8d878 (src identical to 33d10e7) |
| F | origin/ux/foundation | a124211 |
| O | origin/ux/orders | fdc8614 |
| T | origin/ux/money-today | 8cb0062 |
| R | origin/ux/rfqs | 02ac73f |

How to read the references: `T features/today/ContextPane.tsx:573` means the text lives on ux/money-today at `src/features/today/ContextPane.tsx`, line 573 (`git show origin/ux/money-today:src/features/today/ContextPane.tsx`). **main** means the file is the same on all four branches, so the problem ships whichever branch merges. ContextPane.tsx and ReceivablesPage.tsx are changed on both F and T. F's changes there are layout only, so the T line numbers are the ones cited.

Method: every JSX text, string literal and template literal in `src/` (not tests, not `src/dev/gallery`, not DB column lists) was pulled out with the TypeScript parser. That gave 5,839 strings on main and 6,134 in the "latest" view (each file taken from the branch that changes it). Each string was read by hand against the owner's glossary (DECISIONS 2026-10-19, plus the R, T and O entries of 2026-10-20). Counts and checks for symbols, sentence length, contractions and error wording were then run by script. The guides in `docs/guides/` were checked for the same words.

---

## Scores

| | Score | Why |
|---|---|---|
| **main today** | **4.5 / 10** | Sentence case, a calm voice, and most errors say "Nothing was changed. Try again". But 261 strings use words the owner banned: float, bid, leg A/B, Covered, No offer, Capture, Provisional, Basis unknown, Receivables, Exceptions, Bank tick, Aging, Issue R2 and n/a. Every action has 2 to 4 names (float, ask, copy enquiry; bid, quote, offer). Chips read like database states ("Partly covered", "Answers to relay"). |
| **as of the four branches (merged)** | **6.5 / 10** | Status chips, Today, the RFQ screens, Money's tabs, Orders and the guides now mostly use the glossary. 54 hits are left and only about 20 of them are real (the rest are variable names). What still holds the score down: the leftover glossary words below; a second layer of jargon the glossary never covered (net/gross/settled, source, placed, carries, shortlist, family, stamp, tick, spread, median, committed, PSID group); several names for one thing (3 sets of close reasons, 4 names for the customer reference, "quote" used for both the supplier's price and our quotation); symbols (×3, ≈, ~, 1.2M, 3d); 7 ways to say "couldn't load"; and a few technical errors ("Request GET /orders/…"). |

What a 10 needs: one word per idea everywhere (app, PDFs, messages, guides); no word a sales or engineer user has to ask about; every error says what to do next; no sentence over 20 words; no symbol standing in for a word. See section 6.

---

## Top 12 fixes, in order of value to the users

1. **Finish the glossary.** Fix the 18 leftovers in section 1 (leg, float, Capture, bank tick, aging, receivables, price basis, provisional, copy enquiry, bid).
2. **One list of close reasons.** There are three today (RFQ page, board, company page). See section 2.
3. **Supplier side = "price", our side = "quotation".** Remove "quote / quoted / quotes / Recent quotes / Ranked quotes" for what a supplier sends. Use "Can't quote" everywhere (not "Couldn't offer" or "cannot offer"). Use "Asked" (not "Enquiry sent" or "Enquiries") for asking a supplier.
4. **Replace net / gross / settled on screens** with "before GST", "with GST" and "paid in full". This touches Who owes us, Invoices, Quotation dialog, Orders, Month end and Margins. PDFs can keep the formal words if the owner prefers.
5. **Remove the technical errors:** "Request GET /orders/…", "The browser refused the clipboard", "could not be read back", "Request failed · reference …" and "Supabase …".
6. **One error pattern:** "Couldn't load X. Nothing was changed. Check your connection and try again." Retire all 6 "Something went wrong" messages.
7. **No symbols for words:** × → "times", ≈ / ~ → "about", "3d" → "3 days", "5 min" → "5 minutes", "1.2M" → the full figure, ÷ and ≠ → words.
8. **Second-tier jargon** (section 3): sourced/source, placed, carries, shortlist, family, stamp, tick, spread, median, committed, PSID group/set, template, audit log, nudge, intake, board, memory, split/cell, in transit, snapshot.
9. **Same idea, same name** (section 2): customer reference, "Needs suppliers" vs "Not sent to suppliers", "Some items priced" vs "Partly priced", "Part" vs "Partly", "Settled" vs "Paid", "Export" vs "Export CSV", "GST register" vs "Invoices & GST", "Revise PO (R2)" vs "Revision 2", "critical" vs "serious", "Month-end" vs "Month end".
10. **Numbers and dates:** toasts use `toLocaleString` (shows "PKR 45,000.5") where the tables use `formatPaisa` (shows "45,000.50"). Change "Rs 1" to "PKR 1". Things to check prints raw ISO dates and unformatted amounts. "Use the form 2026-11" shows an ISO month. Target tooltip shows raw numbers.
11. **Shorten the 10 sentences over 20 words** (section 4.4). Most are (i) tips.
12. **Messages we send:** use one spelling of the greeting ("Assalam o Alaikum" vs "Assalamu alaikum"), always "Dear Sir or Madam", and always "(our ref. X)".

---

## 1. Glossary terms the branches missed

| Where | Now | Proposed |
|---|---|---|
| main `app/pages/SignInPage.tsx:101` | Sign in and the Capture sheet opens with it. | Sign in and Paste or photo opens with it. |
| R `features/capture/CaptureSheet.tsx:385` | Your capture is kept on this phone. Save when you are back online. | What you added is kept on this phone. Save when you are online again. |
| R `features/capture/CaptureSheet.tsx:398` | Nothing was changed and your capture is still here. | Nothing was changed. What you added is still here. |
| R `features/rfqs/SupplierPicker.tsx:224` (file is unchanged from main, but still used by New RFQ on R) | You can still add a supplier by name below, or save the RFQ and float it later. | You can add a supplier by name below, or save the RFQ and ask suppliers later. |
| R `features/rfqs/IntakeScreen.tsx:484` | Paste what the customer sent. Nothing is saved until you copy the enquiry or save. | Paste what the customer sent. Nothing is saved until you copy the message or save. |
| T `app/pages/DestinationPage.tsx:7-8` (fallback; every screen now exists, so it is dead) | What needs you today: bids, chases, goods and payments. / Enquiries from first contact to bid, win or close. | Delete the page, or: "What needs you today: quotations, chases, goods and payments." / "RFQs from first contact to quotation, won or closed." |
| main `features/money/costs/api.ts:60` (shown in the Margin panel's cost rows on the order page) | leg A | supplier order A (better: the supplier's name, as O does on the order page) |
| main `features/purchaseOrders/useOpenPoPdf.ts:25` | This leg has no purchase order yet. | This supplier order has no PO yet. |
| O `features/orders/GoodsChaseDialog.tsx:135` | The message asks about the expected date, so set one on the leg first. | The message asks about the expected date. Set it on the supplier order first. |
| main `lib/reconciliation.ts:242` (Things to check) | …exceed the PO total on a leg | …more than the PO total on a supplier order |
| T `features/money/monthEnd/model.ts:682` (We owe suppliers CSV header) | Leg | Supplier order |
| main `lib/reconciliation.ts:145-146` (Things to check) | Price basis unknown / "…has no recorded GST basis, so it is left out of margin, GST totals and net cash. Its payments still count in gross cash." | Is GST included? / "ORD-0038 does not say if its prices include GST. It is left out of margin and GST totals until someone answers." |
| main `lib/reconciliation.ts:187-188` | Costs not marked complete / "…its margin is still provisional. Mark costs complete when every cost is in." | Costs not marked final / "ORD-0038 is paid in full, but its margin is not final. Mark costs final when every cost is in." |
| main `app/pages/NoAccessPage.tsx:12` | to see invoices or receivables | to see invoices or who owes us |
| main `features/settings/teamModel.ts:10` (Sales role help in Add person / Change role) | RFQs, orders, companies, invoices and receivables. No payments, expenses or margins. | RFQs, orders, companies, invoices and who owes us. No payments, expenses or margins. |
| main `features/money/expenses/ExpensesTab.tsx:283` | It is removed from the books and from the bank tick. Its receipt photo goes with it. | It is removed from the books and from Match bank statement. Its receipt photo is deleted too. |
| main `features/money/monthEnd/MonthDialogs.tsx:106` | These are warnings, not blockers. … Bank ticks and the TCS and FBR stamps stay editable. | These are warnings. They do not stop the close. Bank matching and the TCS and FBR dates can still be changed. |
| T `features/money/monthEnd/ReportPages.tsx:589` | Held apart, never shown as negative aging. | Kept apart. Not counted as overdue. |
| main `features/money/margins/model.ts:64-70` (main only; `marginNote()` is dead code on T) | The 2 provisional margins are shown… the order with an unknown price basis is left out until someone resolves it | Delete `marginNote()` when T merges. |
| main `features/reports/ReportsScreen.tsx:101-147` (main only; replaced on T) | Where the float stands / Float coverage and conversion / Of the RFQs you floated… | Already fixed on T ("Does asking suppliers for prices help us win?"). |

Glossary gaps (words the owner's list does not cover yet but should):
- **PO revisions.** Quotations now say "Revision 2" and "Replaced". POs still say "R0", "R2", "Revise PO (R3)" and "Re-issue PO" (O `orders/LegsPanel.tsx:202,234,240,291`, O `purchaseOrders/IssuePoDialog.tsx:123`). Proposal: "Revision 2" and "Revise PO" everywhere on screen. "R2" can stay inside PDFs and file names.
- **Net / gross / settled.** Not in the glossary, but these are the most common jargon left (section 2).
- **"No price yet" means two things.** It is a red chip for "every supplier said no" (`lib/status.ts:55`, view value `no-offer-anywhere`) and a grey chip or RFQ item line for "nothing in yet" (`status.ts:157`, R `rfqs/lib/detailView.ts:28`). Proposal: "No supplier can supply" for the red one. This needs an owner decision, because the glossary maps No offer → No price yet.

---

## 2. Same thing, different names

| Idea | Names in use now (where) | Use |
|---|---|---|
| Why an RFQ was closed | **Three sets.** RFQ page and reports (main `rfqs/lib/closeDefaults.ts:5-11`): "The customer chose a competitor / Price too high / No reply to our questions / The customer cancelled / We could not source it / We were too late / Another reason". Board Outcome column (R `rfqs/board/model.ts:219-225`): "Lost to a competitor / Price / No reply to our question / Customer cancelled / Could not source / We were late / Other reason". Company page (O `companies/SitesPanel.tsx:46-53`): "chose a competitor / price too high / no reply from customer / customer cancelled / could not source / we were too late / closed, another reason". Today also quotes "No reply to our questions" (T `today/ContextPane.tsx:828`). | One list, exported once: **Lost to a competitor · Our price was too high · No reply to our questions · Customer cancelled · No supplier could supply · We were too late · Other reason** |
| The customer's own number for a request | "Customer reference" (R `rfqs/IntakeScreen.tsx:616`), "Customer ref" (R `rfqs/RfqHeaderBlock.tsx:382`, R `quotations/IssueQuotationDialog.tsx:392`), "customer ref" (T `today/ContextPane.tsx:243,248`, R `IssueQuotationDialog.tsx:393`), "their ref" (R `rfqs/board/BoardParts.tsx:47,138`), "Their RFQ or enquiry number" (R `IntakeScreen.tsx:616` help) | **Customer reference** (labels); "their reference" in running text |
| Asking a supplier for a price | "Ask suppliers" (glossary), "Enquiry sent" (T `today/ContextPane.tsx:652`), "Enquiries / Recent enquiries / All enquiries / No enquiry sent to them yet" (O `companies/SupplierPanel.tsx:90-208`, `SupplierRecordPanels.tsx:187,331`, `supplierFacts.ts:46,106,107,122`), "One enquiry on record" (main `lib/memory/index.ts:339`), "Sent" (R `rfqs/lib/detailView.ts:82`) | **Asked** (verb, date label "Asked on"); a count is "Times asked" |
| What a supplier sends back | "Quoted" chip (F `lib/status.ts:77`), "Recent quotes / Quoted price / No quotes from them yet" (O `companies/SupplierRecordPanels.tsx:175,196,201`), "Their quote" (main `purchaseOrders/lib/prefill.ts:57`), "Ranked quotes" (main `orders/RankedPicker.tsx:64`, O `orders/SplitLineDialog.tsx:170-180`, O `orders/ConvertDialog.tsx:389`), "best-ranked quote" (O `ConvertDialog.tsx:249,252`), "Awaiting a quote" (O `companies/supplierRecord.ts:255`), "Quotes in USD" (O `companies/companyMeta.ts:56`), "quote lines" (main `rfqs/MemoryCard.tsx:210`) | **Price / prices** ("Price received", "Recent prices", "Supplier prices from the RFQ", "Recommended price", "Waiting for a price", "Prices in USD"). Keep "quotation" for ours only. |
| Supplier says no | "Can't quote" (glossary; F `status.ts:78`, R screens), "Couldn't offer" (O `companies/SupplierPanel.tsx:260`, `SupplierRecordPanels.tsx:33`, `supplierFacts.ts:44`), "cannot offer" (T `today/ContextPane.tsx:547`), "refusal" (R `rfqs/PasteReply.tsx:59`), "Every supplier asked said no" (R `rfqs/board/model.ts:131`) | **Can't quote** |
| RFQ not yet sent to suppliers | "Not sent to suppliers" (F `status.ts:51`, R `rfqs/IntakeParts.tsx:94`, T `today/rules.ts:245`), "Needs suppliers" (R `rfqs/board/model.ts:61`, R `rfqs/lib/nextAction.ts:61`, which is also the RFQ header chip) | Pick one. The glossary has **Not sent to suppliers**. |
| RFQ ready for our quotation | "To quote" (F `status.ts:67`), "Ready to quote" (R `board/model.ts:63`, `nextAction.ts:56`) | **Ready to quote** |
| Some items priced | "Partly priced" (F `status.ts:53`), "Some items priced" (T `reports/model.ts:75`) | **Partly priced** |
| Part vs partly | "Part invoiced", "Part paid" (F `status.ts:104,109`; T `monthEnd/ReportPages.tsx:649`), "Partly priced", "Partly delivered", "Partly invoiced" (T `today/rules.ts:624`) | **Partly** everywhere |
| Paid in full | "Settled" chip (F `status.ts:110`), "Settled" column (T `money/payments/ReceivablesPage.tsx:115`) next to the filter "Paid" (`:219`) and "paid in full" (`:227-231`) on the same screen, "Settled (≈)" (F `status.ts:155`, T `monthEnd/model.ts:675`), "Settled by the end of October" (T `monthEnd/model.ts:111,219`), "This settles the order" (main `money/payments/model.ts:148`) | **Paid in full**; column "Paid so far" |
| Total with GST | "Gross", "Gross due", "Gross paid", "Invoice gross", "Total gross", "gross amount", "Balance is gross, GST included" (T Receivables, Invoices, Month end; R quotation dialog; O ConvertDialog; main CreateInvoiceDialog) | **With GST** ("Total with GST", "Due, with GST") |
| Total before GST | "Net", "Net amount", "Net sale", "Line net", "Unit price, net PKR", "Value (PKR net)", "Net in", "Net credited", "net cash" | **Before GST** ("Price each, before GST", "Sale before GST", "Money in, before GST") |
| A supplier-side part of an order | "Supplier orders" (O, good), "supplier order A" (T `money/bank/api.ts:143`, T `expenses/api.ts:257`), "leg A" (main `money/costs/api.ts:60`), "Leg" (T CSV) | **Supplier order** + the supplier's name; drop letters where a name fits |
| Ordering from a supplier | Chip "To place" (F `status.ts:89`), list "Place the supplier order" (O `orders/lib/nextStep.ts:42`), Today "Place PO with X" (T `today/rules.ts:268`), button "Issue PO" (O `primaryAction.ts:92`), "Mark placed" / "Marked placed" (main `orders/lib/legModel.ts:27`, O `useLegActions.ts:48`, O `primaryAction.ts:91`), "N of M not placed" (O `OrderHeaderBlock.tsx:71`), date "Placed" (O `LegsPanel.tsx:212`) | **Send PO** / **PO not sent** / **Mark ordered** / date **Ordered** |
| Changing a PO after it went | "Re-issue PO" (O `orders/LegsPanel.tsx:239-240`), "Revise PO (R3)" (O `LegsPanel.tsx:291`), "lines changed since R1, re-issue" quoted in help (O `SplitLineDialog.tsx:261`, which does not match the real banner at `LegsPanel.tsx:234-236`) | **Revise PO**; banner "Lines changed since revision 1. Revise the PO." |
| Quotation versions | "Revision 2" + "Replaced" on screen (R, good); "R2" on POs (O); "QT-26-0042 R2" from `quotations/lib/refs.ts:5` (PDF and file name, kept by decision) | **Revision 2** on screen |
| Things to check severity | "critical" (T `money/exceptions/ExceptionsPage.tsx:79`), "serious" (T `monthEnd/ChecklistPage.tsx:196`) | **serious** |
| The Invoices page | Tab "Invoices & GST" (T `money/moneyTabs.ts:16`), page title "GST register" (T `invoices/GstRegisterPage.tsx:212,270`), guide (R `docs/guides/ADMIN.md:3`) | **Invoices & GST** |
| Courier and FBR columns | Screen: "Sent to customer (TCS)", "Tax deposited (FBR)" (T `GstRegisterPage.tsx:140-141`). Export: "Courier (TCS)", "Deposited on" (`:204`). Invoice dialog: "Courier (TCS)" (main `InvoiceDetailDialog.tsx:166`) | **Sent by TCS** / **GST paid to FBR** |
| A set of invoices paid with one FBR slip | "PSID group(s)" (T `monthEnd/model.ts:81,83,201,203`, T `bank/BankTickPage.tsx:171`), "PSID sets" (T `monthEnd/ReportPages.tsx:732`, `model.ts:741`) | **PSID** (one deposit); "invoices on one PSID" |
| Marking courier and FBR progress | "stamp", "Stamp taken back", "Couldn't stamp the invoices", "TCS and FBR stamps" (T `GstRegisterPage.tsx:168-196`, T `ChecklistPage.tsx:111,175`, main `MonthDialogs.tsx:106`, main `InvoiceDetailDialog.tsx:181`) | **mark** ("Mark sent by TCS", "TCS and FBR dates") |
| Matching the bank | "Match bank statement" (T page), "Bank matching" (T checklist), "bank tick(s)" (main), "ticks are safe" (T `BankTickPage.tsx:103`, T `ReportParts.tsx:110`) | **Match bank statement**; a line is "matched" |
| Month end | "Month end" (tab), "Month-end" (main `expenses/BurstSheet.tsx:605`, R guides), "month-end checklist" (T `ContextPane.tsx:571`) | **Month end** (two words, no hyphen) |
| Download a table | "Export CSV" (F `ui/DataTable.tsx:681`, T `monthEnd/ReportParts.tsx:15`, T `ExceptionsPage.tsx:67`), "Export" (T `GstRegisterPage.tsx:241`) | **Download for Excel** |
| Where the company details are | Settings group "Company", page "Company profile" (T `settings/SettingsLayout.tsx:30,33`), pointers "in Settings, Company" (R `IssueQuotationDialog.tsx:354`, R `quotations/QuotationsPanel.tsx:85`, O `IssuePoDialog.tsx:178,204`, main `useOpenPoPdf.ts:34`), button "Open Settings, Company" (main `quotations/SettingsLink.tsx:7`) | **Settings > Company profile** |
| Exchange-rate age | "Fresh / Stale / Unusable" (F `status.ts:138`, main `fx/ratesModel.ts:56-57`), ", stale" / ", too old" (main `ratesModel.ts:110`), "rate too old" (R `rfqs/ItemsPanel.tsx:71`), "Band" column (main `fx/ExchangeRatesPage.tsx:133`), "Needs a rate" vs "No rate" (T `monthEnd/model.ts:677` vs F `status.ts:158`) | **Up to date / Old / Too old to use**; column "Status"; **No exchange rate** |
| "Not compared" note | "not compared, no rate" (R `ItemsPanel.tsx:71`, R `SupplierReplies.tsx:270`), "not compared — no rate" (R `ItemsPanel.tsx:98`), "no rate, not compared" (main `rfqs/RateBar.tsx:22`), "not compared, no rate" (F `ui/Money.tsx:225`), "Rate N days old · not compared" (F `Money.tsx:233`) | **Not compared: no exchange rate** / **Not compared: rate too old** |
| Customer and supplier | "Both" chip (F `status.ts:135`), "Customer & supplier" (O `companies/CompanyParts.tsx:78`), "Customer and supplier" (main `search/paletteSource.ts:18`) | **Customer and supplier** |
| Client vs customer | "Client received" (main `invoices/InvoiceDetailDialog.tsx:172`, `lib/reconciliation.ts:295`) | **Customer received** |
| The salesperson on an RFQ or order | "Owner" (R `rfqs/RfqHeaderBlock.tsx:411`, R `board/BoardPage.tsx:133,142`, O `orders/OrderHeaderBlock.tsx:167`), "Orders you own" (O `OrdersListPage.tsx:258`) | **Handled by**; "Orders you handle". ("Owner" also means the business owner.) |
| Photo size | "resized" (R `CaptureParts.tsx:193`), "shrunk" (R `CaptureSheet.tsx:375,378`), "compressed before upload" (main `expenses/BurstSheet.tsx:424`) | **made smaller** |
| Adding a file | "added" (most), "uploaded / did not upload" (main `InvoiceDetailDialog.tsx:201`, main `BurstSheet.tsx:204`, T `ExpenseDialog.tsx:230`) | **added / was not added** |
| Next-step wording on lists | RFQ list uses states ("Needs suppliers / Waiting for prices / Ready to quote / Quotation sent", R `board/model.ts:61-64`). Orders list uses orders ("Choose a supplier / Place the supplier order / Create the invoice", O `orders/lib/nextStep.ts:35-64`). | Make both imperative: **Ask suppliers / Wait for prices / Send quotation / Wait for decision** |
| Brand | "Q Tech Solutions" (main `SignInPage.tsx:77` alt), "Q-Tech Solutions" (F `TopBar.tsx:40`, R messages), "Q-Tech CRM" (F `AppShell.tsx:54`, main `PwaPrompts.tsx:39`), "Q-Tech, home" (F `MobileChrome.tsx:55`) | **Q-Tech** for the company, **Q-Tech CRM** for the app |

---

## 3. Findings by screen

Each row gives where the text lives, the current text, the proposed text, and the reason (in brackets).

### 3.1 Sign-in, shell, search, crash page
| Where | Now | Proposed |
|---|---|---|
| main `app/ErrorBoundary.tsx:42` | Something went wrong | This page stopped working (the body already says what to do) |
| main `app/pages/SignInPage.tsx:116` | The Supabase address and key are missing. | This copy of the app is not set up. Tell the admin. |
| F `app/palette/PaletteHost.tsx:82` | Go to intake | Start a new RFQ (intake is internal) |
| T `app/pages/DestinationPage.tsx:28-30` | The … screen is not built yet / The navigation, your role and the page frame are live. This screen arrives with its own task. | Delete (dead fallback) |
| F `ui/DataTable.tsx:590-593`, R `rfqs/board/model.ts:253` | Request failed · Tue 21 Oct, 14:05 · reference 7F3A | Tried at 14:05, Tue 21 Oct · code 7F3A |

### 3.2 Shared parts (money chip, tables, toasts, forms)
| Where | Now | Proposed |
|---|---|---|
| F `ui/Money.tsx:121` (tip on the "Is GST included?" chip) | The net or gross value was never recorded for this legacy order. Shown as typed. | The old CRM did not say if this price includes GST. Shown as it was typed. |
| F `ui/Money.tsx:304` | Does not equal net + GST | Before GST plus GST does not match this total |
| F `ui/SumBar.tsx:83` | Not in P&L: drawings and loan repayments | Not in profit: owner's drawings and loan repayments |
| F `ui/SumBar.tsx:94` | Result less drawings is PKR x | After owner's drawings: PKR x |
| F `ui/SumBar.tsx:115` | (parts add to x) | (the parts add up to x) |
| F `ui/DataTable.tsx:681` and others | Export CSV | Download for Excel |
| F `ui/Toast.tsx:57` | Could not undo | Couldn't undo. Change it back by hand. |
| main `ui/form/DateInput.tsx:97` | e.g. 27 nov, 27/11, today | For example 27 Nov, 27/11 or today |
| F `ui/DataTable.tsx:670-675` | Density: Comfortable / Compact | Row size: Normal / Small (if the switch stays) |

### 3.3 Status chips (`src/lib/status.ts` on F)
| Where | Now | Proposed |
|---|---|---|
| F `status.ts:55` | No price yet (red, every supplier said no) | No supplier can supply (owner to confirm) |
| F `status.ts:61` | Waiting on customer | Waiting for customer |
| F `status.ts:73` | Shortlisted | Not asked yet |
| F `status.ts:76` | Awaiting reply | Waiting for reply |
| F `status.ts:77` | Quoted | Price received |
| F `status.ts:83` | Answers waiting | Answers to send (same meaning as `:62`) |
| F `status.ts:88-90` | To source / To place / On order | Needs a supplier / PO not sent / Ordered |
| F `status.ts:92,94` | Received / Delivered | Received by us / Delivered to customer |
| F `status.ts:104,109` | Part invoiced / Part paid | Partly invoiced / Partly paid |
| F `status.ts:110,155` | Settled / Settled (≈) | Paid in full / Paid (about) |
| F `status.ts:113` | Not final / Complete | Not final / Final |
| F `status.ts:115` | Firm | Confirmed |
| F `status.ts:127` | Generated (FBR) | PSID made |
| F `status.ts:135` | Both | Customer and supplier |
| F `status.ts:138` | Fresh / Stale / Unusable | Up to date / Old / Too old to use |
| F `status.ts:139` | No rate captured | No rate saved |
| F `status.ts:148` | Advance held | Paid in advance |
| F `status.ts:156` | Paid over | Overpaid |
| F `status.ts:163` | Not in P&L | Not in profit |
| F `status.ts:167-168` | Zero value / Unattributed | No amount / No order linked |

### 3.4 Today (T)
| Where | Now | Proposed |
|---|---|---|
| `today/ContextPane.tsx:454,630`, `TodayScreen.tsx:161,203`, main `today/text.ts:16` | Next nudge / time to nudge / next nudge on | Chase again on / when it is time to chase again ("nudge" is an idiom) |
| `ContextPane.tsx:453,628,645,657,671,688,748`, `:517,523` | asked ×3 / ×2 / (×3) | asked 3 times / chased 2 times |
| `ContextPane.tsx:517-523` | Copying records a chase today (asked ×3). ORD-0012 moves to Waiting and returns on Thu 23 Oct. Firmer wording, because it is more than 30 days. | Copying counts as a chase. It moves to Waiting and comes back on Thu 23 Oct. Stronger words: over 30 days. (unfinished "more than 30 days") |
| `ContextPane.tsx:519,521` | …returns if still silent after Thu 23 Oct | …comes back on Thu 23 Oct if they have not replied |
| `ContextPane.tsx:547` | Every item has a price or a "cannot offer" from this supplier, so there is nothing to ask. | Every item has a price or "Can't quote" from this supplier. Nothing to ask. |
| `ContextPane.tsx:563` | This order has a supplier order with no purchase order yet. Open the order to place it. | A supplier on this order has no PO yet. Open the order and send the PO. |
| `ContextPane.tsx:573` | …so their margin is not final. Open Margins, check the costs and mark each order complete. | Paid in full, but costs are not final. Open Month end > Margins and mark the costs final. ("Margins" is now inside Month end) |
| `ContextPane.tsx:575` (24 words) | The GST on these invoices is not deposited with FBR and the month is over, or an FBR step was recorded out of order. Open Invoices & GST… | GST on these invoices is not paid to FBR yet, or a step is out of order. Open Invoices & GST. |
| `ContextPane.tsx:577` | These invoices have no courier (TCS) date three working days after the invoice. Open Invoices & GST, tick them and press "Sent by TCS today" once. | These invoices were not sent by TCS within 3 working days. Open Invoices & GST, tick them and press "Sent by TCS today". |
| `ContextPane.tsx:579` (24 words) | You are an engineer on this order. Open it to see the site contact and the notes, then "Mark done today" when the commissioning is finished, or change the planned date. | Open the order for the site contact and notes. When the job is finished, press "Mark done today". |
| `ContextPane.tsx:652` | Enquiry sent | Asked on |
| `ContextPane.tsx:243,248` | · customer ref X | · customer reference X |
| `ContextPane.tsx:753` | A third ask suggests closing as no reply. | Asked 3 times, no reply. You can close it as "No reply". |
| `ContextPane.tsx:380` | today. Moves to Waiting when the undo closes. | today. It moves to Waiting in a few seconds (you can still undo). |
| `ContextPane.tsx:173,853` | Could not copy the message / Could not snooze | Couldn't copy the message / Couldn't snooze. Try again. |
| `ContextPane.tsx:865-911` | Snooze / Snooze until / Snoozed until | Keep "Snooze" and add it to Words we use, or use "Hide until" |
| `today/TargetTile.tsx:35,176` | Your Q3 target | Your target for Jul to Sep |
| `TargetTile.tsx:53,94,114` | on pace PKR 1.25M / Ahead of pace / Behind pace / On pace | Should be at PKR 1,250,000 today / Ahead / Behind / On track |
| `TargetTile.tsx:58` | Exact: achieved 1234567, on pace 1250000.5, target 3000000 (raw numbers) | Exact: PKR 1,234,567 of PKR 3,000,000 |
| `TargetTile.tsx:90` | Share of the quarter gone · 45 ÷ 92 days | Days gone: 45 of 92 |
| `TargetTile.tsx:96` | Net cash received by you since 1 Jul, GST left out. Shown to the nearest PKR 10,000… | Money you collected since 1 Jul, without GST. Rounded to PKR 10,000. |
| `TargetTile.tsx:26` | Your target could not be read. | Couldn't load your target. |
| `today/TodayScreen.tsx:92` | Ready to move | Ready for you |
| `today/rules.ts:88,90,95` | 3d late / in 3d / 3d old | 3 days late / in 3 days / 3 days old |
| `today/rules.ts:181` | Chase customer for clarifications | Chase customer for answers (the app says "questions" everywhere else) |
| `today/rules.ts:268` | Place PO with X | Send PO to X |
| `today/rules.ts:778` | FBR: 3 invoices need attention | GST not paid to FBR on 3 invoices |
| `today/rules.ts:780` | 2 steps recorded out of order | 2 FBR steps in the wrong order |

### 3.5 RFQ list (R)
| Where | Now | Proposed |
|---|---|---|
| `rfqs/board/BoardPage.tsx:131` | Value (PKR net) | Value, PKR before GST |
| `BoardPage.tsx:133,142` | Owner | Handled by |
| `BoardPage.tsx:182` | None of your RFQs are open. Nice. | None of your RFQs are open. |
| `board/BoardParts.tsx:47,138` | · their ref | · their reference |
| `board/model.ts:61` | Needs suppliers | Not sent to suppliers (or change the glossary to "Needs suppliers" everywhere) |
| `board/model.ts:112` | 2 answers to pass on to suppliers | 2 answers to send to suppliers |
| `board/model.ts:219-225` | (close reasons, second set) | Use the one list (section 2) |

### 3.6 RFQ page (R)
| Where | Now | Proposed |
|---|---|---|
| `rfqs/RfqHeaderBlock.tsx:382` | Customer ref | Customer reference |
| `rfqs/ItemsPanel.tsx:71,98`, main `RateBar.tsx:22` | not compared, rate too old / not compared — no rate / no rate, not compared | Not compared: rate too old / Not compared: no exchange rate |
| `ItemsPanel.tsx:102-103` | At entry 278.40 · Mon 6 Oct / "5 d" | Rate when saved: 278.40, Mon 6 Oct / "5 days" |
| `ItemsPanel.tsx:508` | …is only 1.5% dearer and has the better delivery record. | …costs only 1.5% more and delivers on time more often. ("dearer") |
| `rfqs/SupplierReplies.tsx:200` | Reads as ≈ PKR 41,200 at today's USD rate. | About PKR 41,200 at today's USD rate. |
| `SupplierReplies.tsx:167,393` | Take back | Undo "Can't quote" |
| `rfqs/PasteReply.tsx:182` | Read it | Read the prices |
| `rfqs/ClarificationParts.tsx:91,139` | Raised by X | Asked by X |
| `ClarificationParts.tsx:246-247` | Withdraw | Not needed (chip "Withdrawn" becomes "Not needed") |
| `rfqs/ClarificationsPanel.tsx:119,127,134,138` | marked as told / Marked as not told / Copied, but not marked as told | marked as sent / Marked as not sent / Copied, but not marked as sent |
| `ClarificationsPanel.tsx:164` | No questions yet. Ones raised by suppliers, or your own, are listed here and bundled for the customer in one tap. | No questions yet. Questions from suppliers, or your own, show here. One tap copies them all for the customer. |
| `ClarificationsPanel.tsx:212,396`, `SuppliersAsked.tsx:70` | Asked ×3 / ×2 | Asked 3 times / Chased 2 times |
| `ClarificationsPanel.tsx:381` | Kindly confirm by (field label) | Ask for an answer by |
| `rfqs/SuppliersAsked.tsx:281` | Copying records chase 2 for this supplier. X moves to Waiting and returns if still silent after Y. It lists only the items this supplier has not priced, and never names the customer or our price. | Copying counts as chase 2. It comes back on Y if they have not replied. The message lists only unpriced items. It never names the customer or our price. |
| `rfqs/SuppliersToAsk.tsx:78` | No supplier on file carries a brand in this RFQ yet. Add the brands a supplier carries on its company page, or ask anyone from Companies | No supplier sells these brands yet. Add brands on a supplier's company page, or pick any company. |
| `rfqs/FloatElsewhere.tsx:68,70` | Looking at who else carries them… / Nobody else on file carries X. | Looking for others who sell them… / No one else we know sells X. |
| `rfqs/useAskSuppliers.ts:54` | The browser refused the clipboard. Nothing was recorded. | Couldn't copy. Nothing was saved. Try again. |
| main `rfqs/api.ts:138` | The RFQ was saved but could not be read back. | The RFQ is saved. Reload the page to see it. |
| R `rfqs/lib/detailView.ts:60` | reply time needs 3 replies logged here | reply speed shows after 3 replies |
| R `rfqs/lib/replySuggest.ts:78` | Low confidence: check the price and the item | Not sure: check the price and the item |
| R `rfqs/lib/ranking/reasons.ts:271` | Often late: on time 2 of 5 deliveries · late ones median 9 days | Often late: on time 2 of 5 · usually 9 days late |
| R `reasons.ts:319,327` | Spread ≈ PKR x each … Before freight and duty. | Our margin: about PKR x each, before freight and duty |
| R `reasons.ts:222,524`, main `lib/memory/index.ts:93,109` | in this family / same family / Matched on item family only. | same type of item |
| R `reasons.ts:163` | 1.2M | PKR 1,200,000 |
| main `rfqs/lib/collision.ts:16,18` | 5 min ago / 3h ago | 5 minutes ago / 3 hours ago |
| main `lib/memory/index.ts:203,340`, main `LastPriceChip.tsx:19`, O `SupplierRecordPanels.tsx:105` | currency unverified | currency not checked |
| main `lib/memory/index.ts:280,293`, main `rfqs/lib/supplierSuggestion.ts:178` | usually replies in ~2 days / usually ~9 days over | usually replies in about 2 days / usually about 9 days late |
| main `rfqs/LastPriceChip.tsx:40`, `MemoryCard.tsx:47,75` | Imported | From old CRM |

### 3.7 New RFQ (R)
| Where | Now | Proposed |
|---|---|---|
| `rfqs/IntakeScreen.tsx:442,744,798,799`, `:565` | …saved with 2 suppliers shortlisted / X is on your shortlist for it | …saved with 2 suppliers picked / X is on your list for it |
| main `rfqs/lib/supplierSuggestion.ts:81,293` | Shortlisted for the family / On your shortlist for this item family. | Picked before for this type of item |
| `IntakeScreen.tsx:483` | Check the split, then find suppliers. | Check the items, then find suppliers. |
| `IntakeScreen.tsx:494` | 5 items found in 7 lines. Edit any cell to fix a split. | 5 items found in 7 lines. Tap any box to fix it. |
| `IntakeScreen.tsx:617,686` | e.g. ENQ-2211 / e.g. 3 dec | For example ENQ-2211 / For example 3 Dec |
| `IntakeScreen.tsx:692` | Sorts it to the top of the board for everyone. | Puts it at the top of the RFQ list for everyone. |
| `IntakeScreen.tsx:715` (54-word tip) | By the reason first (same model, same item, same brand), then the track record: on time or not, how often we have ordered, how often they reply, then the most recent contact. A supplier marked late is still listed. Only suppliers who supplied the item before are ticked. | Suppliers who sold us this item come first, then the same brand. Then: on time, ordered often, quick to reply. Only past suppliers are ticked. |
| `IntakeScreen.tsx:719` | Ticked: supplied this item before. The rest is your call. | Ticked: sold us this item before. Tick others if you want. |
| `IntakeScreen.tsx:748` | Spec lines are blank on purpose. … The app never writes a spec for you, and a blank one is fine to send. | Details are left blank on purpose. Add what the customer gave you, or send it blank. |
| `IntakeScreen.tsx:597` | Discard | Delete draft |
| `IntakeScreen.tsx:768,852` | Save without asking | Save, ask suppliers later |
| `rfqs/IntakeParts.tsx:319` | The message is on your clipboard. Paste it into… | The message is copied. Paste it into… |
| `IntakeParts.tsx:342` | Reply-by date. Any supplier still silent then appears on Today as a chase. | Reply-by date. Suppliers who have not replied by then show on Today to chase. |
| main `rfqs/SupplierPicker.tsx:75,137,141` | Memory / "Memory, X" / "Item for the memory of X" | History |
| main `rfqs/ItemsEditor.tsx:143` | Click here and paste, or type one item per line | Tap here and paste, or type one item per line |
| main `rfqs/ItemsEditor.tsx:216,219` | Qty / Family | Quantity / Type |
| main `rfqs/lib/enquiryDraft.ts:172` | An enquiry needs at least one item | Add at least one item first |

### 3.8 Paste or photo (R)
| Where | Now | Proposed |
|---|---|---|
| `capture/tiles.ts:9` | Begin intake with this text | Start a new RFQ with this text |
| `capture/CaptureSheet.tsx:540` | The RFQ opens with the reply read out. Nothing is saved until you accept. | The RFQ opens with the prices filled in from the reply. Nothing is saved until you accept. ("read out" means spoken aloud) |
| `CaptureSheet.tsx:476` (22 words) | The files are kept with RFQ-0177, and the text is added to its notes as written, with your name and the time. | The files go on RFQ-0177. The text is added to its notes with your name and the time. |
| `capture/CaptureParts.tsx:288,341` vs `CaptureSheet.tsx:423,533,547` | On which RFQ / On which order (no "?") vs Which supplier replied? | On which RFQ? / On which order? |

### 3.9 Quotations (R; PDFs main)
| Where | Now | Proposed |
|---|---|---|
| `quotations/IssueQuotationDialog.tsx:462,527,530` | Unit price, net PKR | Price each, PKR before GST |
| `IssueQuotationDialog.tsx:465,561` | Line net, PKR | Line total before GST |
| `IssueQuotationDialog.tsx:570,594`, `QuotationsPanel.tsx:154,196` | Net / Gross / Gross, PKR / net | Before GST / With GST |
| `IssueQuotationDialog.tsx:461` | Qty | Quantity |
| `IssueQuotationDialog.tsx:493` | Best reply ≈ PKR x each | Best supplier price: about PKR x each |
| `IssueQuotationDialog.tsx:555,613,616` | e.g. 8 to 10 weeks from PO / e.g. To your site… / e.g. 50% advance… | For example … |
| `IssueQuotationDialog.tsx:354`, `QuotationsPanel.tsx:85` | …in Settings, Company. | …in Settings > Company profile. |
| `IssueQuotationDialog.tsx:392-393` | Customer ref X / · customer ref X | Customer reference X |
| main `quotations/api.ts:241,250` | This quotation could not be found. / The RFQ of this quotation could not be found. | This quotation was removed. Reload the page. |
| main `quotations/pdf/QuotationDocument.tsx:213,217,246,256` (the customer reads these) | PKR, net / Line net / Total net / Total gross | Before GST / Line total before GST / Total before GST / Total with GST (optional; the decision kept the PDF as is) |
| main `QuotationDocument.tsx:155,209` | Quotation no. / Qty | Quotation number / Quantity (optional) |

### 3.10 Orders list and order page (O)
| Where | Now | Proposed |
|---|---|---|
| `orders/OrderDetailScreen.tsx:119,123` | When Tue 21 Oct, 14:05 · Request GET /orders/… / The request to the server did not finish before any data came back. | Tried at 14:05, Tue 21 Oct / The order is safe. The page did not finish loading. Try again. |
| `orders/OrderHeaderBlock.tsx:183` (20 words) | The old CRM did not say. Until someone answers, this order is left out of margin, GST totals and the net cash that counts towards targets. Its payments still count in gross cash. | The old CRM did not say. Until someone answers, this order is left out of margin, GST and targets. |
| `OrderHeaderBlock.tsx:71` | 1 of 2 not placed | 1 of 2 POs not sent |
| `orders/lib/nextStep.ts:40` | Is GST included? Choose to finish the order | Answer: is GST included? |
| `nextStep.ts:42` | Place the supplier order | Send PO to supplier |
| `nextStep.ts:63`, `money/costs/MarginPanel.tsx:292` | Mark costs complete | Mark costs final |
| `orders/AddDialogs.tsx:93` | ea, kit, job | each, kit, job |
| `AddDialogs.tsx:97` | Unit price, net PKR | Price each, PKR before GST |
| `AddDialogs.tsx:111`, `ConvertDialog.tsx:61`, main `orders/lib/convert.ts:61` | Not sourced yet | No supplier yet |
| `AddDialogs.tsx:180`, `SplitLineDialog.tsx:143` | Suppliers you have asked, ordered from or carry a brand for. | Suppliers you have asked, ordered from, or who sell the brand. (broken grammar) |
| `orders/ConvertDialog.tsx:249,252` | …each item with its best-ranked supplier. / Each item is assigned to the best-ranked quote… | …each item with its recommended supplier. / Each item gets the recommended price… |
| `ConvertDialog.tsx:288,290` | Buy from, ranked / Sell at, net | Buy from / Sell at, before GST |
| `ConvertDialog.tsx:381` | remainder, auto / type it | the rest / type it |
| `ConvertDialog.tsx:196,447` | · gross PKR / Gross | · PKR with GST / With GST |
| main `orders/lib/convert.ts:134` | line 3 is in the Valves family | line 3 is a valve (type of item) |
| `orders/SplitLineDialog.tsx:78` | Between 0 and 10, not including either: some stay with this supplier. | Type a number more than 0 and less than 10. |
| `SplitLineDialog.tsx:170-180`, main `RankedPicker.tsx:64` | Ranked quotes / Loading the ranked quotes / Couldn't load the ranked quotes | Supplier prices / Loading supplier prices / Couldn't load supplier prices |
| `SplitLineDialog.tsx:247` | …give or take Rs 1 of GST rounding. | …give or take PKR 1 (GST is rounded). |
| `SplitLineDialog.tsx:261` | After the split it shows "lines changed since R1, re-issue". | After the split, the supplier order asks you to revise the PO. |
| `SplitLineDialog.tsx:111`, `orders/api.ts:759,850`, `orders/lib/poChange.ts:32-33` | Valve DN50 ×4 / was ×2, now ×4 | Valve DN50, quantity 4 / was 2, now 4 |
| `orders/CommissioningPanel.tsx:160` | Needs it, who is on it, and the planned date. Marking it done is one tap on the page. | Whether it is needed, who does it, and when. |
| `orders/ResolveBasisDialog.tsx:50` | Net + GST = gross. | Before GST + GST = total with GST. |
| `ResolveBasisDialog.tsx:85` | Rewrites the item prices once. Recorded in the audit log. | Changes the item prices once. The change is recorded. |
| `GoodsChaseDialog.tsx:169` | Copying records a chase today (chased ×2). | Copying counts as a chase today (chase 2). |
| `orders/OrderItemsPanel.tsx:308`, `ConvertDialog.tsx:287` | Qty | Quantity |

### 3.11 Supplier orders and PO (O; PDF main)
| Where | Now | Proposed |
|---|---|---|
| `orders/LegsPanel.tsx:202`, `purchaseOrders/IssuePoDialog.tsx:123,166` | PO-26-0017 · R2 / New PO · R0 | PO-26-0017, revision 2 / New PO |
| `LegsPanel.tsx:239-240` vs `:291` | Re-issue PO / Revise PO (R3) | Revise PO |
| `LegsPanel.tsx:212`, main `companies/supplierRecord.ts:308` | Placed / placed 4 Oct | Ordered / ordered 4 Oct |
| `LegsPanel.tsx:216,221` | Ref / Our PO or the supplier's PI | Reference / Our PO or the supplier's proforma invoice |
| `IssuePoDialog.tsx:183,427` | The order with X is marked placed. / Issuing marks the order with X as placed today. | X is marked as ordered today. |
| `IssuePoDialog.tsx:281` | Price source | Where the price came from |
| `IssuePoDialog.tsx:429` (47-word tip) | Incoterm and terms are copied from this supplier's last PO… The PO is a snapshot: later edits to the order do not change it. | Terms come from this supplier's last PO. Issuing saves these prices on the order. Later changes to the order do not change this PO. |
| `IssuePoDialog.tsx:361` | Incoterm | Keep, with an (i): "Who pays for shipping and insurance, for example FOB or CIF." |
| main `purchaseOrders/api.ts:102,159,216` | The PO was issued but could not be read back. / …could not be found. | The PO is issued. Reload the page to see it. / This PO was removed. Reload the page. |
| main `purchaseOrders/lib/prefill.ts:57` | Their quote, RFQ-0177, 4 Oct | Their price, RFQ-0177, 4 Oct |

### 3.12 Companies and supplier pages (O)
| Where | Now | Proposed |
|---|---|---|
| `companies/SupplierPanel.tsx:90,95,200,202,207,208`, `SupplierRecordPanels.tsx:187,331` | No enquiries yet / Enquiries / Recent enquiries / All enquiries | Not asked yet / Times asked / Recent requests / All requests |
| `SupplierPanel.tsx:259-261`, `SupplierRecordPanels.tsx:26,33`, `supplierFacts.ts:44` | Quoted / Couldn't offer / couldn't offer 2 | Priced / Can't quote / can't quote 2 |
| `SupplierRecordPanels.tsx:175,192,194,196,201` | Recent quotes / Quoted price / No quotes from them yet | Recent prices / Their price / No prices from them yet |
| `SupplierRecordPanels.tsx:180` | A locked price is on file, but its currency was never checked, so it is not shown. | One old price is hidden: its currency was never checked. |
| `SupplierRecordPanels.tsx:254,307` | "est." marks an imported date: an estimate, so lateness is a guide only. | "Estimated" marks a date from the old CRM, so lateness is a guide only. |
| `SupplierRecordPanels.tsx:124`, F `status.ts:139` | No rate captured | No rate saved |
| `BrandsPanel.tsx:34,86,121` | Product family | Type of item |
| `BrandsPanel.tsx:63`, main `MemoryCard.tsx:177` | Brands carried | Brands they sell |
| `BrandsPanel.tsx:78,111` | …when they quote one of its items. / …and any quotes for it stay. | …when they price one of its items. / …and their prices stay. |
| `CompaniesPage.tsx:110` (30 words) | Nobody sets a role by hand. An RFQ or an order makes a company a customer (a prospect until it orders); asking it for prices, ordering from it or listing a brand makes it a supplier. | The role is set for you. A company that sends an RFQ is a prospect, then a customer when it orders. A company we buy from or ask for prices is a supplier. |
| `CompaniesPage.tsx:193`, `SitesPanel.tsx:180` | …as you log RFQs / …when you log an RFQ | …as you add RFQs |
| `companies/supplierFacts.ts:113,118` | Reply time is the middle of the 4 replies logged here. / …once 3 replies are logged here | Usual reply time, from 4 replies. / …after 3 replies |
| `supplierFacts.ts:122` | With so few enquiries these are facts, not a pattern. | Too few requests to see a pattern yet. |
| `supplierRecord.ts:255` | Awaiting a quote | Waiting for a price |
| `CompanyParts.tsx:78` | Customer & supplier | Customer and supplier |
| `SitesPanel.tsx:46-53` | (third set of close reasons) | Use the one list |
| `SitesPanel.tsx:143`, T `ReportPages.tsx:643` | State | Status |

### 3.13 Money: Who owes us (T)
| Where | Now | Proposed |
|---|---|---|
| `money/payments/ReceivablesPage.tsx:103,115` | Gross due / Settled (the filter on the same screen says "Paid") | Due, with GST / Paid so far |
| `ReceivablesPage.tsx:205,231` | Balance is gross, GST included / …reach the gross amount. | Balances include GST / …reach the total with GST. |
| main `payments/model.ts:148` | This settles the order: PKR x of y gross… Type a smaller amount to record a part payment. | This pays the order in full: PKR x of PKR y with GST. Type less for a part payment. |
| main `payments/model.ts:100-102` | none due a reminder / 3 due a reminder | none need a reminder / 3 need a reminder |
| main `payments/RecordPaymentDialog.tsx:55` | The balance could not be read. Close this and try again. Nothing was recorded. | Couldn't load the balance. Nothing was saved. Close this and try again. |
| main `RecordPaymentDialog.tsx:65`, `CreateInvoiceDialog.tsx:106`, `InvoiceDetailDialog.tsx:59` | This order is not here any more. | This order was removed. Close this and reload the page. |
| main `RecordPaymentDialog.tsx:100` | Recorded payment | Payment recorded |
| `payments/ReminderPanel.tsx:50,59` | Not invoiced yet. / Nothing is owed. / Not overdue yet. (titles with full stops) | Drop the full stop in titles |

### 3.14 Money: Invoices & GST (T; dialogs main)
| Where | Now | Proposed |
|---|---|---|
| `invoices/GstRegisterPage.tsx:212,270` | GST register | Invoices & GST |
| `GstRegisterPage.tsx:113,227` | Needs attention: | Needs a fix: (then say what) |
| `GstRegisterPage.tsx:168,191,196` | Nothing to stamp on the 3 ticked invoices / Stamp taken back / Couldn't stamp the invoices | Nothing to mark on the 3 ticked invoices / Mark taken back / Couldn't mark the invoices |
| `GstRegisterPage.tsx:334` | Invoices appear here as you create them from an order, by invoice date. Every invoice goes to FBR. | Invoices show here when you create them from an order. |
| main `CreateInvoiceDialog.tsx:113,209,215,231` | Net amount / Net / Gross | Amount before GST / Before GST / With GST |
| main `CreateInvoiceDialog.tsx:146` | Created invoice INV-12 | Invoice INV-12 created |
| main `CreateInvoiceDialog.tsx:76`, T `ExpenseDialog.tsx:340` | (placeholder) ORD-0038 | For example ORD-0038 |
| main `CreateInvoiceDialog.tsx:80,96`, `InvoiceDetailDialog.tsx:50` | The orders could not be loaded. Close this and try again. | Couldn't load the orders. Close this and try again. |
| main `InvoiceDetailDialog.tsx:169` | Consignment number | TCS tracking number |
| main `InvoiceDetailDialog.tsx:181` | Defaults to the GST amount when you stamp the month. | Starts at the GST amount. |
| main `InvoiceDetailDialog.tsx:201` | No receipt uploaded yet. | No receipt added yet. |

### 3.15 Money: Expenses (main unless T)
| Where | Now | Proposed |
|---|---|---|
| `expenses/BurstSheet.tsx:306,315` | One card per expense. One save for all of them, or none. | One card per expense. Save adds them all together. |
| `BurstSheet.tsx:424` | One save for all rows. Photos are compressed before upload. | Save adds all rows. Photos are made smaller before saving. |
| `BurstSheet.tsx:179,181` | …or clear the Order cell, then save. | …or empty the Order box, then save. |
| `BurstSheet.tsx:605` | …reopen October in Month-end, then save again. | …reopen October in Month end, then save again. |
| T `ExpenseDialog.tsx:311-312` | Payee | Paid to |
| T `ExpenseDialog.tsx:415` | Tag to an order | Link to an order |
| T `ExpenseDialog.tsx:222` | Saved expense / Added expense | Expense saved / Expense added |
| `InputTax.tsx:50,56` | Paid, the bank debit / Cost in margin and P&L | Paid from the bank / Cost used for margin and profit |
| `ExpensesTab.tsx:124` | Add what was spent and it appears here. Small spends go in together with Add expenses. | Add what was spent. Use Add expenses to add many small ones at once. |
| `ExpensesTab.tsx:224-225` | aria "Edit Rent of 45000.5" | Edit Rent, PKR 45,000.50 |
| `RecurringDialog.tsx:21` | Use the form 2026-11 | Pick a month, for example Nov 2026 |
| `RecurringPanel.tsx:97` vs `RecurringDialog.tsx:91` | · paused vs Active (due each month) | · not active |
| `RecurringPanel.tsx:78` | The recurring expenses could not be loaded. | Couldn't load the monthly expenses. |
| T `monthEnd/model.ts:101-102`, main `settings/categoriesModel.ts:69` | Recurring templates… / expense or template uses | Monthly expenses… / expense or monthly expense uses |

### 3.16 Money: Month end, Match bank statement, Things to check, Margins (T unless main)
| Where | Now | Proposed |
|---|---|---|
| `monthEnd/ChecklistPage.tsx:147` | Tue 4 Nov: day 4 of the 10-day close window | Tue 4 Nov: day 4 of 10 to close the month |
| `ChecklistPage.tsx:175` (45-word tip) | Closing freezes payments, expenses and invoices dated in October. Bank matching and the TCS and FBR stamps stay open. You can reopen it any time; both are written to the audit log. An earlier open month with money in it is closed in the same step. | Closing locks October's payments, expenses and invoices. Bank matching and the TCS and FBR dates stay open. You can reopen it later. Earlier open months close too. |
| `ChecklistPage.tsx:256`, `model.ts:303`, main `MonthDialogs.tsx:74,81` | Closed through / Close through October | Closed up to / Close all months up to October |
| main `MonthDialogs.tsx:28,140` | Something went wrong. The month was not closed. Try again. | The month was not closed. Check your connection and try again. |
| main `MonthDialogs.tsx:173` | Saved with the reopen in the audit log. Leave it empty to skip. | Kept in this month's history. Optional. |
| `monthEnd/model.ts:71,194` | Items still in transit are expected. | Payments from the last few days may not be on the statement yet. |
| `model.ts:111-112,219` | Settled by the end of October, costs not marked complete. | Paid in full by end of October, costs not marked final. |
| `model.ts:129-132,236,487` | Payments not split / Counted in gross but not yet split into net and GST, because nobody has said whether GST is included in the order price. | Payments waiting for the GST answer / Counted in full, but not split into GST yet: nobody has said if GST is included. |
| `ReportPages.tsx:191,898` | excludes 2 unresolved | 2 left out (GST question not answered) |
| `ReportPages.tsx:201,287`, `model.ts:501` | Result less … not in the P&L / After drawings | Profit after owner's drawings |
| `ReportPages.tsx:223,230,259` | Basis / Shared by invoice | How worked out / Split by invoice |
| `ReportPages.tsx:229-230,245,296` | Payments received, gross / less GST inside the payments / not revenue / Net in / Where the net in went | Payments received, with GST / minus the GST in them / not income / Money in, before GST / Where the money went |
| `ReportPages.tsx:514` | Days | Days late |
| `ReportPages.tsx:567` | Payments are applied first in, first out to the oldest invoice of each order. | Each payment pays the oldest invoice of the order first. |
| `ReportPages.tsx:636-640`, `model.ts:682` | Committed / Committed, PKR / Owed, PKR (≈) / State; CSV "Owed, PKR (approx.)" | PO value / PO value, PKR / Still to pay, PKR (about) / Status |
| `ReportPages.tsx:666` | placed supplier orders on live orders | supplier orders sent, on open orders |
| `ReportPages.tsx:683-685` | Owed is approximate: the committed amount at the rate on or before X, less what was paid. … + settled (≈) − paid over | Still to pay is about: PO value at the rate on X, minus what we paid. |
| `ReportPages.tsx:796,799` | Output GST and input tax, side by side / Never netted on this page | GST we charged and GST we paid / Not subtracted here |
| `ReportPages.tsx:801` (29 words) | Input tax is the part of a Supplier payment, Clearing or Freight amount that Q-Tech can claim; the profit and loss and the margins use the amount without it. | Input tax is GST we paid and can claim back. Profit and margins leave it out. |
| `ReportPages.tsx:863,904,912`, `model.ts:830` | Net credited / Net cash credited to each person | Sales before GST, per person |
| `reportList.ts:13` vs `ReportPages.tsx:663,672,680` | We owe suppliers vs What we owe suppliers vs What we owe | We owe suppliers |
| `exceptions/ExceptionsPage.tsx:60` (49 words) | Checked, in every month: customer payments against the order total, invoices against the order, costs against the expected cost and the POs, dates in sequence, the GST on each invoice, the TCS trail and tax deposit, and orders where nobody has said whether GST is included in the price. | We check payments, invoices, costs, dates, GST, TCS and FBR for every month. |
| main `lib/reconciliation.ts:198,218,265,268` | Impossible value | Wrong amount |
| main `reconciliation.ts:207,224,252,255,289,300,304` | Dates out of sequence | Dates in the wrong order |
| main `reconciliation.ts:279` | GST ≠ 18% of net | GST is not 18% |
| main `reconciliation.ts:158,168,178` | Customer payments (1234567) exceed the order's gross (1200000) on ORD-0038 | Customer paid PKR 1,234,567, more than the order total PKR 1,200,000 (ORD-0038) |
| main `reconciliation.ts:198-304` | raw ISO dates ("2026-10-05") and raw amounts ("net 84500", "(-1500)") inside messages | format with formatDay() and PKR 1,234 |
| main `reconciliation.ts:293-295` | copy received / TCS sent / client received | copy received / sent by TCS / customer received |
| O `money/costs/MarginPanel.tsx:152` | Net sale less the costs paid so far. GST sits outside the margin on both sides, and expenses count at true cost, without recoverable input tax. It is final once costs are marked complete. | Sale before GST, minus costs paid so far (before GST). It is final once costs are marked final. |
| O `MarginPanel.tsx:193` | Margin if costs land as expected | Margin if costs come in as expected |
| O `MarginPanel.tsx:165,239` | The margin could not be read. Reload the page to try again. | Couldn't load the margin. Reload the page. |
| O `MarginPanel.tsx:131,138,143`, T `MarginsPage.tsx:37,161` | Costs marked complete / Costs complete / Could not change the costs mark | Costs marked final / Costs final / Couldn't change it |
| T `margins/MarginsPage.tsx:102` | Margin is the net sale less the expenses tagged to the order; GST is outside both sides. | Margin is the sale before GST, minus the order's costs before GST. |
| T `MarginsPage.tsx:53,147` | Net sale | Sale before GST |

### 3.17 Money: Reports (T)
| Where | Now | Proposed |
|---|---|---|
| `reports/ReportsPage.tsx:47`, `SalesReports.tsx:40` | …then enquiries and customers / Enquiries and customers | …then RFQs and customers / RFQs and customers |
| `reports/model.ts:75` | Some items priced | Partly priced |
| `SalesReports.tsx:147` | Won of decided | Win rate |
| `ReportsPage.tsx:204` | Could not load | Couldn't load this. Try again. |
| `SalesReports.tsx:123,179,227,297` | This report could not be read. Nothing was changed. | Couldn't load this report. Try again. |

### 3.18 Settings and exchange rates (main unless T or F)
| Where | Now | Proposed |
|---|---|---|
| `fx/ratesModel.ts:63` (50 words) | USD has not been updated for 35 days. A rate older than 30 days is unusable, so USD quotes show in USD only and are left out of price comparisons until someone adds a current rate. Fresh is up to 7 days, stale is 8 to 30. | The USD rate is 35 days old, too old to use. USD prices are not compared until someone adds today's rate. |
| `fx/ExchangeRatesPage.tsx:133` | Band | Status |
| `settings/CategoriesPage.tsx:81` | What an expense can be filed under. The order here is the order expenses offer them in; the group decides where reports place them. | The list of expense types. This order is the order you see when adding an expense. |
| `CategoriesPage.tsx:86` | Past expenses point to them. | Past expenses use them. |
| `settings/TargetsPage.tsx:112` | Fills 3 empty cells in Q4 2026 from Q3 2026. | Copies 3 missing targets into Oct to Dec 2026 from Jul to Sep. |
| `TargetsPage.tsx:120,217` | Net cash received per person… Achieved is net cash received and credited to the person in that quarter. On pace is the target spread evenly… | Money each person collected, before GST… "Where you should be" is the target spread evenly over the quarter. |
| `TargetsPage.tsx:150` | Achieved and on-pace figures could not be read | Couldn't load the figures |
| `settings/api.ts:65` | Something went wrong. Nothing was changed. Try again. | Couldn't save. Nothing was changed. Check your connection and try again. |
| `settings/api.ts:50` | That person does not exist. | That person was removed. Reload the page. |
| `settings/SettingsHomePage.tsx:58` | View | View company profile |
| `CompanyProfilePage.tsx:195` | As registered with SECP | As registered with SECP (keep, add to Words we use) |
| `fx/ExchangeRatesPage.tsx:233` | Use the bank's TT rate, or when the automatic update fails. | Use the bank's transfer (TT) rate, or when the automatic update fails. |

### 3.19 Messages we send (the customer or supplier reads them; main unless R)
| Where | Now | Proposed |
|---|---|---|
| `rfqs/lib/paymentReminder.ts:64-65` vs `chaseCommon.ts:40-41`, `supplierChase.ts:115-119`, `clarifications.ts:118`, `enquiryDraft.ts:179,182`, `purchaseOrders/lib/cancelText.ts:21` | Assalamu alaikum vs Assalam o Alaikum | One spelling (Assalam o Alaikum) |
| `rfqs/lib/enquiryDraft.ts:182` vs `chaseCommon.ts:40`, `paymentReminder.ts:65` | Dear Sir / Madam vs Dear Sir or Madam | Dear Sir or Madam |
| `enquiryDraft.ts:180` vs `:184`; `supplierChase.ts:123` vs `:124`; R `customerChase.ts:80` | (our ref X) / (our ref. X) / (ref X) | (our ref. X) |
| R `customerChase.ts:124,155` | If it is still live, please confirm… | If you still need it, please confirm… |
| `paymentReminder.ts:94` (29 words) | We request you to treat this as a priority and confirm the payment date by return. If there is a query on the invoice, or a document you are waiting for from us, please tell us today so that we can resolve it at once. | Please confirm the payment date today. If you have a question about the invoice, or need a document from us, tell us and we will sort it out at once. |
| `supplierChase.ts:171,178` (23 and 24 words) | …let us know today that you are unable to offer these items… a short note to that effect would be appreciated so that we can approach other sources. | …tell us today if you cannot offer these items, so we can ask others. |

### 3.20 Guides (`docs/guides/`)
T rewrote all three guides to the glossary. Only two old words are left: "NEW ENQUIRY" (`SALES.md:12`) and "The balance is gross, GST included." (`ADMIN.md:9`).

R also edits `SALES.md`, and still has "Tabs: All, Bids, Sourcing, Money" (`:7`) and "Unit price, net PKR" (`:35`). R's `ADMIN.md` and `ENGINEER.md` are the old main text (Receivables, Bank tick, Aging, Capture, Procurement legs, Bids).

When merging, take T's guides and re-apply R's RFQ-step lines. The guides should use the "Words we use" table below.

---

## 4. Cross-cutting patterns

### 4.1 Errors
- **Seven ways to say "couldn't load"** across the latest code: "Couldn't load" ×21, "did not load" ×17, "could not be read" ×15, "Could not load" ×8, "could not be loaded" ×6, "could not be found" ×4. **Use:** "Couldn't load X."
- **Thirteen versions of the reassurance line.** Examples: "Nothing was changed." ×23; "Nothing was changed. Check your connection and try again." ×12; "Nothing has changed. Check your connection, then try again." ×4 (settings); "Your changes are safe." (board); "Your invoices are safe. The server did not answer in time." (Invoices); "Your payments, expenses and ticks are safe; nothing was changed." (bank, reports). **Use:** "Nothing was changed. Check your connection and try again." Add "If it keeps failing, tell the admin." where money is involved.
- **"Something went wrong" ×6** (all main): `app/ErrorBoundary.tsx:42`, `lib/pgErrors.ts:84,121`, `money/monthEnd/MonthDialogs.tsx:28,140`, `settings/api.ts:65`.
- **Passive with no fix:** `lib/pgErrors.ts:119` "This change was refused. Nothing was saved." → "The app did not allow this change. Nothing was saved. Ask the admin." `pgErrors.ts:103` "A record this one points to no longer exists…" → "Something you picked was removed. Reload the page, pick again, then save."
- **Mixed contractions:** Could not ×55, Couldn't ×47, Couldn’t (curly) ×5, could not ×31. Can't ×13, Can’t ×1. Pick "Couldn't" and "Can't" with straight apostrophes for titles and toasts.

### 4.2 Symbols and abbreviations shown as words
- ×N for "times" or quantity: T ContextPane (×7 places), R ClarificationsPanel:212,396, R SuppliersAsked:70, O GoodsChaseDialog:169, O SplitLineDialog:111, O orders/api.ts:759,850, O poChange.ts:32-33, R reasons.ts:464.
- ≈ for "about": R SupplierReplies:200, R IssueQuotationDialog:493, O LegsPanel:255, O IssuePoDialog:306, main LastPriceChip:26, MemoryCard:60, O SupplierRecordPanels:119,179, T ReportPages:640,684, F status.ts:155, main orders/lib/ranking.ts:66.
- ~ : main lib/memory:280,293, main supplierSuggestion:178.
- ÷ and ≠: T TargetTile:90, main reconciliation.ts:279.
- d, min, h: T rules.ts:88-95, R ItemsPanel:103, main collision.ts:16,18.
- M for millions: T targetModel.ts:79 / TargetTile:53, R reasons.ts:163.
- Abbreviations: Qty (R ItemsEditor, R IssueQuotationDialog, O ConvertDialog, O OrderItemsPanel, O IssuePoDialog, PDFs), ref / Ref (section 2), e.g. (R IntakeScreen:617,686, R IssueQuotationDialog:555,613,616, main DateInput:97), est. (O SupplierRecordPanels:254,307), P&L (F SumBar:83, F status.ts:163, T ReportPages, main InputTax:56, main categoriesModel:23), CSV, PI (O LegsPanel:221), ea (O AddDialogs:93), Q3 (T TargetTile, main TargetsPage).
- Keep, but explain once with an (i): PKR, GST, FBR, PSID, TCS, NTN, STRN, SECP, IBAN, Incoterm, TT rate, RFQ, PO, PDF.

### 4.3 Numbers, rupees and dates
- **Paisa shown two ways.** Tables use `formatPaisa` ("45,000.50"). Toasts and dialog titles use `toLocaleString('en-US')` ("45,000.5"): T `ExpenseDialog.tsx:223`, main `ExpensesTab.tsx:85-86,255,271`, `RecurringPanel.tsx:45`, `CreateInvoiceDialog.tsx:146`, `RecordPaymentDialog.tsx:100`, `TargetsPage.tsx:362`, `bank/model.ts:128`. Also `orders/lib/convert.ts:45` uses en-GB with up to 4 decimals. **Use** `formatPaisa` or `formatAmount` everywhere.
- **Rs vs PKR:** O `SplitLineDialog.tsx:247` "Rs 1". Everything else says PKR.
- **Raw numbers:** T `TargetTile.tsx:58` (title), main `reconciliation.ts` messages, main `ExpensesTab.tsx:224-225` aria labels.
- **Column header style is mixed:** "Amount (PKR)", "Input tax (PKR)", "Unit price (PKR)", "Total (PKR)", "Value (PKR)" (parentheses) vs "Amount, PKR", "Gross, PKR", "Paid, PKR", "Rate, PKR" (comma). Pick one (suggest "Amount, PKR").
- **Dates are mostly good** ("Tue 4 Nov", "4 November" in messages). Exceptions: ISO dates in Things to check (`reconciliation.ts`), "Use the form 2026-11" (`RecurringDialog.tsx:21`), and a lowercase month in "e.g. 27 nov" and "e.g. 3 dec".
- Western grouping (1,234,567) is used throughout, by design. If the owner wants lakh (12,34,567), that is one change in `lib/money.ts:45`. Not a wording issue.

### 4.4 Sentences over 20 words on screen (counted between full stops)
49 T ExceptionsPage.tsx:60 · 32 R IntakeScreen.tsx:715 · 30 O CompaniesPage.tsx:110 · 29 T ReportPages.tsx:801 · 28 main fx/ratesModel.ts:63 · 25 T ReportPages.tsx:779 · 24 T ContextPane.tsx:579 · 24 T ContextPane.tsx:575 · 23 T monthEnd/model.ts:131 · 23 R ItemsPanel.tsx:234. Close to the limit: R CaptureSheet.tsx:476 (22), O OrderHeaderBlock.tsx:183 (20), O NewOrderDialog.tsx:116 (20), T ChecklistPage.tsx:86 (21). Replacements are in section 3. Long multi-sentence (i) tips: O IssuePoDialog.tsx:429 (47 words), T ChecklistPage.tsx:175 (45), T BankTickPage.tsx:171 (37).

### 4.5 Buttons that do not say what happens
R `PasteReply.tsx:182` "Read it" → "Read the prices". R `SupplierReplies.tsx:167,393` "Take back" → "Undo Can't quote". R `SupplierReplies.tsx:517` "Keep it" → "Keep USD". R `IntakeScreen.tsx:597` "Discard" → "Delete draft". R `IntakeScreen.tsx:768,852` "Save without asking" → "Save, ask suppliers later". main `SettingsHomePage.tsx:58` "View" → "View company profile". O `LegsPanel.tsx:240` "Re-issue PO" → "Revise PO". R `ClarificationParts.tsx:247` "Withdraw" → "Not needed". The other one-word buttons ("Open RFQ-0177", "Edit", "Set", "Record", "Change") already carry a reference or an aria-label and are fine.

### 4.6 Case, spelling and punctuation
- Sentence case is consistent. No Title Case labels were found apart from proper names and iOS's "Add to Home Screen".
- "Month end" vs "Month-end" vs "month-end" (section 2).
- Toast word order is mixed. Verb first: "Added expense", "Recorded payment", "Created invoice", "Saved invoice", "Deleted expense". Noun first: "Item added", "File added", "Reply saved", "PDF downloaded". **Use noun first.**
- Question titles: some lack "?" (R `CaptureParts.tsx:288,341`). Empty-state titles: some end with "." (T `ReminderPanel.tsx:50,59`).
- "Click" on a phone app: main `ItemsEditor.tsx:143`. Everything else says tap or press.
- British idioms ESL readers may not know: dearer, due a reminder, by return, still live, your call, silent, nudge, land as expected, close window, through (meaning "up to").

---

## 5. Words we use (proposed single vocabulary for the app, the PDFs, the messages and the guides)

"Use" is the word on screen. "Not" lists words to remove. Internal names (routes, enum values, DB columns, `leg`, `inquiry`, `float` in code) do not change.

### Requests and quotations
| Use | Meaning | Where | Not |
|---|---|---|---|
| RFQ | A customer's request for prices (request for quotation) | RFQs tab, New RFQ, Today, Paste or photo, reports | enquiry (on screen), board |
| New RFQ | Start an RFQ by pasting what the customer sent | RFQs, Companies, palette (N) | intake, Go to intake |
| Item | One product on an RFQ | RFQ page, New RFQ, messages | spec line, cell |
| Details | What the customer said about an item (model, size) | New RFQ | spec |
| Customer reference | The customer's own number for their request | New RFQ, RFQ header, quotation, search | customer ref, their ref, enquiry number |
| Quotation due | The date our quotation must reach the customer | New RFQ, RFQ header, Today | bid due |
| Top priority | Shows first in the RFQ list for everyone | New RFQ, RFQ list | — |
| Handled by | The salesperson who looks after an RFQ or order | RFQ list, RFQ header, order header | Owner |
| Questions | What we must ask the customer before quoting | RFQ page, Today, Paste or photo | clarifications |
| Asked by | Which supplier raised a question | RFQ questions | Raised by |
| Answers to send | The customer answered; send it on to the supplier | chips, Today | answers to relay, pass on |
| Not needed (question) | A question we no longer need answered | RFQ questions | Withdraw, Withdrawn |
| Quotation | Our price offer to the customer, with a PDF | RFQ page, Today tab "Quotations", reports | bid, quote (for ours) |
| Issue quotation | Make the quotation and its PDF; marks it sent | RFQ page | — |
| Revise quotation | Make a new version under the same number | RFQ page | Issue R2 |
| Revision 2 | The second version of a quotation or PO | quotations, POs | R2 (on screen) |
| Replaced | An older revision | quotations | Superseded |
| Quotation sent | Status once it went to the customer | chips, RFQ list | bid sent |
| Ready to quote | Prices are in; make the quotation | RFQ list, header | To quote, Covered |
| Mark won | The customer accepted; makes an order | RFQ page | — |
| Closed | The RFQ ended without an order, with a reason | RFQ list, reports ("lost" in reports is the same thing) | — |
| Close reasons | Lost to a competitor · Our price was too high · No reply to our questions · Customer cancelled · No supplier could supply · We were too late · Other reason | RFQ page, RFQ list, company page, reports | the other two lists |

### Suppliers and prices
| Use | Meaning | Where | Not |
|---|---|---|---|
| Ask suppliers | Send our price request to suppliers | RFQ page, New RFQ, Today | float, copy enquiry |
| Copy message for N suppliers | Copies one message to paste into WhatsApp or email; marks them asked | New RFQ, RFQ page | copy enquiry |
| Open in WhatsApp / Open in email | Opens WhatsApp or email with the message filled in; you press Send (owner decision 2026-10-20) | every copy-message button | — |
| Asked (on) | We sent a supplier our request (on that date) | RFQ page, Today, supplier page | Enquiry sent, enquiries, Sent |
| Times asked | How many times we asked a supplier | supplier page | enquiries |
| Not asked yet | Picked for this RFQ but not asked | New RFQ, RFQ page | Shortlisted, shortlist |
| Price | What a supplier tells us an item costs | everywhere on the supplier side | quote, quoted, offer, bid |
| Price received | The supplier sent a price | chips, supplier page | Quoted |
| Not sent to suppliers / Waiting for prices / Partly priced / All priced | Where the RFQ is with suppliers | chips, RFQ list, reports | Not floated, Out for offers, Covered, Some items priced |
| No price yet | Asked, nothing in yet | RFQ items | — |
| No supplier can supply | Every supplier asked said no (owner to confirm) | chip | No offer anywhere |
| Can't quote | A supplier said they cannot supply an item | RFQ page, supplier page, Today | No offer, Couldn't offer, cannot offer, regret |
| Recommended | The supplier price we suggest for an item | RFQ page, Mark won | rank 1, best-ranked |
| Lowest price | The cheapest price when there is no ranking | RFQ page | — |
| Lead time | How long the supplier needs to deliver | RFQ page, quotation, PO | — |
| Brands they sell | Brands a supplier can supply | supplier page, suggestions | brands carried, carries |
| Type of item | A group of similar items (valves, sensors) | brands, suggestions | family, product family |
| History | What we know about a supplier from past RFQs and orders | New RFQ, supplier page | Memory |
| From old CRM | Data brought over from the old system | chips, supplier page | Imported, legacy |

### Chasing and Today
| Use | Meaning | Where | Not |
|---|---|---|---|
| Today | Your list of what needs you now | main menu | — |
| Quotations / Suppliers & delivery / Money | Today's tabs | Today | Bids, Sourcing |
| Chase | Send a reminder to a customer or supplier | Today, RFQ page, orders | — |
| Copy and mark chased | Copy the message and record the chase | Today, RFQ page, orders | — |
| Payment reminder | A chase for money owed | Today, Who owes us | — |
| Waiting | Things you chased; they come back on a date | Today | — |
| Chase again on | The date an item comes back to Today | Today | Next nudge, nudge |
| Snooze | Hide an item from Today until a date | Today | — |
| Stronger wording | The message is firmer because it is late | Today, reminders | Firmer wording |
| Paste or photo | The C button: add text, photos or files from WhatsApp | top bar, phone | Capture, capture sheet |

### Orders and suppliers' orders
| Use | Meaning | Where | Not |
|---|---|---|---|
| Order | A customer's confirmed order to us | Orders tab | — |
| Customer PO | The customer's purchase order number for our order | order header, invoice, reminder | PO (alone) |
| Repeat a past order | Start a new order by copying an old one | Orders | New order |
| Line | One row on an order, invoice or PO | orders, invoices, POs | — |
| Supplier order | The part of an order we buy from one supplier, in one currency | order page, expenses, reports | leg, leg A, procurement leg |
| Add supplier | Add a supplier order to an order | order page | Add leg |
| PO | Our purchase order to a supplier | order page, PDF | — |
| Issue PO / Revise PO | Make the PO PDF / make a new revision | order page | Re-issue PO, R0, R2 |
| Mark ordered | Record that the supplier has our order | order page | Mark placed, placed, To place |
| PO not sent / Ordered / Late / Received by us / Partly delivered / Delivered to customer | Goods status | chips, order page | To source, To place, On order, n/a |
| No supplier yet | A line nobody has been chosen for | order page, Mark won | Not sourced yet, To source |
| Service | A line with no supplier (commissioning, service charge) | order page | — |
| Split line | Buy part of a line from a second supplier | order page | — |
| Commissioning | Our engineer installs and starts the equipment on site | order page, Today | — |
| Planned date / Mark done today | When commissioning happens / record it finished | order page, Today | — |
| Your job | An engineer's work on an order | order page, Today | — |
| Not needed | This order has no goods or commissioning step | chips | n/a |

### Money
| Use | Meaning | Where | Not |
|---|---|---|---|
| Money | The menu area for invoices, payments, expenses and month end | main menu | — |
| Who owes us | Customers' unpaid balances | Money, Today, roles | Receivables, Order balances |
| Before GST | An amount without GST | everywhere on screen | net |
| With GST | An amount including GST | everywhere on screen | gross |
| Balance | What a customer still owes, with GST | Who owes us, order page | — |
| Paid in full / Partly paid / Unpaid / Overdue | Payment status | chips, filters | Settled, Part paid |
| Paid so far | Money received on an order | Who owes us | Settled |
| Paid in advance | The customer paid before we invoiced | Overdue by age | Advance held |
| Record payment | Save money received from a customer | Who owes us, order page | — |
| Invoices & GST | The invoice list | Money tab, guides | GST register |
| Create invoice / Not invoiced / Partly invoiced / Fully invoiced | Invoicing | order page, chips | Part invoiced |
| Is GST included? | The old CRM did not say if prices include GST; someone must answer | order page, chips, checks | Price basis unknown, Basis unknown |
| TCS (i) | The courier company that takes the invoice to the customer | Invoices & GST | courier trail |
| FBR (i) | The tax office; the GST on our invoices is paid to FBR | Invoices & GST, Today | — |
| PSID (i) | FBR's payment slip number; one PSID can cover several invoices | Invoices & GST, bank | PSID group, PSID set |
| Mark (sent by TCS, GST paid) | Record a TCS or FBR step on ticked invoices | Invoices & GST | stamp |
| Input tax (i) | GST we paid on purchases that we can claim back (admin only) | expenses, reports | — |
| Expense / Category / Paid via (Bank, Cash) / Receipt photo | Money we spend | Expenses | Payee (use "Paid to") |
| Overheads / Order costs / Not in profit | Expense groups | Expenses, reports | Not in P&L |
| Monthly expense | An expense that repeats every month (rent, salaries) | Expenses, Month end | recurring template |
| Link to an order | Count an expense as a cost of an order | Expenses | Tag to an order |
| Margin | Sale before GST minus costs before GST | order page, Margins | — |
| Margin not final / Mark costs final | Costs may still come in / all costs are in | order page, Margins, Today | Provisional, Mark costs complete |
| Expected cost | What we think the order will cost us | order page | — |
| Month end | Checking and closing a month's money | Money tab | Month-end |
| Close the month / Reopen | Lock / unlock a month's payments, expenses and invoices | Month end | freeze, close window, close through |
| Match bank statement | Tick each line that is on the bank statement | Month end | bank tick |
| Things to check | Money records that do not add up | Month end | Exceptions |
| Serious | A check that needs fixing first | Things to check | critical |
| Reports | Monthly money reports plus RFQ and customer reports | Money | — |
| Profit and loss | Money in minus money out for a month | Reports | P&L |
| Owner's drawings | Money the owner takes out; not a business cost | Reports | drawings |
| Overdue by age | Unpaid invoices grouped by how late they are | Reports | Aging |
| We owe suppliers | What we still have to pay suppliers | Reports | payables, committed |
| PO value | What a PO is worth | We owe suppliers | Committed |
| Download for Excel | Save the table as a file Excel opens | tables, reports | Export, Export CSV |

### Companies, people and settings
| Use | Meaning | Where | Not |
|---|---|---|---|
| Company | A customer, a supplier, or both | Companies | — |
| Customer / Supplier / Customer and supplier | A company's role, set by what it does | chips, filters | Both, Customer & supplier |
| Prospect | A company that sent an RFQ but has not ordered yet | Companies, New RFQ | — |
| Site | A customer's location (plant, office) | Companies, RFQs, orders | — |
| Contact | A person at a company | Companies | — |
| Merge | Join two copies of the same company into one | company page (admin) | — |
| Admin / Sales / Engineer | Roles | Team | — |
| Company profile | Our legal name, address, tax numbers and terms for PDFs | Settings | Settings, Company |
| Exchange rate | PKR for 1 unit of a foreign currency | Settings, RFQ page | — |
| Up to date / Old / Too old to use | How fresh a rate is (up to 7 days / 8 to 30 / over 30) | Exchange rates, RFQ page | Fresh, Stale, Unusable, Band |
| Target | The money a salesperson should collect in a quarter, before GST | Today, Settings | — |
| On track / Ahead / Behind | Where you are against your target today | Today | on pace |
| Text size: Normal / Smaller | Bigger default text, or the old smaller size | account menu, Your details | — |
| NTN / STRN / SECP / IBAN (i) | Tax and bank registration numbers | Company profile | — |
| Incoterm (i) | Who pays for shipping and insurance (FOB, CIF…) | PO | — |

---

## 6. What still keeps the wording below 10 (after the branches merge)

1. 18 glossary leftovers (section 1). Each is a one-line change.
2. The second-tier jargon the glossary never named: net/gross/settled, source/sourced, placed, carries, shortlist, family, stamp, tick, spread, median, committed, PSID group/set, template, audit log, in transit, snapshot, memory, intake, board, split/cell, nudge. About 200 strings (232 matches, a few of them legitimate, such as "Split line").
3. One idea, several names: close reasons ×3, customer reference ×4, supplier "quote" vs our "quotation", Can't quote ×4 forms, Needs suppliers vs Not sent to suppliers, Partly vs Part, Settled vs Paid, Export vs Export CSV, GST register vs Invoices & GST, Revision 2 vs R2, critical vs serious, Month-end vs Month end, and the two styles of next step (states on RFQs, actions on Orders).
4. Symbols and short forms in place of words: ×, ≈, ~, ÷, ≠, 3d, 5 min, 3h, 1.2M, Qty, ref, e.g., est., P&L, PI, ea.
5. Errors: 7 phrasings of "couldn't load", 13 reassurance variants, 6 "Something went wrong", and four technical messages (Request GET, browser clipboard, read back, Supabase).
6. Number and date formats: toast amounts vs table amounts, Rs vs PKR, raw ISO dates and amounts in Things to check, "2026-11", raw numbers in the target tooltip, "(PKR)" vs ", PKR" headers.
7. Ten sentences over 20 words and three (i) tips over 35 words, mostly in Money and New RFQ.
8. Messages to customers and suppliers: two greeting spellings, two salutations, three reference styles, and some long British-formal sentences ("by return", "still live").
9. Guides: R's ADMIN and ENGINEER guides are the old text, and both R and T edit SALES.md.
