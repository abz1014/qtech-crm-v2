# Q-Tech CRM v2: learnability spec (from 4/10 to 10/10)

Read-only design spec, 2026-10-20. Nothing in the repo was changed.

**Sources read.** `origin/main` at 33d10e7 and the in-progress branches `origin/ux/foundation`, `origin/ux/rfqs`, `origin/ux/orders` and `origin/ux/money-today` (read with `git show` and `git grep`). The audit is `docs/audit/ux-2026-10-19/navigation.md` §4, which scored "Learnability (new, non-technical user)" at 4/10 because of "31 screens, about 41 dialogs, 2–4 names per action ... and the one-page guides already disagree with the labels". Also read: `docs/DATA_MODEL.md` (§2, §4, §10), `docs/guides/*.md` on main, ux/rfqs and ux/money-today, `docs/SUPABASE.md`, `docs/HOSTING.md`, `src/ui/{InfoTip,EmptyState,Toast,useToast,Dialog}.tsx`, `src/lib/pgErrors.ts`, `src/app/palette/PaletteHost.tsx`, `src/app/shell/AccountMenu.tsx`, and every `onUndo`, `EmptyState` and `InfoTip` call site on the branches.

**Rules this spec keeps.**
- It costs $0: no new dependency, no third-party tour or analytics service. The CSP allows only `'self'` plus the Supabase origin, so third-party scripts would be refused anyway.
- No modal tours, coach marks or auto-opened dialogs. Nothing ever sits between a person and their work.
- No new data entry and no new logging of people (memory rule "minimal logging"). Progress and "stuck" signals are worked out from records the business already keeps.
- New files are preferred. Edits to the files the ux branches are rewriting (TodayScreen, BoardPage, OrdersListPage, RfqHeaderBlock, OrderHeaderBlock) are limited to one line each.

**Effort scale**, for one worker including tests: **S** is half a day or less, **M** is 1 to 3 days, **L** is more than 3 days.

---

## 0. Where we start, and what "10/10" means here

| Step | Learnability | Why |
|---|---|---|
| Audit, 2026-10-19 | 4/10 | Many screens and dialogs, 2 to 4 names per action, guides that drift from the labels, silent dead ends. |
| After the four ux branches merge (estimate) | about 6.5/10 | Plain words (glossary), 5 tabs, Money on 2 levels, one green button per RFQ and order page (`rfqs/lib/nextAction.ts`, `orders/lib/primaryAction.ts`, which already carries a `why` line), a "Next step" column on the lists, the New RFQ draft and leave guard (`rfqs/lib/intakeDraftStore.ts`, `useLeaveGuard.ts`), 24 InfoTips, and the guides rewritten. |
| After this spec | 10/10 target | The items below, plus a **day-one test** with a real new hire (§5.4). The last point is earned only by passing that test, not by shipping code. |

**Operational definition of 10/10.** A new sales engineer or engineer gets a login and a phone, and nobody sits next to them. Within their first session they complete their role's first three checklist tasks (§5.1). Over the first week they finish the rest. They ask the owner at most two questions, and every question is about the business, not about the app.

One finding blocks guide sync already: `docs/guides/SALES.md` is rewritten on **both** ux/rfqs and ux/money-today, and the two versions use different labels:

| ux/rfqs SALES.md | ux/money-today SALES.md |
|---|---|
| Today tabs "Bids, Sourcing" | "Quotations, Suppliers & delivery" |
| "Copy and mark chased" | "Copy message and mark chased" |
| "Mark quotation sent" | "Quotation sent" |
| "Order balances" | "Who owes us" |
| "Paste reply" | "Paste what they sent" |

Whichever merges second has to reconcile them by hand. The label-sync test in §2.5 exists so this cannot happen again unnoticed.

---

## 1. First run, per role

### 1.1 The rule

- **Detect a "new person", not an "empty account".** After the import the company has data, but a sales engineer hired next month owns nothing.
- Today on ux/money-today tells a new person "Nothing needs you today" in the green "done" mood (`TodayScreen.tsx:159`).
- The RFQ board tells them "None of your RFQs are open. Nice." (`BoardPage.tsx:180`, ux/rfqs).
- The Orders list tells them "Every order is done or cancelled" (`OrdersListPage.tsx:230`, ux/orders).

All three praise someone who has not started. A first-use state must instead say what the screen is for and offer **one** button: the next action.

**Detection: `useFirstUse()`.** One cheap head-count per question, run only when a list is already empty (`enabled` is set only in the empty branch), cached for 10 minutes:

| Question | Query (all already readable by the role, §10 of DATA_MODEL) |
|---|---|
| Has this person ever owned an RFQ? | `rfqs` count where `owner_id = me` (open or closed) |
| Has this person ever owned an order? | `orders` count where `owner_id = me` |
| Has this engineer ever been put on a job? | `order_engineers` count where `user_id = me` |
| Does the company have any invoice or payment? (admin and sales) | `invoices` count (head) |
| Is the owner alone on the team? (admin) | `users` count where `deactivated_at is null` |

### 1.2 First-use states (one button each)

The copy lives in one new file, so a writer can change the words without touching any screen.

| Screen and role | Condition | Title | Body (≤ 2 lines) | The one button |
|---|---|---|---|---|
| Today, sales | owns no RFQ and no order | Your work shows up here | Today lists customers to chase, suppliers to ask and quotations due. It fills up once you log your first RFQ. | **New RFQ** → `/rfqs/new` |
| Today, engineer | never on a job | Your jobs show up here | When an order needs you on site, the admin adds you to it and it appears here with its date. You can already save a site photo or note to any RFQ or order. | **Paste or photo** (opens Capture) |
| Today, admin | company has no invoice, or the owner is alone | Nothing needs you yet | Today lists payments to chase, invoices to send and month-end checks. | Owner alone: **Add a person**. Otherwise **Open Money** |
| RFQs board, Mine | owns no RFQ ever | No RFQs of yours yet | An RFQ is a customer asking for a price. Paste their message and the app splits it into items. Everyone's RFQs: *link* "See everyone's (N)". | **New RFQ** |
| Orders list, sales | owns no order ever | No orders of yours yet | Orders start when you mark an RFQ won. You never type an order from scratch. | **Open RFQs** |
| Orders list, engineer | never on a job | No jobs yet | Orders you are put on appear here with the site and the date. | **Show everyone's (N)** (keep the existing button) |
| Who owes us | company has no invoice | Nobody owes anything yet | Once an order is invoiced, what the customer still owes shows here, with a reminder when it is late. | **Open Orders** |
| Expenses (admin) | no expense this month, none ever | No expenses yet | Add bills as they are paid: amount, category, done. Many at once is fine. | **Add expenses** (it has no button today, `ExpensesTab.tsx:123`) |
| Team (admin) | owner alone | Just you so far | Add the people who will use the app. Each one sees only what their role needs. | **Add person** |
| Paste or photo sheet | first open on this device | (one line under the title) | Paste a message or add a photo, pick the RFQ or order it belongs to, then Save. | (none; the sheet is the action) |

The "filter matched nothing" and "all done" states that already exist stay as they are. They are correct once the person has data.

**Files**
- New: `src/features/onboarding/useFirstUse.ts`, `src/features/onboarding/firstUseCopy.ts`, `src/features/onboarding/FirstUseState.tsx` (wraps `EmptyState` with `bordered`, mood `neutral` and one primary button), `src/features/onboarding/useFirstUse.test.tsx`.
- New gallery scenes: `src/dev/gallery/onboarding.tsx`, plus one line in `src/dev/gallery/sceneList.ts` so `e2e/gallery.visual.spec.ts` gets baselines.
- One-line edits that swap in `<FirstUseState screen=… />` before the existing empty branch: `today/TodayScreen.tsx`, `rfqs/board/BoardPage.tsx`, `orders/OrdersListPage.tsx`, `money/payments/ReceivablesPage.tsx`, `money/expenses/ExpensesTab.tsx`, `settings/TeamPage.tsx`, `capture/CaptureSheet.tsx`.

**Effort:** M. **Impact:** +0.5.

### 1.3 "How this works" card per role (optional, dismissible, never blocking)

**Where.** On Today, above the list.
- Desktop: a card about 120 px tall.
- Phone: one collapsed row, "New here? How Q-Tech CRM works · 4 steps", which expands on tap. The audit already complained that the phone list starts too far down (S5), so it must not push the list further.

**Contents.** Each step is one line with a "Show me" link. "Show me" opens the matching Help recipe in the Help panel (§2.2), never an overlay.

| Sales (4) | Engineer (3) | Admin (5) |
|---|---|---|
| 1. A customer asks for prices: **New RFQ**, paste their message. | 1. **Today** lists your site jobs and their dates. | 1. **Who owes us**: record payments, send reminders. |
| 2. **Ask suppliers**: one message, copied into WhatsApp. | 2. On site, **Paste or photo** saves a photo or note to the RFQ or order. No forms. | 2. **Invoices & GST**: create invoices, mark TCS and FBR. |
| 3. Prices come in: paste their reply, and the app compares them in PKR. | 3. One tap when done: **Delivered today**, **Mark done today**. Wrong tap? **Undo**. | 3. **Expenses**: add many at once. |
| 4. **Issue quotation** sends the PDF. Today reminds you to chase until it is won or lost. | | 4. **Month end** lists only what needs fixing, then **Close**. |
| | | 5. **Team**: add people. Each sees only their role's screens. |

**Buttons:** "Got it" (hides the card) and "Open Help".

**Remembering it.**
- Per person on the device, in localStorage `qtech.howItWorks.<person id>` = `dismissed`. This follows the existing convention (`qtech.channel.<id>`, `qtech.text-size`).
- It is *not* cleared on sign-out (`src/lib/capture/forget.ts`), because it holds nothing sensitive.
- It also hides itself once the person's first-week checklist is complete (§5.1), or 14 days after `users.created_at`. Either way it does not come back on a new phone for someone who is no longer new.
- Help has a "Show 'How this works' again" link.

**Optional cross-device upgrade (no migration):** store the flag in the person's own Supabase auth `user_metadata` through `supabase.auth.updateUser({ data })`. The app already calls `updateUser` for passwords (`settings/api.ts:142`). It is a UI preference only and must never be read by row-level security.

**Files**
- New: `src/features/onboarding/HowItWorksCard.tsx`, `src/features/onboarding/howItWorks.ts` (steps per role, each with a Help recipe id), `src/features/onboarding/useDismissed.ts`, and tests.
- One line in `today/TodayScreen.tsx` (header slot).

**Effort:** S/M. **Impact:** +0.25.

---

## 2. In-context help

### 2.1 Where one-line explanations are still missing

There are 24 `<InfoTip>` uses on the ux branches today. Examples:
- ux/money-today: "About TCS, FBR and PSID", "About closing a month", "About reminders".
- ux/rfqs: "How are prices compared?", "How is this list ordered?".
- ux/orders: "How the order is made", "What issuing does".

Form fields already have a visible `help=` line (for example "Customer reference ... Search finds the RFQ by it." in `IntakeScreen.tsx:616`, ux/rfqs).

**Rule:** fields use `help=`. InfoTip is for headings, figures, chips and column headers.

The gaps, all files with zero InfoTips today:

| Screen | Element | InfoTip label | One line |
|---|---|---|---|
| Today (`TodayScreen.tsx`) | "Waiting" group header | About Waiting | Things you chased. Each comes back here on its date if nobody has answered. |
| Today (`ContextPane.tsx`) | Snooze button | About snooze | Hides this item until the day you pick. Only for you. |
| Today (`TargetTile.tsx`) | target title | About your target | Money received this quarter on your orders, without GST. Set by the admin. |
| RFQs board (`BoardPage.tsx`) | "Next step" column header | About next steps | Needs suppliers → Waiting for prices → Ready to quote → Quotation sent → Won or closed. |
| New RFQ (`IntakeParts.tsx`) | "Quotation due" | (field `help=`) | The customer's deadline for our quotation. Today warns you two days before. |
| RFQ page (`ClarificationsPanel.tsx`) | "Open questions" heading | About questions | A supplier asked something the customer must answer. Copy the questions, then send each supplier the answers. |
| Issue quotation (`IssueQuotationDialog.tsx`) | dialog title / Issue button | What issuing does | It gets a number and a PDF and cannot be edited. You can always Revise it; the first one stays on record. |
| Paste or photo sheet (`CaptureSheet.tsx`) | "What should we do with it?" | About Paste or photo | Saves a photo, PDF or message to an RFQ or order. Nothing else to fill in. |
| Order page (`OrderHeaderBlock.tsx`) | "Next step" box | (show the existing `why`) | `primaryAction.ts` already writes a `why` ("Order the goods from X"). Show it under the green button on every width. |
| Order page (`LegsPanel.tsx`) | "Supplier orders" heading | About supplier orders | One supplier's part of this order: their PO, when it was placed, received and delivered. |
| Order page (`ResolveBasisDialog.tsx`) | "Is GST included?" | About this question | Old orders did not say whether prices included GST. Your answer fixes the totals; it is asked once. |
| Mark won (`ConvertDialog.tsx`) | "Payment terms in days" | (field `help=`) | Days the customer has to pay after the invoice. Who owes us marks it late after that. |
| Record payment (`RecordPaymentDialog.tsx`) | "Paid via" | (field `help=`) | Bank payments are matched to the bank statement at month end; cash is not. |
| Expenses (`ExpenseDialog.tsx`, `BurstSheet.tsx`, `InputTax.tsx`) | "Paid via", "Input tax" | About input tax | GST on a bill that we can claim back. Leave 0 if unsure. |
| Who owes us (`ReceivablesPage.tsx`) | "Balance" column | About the balance | What the customer still owes, GST included, after payments recorded. |
| Team (`TeamDialogs.tsx`) | "Role" field | (field `help=`) | Admin: everything. Sales: RFQs, orders, invoices, no costs. Engineer: RFQs and orders, no money. |
| Exchange rates (`ExchangeRatesPage.tsx`) | page title | About rates | Updated every night. Used only to compare supplier prices in PKR, never for invoices. |
| Targets (`TargetsPage.tsx`) | page title | About targets | Per person, per quarter, in net cash received (GST excluded). |

**Effort:** S (strings only, about 20 call sites). **Impact:** +0.25.

### 2.2 One Help entry: account menu, palette and Today card

**Entry points**
- **Account menu:** a new "Help" item (icon `CircleHelp`) above Settings, in `src/app/shell/AccountMenu.tsx` on ux/foundation (one `MenuItem`).
- **Palette:** a "How do I…" group.
  - With an empty query it shows the 3 recipes for the current screen. With a query it searches recipe titles and steps.
  - It is registered from a new `HelpProvider` through the existing `usePaletteSource()` (`src/app/palette/usePalette.ts`), so `PaletteHost.tsx` is not edited.
  - Typing "help" or "how" lists every recipe for the person's role.
- **Optional key:** `?` opens Help, added beside N, C and G T. Not needed for v1.
- **Today card:** "Show me" links and "Open Help" (§1.3).

**The panel**
- `?help=<recipe-id>` in the URL opens it, so the browser and phone back button closes it and a recipe can be linked from anywhere: first-use states, error toasts, the stuck message.
- Desktop (≥ 1024 px): a **non-modal** right-side panel, 400 px. No focus trap, so the page stays usable and the person can follow the steps while doing them.
- Phone: a full-height sheet with the one-bar back arrow (`useMobileBar`).
- Contents, top to bottom:
  1. A search box.
  2. "For this screen" (recipes whose `screens:` match the current path).
  3. "Your first week" progress (§5.1).
  4. All recipes for the person's role. "Show other roles" is a toggle; admin sees all.
  5. A recipe view: the steps, with UI labels drawn as non-interactive chips.
  6. At the foot: "Still stuck? Message the owner" (§5.3).

**Files**
- New: `src/features/help/HelpProvider.tsx` (open state from the search parameter, palette source, lazy-loads the panel), `src/features/help/HelpPanel.tsx`, `src/features/help/useHelp.ts` (`openHelp(id?)`).
- One line in `src/app/shell/AppShell.tsx`: wrap with `HelpProvider` inside `PaletteHost`.
- One `MenuItem` in `AccountMenu.tsx`.

The panel is a lazy chunk. The three guides are about 3 KB each, so the 300 KB gzip budget for initial JS (`scripts/bundle-budget.mjs`) is untouched.

**Effort:** M. **Impact:** +0.75 (with §2.3 to §2.5).

### 2.3 Recipes come from docs/guides, rendered in-app from markdown

The guides become the single source.
- Each stays a printable one-pager.
- Each section becomes a "How do I…" recipe with at most 6 steps.
- Metadata sits in HTML comments, so GitHub and print never show it.

```markdown
# Sales

## How do I log a new enquiry?
<!-- id: new-rfq; roles: sales, admin; screens: /rfqs, /rfqs/new -->
1. Tap [RFQs], then [New RFQ]. Or tap [Paste or photo] with the customer's message.
2. Pick the company. Type their reference if they gave one.
3. Paste what they sent. It splits into items.
4. Tap [Looks right: find suppliers].
Tip: Left halfway? [Continue your draft] brings it back.
```

**Recipe set, derived from the current guides**

| Role | Recipe ids |
|---|---|
| Sales | `today-chase`, `new-rfq`, `ask-suppliers`, `supplier-prices`, `issue-quotation`, `revise-quotation`, `mark-won`, `close-lost`, `create-invoice`, `payment-reminder`, `repeat-order`, `find-old-rfq`, `snooze`, `whatsapp-or-email` |
| Engineer | `today-jobs`, `paste-or-photo`, `site-question`, `goods-delivered`, `commissioning-done`, `change-planned-date`, `something-wrong` |
| Admin | `record-payment`, `remove-payment` (§3.1), `add-expenses`, `pay-supplier`, `create-invoice`, `tcs-fbr`, `month-end-close`, `match-bank`, `reports`, `add-person`, `reset-password`, `deactivate`. Backups stay in ADMIN.md but are tagged `roles: owner` and hidden in-app. |

**Renderer, with no new dependency**
- `package.json` has no markdown library. The guides need only headings, numbered steps, "Tip:" lines, `**bold**` and `[Label]` chips.
- A roughly 80-line parser plus renderer that builds React elements (never `dangerouslySetInnerHTML`) is enough. It is CSP-safe and cannot inject HTML.
- The files are loaded with Vite `import sales from '../../../docs/guides/SALES.md?raw'`.
- New files: `src/features/help/recipes.ts` (parse and index), `src/features/help/RecipeView.tsx`, `src/features/help/recipes.test.ts`.

**Effort:** S/M. Restructuring the three guides is S, done after ux/rfqs and ux/money-today merge.

### 2.4 Context: which recipes a screen shows

These come from the `screens:` route prefixes in the guide comments. **No feature file registers anything**, so a new screen gets help by editing markdown only.

Errors can also point at a recipe. The `rpcMessages` table in §3.4 carries an optional `help` id, and the error toast then shows "How to fix" as its action.

### 2.5 Kept in sync with the UI labels (the guard the audit asked for)

Four Vitest checks, in the style of `src/ui/undoCallers.test.ts`, which already reads source files from disk. New file: `src/features/help/guideSync.test.ts`.

1. **Labels exist.** Every `[Label]` in `docs/guides/*.md` appears verbatim as a string or JSX text in a non-test, non-dev file under `src/`.
   - `N`, `<month>` and `<day>` in a label match a number, a month or a day, so "[Copy message for N suppliers]" matches the template literal on ux/rfqs.
   - A failure prints the guide line and the closest source strings.
2. **Short.** At most 6 steps per recipe and at most 25 words per step.
3. **Coverage.** Every primary action label must be the subject of at least one recipe. That covers the labels in `rfqs/lib/nextAction.ts`, `orders/lib/primaryAction.ts` ("Issue PO", "Delivered today", "Mark done today", "Create invoice", "Record payment", "Is GST included?"), the Today copy labels and `CAPTURE_LABEL`. A new green button therefore cannot ship without help.
4. **Links resolve.** Every recipe id named in code (`howItWorks.ts`, `firstWeek.ts`, `rpcMessages.ts`, first-use copy) exists in a guide.

**Effort:** S. **Impact:** included in §2.2. This is what stops the drift found in §0 from coming back.

---

## 3. Safety nets that make learning less scary

### 3.1 Undo coverage

**The Undo toast already works well** (`src/ui/Toast.tsx`, `useToast.ts`):
- A 10-second window, which pauses on hover or focus.
- Ctrl/⌘+Z works while the window is open.
- The toast changes to the past tense when the window closes ("Floated to 4 suppliers").
- "Could not undo" turns the toast into an error, guarded by `undoCallers.test.ts`.
- `onSettle` exists for deferred commits.

**Has Undo today (main plus the ux branches), about 30 actions**

| Area | Actions |
|---|---|
| Paste or photo | Save (`CaptureSheet.tsx:231,307`) |
| RFQs | Copy and mark floated/asked (`IntakeScreen.tsx`, `useAskSuppliers.ts:67`); supplier chase (`SuppliersAsked.tsx`); Can't quote, per supplier and per item; reply removed; mark quotation sent; Close and Reopen (`RfqHeaderBlock.tsx`); clarifications: questions copied, answers copied, answer saved, answered with photo, withdrawn |
| Today | Copy and mark chased/reminded; Closed from Today; Snooze (`ContextPane.tsx`) |
| Orders | Cancel and reopen; Exempt from GST; commissioning done and planned date; leg dates placed, received and delivered (`LegsPanel.tsx`, `useLegActions.ts` on ux/orders); goods chase |
| Money | GST register stamps: TCS, PSID, deposited (`GstRegisterPage.tsx`); costs complete (`MarginPanel.tsx`) |
| Settings | Copy targets; remove target |

**Should get Undo (priority order)**

| # | Action | How | Effort |
|---|---|---|---|
| 1 | **Record payment** (admin) | It has no Undo, no edit and no delete in the UI. A mistyped amount cannot be fixed by anyone in the app (`payments/api.ts` has only `recordPayment`), though admin has SIUD on `payments_in` in the database. Add Undo that deletes the row by its client-generated id. After the window, add "Remove payment" in the order's Payment cell (admin, open month only; the month lock already applies), with its own Undo. New recipe `remove-payment`. | S |
| 2 | **Add expense / Add expenses** (burst) | Undo deletes the inserted ids (admin has D on `expenses`). | S |
| 3 | **Delete expense, delete file, remove site/contact** | Replace the confirm dialogs ("Delete this expense?" `ExpensesTab.tsx:265`, "Delete this file?" `FileBits.tsx:114`, Remove in `CompanyParts.tsx:149`) with a **deferred delete**. The row hides at once and the real delete runs in `onSettle`. A deferred delete fails safe: if the tab closes inside the window, nothing is deleted. New helper: `src/ui/useDeferredDelete.ts`. | S |
| 4 | **Save reply / Accept N prices** | Undo restores the previous lines (`restoreQuoteLine` exists in `rfqs/api.ts`). "Take back" stays for later. | S |
| 5 | **Add supplier (leg), add line, add or remove engineer, add RFQ item** | Undo deletes the new row, or re-inserts the removed one. | S |
| 6 | **Mark won (Create order)** | Sales cannot delete orders (§10). Needs a small definer RPC `undo_new_order(order_id)`: creator only, under 15 minutes, no PO, invoice, payment or expense attached. Until it exists, the toast offers "Cancel order" instead. | M, migration, owner approval |
| 7 | **Create invoice** | `next_invoice_number()` reads max+1 from the data (`0044_invoice_number_series.sql`), so deleting the newest invoice returns its number to the series with no gap. RPC `undo_new_invoice(id)`: creator, under 15 minutes, still the highest number in its series, no stamps, month open. | M, migration, owner approval |

**Kept without Undo, on purpose (the safety net is a reverse path, said in the UI)**

| Action | Reverse path | Change |
|---|---|---|
| Issue quotation / Issue PO | **Revise** (R1, R2 …); the snapshot is locked by `lock_issued_document` | The dialog says "You can revise it later. The first one stays on record." This lowers the fear at the riskiest-looking button. |
| Close month | **Reopen** (logged) | Keep the confirm. |
| Deactivate person | **Reactivate** | Keep the confirm. |
| Merge companies | none | Keep the confirm. It is the only truly irreversible business action. |
| Reset password | none (the old password stops working) | Keep the confirm. |

**Files:** `src/ui/useDeferredDelete.ts` (new) plus small edits in `RecordPaymentDialog.tsx`, `payments/api.ts` (+`deletePayment`), `ExpensesTab.tsx`, `BurstSheet.tsx`, `FileBits.tsx`, `CompanyParts.tsx`, `SupplierReplies.tsx`, `AddDialogs.tsx`. Rows 6 and 7 need a new migration `supabase/migrations/00xx_undo_recent.sql` with pgTAP tests.

**Effort:** S for rows 1 to 5, M for rows 6 and 7. **Impact:** +0.5.

### 3.2 Confirmations only for what cannot be undone

Add this policy to `docs/DESIGN_SYSTEM.md` §13 ("Writing in the interface"). Confirm only when one of these is true:
- (a) nobody can reverse the action in the app (merge, reset password);
- (b) it changes accounting or access state for everyone (close month, deactivate);
- (c) the dialog needs input anyway (the cancel reason).

Everything else happens at once with an Undo toast. Never ask "Are you sure?" for a reversible action. Applying the policy removes 3 confirms (§3.1 row 3) and adds none.

### 3.3 Drafts: nobody loses typing

| Where | Today | Change |
|---|---|---|
| New RFQ | Draft kept on the device for 7 days, "Continue your draft", leave guard (ux/rfqs) | none |
| Paste or photo | IndexedDB draft (`src/lib/capture/store.ts`) | none |
| **Every dialog with a form** | `Dialog.tsx` holds Esc and scrim clicks only while `busy`. A stray tap outside throws away typed prices, rows or a pasted reply. | Add a `dirty` prop. When the form has changes, Esc and the scrim do nothing. Cancel or ✕ shows an inline bar, "Discard what you typed? [Keep editing] [Discard]", with focus on Keep editing. `useSubmitForm` already computes dirtiness for `src/lib/pwa/dirtyForms.ts`, so most dialogs pass it with one prop. |
| Dialogs to adopt it | — | Issue quotation, Mark won, Add expenses (burst), Add expense, Create invoice, Issue PO, Record payment, Add person, Add supplier/line, Paste reply |
| Pasted supplier reply | Lost on close | Optional: keep the paste in sessionStorage `qtech.replyDraft.<inquiry id>` until accepted, and add the prefix to `forget.ts` (security review L-5). |

**Files:** `src/ui/Dialog.tsx` (prop), `src/ui/DiscardBar.tsx` (new), one prop per dialog.

**Effort:** S/M. **Impact:** +0.25.

### 3.4 Error messages that say the fix

`src/lib/pgErrors.ts` is already good: what happened, what is safe, what to do. Network, unique, foreign key, permission, not-found and closed-month messages are all mapped.

The gap is the **server's own rule messages**. There are 116 `raise exception` lines in the migrations. Codes `22023`, `22004`, `P0002` and any `P0001` other than closed-month all fall through to "Something went wrong. Nothing was saved. Try again." or "This change was refused." Trying again never helps for these. Examples:

| Server text (migration) | Shown today | Should say |
|---|---|---|
| `a quoted price is needed for: %` (0039) | Something went wrong… Try again. | Add a price for "%", then issue the quotation again. |
| `a price is needed for: %` (0036) | same | Add the supplier price for "%", then issue the PO again. |
| `set the currency of this supplier order before issuing a PO` (0036) | same | Pick the supplier's currency on this supplier order, then issue the PO. |
| `% cannot be closed yet: it is the current month or later.` (0027) | This change was refused. | % can be closed from the 1st of next month. |
| `% is still open. Close earlier months first` (0027) | same | Close % first. Months close in order. |
| `the system must keep at least one active admin` (0029) | same | Make someone else an admin first. The app always keeps one. |
| `category "%" is inactive; pick an active category` (0025, code 23514) | "Check that amounts are above zero and dates are in order" (wrong advice) | "%" is switched off. Pick another category, or switch it on in Settings › Expense categories. |
| `an issued % cannot be changed; issue a new revision` (0022) | This change was refused. | An issued quotation or PO can't be edited. Use Revise. |
| `the RFQ has no items to quote` (0039) | Something went wrong… | Add at least one item first. |

**Fix**
- New `src/lib/rpcMessages.ts`: a list of `{ match: RegExp, message: (m) => string, help?: recipeId, action?: { label, href } }`.
- `mapPgError` consults it before its fallback, for codes `22023`, `22004`, `P0001`, `P0002` and `23514` (about 3 lines in `pgErrors.ts`).
- The error toast shows `action` (for example "Open Month end", "Open categories") or "How to fix" (the Help recipe).
- New `src/lib/rpcMessages.test.ts` scans `supabase/migrations/*.sql` for every `raise exception '…'`. Each must be mapped or listed in `INTERNAL_ONLY` (programmer errors such as "issue_quotation needs a quotation id"). A new migration with an unmapped message then fails CI.

**Effort:** S. **Impact:** +0.25.

---

## 4. Practice without touching the real books

### 4.1 Options checked against the data model

**A. A practice flag or demo company in the real database: rejected.** Facts from `origin/main`:

- **Blast radius.** The schema has 24 views, about 95 SQL functions and 59 triggers. About 30 of them sum, rank or learn across rows and would each need a "not practice" filter:
  - `v_cash_month`, `v_month_pnl`, `v_month_pnl_live`, `v_month_expense_category`, `v_month_team`, `v_payment_net`, `v_target_progress`, `v_order_money`, `v_gst_register`, `v_gst_month`, the four `v_report_*` views, `v_supplier_activity`, `v_supplier_stats`, `v_company_roles`;
  - `aging_as_of`, `payables_as_of`, `month_end_status`, `month_end_check_details`, `money_exceptions_input`, `my_target_progress(_at)`, `order_receivables`, `search_all`, `supplier_item_memory`, `supplier_item_evidence`, `supplier_median_delivery_days`, `rank_item_quotes`, `customer_price_memory`, `take_month_snapshot`, `next_invoice_number`, `po_line_prefill`;
  - the `learn_company_brands` trigger.

  One missed filter silently corrupts a report, a target or the GST register. That is the opposite of "proper bookkeeping".
- **Silent pollution.** A practice supplier price would feed supplier memory, ranking, the "last price" chips and the learned brand list (`learn_company_brands`). Real RFQs would then pre-tick the wrong suppliers and suggest fake prices. Nobody would notice.
- **Legal invoice series.** `next_invoice_number()` takes its prefix from the *most recently created* invoice and adds one to the highest number (0044). A practice invoice either takes a real GST number or, with another prefix, hijacks the series for the next real invoice.
- **Numbers seen by outsiders.** RFQ and order numbers are identity columns that appear in supplier messages and on PDFs. Practice records would leave visible gaps. Quotation and PO sequence gaps are accepted (DATA_MODEL §4), but RFQ and order gaps are visible too.
- **No clean delete.** Sales cannot delete RFQs or orders (§10: SIU). Quotations RESTRICT their RFQ. `audit_log` keeps everything forever.
- **Derived roles.** A practice RFQ on a real company changes its derived customer or prospect role (`v_company_roles`).
- **Frozen model.** DATA_MODEL.md is frozen, and the flag touches 15+ tables.

**B. Separate practice copy: recommended later, gated.** A second free Supabase project plus a free Cloudflare Pages site built from the same `main`, with synthetic data. It is fully isolated: real RPCs, real PDFs, real Undo, zero risk to the books. Gates and costs:

- **A free project slot.**
  - Supabase Free limits the number of active free projects (2, at the time of writing).
  - One slot is the legacy CRM project `vptyhluvgnjpvkcbhxsf`, which must not be touched. The other is production.
  - A slot exists only after the owner retires or pauses the legacy project following import sign-off and a retention decision.
  - Paused free projects can be restored only for a limited period. Owner decision; check the live limit in the dashboard first.
- **Pausing.** Free projects pause after about 1 week of inactivity. That is acceptable, because practice is used in a new hire's first days; the admin un-pauses it in the dashboard.
- **CSP.** `public/_headers` and `vercel.json` hard-code the production Supabase origin in `connect-src`. The practice build needs a post-build step that swaps the origin in `dist/_headers` (`scripts/practice-headers.mjs`, new). `scripts/hosting-headers.test.mjs` compares the source files only, so it is unaffected.
- **Deploy guards.**
  - `remote.yml` fails unless the ref is production.
  - Add `.github/workflows/practice.yml` (new, manual only, `practice` environment) that refuses any ref other than the practice ref. It explicitly refuses the production and legacy refs.
  - Its job: reset, apply migrations, load `supabase/practice/seed.sql`, and deploy `admin-users` with the practice origin.
- **Data.** `supabase/seed.sql` holds only 4 test users. A new `supabase/practice/seed.sql` needs:
  - synthetic companies and items (the `enquiryCorpus` fixture is synthetic: "No real customer data");
  - RFQs at every stage, orders, invoices and payments, so each role's Today has work;
  - three shared logins (`practice-sales@practice.invalid` and so on).
- **No confusion with the real app.**
  - A yellow full-width "PRACTICE COPY — nothing here is real" bar (`src/app/PracticeBanner.tsx`, shown when `VITE_PRACTICE=1`).
  - A different page title and manifest name ("Q-Tech PRACTICE").
  - A different origin, so sessions and drafts never mix.
  - Advice not to install it as an app.
- **Hosting.** Use Cloudflare Pages, which allows commercial use and does not share Vercel's 100-deploys-a-day limit.

**Files:** `supabase/practice/seed.sql`, `.github/workflows/practice.yml`, `scripts/practice-headers.mjs`, `src/app/PracticeBanner.tsx`, `docs/PRACTICE.md` (runbook). All new.

**Effort:** L (the seed content is most of it). **Impact:** +0.25.

**C. Practice bench inside Help: recommended now, zero writes.** The scary part for a new sales engineer is the paste steps. Those run on **pure, snapshot-tested functions** that touch no database:
- `parsePaste` (`rfqs/lib/parseItems.ts`) turns a customer message into items;
- `generateEnquiryDraft` (`enquiryDraft.ts`) writes the supplier message;
- `parseSupplierReply` (`replyParse.ts`) reads a supplier's reply into prices;
- the quotation PDF renderer (`quotations/pdf/QuotationDocument.tsx`, already a lazy chunk) can preview a practice quotation.

**How the bench works**
- `/help/practice`, linked from the `new-rfq`, `ask-suppliers` and `supplier-prices` recipes.
- The person pastes, or picks a sample from `enquiryCorpus`.
- They see the items, the supplier message, a sample supplier reply read into prices, and a "PRACTICE" watermarked PDF.
- Nothing is saved, and the page says so.

**Files:** `src/features/help/practice/PracticeBench.tsx`, `src/features/help/practice/samples.ts` (synthetic replies), one lazy route in `src/app/routes.tsx`.

**Effort:** M. **Impact:** +0.25.

**D. Safe first tasks on real work: recommended now, S.** Most first actions already have a net:
- Copy actions are Undo-able for 10 s.
- "Read it" and "Preview PDF" show the result before saving.
- Paste or photo has Undo.
- "Nothing is saved until you accept."

The first-week checklist (§5.1) deliberately starts with these actions. Each recipe ends with a "Safe to try:" line naming the Undo or preview. Same files as §2.3.

### 4.2 Recommendation

- **Ship C and D now.** They cost $0 and have no infrastructure or data-model risk.
- **Do B only** after import sign-off and once a free Supabase slot is confirmed. It is an owner decision about the legacy project.
- **Never do A.**

---

## 5. Measuring it

### 5.1 First-week checklist per role (derived from data, nothing new recorded)

Every table has `created_by` ([std], DATA_MODEL §2), and 0048 added `last_chased_by` and `last_asked_by`. So each item can be read from records the business already keeps. Admin can read all of them, plus `audit_log` for "who stamped what".

| Role | Item (in order) | Done when (query) |
|---|---|---|
| Sales | 1. Add your phone number (printed under your name on messages) | `users.phone` is not null for me |
| | 2. Log an RFQ | an `rfqs` row with `created_by = me` |
| | 3. Ask suppliers | a `supplier_inquiries` row with `sent_on` set, on an RFQ I own |
| | 4. Enter a supplier price | a `supplier_quote_lines` row with `created_by = me` |
| | 5. Issue a quotation | a `quotations` row with `created_by = me` |
| | 6. Chase from Today | `supplier_inquiries.last_chased_by = me` or `clarifications.last_asked_by = me` (admin view: also `audit_log` for customer chase stamps) |
| Engineer | 1. Add your phone number | as above |
| | 2. Save a photo or note with Paste or photo | an `attachments` row with `created_by = me` |
| | 3. Mark goods delivered or received | admin view: an `audit_log` row on `supplier_orders` setting `delivered_on`/`received_on` by me. Self view: on an order I'm on, a leg has `delivered_on` |
| | 4. Mark a commissioning job done | `orders.commissioning_done_on` set on an order in my `order_engineers` (admin view: `audit_log` actor) |
| Admin (a new admin) | 1. Record a payment | a `payments_in` row with `created_by = me` |
| | 2. Add expenses | an `expenses` row with `created_by = me` |
| | 3. Create an invoice | an `invoices` row with `created_by = me` |
| | 4. Mark TCS or FBR | an `audit_log` row on `invoices` setting `tcs_sent_on`/`psid` by me |
| | 5. Match the bank statement for a month | an `audit_log` row setting `bank_month` by me |
| | 6. Add a person | an `audit_log` row on `users` insert by me |

**Where it shows**
- **The person (self view).** "Your first week: 3 of 6" at the top of Help and on the How-this-works card. Each open item links to its recipe.
- **The owner (admin view).** Settings › Team: each person's row shows "First week 3/6" for 14 days after `users.created_at`. Tapping it opens a sheet with each item and the date it was first done.
- **Nothing is hidden.** People see their own list, so this is coaching, not secret monitoring.

**Files**
- New: `src/features/onboarding/firstWeek.ts` (definitions per role, each `{ id, label, recipe, query }`), `src/features/onboarding/firstWeekApi.ts`, `src/features/onboarding/FirstWeekCard.tsx`, `src/features/settings/FirstWeekSheet.tsx`, and tests.
- One line in `TeamPage.tsx` (the row badge).

**Effort:** M. **Impact:** +0.25 directly; it is also the evidence needed for the re-score.

### 5.2 Signals that someone is stuck (privacy-friendly, no external analytics)

| Signal | Source | Who sees it |
|---|---|---|
| S1. A first-week item is not reached by working day 3 (items 2 and 3) or day 5 (the rest) | §5.1 queries | Owner (amber in the Team sheet); the person sees the item as next |
| S2. Started but not finished: an own RFQ older than 1 working day with no supplier asked; prices in but no quotation by the due date; an assigned commissioning date passed and not done | The existing Today rules (`today/rules.ts`), run by admin for each owner (admin reads everything) | Owner, in the same sheet: "3 items waiting more than 2 days" |
| S3. An abandoned New RFQ draft older than 1 day | Device only (`intakeDraftStore.ts`) | The person only ("You have a draft from Tue"). Never sent anywhere. |
| S4. "Still stuck? Message the owner" | User-initiated. It builds a WhatsApp or Email text: the screen name, the record ref (for example RFQ-0177), the open recipe and the last error text. Copied with the remembered channel (`useChannelPreference`). Nothing is stored. | Owner, through their own WhatsApp |
| S5. (Optional, owner decision) last sign-in | `admin-users` would return `auth.users.last_sign_in_at` (function change, S) | Owner only. Tell staff it is shown. |

**Not done, on purpose:** click tracking, session recording, counting Help opens on the server, and any third-party script.

**Files:** `src/features/onboarding/stuckSignals.ts` (pure and tested), `src/features/help/stuckMessage.ts` (a pure text generator like the chase texts, with a snapshot test).

**Effort:** S/M. **Impact:** +0.25.

### 5.3 Automated checks

- `e2e/onboarding/first-run.spec.ts` (new): a new fixture user `newsales@test.invalid`, added to the test-only `supabase/seed.sql`, signs in and sees:
  - the first-use states (Today, RFQs, Orders) with one button each;
  - the card, which they dismiss and which stays dismissed after a reload;
  - Help, opened from the account menu and from the palette ("how quote").
- `e2e/help/help.spec.ts` (new): recipe deep link `?help=new-rfq`, back closes it, the panel does not block the page on desktop.
- The FE-2 interaction counters in `e2e/journeys/support.ts` can assert that Help never adds a step to a core journey.

### 5.4 Day-one test (what earns the last point)

The owner runs it with two new or non-technical people, one sales and one engineer, on a phone, before declaring 10/10.

- 30 minutes. The owner stays silent and only notes things down.
- The person is given the login and the first 4 checklist items of their role, nothing else.
- Note per task: done unaided (yes/no), minutes, questions asked, where they hesitated.
- **Pass:**
  - at least 5 of 6 tasks done unaided;
  - no task takes more than 10 minutes;
  - at most 2 questions in total, none about where a button is or what a word means.
- Every hesitation becomes a fix: a label, an InfoTip or a recipe step. Then re-run.
- Re-audit with the same rubric as `navigation.md` §4.

---

## 6. Summary of items

| # | Item | Main new files | Edits elsewhere | Effort | Impact |
|---|---|---|---|---|---|
| 1 | First-use states with one button | `src/features/onboarding/{useFirstUse.ts, firstUseCopy.ts, FirstUseState.tsx}`, `src/dev/gallery/onboarding.tsx` | one line each in 7 screens | M | +0.5 |
| 2 | How-this-works card per role | `src/features/onboarding/{HowItWorksCard.tsx, howItWorks.ts, useDismissed.ts}` | `TodayScreen.tsx` (1 line) | S/M | +0.25 |
| 3 | InfoTip and field `help=` gaps (18 places) | none | about 20 call sites (strings) | S | +0.25 |
| 4 | Help panel, palette "How do I…", account-menu entry | `src/features/help/{HelpProvider.tsx, HelpPanel.tsx, useHelp.ts}` | `AppShell.tsx`, `AccountMenu.tsx` (1 line each) | M | +0.5 |
| 5 | Recipes from the guides, rendered from markdown, no dependency | `src/features/help/{recipes.ts, RecipeView.tsx}` | `docs/guides/*.md` restructured | S/M | +0.25 |
| 6 | Guide/UI label sync tests | `src/features/help/guideSync.test.ts` | none | S | (keeps 4 and 5 true) |
| 7 | Undo for payment, expenses, deletes, replies, adds | `src/ui/useDeferredDelete.ts` | about 8 feature files, `payments/api.ts` | S | +0.5 |
| 8 | Undo for Mark won and Create invoice | `supabase/migrations/00xx_undo_recent.sql` + pgTAP | `ConvertDialog.tsx`, `CreateInvoiceDialog.tsx` | M | (in 7) |
| 9 | Confirm policy (remove 3 confirms) | none | `DESIGN_SYSTEM.md` §13 | S | (in 7) |
| 10 | Dirty-dialog guard | `src/ui/DiscardBar.tsx` | `Dialog.tsx` + one prop in about 10 dialogs | S/M | +0.25 |
| 11 | Server rule messages with the fix | `src/lib/rpcMessages.ts`, `src/lib/rpcMessages.test.ts` | `pgErrors.ts` (about 3 lines) | S | +0.25 |
| 12 | Practice bench (zero writes) | `src/features/help/practice/{PracticeBench.tsx, samples.ts}` | `routes.tsx` (1 lazy route) | M | +0.25 |
| 13 | Practice copy (gated) | `supabase/practice/seed.sql`, `.github/workflows/practice.yml`, `scripts/practice-headers.mjs`, `src/app/PracticeBanner.tsx`, `docs/PRACTICE.md` | none | L | +0.25 |
| 14 | First-week checklist: self and owner view | `src/features/onboarding/{firstWeek.ts, firstWeekApi.ts, FirstWeekCard.tsx}`, `src/features/settings/FirstWeekSheet.tsx` | `TeamPage.tsx` (1 line) | M | +0.25 |
| 15 | Stuck signals and "Message the owner" | `src/features/onboarding/stuckSignals.ts`, `src/features/help/stuckMessage.ts` | none | S/M | +0.25 |
| 16 | E2E first run and Help | `e2e/onboarding/first-run.spec.ts`, `e2e/help/help.spec.ts` | `supabase/seed.sql` (+1 test user) | S | — |
| 17 | Day-one test with 2 real people | none | none | (owner, 1 hour) | the last point |

The estimated total, from about 6.5 after the ux branches to 10, assumes item 17 passes. Without it the honest score is about 9.

**Order of work.**
1. Merge ux/foundation, ux/rfqs, ux/orders and ux/money-today first, reconciling the two SALES.md rewrites.
2. **L1** (all S): items 3, 7, 9, 10, 11, 16.
3. **L2:** items 1, 2, 4, 5, 6, 14, 15.
4. **L3:** items 8 (needs owner approval for the migration) and 12.
5. **L4:** item 13, after cutover and only if a Supabase slot is free.
6. Then item 17 and a re-audit.

**Open questions for the owner.**
1. Undo for Mark won and Create invoice needs a small migration. Approve?
2. A practice copy needs a second free Supabase project, so the legacy project would have to be paused or retired after import sign-off. When, and with what retention?
3. Should the Team page show last sign-in (S5)? If yes, staff are told.
4. Is "Help" the right word in the menu? Alternatives: "How do I…?" or "Guide".
