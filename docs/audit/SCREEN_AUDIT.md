# Screen audit

A repeatable measurement of the **real built app** (not the mockups): every main screen and key state, for each role, at four
viewports, on the local CI stack with realistic seeded data. It exists so the UX audit (`docs/audit/ux-2026-10-19/`, 5.3/10) can be
re-scored from numbers after the UX branches land, and compared run against run.

It measures; it never fails on a finding. It is not an E2E suite and never runs on push or pull request.

## Run it

**Any branch, tag or SHA, in GitHub Actions** (about 25 minutes; one job per role in parallel, then a report job):

```
gh workflow run screen-audit.yml --ref test/screen-audit -f ref=main
gh workflow run screen-audit.yml --ref test/screen-audit -f ref=ux/rfqs
gh run list --workflow screen-audit.yml --limit 3
gh run download <run id> -n screen-audit -D <somewhere outside the repo>
```

`--ref` is the branch whose workflow file and audit code run (`test/screen-audit` until it is merged, then `main`); `-f ref=` is the
app being audited. The audit code (`e2e/audit/`, `scripts/audit/`) is copied onto the audited checkout, so a ref made before the audit
existed can be audited too. Optional inputs: `roles` (default `admin sales engineer`), `viewports` (default
`1366x768 1920x1080 375x812 320x640`) and `screens` (a regular expression over visit or screen ids, for a quick partial run, e.g.
`-f screens='^(today|rfq-quoted)$'`).

**Locally**, with a fresh local stack (Docker):

```
npx supabase start && npx supabase db reset
eval "$(npx supabase status -o env | sed 's/^/export /')"
VITE_SUPABASE_URL=$API_URL VITE_SUPABASE_ANON_KEY=$ANON_KEY npm run build
AUDIT_ROLES=sales npx playwright test -c e2e/audit/playwright.audit.config.ts
node scripts/audit/report.mjs
```

Environment: `AUDIT_ROLES`, `AUDIT_VIEWPORTS`, `AUDIT_SCREENS`, `AUDIT_DIR` (default `test-results/screen-audit`, git-ignored; the workflow uses `audit-out`), `AUDIT_AXE=0` and `AUDIT_FULL=0`
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

`e2e/audit/screens.ts` is the one list (routes and button names change as the UX work lands; adjust it there). Per role, as far as
the role can reach: Today (with items); RFQ list open and closed; an RFQ in each stage (not sent to suppliers, waiting for prices,
prices in, quotation sent); the supplier comparison (4 suppliers in 3 currencies, scrolled to the ranked prices); Orders list; an order
not placed, with a PO issued, delivered, invoiced, paid, and one with 3 supplier orders and commissioning; Companies, a customer and a
supplier; every Money view (GST register, receivables, expenses, the month-end checklist, bank tick, the six month-end reports,
margins, exceptions); Reports; every Settings page including Team; and New RFQ steps 1 to 4 (items pasted, suppliers, the message,
sent), driven through the real screen with the old and the plain-words button names.

The data (`e2e/audit/seed.ts`) is a small trading company's month: 10 customers, 6 suppliers in 5 currencies, a prospect, about
20 open and 8 closed RFQs, 13 orders in every state, invoices, payments, expenses, targets and exchange rates. Records are owned by
all three users so every Today has items. Dates are relative to the day of the run.

## How each number is taken

All counts are of **visible** elements: a box larger than 1 px (so screen-reader-only text is out) that `checkVisibility()` passes.
"Fold" means some part is on screen without scrolling (inside the viewport and every scrolling ancestor). Text size is the default (no
"Smaller text" preference).

| Metric | Definition | Target |
|---|---|---|
| Primary buttons | Buttons and links in `<main>` drawn as the primary variant: class `bg-primary` (`src/ui/Button.tsx`), `data-variant="primary"`, or the primary background colour. The top bar's Capture button is counted apart ("in chrome") | at most 1 (plan step 2) |
| Header chips | Status chips inside the page header: the `<header>` that holds the page's `<h1>`, else a band from the `<h1>` to 96 px under it. A chip is a `StatusBadge` (`[data-status]`) or any small inline bordered rounded label (14 to 32 px tall, 1 to 48 characters, not a control, not `<kbd>`); nested chips count once | at most 2 (plan step 2) |
| Characters at 14 px or more | Share of the visible characters whose computed font size is 14 px or larger (under 14, 14 to 15.9 and 16 and over are all recorded, with a per-size histogram) | at least 90% |
| Sideways scroll | The document or `<main>` is wider than the viewport; the widest elements not inside their own scroller are listed | none |
| axe | axe-core with WCAG 2.2 AA plus best practice, as the E2E suites run it (`e2e/support/axe.ts`): failing nodes and rules | 0 |
| Phone tap targets | On viewports under 768 px (emulated as a touch phone, so `pointer: coarse` applies): every link, button, input, tab, radio, checkbox, menu item and option; size is the smaller side of its box (a native control takes its label's box). Inline links inside a sentence are left out (WCAG 2.5.8) | 0 under 44 px |
| Navigation strips | `nav` landmarks and tab lists visible above the fold, outside dialogs, breadcrumbs and pagers left out | at most 2 (plan step 3) |
| Clipped text | Elements whose own text is wider or taller than their box with overflow hidden or clipped, or an ellipsis | 0 |
| Info only | Buttons and links (fold and page), words (fold and page), chips on the page, most table columns, page length in screens | - |

Known limits: a tap area widened by a pseudo-element (the InfoTip's 44 px area on touch) is measured by its box, so it reads small;
a page whose panes scroll on their own (Today's list and pane) shows only the first screen of each pane in the full-page shot; chips
and the header are found by shape and position, so a redesign can move them in or out (the report lists the labels it counted).
