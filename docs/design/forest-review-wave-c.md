# Forest review after round 3, money (cohesion and polish lane, polish-c)

Date: 14 Nov 2026. Base: `forest/integ` at 57109193 (foundation, wave A + polish-a, round 2 + polish-b, round 3: C1 invoices #54,
C2 credit, statement and profit #52, C3 lock a month and checks #51, C4 reports #53, C5 expenses #55).

How this was made: fresh pictures of every money screen at 1440 and at 375 from CI (`e2e/money/zz-forest-review-c.spec.ts`, run in the
`money-costs` suite, the `review-shots` artifact, `pc-<screen>-<width>.png`; the window grows to the content so each picture is the
whole page, dialogs are the window as it is), as admin, sales (no access, I paid) and engineer (I paid). Set beside each other, beside the
round 1 and 2 pictures (Home, Companies, Sell, the job page) and beside the approved mockups 50-64 (`proposal-2026-11`, rendered).
Pictures: `docs/screens-2026-11-14/polish-c/` (`before-*` from 57109193, `after-*` from this branch). Every picture is checked for
sideways scroll at both widths: none, before or after.

## First impression

Round 3 brought every money screen into the Forest family one lane at a time, and each lane's own screen is close to its mockup. What
breaks the "one product" feeling is that the lanes drew the same parts three ways: the money summary is a one-line strip on the
reports, To collect and In and out, a squared tile box on Payments and Bank check, and loose lines on a phone, while every mockup draws
one white sum card with heavy figures. Tables sit square-cornered and edge-to-edge on desktop beside rounded cards (the clarity lane's
"no box from 768" survived on six tables). GST to FBR is still the pre-Forest page with amber and red tinted blocks. The month pager has
three looks. Several money dialogs lack the icon tile that wave B put on every dialog. And at 375 a few rows break in the worst place:
a figure split across two lines ("+1,652,3 / 74"), a chevron alone under its row, a tag broken inside its pill.

## Ranked findings

| # | Finding | Where | Severity | Fix | Status |
|---|---------|-------|----------|-----|--------|
| 1 | The money summary has three looks: a one-line strip between hairlines (Profit and loss, Overdue by age, Payable to suppliers, GST and FBR, Sales by person, In and out, To collect), a squared tile box (Payments, Bank check, Invoices), and loose label/figure lines on a phone. Every mockup (51, 52, 53, 58, 59) draws ONE white sum card with heavy PKR figures. | Money summaries | High | `SumBar` tiles are the Forest card (`rounded-card`, `shadow-e1`, heavy figures, 14 px context line); a `caption` sits above the card instead of being lost with the strip; the phone lines sit in the same card. The strip is dropped on every money view. | Fixed |
| 2 | Tables de-carded on desktop (`md:rounded-none md:border-x-0`): To collect, Overdue by age (and its Advances), Payable to suppliers and its no-rate banner, GST and FBR, Sales by person, Money out by category, The last 6 months. Square corners and no side edges beside the rounded cards around them. | Reports, To collect | High | The overrides removed: each table is the one card; Advances held closes the Overdue card. | Fixed |
| 3 | GST to FBR is pre-Forest: months as amber (soon) and red (late) tinted blocks with `rounded-panel`, a red alert strip for the error, two grey boxes as the skeleton. Live bug 24: a month not fully paid listed its only PSID with "(not deposited yet)" even when its deposit is recorded. | GST to FBR (F-380-383, F-778) | High | Every month a white card (58 #gst-cards): month, the three figures with a hairline before To pay, the status in its ink with its icon (paid green, soon brown, late red); error as a card with Try again; a skeleton shaped like the cards; WHT as a card. Each PSID with a recorded deposit now says its own day (unit test). | Fixed |
| 4 | Money in and out on desktop: Cash in and out, Profit on invoices and Why profit and cash differ lie flat on the canvas, between card-tables, the total lines on a 2 px rule. Mockup 59 #rp-inout draws each table as a card with its title above it and the total row tinted. | In and out (C4 leftover, F-391, F-784) | High | Both tables are cards (header row, 20 px inset), total rows on the Profit and loss result tint; Why profit and cash differ a card; the phone fold row is a card too. | Fixed |
| 5 | `FoldRow figure` at 375: the chevron wrapped under the row with the figure (To approve on Expenses, the job page's Money row), and In and out's Why profit and cash differ (not `figure`) broke its amount mid-number: "+1,652,3" over "74". | FoldRow, Expenses, In and out, Job page | High | `figure` rows are a grid [icon, words, chevron]: the figure moves under the title, right-aligned and whole, the chevron keeps its own column. In and out's row uses `figure`. | Fixed |
| 6 | Three month pagers: outlined step buttons (Lock a month, reports, In and out), a grey pill with flat chevrons (Expenses list, Expenses report), and Payments' pager floating with no bar while Lock a month and Bank check put it in a card. | All month views | Moderate | `PeriodStepper` (MonthEndFrame): one look for every month and quarter pager; Payments' pager sits in a month-bar card as on Lock a month and Bank check. | Fixed |
| 7 | Dialogs without the icon tile wave B put on every dialog: Refund customer, Apply credit, Lock a month, Reopen, Mark costs complete, Record payment, Which order?. Statement, Create invoice and Void have it. | Money dialogs | Moderate | Icon tiles (undo, arrows, lock, open lock, clipboard check, banknote). | Fixed |
| 8 | Report panel headers at 375 squeeze the title into a column beside the clock tag ("By / payment / date" on three lines); "Where the money went" breaks into two lines at 1440 beside its amount; Bank check's "Bank expenses and FBR payments" tag breaks inside its pill. | Reports, Bank check | Moderate | The title row wraps the note under the title whole; tags never break (`whitespace-nowrap`); the amount stays one piece. | Fixed |
| 9 | The no-access page (sales on an admin money page) is a dashed placeholder box; 58 #money-checks-sales and 59 #rp-noaccess draw the white card. | F-779, F-781 | Moderate | The one card around the same words and Go to Today (live words kept, GATE2). | Fixed |
| 10 | Job page: Contact's "No contact person is set" right-aligned beside the title broke into a ragged two-line block in the 340 px side column (audit note); the header split "Job" from "O-22" across lines; the Money row printed PKR on Sale only; the Invoice stop's quiet buttons and link started at three different left edges on a phone. | Job page (F-019, F-318, F-764) | Moderate | The sentence sits under the title; the job code never breaks; the row's figures share the title's "(PKR)"; the Invoice stop puts the outlined button first and gives the quiet buttons and the link one inset, so their icons line up. | Fixed |
| 11 | Profitability's two averages lie bare on the canvas while the Money hub's figures are cards. | Profitability | Moderate | Each average is a figure card (and its skeleton). | Fixed |
| 12 | DataTable: the toolbar is inset 16 px, the cells 20 px, so the title and the first column do not line up; a flat table's "Showing" band is indented and its empty message has no top padding; a long group label never wraps. | DataTable (src/ui) | Minor | Toolbar and band share the cells' 20 px; flat band flush, flat empty padded; group and footer labels wrap (a windowed table keeps one line). | Fixed |
| 13 | Lock a month: the dialog's one sentence ("This locks October only...") sat at the foot beside Cancel; mockup 57 opens the body with it. | Lock dialog | Minor | Moved to the top of the body. | Fixed |
| 14 | The Margin panel's headline used the display size at medium weight; every other headline figure (hub, credit card, Profitability) is the heavy KPI step. | Money / Margin (src/ui) | Minor | `Money size="kpi"` (heavy); the Margin panel uses it. | Fixed |
| 15 | Statement PDF notes kept the server's "Rs" (the dialog already read PKR). | Statement PDF (F-343, F-561) | Minor | `rupeesToPkr` on each note. | Fixed |
| 16 | Quick add (E key) shows one 220 px grey box while categories load; As of on Overdue by age is a fixed 232 px field (F-783). | Quick add, Overdue by age | Minor | Skeleton shaped like Quick add; the As of field fills the row on a phone. | Fixed |
| 17 | Lock a month wraps the cash card in arbitrary-selector overrides (radius, padding, shadow it already has); its "hide the icon below 360" selector matched nothing. | Lock a month | Minor | Overrides removed (CashInHandLine draws the card); the icon tile hides below 360. | Fixed |
| 18 | `profit.spec.ts` ran in no suite (money-costs matched costs.spec only); once run, its no-access check matched "Profitability is for admins" by substring. | e2e | Minor | money-costs matches `money/.*\.spec\.ts`; the heading check is exact and sales see the no-access heading. | Fixed |
| 19 | Figures are set in Geist (sans, tabular); every mockup sets amounts in Geist Mono. | Everywhere | Moderate | `.num` is F1's token decision in `src/index.css` (outside this lane). For the lead. | Not fixed |
| 20 | I paid (engineer and sales): Date is the browser's own date field ("11/14/2026"); every other form uses DateInput ("Sat 14 Nov 2026"). | I paid | Minor | Needs DateInput to carry `max` (no future day) first; behaviour change on the engineer flow. For C5 / lead. | Not fixed |
| 21 | To collect: mockup 51 draws a card per balance; live keeps the table (A4). | To collect | Minor | A4 decision. | Not fixed |
| 22 | DataTable phone "a card per row" option (C1 leftover). | DataTable | Minor | No money screen needs it once the summaries and tables are cards; not built. | Not fixed |

### Consistency details checked

| Element | Before | After |
|---------|--------|-------|
| Money summary | strip / squared box / loose lines | one sum card, heavy figures, caption above |
| Tables on desktop | square, no side edges (6 tables) | the one card |
| Month pager | three looks | one `PeriodStepper` |
| Dialog header | icon tile on some money dialogs | on every money dialog |
| Fold row with a figure | chevron wraps, figure breaks | chevron column, figure whole |
| No access | dashed box | white card |
| GST to FBR | tinted blocks | white cards, status ink |

### Accessibility

- Names, regions and test ids unchanged (`gst-months`, `status-*`, `psid-*`, `in-out-why`, `order-balance`, `expense-report-period`,
  "Balance by status, includes GST", "Cash in and out"); the pager buttons keep "Previous month" / "Next quarter"; the GST status is an
  icon plus words, never colour alone.
- The SumBar caption is a visible line above the card (it was dropped by the tiles before).
- Touch sizes unchanged (pager steps 48 on touch); no sideways scroll at 375 or 1440 on any money screen (soft-checked in the spec).
- Engineers: no money word or amount added; I paid unchanged.

### What works well

- Lock a month (C3) and the Money hub (A4) are the reference: forest hero, white cards, one action; this pass aligned the reports to them.
- The Invoices register (C1) and Expenses (C5) already read as Forest lists; their summaries now match the rest.

## Left for later lanes

- `.num` in Geist Mono (F1), I paid's DateInput (C5), To collect as cards (A4 / owner), F-788 "Nothing waiting on you" (owner).
- F-781: sales on an admin report address meet "Money reports is for admins" with the live "Go to Today" (GATE2 keeps live words).
