# qtech-crm-v2: round-2 UX spec (cross-cutting items)

Read-only design spec, 2026-10-20. It covers the cross-cutting work that none of the four UX branches owns, so a round-2 agent can apply it right after they merge.
Inputs:
- `docs/audit/ux-2026-10-19/{navigation,screens,readability}.md` (overall 5.3/10).
- DECISIONS entries of 2026-10-19 and 2026-10-20, including main `eb8d878`: "Open in WhatsApp / Open in email" next to every copy button.
- The branch heads: `origin/ux/foundation` a124211, `origin/ux/orders` fdc8614, `origin/ux/money-today` 8cb0062, `origin/ux/rfqs` 02ac73f, and `origin/main` eb8d878.

**How to read the references**
- `path:line` is the line in a scratch merge of main + foundation + orders + money-today + rfqs, done in that order and outside the repo.
- The tag after a path names the branch that owns the file, for example (rfqs). (main) means no UX branch touches it.
- Every file cited here is changed by at most one UX branch, except `ContextPane.tsx`, `ReceivablesPage.tsx` and `DESIGN_SYSTEM.md`, which two branches change. For those, the line numbers apply only after the merge.

**Fixed constraints**
- Database enum keys, view values, routes and query keys do not change. Only labels, tones, icons and where things are drawn change.
- Zero budget.
- Readability beats mockup parity (owner, 2026-10-19). Visual baselines get regenerated.
- `status.test.ts` and `scripts/check-token-parity.mjs` must stay green. Any tone change is made in `docs/design/tokens.css` AND the copy in `src/index.css`.

Effort: S ≤ 2 h, M ≤ 1 day, L > 1 day (agent time).

---

## 0. Before round 2: merge notes (not round-2 work, but round 2 starts from the result)

Merging in the order foundation, orders, money-today, rfqs gives these conflicts:

| File | Conflict | Resolution |
|---|---|---|
| `docs/DECISIONS.md` | Every branch appends | Keep all entries in date order |
| `src/features/today/ContextPane.tsx` | foundation restyled `NudgeRail`/`RailLabels`; money-today removed the rail | Take money-today's version: the owner decision removes the date rail |
| `docs/guides/SALES.md` | Both money-today and rfqs rewrote it | rfqs for steps 2 to 5, money-today for the rest |
| `e2e/orders/orders.spec.ts`, `e2e/journeys/admin.spec.ts`, `e2e/money/costs.spec.ts`, `e2e/capture/{capture,states}.spec.ts`, `e2e/rfqs/board.spec.ts`, `src/features/rfqs/board/BoardPage.test.tsx` | Expectations differ | Take the later branch's wording ("Not final", glossary words), then run the suite |

---

## 1. Status vocabulary

### 1.1 What ships after the merge

- **The registry is too big.** `src/lib/status.ts` (foundation) has **28 dimensions and 99 keys, with 89 distinct labels**.
- **Nine more chip systems bypass it**, each with its own colours:
  - the RFQ stage chip (`RfqHeaderBlock.tsx:287-291` `CHIP_TONE`, `lib/nextAction.ts:49-63`) (rfqs)
  - the board's Next-step tones (`board/model.ts:94-142`, `BoardParts.tsx:16-21`) (rfqs)
  - the orders Next-step tones (`orders/lib/nextStep.ts:15`, `OrdersListPage.tsx:57-72`) (orders)
  - the item price chip labels (`rfqs/lib/detailView.ts:20-29`) (rfqs)
  - the quotation `StateChip` (`QuotationsPanel.tsx:37-50`) (rfqs)
  - the supplier record `OUTCOME` and delivery chips (`SupplierRecordPanels.tsx:24-45, 233-245`) (orders)
  - the Things to check pills (`ExceptionsPage.tsx:77-87`) (money-today)
  - the bank `StateChip` (`BankTickPage.tsx:180-195`) (money-today)
  - the PO price-source chip (`IssuePoDialog.tsx:65-73`) (orders)
- **One state, different words and colours.** Ready to quote is success-toned on the board and in the stage chip, while the registry calls the same state "All priced". Quotation sent is neutral on the board and in the stage chip, but success in the registry. A late state is "12d late" on Today (`today/rules.ts:86-96`), "Overdue by 3 days" in the RFQ header (`detailView.ts:98-103`) and "3 days overdue" on the board and in Who owes us.
- **Tones and icons blur.** Info uses `CircleDot` and warning uses `Clock` (`status.ts:214-221`). "Clock" says *waiting*, but warning means *you act*.

### 1.2 Rules (put these in DESIGN_SYSTEM §6, replacing the "Mapping rule" paragraph)

1. **Four ways to show a state, and which to use.**

   | Form | Component | Use it for |
   |---|---|---|
   | **Chip** (tinted box, icon and word) | `StatusBadge` | **Only** (a) the chip row under a page title, at most 2 chips; (b) the one state column of a table whose job is that state (GST register TCS and FBR, closed RFQs' outcome, Team's Deactivated); (c) at most one per row inside a detail panel (a supplier order's goods state, a supplier's reply state, an item's price state) |
   | **Status text** (icon and word, no box, optional second line) | new `src/ui/StatusText.tsx` | Every **Next step** column, status-strip cells, history rows and money reports |
   | **Tag** (neutral box, no tone) | `src/ui/Tag.tsx` | Identity and category, never state: company role (Customer, Supplier, Customer & supplier, Prospect dashed), paid via (Bank, Cash), PO price source |
   | **Plain words** | none | History facts ("Ordered elsewhere", "Delivered 3 days late"), quotation versions ("Replaced by revision 2"), report rows |

2. **No chip for the normal state.** These keys never draw a chip; `StatusBadge` returns `null` for them through a new `hidden: true` flag:
   - RFQ open; order active; user active; month open
   - costs complete; trust ok; fx fresh; rate captured
   - goods and commissioning n/a: tables show "—"; the word "Not needed" stays only in the filter selects
3. **Lists show one Next step, never state chips.** This applies to the RFQ list, Orders, Who owes us and the company history rows.
4. **One label means one thing and has one tone, everywhere.** A label may carry a mono detail ("2 of 3", "×2", "12 days"). It may be replaced only by a date phrase from the shared time-words helper (rule 8), never by new words.
5. **Five tones, defined by who acts next.** The `ink` tone leaves the status map.

   | Tone | Name in code | Means | Icon (lucide) | Chip | Status text |
   |---|---|---|---|---|---|
   | warning | `now` | We act next (you or a colleague) | `CircleArrowRight` | amber tint | text `fg`, medium; icon amber |
   | info | `waiting` | Someone else acts next (supplier, customer, courier) | `Clock` | blue tint | text `fg-muted`; icon blue |
   | success | `done` | Finished | `CircleCheck` | teal tint | text `fg-muted`; icon teal |
   | danger | `late` | Past its date and still open | `CircleAlert` | red tint | text and icon red, medium |
   | neutral | `inert` | Closed, not asked, not needed | `Circle` | grey tint | text `fg-muted` |

   Icon overrides are allowed only for:
   - `CircleDashed`: dashed edge, not firm (Is GST included?)
   - `Ban`: Cancelled, Deactivated, Can't quote
   - `Lock`: a closed month
   - `CalendarClock`: Due soon
6. **At most one danger mark per row and per header.** On the board the danger mark is the Due cell; on an order it is the late cell; and so on. Amber or blue text on a selected row turns to `fg-2`, as Today already does (`TodayScreen.tsx:251-252`) (money-today).
7. **Colour is never alone.** Every state shows an icon and a word. Tints are only for chips.
8. **Time words come from one helper.** Add `src/lib/timeWords.ts` with these outputs:
   - "3 days overdue"
   - "Due today", "Due tomorrow", "Due in 4 days"
   - "In 4 days", "3 days ago"
   - "5 days old", "New"

   No "d" abbreviations. "Late" alone is a history word: "Delivered 3 days late".

### 1.3 The consolidated set: 34 status labels (was 89 registry labels plus about 30 ad-hoc ones)

| # | Label | Tone | Meaning | Old keys that now show it |
|---|---|---|---|---|
| 1 | Needs suppliers | now | Nobody asked, or every supplier asked said no | new `rfq-stage:suppliers`; `sourcing:not-floated`; `sourcing:no-offer` |
| 2 | Waiting for prices | waiting | Asked; not every item priced | `rfq-stage:prices`; `sourcing:awaiting`; `sourcing:partly-covered` (detail "2 of 3 priced"); `inquiry:sent`; `inquiry:awaiting`; `inquiry:chased` (detail "chased ×2"); new `item-price:waiting` |
| 3 | Ready to quote | now | Every item has a price | `rfq-stage:ready`; `sourcing:covered` |
| 4 | Quotation sent | waiting | Our quotation is with the customer | `rfq-stage:sent`; `bid:bid-sent` |
| 5 | Quotation expired | now | Validity passed without an answer | `rfq-stage:expired`; `bid:expired`; quotation row "expired" |
| 6 | Won | done | | `rfq-outcome:won` |
| 7 | Closed | inert | RFQ closed for a reason; month closed (`Lock` icon) | `rfq-outcome:closed`; `month:closed` |
| 8 | Not asked yet | inert | On the list, no message sent | `inquiry:shortlisted` |
| 9 | Priced | done | A supplier or an item has a price (detail "2 of 3", "3 prices") | `inquiry:quoted`; new `item-price:priced` |
| 10 | No price yet | now | Everyone who replied left this item out | new `item-price:none` |
| 11 | Can't quote | inert (`Ban`) | The supplier said no | `inquiry:no-offer` |
| 12 | Due soon | now (`CalendarClock`) | Always drawn as a time phrase ("Due today", "Due in 2 days") | `deadline:due-soon` |
| 13 | Overdue | late | Past its date, still open (detail "12 days") | `deadline:overdue`; `payment:overdue`; `goods:late` |
| 14 | Done | done | | `order:done`; `commissioning:done` |
| 15 | Cancelled | inert (`Ban`) | | `order:cancelled` |
| 16 | To order | now | A supplier must be chosen or the PO placed | `goods:to-source`; `goods:to-place` |
| 17 | On order | waiting | With the supplier | `goods:on-order` |
| 18 | To deliver | now | With us; take it to the customer (detail "2 of 3 delivered") | `goods:received`; `goods:partly-delivered` |
| 19 | Delivered | done | | `goods:delivered`; `tcs:delivered` |
| 20 | To plan | now | Commissioning needs a date | `commissioning:to-plan` |
| 21 | Planned | waiting | Detail: the date | `commissioning:planned` |
| 22 | To invoice | now | Nothing or only part invoiced (detail "rest PKR …") | `invoicing:not-invoiced`; `invoicing:part` |
| 23 | Invoiced | done | | `invoicing:full` |
| 24 | Awaiting payment | waiting | Balance open, not yet due (detail "part paid") | `payment:unpaid`; `payment:part` |
| 25 | Paid | done | | `payment:settled` |
| 26 | Not final | now | Costs still estimates | `costs:provisional` |
| 27 | Is GST included? | now, dashed (`CircleDashed`) | Price basis unknown | `trust:basis-unknown`; `excluded:basis-unknown` |
| 28 | Not sent | now | Invoice not sent by courier yet (detail "copy in" for copy-received) | `tcs:not-started`; `tcs:copy-received` |
| 29 | Sent | waiting | With the courier | `tcs:sent` |
| 30 | To deposit | now | Tax not deposited (detail "PSID made", "receipt in") | `fbr:pending`; `fbr:generated`; `fbr:receipt` |
| 31 | Deposited | done | | `fbr:deposited` |
| 32 | Old rate | now | Exchange rate older than the limit (detail "9 days") | `fx:stale` |
| 33 | No rate | now | No usable rate | `fx:unusable`; `fx-capture:none` |
| 34 | Deactivated | inert (`Ban`) | | `user:deactivated` |

**Not chips but still visible words**, which keep their registry label for text use (`resolveStatus(...).label`):
- Section headings in the RFQ questions panel: "To ask", "Waiting on the customer", "Answered", "Answers to send".
- Tags: Customer, Supplier, Customer & supplier, Prospect, Bank, Cash.

### 1.4 Every old key: new label, tone and where it is drawn

`=` means unchanged. "hidden" means `hidden: true`: no chip, and the label is used only as text.

| Key | Now (foundation) | New |
|---|---|---|
| rfq-outcome: open / won / closed | Open info / Won success / Closed neutral | hidden / = / = |
| sourcing: not-floated, awaiting, partly-covered, covered, no-offer | Not sent to suppliers W, Waiting for prices I, Partly priced I, All priced S, No price yet D | Needs suppliers W, =, Waiting for prices I, Ready to quote **W**, Needs suppliers **W** |
| clarification: none, to-ask, asked, waiting-customer, answers-to-relay, answered, withdrawn | 7 labels | all hidden: headings use "To ask", "Waiting on the customer", "Waiting on the customer", "Answers to send", "Answered", "Withdrawn" |
| bid: to-bid, bid-sent, expired | To quote W, Quotation sent S, Quotation expired W | hidden (Ready to quote), Quotation sent **I**, = |
| deadline: due-soon, overdue | Due soon W, Overdue D | = with `CalendarClock`, = |
| inquiry: shortlisted, sent, chased, awaiting, quoted, no-offer | Shortlisted N, Sent I, Chased W, Awaiting reply I, Quoted S, Can't quote D | Not asked yet N, Waiting for prices I, Waiting for prices **I** (+×N), Waiting for prices I, Priced S, Can't quote **N** `Ban` |
| inquiry-blocked: all 3 | | hidden (never drawn) |
| order: active, cancelled, done | | hidden, = `Ban`, = |
| goods: na, to-source, to-place, on-order, late, received, partly-delivered, delivered | Not needed, To source, To place, On order, Late, Received, Partly delivered, Delivered | hidden "Not needed", To order, To order, =, Overdue, To deliver **W**, To deliver **W**, = |
| commissioning: na, to-plan, planned, done | | hidden "Not needed", =, =, = |
| invoicing: not-invoiced, part, full | Not invoiced W, Part invoiced I, Fully invoiced S | To invoice W, To invoice **W**, Invoiced S |
| payment: unpaid, part, settled, overdue | Unpaid N, Part paid I, Settled S, Overdue D | Awaiting payment **I**, Awaiting payment I (+part paid), Paid S, = |
| costs: provisional, complete | Not final W, Complete S | =, hidden |
| trust: ok, basis-unknown, estimated | Firm, Is GST included?, Estimated dates | hidden, =, hidden (estimated dates get a dashed underline and an InfoTip in the order meta line) |
| tcs: not-started, copy-received, sent, delivered | Not started N, Copy received I, Sent I, Delivered S | Not sent **W**, Not sent **W** (+copy in), =, = |
| fbr: pending, generated, receipt, deposited | Pending W, Generated I, Receipt received I, Deposited S | To deposit W, To deposit **W** (+PSID made), To deposit **W** (+receipt in), = |
| reminder: none, reminded | | hidden (the "Last reminder" text in Who owes us is a sentence) |
| company-role: customer, supplier, both, prospect | chips | hidden as states; drawn as `Tag` by `RoleChip` |
| fx: fresh, stale, unusable | Fresh S, Stale W, Unusable D | hidden (age text only), Old rate W, No rate **W** |
| fx-capture: captured, none | | hidden, No rate **W** |
| user: active, deactivated | | hidden, = |
| month: open, closed | Open I, Closed S | hidden, Closed **N** with `Lock` |
| aging: 5, bank: 2, paid-via: 2, payable: 5, expense-group: 3, excluded: zero-value / unattributed | | hidden: report text; paid via as `Tag` |
| new `rfq-stage`: suppliers, prices, ready, sent, expired | (ad hoc) | labels 1 to 5 above. UI-only keys, not database values |
| new `item-price`: waiting, priced, none | (ad hoc, `detailView.ts:20-29`) | labels 2, 9, 10 |

**Tone changes** (each needs the `[data-status]` blocks moved in `docs/design/tokens.css` and `src/index.css`):

| Key | Tone change |
|---|---|
| sourcing:covered | S→W |
| sourcing:no-offer | D→W |
| inquiry:chased | W→I |
| inquiry:no-offer | D→N |
| bid:bid-sent | S→I |
| goods:received | I→W |
| goods:partly-delivered | I→W |
| invoicing:part | I→W |
| payment:unpaid | N→I |
| month:closed | S→N |
| tcs:not-started | N→W |
| tcs:copy-received | I→W |
| fbr:generated | I→W |
| fbr:receipt | I→W |
| fx:unusable | D→W |
| fx-capture:none | N→W |

Two blocks are added: `rfq-stage:*` and `item-price:*`. The `company-role:both` ink block is removed, which leaves `--tone-ink-*` for the month lock bar only.

### 1.5 Chips per screen: what goes, what stays

| Screen | File:line (branch) | Now | Change |
|---|---|---|---|
| RFQ header | `RfqHeaderBlock.tsx:327-336` (rfqs) | stage (custom `CHIP_TONE` span) + due | `<StatusBadge dimension="rfq-stage">` + due (2 chips). Delete `CHIP_TONE` (287-291); `nextAction.ts:49-63` returns a key, not label and tone |
| RFQ items | `ItemsPanel.tsx:383-387` (rfqs) | per-item chip built from the inquiry and sourcing dimensions | `dimension="item-price"`, 1 per item |
| RFQ rate bar | `ItemsPanel.tsx:100-107` (rfqs) | fx chip always (Fresh) and No rate captured | Chip only for Old rate / No rate; fresh shows "Rate from today" text |
| Supplier replies | `SupplierReplies.tsx:135-138`, `SuppliersAsked.tsx:64-72` (rfqs) | 5 inquiry labels incl. Chased, Awaiting reply | 1 chip per supplier: Not asked yet / Waiting for prices (+×N) / Priced (+n of m) / Can't quote |
| Questions panel | `ClarificationsPanel.tsx:190, 212, 228` (rfqs) | chips as group headers | Plain `h3` headings with a count in words ("To ask the customer · 2") |
| Quotations panel | `QuotationsPanel.tsx:37-50` (rfqs) | Current / Replaced / Expired custom chips | Current: none. Replaced: text "Replaced by revision N". Expired: `bid:expired` |
| Paste or photo summary | `CaptureParts.tsx:475, 482` (rfqs) | 2 clarification chips | One sentence: "Marks 2 questions answered. Next: send the answers to the suppliers." |
| New RFQ side box | `IntakeParts.tsx:92-94` (rfqs) | sourcing chip | Goes with the side boxes (task R2-09) |
| Order title | `OrderHeaderBlock.tsx:142, 144` (orders) | lifecycle + trust chips **inside the h1** | Out of the h1 into the chip row (≤2). Trust estimated becomes a dashed underline on the dates |
| Order status strip | `OrderHeaderBlock.tsx:196, 201, 210, 230, 254` (orders) | 5 chips + lines | `StatusText` as each cell's first line (no box); the second line stays |
| Engineer job | `OrderHeaderBlock.tsx:479` (orders) | goods chip | `StatusText` |
| Commissioning panel | `CommissioningPanel.tsx:51` (orders) | chip repeats the strip | Remove |
| Margin panel | `MarginPanel.tsx:154` (orders) | Complete / Not final / Is GST included? | Complete hidden (rule 2) |
| Supplier orders | `LegsPanel.tsx:198` (orders) | 1 goods chip per row | Keep (new labels) |
| Company title | `CompanyPage.tsx:220` (orders), `CompanyParts.tsx:70-81` | role chip **in the h1** | `Tag` in the meta line |
| Company history | `SitesPanel.tsx:310-327` (orders) | up to 2 chips per order row + RFQ outcome | One `StatusText` per row: Cancelled > Overdue ("Payment overdue") > goods word; RFQ: Won / Closed, none while open |
| Supplier record | `SupplierRecordPanels.tsx:24-45, 233-245` (orders) | 8 outcome chips (round shape) + delivery chips | Plain words with a tone icon (`StatusText`): history facts |
| Companies list | `CompaniesPage.tsx:93` Role column (orders) | role chip | `Tag` |
| Who owes us | `ReceivablesPage.tsx:135-160` (money-today) | Payment chip column + Last reminder column | One **Next step** column (task R2-06): "Send a reminder · 12 days overdue" (late) / "Reminded 3 days ago" (waiting) / "Due 3 Nov" (waiting) / "Paid" (done) |
| GST register | `GstRegisterPage.tsx:140-141, 158, 347-348` (money-today) | TCS + FBR chips | Keep both columns (state columns), new labels |
| Margins | `MarginsPage.tsx:33-38` (money-today) | Costs complete / Margin not final / Is GST included? | Costs complete hidden |
| Month end | `ChecklistPage.tsx:132, 265`, `MonthEndFrame.tsx:41` (money-today) | Open / Closed | Only Closed |
| Reports | `ReportPages.tsx:385` paid-via, `:647` payable (money-today) | chips | `Tag` for paid via; report text for payable |
| Exchange rates | `ExchangeRatesPage.tsx:135`, `RatesTable.tsx:25, 54` (main) | Fresh / Stale / Unusable | Chip only Old rate / No rate; fresh shows the age as text |
| Team | `TeamPage.tsx:120` (money-today) | Active / Deactivated column | Only Deactivated (rule 2) |
| Things to check | `ExceptionsPage.tsx:77-87` (money-today) | 3 ad-hoc pills | `NeedsCount` pills for critical and warning counts; "All clear" as `StatusText` done |
| Match bank statement | `BankTickPage.tsx:180-195` (money-today) | ad-hoc chip | `StatusText`: "7 to match" (now) / "Everything matched" (done) |
| Issue PO | `IssuePoDialog.tsx:65-73` (orders) | `SourceChip` (tone tints) | `Tag` (provenance, not state) |

### 1.6 Code changes

| File | Change |
|---|---|
| `src/lib/status.ts` (foundation) | Labels and tones per 1.4. Add `hidden?: true` to `StatusDef`. Add the `rfq-stage` and `item-price` dimensions. `TONE_ICON`: info `Clock`, warning `CircleArrowRight`, neutral `Circle`; remove `ink` from `Tone`. Overrides: deadline due-soon `CalendarClock`; order cancelled, user deactivated and inquiry no-offer `Ban`; month closed `Lock`. Export `TONE_OF_STEP = { late: 'danger', now: 'warning', waiting: 'info', done: 'success', inert: 'neutral' }` |
| `src/ui/StatusBadge.tsx` (foundation) | Return `null` when the resolved key is `hidden` (one test per hidden key) |
| `src/ui/StatusText.tsx` (new) | `<StatusText tone="now" detail="…">label</StatusText>` or `<StatusText dimension value detail/>`. Icon from the tone, colours per 1.2 rule 5. Replaces `NextStepText` (`OrdersListPage.tsx:57-72`) and `NextStepCell` / `OpenCard` tone code (`BoardParts.tsx:16-21, 54-65, 120-123`) |
| `src/features/rfqs/board/model.ts` (rfqs) | `NEXT_STEP_LABEL` reads `STATUS['rfq-stage']`. `NextStepText.tone` becomes `'now' | 'waiting' | 'done' | 'late'` (suppliers and ready: now; prices and sent: waiting; expired: now) |
| `src/features/orders/lib/nextStep.ts` (orders) | Keep `NextStepTone` but rename it into the shared type; add `inert` for Cancelled |
| `src/lib/timeWords.ts` (new) | Used by `today/rules.ts:86-96` (`dueBadge`, `ageBadge`), `rfqs/lib/detailView.ts:98-111`, `rfqs/board/model.ts:207-216`, `ReceivablesPage.tsx` `DUE_WORD`, `orders/lib/nextStep.ts:35` |
| `docs/design/tokens.css` + `src/index.css` (foundation) | Move the keys between tone blocks per 1.4. Add the `rfq-stage:*` and `item-price:*` blocks. Drop `company-role:both` from the ink block |
| `src/features/companies/CompanyParts.tsx` (orders) | `RoleChip` renders `Tag` (dashed for prospect) |
| `src/dev/gallery/tables.tsx:150-156` | Draw the 34 visible labels as one "Status vocabulary" sheet; hidden keys under a "text only" heading |
| `docs/DESIGN_SYSTEM.md` §6 | Replace the table with 1.2 and 1.3 |
| `docs/DECISIONS.md` | Add an entry |

### 1.7 Acceptance checks

- `status.test.ts` gains five tests:
  - (a) the set of labels on non-hidden entries has **≤ 35** members;
  - (b) each non-hidden label maps to exactly one tone;
  - (c) every `rfq-stage` and `item-price` key has a tokens.css rule (the existing parity test covers this once the keys exist);
  - (d) no label matches `/\d+d\b|\bLate\b/` (time words come from the helper);
  - (e) `StatusBadge` renders nothing for every hidden key.
- `rg -n "bg-tone-(success|warning|info|danger)-bg" src/features` lists only alert or banner blocks, no chips. Reviewer allow-list: `Banner`-style warnings in `LegsPanel`, `OrderHeaderBlock`, `SplitLineDialog`, `ConvertDialog`, `PasteReply`, `ClarificationsPanel:168`, `ItemsPanel:392`, `BurstSheet`, `IntakeParts:140,159`, `IntakeScreen:588`, `ItemsEditor`, `CaptureParts:460`, `TickPanel:146`.
- `rg -n "<StatusBadge" src/features -g "!*.test.*" | wc -l` drops from 60 to about 35, and none sits inside an `<h1`.
- RFQ, Order and Company headers show at most 2 chips at 1366 and 375, checked in the e2e header tests (`RfqHeaderBlock.test.tsx`, `OrderPage.test.tsx`, `CompanyScreens.test.tsx`).
- e2e and unit tests updated: grep each old label. Today there are about 70 assertions (a few hits are unrelated), for example:
  - "Not sent to suppliers" ×10
  - "Current" ×8
  - "Chased" ×7
  - "Quoted" ×6
  - "Stale" ×5
  - "Not invoiced" ×4
  - "Not final" ×4
- The visual baselines regenerate through the CI `update_baselines` job.

---

## 2. Counts: a number beside a nav item, tab or switch always means "needs you"

### 2.1 Rule (DESIGN_SYSTEM §12 already says it; this makes the code obey it)

- **Pills.** A number in a pill (nav, tab, segmented option, toggle) is the count of items **that need someone on our side to act**. It is drawn by one component, `NeedsCount` (in `src/ui/Tag.tsx`): warning tint, mono, and screen-reader text ", N need you". A pill is never shown for zero.
- **Words.** Other counts are written in words: a lede ("12 open, 3 overdue"), a footer ("Showing 7 of 12"), a group heading ("Waiting · 5"), a panel meta ("3 files").
- **Enforced by types.** `SegmentedControl` `count` and `Tab` `count` are renamed `needs`, so TypeScript flags every caller. Each caller must either drop its number or prove it is a needs-you count.

### 2.2 Inventory and decision

| # | Where (file:line, branch) | Counts now | Needs you? | Decision |
|---|---|---|---|---|
| 1 | Top bar and phone tabs, Today: `useNavCounts.ts:23` (main) | Today's active list | yes | Keep. Style as `NeedsCount` (`TopBar.tsx:65-67` (foundation) is a muted number today; `MobileChrome.tsx:117` `CountBadge` is green primary: make it solid warning) |
| 2 | RFQs: `useNavCounts.ts:29` | **every open RFQ** | no | **Change**: Today's active items whose section is RFQs (see 2.3) |
| 3 | Orders: `useNavCounts.ts:30` (`useActiveOrderCount`, a head request) | **every active order** | no | **Change**: Today's active items whose section is Orders. Delete the head request (`orders/api.ts:634`, `useActiveOrderCount`) |
| 4 | Money: `useNavCounts.ts:25-26` | Today's Money items | yes | Keep (now defined as the Money section of the same partition) |
| 5 | Today header: `TodayScreen.tsx:130-131` (money-today) | "N need you · N due now" | yes (words) | Keep |
| 6 | Today switch: `TodayScreen.tsx:141` | active per tab | yes | Keep (`needs`) |
| 7 | Today group headings: `TodayScreen.tsx:171` | items per group | subset of needs you | Keep as words |
| 8 | Today Waiting: `TodayScreen.tsx:199` | waiting items | no | Keep as words, never a pill ("Waiting · 5") |
| 9 | RFQs Mine / All: `BoardPage.tsx:236-237` (rfqs) | open RFQs | no | **Remove** |
| 10 | RFQ step filter: `StepFilter.tsx:12, 37` (rfqs) | All open, each step, Closed (all-time, `useClosedCount`) | Needs suppliers and Ready to quote: yes; the rest: no | **`NeedsCount` only on Needs suppliers and Ready to quote.** Remove the others. Delete `useClosedCount` and `board/api.ts:148`. Lede `BoardPage.tsx:253` becomes "12 open · 4 need you · 3 overdue" |
| 11 | Orders tabs: `OrdersListPage.tsx:339` (orders) | Active / Done / Cancelled totals | no | **Remove** |
| 12 | Orders Mine / All: `OrdersListPage.tsx:220-221` | totals | no | **Remove** |
| 13 | Orders filter selects: `OrdersListPage.tsx:200` "On order (5)" | facets | n/a | Keep (inside the Filters sheet only) |
| 14 | Orders "Filters (2)": `OrdersListPage.tsx:225` | active filters | n/a | Change wording to "Filters · 2 on" (a state, not a to-do) |
| 15 | Orders lede: `OrdersListPage.tsx:273` | "N active · N done · N cancelled" | no | "4 need you · 7 waiting" (from the Next-step tone). The Active tab groups rows "Needs you · 4", "Waiting · 7", "Nothing left · 2" with `DataTable` `group`, rows pre-sorted by `rank` (task R2-05) |
| 16 | Companies switch: `CompaniesPage.tsx:152-155` (orders) | All / Customers / Suppliers / Prospects totals | no | **Remove** (footer "Showing N of M companies" stays) |
| 17 | Money tabs: `MoneyFrame.tsx:41-45, 92-97` (money-today) | Who owes us = reminder due; Invoices & GST = needs attention; Month end = checks with items | yes | Keep. Swap the inline pill for `NeedsCount` |
| 18 | Who owes us Overdue: `ReceivablesPage.tsx:219` (money-today) | **all** overdue (includes those reminded within 7 days) | partly | **Remove.** The tab badge (#17) carries the to-remind count; the SumBar sub-line already says "N due a reminder" |
| 19 | GST toggles: `GstRegisterPage.tsx:226-231` (money-today) | needs attention, not sent by TCS | yes | Keep. `NeedsCount`; see 3.3 for merging into one switch |
| 20 | Margins toggle: `MarginsPage.tsx:117-118` | paid but margin not final | yes | Keep, `NeedsCount` |
| 21 | Team switch: `TeamPage.tsx:227-229` (money-today) | All / Active / Deactivated totals | no | **Remove** |
| 22 | Things to check: `ExceptionsPage.tsx:77-87` | critical, warnings | yes | `NeedsCount` (danger variant for critical) |
| 23 | Bank groups: `TickPanel.tsx:57, 65, 81` (main) | not ticked, older, ticked | headings | Keep as words |
| 24 | GST month groups, SumBar counts, panel metas, the Questions "Withdrawn (N)" toggle | sizes | n/a | Keep as words |

### 2.3 Nav partition (one source, so the numbers add up)

- **Code.** Add `navSectionOf(item: TodayItem): 'rfqs' | 'orders' | 'money'` to `src/features/today/rules.ts` (money-today):
  - `tab === 'money'` gives **money**: payment overdue, delivered not invoiced, close month, costs, FBR, TCS, recurring;
  - else an item with `orderId` gives **orders**: goods late, place PO, plan commissioning, to source, the engineer's job rules;
  - else **rfqs**: chase customer, relay answers, not floated, chase supplier, quotation due, decision overdue.
- **`useNavCounts.ts`** becomes `today = active.length` and each section count is `active.filter(i => navSectionOf(i) === key).length`. Money goes to admin and sales only. Zero shows no badge.
- **Result.** "Today 9 · RFQs 4 · Orders 2 · Money 3" always adds up, and the shell makes no extra request. An engineer's Orders badge is their jobs.
- **Accessible name.** `TopBar.tsx:65-67` and `MobileChrome.tsx:117-121` render ", 4 need you" as screen-reader text.

### 2.4 Acceptance checks

- A unit test in `rules.test.ts`: every `RuleKey` maps to exactly one section, and the section counts sum to `active.length` for a mixed fixture.
- `NavCounts.test.tsx` (main) is rewritten. Today, RFQs, Orders and Money come from the Today fixture; there is no `v_order_state` head request; links are named `/^RFQs, \d+ need you$/`.
- `rg -n "count[:=]" src/features --glob '*.tsx'` shows no `count` on `SegmentedControl` or `Tab` (they take `needs`).
- On a 375 px phone with an empty Today, no bottom tab shows a badge.

---

## 3. Search and filters

### 3.1 One search pattern

| Aspect | Spec |
|---|---|
| Component | Extend `src/ui/TableFilter.tsx` (foundation). Everything lives in a DataTable toolbar, first control on the left |
| Size | 320 px from `sm`, full width on a phone, `--control-h` tall |
| Placeholder and name | `Search {plural noun}`: "Search RFQs", "Search orders", "Search companies", "Search invoices", "Search balances", "Search expenses", "Search people". The `aria-label` is the same text. No field lists in the placeholder: they go in the no-results state (3.3) and in an `aria-describedby` hint |
| Keys | `/` focuses the field (the existing `data-table-filter` hook, `DataTable.tsx:281-294`). Esc clears; a second Esc leaves (`TableFilter.tsx:26-33`) |
| Hints | A `/` `Kbd` sits at the right edge of the field, `md` and up, when it is empty and not focused (`aria-hidden`; `aria-keyshortcuts="/"` on the input). A clear (×) button appears when it has text (44 px on touch) |
| Matching | Every word must match, case-insensitive (as `board/model.ts:177-184` does) |
| Address | The text lives in `?q=` on every list, so a reload or a shared link keeps it. This is new for RFQs, Companies, GST, Team and Expenses |
| Global search | The palette keeps "Search or jump to" (`TopBar.tsx:78-91`, `CommandPalette.tsx:242`). On phones it is the search icon. It is the only search not tied to a list |
| Pickers | Paste or photo's RFQ and order pickers (`CaptureParts.tsx:303, 377`), New order's past-order search and the supplier picker are pickers, not list searches. They keep their own field and sentence placeholders |

### 3.2 Per screen: what stays visible and what moves into the Filters sheet

**Rule:** at most one toolbar row above a list on desktop, two on a phone. That row holds the search, at most one switch of up to 5 options, and a `Filters · n on` button. The page's primary action sits in the page header.

**The sheet:** extract `src/ui/FilterSheet.tsx` from the Orders pattern (`OrdersListPage.tsx:293-316` popover from 640 px, `:348-372` Dialog sheet below 640, footer "Show N {noun}" + Clear).

| Screen | Search now | Visible after | Into the Filters sheet |
|---|---|---|---|
| RFQs (`BoardPage.tsx:204-226`, own "/" handler `:76-87`) (rfqs) | custom TextField "Filter RFQs" / "Search closed RFQs" | `TableFilter` "Search RFQs" (server search on Closed kept, `board/api.ts`); step filter (`StepFilter`); Mine/All | Phone: Mine/All goes into the sheet, so the phone shows search plus the step select. Delete the board's own "/" listener |
| Orders (`OrdersListPage.tsx:292`) (orders) | "Customer, item, order or PO" | "Search orders"; Mine/All (desktop); Filters | Goods, commissioning, invoicing, payment (already there); Mine/All on a phone (already there) |
| Companies (`CompaniesPage.tsx:146`) (orders) | "Name, contact, phone or city" | "Search companies"; role switch (no counts) | none |
| Who owes us (`ReceivablesPage.tsx:209-221`) (money-today) | none | **Add** "Search balances" (customer, order number, invoice number); Open / Overdue / Paid (no count) | none |
| Invoices & GST (`GstRegisterPage.tsx:224-247`) (money-today) | own TextField "Invoice or customer", no "/" | "Search invoices"; **one** switch "All · Needs attention N · Not sent by TCS N" (replaces the 2 independent toggles; mutually exclusive is fine, since each matches one stamping job); New invoice → "Create invoice" | Export moves to a toolbar "More" menu (admin) |
| Expenses (`ExpensesTab.tsx:90-112`) (main) | none | month pager; **add** "Search expenses" (payee, note, category, order number); Filters | Group, Category, Paid via (the 3 always-visible selects at `ExpensesTab.tsx:138-166`) |
| Team (`TeamPage.tsx:213-230`) (money-today) | own TextField "Search name or email" | `TableFilter` "Search people"; All / Active / Deactivated (no counts) | none |
| Today | none (by design) | tabs | none |

**Density switch.** Make `DataTable`'s default `densitySwitch` **false** (`DataTable.tsx` prop default). It is still drawn on Companies, Expenses, GST register, Who owes us, Team and the 5 report tables. Bigger text is the owner's choice, and "Smaller text" in the account menu is now the single density control. Update DESIGN_SYSTEM §11 to match.

### 3.3 Empty and no-results states

- **New `src/ui/NoResults.tsx`** (built on `EmptyState`, mood neutral):
  - Title: `Nothing matches "{q}"`.
  - Body: `Searched {scope} by {fields}.` and, when filters are on, `Filters on: {list}.`
  - Actions (at most 2, per `EmptyState`): **Clear search** ("Clear search and filters" when filters are on) and **Search everywhere for "{q}"**.
  - Search everywhere opens the palette with the text filled in. The palette covers companies, contacts, every RFQ including closed ones, orders, order items, supplier POs and invoices (`features/search/paletteSource.ts`).
- **Palette.** `PaletteApi.open(query?: string)` (`src/app/palette/usePalette.ts`, main). `PaletteHost` keeps `initialQuery`. `CommandPalette` gets `initialQuery` and applies it in the open effect (`CommandPalette.tsx:121-123` currently resets to '' on close; set it on open).
- **Where it replaces the current states.** Each line gives the scope and fields:
  - `BoardPage.tsx:159-165`: open RFQs, or every closed RFQ, by number, customer, their reference and item.
  - `OrdersListPage.tsx:261-271`: orders by customer, site, item, order number and PO.
  - GST register: invoices by number and customer.
  - Team.
  - `ExpensesTab.tsx:113-120`.
  - Who owes us.
- **Companies keeps "Add {name}"** (`CompaniesPage.tsx:160-184`), and its body gains an inline "search everywhere" link (two actions is the limit).
- **Empty (no data) states stay as goal states.** None of them gets a search suggestion.

### 3.4 Acceptance checks

- `rg -n 'placeholder="' src/features | rg -i 'search|filter'` lists only `Search …` placeholders plus the 3 pickers.
- Pressing `/` on RFQs, Orders, Companies, Invoices & GST, Who owes us, Expenses and Team focuses the search. One unit test per page; the shared one is in `DataTable.test.tsx`.
- `?q=` survives a reload on every list (an e2e check in the list specs).
- A no-results "Search everywhere" opens the palette with the text in the box (unit test in `CommandPalette.test.tsx` + one e2e).
- Phone at 375: no list has more than 2 toolbar rows above the first row. The e2e checks the toolbar height ≤ 2 × (control + gap).

---

## 4. Keyboard shortcuts: one "?" sheet, quiet hints

### 4.1 Every shortcut in the code (post-merge)

| Where | Keys | What | Source |
|---|---|---|---|
| Anywhere outside a text field | Ctrl K / ⌘K | Search or jump to (works in fields too) | `CommandPalette.tsx:104-114` |
| | N | New RFQ | `PaletteHost.tsx:92-113` |
| | C | Paste or photo | `CaptureProvider.tsx:202-214` (also matched in `PaletteHost.tsx:105-107`; that path is dead because Capture prevents default first: **remove it**) |
| | G, then T | Go to Today | `PaletteHost.tsx:96-109` |
| | Ctrl V / ⌘V | Paste anywhere opens Paste or photo with it | `CaptureProvider.tsx:170-178` |
| | Drop files | Opens Paste or photo | `CaptureProvider.tsx` `onDrop` |
| | Ctrl Z / ⌘Z | Undo the last action while its Undo shows | `Toast.tsx:88-101` |
| | Esc | Close a dialog, sheet or menu | Radix |
| | **?** | **This sheet (new)** | |
| Lists and tables | / | Jump to the list's search | `DataTable.tsx:281-294` |
| | Esc (in the search) | Clear; again leaves the field | `TableFilter.tsx:26-33` |
| | ↑ ↓ or J K | Move between rows | `DataTable.tsx:359-390` |
| | Home / End, Page Up / Page Down | First or last row; 10 rows | same |
| | Enter | Open the row | same |
| | Space | Tick the row (GST register, bank matching) | same |
| Search box (palette) | ↑ ↓, Enter, Ctrl Enter / ⌘↵, Esc | Move, open, open in a new tab, close | `CommandPalette.tsx:198-207, 306-321` |
| Writing | Ctrl Enter / ⌘↵ | Save: Paste or photo, adding customer questions, an answer | `CaptureSheet.tsx:323`, `ClarificationParts.tsx:72, 274` |
| | Enter / Esc | Save / cancel an inline edit, a typed supplier price, a line price, the expected cost | `InlineEditRow.tsx:51-55`, `SupplierReplies.tsx:462`, `OrderItemsPanel.tsx:234, 373`, `MarginPanel.tsx:215` |
| Add expenses | Enter, Tab, Ctrl Enter, Esc | New row, next cell, save all, close | `BurstSheet.tsx:236-270` |
| | ↑ ↓, Tab, Esc (category list) | Choose, accept, cancel | `CategoryPicker.tsx:241-248`, `OrderTagPicker.tsx:178-181` |

### 4.2 The sheet

- **Files.**
  - `src/app/shell/shortcuts.ts` (new) is the one registry: `{ group, keys: string[], what, where? }`. Mac shows ⌘ and others Ctrl (`modKeyLabel` in `src/ui/paletteSources.ts`).
  - `src/app/shell/ShortcutsSheet.tsx` (new) is a `Dialog`, 520 px, titled "Keyboard shortcuts". Its 5 sections follow 4.1; keys are drawn with `Kbd`.
- **Ways to open it.**
  1. `?` (Shift+/) anywhere outside a text field or dialog, in the `PaletteHost` key handler (same `isTypingContext` guard). This does not clash with `/`: the `/` handlers check `e.key === '/'`, and Shift+/ gives `'?'`.
  2. The account menu gets "Keyboard shortcuts" with a `?` key hint (`AccountMenu.tsx:40-50`, foundation). It shows only where `(pointer: fine)` and from `md` up.
  3. The palette's idle Actions get "Keyboard shortcuts" (`PaletteHost.tsx:79-89`), also found by typing "keys" or "shortcuts".
- **Phones** never see an entry (no keyboard).

### 4.3 Hints without clutter (desktop only; nothing new on phones)

1. **Tooltips carry the key** where the `Kbd` is hidden below 2xl (`TopBar.tsx:92, 110`): "Search or jump to · Ctrl K" on the search box and "Paste or photo · C" on the action. Every "New RFQ" button (`BoardPage.tsx:271`, company page, empty states) gets the tooltip "New RFQ · N". Use `Tooltip` with `<Kbd size="inline">`.
2. **`aria-keyshortcuts`**: `Control+K Meta+K` on the search box, `C` on Paste or photo, `N` on New RFQ, `/` on every list search.
3. **The `/` hint inside each list search** (3.1).
4. **Footers.** The palette footer (`CommandPalette.tsx:306-321`) adds "? Shortcuts". The DataTable key legend (`DataTable.tsx:780-789`) adds "/ search" when a filter exists.
5. **Remove the always-on legends** that the audit flagged for non-technical users:
   - the Add expenses header legend (`BurstSheet.tsx:255-272`: Enter, Tab, Ctrl+Enter, Esc) and the "Filled in for you / You typed this / Keyboard only" legend (`:320-335`);
   - their content moves to the sheet;
   - the Ctrl↵ key stays inside the Save button (`BurstSheet.tsx:447-448`).
6. **Guides**: `docs/guides/{SALES,ADMIN}.md` get one line each: "Press ? on a computer to see the keyboard shortcuts."

### 4.4 Acceptance checks

- `shortcuts.test.tsx` (foundation) gains three checks:
  - `?` opens the sheet;
  - it does not open while typing or with a dialog open;
  - every key in `shortcuts.ts` appears in the sheet.
- A source test: each key handled by `CaptureProvider`, `PaletteHost`, `CommandPalette`, `DataTable`, `Toast` and `BurstSheet` is listed in `shortcuts.ts` (a grep over the listed files for `e.key` literals).
- No `Kbd` is visible at 375 px (e2e on the phone shell check).

---

## 5. Page structure template

### 5.1 Tokens and classes (the existing scale; one addition)

| Item | Value |
|---|---|
| Page gutters | `px-4` phone, `md:px-8` everywhere. Money (`MoneyFrame.tsx:47`) and Settings (`SettingsLayout.tsx:106`) use `md:px-10`: align them. The Receivables split at 1360 gains 16 px, so no fold threshold breaks |
| Top and bottom | `pt-6 pb-12` on lists; `pt-6 pb-16` on details (phone `pt-4`). Order uses `pt-4 md:pt-6` (`OrderDetailScreen.tsx:43`): align it |
| Widths | Lists `max-w-table` (1280). Details: add the token `maxWidth.detail = '1440px'` to `tailwind.config.ts` and use it in place of `max-w-[1440px]` in `RfqDetailScreen.tsx:56`, `OrderDetailScreen.tsx:43` and `CompanyPage.tsx:101`. Forms keep their own cap (intake `max-w-[1100px]`). Money stays full width (the Receivables split) |
| Page title | h1 `text-2xl font-semibold tracking-tight` (30/36; `--tracking-tight` is for ≥ 28 px). RFQ and Order use `tracking-snug` (`RfqHeaderBlock.tsx:317`, `OrderHeaderBlock.tsx:136`): align them. Phone detail pages use `max-md:text-xl` |
| Sub-page title | `MoneySubHeader` h2 `text-xl` (unchanged) |
| Panel title | `text-base font-semibold`, panel padding `px-5 py-4` |
| Lede and meta | Lede: `text-sm text-fg-muted`, one sentence. Meta line: `text-sm text-fg-2` with "·" separators, at most 5 items |
| Gaps | 24 (`gap-6`) between page sections; 16 (`gap-4`) between header parts; chip row `mt-2 gap-2` |

### 5.2 List page template: new `src/ui/PageHeader.tsx`

```
<div class="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-6 md:px-8">
  <PageHeader title="Orders" lede="4 need you · 7 waiting" primary={…} secondary={…} />
     h1: max-md:sr-only (the phone bar already shows the destination; today it repeats it)
     at most 1 primary (green) + 1 secondary; nothing else
  [Tabs or one switch row, if the page has one]
  <DataTable toolbar={[search, ≤1 switch, Filters]} … />
```

Adopt it on:
- `BoardPage.tsx:263-277` (rfqs)
- `OrdersListPage.tsx:323-334` (orders)
- `CompaniesPage.tsx:105-116` (orders)
- `MoneyFrame.tsx:48-72` (money-today; the Reports link counts as the secondary)
- `TeamPage.tsx:~145-150` and the other Settings pages (money-today, main)
- `ExchangeRatesPage.tsx:46` (main)

Today keeps its own layout; its h1 is already `sr-only` on phones (`TodayScreen.tsx:124`).

### 5.3 Detail page template: new `src/ui/DetailHeader.tsx`, `src/ui/MoreMenu.tsx`, `src/ui/StickyActionBar.tsx`

```
<header>
  Breadcrumb (md+): Section › CODE (mono), default muted style
  Row: [h1 = NAME (a link to the company on RFQ and Order)  +  CODE as num text-lg font-medium text-fg-muted, hidden below md]
       [right: the ONE primary button · ≤1 secondary · More ▾]
  Chip row (mt-2): ≤ 2 StatusBadges, never inside the h1
  Meta line: text-sm text-fg-2, "·" separators, ≤ 5 items
  Optional: one facts strip (dl grid or status strip, ≤ 6 cells, StatusText not chips), one Next-step sentence
</header>
```

**More menu (`MoreMenu`).** On desktop it is a text button "More" with `ChevronDown`, the RFQ pattern. On a phone it is an `Ellipsis` icon in the one bar. Row-level menus stay icon `…` with `aria-label="More for {name}"`. Today the Order and Company page menus are icon-only "More actions" (`OrderHeaderBlock.tsx:313`, `CompanyPage.tsx:189`).

**Primary action.** The header's right side on desktop, `StickyActionBar` on a phone.

**`StickyActionBar`.** Fixed to the bottom with a safe-area pad. It holds the primary and at most 1 secondary (RFQ: Chase) plus More. Its page sets `useMobileBar({ hideTabs: true })` and gets `max-md:pb-[calc(var(--control-lg-h)+2rem)]`. It replaces three implementations:
- `RfqHeaderBlock.tsx:441` (`sticky bottom-0`)
- `OrderHeaderBlock.tsx:366-374` `PhoneSticky` (`fixed bottom-0`)
- `ChecklistPage.tsx:151` (`max-md:sticky`)

| Page | Changes |
|---|---|
| RFQ (`RfqHeaderBlock.tsx:296-420`) (rfqs) | Stage chip via the registry (1.5). Drop the "Company" `Meta` cell (it repeats the title; make the h1 name the link). More becomes `MoreMenu` |
| Order (`OrderHeaderBlock.tsx:134-170, 379-393`) (orders) | Chips out of the h1 into the chip row. The code changes from `font-regular text-fg-2`, shown on phones, to the template style (hidden below md: the phone bar shows it). `OrderMoreMenu` trigger becomes `MoreMenu`. **The primary button moves from the "Next step" box to the header's right**; the box keeps its sentence as the Next-step line. *Flag for the orchestrator: this changes a layout the orders branch just built. The alternative is to give the RFQ the same box. Pick one; consistency is the point* |
| Company (`CompanyPage.tsx:213-250`) (orders) | Role becomes a `Tag` in the meta line. Breadcrumb uses the default style (drop `links="primary"`, line 215). Edit is the secondary, plus `MoreMenu` |

### 5.4 Phone page template

- **One bar.** `useMobileBar({ title, back: 'history', fallback, actions: <MoreMenu touch/>, hideTabs })`, with at most 2 actions. The title is the **code** for RFQs and orders and the **name** for a company. The content h1 shows the name.
- **List pages.** Bottom tabs, no duplicate h1 (5.2), a toolbar of at most 2 rows (3.2).
- **Detail pages.** The sticky action bar holds the primary; bottom tabs are hidden while it shows.
- **No sideways scroll anywhere.** Option strips wrap or become a select (already the rule in DESIGN_SYSTEM §12).

### 5.5 Acceptance checks

- One unit test per template: `PageHeader` renders `h1` with `max-md:sr-only`, and at most 1 primary button (it throws in dev with 2).
- `DetailHeader` never puts a `StatusBadge` inside `h1`: the accessible name of `h1` equals name + code.
- `rg -n "max-w-\[1440px\]" src/features` returns nothing.
- `rg -n "md:px-10" src/features` returns nothing.
- `rg -n "PhoneSticky|sticky bottom-0" src/features` returns nothing.
- At 375 px:
  - every list page shows its first data row within 260 px of the top bar (e2e `shell-overflow.spec.ts` gains the check);
  - RFQ, Order and Company show one bar and one sticky bar, with no bottom tabs.
- At 1366 px: the primary button sits at the top right on all 3 detail pages (a screenshot check in the gallery scene).

---

## 6. Recommendations from navigation.md and screens.md that no branch covers: round-2 tasks

**Coverage check.**
- **Done** by the branches: navigation recs 1, 2, 3, 5, 6, 8, 9, 10, 11, 13, 15, 16, 17, 18, 19, 20; rec 14 done in money-today f8bc915 and rfqs 5443e31, pending the SALES.md merge.
- **Partly done**: rec 4, the phone card (the reminder panel has Open order) and rec 12.
- **screens.md**: 7 of 10 top changes done; the rest are below.

| ID | Source | Gap after merge | Files (branch) | Effort |
|---|---|---|---|---|
| R2-01 | 1 of this spec | Status vocabulary | §1.6 list | L |
| R2-02 | 2 | Counts mean "needs you" | §2 list | M |
| R2-03 | 3 | One search, FilterSheet, NoResults, palette `open(q)`, density switch off | §3 list | M |
| R2-04 | 4 | Shortcuts sheet and hints | §4 list | S/M |
| R2-05 | screens 7 rec 2 | Orders list has no "Needs action / Waiting" split | `OrdersListPage.tsx:164-181, 275-319` (group rows by `NextStep.tone`, sort by `rank`) (orders) | S |
| R2-06 | screens 10a, pattern "Next step" | Who owes us still shows a Payment chip column + Last reminder column | `ReceivablesPage.tsx:135-160` → one Next step column via `StatusText`; phone card `:236-268` (money-today) | M |
| R2-07 | nav rec 12, DECISIONS 2026-10-20 (1) | WhatsApp/Email is still a 2-option switch on Today (`ContextPane.tsx:334-342`), the payment reminder (`ReminderPanel.tsx:~140-150`) and the goods chase (`GoodsChaseDialog.tsx:~155-162`); RFQ screens use the "Email instead" link | Move `ChannelLink` from `rfqs/ChaseParts.tsx:46-53` to `src/ui/ChannelLink.tsx`; adopt it in the 3 places. Build it with a slot for the owner's new "Open in WhatsApp / Open in email" button, so that feature lands in one component | S |
| R2-08 | screens 1 rec 3 | Waiting on Today opens with ≤ 5 items | `TodayScreen.tsx:52` `WAITING_OPEN_MAX = 0`; collapsed line "Waiting · 5 · next nudge Mon 30 Nov" (money-today) | S |
| R2-09 | screens 5 rec 1 | New RFQ keeps the "This RFQ" + "Progress" side boxes at 1024 px and up (288 px column) | `IntakeParts.tsx:82-110` removed; the step line `:28-45` shows at all widths; `IntakeScreen.tsx:574` single column (rfqs) | M |
| R2-10 | screens 5 rec 2-3 | Supplier pill reads "2 same model"; 3 lines per supplier; Family column always shown | `SupplierPicker.tsx:104-130` ("2 items · same model", fold the evidence line into Memory); `ItemsEditor.tsx:214-260` (Family column only when the guess is unsure) (main) | S/M |
| R2-11 | screens 6 rec 1-2 | Paste or photo shows all 4 option cards; the sticky Save can cover the confirmation line | `CaptureSheet.tsx` / `CaptureParts.tsx` (show the picked option, "Something else ▾" for the rest; put the confirmation above the list) (rfqs) | M |
| R2-12 | screens 10c | Add expenses: cell tags "most used / carried / from category" and the two legends | `BurstSheet.tsx:255-272, 320-335, 500, 523, 791` (main); with R2-04 | M |
| R2-13 | screens 10d | Margins: Expected and Actual cost are 2 rows; margin last | `MarginsPage.tsx:41-80` (one Cost line with the not-final mark; margin beside the customer, bigger); total wording (money-today) | S |
| R2-14 | screens 13 rec 1 | Team table still shows "Active" on every row | Free with R2-01 (`hidden`); check `TeamPage.tsx:118-121` | S |
| R2-15 | nav 3.2 | "Create invoice" on the order vs "New invoice" in the register | `GstRegisterPage.tsx:245, 333` → "Create invoice" (money-today) | S |
| R2-16 | nav A2 | No "Pay supplier": the supplier order menu says "Add expense" | `LegsPanel.tsx:301` → "Pay {supplier}" (same dialog, same pre-fill) (orders); `ExpensesPage` copy | S |
| R2-17 | screens pattern 5 | Footnotes still shipped as text | `ExchangeRatesPage.tsx:48`, `TargetsPage.tsx:217` → `InfoTip` (main) | S |
| R2-18 | screens 15 rec 1-2 | Quotation PDF: Qty and Unit separate; "R2 / Supersedes QT-… R1" codes | `src/features/quotations/pdf/QuotationDocument.tsx` (Qty "2 pcs"; "Revised quotation (2nd revision), replaces the one of 26 Nov"); the file name unchanged (rfqs kept the PDF as is) | S |
| R2-19 | screens 9a rec 3 | Companies list has RFQs and Orders counts but no "Last activity" | `CompaniesPage.tsx:93-96` + `companies/api.ts` (max of last RFQ received and last order date per company, read-only) (orders) | M |
| R2-20 | cleanup | `DestinationPage` stand-in still routed as a fallback, its lede says "bids" | `src/app/routes.tsx:~186`, `src/app/pages/DestinationPage.tsx` (money-today): delete if unreachable, else fix the words | S |
| R2-21 | cleanup | `StatusTrack` no longer used (GST register shows the chip only) | `src/ui/StatusTrack.tsx` + its gallery scene: delete | S |
| R2-22 | docs | DESIGN_SYSTEM §6 (vocabulary), §11 (no density switch), §12 (top bar is 56, not 52; templates), new §16 Keyboard; `design/INVENTORY.md` for the new primitives (StatusText, NeedsCount, NoResults, FilterSheet, PageHeader, DetailHeader, MoreMenu, StickyActionBar, ShortcutsSheet) | foundation + money-today docs | S |

**Deferred, not proposed for round 2:**
- Reports period picker: the report views have no date; it needs a migration.
- Snooze as an icon-only button in the phone accordion (`ContextPane.tsx:375, 392`): fine at 44 px with a label.
- "Expense categories" vs "Expenses by category": acceptable.

### 6.1 Order of work (avoids file clashes)

1. **Batch A, in parallel.**
   - R2-01 core: `status.ts`, tokens, `StatusBadge`, `StatusText`, `timeWords`.
   - R2-04: shortcuts; it only touches shell files.
   - R2-21 and R2-22 docs skeleton.
2. **Batch B: shared layout primitives.** PageHeader, DetailHeader, MoreMenu, StickyActionBar, NeedsCount, FilterSheet, NoResults and palette `open(q)`. These are new files plus `Tag.tsx`, `SegmentedControl.tsx`, `Tabs.tsx`, `DataTable.tsx` and `usePalette.ts`.
3. **Batch C: one agent per area**, each applying R2-01 screen rows, R2-02, R2-03 and §5 to its own files:
   - **RFQs**: board and detail; R2-09, R2-10, R2-11.
   - **Orders and Companies**: R2-05, R2-16, R2-19.
   - **Money, Today and Settings**: R2-06, R2-07 (all 3 call sites), R2-08, R2-12, R2-13, R2-14, R2-15, R2-17.
4. **Batch D.** Fix e2e labels, regenerate baselines, run axe, then R2-18 and R2-20.

---

## 7. Expected score impact (estimates; a re-audit with the same method should confirm them)

| Audit dimension | Audit 10-19 | After the 4 branches (est.) | After round 2 (est.) | What round 2 adds |
|---|---|---|---|---|
| Navigation clarity | 6 | 8 | 9 | Nav badges mean "needs you" and add up to Today; one header, More and primary placement on every detail page |
| Findability | 5 | 7 | 8.5 | One search with `/` on 7 lists (3 had none); "Search everywhere" from every no-results state; `?q=` in the address |
| Task efficiency | 7 | 8 | 8.5 | Remembered channel as a link everywhere (plus a slot for Open in WhatsApp); Pay supplier; Waiting collapsed; shortcuts findable |
| Learnability | 4 | 6.5 | 8.5 | About 119 status words become 34, one tone meaning ("who acts next"); counts mean one thing; shortcuts sheet; Next step on 3 lists |
| Mobile navigation | 5 | 7.5 | 8.5 | No repeated title on list pages; one sticky-bar component; toolbars ≤ 2 rows; phone badges only for to-dos |
| Text size | 4 | 8 | 8.5 | Status text at body size replaces many 14 px chips |
| Contrast | 7 | 8.5 | 9 | One danger mark per row and header; tints only where a chip is allowed |
| Visual hierarchy | 6 | 7.5 | 8.5 | Chips out of h1s; header template; one count style; the primary always top right |
| Density | 5 | 7 | 8 | Density switch gone (10 tables); filters into one sheet; fewer chips per screen (about 60 → about 35 badge sites) |
| Mobile readability | 4 | 7 | 8 | Intake side boxes gone; one-bar titles; no legends in Add expenses |
| **Mean** | **5.3** | **≈ 7.5** | **≈ 8.5** | |

**What 10/10 still needs (outside this spec):**
- the owner's 2026-10-20 decisions: Open in WhatsApp, GST invoice PDF, PDF text reading, quotation pre-fill;
- a usability pass with the owner and one sales user on real imported data;
- a re-audit at 1366@100%, 1366@125% and 375.
