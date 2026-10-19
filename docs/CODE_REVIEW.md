# Code review (p9), 2026-10-19

Scope: every merge to main since 2026-10-14 in `src/features/{rfqs,orders,purchaseOrders,today,companies,capture,quotations,reports,fx,search}`, `src/app`, `src/ui`, `src/lib` and their tests. Money bookkeeping (`src/features/money/**`) and RLS/security had their own reviewers and are out of scope, apart from the one-line Undo change in two Money files (finding 6).

Method: each fix was made only after a test that fails against the merged main (68e9cae). All the tests below were re-run against 68e9cae with only the test files copied in, and every one of them failed there. They all pass on this branch. Fixes are minimal; nothing was refactored for style. No migration was added (0061 is still unused).

Severity: **High** means wrong data is saved or shown with no sign of it. **Medium** means a stale or contradictory screen, or a double write a person can trigger in normal use. **Low** means a narrow edge case.

## Fixed

### High

1. **Lakh-grouped prices were read as decimals.** In `rfqs/lib/replyParse.ts`, "Rs 1,25,000 each" became PKR 1.25 and "Rs. 1,00,00,000" became 1. The words lakh, lac and crore were ignored ("PKR 2.5 lakh" became 2.5). Fix: the amount patterns try the lakh-grouping form first, and the k suffix and `parseAmount` accept lakh/lac (×1e5) and crore (×1e7).
   Tests in `rfqs/lib/replyParse.test.ts`: *Pakistani (lakh) grouping and lakh / crore words > reads … as …, never as a decimal of it* (7 cases).
2. **The issue-quotation dialog and the company page shared one cache entry with two data shapes.** Both used `qk.companies.part(id,'contacts')`, but each stored a different row shape. Whichever loaded second showed the other's rows: the quotation lost the contact's job title, or the company page lost phone, email and site. Fix: `quotations/hooks.ts` `useCompanyContacts` reads with the companies' `listContacts` and maps the rows in `select`.
   Tests in `quotations/hooks.test.tsx`: *the issue dialog still gets the job title when the company page read the contacts first*; *the company page still gets phone, email and site when the issue dialog read the contacts first*.

### Medium: stale screens after a write (invalidation map)

3. **`src/features/invalidation.ts` and `queryKeys.ts`** (new `qk.orders.rankedFor(rfqId)` and `qk.orders.rankedAll()`). Tests are in `features/queryKeys.test.ts`, under *invalidation map: stale screens found in review*.

   | Write | Screen that stayed stale | Test |
   |---|---|---|
   | `rfq.close` ("Close as no reply" is on Today) | The Today list kept the closed RFQ. Customer history and Capture's RFQ list also stayed stale. | *closing an RFQ from Today ("Close as no reply") takes it off the Today list*; *closing an RFQ refreshes the customer history, which shows its outcome*; *closing an RFQ stops Capture offering it* |
   | `inquiry.add` ("ask more suppliers" on a Today item) | The Today list | *asking more suppliers from a Today item refreshes the Today list* |
   | `quote.save`, `inquiry.cantQuote`, `item.add`, `quotation.issue`, `fx.set` | The ranking in the Mark won and Split line dialogs (`qk.orders.ranked`, cached 30 s). A stale ranking could put a leg on the wrong supplier. | *saving a supplier price refreshes the Mark won ranking of that RFQ (and only that RFQ)*; *a hand-entered rate refreshes every Mark won ranking (they compare in PKR)*; *issuing a quotation refreshes the ranked quotes (they show the quoted selling price)* |
   | `order.update` | The customer history (order lifecycle and goods state) | *an order edit refreshes the customer history, which shows the order state* |
   | `company.merge` | Today, intake suppliers, price memory, POs and Money, which all still showed the dropped company | *a merge refreshes every read that shows the dropped company: Today, intake suppliers, memory, POs, money* |
   | `today.chase` | The supplier record and the invoice reminder fields in Money | *a chase from Today refreshes the supplier record and the invoice reminders Money shows* |
   | `po.issue` | The supplier record (leg PO and placed date) | *issuing a PO refreshes the supplier record (it shows the leg PO and placed date)* |

### Medium: Undo

4. **A failed Undo said "Undone."** In `ui/Toast.tsx`, a rejected `onUndo` became an unhandled rejection while the toast read "Undone.". Fix: the toast turns into a danger alert, "Could not undo" with the mapped error, and stays until dismissed.
   Test in `ui/Feedback.test.tsx`: *does not claim "Undone." when the undo write fails; it says it could not undo, as an alert*.
5. **Undo callers showed "Undone." beside their own "Could not undo".** 24 `onUndo` handlers caught their own error and raised a second toast. Each now lets the error through to the Toast. The files: rfqs (RfqHeaderBlock, ItemsPanel, IntakeScreen, ClarificationParts, ClarificationsPanel, SupplierReplies, SuppliersAsked, useAskSuppliers), orders (LegsPanel, OrderHeaderBlock, OrderItemsPanel, commissioningActions), capture (CaptureSheet), and Money (MarginPanel, GstRegisterPage: catch block only).
   Guard test in `ui/undoCallers.test.ts`: *no onUndo swallows its error with its own "Could not undo" toast (the Undo toast would still say "Undone.")*.
6. **Today's chase Undo could wipe out a colleague's chase.** The supplier, goods and payment chases restored the "before" stamp from the cached Today data, which can be hours old. Fix: `today/hooks.ts` `performChase` reads the stamp just before writing (new readers in `today/api.ts`).
   Tests in `today/hooks.test.tsx`: *performChase undo > a supplier / goods chase undo restores the stamp as it was at the tap…*; *a payment reminder undo restores the invoices as they were at the tap…*.

### Medium: double submit and retry

7. **A double tap on Chase recorded two chases.** In `rfqs/SuppliersAsked.tsx`, the copy ran before the stamp and the button was not busy meanwhile. Fix: a ref guard, and the button shows busy.
   Test in `SuppliersAsked.test.tsx`: *a double tap on Chase records one chase, not two*.
8. **A double tap on the copy buttons stamped twice.** In `rfqs/ClarificationsPanel.tsx`, Copy questions, Copy chase text and Copy answers each raised the ask count twice. Fix: a shared `once()` guard.
   Test in `ClarificationsPanel.test.tsx`: *a double tap on Copy chase text stamps the questions once, not twice*.
9. **A second tap asked the supplier twice.** Fix: a ref guard in `rfqs/useAskSuppliers.ts` `ask`.
   Test in `useAskSuppliers.test.tsx`: *a double tap asks the supplier once*.
10. **Enter saved a reply again while it was saving.** Fix: a `saving` guard in `rfqs/SupplierReplies.tsx` `doSave`.
    Test in `SupplierReplies.test.tsx`: *pressing Enter again while the reply is saving does not save it a second time*.
11. **Capture's "Try again" duplicated questions and notes.** If a file upload failed after the questions or the note were written, a retry wrote them again. Fix: `capture/CaptureSheet.tsx` uploads files first; uploads are remembered across a retry.
    Tests in `CaptureSheet.test.tsx`: *adds each question once when the file upload failed and Try again is pressed*; *appends the note once when the file upload failed and Try again is pressed*.
12. **Creating a company whose first contact failed lost the contact.** The retry hit 23505 on `companies_pkey`, which counted as "already saved", so the contact was never added. Fix: `companies/hooks.ts` `useCreateCompany` treats that 23505 as "created" and goes on to add the contact.
    Test in `companies/hooks.test.tsx`: *a retry after the company saved but its first contact failed adds the contact and refreshes the lists*.

### Medium: other

13. **Capture kept offering questions already answered.** `CaptureSheet` refreshed `qk.rfqs.capture()`, which builds `['rfqs','capture','']` and matches nothing, because the query is keyed by user id. Fix: refresh `qk.rfqs.capture(user.id)`.
    Test in `CaptureSheet.test.tsx`: *refetches the candidate list (answered questions must not be offered again)*.
14. **Capture start-up overwrote typed text.** `app/capture/CaptureProvider.tsx` checked "dirty" before the slow photo load, then overwrote what had been typed meanwhile. Fix: build the files first, then check dirty.
    Test in `CaptureProvider.test.tsx`: *does not overwrite what the person typed while the kept item was still loading*.
15. **An emptied quotation field came back on a re-issue.** `issue_quotation` coalesces with the previous revision, and the client sent `undefined` for an emptied delivery or terms field. Fix: `quotations/api.ts` sends `''` instead.
    Test in `quotations/api.test.ts`: *sends an emptied delivery, payment terms and standard terms as empty text…*.
16. **The issue dialog was a dead end when the price chips failed to load.** Fix: `IssueQuotationDialog.tsx` seeds the form with no chips when that read fails.
    Test in `IssueQuotationDialog.test.tsx`: *can still be issued when the price chips (customer_price_memory) fail to load*.
17. **The PO PDF rounded the unit price to 2 decimals.** Prices are stored to 4, so 10,000 × "0.13" was printed next to an amount of 1,250.00. Fix: `purchaseOrders/lib/prefill.ts` `unitPriceText`, used in `pdf/PurchaseOrderDocument.tsx`.
    Tests in `purchaseOrders/lib/prefill.test.ts`: *prints a sub-paisa unit price in full…*; *keeps two decimals and the grouping for an ordinary price*.
18. **Split line could create a duplicate leg for the same supplier and currency.** This happened on the "no quotes" path. Fix: `orders/lib/splitLine.ts` `supplierTargetProblem`; `SplitLineDialog.tsx` blocks the split and explains why.
    Tests in `orders/lib/splitLine.test.ts` (3).
19. **The ChaseGroup text went stale after a chase.** `rfqs/ClarificationsPanel.tsx` kept re-copying the first reminder after the ask count rose, and missed a phone number that loaded late. Fix: complete memo dependencies.
    Test in `ClarificationsPanel.test.tsx`: *rewrites the chase text when the ask count of the same questions goes up*.
20. **"Next in line" suggestions were wrong.** They could offer the RFQ's own customer, and never matched an item known only by its family. Fix: `SuppliersAsked.tsx` adds the customer to `askedIds`, and `FloatElsewhere.tsx` passes the item family.
    Tests: *never offers the customer the RFQ is for as the next supplier in line*; *finds the suppliers on the family shortlist for an item known only by its family* (`SuppliersAsked.test.tsx`); *suggests a supplier shortlisted for the item family…* (`FloatElsewhere.test.tsx`).
21. **A Today tab left open past midnight kept yesterday's reads.** Fix: `today/hooks.ts` `useTodayData` refreshes `qk.today.all` when the business date turns over.
    Test in `today/hooks.test.tsx`: *re-reads the board when the business date turns over (a tab left open across midnight)*.
22. **The draft footer promised the wrong return date for slow suppliers.** It always said 2 days; the rule waits max(2, the supplier's median + 1). Fix: `rules.ts` `supplierChaseBaseDays` is shared with `ContextPane.tsx` `nudgeInfo`.
    Tests in `today/nudgeInfo.test.ts` (2).
23. **On desktop, the designed "Moved to Waiting" state never showed.** Fix: `today/TodayScreen.tsx` `markCopied` selects the chased item.
    Test in `TodayScreenWide.test.tsx`: *keeps the chased first item (selected by default) in the pane once it moves to Waiting*.

24. **Network failures were not reported as network errors.** postgrest-js resolves a failed fetch as `{ code: '', message: 'TypeError: Failed to fetch' }`, not a throw, so people saw "Something went wrong" instead of the "trying again is safe" message. Fix: `lib/pgErrors.ts` maps that shape to `network`. The same change adds 42501 (`permission`, which no longer says "Try again"), PGRST116 (`not-found`), and no longer crashes on a P0001 whose message is not a string.
    Tests in `lib/pgErrors.test.ts` (4).
25. **A pasted file could land in the wrong place.** The page-wide paste listener in `ui/form/FileDrop.tsx` ignored open dialogs, so a screenshot pasted into the Capture sheet over an order page went into the order's files. Fix: skip the paste when it was already handled, or when a dialog is open and the drop zone is not inside it.
    Test in `ui/form/Files.test.tsx`: *a page drop zone ignores a paste while a dialog it is not in is open (the capture sheet takes it)*.
26. **NumberInput erased typed text on blur.** In `ui/form/NumberInput.tsx`, junk or below-min text was wiped when leaving the field. Fix: only an outside value change rewrites the text.
    Tests in `ui/form/Fields.test.tsx`: *leaving the field keeps typed text that is not a usable number (junk, or below min) on screen*; *still follows an outside change (form reset) after leaving the field*.
### Low

27. **The app's PO reference could have a different year from the PDF.** The app took the year from the latest revision; the PDF takes it from R0. Fix: `orders/api.ts` `listLegPos` and `purchaseOrders/api.ts` `getLegPo` return `firstIssuedOn`.
    Tests: *listLegPos keeps revision 0's issue date…* (`orders/api.test.ts`); *getLegPo returns the latest revision and the first issue date…* (`purchaseOrders/api.test.ts`).
28. **Legs and lead times went stale after a split.** Fix: `orders/hooks.ts` `useOrderLegs` shapes the legs from the current items in `select`.
    Test in `orders/hooks.test.tsx`: *orders the legs and picks their lead times from the items as they are now…*.
29. **The expected date after issuing a PO on an already-placed leg counted from today.** It should count from the placed date. Fix: `orders/lib/legModel.ts` `expectedAfterIssue`.
    Tests in `orders/lib/orders.test.ts`: *expected date after a PO is issued (O07)* (3).
30. **A yearless validity date already past this year came out as null.** Fix: `replyParse.ts` `dateFromText` uses next year.
    Test: *reads "valid till 15 Jan" sent in December as next January…*.
31. **A test that never reached its path.** In `today/rules.test.ts`, the reply-by test was passing through the cooldown path instead. Added *the reply-by date alone makes it due, even while the (slow supplier's) cooldown has not passed*.

32. **DateInput ignored a form reset after unreadable text.** Fix: `ui/form/DateInput.tsx` syncs whenever the value differs from what the field reported.
    Test in `Fields.test.tsx`: *after unreadable text, an outside change (form reset) still replaces it and clears the invalid mark*.
33. **The command palette reopened with the old query.** Fix: `ui/CommandPalette.tsx` clears the query whenever the palette closes.
    Test: *opens empty again after a row was opened or it was closed with Ctrl+K (no stale query)*.
34. **`resolveStatus('expense-group', 'non_pnl')` threw.** `non_pnl` is the value the database stores. Fix: an alias in `lib/status.ts`.
    Test in `lib/status.test.ts`: *expense-group reads the expense_categories.grp values the database stores (overhead, order_cost, non_pnl)*.

## Suspected, not proven (no change made)

- **ConvertDialog's "Not sourced yet" is silently overridden.** `convert_rfq_to_order` (0050) fills in the rank-1 quote line when no `quote_line_id` is sent, so the order gets a leg the person declined. Needs a migration (an explicit `unsourced` flag) or hiding the option.
- **`search_all` (0054) does not escape backslashes.** `replace(t,'\','\')` does nothing, so a `\` in the search text changes the ILIKE pattern. Needs a new migration that redefines `search_all`.
- **The customer and supplier chase waits disagree.** `rfqs/lib/clarifications.ts` `chaseDue` counts calendar days, while Today and `customerReturnsOn` count working days. So the RFQ panel can say "a chase is due" on a Monday when Today says Wednesday.
- **The orders ranking text has drifted from the RFQ one.** `orders/lib/ranking.ts` duplicates `rfqs/lib/ranking/reasons.ts`. `longReason` measures the gap against the rank-1 price, not the best price; inside the 2% band rank 1 can be the dearer line, giving "≈ PKR -2 above the best". The wording has drifted too.
- **Clearing "Addressed to" on a re-issue cannot clear the contact.** The RPC falls back to the previous or RFQ contact.
- **The "Last quoted" chip can show the wrong year.** It takes QT-YY from that revision's issue date, not R0's. Same pattern in `companies/supplierRecord.ts:278,331`.
- **A future-dated manual FX rate is accepted.** `v_fx_latest` ignores it until that day.
- **The merge dialog can be closed mid-merge with Escape.** It gets no `busy` prop.
- **The Issue PO dialog shows a pre-filled 0.125 as 0.13.** `NumberInput decimals={2}`; the stored value is unchanged.
- **`useLegPos` key omits `legIds` and `money`.** Its fetch depends on both.
- **Today's API reads that are not paginated or chunked.** `last_chased_by` is read without `fetchAll` (capped at 1,000 rows), and the `relayIds` `.in()` reads are not chunked.
- **Today's chase rules are ambiguous in two places.** The reply-by comparison is `<=`, and the bid-close wait reverts to 3 days once the bid date has passed.
- **A transparent PNG compressed to JPEG gets a black background.** `lib/imageCompress.ts`; canvas is not available in jsdom, so it could not be tested.
- **The share target accepts `image/*`.** The app takes only PNG, JPEG, HEIC and PDF, so WebP and GIF are refused with a banner.
- **The palette's `^ord` / `^inv` / `^rfq` match company names.** "Ordnance" or "Invicta" ranks the Orders or Invoices group first. Cosmetic.
- **`IntakeScreen` copy-and-float Undo also resets inquiries added in the same 10 s.**
- **"Customer since" takes its year from the UTC `created_at`.** Wrong for a company created at New Year in Pakistan time.
- **The 6-tab bar on a phone.** At 375 px each tab is about 62 px wide, and "Companies" does not wrap, so it may run into the next tab for admin and sales (`MobileChrome.tsx`).
- **`ErrorBoundary key={pathname}` remounts on every sub-path.** On the Money and Settings tabs, local state is lost and data refetches.
- **Combobox shows a blank input when its value is not in the current options.**
- **Ctrl+K opens the palette on top of an open dialog.** Shift+N and Shift+C also fire their shortcuts, unlike Capture's own C handler.
- **DataTable in virtual mode can lose its tab stop.** It happens when the focused row is scrolled out of the rendered window.
- **Data-layer notes.** The Today board key leaves out the user and role; that is safe only because sign-out clears the cache and Today always refetches when it opens. The report keys are never refreshed by a write; 30 s staleness is accepted.
