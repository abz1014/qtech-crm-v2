# Forest review after wave B (cohesion and polish lane, polish-b)

Date: 14 Nov 2026. Base: `forest/integ` at 7b285529 (foundation, wave A + polish-a, round 2: B1 New RFQ and capture #47, B2 suppliers,
items and prices #48, B3 quotation, questions and files #46, B4 order and supplier order #49, B5 visits and challans #45).

How this was made: fresh pictures of the whole selling and delivering flow at 1440 and at 375 from CI (`e2e/jobs/forest-review-b.spec.ts`,
the `review-shots` artifact, `pb-<screen>-<width>.png`; the window grows to the content so each picture is the whole page, dialogs are
the window as it is), as sales or admin and as an engineer. Set beside each other, beside the round 1 pictures
(`docs/screens-2026-11-14/polish-a/after-*.png`) and beside the approved mockups 21-26, 32, 41-44 (`proposal-2026-11`, rendered full page).
Pictures: `docs/screens-2026-11-14/polish-b/` (`before-*` from 7b285529, `after-*` from this branch).

## First impression

Wave B moved the selling and delivering screens a long way: the job page reads as one Forest family from New RFQ to the Delivery stop,
and the lane pictures match their mockups closely (New RFQ 21, Suppliers asked 23, Items and prices 24, Issue quotation 25, Order 41,
Supplier order 42). What still breaks the "one product" feeling is at the seams between lanes: two different New RFQ screens behind
two addresses, the old (pre-Forest) comparative statement that also scrolls sideways on a tablet, the bare disclosure lines under the
quotations next to B5's compact fold rows on the Delivery stop, the old key/value Commissioning box, dialogs with and without the icon
tile, and a phone dialog header that squeezes the title into a column three words wide when a PO number sits beside it.

## Ranked findings

| # | Finding | Where | Severity | Fix | Status |
|---|---------|-------|----------|-----|--------|
| 1 | The comparative statement is still the pre-Forest page: a breadcrumb, bare tables, no cards. At 768 the table's columns overlap ("PKR 412,000.00PKR 412,000.00", "6 week s") and the page scrolls sideways (live bug 7, F-397-399). | Statement (`/jobs/:key/statement`) | Critical | DetailHeader-style back button "<- Job N"; each item and the totals a `CARD`; from 1024 a table, below 1024 a card per quote with a Sort field; tables in their own scroll box, no minimum widths; amounts mono and tabular. | Fixed |
| 2 | Two New RFQ screens: Sell's button and a company page open `/rfqs/new` (the old intake: one column, "Looks right: find suppliers", "Save as draft"), the Create menu and a drop open `/enquiries/new` (mockup 21: the document column, "Create job N"). Same words, different screens. | New RFQ | High | `/rfqs/new` renders the New RFQ screen; `?company=`, `?supplier=` (Ask suppliers now ticked), drafts and captured files kept. | Fixed (owner note below) |
| 3 | "Questions for the customer (6)" and "Files none yet" are bare disclosure lines with a small chevron, while B5 drew Commissioning and Challans as rows and the mockup (23, 26) draws compact fold cards. | Quotation stop | High | `FOLD_CARD` (new, `src/ui/card.ts`): hairline card row, title, "2 questions" / "none yet", chevron, body under a hairline. Questions, Files, Commissioning and Challans all use it. | Fixed |
| 4 | Commissioning on the Delivery stop is the old look: a disclosure with a key/value table (Planned on / Visit type / Done on / Engineers) and Edit floating right above it; mockup 43 draws a compact fold card with a Done / Not done chip. | Delivery stop (office) | High | Commissioning and Challans as compact fold cards with state chips (Done / Not done / Not needed, Issued / None); Edit and Mark done today in the Forest sizes; facts as hairline rows. | Fixed |
| 5 | The engineer's On site card: the two big actions are half-width buttons at the left of a full-width card; Visits and Delivery challans run the full page width while the step cards stop at the side column (~770 px), so the page has two right edges. | Engineer job page | High | On site card on `CARD`, Delivered today (green) and Installed today (white) share the width at control-lg, the supplier's name on the button when there are two; Visits and Challans sit in the step column. | Fixed |
| 6 | Phone dialog header: the meta (Issue PO's "PO-26-0001 · R0" chip) takes a fixed column beside the title, so "Issue purchase order" wraps to three lines and the supplier name to six; a longer meta can push Close off a 320 px screen. | Issue PO, any dialog with meta | High | The header is a grid: [icon] title [meta] Close; below 768 the meta goes under the title, Close keeps its own column. | Fixed |
| 7 | Dialog looks differ inside one flow: Issue quotation, Issue PO, Mark won and Add item have the Forest icon tile; the supplier reply, New challan, Commissioning, Order notes, Visit and Add photo or note do not. | Dialogs of the flow | Moderate | Icon tile on each (reply, file, hard hat, notebook, calendar, camera). | Fixed |
| 8 | Mark won and New order: px grid tracks and `w-[min(1080px,...)]`, items box with side borders dropped from 768, totals on white; Issue quotation (B3) draws a rounded bordered items box with the header and totals on the canvas. | Mark won, New order | Moderate | rem/fr tracks in the same proportions, the Issue quotation items box, chosen order as a bordered canvas block. | Fixed |
| 9 | Add to this job (side column) is pre-Forest: plain inputs, blue choice chips, grey link buttons. | Job page side, F-025-027, F-219 | Moderate | Forest form controls, pale-grey boxes for what was shared, white file rows, choice chips pale green with a forest edge when chosen, secondary pick buttons. | Fixed |
| 10 | Dropping a file on Home or the Jobs list starts a New RFQ with no cue while dragging (F-072, F-620, F-621; mockup 21 #ne-overlay). | Home, Sell, Deliver | Moderate | Whole-window overlay "Drop to start a New RFQ" on the scrim, admin and sales only, pointer events pass through, Esc / leave clears it, reduced motion respected. | Fixed |
| 11 | The Order items table draws its own card inside the Order stop card (double edge), undone by className overrides. | Order stop | Moderate | `DataTable flat` (no edge, corner, shadow or white of its own; total row a rule); Order items uses it. | Fixed |
| 12 | Shared-item gone message omits that signing out clears shared items (bug 48). | Add to this job, /capture | Minor | "(shared items are kept for up to 7 days, and signing out clears them)", same as /capture. | Fixed |
| 13 | The Quotation stop says "3 of 4 answered" in its row and again under "Suppliers asked 4". | Quotation stop | Minor | Not changed: mockup 23 draws the same two lines; the row is the closed summary, the second the section's own count. | Not fixed |
| 14 | Mark won in mockup 32 is a 760 px dialog with each item as a stacked card (supplier, buy price, sell price); the app keeps the live table layout at 1080. | Mark won | Minor | Not changed: a layout change to a money dialog, not a polish; for the owner. | Not fixed |
| 15 | Statement: the mockup has no best-price highlight and the page's own rule is "the statement selects nothing". | Statement | Minor | Kept: no "cheapest" mark (the e2e spec asserts it). | By design |
| 16 | Top bar words (Help, Settings, Ctrl K hint) - as in wave A. | Shell | Minor | F3 owner decision. | Not fixed |

### Owner note (finding 2)

`/rfqs/new` is now the New RFQ screen. Its green button is "Create job N" (saves and opens the job page); asking suppliers from New RFQ
needs the "Ask suppliers now" tick first (B1's gate-2 change). The FE-2 click count from New RFQ to "message copied" is 4 (was 3 on the
old screen); the specs assert the new count strictly. A supplier's company page opens New RFQ with the tick already on.

### Consistency details checked

| Element | Before | After |
|---------|--------|-------|
| New RFQ | two screens (`/rfqs/new`, `/enquiries/new`) | one |
| Compact sections inside a stop | bare disclosure lines (Questions, Files), plain rows (Commissioning, Challans) | one `FOLD_CARD` look with a count or a chip |
| Dialog header | icon tile on some; meta beside the title on a phone | icon tile on every dialog of the flow; meta under the title on a phone |
| Items box in money dialogs | Issue quotation rounded box; Mark won / New order squared, white totals | one box |
| Table inside a card | double edge, className overrides | `DataTable flat` |
| Engineer page | two right edges; half-width actions | one column edge; actions share the card width |
| Statement | pre-Forest, sideways scroll at 768 | cards, no sideways scroll |

### Accessibility

- Names and regions unchanged: "Quotation stage", "Commissioning", "Delivery challans", "Visits on this order", `data-fold` for the two
  enquiry sections; the fold rows read "Title, state, summary"; the drop overlay is `role="status"` and never takes a pointer.
- Close stays in its own grid column at 320 (unit test); touch sizes unchanged (48 on touch, 40 desktop).
- Engineers: no money words, amounts or PO numbers added; the statement still answers an engineer with the "for admins and sales"
  notice and fetches nothing.

### What works well

- The job page hero, stage track and step cards carry the whole flow; B2's supplier rows and price lines are very close to mockups 23-24.
- Issue quotation (B3) and the Order / Supplier order stops (B4) are the reference for money dialogs and tables; this pass aligned the rest to them.
- The engineer's page now reads as one column of cards with one clear action card at the top.

## Left for later lanes

- Mark won as the stacked 760 dialog of mockup 32 (owner decision).
- Money dialogs' widths are in rem (Mark won, New order, Issue quotation 67.5rem; Issue PO 51.25rem): F1 has no width token between 760 and 1200; add one if wanted.
- `e2e/hunt/**` and `e2e/audit/**` still drive the old `/rfqs/new` screen (not in the CI suite list).
- Top bar words (F3).
