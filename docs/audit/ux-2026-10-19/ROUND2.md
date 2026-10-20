# Round 2 backlog (coordinator), 2026-10-20

Goal: every row of the UX audit at 10/10 (pass marks are in the artifact "What 10/10 means"). Sources: the coordinator's audit2 and review notes (summarised here).
Round 2 starts after these round-1 branches merge: ux/foundation, ux/rfqs, ux/orders, ux/money-today (plus ux/primitives, already merged).

## Adoption work waiting on round-1 merges
- [ ] Open in WhatsApp/email (feat/open-message): replace every copy-message site. The agent's report lists them.
- [ ] GST invoice PDF (feat/gst-invoice-pdf): invoice detail dialog, order page invoice cell, GST register row menu, BuyerTaxFields in the company edit form.
- [ ] PDF reading (feat/pdf-read): intake paste box + "Choose PDF", Capture shared PDFs, supplier reply paste (PasteReply), and replace the intake parser with enquiryParse.
- [ ] Payment correction (feat/payment-correction): Correct/Void actions on payment rows, dialog, Undo toast.
- [ ] In-app help (feat/in-app-help): account menu Help, palette "How do I…", Today first-run card, empty states.
- [ ] Phone platform (ux/phone-platform): the Back-closes-dialog hook in src/ui/Dialog.tsx and the sheets.
- [ ] Quotation pre-fill (owner-approved): lead time and terms. Do it in ux/rfqs if it fits, else in round 2.

## Accessibility (audit2/a11y.md)
- [ ] Single-key shortcuts (SC 2.1.4): add a setting to turn them off, or require Alt (PaletteHost.tsx:74-98, DataTable.tsx:274-288).
- [ ] Busy buttons and forms keep focus (aria-disabled while busy: Button.tsx:86, Form.tsx:33). On route change: move focus to h1, reset #main scroll, set the document title (AppShell.tsx:56-70).
- [ ] Dialogs fixed at 900/820/960px clip at zoom. Make them responsive (Issue quotation, Issue PO, Capture).
- [ ] Tables hide columns at zoom bands (board, orders): use cards earlier or keep key columns.
- [ ] Invisible focus on opacity-0 controls (ItemsEditor.tsx:83-87, BurstSheet.tsx:795-821). Add scroll-padding for sticky bars on #main.
- [ ] Toasts: one shared live region; don't re-announce the countdown (Toast.tsx:109-220).
- [ ] About 35 aria-labels on role-less elements: fix, and turn on strict axe (test/a11y-suite).
- [ ] Expose "Required" to screen readers; announce filter counts; arrow keys in RankedPicker and the Capture pickers; contrast of the selected SegmentedControl (worse on foundation).
- [ ] PDFs: language="en-GB" and minimum 9.5–10pt text.

## Foundation review leftovers (review/foundation.md #6, #7)
- [ ] Fixed tracks and leading-4 across features (ConvertDialog, BurstSheet, ItemsPanel, SupplierRecordPanels, RankedPicker, CaptureParts, ExpenseDialog, InputTax, TeamPage, MonthEnd*). These are also sent to the area agents.

## Data-entry burden (audit2/entry-burden.md), top savings beyond the owner decisions
- [ ] Selling-price chip from supplier price × the usual factor (admin/sales only). Ask the owner?
- [ ] Capture: don't default to "Answer a question" for new enquiries; allow creating a new customer from Capture.
- [ ] Wire the supplier-payment "still owed on the supplier order" pre-fill (LegsPanel.tsx:349 caller).
- [ ] Batch actions: bank matching, recurring expenses, Mark costs complete.
- [ ] Payment terms typed twice (quotation text vs Mark won days): pre-fill one from the other.
- [ ] Lose/close an RFQ from Today; one payment across several orders.
- [ ] Bank statement paste (reverses the 2026-10-14 "no CSV import"): ask the owner.

## Phone (audit2/phone-app.md) not in ux/phone-platform
- [ ] Android install nudge that mentions WhatsApp Share; clearer iPhone install hint (Chrome/Edge, sign in again inside the app, Share behind •••).
- [ ] iPhone Paste button in Capture; WebP/GIF accepted or converted.
- [ ] DateInput calendar button is 28px: make it 44 on touch.
- [ ] Drafts for other long forms (issue quotation, burst expenses).
- [ ] Owner action: mirror refresh_token_reuse_interval in the live dashboard. Run the R24 real-device test.

## Learnability (audit2/learnability-spec.md)
- [ ] First-use states for Today, the RFQ board and Orders (not "all done" for a brand-new person).
- [ ] 18 InfoTips listed in the spec.
- [ ] "Discard what you typed?" guard on dialogs; a server-error message table mapping 116 RPC errors to fixes, with a CI test.
- [ ] Undo for adding expenses, replies and rows; 10-second delayed delete instead of "Are you sure?" (3 places). Undo for Mark won and Create invoice needs a migration and the owner's OK.
- [ ] First-week checklist per role from existing records (Team page for the owner).
- [ ] Day-one test with two real staff (owner to arrange).

## Orders / money-today residuals (their self re-scores)
- [ ] Orders list: "Needs action / Waiting" switch; supplier name and days late in Next step.
- [ ] Order page: commissioning and margin panels still wordy.
- [ ] New RFQ from a supplier page: pre-select the supplier (intake ?supplier=).
- [ ] Main-bar counts mean "needs you" everywhere (useNavCounts).

## Pending audits
- [ ] performance.md, copy.md, round2-spec.md (statuses ≤35, counts, search, shortcuts sheet, page template).
- [ ] The screen-audit rig baseline (test/screen-audit), then re-measure after round 1.
- [ ] Verification findings: test/money-verify, test/workflow-verify, test/roles-verify. Bugs here are fixed BEFORE any new UX work.

## Wording (round2/copy.md): main 4.5/10, about 6.5 after the round-1 branches
- [ ] Apply the "Words we use" table (about 120 terms) app-wide, plus the guides and the in-app help. Coordinator decisions under the owner's plain-words mandate: net / gross / settled become "before GST" / "with GST" / "paid in full"; supplier side uses "price" (not "quote") and "Can't quote" everywhere; one name for the customer reference ("Customer ref").
- [ ] One list of RFQ close reasons (rfqs/lib/closeDefaults.ts is the source; board model and SitesPanel read it).
- [ ] Error messages: one "Couldn't load …" pattern with the fix, no "Something went wrong", no technical text (OrderDetailScreen "Request GET …", clipboard, "read back", "Supabase address"). Use the server-error table from the learnability spec.
- [ ] No symbols for words (×, ≈, ~, ÷, ≠, 3d, 1.2M); one money format (PKR 45,000.50 everywhere, toasts included); dates formatted, never ISO; no "Use the form 2026-11".
- [ ] Sentences on screen ≤ 20 words (ExceptionsPage.tsx:60, IntakeScreen.tsx:715 and 8 more).
- [ ] Message templates: one greeting spelling, "Dear Sir or Madam", "(our ref X)".
- [ ] Merge note: take ux/money-today's SALES.md; ADMIN/ENGINEER guides are refreshed in the final docs pass.

## Speed (round2/performance.md): 4/10 on a mid-range Android over 4G
In progress: perf/db (RLS policy wrap, >1,000-row correctness, matching prefilter, audit growth, month-end exempt bug), perf/client (non-blocking saves, bundle, logos, honest CI budget), ux/phone-platform (persisted cache, offline, preconnect, loading screen).
Round 2 after the merges:
- [ ] Take the Today load out of the shell. Nav counts get a light count RPC, not about 25 requests on every screen (useNavCounts).
- [ ] Flatten the order page's waterfall (legs don't wait for items); month end fetches its snapshot once (not 6 times); the RFQ page batches supplier-memory RPCs per item.
- [ ] Issue quotation/PO in the background (PDF render off the critical path).
- [ ] Switch client .in() id lists to the server-side RPCs from perf/db (call sites listed in its report).
- [ ] Cap the history-growing reads (Today, RFQ value column, company counts, Orders list) with server-side limits and ordering.
- [ ] order.update must refresh the Margin panel (invalidation map).
- [ ] Target: Lighthouse mobile ≥95 on /login and on the main screens; under 1 second to a usable screen on repeat opens.
