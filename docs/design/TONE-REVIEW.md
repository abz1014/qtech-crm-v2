# Tone review: making Q-Tech CRM read like a business system

For: the owner, to approve before any text is changed.

**Approved 13 Nov 2026:** the owner accepted the tone guide and all 5 recommended answers in section 5 ("Accept all 5"): printed documents in scope as a small separate change; help pages reworded with each screen; mostly impersonal, "your" only for the person's own things; "chase" becomes "Follow up"; "RFQ" in the app, "enquiry" only in customer-facing letters.
Read from: the live code (origin/main, 7b458c9f), 13 Nov 2026. Nothing has been changed yet.

## In short

The app is already disciplined in some ways. There are no exclamation marks, no emoji, no "Oops" and no jokes
anywhere in the screens. The casual feel comes from something quieter:

- everyday spoken words ("chase", "nudge", "Nobody owes it", "cash in the box", "by hand", "Got it")
- talking to the reader ("you", "your", "Nothing needs you today") and asking them questions ("Did you send it?")
- shortened forms ("Couldn't", "can't", "You're"), mixed with the full forms on the next screen
- two or three names for the same thing ("New enquiry" in the menu, "New RFQ" on the page)
- long explanations packed into one sentence, with semicolons and brackets
- a few outgoing messages to suppliers that open with "Hi hope you are doing well,"

Printed documents (quotation, invoice, challan, PO, service report, credit note) are already formal. They need only
small fixes.

---

## 1. What is casual today

Counts are of on-screen text only (code comments, tests and the developer gallery are left out). The app has about
10,500 pieces of on-screen text in total, plus 80 help pages.

### 1.1 Talking to the reader ("you", "your", "we")
About **380 strings in 145 files** use "you/your", and **140 strings** use "we/us/our". Another 75 uses in help.
Some are fine ("Enter your password"). Many make the system sound like a person chatting.
- `src/features/today/TodayScreen.tsx:222` "Nothing needs you today"
- `src/features/money/expenses/MyClaimsPage.tsx:99` "Money you paid yourself for work. The office pays you back once it is approved, now or a little later."

### 1.2 Spoken, homely words
- "chase / chased / nudge": **110 strings in 27 files**. `src/features/today/text.ts:16` "... next nudge on {date}";
  `src/features/today/SnoozeMenu.tsx:72` "Not ours to chase".
- "owes / nobody / someone": **109 strings in 57 files**. `src/features/money/monthEnd/ReportPages.tsx:534`
  "Nobody owes it: refund it or keep it."; `src/features/settings/BackupsPage.tsx:181` "A backup nobody can open is not a backup."
- "box / money in / money out / by hand / by itself / shows up": **about 100 strings**.
  `src/features/money/expenses/CashInHand.tsx:187` "Cash in the box, PKR"; `src/app/pages/OfflinePage.tsx:79`
  "Q-Tech opens by itself as soon as there is signal."
- "Got it" buttons: `src/features/help/HowItWorksCard.tsx:87`, `src/features/settings/InstallBanner.tsx:63`.

### 1.3 Shortened forms (contractions), used inconsistently
**186 strings in 100 files**. The same message is written both ways: "Couldn't ..." 66 times and "Could not ..." 164
times; "can't" 36 times and "cannot" 52 times. The apostrophe is also typed two ways (140 straight, 46 curly).
- `src/ui/form/Form.tsx:97` "Couldn't save" next to `src/features/jobs/EngineerActions.tsx:308` "Could not save the note"
- `src/app/pages/OfflinePage.tsx:17` "You're offline"

### 1.4 Questions as headings and help steps
**38 headings or labels** in the app and **51 question fragments** in help.
- `src/features/rfqs/SentConfirm.tsx:53` "Did you send it?"; `src/features/money/monthEnd/ReportParts.tsx:18` "Why two profits?";
  `src/features/money/expenses/QuickAdd.tsx:244` "Paying a supplier?"; `src/features/help/HowItWorksCard.tsx:59` "New here?"
- Help: `docs/help/approve-claims.md:13` "Not right? Tap [Not approved…]"; `docs/help/add-to-job.md:15` "Tip: Wrong guess? Tap ..."

### 1.5 Two names for one thing
- New enquiry (menu, `src/app/shell/AppShell.tsx:67`) and New RFQ (page, `src/features/rfqs/IntakeScreen.tsx:932`,
  empty states in `src/features/help/firstUseCopy.ts:35`). "enquiry" appears 82 times, "RFQ" 164 times.
- Month lock: the owner's word is **Lock/Reopen**, but **19 strings** still say "closed month":
  `src/features/money/expenseReport/ExpenseReportPage.tsx:195` "Closed: figures frozen";
  `src/features/money/expenses/ExpensesTab.tsx:371` "Locked: the month is closed".
- Staff money: "I paid", "claim", "Owed to staff", "what people paid" for the same thing (37 strings, 11 files).
  `src/features/money/expenses/MyClaimsPage.tsx:32`, `src/features/money/expenses/OwedToStaff.tsx:33`.
- "Client received" (`src/features/money/invoices/InvoiceDetailDialog.tsx:434`) where everywhere else says customer.
- "quote" for a supplier price 17 times beside "quotation" 168 times (`src/lib/errors/rpcMessages.ts:116`).

### 1.6 Over-long explanations in one breath
**63 strings over 160 characters**, **78 with semicolons**, **159 with long brackets**.
- `src/features/companies/CompaniesPage.tsx:140` "Nobody sets a role by hand. An RFQ or an order makes a company a customer (a prospect until it orders); asking it for prices ..."
- `src/features/money/payments/HeldAdvancesPanel.tsx:31` "Paid on an order that was cancelled before it was invoiced. Nobody owes this, so it is not counted above and never reminded. Refund it (void the payment on the ..."

### 1.7 Phone and gesture words
"tap" in **17 strings** and **299 times in help**; "signal" 13; "phone" where "device" is meant.
- `src/app/shell/UpdateNeededBanner.tsx:35` "Update needed — tap Reload"
- `src/features/jobs/EngineerActions.tsx:42` "Needs signal to save. Your typing is kept."

### 1.8 Casual messages to suppliers and customers
The copy-to-WhatsApp texts are mostly formal ("Kindly confirm by ..."), with one clear exception:
- `src/features/purchaseOrders/lib/cancelText.ts:23` "Hi hope you are doing well,"
- `src/features/purchaseOrders/lib/cancelText.ts:28` "... so we can sort it out together. Sorry for the trouble, and thank you for your understanding."

### 1.9 Mixed capitals on document titles
"Sales Tax Invoice", "Delivery Challan", "Service Report", "Credit Note" in Title Case on the print, "Sales tax invoice"
and "Credit note" in sentence case on screen (19 strings, 13 files). `src/features/money/invoices/pdf/InvoiceDocument.tsx:134`,
`src/features/orders/challans/pdf/ChallanDocument.tsx:20`.

---

## 2. Proposed tone guide (15 rules)

1. **Short, neutral, business-like.** Write as a well-run office writes a notice, not as a colleague talks.
2. **Fact first, then the action.** "Payment 12 days overdue. Send a reminder." Not "Looks like they still owe you".
3. **Sentence case** for screens, buttons and headings ("Lock a month", not "Lock A Month").
   Printed document titles stay in capitals as a deliberate style: QUOTATION, SALES TAX INVOICE, DELIVERY CHALLAN.
4. **No exclamation marks, emoji, jokes, sayings or apologies** ("sorry", "unfortunately") on screens.
5. **No contractions.** "Could not", "cannot", "is not". One straight apostrophe style throughout.
6. **Address the reader only when an instruction needs it.** Prefer the impersonal: "No tasks for today", not
   "Nothing needs you today". Keep "your" for the signed-in person's own things (your password, your claims).
7. **Headings are statements, not questions.** "Confirm the message was sent", not "Did you send it?".
   Dialog titles that ask for a decision may stay a question: "Delete RFQ-0177?".
8. **Buttons are verb + object.** "Send reminder", "Lock March 2026", "Approve claim". Never "OK", "Got it", "Yes".
   "Done" and "Close" only to close a panel.
9. **Errors** have two parts: what did not happen, then what to do.
   "The invoice was not saved. Check the connection and try again." No blame, no "Oops", no "Something went wrong" alone.
10. **Empty states** have two parts: what is empty, then how it fills.
    "No RFQs yet. An RFQ is created when a customer asks for a price." Optional button: "New RFQ".
11. **Success messages (toasts)** are the record and the past tense: "Quotation QT-26-0042 issued". No "Done!" or "All set".
12. **One sentence, one idea.** Aim for under 25 words. No semicolons on screens; split into two sentences.
    Long explanations move to the "About" panel or to help.
13. **Device-neutral verbs.** "Select", "Choose", "Open" instead of "tap" and "click". "No connection" instead of "no signal".
14. **Numbers and money** follow the existing rules: "PKR 125,000", never "Rs"; "Job 139"; dates as "13 Nov 2026".
15. **One word per thing** (glossary below). A retired word may stay only in help search keywords.

### Glossary: one word per thing

| Use | Do not use | Meaning |
|---|---|---|
| RFQ | enquiry, inquiry (in the app) | A customer's request for a price. On customer-facing text "your enquiry" is acceptable. |
| Job | — | The whole piece of work under one number: "Job 139". |
| Order | job (for this meaning) | What the customer confirmed with a PO. |
| Customer | client | The company that buys from Q-Tech. |
| Company | — | Any customer or supplier record on the Companies page. |
| Supplier | vendor, principal | The company Q-Tech buys from. |
| Supplier price | quote, their quote, offer | A price a supplier sent. |
| Quotation | quote, offer, bid | Q-Tech's priced offer to the customer. |
| Purchase order (PO) | supplier order (as a document) | Q-Tech's order to a supplier. |
| Invoice / Sales tax invoice | bill (for a sale) | What Q-Tech charges the customer. |
| Credit note | refund note | Reduces an issued invoice. |
| Delivery challan | DC, delivery note | The goods-delivered document. "Challan" in tables. |
| Expense | cost (for an entry), bill | Money the business spent. |
| Claim | I paid (for the item), owed to staff | Money a staff member paid and asks back. The page may keep the name "I paid". |
| Lock / Reopen (a month) | close, closed, unlock, freeze | Stops changes to a month's figures. |
| Follow up / Send reminder | chase, nudge | Asking a customer or supplier again. |
| Delete | remove (for records) | Record is gone. "Remove" only for taking an item off a list. |
| To collect / Payable to suppliers | owes, owed, we owe | Balances due in and out. |

---

## 3. Before and after (50 examples)

### To do rows (`src/features/today/rules.ts`)
| # | Where | Before | After |
|---|---|---|---|
| 1 | rules.ts:202 | Chase customer for clarifications | Follow up with customer: questions open |
| 2 | rules.ts:203 | Customer chased | Customer followed up |
| 3 | rules.ts:317 | Chase supplier for a price | Follow up with supplier: price awaited |
| 4 | rules.ts:497 | Supplier chased for goods | Supplier followed up on delivery |
| 5 | rules.ts:1078 | I paid: {n} to approve | Staff claims: {n} awaiting approval |
| 6 | rules.ts:1115 | Backup is {age} days old: check GitHub | Last backup {age} days ago. Check the backup service. |
| 7 | rules.ts:1137 | Free plan {x}% full | Storage at {x}% of the plan limit |
| 8 | text.ts:16 | ... next nudge on {date} | ... next reminder on {date} |
| 9 | SnoozeMenu.tsx:72 | Not ours to chase | Handled by another team member |
| 10 | TodayScreen.tsx:222 | Nothing needs you today | No tasks for today |

### Empty states
| # | Where | Before | After |
|---|---|---|---|
| 11 | firstUseCopy.ts:33 | Your work shows up here | Your tasks appear here |
| 12 | firstUseCopy.ts:45 | Nothing needs you yet | No tasks yet |
| 13 | firstUseCopy.ts:83 | Just you so far | No other users yet |
| 14 | firstUseCopy.ts:54 | An RFQ is a customer asking for a price. Paste their message and the app splits it into items. | An RFQ is a customer's request for a price. Paste the customer's message to list its items. |
| 15 | ExceptionsPage.tsx:125 | All clear | No mistakes found |
| 16 | MyClaimsPage.tsx:220 | What you send shows here, with whether it was approved. | Submitted claims and their approval status appear here. |
| 17 | TodayScreen.tsx:231 | Chases, quotations, goods and payments that need you will appear here. | Follow-ups, quotations, deliveries and payments due appear here. |

### Errors and toasts
| # | Where | Before | After |
|---|---|---|---|
| 18 | Form.tsx:97 | Couldn't save | Not saved |
| 19 | MyClaimsPage.tsx:216 | Couldn't load your claims | Claims could not be loaded |
| 20 | imageText.ts:134 | Couldn't read this clearly — {what}. | The image is not clear enough to read {what}. |
| 21 | SignInPage.tsx:111 | Can't reach the server | Server not reachable |
| 22 | orders/api.ts:380 | Someone else changed this order. Reload to see their changes. | This order was changed by another user. Reload to see the changes. |
| 23 | QuickAdd.tsx:216 | {msg} Nothing was saved; what you typed is still here. | {msg} Nothing was saved. The entered details are kept. |
| 24 | rpcMessages.ts:92 (message only) | A quotation can't carry a price of 0. Enter the price ... or untick it. | A quotation cannot include a price of 0. Enter the price ... or clear the tick. |
| 25 | QuickAdd.tsx:186 | Tap what it was for. | Select a category. |
| 26 | CashInHand.tsx:198 | Short by PKR 500. Check for a cash expense not recorded yet; the difference is kept with this count. | Short by PKR 500. Check for an unrecorded cash expense. The difference is saved with this count. |

### Buttons
| # | Where | Before | After |
|---|---|---|---|
| 27 | HowItWorksCard.tsx:87 | Got it | Dismiss |
| 28 | InstallBanner.tsx:63 | Got it | Dismiss |
| 29 | MessageActions / oneName | Copy and mark chased | Copy and record follow-up |
| 30 | nextStep.ts:75 | Chase the payment | Send payment reminder |
| 31 | GoodsChaseDialog.tsx:133 | Chase the goods | Follow up on delivery |
| 32 | IntakeParts.tsx:34 | Save for later (don't ask suppliers yet) | Save as draft |
| 33 | AppShell.tsx:67 | New enquiry | New RFQ |

### Dialogs and confirmations
| # | Where | Before | After |
|---|---|---|---|
| 34 | SentConfirm.tsx:53 | Did you send it? | Confirm the message was sent |
| 35 | dialogImpl.tsx:24 | Discard what you typed? | Discard unsaved changes? |
| 36 | TeamDialogs.tsx:396 | You can't deactivate the only active admin | The only active admin cannot be deactivated |
| 37 | companies/api.ts:879 | This {noun} is used on {list}; it can't be removed. | This {noun} is used on {list} and cannot be deleted. |
| 38 | teamModel.ts:49 | If this person is ever locked out, nobody in the app can reset the password. Add a second admin so someone always can. | With one admin, a lost password cannot be reset. Add a second admin. |

### Help pages (`docs/help`)
| # | Where | Before | After |
|---|---|---|---|
| 39 | approve-claims.md:13 | Not right? Tap [Not approved…], say why, then [Not approved]. | To reject a claim, select [Not approved…], enter the reason, then [Not approved]. |
| 40 | add-to-job.md:15 | Tip: Wrong guess? Tap [Supplier price], [Customer answer] ... | Note: If the type is wrong, select [Supplier price], [Customer answer] ... |
| 41 | add-expenses.md:14 | Many receipts at once? Tap [Add expenses] ... | For several receipts, select [Add expenses] ... |

### Sign-in and system pages
| # | Where | Before | After |
|---|---|---|---|
| 42 | OfflinePage.tsx:17 | You're offline / Showing what's saved; changes need signal. | No connection. Saved records are shown. Changes need a connection. |
| 43 | OfflinePage.tsx:79 | You're still signed in. Q-Tech opens by itself as soon as there is signal. | You are still signed in. Q-Tech CRM reopens when the connection returns. |
| 44 | SignInPage.tsx:83 | Your shared item is safe | Shared item kept on this device |
| 45 | UpdateNeededBanner.tsx:35 | Update needed — tap Reload | Update required. Select Reload. |

### Money pages
| # | Where | Before | After |
|---|---|---|---|
| 46 | CashInHand.tsx:187 | Cash in the box, PKR | Cash in hand, PKR |
| 47 | ReportPages.tsx:534 | . Nobody owes it: refund it or keep it. | . No balance is due on it. Refund or retain it. |
| 48 | ExpenseReportPage.tsx:195 | Closed: figures frozen | Locked: figures final |
| 49 | ExpensesTab.tsx:371 | Locked: the month is closed | Locked month |
| 50 | ReportParts.tsx:18 | Why two profits? | Profit on invoices and profit on cash |
| 51 | BackupsPage.tsx:181 | A backup nobody can open is not a backup. Once a month, download ... | Test the backup once a month: download ... |

### Engineer screens (no prices, totals or PO numbers shown, as now)
| # | Where | Before | After |
|---|---|---|---|
| 52 | MyClaimsPage.tsx:99 | Money you paid yourself for work. The office pays you back once it is approved, now or a little later. | Work expenses paid from your own pocket. Repaid after approval. |
| 53 | EngineerActions.tsx:42 | Needs signal to save. Your typing is kept. | No connection. The note is kept and can be saved later. |
| 54 | nextStep.ts:71 | Delivered. The office takes it from here | Delivered. Next steps are with the office. |
| 55 | nextStep.ts:66 | The goods are late: the office is chasing the supplier | Goods delayed. The office is following up with the supplier. |

### Printed and customer-facing (affects customers and suppliers)
These leave the building. Change only with owner approval.
| # | Where | Before | After |
|---|---|---|---|
| P1 | cancelText.ts:23 | Hi hope you are doing well, | Dear Sir/Madam, |
| P2 | cancelText.ts:28 | ... please let us know so we can sort it out together. Sorry for the trouble, and thank you for your understanding. | ... please inform us so that the matter can be settled. We regret the inconvenience and thank you for your cooperation. |
| P3 | InvoiceDocument.tsx:134 / 116 | Sales Tax Invoice (print) and Sales tax invoice (screen) | SALES TAX INVOICE on the print; "Sales tax invoice" on screen |
| P4 | ChallanDocument.tsx:20, ServiceReportDocument.tsx:21, CreditNoteDocument.tsx:78 | Delivery Challan / Service Report / Credit Note | DELIVERY CHALLAN / SERVICE REPORT / CREDIT NOTE |
| P5 | QuotationDocument.tsx:199 | Our RFQ | Our reference |
| P6 | QuotationDocument.tsx:152 | Preview, not issued yet | DRAFT – NOT ISSUED |
| P7 | statement/pdf/StatementDocument.tsx:180 | {n}. {title} — Qty: {q} | {n}. {title}, Qty {q} |

The rest of the printed text (terms, "Received the goods listed above in good order and condition", PO terms,
reminder letters with "Kindly confirm by ...") is already formal and should stay.

---

## 4. Scope estimate

- **On-screen text in the app:** about 10,500 strings (labels, sentences, messages) across about 600 files.
  Estimated to change: **1,000 to 1,500 strings** (roughly 1 in 8), plus about **50 of the 80 help pages**.
- **Where most of it is:** Money (about 3,100 strings: `money/monthEnd/ReportPages.tsx`, `monthEnd/model.ts`,
  `expenseReport`, `inOut`, `invoices`, `expenses`), RFQs (1,400: `rfqs/IntakeScreen.tsx`, `SupplierReplies.tsx`,
  `ranking/reasons.ts`), Orders (950), Settings (950), To do (570: `today/ContextPane.tsx`, `today/rules.ts`),
  Jobs (500: `jobs/lib/nextStep.ts`, `StageSections.tsx`), History labels (230, `history/labels.ts`).
- **Printed documents:** 7 builders (quotation, invoice, credit note, challan, PO, service report, comparative statement)
  plus 6 message builders (supplier, customer and goods follow-ups, payment reminder, PO cancel, enquiry draft).
  Few changes needed (section 3, P1 to P7).

### What must NOT change, or must change together

- **Server error patterns.** In `src/lib/errors/rpcMessages.ts` each entry's `match:` pattern matches the database's
  own text. Only the `message:` wording may change. `rpcMessages.test.ts` scans the migrations and fails if a match breaks.
- **Help page ids and [Labels].** File names in `docs/help` are ids used by `help:` links in code; keep them.
  Every [Label] in a help page must equal an on-screen label (`labelSync.test.ts`), so a renamed button needs the
  help pages renamed in the same change.
- **The word lists in tests.** `src/features/help/oneName.test.ts` keeps one name per action (for example
  "Copy and mark chased", "Chase again", "We owe suppliers", "Lock a month"), and `recipeWords.test.ts` lists retired words.
  Changing "chase" to "follow up" means updating both lists in the same change.
- **End-to-end tests.** About 3,000 text checks in 125 test files under `e2e/`, and about 110 unit test files, look
  for exact on-screen words. Each wording change must update its tests in the same change. This is most of the work.
- **Stored values.** Status codes, category keys (`src/lib/categories/dictionary.ts`) and anything saved in the database
  stay as they are; only what the screen shows changes. Help search `keywords:` lines keep old words on purpose.
- **Owner rules stay:** PKR never Rs; "Job 139"; engineers never see prices, totals, PO numbers or payment status;
  Lock/Reopen for months.

Suggested order: glossary terms first (one change per term, with its tests), then To do and empty states, then
errors and toasts, then money pages, then help, then printed documents last and separately.

---

## 5. Questions for the owner

1. **Are printed documents and outgoing messages in scope?**
   Recommended: yes, but only the small list P1 to P7, done as a separate change you check on paper first.
   They are already formal; the PO cancellation message is the one that needs fixing now.

2. **Are help pages in scope?**
   Recommended: yes, in the same change as the screen they describe, because help must use the exact button names.

3. **Keep "you", or go fully impersonal?**
   Recommended: mostly impersonal. Keep "you/your" only for the signed-in person's own items and direct
   instructions ("Enter your password", "Your claims"). Remove it from status lines and empty states.

4. **"Chase" or "Follow up"?**
   Recommended: "Follow up" in the app, "Send reminder" for payments. "Chase" is common office talk in Pakistan,
   so if you prefer it, keep it and fix only the rest; this is the biggest single change (110 strings).

5. **"RFQ" or "Enquiry" inside the app?**
   Recommended: "RFQ" on every screen and button (it is already used twice as often), and "enquiry" only in
   letters to customers and suppliers ("your enquiry", "our enquiry").
