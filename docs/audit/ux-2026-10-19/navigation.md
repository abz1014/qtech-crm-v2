# Q-Tech CRM v2: navigation, information architecture and task paths

Read-only audit of `qtech-crm-v2` at branch `phase0/stabilise`. Scope: navigation, information architecture (IA) and task paths. Typography and per-screen clutter are covered by other auditors. Every claim cites a file (paths are relative to the repo root) or a PNG in `docs/design/screens/`.

---

## 1. Map of the app

### 1.1 Global chrome (every signed-in screen)

| Element | Desktop/tablet (`src/app/shell/TopBar.tsx`) | Phone < 768 px (`src/app/shell/MobileChrome.tsx`) |
|---|---|---|
| Main destinations | 6 links (admin, sales), 4 (engineer), from `src/app/navConfig.ts` | Same list as a bottom tab bar (`BottomTabs`), with no counts |
| Search / command palette | "Search or jump to", Ctrl/⌘K (`src/app/palette/PaletteHost.tsx`) | Search icon |
| Capture | Primary "Capture" button, key `C`, paste or drop anywhere (`src/app/capture/CaptureProvider.tsx`) | Primary "Capture" button with its label |
| Account menu | Avatar: Settings, Team (admin), Change password, Install app, Sign out (`src/app/shell/AccountMenu.tsx`) | Same |
| Landing after login | First nav item for the role, which is `/today` for all roles (`src/app/roleRoutes.ts`) | Same |

### 1.2 Routes and screens by role (`src/app/routes.tsx` plus each feature's `*Screen.tsx`)

| # | Route | Screen | Admin | Sales | Engineer |
|---|---|---|---|---|---|
| 1 | `/login` | Sign in | ✓ | ✓ | ✓ |
| 2 | `/today` | Today (list plus context pane) | ✓ | ✓ | ✓ |
| 3 | `/rfqs` | RFQ board (Open / Closed) | ✓ | ✓ | ✓ |
| 4 | `/rfqs/new` | New RFQ intake (4 steps on one URL) | ✓ | ✓ | ✓ |
| 5 | `/rfqs/:id` | RFQ detail | ✓ | ✓ | ✓ |
| 6 | `/orders` | Orders list | ✓ | ✓ | ✓ ("My jobs") |
| 7 | `/orders/:id` | Order detail | ✓ | ✓ | ✓ (no money) |
| 8 | `/companies` | Companies list | ✓ | ✓ | ✓ |
| 9 | `/companies/:id` | Company page | ✓ | ✓ | ✓ |
| 10 | `/money/gst-register` | GST register (where `/money` lands) | ✓ | ✓ | – |
| 11 | `/money/receivables` | Receivables, called "Order balances" for sales | ✓ | ✓ | – |
| 12 | `/money/expenses` | Expenses | ✓ | – | – |
| 13 | `/money/month-end` | Month-end checklist | ✓ | – | – |
| 14–20 | `/money/month-end/{bank,pnl,categories,aging,owe,gst,team}` | Bank tick, P&L, Expenses by category, Aging, We owe, GST/FBR, Team report | ✓ | – | – |
| 21 | `/money/margins` | Margins | ✓ | – | – |
| 22 | `/money/exceptions` | Exceptions | ✓ | – | – |
| 23 | `/reports` | Reports (4 stacked sections) | ✓ | ✓ | – |
| 24 | `/settings` | Settings home. Admin is redirected to Team (`SettingsLayout.tsx` `SettingsHome`) | (→ Team) | ✓ | ✓ |
| 25–31 | `/settings/{team,targets,categories,company,details,exchange-rates,password}` | Team, Targets, Expense categories, Company profile, Your details, Exchange rates, Change password | all 7 | 4 | 4 |
| – | `/capture`, `/no-access`, `*` | Share-target redirect, no access, not found | | | |

### 1.3 Tabs, sub-tabs and segmented controls inside each section

| Section | View switchers (options) | Other filters and toggles |
|---|---|---|
| Today (`src/features/today/TodayScreen.tsx:45,104`) | All / Bids / Sourcing / Money. Engineer gets All / Bids / Sourcing | Collapsible "Waiting" group. WhatsApp / Email in the pane (`ContextPane.tsx:350`). Snooze popover |
| RFQ board (`src/features/rfqs/board/BoardPage.tsx`) | Open / Closed. Mine / All. State: All open / Not floated / Out for offers / Covered / No offer (`board/model.ts:47`) | Comfortable / Compact density. "Filter RFQs" box. Pager on Closed |
| Intake (`src/features/rfqs/IntakeScreen.tsx`) | 4 steps: build → suppliers → enquiry → floated/saved (`IntakeParts.tsx:20`) | WhatsApp / Email (`IntakeParts.tsx:192`) |
| RFQ detail (`RfqDetailScreen.tsx`) | No tabs. One long page (`rfq-detail-01-populated.png`, about 2,800 px tall) | "Bid and close" menu with 10 entries (`RfqHeaderBlock.tsx:108-135`). Phone: Chase menu and More menu. WhatsApp / Email in Questions and Suppliers asked |
| Orders list (`OrdersListPage.tsx`) | Tabs: Active / Done / Cancelled. Mine (or "My jobs") / All | 4 dropdowns: Goods, Commissioning, Invoicing, Payment. Search |
| Order detail | No tabs | More menu (Cancel or Reopen) |
| Companies (`CompaniesPage.tsx:140`) | All / Customers / Suppliers / Prospects | Search by name or country |
| Money (`src/features/money/moneyTabs.ts`) | Admin: GST register / Receivables / Expenses / Month-end / Margins / Exceptions. Sales: GST register / Order balances | GST: "Needs attention" and "Not sent by TCS" toggles. Receivables: Open / Overdue / Settled. Expenses: month pager and 3 dropdowns. Margins: 1 toggle |
| Money › Month-end (`monthEnd/monthEndViews.ts`) | Checklist / Bank tick │ P&L / Expenses by category / Aging / We owe / GST/FBR / Team | Month pager. Bank / Cash switch on a report (`ReportPages.tsx:459`) |
| Reports (`src/features/reports/ReportsScreen.tsx`) | None. 4 sections stacked | – |
| Settings (`SettingsLayout.tsx`) | Side list: 7 links for admin, 4 for others | – |

### 1.4 Dialogs and sheets that carry a main task (file: title)

Capture sheet (`capture/CaptureSheet.tsx`). Command palette. New company. Edit company. Add/Edit site. Add/Edit contact. Merge company. Add an item (RFQ). Float to another supplier (`SuppliersToAsk.tsx:146`). Issue quotation, with an edit stage and an issued stage. Mark won (`ConvertDialog.tsx:228`). New order (a repeat of a past order). Add line. Add leg. Split line. Issue purchase order. Chase the goods. Resolve price basis. Cancel order. Commissioning. Order notes. Record payment. Create invoice. Invoice detail. Add/Edit expense. Add expenses (burst sheet). Recurring expense. Close month. Reopen month. Add person. Account created (password shown once).

Smaller or confirm dialogs: delete file, file viewer, delete expense, remove photo, edit job title, edit phone, change role, reset password, deactivate, reactivate, and the phone row action sheet.

### 1.5 Counts

| Measure | Count |
|---|---|
| Top-level destinations | **6** (admin, sales) / **4** (engineer). Settings, Capture and Search sit outside the six |
| Distinct screens (routes with their own page) | **31** (sign-in, 8 core screens, 13 Money screens, Reports, 8 Settings screens) |
| View switchers (tabs, segmented controls, side lists) | **13**, offering **53** sub-views to an admin. Also **18** more filters and toggles: 4 order dropdowns, 3 expense dropdowns, 4 toggles, 2 density, and 5 WhatsApp/Email switches |
| Dialogs and sheets | **41** in total, of which about **30** carry a main task |
| Deepest navigation | **3 nav levels stacked** before the content: top bar → Money strip → Month-end strip (`MonthEndFrame.tsx` puts `MonthEndNav` inside `MoneyFrame`). A dialog adds a 4th, e.g. Month-end › Checklist › "Close October" confirm, or Orders › order › leg › Issue PO. Settings sub-pages are 3 clicks deep through a hidden entry (avatar → Settings → page) |

---

## 2. Task paths (desktop, signed in, starting on Today)

The counts are: clicks/taps, then route changes, then fields (required + optional). "Lost" lists the places a user can get stuck or confused.

### Sales

**S1. Log a new RFQ from a customer email or WhatsApp.** Path A: RFQs (1) → New RFQ (2) → type the company and pick it (3) → paste into "Click here and paste, or type one item per line" (`ItemsEditor.tsx:143`) → "Looks right: find suppliers" (4) → keep or change the ticks → "Write the enquiry" (5) → "Copy & mark floated to N" (6) → paste into each supplier's chat outside the app.
**6 clicks + ticks, 2 route changes + 3 in-page steps, 2 required + 5 optional fields** (site, contact, bid due, customer reference, top priority).
Path B on a phone: share or paste into **Capture** → "Start a new RFQ" tile → "Which company?" → "Continue to intake" (`CaptureSheet.tsx:313`), then the same 3 steps.
- Lost: the 4-step progress list is hidden below 1024 px (`IntakeParts.tsx:52` `hidden … lg:grid`), so phones and tablets get no step indicator.
- Lost: nothing persists. `IntakeScreen.tsx` has no storage or leave guard (`useBlocker` and `beforeunload` appear nowhere in `src`). One tap on a bottom tab throws away the pasted items.
- Lost: "Customer reference" is optional and sits in the last block. It is the field that later finds the RFQ (S9).
- Lost: there are six ways in, all reaching the same screen: RFQs button, key `N`, palette "New RFQ for X", company page "New RFQ" / "Float an RFQ here", the Capture tile, and palette "New RFQ".

**S2. Ask suppliers for prices and record their quotes.**
- Asking is part of S1. If the RFQ was saved without floating: open the RFQ (2) → "Suppliers to ask" ticks → "Copy enquiry for N suppliers" (3) (`SuppliersToAsk.tsx:119`). Once someone has been asked: "Float to another supplier" dialog → same button.
- Recording a reply: RFQ (2) → "Paste what they sent" (3) → paste → "Read it" (4) → "Accept N offers" (5) (`PasteReply.tsx:147-182`). Or per item: "Add reply" (3) → unit price (required), lead time, stock → "Save reply" (4). **4–5 clicks, 1 route change, 1 required field per item + 2 optional.**
- Lost: replies are entered per item on a very long page (`rfq-detail-01-populated.png`). "Add reply" appears on every item and on every waiting-supplier row.
- Lost: one action has three names: "Copy & mark floated", "Copy enquiry for N suppliers" and "Float to another supplier".
- Lost: the guide says mark "No price" (`docs/guides/SALES.md` §4), but the button reads "Can't quote".

**S3. Send a quotation PDF.** RFQ (2) → "Issue quotation" (3) → a price per item, by tapping a chip or typing → optional "Preview PDF" → "Issue quotation" (4) → "Share" (5) or "Download PDF" (`IssueQuotationDialog.tsx:336-410`). **5 clicks, 1 route change + a 2-stage dialog, 1 required field per item + 6 optional** (addressed to, valid until, lead time, delivery, payment terms, standard terms).
- Lost: "Issue quotation" stays disabled until some supplier price exists (`RfqHeaderBlock.tsx:241`, phone `:356`), and nothing says why.
- Lost: the guide skips the "Issue quotation" press between Preview and Download (`SALES.md` §5).
- Lost: the same thing is called a "bid" ("Mark bid sent", "Bid due", Today "Bids") and an "offer" ("Sent the offer again"). Supplier quotes are also "offers" ("Accept N offers").

**S4. Turn a won quote into an order.** RFQ (2) → "Mark won" (3) → the dialog titled "Mark won" pre-fills a supplier per line. Then Customer PO (optional), Needs commissioning (checkbox), Payment terms (optional) → "Create order" (4), and the order opens. **4 clicks, 2 route changes, 0 required + 3 optional fields.**
- Lost: the Orders list has a "New order" button (`OrdersListPage.tsx:299`) that only copies a **past** order (`NewOrderDialog.tsx`, empty state "Win an RFQ to start the first one"). It looks like the place to create an order, but it does something else.

**S5. Check what's late today.** Today is the landing page. "Overdue or due today" is the first group (`TodayScreen.tsx:84`). **0–1 clicks.**
- Lost: on a phone, the target tile and the tab control come first, so the list starts below them (`today-b2-06-mobile-375.png`).

**S6. Chase a payment.** Today → "Payment N days overdue" row (1) → "Copy and mark reminded" (2) → paste into WhatsApp. **2 clicks, 0 fields.**
Alternative: Money (1). This lands on the **GST register**, not the balances (`MoneyScreen.tsx:23`). Then "Order balances" (2) → Overdue (3) → row (4) → Copy (5).

### Admin

**A1. Record a customer payment.** Money (1, GST register) → Receivables (2) → find the row → icon-only "Record payment" button (3) (`ReceivablesPage.tsx:167`) → Amount (pre-filled with the balance), Date (today), Reference (optional), Paid via → Save (4). **4 clicks, 1 route change, 4 fields (2 pre-filled).** Other ways in: order header "Record payment", or the same button repeated in the order's "Invoices and payments" panel (`MoneyPanels.tsx:46`).
- Lost: **on a phone this cannot be done from Receivables.** The phone card (`ReceivablesPage.tsx:227`) has no Record payment button and no link to the order. Tapping the card only opens the reminder panel.

**A2. Record an expense or a supplier payment.** Money (1) → Expenses (2) → "Add expense" or "Add expenses" (3), two near-identical buttons (`ExpensesPage.tsx:57,60`) → Amount, Date, Category, Paid via, plus optional Note, Order, Leg, Receipt → Save (4). **4 clicks, 1 route change, 4 required + 4 optional fields.**
Supplier payment: Orders (1) → order (2) → the leg's "Add expense" (3) pre-fills payee, leg and category "Supplier payment" → Save (4).
- Lost: no button anywhere says "Pay supplier". The admin has to know that a supplier payment is an "expense" on a "leg".

**A3. See who owes money.** Money (1) → Receivables (2). **2 clicks.**
- Lost: the same answer lives in four places: Receivables, Month-end › Aging, the company page's "Money with them" (admin only, `CompanyPage.tsx:258`), and Today › Money.

**A4. File or check the GST register.** Money (1, lands here) → "Needs attention" or "Not sent by TCS" → tick invoices → "Sent by TCS today" / paste PSID + "Add PSID" / "Deposited today" (`GstRegisterPage.tsx:199-283`). **About 4 clicks + 1 paste.** The month view is a separate place: Money → Month-end → GST/FBR (3).

**A5. Close the month.** Money (1) → Month-end (2) → read the 7 check cards → "Close October" (3) → confirm (4). **4 clicks, 0 fields.**
- **Lost (wrong destination):** Today's "Close October: n checks" item links to `href: '/money'` (`src/features/today/rules.ts:694`). That redirects to the GST register, not the checklist. The pane's own text says "Review the month-end checks" (`ContextPane.tsx:586`).

**A6. Add a user.** Avatar (1) → Team (2) → "Add person" (3) → Full name, Email, Role, Job title (optional) → "Create account" (4) → copy the password → Done (5). **5 clicks, 1 route change, 3 required + 1 optional field.**
- Lost: this is only reachable through the avatar menu. On a phone, Team's back arrow goes to Today, not Settings (`TeamPage.tsx:68` `back: { to: '/' }`).

### Engineer

**E1. See assigned work and update it.** `ENGINEER.md` says "Start with Today", but Today rules are routed by order or RFQ **owner** (`rules.ts:78` `routesToUser(ownerId)`). No rule reads the order's assigned engineers. The Orders list does: "My jobs" filters on `row.engineerIds` (`orders/lib/listModel.ts:54`). So an engineer assigned to a job they do not own sees "Nothing needs you today". The real path: Orders (1, "My jobs" is the default) → order (2) → "Mark done today" or the leg's "Delivered today" / "Received today" (3). **3 clicks, 2 route changes, 0 fields.**
- Lost: Today's "Bids" tab is shown to engineers (`TodayScreen.tsx:104`), but bids belong to sales.

### Finding things

**F1. Find a customer.** "Search or jump to" (1) → type → pick (2). Or Companies (1) → "Search by name or country" → row (2). **2 clicks.** A contact's name is only found by the global search: the Companies search matches name and country only (`CompaniesPage.tsx:50`).

**F2. Find an old RFQ by the customer's reference.** Global search covers customer refs (`features/search/paletteSource.ts`): Search (1) → type the ref → pick (2). **2 clicks.**
- **Dead end on the board:** RFQs → Closed → "Filter RFQs" filters only the 25 rows already loaded on the current page (`BoardPage.tsx:200`, `PAGE_SIZE = 25` in `board/model.ts:165`). An older RFQ shows "No RFQs match" even though it exists.

---

## 3. Problems found

### 3.1 Jargon and internal terms in labels

| Term on screen | Where | Plain alternative |
|---|---|---|
| Bids, Sourcing (Today tabs) | `TodayScreen.tsx:45` | Quotes, Suppliers & delivery (or drop the tabs) |
| Ready to move, Waiting, next nudge | `TodayScreen.tsx:86,199` | Can do now, Chased, will come back on |
| Not floated / Out for offers / Covered / No offer | `board/model.ts:47-52` | Not sent to suppliers / Waiting for prices / All priced / No price yet |
| Float, floated, "Copy & mark floated", "Float an RFQ here", "Float undone" | `IntakeScreen.tsx:682`, `CompanyPage.tsx:198`, `SuppliersToAsk.tsx:146` | Ask suppliers, Copy message for N suppliers |
| relay to | `rules.ts:211` | Send the answers to |
| Bid and close, Mark bid sent, Sent the offer again | `RfqHeaderBlock.tsx:120-138` | Quote sent, Close (lost) |
| Capture | `TopBar.tsx:87`, `MobileChrome.tsx:51` | Paste or photo / Add from WhatsApp |
| Procurement legs, leg, Add leg | `LegsPanel.tsx:73`, `AddDialogs.tsx:166`, `ExpenseDialog.tsx:350`, `ContextPane.tsx:578` | Suppliers on this order, Add supplier |
| Price basis unknown, Resolve price basis | `OrderHeaderBlock.tsx:209,250` | Is GST included? |
| provisional, Provisional margins | `ContextPane.tsx:588`, `monthEnd/model.ts:105` | Margin not final |
| Exceptions | `moneyTabs.ts:18` | Things to check |
| Bank tick, We owe, Aging, GST/FBR, P&L | `monthEndViews.ts` | Match bank statement, We owe suppliers, Overdue by age |
| Uncategorised, Unresolved payments | `monthEnd/model.ts:85,125` | Expenses without a category, Payments not split |
| PSID, TCS, FBR | `GstRegisterPage.tsx` | These are real-world terms, but they need one-line help |
| Comfortable / Compact | `BoardPage.tsx:247` | Remove it |

### 3.2 Duplicated routes and names for the same thing

- **Ask suppliers** has 4 labels (see S2), and Today calls it "Not floated".
- **Our quotation** is called quotation, bid and offer. "Offer" also means a supplier's price.
- **Who owes us** lives in 4 places (A3). Sales and admin see different names for the same tab: "Order balances" vs "Receivables" (`moneyTabs.ts:13`).
- **Things to fix** lives in 3 places: Today › Money, Month-end Checklist (7 checks) and Exceptions.
- **Reports** has 3 homes: the top-level Reports page, 6 Month-end reports, and the "Reports for October" panel on the checklist (`ChecklistPage.tsx:447`).
- **Name clashes:** Team means people under Settings but a money report under Month-end. "Expense categories" (`/settings/categories`) sits next to "Expenses by category" (`/money/month-end/categories`). "GST register" is a Money tab, but "GST/FBR" is a Month-end report.
- **Invoice** is "Create invoice" on the order page but "New invoice" in the GST register.
- **Record payment** appears twice on one order page: header and panel.
- **Add expense** is offered in 5 places, including two buttons "Add expense" and "Add expenses" side by side.
- **WhatsApp / Email** has to be chosen in 5 separate places: Today pane, intake, questions, supplier chase, payment reminder.

### 3.3 Hidden features

- Paste or drop anywhere opens Capture (`CaptureProvider.tsx`). Keys: `N`, `C`, `G T`, `/` (RFQ filter), Ctrl/⌘K, Ctrl+Enter. Nothing on screen teaches any of them except the `⌘K` / `C` hints on desktop at 1280 px and up.
- Searching invoices, supplier PO numbers, order items and contacts only works in the palette (`paletteSource.ts`).
- "New RFQ for <company>" and "Add X as a new company" only exist in the palette.
- All of Settings (Targets, Exchange rates, Expense categories, Company profile, Your details) is only in the avatar menu (`AccountMenu.tsx`). The mockup put Exchange rates under Money (`money-06…png` strip: GST register, Receivables, Cash month, Margins, Exchange rates). The code moved it into Settings.
- Snooze on Today is an icon-only button.

### 3.4 Inconsistent naming between nav, titles and buttons

- "Money" is both a nav destination and a Today tab.
- The top-bar badge "Money 3" counts Today's money items (`useNavCounts.ts`), but Money opens on the GST register, which shows other numbers.
- The RFQ board says Open / Closed, and won RFQs sit under "Closed" ("Closed and won RFQs", `BoardPage.tsx:318`). The Orders list uses real tabs for the same idea: Active / Done / Cancelled.
- Search placeholders differ on every screen: "Filter RFQs", "Order, PO, customer or site", "Search by name or country", "Invoice or customer", "Search or jump to".
- The engineer's owner switch says "My jobs", but the nav says "Orders".
- The guides drift from the code:
  - `SALES.md` §2 says paste into "Write the enquiry", but that is a step-3 button.
  - `SALES.md` and `ENGINEER.md` call Capture "the + button", but its icon is `Import`.
  - `ADMIN.md` lists the Money tabs in a different order from `moneyTabs.ts`.

### 3.5 Many clicks, dead ends, unclear back paths

- **Dead ends:**
  - Today "Close month" opens the GST register (`rules.ts:694`).
  - The Closed-RFQ filter searches one page only (`BoardPage.tsx:200`).
  - "Issue quotation" is disabled with no reason (`RfqHeaderBlock.tsx:241`).
  - A phone cannot record a payment from Receivables (`ReceivablesPage.tsx:227`).
  - "New order" needs a past order (`NewOrderDialog.tsx`).
  - Intake loses its work when you navigate away.
  - An engineer's Today is empty for assigned jobs (`rules.ts:78`).
- **Back paths:**
  - The RFQ back arrow on a phone always goes to `/rfqs` (`RfqHeaderBlock.tsx:200`), even when you came from Today, an order or a company. Breadcrumbs everywhere name the section list, not where you came from.
  - Team's phone back goes to Today (`TeamPage.tsx:68`).
  - Order and Company detail have no back control in the phone bar, only a breadcrumb at the top of the content. An iPhone home-screen app has no browser back button.
- **Depth:** Month-end reports are 3 nav levels deep (top bar → Money → Month-end → report). On a phone that means two horizontally scrolling strips stacked (`MoneyFrame.tsx` + `MonthEndNav.tsx`).

### 3.6 Role confusion

- Engineers see Today "Bids" and the RFQs tab, but their real work list (assigned jobs) is not on Today (E1).
- Sales see a Money section that opens on the GST register with 2 tabs. Their main need, balances, is the second tab and is named differently from the admin's tab.
- Sales can see balances but cannot record a payment (admin only, `OrderMoneyButtons.tsx`), and the page gives no hint about who can.

### 3.7 Mobile navigation

- **6 bottom tabs at 375 px** gives about 62 px per tab. "Companies" at 12 px with `whitespace-nowrap` (`MobileChrome.tsx:92`) nearly fills its cell, and it will clip on 320–360 px phones. The phone tabs show no counts.
- **Crowded phone bar:** logo, title, search, labelled "Capture" button and avatar (`MobileChrome.tsx:42-60`). The mockups show 4 items (`today-b2-06-mobile-375.png`, `capture-02-iphone-copy-open-paste.png`).
- **Stacked headers on details:** only `TeamPage.tsx` uses `useMobileBar`. RFQ detail therefore shows the default bar ("RFQs", search, Capture, avatar) **and** its own page bar (back, number, …). Add the sticky action bar and the bottom tabs and that is 4 chrome rows. The mockup `rfq-detail-08-mobile-375.png` has one bar and no tab bar.
- **4 horizontally scrolling option strips hide options off-screen:** RFQ state filter (5), Money views (6), Month-end views (8), Settings links (7). `SegmentedControl.tsx:56` uses `overflow-x-auto` and `shrink-0`.
- **Intake has no step indicator on phones** (`IntakeParts.tsx:52`). Receivables cards have no actions (A1).

---

## 4. Scores

| Dimension | Score | Reason |
|---|---|---|
| Navigation clarity | **6/10** | One shell with 6 role-filtered destinations is clear, but Money stacks 3 levels and labels like Bids, Sourcing, Capture and Exceptions don't say what is inside. |
| Findability | **5/10** | Global search is strong (customer refs, POs, invoices, items), but list filters are weaker (Closed RFQs search one page; Companies don't search contacts) and Settings is behind the avatar. |
| Task efficiency | **7/10** | Pre-fills keep core jobs short (chase 2 taps, mark won 4 clicks, close month 4), but wrong destinations, the phone payment gap and intake data loss add detours. |
| Learnability (new, non-technical user) | **4/10** | 31 screens, about 41 dialogs, 2–4 names per action (float/ask/copy enquiry; bid/quote/offer; receivables/order balances), and the one-page guides already disagree with the labels. |
| Mobile navigation | **5/10** | The bottom tabs, share target and sticky RFQ action bar are good, but there are 6 cramped tabs, double headers on detail pages, 4 scrolling option strips and missing phone actions. |

---

## 5. Recommendations (quick wins first)

| # | Change | Where | Effort | Benefit |
|---|---|---|---|---|
| 1 | Point the Today "Close month" item to `/money/month-end`. | `src/features/today/rules.ts:694` | S | Fixes a wrong destination in a monthly admin task. |
| 2 | Make Money open on balances: change the index redirect to `receivables` and put that tab first. | `src/features/money/MoneyScreen.tsx:23`, `moneyTabs.ts` | S | "Who owes us" becomes 1 click; sales land on their only frequent view. |
| 3 | Use one name for balances, e.g. "Who owes us", for both roles. Drop `salesLabel`. | `moneyTabs.ts:13`, `ReceivablesPage.tsx:172` | S | One word to learn; guides match for everyone. |
| 4 | Add "Record payment" (admin) and "Open order" to the phone card and to the reminder panel. | `ReceivablesPage.tsx:227`, `payments/ReminderPanel.tsx` | S | Closes the phone dead end for the most frequent admin job. |
| 5 | Explain or remove the "Issue quotation" lock: show "Add a supplier price, or type your own price" as help, or let the dialog open (it already accepts typed prices and chips). | `RfqHeaderBlock.tsx:241,356`, `quotations/QuotationsPanel.tsx:56` | S | Removes a silent dead end when quoting from stock or own knowledge. |
| 6 | Make the Closed-RFQ filter search the server, or when text is typed on Closed, say "Only this page — use Search at the top" and offer it. | `BoardPage.tsx:200`, `board/api.ts listClosedRfqs` | S/M | Old RFQs become findable by customer ref from the board. |
| 7 | Rename the jargon labels listed in 3.1 (strings only). Start with Today tabs, the board state filter, "Capture", "Procurement legs", "Exceptions", "Bid and close", "Float …". Add the glossary to `DESIGN_SYSTEM.md` §13. | `TodayScreen.tsx:45`, `board/model.ts:47`, `TopBar.tsx`, `MobileChrome.tsx`, `LegsPanel.tsx:73`, `moneyTabs.ts`, `RfqHeaderBlock.tsx`, `IntakeScreen.tsx`, `SuppliersToAsk.tsx`, `CompanyPage.tsx:198` | S (each) / M (all, with tests and guides) | The biggest learnability gain for the least code: one plain name per action. |
| 8 | Rename "New order" to "Repeat a past order". | `OrdersListPage.tsx:204,299`, `NewOrderDialog.tsx:81` | S | Stops users expecting a blank order form. |
| 9 | Merge the two expense buttons into one "Add expenses" (the burst sheet handles one row). | `ExpensesPage.tsx:56-61` | S | One fewer decision on every expense. |
| 10 | Remove the duplicate "Record payment" from the order header (keep the panel's) and the RFQ density switch. | `OrderHeaderBlock.tsx:199`, `BoardPage.tsx:241-251` | S | Fewer controls with no loss. |
| 11 | Fix the back paths: Team back to `/settings`. On the RFQ phone bar use history back with `/rfqs` as the fallback. | `TeamPage.tsx:68`, `RfqHeaderBlock.tsx:200` | S | Back returns to where the user came from (Today, an order, a company). |
| 12 | Remember the WhatsApp/Email choice per person and pre-select it everywhere; show "Email instead" as a link. | `ContextPane.tsx:350`, `IntakeParts.tsx:192`, `ClarificationsPanel.tsx:153`, `SuppliersAsked.tsx:222`, `payments/ReminderPanel.tsx` | S/M | Removes a repeated choice from 5 screens. |
| 13 | Add "Settings", "Exchange rates" and "Team" to the palette "Jump to" list. | `PaletteHost.tsx` `goTo` | S | Hidden pages become searchable. |
| 14 | Update the three guides to the real labels: paste box, Capture icon, Preview → Issue → Share, Money tab order. Make "Start with Today" true for engineers only once #15 lands. | `docs/guides/*.md` | S | The guides stop teaching buttons that don't exist. |
| 15 | Give engineers a Today for their assigned jobs: add a rule over `engineerIds` (commissioning planned in the next N days, goods delivered to site) and hide the "Bids" tab for engineers. | `src/features/today/rules.ts` (new rule, `routesToUser`), `TodayScreen.tsx:104`, `today/api.ts` | M | The engineer's start page shows their real work; matches `ENGINEER.md`. |
| 16 | Keep the intake draft (reuse the Capture IndexedDB store) and show a compact step line on phones. | `IntakeScreen.tsx`, `IntakeParts.tsx:52`, `src/lib/capture/store` | M | No lost pastes. Phone users know which of the 4 steps they are on. |
| 17 | Use the one-bar phone form on detail pages (back + reference + more), as in the mockup, and hide the bottom tabs while the sticky action bar shows. | `RfqDetailScreen.tsx`/`RfqHeaderBlock.tsx`, `OrderDetailScreen.tsx`, `CompanyPage.tsx` via `useMobileBar` (`MobileBarContext.tsx`) | M | Gives back about 100 px of phone height, gives every detail page a back control, and matches `rfq-detail-08-mobile-375.png`. |
| 18 | Simplify the RFQ board filters into one control: "Needs suppliers / Waiting for prices / Ready to quote / Quote sent / Closed" (Mine/All stays). | `BoardPage.tsx`, `board/model.ts` | M | 4 switch rows become 2, worded as the next action. |
| 19 | Flatten Money to 2 levels: tabs "Who owes us · Invoices & GST · Expenses · Month end". Move Margins and Exceptions into the Month-end checklist (they are already its targets, `monthEnd/model.ts:105-130`). Put the six reports and the current `/reports` into one "Reports" view inside Month end. | `moneyTabs.ts`, `MoneyScreen.tsx`, `monthEndViews.ts`, `ChecklistPage.tsx`, `ReportsScreen.tsx` | L | Removes the third nav level and one "things to fix" list. Clears up the Team/Categories/GST name clashes. |
| 20 | Drop the top-level Reports destination (low-frequency, counts only). With #19 that leaves 5 tabs: Today, RFQs, Orders, Companies, Money. Engineers keep 4. | `src/app/navConfig.ts`, `routes.tsx`, `DESIGN_SYSTEM.md` §12 | M (needs owner sign-off; the mockups fix "exactly six") | Wider phone tabs; one fewer place to look; Reports stays reachable inside Money. |
