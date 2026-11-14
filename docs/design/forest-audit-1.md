# Forest final audit, round 1 (15 Nov 2026)

Branch audited: `forest/integ` at e287ad3b. Harness: `e2e/audit-forest/` (suite key `forest-audit`, 8 shards, manual only).
Runs: E2E 43649953306 (run 1, raw) and 43651616893 (run 2, after the harness false positives were removed). The counts below
are run 2. Screenshot paths are relative to `test-results/forest-audit/` inside the run's `playwright-e2e-shard-N` artifacts.

**Verdict: not ready.** 3 blockers, 18 major, 13 minor root causes (34 in all). No money, amount, PO or invoice number reached an
engineer's screen (0 findings in 468 engineer views).

## What was checked

2,342 views: 77 routes x every role that may open them (admin 1,184, sales 681, engineer 468, signed out 9) at 320, 375, 768, 1024,
1440 (+1920 for wide tables); Smaller and Larger text at 375 and 1440; empty, loading and error states at 375 and 1440; long text
(140-character company names, an unbroken 85-character supplier name, a 55-character PO, amounts up to 1e11) at 320, 375, 768
and 1440; every fold opened ("expanded"); 355 dialogs, sheets and menus reached by one click (or one click into a More menu) at
375 and 1440 (and 320 for the admin), plus the command palette at all six widths. Per view: sideways scroll, past-the-viewport,
cut-off and clipped text, overlap and covered controls, touch size (with `(pointer: coarse)` emulated), input font size, axe WCAG 2.1
AA + best practice, rendered-HTML validity, a 15-step Tab sweep for visible focus, console errors, and engineer money. Every view
was photographed; I looked at every route at 375 and 1440 for the admin, every engineer page at 375, and every empty and error
state at 375.

Raw findings (run 2): 6,701, of which 3,972 are one token (minor 17), 832 are axe "could not measure contrast" (checked by eye,
not findings), 769 are one-of-three HTML nesting patterns (minor 14).

## Fix lanes (folders do not overlap)

| Lane | Folders | Blocker | Major | Minor |
|---|---|---|---|---|
| L1 shared | `src/ui/**`, `src/app/**`, `src/lib/**`, `src/index.css` | 1 (3) | 3 (5, 16, 17) | 5 (23-27) |
| L2 jobs | `src/features/jobs/**`, `rfqs/**`, `orders/**`, `statement/**` | 1 (1) | 4 (7, 8, 9, 21) | 3 (29-31) |
| L3 money | `src/features/money/**`, `src/features/reports/**` | 1 (2, with an L1 Money option) | 8 (6, 10-15, 22) | 1 (32) |
| L4 settings, help, companies | `src/features/settings/**`, `help/**`, `companies/**`, `search/**`, `history/**` | 0 | 2 (4, 18) | 4 (33-36) |
| L5 home and capture | `src/features/today/**`, `src/features/capture/**`, I paid | 0 | 1 (19) | 0 |

Item 6 (blank screens) touches L3, L4, L2 and L5 (each fixes its own screens; counted under L3). Item 17's page-level targets go to their
lanes (RatesTable L4, ProfitPage L3, Home rows L5); the shared InfoTip and palette parts are L1.

## Blockers

**1. [L2] Jobs, Sell and Deliver tables break on a long Customer PO.** `src/features/jobs/JobsListPage.tsx:216` draws the PO as
`num whitespace-nowrap`; one 55-character PO widens its column so "Where it stands" shrinks to one word per line and Next step and
Owner are pushed out of the card (sideways scroll inside the card at 1024-1920, Next step cut at 768). Rule `table-sideways` 34 views.
Shots: `jobs/admin-1440-normal-ok.png`, `jobs-deliver/admin-1440-normal-ok.png`, `jobs/admin-768-normal-ok.png`.
Fix: `block max-w-[12rem] truncate` with `title={po}`; give Where it stands and Next step a min width so they never wrap per word.

**2. [L3 + L1] Big amounts are cut or broken mid-number.** `src/ui/Money.tsx:85` keeps every amount on one line (`num whitespace-nowrap`)
and the tiles that hold it clip; the Money home hero lets the number break anywhere (`src/features/money/home/MoneyHome.tsx:103`
`[overflow-wrap:anywhere]` gives "104,116,750 / ,088"). Seen: To collect tiles at 1440 ("PKR 104,116,750,0"), Invoices tiles at 1024,
Payments tiles at 375, Received in November tile at 1440, Sales by person "Quarter to date" at 375, invoice phone cards cut 54 px at 320.
Rule `cut-off` (span.num.whitespace-nowrap) 31 views + visual. Shots: `receivables/admin-1440-normal-ok.png`, `money/admin-375-normal-ok.png`,
`money/admin-1440-normal-ok.png`, `payments/admin-375-normal-ok.png`, `invoices/admin-1024-normal-ok.png`, `report-team/admin-375-normal-ok.png`.
Fix: L1 gives `Money` a `fit` option (font size from a container query, `clamp()` down to the body size, never breaking inside the
digits); L3 uses it in every stat tile and the hero and lets tiles go one per row under ~200 px.

**3. [L1] Segmented controls wrap on phones and look broken.** `src/ui/SegmentedControl.tsx:67-68` is `flex-wrap` on phones by design:
Mine / Open / History drops History to a second row at 320 (and at 375 while "Loading jobs" shares the row), the Companies filter
becomes a 2x2 grid, the Margins filter stacks. Shots: `jobs/admin-320-normal-long.png`, `companies/admin-375-normal-ok.png`,
`margins/admin-375-normal-ok.png`, `jobs/admin-375-normal-error.png`. Fix: one row of equal columns on phones
(`grid grid-flow-col auto-cols-fr`, tighter padding); wrap only past four options.

## Major

4. **[L4] Expense category group names break inside words at 375.** `src/features/settings/CategoriesPage.tsx:281-288`: the group total
(`PKR 54,150 this month`, `shrink-0`) leaves the h2 ~40 px, so "Office runnin / g", "Runnin / g costs". Shot `settings-categories/admin-375-normal-ok.png`.
Fix: on phones put the total on its own line (`max-md:flex-wrap`, total `max-md:basis-full`) or drop "this month" under md.

5. **[L1] Errors are shown late (or never).** With every data request failing, 158 of 176 error views still showed only skeletons
after 9 s (run 1); 27 still did after 20 s (run 2). So screens do reach their error state, but 10-20 s late, which reads as a hang.
Still silent at 20 s: Photo or note "Your jobs" (skeleton forever), Settings home, Weekly review, Team, Export (these show cached data,
acceptable). Look at `src/lib/queryClient.ts` (retry 1) together with supabase-js's own fetch retries; target "could not load" within ~4 s,
and let `Skeleton`/`LoadBoundary` say "Still loading - check your connection" after 5 s. Shots: `*/admin-375-normal-error.png`
(run 1 artifact), `capture/admin-375-normal-error.png`.

6. **[L3, L4, L2, L5] Blank screens when a reference read finds nothing.** In the empty state (lists empty, single-row reads "no row"),
`<main>` was completely blank on: Expenses, Reports, Company and Supplier pages, Team, New RFQ and Photo or note's job list stayed in skeleton.
Each should show its EmptyState or the not-found card. Shots: `expenses/admin-375-normal-empty.png`, `reports/admin-375-normal-empty.png`,
`company/admin-375-normal-empty.png`, `supplier/admin-375-normal-empty.png`, `settings-team/admin-375-normal-empty.png`, `new-rfq/admin-375-normal-empty.png`.
(Confirm each against live: the harness answers a single-row read with PGRST116.) Lanes: Expenses/Reports L3, Company/Supplier/Team L4, New RFQ L2, Photo or note L5.

7. **[L2] Job page and statement skeletons are wider than a phone.** `src/features/jobs/JobPage.tsx:58` (and the statement's loading
grid): the `grid` has no `minmax(0,1fr)` track, so `w-[24rem] max-w-full` sizes the track to 384 px and `#main` scrolls sideways (400 > 375).
Rules doc-overflow + past-viewport on 6 routes. Shot `job/admin-375-normal-loading.png`. Fix: `grid-cols-[minmax(0,1fr)]` on the status grid.

8. **[L2] Imported job contradicts itself.** Job O-2 (direct, imported): the hero chip says "Nothing to do" while the title says
"Imported - Place the supplier order" with a Place the order button. Shot `job-direct/admin-375-normal-ok.png`. Fix in the job hero model:
the chip must follow the same next step as the title.

9. **[L2] Comparative statement figures are monospace.** `src/features/statement/StatementPage.tsx:167` `AMOUNT = 'font-mono tabular-nums'`
breaks the owner rule (figures are Geist sans, tabular). Shot `statement/admin-1440-normal-ok.png`. Fix: `num` (tabular sans).

10. **[L3] Money tables need sideways scrolling on desktop.** GST and FBR by invoice month cuts "Deposited" at 1440; Invoices (long rows) at
1024/1440; Money in and out, Profitability, Overdue by age, Sales by person at 1024. Rule `table-sideways` 29 views. Shots
`report-gst/admin-1440-normal-ok.png`, `invoices/admin-1024-normal-ok.png`. Fix: drop or merge low-value columns under xl, wrap long
customer cells to two lines with a title.

11. **[L3] Long names collapse into one word per line on phones.** Payments (375) and Margins (320, where amounts then go past the
viewport: #main 335 > 320). Shots `payments/admin-375-normal-ok.png`, `margins/admin-320-normal-ok.png`. Fix: name on its own row
above the amounts (stacked card), `line-clamp-2` + title.

12. **[L3] Report rows and reminder dialog cut at 320.** P&L / Reports rows (amounts cut), Payment reminder dialog footer buttons cut.
Shots `report-pnl/admin-320-normal-ok.png`, `receivables/admin-375-normal-dialog-send-a-reminder.png`.

13. **[L3] No visible focus on two inputs.** The date field of Add expenses rows (`src/features/money/expenses/BurstSheet.tsx:955-961`, an
`opacity-0` input over a label: the label needs `focus-within:` ring) and the date input of Set opening cash
(`src/features/money/expenses/CashInHand.tsx:239`). WCAG 2.4.7. 10 views. Shot `expenses/admin-375-normal-dialog-add-expenses.png`.

14. **[L3] axe serious: chart bars' names do not contain their text.** `src/features/money/expenseReport/ExpenseReportPage.tsx:328`
aria-label "Oct 2026: PKR 2,566,200 spent" while the bar shows other text (label-content-name-mismatch, WCAG 2.5.3), 28 views.
Fix: start the aria-label with the visible text.

15. **[L3] axe serious: aria-label on a plain div.** `src/features/money/accounts/GstToFbrPage.tsx:67` (`aria-busy` + `aria-label` on a div
with no role). Fix: `role="status"`.

16. **[L1] Long unbroken names push the detail header sideways at 768.** Supplier page with an 85-character single-word name: #main 805 > 696.
Shot `supplier/admin-768-normal-long.png`. Fix: `DetailHeader` title `[overflow-wrap:anywhere] min-w-0`.

17. **[L1] Touch targets under 44 px on phones.** InfoTip (i) buttons (~24 px, supplier page, Home), palette options, exchange-rate
"Add rate" / "History" text buttons, Profitability 12/24-month segment, "Check for update", Home row icon buttons for sales, Help list
buttons. Fix in `src/ui/InfoTip.tsx` (hit area 48 on coarse), `src/ui/CommandPalette.tsx` option min height; the page ones in their lanes
(RatesTable L4, ProfitPage L3, today rows L5 - counted under L1 here as one shared min-hit rule).

18. **[L4] Company profile: "days" suffix past the edge at 320.** Default payment terms field (`src/features/settings/CompanyProfilePage.tsx`),
#main 344 > 320. Shot `settings-company/admin-320-normal-ok.png`.

19. **[L5] Home detail panel cut at 1024/1440 (sales).** The payment-reminder panel's four-column `dl` (Balance, Overdue by, Was due,
Reminded) clips "Reminded / not yet" by 10 px. Shot `todo/sales-1440-normal-ok.png`. Fix: two columns under ~360 px panel width.

21. **[L2] Engineer job pages: the floating More button covers the status chip of the row under it on first paint at 375.**
Shot `job-not-sent/engineer-375-normal-ok.png`. Fix: right-align it in a full-width bar like the other roles, or add bottom padding equal to the bar.

22. **[L3] Money page headings are inconsistent.** Margins, Profitability, Review imported, GST to FBR, Bank check and Mistakes to fix show
H1 "Money" and a small section title; Payments, Invoices, Lock a month, Reports, Expenses and To collect use the page name as H1.
Shots `margins/admin-1440-normal-ok.png` vs `payments/admin-1440-normal-ok.png`. Pick one (the page name as H1, Money in the breadcrumb).

## Minor

23. **[L1] Forest touch size 48 is not applied to `min-h-touch`.** `src/index.css:256` `--hit-touch: 44px`; under `(pointer: coarse)`
(index.css:381) controls become 48 but the top bar icon buttons, list rows, links and dialog footer buttons stay 44. 3,972 views
(rule touch-target-48), one token. Fix: set `--hit-touch: 48px` inside the coarse block.
24. **[L1] HTML: block content inside phrasing elements.** `label > div` in the form Field/Select wrapper (`src/ui/form/*`), `span > div` round
the DataTable row checkbox (`src/ui/DataTable.tsx`), `span > div[role=group]` round the report MonthPager (L3, reports toolbar). 769 views.
Fix: use div/fieldset wrappers.
25. **[L1] Not-found and no-access pages say "Go to Today".** `src/app/pages/NotFoundPage.tsx:12`, `src/app/pages/NoAccessPage.tsx:49`; the
place is called Home now.
26. **[L1] Collapsed rail at 768: the Home count badge sits on the icon.** Shot `todo/admin-768-normal-ok.png`.
27. **[L1] axe scrollable-region-focusable on #main** (Tax deadlines, sales, phones): main is scrollable but not keyboard focusable.
29. **[L2] Job pages, statement: no h1 while loading or on error** (axe page-has-heading-one, 64 views). Give PageSkeleton and the error
EmptyState a visually hidden h1.
30. **[L2] Job side card: "No contact person is set" hangs indented under the label** (`src/features/jobs/JobSide.tsx:48` `pl-8`), carried from
the plan's audit note. Shot `job-delivered/admin-1440-normal-ok.png`.
31. **[L2] Job page stage ruler: Payment stop drawn as a larger hollow ring** when an advance is received (job-order, job-multi-leg,
job-po-issued) - reads like a different control. Confirm with the mockup.
32. **[L3] Report toolbar MonthPager wrapped in a span** (see 24).
33. **[L4] Help panel adds a second banner landmark** (`src/features/help/HelpPanel.tsx:103` `<header>` inside the dialog), 15 views. Use a div.
34. **[L4] Settings sub-nav truncates "Company profile" / "Tax deadlines"** at 320 (sales, engineer) and at 1440 with Larger text, no title.
35. **[L4] Supplier page RFQ lines hide the quantity** ("x999") under the item name's line-clamp-2 at 768-1440. Put the quantity outside the clamp.
36. **[L4] Team, empty list: contrast 2.09** on `.border-primary` text (#9aa39d on #e6e8e0) at 375.

## Not findings (false positives, harness fixed)

- Run 1 `axe:aria-valid-attr-value` (342): the harness itself set `aria-expanded="audit-skip"`; now marks folds with `data-audit-tried`.
- Run 1 `dialog-not-open` (34): phone sheets did open; the wait matched a hidden `aside` first. Now waits for a visible one.
- Run 1 touch sizes: `hasTouch` does not make `(pointer: coarse)` match in headless Chromium, so phones measured desktop sizes. The
  harness now emulates pointer/hover through CDP (`coarse()` in lib.ts) and reports a harness finding if a phone page is not coarse.
- Run 1 `overlap` (1,531) and `covered`: content scrolling under the phone tab bar and the sticky action bar was measured unclipped. Boxes are
  now clipped by their scroll ancestors and pairs across a pinned bar are skipped.
- Run 1 `no-h1` (752) and `cut-off` on the job header link (153): phones keep the h1 visually hidden (`max-md:sr-only`); hidden-box ancestors
  now count as hidden.
- Run 1 `console-error` (81): `ERR_BLOCKED_BY_CLIENT` from the harness's own write firewall (writes refused while openers are clicked).
- Run 1 `focus-hidden` (19): Radix focus guards. Skipped.
- `wrong-page`: "Team is for admins" and "Sell is for admin and sales" (engineer) are the expected no-access pages.
- `clipped-text` 602 -> 5: the Items column carries the raw item list as its title; accepted.
- `cut-off` on statement / company header separators: the "·" is pulled into the margin and clipped on purpose; skipped from round 2.
- Run 2 touch-target-44 on job step rows (317x5, 317x43 ...): rows half under the sticky bar were measured by their visible part; the
  harness now only sizes targets that are wholly in view.
- 24 px checkboxes on phones (run 1 touch-target-44, 142): their label is part of the tap target; the harness now sizes checkbox + label.
- `axe-review:color-contrast` (832): axe could not measure (status chips on tinted rows, hero gradient, overlapping boxes). Checked by eye on
  the screenshots: readable. Not counted.
- `harness` (4): the job page's sticky More could not be clicked at 320/375 for a few runs (re-rendered while clicking); its menu was
  covered at the other widths.

Known harness limits: React warnings do not appear (production build); empty state answers single-row reads with PGRST116 and leaves RPCs
real; long-text lists show the long rows next to the normal ones (the same data in "ok").

## Re-run

`gh workflow run e2e.yml --ref <branch> -f suites=forest-audit`, then download the 8 artifacts and
`node scripts/audit/forest-merge.mjs --out merged <shard dirs>/test-results/forest-audit` (findings.json, summary.json).
