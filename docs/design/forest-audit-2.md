# Forest final audit, pass 2 (15 Nov 2026)

Branch: `forest/audit-pass2` (PR #70 into `forest/integ`). Harness: `e2e/audit-forest/` (suite key `forest-audit`, 8 shards, manual
only), merged with `node scripts/audit/forest-merge.mjs`. Full E2E ran on a mirror branch (`forest/audit-pass2-e2e`, same commit) so
the audit and the full suite did not cancel each other (one cancel-in-progress group per branch).

**Verdict: zero real findings.** Final audit run 43674561026 on 2791446a: 2,351 views, 0 findings other than axe's
"could not measure" contrast notes (text over a gradient, an image or overlapping boxes), which axe cannot decide and which were
checked by eye in the screenshots, as in pass 1.

## What was checked

Each run: 2,351 views, 77 routes x every role that may open them, at 320, 375, 768, 1024, 1440 (+1920 for wide tables);
Smaller and Larger text; empty, loading and error states; long text; every fold opened; every dialog, sheet and menu one click
away (or one click into More); the command palette at every width. Per view: sideways scroll, clipped and cut-off text, overlap and
covered controls, touch size with `(pointer: coarse)`, input font size, axe WCAG 2.1 AA + best practice, HTML validity, a 15-step Tab
sweep for visible focus, console and page errors, and engineer money. Every view is photographed.

Beyond the rules, every round's screenshots were looked at: every route at 375 and 1440, the Settings strip at 768 and 1024, the job
skeleton, the error cards, the engineer ruler, the dialog footers and Cancel buttons, and the Record payment and Add expense sheets.

## Iterations

| Run | Commit | Real findings | What they were |
|---|---|---|---|
| 43664163520 | 3a9524f6 | 8 | layout and harness reads after the pass 1 lanes merged (SumBar, DataTable spans, PageHeader meta) |
| 43668183976 | 7e21ef62 | 17 | visual review across shell, Money, reports, jobs, companies, settings |
| 43669515777 | 4821ba2a | 4 | 2 axe scrollable-region-focusable (History dialog), 1 page error (PopoverPortal, New RFQ, sales, 1024), 1 contrast (disabled Add person) |
| 43670739072 | 8c96206e | 0 | (visual review found one polish item: Record payment hints on a phone) |
| 43672043691 | 5468dc86 | 1 | contrast on Team's Add person, reported under an ambiguous selector |
| 43673582152 | 8398f54c | 1 | the same Add person, measured mid colour transition |
| 43674561026 | 2791446a | 0 | |

Full E2E on the mirror: 43670764563 (8c96206e) found two real breaks, fixed in 8398f54c (below); 43673584260 on 8398f54c, every suite, green. Commits after 8398f54c change only the audit harness, the visual baselines (ci.yml `update_baselines`, run 43675790173: 17 gallery sections, looked at) and this note.

## Fixes, by round

**Round 0 (3a9524f6).** SumBar sizes its tiles from the widest figure (Money fit); FitSumBar and money/fit.ts removed. DataTable
group and footer labels span only the columns drawn at that width; toolbar controls take a full row on a phone. Aging report hides
Days by CSS. PageHeader `meta` slot beside the h1. Companies filter uses the one-row SegmentedControl on phones.

**Round 1 (7e21ef62, 3dbeb53d).** SumBar picks an even tile count; amounts lists never end a line on "·"; DataTable fades a cut
sideways edge; Money tabs fade where cut and fit 1024; collapsed rail badge readable; FoldRow chip compact on phones; DetailHeader
`line` slot. Engineer Billing and Payment rows say Office; direct jobs end at "All 5 stages done"; margins, GST to FBR and statement
switch layouts where columns no longer fit; many small copy, number and spacing fixes. I paid's Optional label matches every form.

**Round 2 (4821ba2a), with the owner's decisions.** Engineers: the ruler stops at Delivery ("Delivered · With the office"); Billing and
Payment are always the neutral Office stop, so delivered, invoiced and paid read the same. Imported jobs: the Needs action chip is the
usual amber. Pages that could not load are one white error card with Try again. Settings from 768 to 1279: the sections as one
underlined strip above the page. Codes never break inside ConfirmDelete. A dialog body that scrolls with nothing to tab to takes focus.

**Round 3 (79457ec6).** Job page loading skeleton shaped like the page (hero, seven stops, steps card, side card, phone bar). Tables
say "Loading ..." where the count goes. Every dialog's Cancel is the secondary button; Edit expense keeps its four actions on one row.
Job hero does not repeat what the title says; a finished job says "Where it stands".

**Round 4 (8c96206e).** Popover parts follow their root while the Radix half loads (New RFQ at 1024 threw "PopoverPortal must be used
within Popover"). The dialog body's scroll-stop check attaches when the body is drawn, so a long History takes focus.

**Round 5 (5468dc86).** A link-look button inside a sentence (`text-link-btn`, in `.text-link-rows`) keeps its 48 px touch target
but takes only one line of the sentence: the Record payment hints wrapped with a tall first line on phones.

**Round 6 (8398f54c), from the full E2E.**
- PageHeader keeps one shape with or without `meta`. Bank check's "Everything matched" arrived with the data, remounted the h1
  and dropped the route focus on it (e2e money-books, more-money-pages).
- An engineer's Quotation row, while the job waits at it, is heard as "Now" again; only Billing and Payment are heard as with the
  office. The row had read "With the office Office With the office", and the open-the-current-step helper could not find it
  (e2e rfq-ranking, R25 engineer).

## Harness rules narrowed in pass 2, with reasons

None of these hides a real problem; each removes a reading the harness itself caused, or one WCAG exempts.

1. **Focus at rest** (3a9524f6): focus is read by focusing another element, since Radix's focus trap pulled a blur back into the
   dialog. The stand-in sits outside the element's own ancestor chain, so no `:focus-within` stays lit.
2. **Error state must speak** (3a9524f6): a screen is judged only if it made a data request. The harness counts the refused
   `/rest/v1/` and `/functions/v1/` requests made after the screen opened; one or more, and silence after 10 s is a finding.
3. **Error and loading states refuse edge functions too** (7e21ef62). This makes the rule stricter, not looser.
4. **`record_history` allowed through the write firewall** (7e21ef62): it is a read (the History panel) whose name starts like
   a write, so every History panel had said "Could not load the history".
5. **Toast set aside before the next opener** (4821ba2a): a one-tap menu item the firewall refused leaves a "Could not ..." toast
   over the phone's sticky bar, and the next More click landed on it. That toast exists only because the harness refuses writes.
6. **Disabled controls in colour-contrast** (8c96206e, then 8398f54c): a node that is `:disabled` (or inside one) is WCAG 1.4.3's
   inactive component, which the rule itself exempts. The re-read now uses axe's own element (`elementRef`), because its selector
   (`.border-primary`) first matched a different, enabled element.
7. **Colours measured at rest** (2791446a): running CSS transitions (never endless animations such as a skeleton's pulse) finish,
   for at most a second, before axe runs. Team's Add person was read mid-transition as the list settled: the disabled grey, but no
   longer disabled, so not something anyone sees at rest.

Kept out of the counts, as in pass 1: axe `incomplete` colour-contrast ("could not measure"), about 715 per run. Looked at in the
screenshots; nothing unreadable.

## Screens

Final pictures from audit run 43674561026: `docs/screens-2026-11-14/final/` (10 desktop at 1440x900, 6 phone at 375).
