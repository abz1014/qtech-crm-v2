# Forest review after wave A (cohesion and polish lane, polish-a)

Date: 14 Nov 2026. Base: `forest/integ` at aa768ee6 (foundation + A1 Home, A2 Sell/Deliver, A3 Job page, A4 Money hub and Payments, A5 Companies).

How this was made: fresh pictures of every wave-A screen at 1440 and at 375 from CI (`e2e/jobs/forest-review.spec.ts`, written to the
`review-shots` artifact; the window is grown to the content so each picture is the whole page), set beside the approved mockups
(`proposal-2026-11/10-13, 20, 30-33, 40, 50-52, 70-71, 01-style`, rendered full page). Pictures: `docs/screens-2026-11-14/polish-a/`
(`before-*` from aa768ee6, `after-*` from this branch).

## First impression

Each wave-A screen is good on its own, and the forest chrome, the lime Create and the Geist type already make it feel like one family.
What breaks the "one product" feeling is that every lane solved the same problem its own way: three card looks (with and without the
hairline edge, a tinted block, a bare band), three ways back (a breadcrumb, a bare link, nothing), the job step list as hairline rows
where the mockup has a card per step, and Home still in the old mail-client layout (a 420 px white column of coloured blocks beside an
empty grey pane) while every other screen is cards on the canvas. Home is the first screen anyone sees, so it carries the most weight.

## Ranked findings

| # | Finding | Where | Severity | Fix | Status |
|---|---------|-------|----------|-----|--------|
| 1 | Home is not the Forest Home: a fixed 420 px white list column with red / yellow / blue tinted blocks, the pane a bare grey area ("Select an item..." floating mid-screen, even when the list is empty). Mockup 11/12: cards on the canvas, Late a white card with a red edge and red heading, Today / This week fold rows with a count chip, the pane a white card beside the list. | Home, all roles | Critical | Page scrolls on the canvas; list is the wide column; Late / Today / This week / grey folds as cards; count chips in the block colours; selected row tinted with the brand bar; pane a sticky white card; no pane column when there is nothing to pick; skeleton shaped like the hero, Late card and folds. | Fixed |
| 2 | Engineer Home has no day timeline: the day groups were the office's coloured blocks. Mockup 11 (engineer): the day as a heading with its count, each visit its own card. | Home, engineer | High | Engineer branch draws a heading per day and a card per visit (separate markup, no CSS hiding). | Fixed |
| 3 | Job steps are one hairline list with a state icon; the mockup draws each step as its own card with a Done / Waiting / Not yet chip, the current one ringed (desktop), one card of rows with a left bar (phone). | Job page | High | `FoldRow` chip slot (title over summary, chip, chevron); Job page uses it; per-step cards from 768 px; current step ringed; phone left bar. | Fixed |
| 4 | The hero's one action is a green button with a white ring on the forest; mockups 30 and 50 use lime (the only lime on the page). Money hub hand-rolled its own lime link. | Job page, Money | High | `Button` variant `lime` + shared `buttonStyles` for links; Job hero uses it (green stays on the white phone bar); Money hub uses the shared look. | Fixed |
| 5 | The phone one-bar title wraps a long company name to three lines and runs out of the band over the page. | Job page, company page (375) | High | One line, ellipsis, whole name in the tooltip; the h1 keeps it for a screen reader. | Fixed |
| 6 | Three card looks: Job page cards have no hairline edge, Home money tiles do, To collect's table is flat, NextStepBox quiet is a blue tinted band. Mockup .qb-card is one look: white, hairline, 16 px corners, e1. | All five areas | High | `src/ui/card.ts` (`CARD`); Job page cards, Home, Team, money tiles on it; NextStepBox quiet is the white bordered card. | Fixed (wave-A screens); later lanes should use `CARD` |
| 7 | Ways back differ: the Job page and company page use a muted breadcrumb; mockups 30 and 71 use one outline button "<- Deliver" / "<- Companies". | Job page, company page | Moderate | `DetailHeader` `back` (outline button beside the title, still the Breadcrumb nav) and `sub`; both pages use it. | Fixed |
| 8 | List toolbars: Sell / Deliver / Companies draw search and switches as a band inside the table card; mockups 20, 40, 70 put the toolbar in its own card above the table card. | Sell, Deliver, Companies | Moderate | `DataTable` `toolbarCard`; the three lists use it. | Fixed |
| 9 | The rail lights nothing on a job page opened from Home or Search, and Sell/Deliver only by `?from=`. | Shell | Moderate | `activeLink` reads `?from=`, else the lane the Job page names (laneOfJob through the shell bar config). | Fixed |
| 10 | Deliver's header offers New RFQ (green) and a boxed "All jobs"; mockup 40: "Order without RFQ" (white) and All jobs as a quiet link. Job numbers in the lists are plain; mockups draw them green and heavy. | Sell, Deliver | Moderate | Deliver: Order without RFQ (opens the same dialog as Create), no green in the header; All jobs quiet; job numbers green heavy. | Fixed |
| 11 | Create > Payment received opened To collect with nothing chosen; it should ask "Which order?" (F-642). | Shell | Moderate | Goes to `/money/receivables?pay=1`; the comment's old "Order without enquiry" words corrected. | Fixed |
| 12a | The list stage bars (StageMini, StageLine) drew done in success green, the current stop in near-black and the stops to come in a dark grey, heavier than the done ones; the Job page track uses brand green up to the stop and a pale bar after. | Sell, Deliver, Jobs | Moderate | Bars use the track's ink (brand-500 done, brand-700 now, deep for to come); job numbers on phone cards green heavy too. | Fixed |
| 12 | Page frame and rhythm differ: Home used `px-5 pt-5` inside a white column, the others `px-4 md:px-8 pt-6` on the canvas, max 1280. | Home | Moderate | Home and Team on the same frame; the Home header spans list and pane so the hero and the pane start on one line. | Fixed |
| 13 | Top bar: mockups show "Help" and "Settings" with words and a Ctrl K hint in the search; the app shows icons only. | Shell (F3) | Minor | Not changed: F3 chose icons; noted for the lead. | Not fixed |
| 14 | Money figures: mockups set amounts in Geist Mono (tabular), the app in Geist heavy. To collect's KPI strip is a plain line; mockup 51 has a five-cell card. | Money, To collect | Minor | Not changed here (A4 / C-wave scope: SumBar strip is shared by many pages). | Not fixed |
| 15 | Side column of the Job page is one card of rows; mockup draws Contact as its own card and each row as a card. | Job page | Minor | Not changed (JobSide is shared with slot owners; one card reads cleanly). | Not fixed |
| 16 | Home header: the mockup puts Mine / Team and Weekly review on the right of the title; the app stacks them under the date. | Home, admin | Minor | Not changed (the list column is narrower than the mockup's full width). | Not fixed |

### Consistency details checked

| Element | Before | After |
|---------|--------|-------|
| Page header | `PageHeader` on lists, `DetailHeader` + breadcrumb on details, Home its own | Lists unchanged; details share the back button; Home on the list frame |
| Cards | 3 looks | One (`CARD`) on every wave-A screen touched |
| Buttons on forest | green + white ring | lime (`Button variant="lime"`), green only on white |
| Chips | hero chip only | the same chip words and icons on each step (`STEP_CHIP`) |
| Count badges on Home | bare numbers in the block's ink | round chips in the block colours |
| Empty / loading | Home: four grey lines; empty Home beside an empty pane | Home: skeleton shaped like the content; empty Home is one column |
| Phone | bar title wraps 3 lines | one line, ellipsis, tooltip |

### Accessibility

- Contrast: lime words (`on-lime`) on lime 8.6:1 (test); lime never on white (test). The Home selection bar (brand-700) is 3:1 on white and on the selected tint (test). Late heading in the danger ink on white is the same pairing as the old block ink.
- Names: step rows read "Title, state, chip, summary" once ("Quotation Done 1 of 1 answered"; "Delivery Now Waiting 2 of 3 delivered"); the way back is still the Breadcrumb navigation with the link name "Deliver".
- Touch: fold rows and block headings use the row height token (48 / 64 touch); row buttons unchanged (40 desktop, 44 phone, 48 touch).

### What works well

- The forest rail, lime Create and Geist type are already one voice across all five areas.
- The Job page hero + 7-stop track is very close to the mockup and reads at a glance.
- The Money hub hero and three figure cards match mockup 50 almost one to one.

## Left for later lanes

- Use `CARD` from `src/ui/card.ts` for every new card; use `Button variant="lime"` for any forest hero action.
- Top bar words (Help, Settings, Ctrl K) - F3 owner decision.
- Mono amounts and the To collect KPI card - Money lanes.
- 'To do' words left in help recipes (D3), as before.
