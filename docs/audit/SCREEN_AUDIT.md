# Screen audit

A repeatable measurement of the **real built app** (not the mockups): every main screen and key state, for each role, at four
viewports, on the local CI stack with realistic seeded data. It exists so the UX audit (`docs/audit/ux-2026-10-19/`, 5.3/10) can be
re-scored from numbers after the UX branches land, and compared run against run.

The audit measures every target and only the **layout gate** fails the run (see "What 100% means" and "The layout gate" below); the
older rubric targets stay advisory. A failed seed also fails the run. It is not an E2E suite and never runs on push or pull request.

## What 100% means

A pass rate in the report is the share of captures that meet one target, nothing more. "100% of layout checks pass" means: on the screens,
dialogs, roles and widths that were visited, in the seeded data, the checks below found nothing. It does **not** mean the app has no layout
bug. It does not cover: any screen or dialog that is not in `screens.ts`; a width that was not run (the standard run uses 1440, 375 and 320;
the layout set adds 768, 1024, 1280 and 1600); a state the seed does not produce (a long name, a failed request, 40 rows); the sales and
engineer roles in the layout set; a menu or popover that was not opened; or a bug only an eye sees (a colour, a crooked alignment, an
awkward gap). Shots are taken with scrollbars drawn (as in Windows Chrome), so a second scrollbar shows in them. Review the 1024 and 1600
shots by eye after a run that matters: the checks are a net, not a judge.

## The clarity ratchet

Each capture also carries `clarity`: `firstWorkY` (top of the first `[data-work]` element at scroll 0), `boxDepth` (deepest chain of nested
boxes: a visible element in the page with a border on 3 or more sides, a radius above 0 and 2000 px2 or more; controls, chips and inputs are
not boxes), `boxesAtFold` (boxes that cross the fold line) and `stepRowMax` (tallest `[data-stages] [data-fold-row] > button`, else
`[data-stage] h2 button`). `contentHeight` and `actions.aboveFold` are reported with nothing left out. Advisory targets: `firstWorkY` 264,
`boxDepth` 2, `boxesAtFold` 4, `stepRowMax` 52, `aboveFold` 12, phone job pages 1300 px closed and 2500 px with one step opened.

`node scripts/audit/report.mjs <dir> --gate clarity` compares every capture with its budget in `scripts/audit/clarity-budgets.json` (keyed
`role/screen/viewport`) and exits 1 only for a value worse than its budget: +8 px for heights and Y values, +0 for counts. A capture with no
budget is listed, never failed. Words are reported, never gated. After a change that makes a screen clearer, run the audit and
`node scripts/audit/report.mjs <dir> --write-budgets` (it merges into the file) to lower the budget; the file is part of the review.

## The layout gate

`node scripts/audit/report.mjs <dir> --gate layout` exits 1 when any capture fails one of these (the workflow's last step; each is
measured in `e2e/audit/collect.ts`, `metrics.layout`, after scrolling back to the top). Everything else is advisory.

| Check | Fails when |
|---|---|
| `docScroll` | In the shell with no dialog open: the document is taller than the window (`scrollHeight > innerHeight + 1`); or `scrollTo(0, 1e6)` moves the window; or the shell's bottom is not the window's bottom. Absolute boxes past the bottom edge are listed as the likely cause |
| `nestedScroll` | A box inside `<main>` or a dialog scrolls up and down on its own (overflow-y auto or scroll with real overflow). Inside a dialog, any box that scrolls sideways counts too. Left out: `<main>`, `[data-virtual]`, `pre`, `textarea`, `select`, list boxes, menus, tooltips, popovers, `[data-scroll-ok]`, the whole of Today (its panes scroll on purpose) and a dialog's own body (the outermost scroller). No app file carries `data-scroll-ok` yet: adding it is an app change, so the exclusions are by selector here |
| `boxOverflow` | A box with overflow visible is shorter than its content (`scrollHeight > clientHeight + 1`) and ordinary text, not positioned, clipped or scrolled by a closer box, sits more than 2 px below its bottom edge. The innermost box is reported. This is the check for a label taller than its row (the Add expenses sheet's header: 44 px of text in a 36 px box) |
| `labelTouchesControl` | Text that overlaps an input, select, textarea or button sideways, that is not its own (not inside it, not its `<label>`), and whose bottom reaches the control's top minus 1 px (or crosses it). Left out: `pointer-events: none` text, text inside any control, `aria-hidden`, alerts, toasts and fixed layers, text positioned over a field on purpose (an adornment) |
| `hScroll` | The older sideways-scroll check (document or `<main>` wider than the window) |
| `unevenWrap` | **Advisory, never gates.** A label of three words or fewer wraps onto two lines beside one-line siblings in a flex or grid row |

**The layout set** is the quick run for the gate: `gh workflow run screen-audit.yml --ref <branch> -f ref=<sha> -f set=layout`.
Admin only, at 768x1024, 1024x768, 1280x800, 1440x900 and 1600x900, with `AUDIT_AXE=0` and `AUDIT_FULL=0` (about 10 minutes). It visits
expenses, month-end, an expenses report, the Jobs list, a Job page with an order (PO issued and delivered), a company page, Today and
Settings > categories, and these dialogs: Add expenses (the sheet), Add expense (`?add=1`), Pay a supplier, Recurring template, Issue
quotation, Mark won (the Convert dialog), Invoice detail, Chase goods and the expenses Filter sheet. The visits are `LAYOUT_IDS` and
the `lg-` ones in `screens.ts`; the standard run does not open them. The standard run is unchanged (its viewports, roles and
screens) and now ends with the same gate, so it is red when it finds a layout bug.

## Run it

**Any branch, tag or SHA, in GitHub Actions** (about 25 minutes; one job per role in parallel, then a report job):

```
gh workflow run screen-audit.yml --ref test/screen-audit -f ref=main
gh workflow run screen-audit.yml --ref test/screen-audit -f ref=ux/rfqs
gh run list --workflow screen-audit.yml --limit 3
gh run download <run id> -n screen-audit -D <somewhere outside the repo>
```

`--ref` is the branch whose workflow file and audit code run (`test/screen-audit` until it is merged, then `main`); `-f ref=` is the
app being audited. GitHub only dispatches a workflow whose file is also on the default branch (`main`): until
`.github/workflows/screen-audit.yml` is on `main`, `gh workflow run` answers "workflow screen-audit.yml not found on the default
branch". The audit code (`e2e/audit/`, `scripts/audit/`) is copied onto the audited checkout, so a ref made before the audit
existed can be audited too. Optional inputs: `roles` (default `admin sales engineer`), `viewports` (default
`1366x768 1920x1080 375x812 320x640`; the workflow's own default is `1440x900 375x812 320x640`), `set` (`standard` or `layout`) and `screens` (a regular expression over visit or screen ids, for a quick partial run, e.g.
`-f screens='^(today|job-quoted)$'`).

**Locally**, with a fresh local stack (Docker):

```
npx supabase start && npx supabase db reset
eval "$(npx supabase status -o env | sed 's/^/export /')"
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run build
AUDIT_ROLES=sales npx playwright test -c e2e/audit/playwright.audit.config.ts
node scripts/audit/report.mjs
```

Environment: `AUDIT_SET` (`layout` for the layout set), `AUDIT_ROLES`, `AUDIT_VIEWPORTS`, `AUDIT_SCREENS`, `AUDIT_DIR` (default `test-results/screen-audit`, git-ignored; the workflow uses `audit-out`), `AUDIT_AXE=0` and `AUDIT_FULL=0`
(skip axe or the full-page shots for a faster run).

## What comes out

The `screen-audit` artifact (and `test-results/screen-audit/` locally):

| File | What |
|---|---|
| `audit-report.md` | The targets with pass rates per viewport, the worst 5 screens per metric, what could not be measured, then one table per role and screen (a row per viewport, with links to the screenshots) |
| `audit-summary.md` | The first two parts only (also shown on the workflow run's summary page) |
| `audit-results.json` | Everything: meta (ref, SHA, time), targets, summary, and every capture with its metrics, axe counts, score and screenshot paths |
| `shots/<role>/<screen>/<viewport>-fold.png` | One screen without scrolling |
| `shots/<role>/<screen>/<viewport>-full.jpg` | The whole page (the app scrolls `<main>`, so the viewport is made as tall as the content, at most 15,000 px) |
| `parts/*.json`, `seed.json` | The raw per-role results and the seeded record ids |

To compare two runs, download both artifacts and compare `audit-results.json` (`summary.byTarget`, or per capture by role, screen
and viewport).

## What is visited

The Jobs screens (2026-10-26): the Jobs list (open and history), a Job page in each stage (`job-not-sent`, `job-waiting`, `job-prices-in`, `job-quoted`, `job-po-issued`, `job-delivered`, `job-paid`, `job-commissioning`, plus `job-order-not-placed`, `job-invoiced` and the supplier comparison `job-compare`; the engineer's Job page is the same screens run as an engineer), New enquiry (`enquiry-new`) and Money > Review imported (`review-imported`). The Job pages are opened through the old `/rfqs/<id>` and `/orders/<id>` addresses (which keeps the redirect under the audit). The old `rfq-*` and `order-*` captures of the removed RFQ and Order pages are gone (2026-10-30).

`e2e/audit/screens.ts` is the one list (routes and button names change as the UX work lands; adjust it there). Per role, as far as
the role can reach: Today (with items); the Jobs list and a Job page in each stage (see above, including the supplier comparison: 4 suppliers in 3 currencies, scrolled to the ranked prices); Companies, a customer and a
supplier; every Money view (GST register, receivables, expenses, the month-end checklist, bank tick, the six month-end reports,
margins, exceptions); Reports; every Settings page including Team; the Job page's Add to this job card with a supplier's reply
pasted in (`add-to-job-pasted`, admin and sales; the empty card is on every Job page capture; nothing is saved and the box is emptied afterwards); the weekly
review (`weekly-review`), Photo or note's which-job page (`capture-pick-job`) and the engineer's I paid page (`engineer-i-paid`); the Issue quotation
dialog on the prices-in RFQ (`issue-quotation`, admin and sales); and New RFQ steps 1 to 4 (items pasted, suppliers, the message,
sent), driven through the real screen with the old and the plain-words button names (last, as it creates an RFQ).

A dialog is measured on its own: the visit passes `root: '[role="dialog"]'`, so the metrics count inside the dialog instead of
`<main>`, everything outside it counts as covered, and the full-page shot grows by what the dialog's own scroller hides.

The data (`e2e/audit/seed.ts`) is a small trading company's month: 10 customers, 6 suppliers in 5 currencies, a prospect, about
20 open RFQs, 8 closed ones (lost on price, to a competitor and other reasons) and 1 won (quoted, then made into an order by
`convert_rfq_to_order`), 14 orders in every state, invoices, payments, expenses, targets and exchange rates. Records are owned by
all three users so every Today has items. Dates are relative to the day of the run.

## How each number is taken

All counts are of **visible** elements: a box larger than 1 px that `checkVisibility()` passes and that no screen-reader-only clip
(`sr-only`, as on "Skip to content") hides.
"Fold" means some part is on screen without scrolling (inside the viewport and every scrolling ancestor). Text size is the default (no
"Smaller text" preference).

| Metric | Definition | Target |
|---|---|---|
| Green buttons on screen | Enabled primary-variant buttons and links (as below) a person sees without scrolling **anywhere**: `<main>`, the top bar and the phone bars together; hidden ones and anything under an open modal dialog left out. Labels outside `<main>` end in `[bar]`. 0 is listed as info, not failed (a list or settings page may have none) | at most 1 (rubric: exactly one green main button) |
| Primary buttons | Buttons and links in `<main>` drawn as the primary variant: class `bg-primary` (`src/ui/Button.tsx`), `data-variant="primary"`, or the primary background colour; enabled ones only (a disabled primary is drawn grey and is listed apart, marked "disabled"). The top bar's Capture button is counted apart ("in chrome") | at most 1 (plan step 2) |
| Header chips | Status chips inside the page header: the `<header>` that holds the page's `<h1>`, else a band from the `<h1>` to 96 px under it. A chip is a `StatusBadge` (`[data-status]`) or any small inline bordered rounded label (14 to 32 px tall, 1 to 48 characters, not a control, not `<kbd>`); nested chips count once | at most 2 (plan step 2) |
| Characters at 14 px or more | Share of the visible characters whose computed font size is 14 px or larger (under 14, 14 to 15.9 and 16 and over are all recorded, with a per-size histogram) | at least 95% (rubric-10) |
| Sideways scroll | The document or `<main>` is wider than the viewport; the widest elements not inside their own scroller are listed | none |
| axe | axe-core with WCAG 2.2 AA plus best practice, as the E2E suites run it (`e2e/support/axe.ts`): failing nodes and rules | 0 |
| Phone tap targets | On viewports under 768 px (emulated as a touch phone, so `pointer: coarse` applies): every link, button, input, tab, radio, checkbox, menu item and option; size is the smaller side of its box (a native control takes its label's box). Inline links inside a sentence are left out (WCAG 2.5.8) | 0 under 44 px |
| Navigation strips | `nav` landmarks and tab lists visible above the fold, outside dialogs, breadcrumbs and pagers left out | at most 2 (plan step 3) |
| Clipped text | Elements whose own text is wider or taller than their box with overflow hidden or clipped, or an ellipsis. A deliberate line clamp whose whole text is in the element's `title` (a long item list in a windowed table) is a shown cut and is listed with the ellipses, not counted | 0 |
| Text cut or off screen | Text nodes cut off by an overflow hidden/clip box with no ellipsis or line clamp (either axis; a few px of glyph overhang down is allowed), plus text and controls running past the viewport's right edge while the page itself does not scroll sideways (a filter strip whose search box is cut off at 375 px) | 0 |
| Sideways scrollers | Info: boxes other than `<main>` and form fields that scroll sideways on their own (`scrollWidth > clientWidth`, overflow-x auto or scroll), listed with how much they hide | - |
| Green buttons, whole screen | Primary buttons in the page plus the top bar (`inMain + inChrome`). **Exactly 1.** A screen with no single next step (To do, Settings, a report, an engineer's Job page whose action is in the On site card, an engineer's Jobs list) marks itself with `<NoPrimary />` (`src/ui/NoPrimary.tsx`, a hidden `data-no-primary` element); the audit then accepts 0. Two or more always fail, marker or not | exactly 1, or 0 on a `data-no-primary` screen (rubric-10; 2026-10-26) |
| Actions above the fold in the page | Page-level buttons and links inside `<main>` that can be seen without scrolling (the top bar and tabs left out): the header, toolbar, filters, the next-step band. Left out, and counted apart (`rowActionsAboveFold`): per-row actions (inside a `data-row-actions` container, a table row or column header, or a list item, so a list's own buttons never count), navigation and choice controls (a `nav` landmark, a tab list, `data-nav-strip` such as the Job page's stage headers, a button group like a month pager, a toggle or radio) and the (i) tips (`data-infotip`). The report lists the labels it counted | at most 8 (rubric-10; row actions excluded 2026-10-26) |
| Text over text | Two visible text lines on the same layer (the page, one dialog or popover, one fixed or sticky bar) whose painted boxes, clipped to what can be seen, cross by more than 3 px each way and 15% of the smaller box | 0 |
| Boxes that scroll sideways (phones) | Elements with `overflow-x: auto` or `scroll` whose content is wider than they are (a filter strip, a table wrapper), outside text fields | 0 |
| Highlighted-row contrast | Text whose nearest opaque background is a highlight (`bg-selected`, `bg-sunken` or a tone tint, read from the app's classes): 4.5:1 for a control label or a heading, 7:1 for everything else; disabled controls exempt | 0 (rubric-10) |
| Phone text fields | On viewports under 768 px: visible inputs, textareas, selects and editable boxes whose computed text is under 16 px | 0 (rubric-10) |
| Info only | Buttons and links (fold and page), words (fold and page), chips on the page, most table columns, page length in screens | - |

Browsers run with scrollbars drawn (`ignoreDefaultArgs: ['--hide-scrollbars']` in the audit config) so the shots and widths match Windows Chrome.

Known limits: a tap area widened by a pseudo-element (the InfoTip's 44 px area on touch) is measured by its box, so it reads small;
a page whose panes scroll on their own (Today's list and pane) shows only the first screen of each pane in the full-page shot; chips
and the header are found by shape and position, so a redesign can move them in or out (the report lists the labels it counted).
