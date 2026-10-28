# Q-Tech CRM v2 design system

Status: v2, **direction C "Colour blocks"** (owner decision 2026-10-22, DECISIONS.md), on top of the v1 freeze of 14 Oct 2026 (Gate 2, D09). Changes need an entry in [`DECISIONS.md`](DECISIONS.md) and the orchestrator's approval; see section 15. Source of truth for every value is [`design/tokens.css`](design/tokens.css). This file explains the rules. Brand inputs come from [`BRAND.md`](BRAND.md): deep green `#1a7b46` for actions, brand green `#429446` for non-text only, teal success, light theme, tabular numbers.

Direction in one line: sort the day into **big blocks of colour** you can read from across the room. A navy top bar; white tiles on a quiet blue-grey field; Late, Today and This week as red, yellow and blue blocks; the next step on every record in a navy band that holds the one green button; Archivo, with a wider cut for titles; rounded corners on a 10 / 12 / 16 ladder. Colour and space do the separating, not thin lines. (v1 was "an instrument panel tidied by someone who cares"; the owner found it bland.)

## 1. Webfont

**Archivo** (SIL OFL, Omnibus-Type), self-hosted through `@fontsource-variable/archivo` (free; CSP `font-src 'self'` unchanged). Two faces, each a small core file plus the full latin file by `unicode-range`, made by `scripts/fonts/subset-archivo.py`:

| Face | Token | Axes | Core file |
|---|---|---|---|
| `Archivo` | `--font-sans` | weight 400 to 700, normal width | 19 KB |
| `Archivo Wide` | `--font-display` | width pinned at 118 %, weight 600 to 800 | 15 KB |

34 KB of type on a first visit, down from 54 KB for Geist. Both stay off until the page's content is drawn (`.fonts-on`, `src/lib/afterContent.ts`): a first visit on a slow phone shows the words in the system font first (perf/lcp), then swaps (`font-display: swap`). No preload: a preloaded font competes with the page's own data. Geist Mono is retired; `--font-mono` is the system monospace, for pasted raw text only. The PDFs (quotation, PO, invoice, expense report) keep Geist for now (see BRAND 5).

Why Archivo: it is a grotesque drawn for both screen and print with a real width axis, so one family gives a calm, open body at 16 px and loud, wide titles and block headings without a second typeface. Its tabular figures (`tnum`) have a plain zero.

Gaps: no glyph for the rupee sign (U+20A8): use the `PKR` prefix, or render the symbol through the fallback in `<span class="cur">`. No arrows (U+2190 to 2193 fall back to the system font). Latin only; Urdu would need a Nastaliq face (out of scope).

## 2. Type scale

Owner decisions 2026-10-19 and 2026-10-22 (DECISIONS.md): **16 px is the floor for anything read**; 14 px is for timestamps only. A person can pick **Smaller** (Settings > Your details, or the account menu); that puts `data-text="small"` on `<html>` and restores the Gate 2 scale (12 / 13 / 14). It is the person's own choice, so it may go below 16. The choice is kept per device (`localStorage`, `qtech.text-size`) and applied before the first paint (`src/ui/useTextSize.ts`).

| Token | Normal (default) | Smaller (`data-text="small"`) | Use |
|---|---|---|---|
| `--text-stamp` | 14 / 20 | 12 / 16 | **Timestamps only** ("Opened 3 days ago", a paid-on date in a list). Class `text-stamp` |
| `--text-xs` | 16 / 22 | 12 / 16 | Captions, chip labels, kbd, meta lines, small buttons, compact tables |
| `--text-sm` | 16 / 24 | 13 / 20 | **Default for UI**: tables, lists, buttons, labels, secondary copy |
| `--text-base` | 16 / 24 | 14 / 22 | Body copy, row titles |
| `--text-lg` | 18 / 26 | 16 / 24 | Panel and card titles, block headings, the next-step sentence |
| `--text-xl` | 22 / 30 | 20 / 28 | Section headers, dialog titles, big inline figures |
| `--text-2xl` | 32 / 40 | 28 / 34 | Page titles |
| `--text-display` | 38 / 44 | 36 / 40 | One headline number per screen (target tile) |
| `--text-table` | 16 / 24 (= sm) | 13 / 20 | DataTable body; compact switches it to xs |

`xs`, `sm` and `base` are all 16 px at Normal and differ by line height. They stay three names so the Smaller scale keeps its steps and so code written before 2026-10-22 reads 16 without being touched. Hierarchy at 16 comes from weight, colour (`--fg`, `--fg-2`, `--fg-muted`) and the wide display face, not from smaller type.

On a phone every input is 16px whatever the scale, so iOS Safari never zooms the page (`controlClass` in `src/ui/form/fieldContext.ts`). Nothing around text has a fixed pixel height or line-height: chips, keys, segments, small buttons, table heads and rows read the tokens in section 11, so they grow with the text instead of clipping it.

**Faces and weights** (direction C; replaces v1's "never 700"):

| Role | Face | Weight | Class |
|---|---|---|---|
| Page titles (h1), To do block headings, dialog titles | Archivo Wide (`font-display`) | 750 (`font-heavy`) | `text-2xl font-heavy tracking-tight` |
| Section and panel titles (h2, h3) | Archivo Wide (every h1 to h3 takes it in `src/index.css`) | 600 | `font-semibold` |
| Row titles, buttons, tab and nav labels, chips | Archivo | 600 (`font-semibold`) or 500 | |
| Body, table cells | Archivo | 400 | |
| Amounts, codes | Archivo, tabular (`.num`) | 400 to 600 | |

750 belongs to the display face only; body text never goes above 600. Tracking: `-0.015em` at 28 px and up, `-0.01em` from 16 to 20 px, none below.

Rules:

- Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows.
- Line length for running text: 66 characters maximum (`max-width: 66ch`). Tables and lists are exempt.
- Titles use `text-wrap: balance`, paragraphs `text-wrap: pretty`.
- Muted text is `--fg-muted` (8.76:1 on white, 7.79 on the field, 7.23 on selected), never a lighter grey, and only for captions, hints and placeholders. It never sits on the yellow Today block: rows on a block are white tiles and carry their own text. Body copy and data in primitives use `--fg` or `--fg-2`.

### Tabular figures

Set with `font-variant-numeric: tabular-nums` (class `.num`), in the sans (`--font-sans`, Archivo's own `tnum` figures with a plain zero), so columns of rupees line up. Never turn on `slashed-zero` or the `zero` feature (a slashed zero read as a struck-out digit, owner 2026-10-20). `--font-mono` is the system monospace, for pasted raw text only. Use `.num` for:

- PKR amounts, quantities, percentages, margins.
- RFQ, PO, invoice, challan, quotation numbers and customer refs (`RFQ-0177`, `PO 000001`, `RFQ #74037`).
- Part numbers and model codes.
- Dates and times in tables, lists and rails (`Tue 1 Dec`, `17:00`).
- Phone numbers, NTN, STRN.

Right-align numeric columns. Amounts carry thousands separators. A number inside a sentence is set `.num` at the sentence's size and weight 500 (`<b class="num">4</b> days`). Plain counts in sans UI (a nav badge) use `.tab` (sans with tabular-nums) or mono, whichever sits next to other mono data.

## 3. Spacing

A strict 4px rhythm: `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 20, `--sp-6` 24, `--sp-8` 32, `--sp-10` 40, `--sp-12` 48, `--sp-16` 64. Use `gap` for sibling spacing, never margins.

Defaults: 16 inside a list row or card, 20 inside a panel with a header, 24 between page sections, 32 to 40 page gutters on desktop, 16 on phones. Tight groups (icon to label) 6 to 8, icon-to-icon 4.

Radius is a ladder, so hierarchy stays visible and the app does not turn into "the same card everywhere":

| Token | Class | Value | Use |
|---|---|---|---|
| `--radius` | `rounded` | 10px | Controls: buttons, inputs, selects, segments, menus, popovers, toasts, key hints |
| `--radius-row` | `rounded-row` | 12px | A row drawn as a tile (the To do rows), banners, small boxed notes and file rows |
| `--radius-panel` | `rounded-panel` | 16px | Panels, tables, dialogs, the next-step band, the colour blocks |
| `--radius-round` | `rounded-round` | 999px | Status chips, identifier tags, counts, dots, avatars, progress ends |

## 4. Elevation and separation

Colour blocks and white tiles do the separating. A panel is a white tile (`--bg-surface`, `rounded-panel`) on the quiet blue-grey field (`--bg-canvas`), with a 1px `--border` that only helps where two tiles meet; rows inside a panel keep one hairline between them. Tables mark their header with a 2px ink rule instead of a grey band. There are exactly three shadows, two for overlays and one ring:

| Token | Use |
|---|---|
| `--shadow-pop` | Menus, popovers, tooltips, command palette results |
| `--shadow-modal` | Dialogs and sheets, over `--bg-scrim` |
| `--shadow-on-navy` | The 2px white ring on the green button when it sits on navy (`shadow-on-navy`, set by `Button` itself inside `data-surface="navy"`) |

No shadow on cards, buttons, sticky bars or hover states. No gradients, glass, blur or glow, anywhere.

## 5. Colour

### Neutral ramp (primitives)

Blue-grey, hue about 218 degrees, plus a navy. Components never reference primitives directly; they use the semantic tokens below.

| Token | Hex | |
|---|---|---|
| `--neutral-0` | `#ffffff` | tiles |
| `--neutral-25` | `#f6f8fb` | |
| `--neutral-50` | `#eef2f7` | the quiet field: canvas, sunken, quiet block |
| `--neutral-100` | `#e3eaf4` | selected row, neutral chip |
| `--neutral-150` | `#dbe2ed` | |
| `--neutral-200` | `#d3dae5` | |
| `--neutral-250` | `#c5cedb` | hairline |
| `--neutral-300` | `#8592a6` | strong edge |
| `--neutral-400` | `#68758c` | field edge |
| `--neutral-500` | `#56637a` | |
| `--neutral-600` | `#4a566d` | |
| `--neutral-650` | `#364259` | hints |
| `--neutral-700` | `#28354d` | second line |
| `--neutral-800` | `#1c2638` | |
| `--neutral-900` | `#0c1526` | ink |
| `--navy-900` | `#132a4c` | top bar, next-step band, selected segment |
| `--navy-800` | `#1d3760` | a field or button on the navy |
| `--navy-700` | `#26457a` | its hover |
| `--navy-500` | `#7f93b5` | an edge on the navy |
| `--navy-200` | `#cdd7e6` | quiet text on the navy |

### Semantic roles

| Role | Token | Resolves to |
|---|---|---|
| App canvas (the field behind the tiles) | `--bg-canvas` | neutral-50 |
| Panel, list, input (a tile) | `--bg-surface` | neutral-0 |
| Table group row, hover, quiet block | `--bg-sunken` | neutral-50 |
| Selected row, segment track | `--bg-selected` | neutral-100 |
| Modal scrim | `--bg-scrim` | 48% ink |
| Text | `--fg` / `--fg-2` / `--fg-muted` | neutral-900 / 700 / 650 |
| Disabled | `--fg-disabled` | neutral-300 (WCAG-exempt) |
| Hairline | `--border` | neutral-250 (decorative) |
| Popover edge, secondary button | `--border-strong` | neutral-300 (3.15:1) |
| Form control edge | `--border-input` | neutral-400 (4.65:1 on white, 4.14 on the field) |
| Primary action fill | `--primary` `#1a7b46` | hover `#166a3b`, active `#115a31` |
| Links, any green text (`text-primary`) | `--primary-text` `#1a7645` | 5.64:1 on white, 4.66:1 on selected, 4.55:1 on the late tint, 3.23:1 against `--fg` |
| Non-text green | `--brand-green` `#429446` | focus ring, active indicator, selected control fill, progress, logo |

### Navy chrome (`data-surface="navy"`)

| Role | Token | Value |
|---|---|---|
| Top bar, phone bars, next-step band | `--bg-chrome` (class `bg-chrome`) | navy-900 |
| Text on it | `--fg-on-chrome` / `--fg-on-chrome-2` | white (14.35:1) / navy-200 (9.88:1) |
| A field or button on it, its hover | `--chrome-field` / `--chrome-field-hover` | navy-800 / navy-700 |
| An edge on it | `--chrome-input` | navy-500 (4.61:1) |
| Active indicator and focus ring on it | `--indicator-on-chrome` | `#4caf52` (5.17:1; brand green is 3.80 there) |

A navy element carries `data-surface="navy"` and the classes `bg-chrome text-fg`. The attribute re-inks the tokens inside it (`--fg` becomes white, `--bg-surface` the navy field, `--border-input` the navy edge, `--brand-green` the brighter indicator, `--tone-ink-*` turns the avatar white), so `Button`, `NeedsCount`, `Kbd`, `Avatar` and links need no navy variants. Pop-ups opened from the bar portal out of it and stay light. A green `Button` inside gets its 2px white ring automatically (`[[data-surface=navy]_&]:shadow-on-navy`): green on navy alone is 2.71:1, under the 3:1 a control's edge needs.

### Colour blocks

| Block | Background | Heading ink | Used for |
|---|---|---|---|
| Late | `--block-late-bg` (= danger tint `#fbe1dd`) | `--block-late-fg` `#8a1010` (7.82:1) | A To do group holding something past its date. **Red only for late money or a broken promise.** |
| Today | `--block-today-bg` (= warning tint `#ffeab0`) | `--block-today-fg` `#693400` (8.44:1) | Due now, nothing late |
| This week | `--block-week-bg` (= info tint `#e1eaf6`) | `--block-week-fg` navy (11.82:1) | The next five days |
| Quiet | `--block-quiet-bg` (the field) | `--block-quiet-fg` (10.95:1) | Ready to move, Waiting |

Tailwind: `bg-block-late text-block-late-fg`, and so on. A block is `rounded-panel` with 12px padding; its heading is `text-lg font-heavy` in the display face, in the block's own ink, with the count beside it; its rows are white tiles (`rounded-row bg-surface text-fg`, 8px apart), so hints and second lines sit on white, never on the yellow. An empty group draws no block at all (never an empty red box). The open row is a 2px ink ring inside its tile (`ring-2 ring-inset ring-fg`).

The green rule from BRAND.md stands: green means primary action, active or selected, or focus. Anything else that is green gets its green removed. Nothing in the UI uses brand green for text.

## 6. Status tones

Five tones, defined by **who acts next**. Every derived state resolves to one of them through `data-status="group:value"`, which sets `--status-fg` and `--status-bg`. The registry (`src/lib/status.ts`) is the one place a key becomes a label, a tone and a glyph; `status.test.ts` fails if it disagrees with the map in `tokens.css`. Database keys and view values never change; only the words and tones do (round 2, R2-01).

| Tone | Name in code | Means | Icon (lucide) | Text | Tint | Ratio | Chip | Status text |
|---|---|---|---|---|---|---|---|---|
| `warning` | `now` | We act next (you or a colleague) | `CircleArrowRight` | `--tone-warning-fg` `#693400` | `--tone-warning-bg` `#ffeab0` | 8.44:1 | amber tint | text `fg`, medium; icon amber |
| `info` | `waiting` | Someone else acts next (supplier, customer, courier) | `Clock` | `--tone-info-fg` `#124a7c` | `--tone-info-bg` `#e1eaf6` | 7.53:1 | blue tint | text `fg-muted`; icon blue |
| `success` | `done` | Finished | `CircleCheck` | `--tone-success-fg` `#0a4e44` | `--tone-success-bg` `#d9f0e8` | 8.04:1 | teal tint | text `fg-muted`; icon teal |
| `danger` | `late` | Past its date and still open | `CircleAlert` | `--tone-danger-fg` `#8a1010` | `--tone-danger-bg` `#fbe1dd` | 7.82:1 | red tint | text and icon red, medium |
| `neutral` | `inert` | Closed, not asked, not needed | `Circle` | `--tone-neutral-fg` `#28354d` | `--tone-neutral-bg` `#e3eaf4` | 10.16:1 | grey tint | text `fg-muted` |

`ink` is not a status tone. The `--tone-ink-*` tokens (white on navy) stay for emphasis without hue (the month lock bar, avatars, toasts). The step names map to tones through `TONE_OF_STEP` and the shared `StepTone` type in `src/lib/status.ts`.

Icon overrides are allowed only for: `CircleDashed` (dashed edge, not firm: Is GST included?), `Ban` (Cancelled, Deactivated, Can't quote), `Lock` (a closed month) and `CalendarClock` (Due soon).

### Rules

1. **Four ways to show a state.**

   | Form | Component | Use it for |
   |---|---|---|
   | **Chip** (tinted box, icon and word) | `StatusBadge` | **Only** (a) the chip row under a page title, at most 2 chips; (b) the one state column of a table whose job is that state (GST register TCS and FBR, closed RFQs' outcome, Team's Deactivated); (c) at most one per row inside a detail panel (a supplier order's goods state, a supplier's reply state, an item's price state) |
   | **Status text** (icon and word, no box, optional second line) | `StatusText` | Every **Next step** column, status-strip cells, history rows and money reports |
   | **Tag** (round blue plate, no tone) | `Tag` | Identity and category, never state: company role (Customer, Supplier, Customer & supplier, Prospect dashed), paid via (Bank, Cash), PO price source |
   | **Plain words** | none | History facts ("Ordered elsewhere", "Delivered 3 days late"), quotation versions ("Replaced by revision 2"), report rows |

2. **No chip for the normal state.** These keys carry `hidden: true` and `StatusBadge` renders nothing for them; their label is used only as text: RFQ open; order active; user active; month open; costs complete; trust ok; fx fresh; rate captured; goods and commissioning n/a (tables show "—"; "Not needed" stays only in the filter selects). Also hidden: questions-panel states (they are headings), `bid:to-bid`, inquiry blocked, reminder, company role, aging, bank, paid via, payable, expense group, excluded zero value and unattributed.
3. **Lists show one Next step, never state chips** (RFQ list, Orders, Who owes us, company history rows).
4. **One label means one thing and has one tone, everywhere.** A label may carry a mono detail ("2 of 3", "×2", "12 days"). It may be replaced only by a date phrase from the time-words helper (rule 8), never by new words.
5. **The tone is who acts next** (table above).
6. **At most one danger mark per row and per header.** Amber or blue text on a selected row turns to `fg-2`.
7. **Colour is never alone.** Every state shows an icon and a word. Tints are only for chips. A dashed border means "not firm".
8. **Time words come from `src/lib/timeWords.ts`:** "3 days overdue", "Due today", "Due tomorrow", "Due in 4 days", "In 4 days", "3 days ago", "5 days old", "New". No "d" abbreviations. "Late" alone is a history word: "Delivered 3 days late".

### The 34 status labels

| # | Label | Tone | Meaning | Keys |
|---|---|---|---|---|
| 1 | Needs suppliers | now | Nobody asked, or every supplier asked said no | `rfq-stage:suppliers`, `sourcing:not-floated`, `sourcing:no-offer` |
| 2 | Waiting for prices | waiting | Asked; not every item priced | `rfq-stage:prices`, `sourcing:awaiting`, `sourcing:partly-covered` ("2 of 3 priced"), `inquiry:sent`, `inquiry:awaiting`, `inquiry:chased` ("chased ×2"), `item-price:waiting` |
| 3 | Ready to quote | now | Every item has a price | `rfq-stage:ready`, `sourcing:covered` |
| 4 | Quotation sent | waiting | Our quotation is with the customer | `rfq-stage:sent`, `bid:bid-sent` |
| 5 | Quotation expired | now | Validity passed without an answer | `rfq-stage:expired`, `bid:expired` |
| 6 | Won | done | | `rfq-outcome:won` |
| 7 | Closed | inert | RFQ closed for a reason; month closed (`Lock`) | `rfq-outcome:closed`, `month:closed` |
| 8 | Not asked yet | inert | On the list, no message sent | `inquiry:shortlisted` |
| 9 | Priced | done | A supplier or an item has a price ("2 of 3", "3 prices") | `inquiry:quoted`, `item-price:priced` |
| 10 | No price yet | now | Everyone who replied left this item out | `item-price:none` |
| 11 | Can't quote | inert (`Ban`) | The supplier said no | `inquiry:no-offer` |
| 12 | Due soon | now (`CalendarClock`) | Always drawn as a time phrase ("Due today", "Due in 2 days") | `deadline:due-soon` |
| 13 | Overdue | late | Past its date, still open ("12 days") | `deadline:overdue`, `payment:overdue`, `goods:late` |
| 14 | Done | done | | `order:done`, `commissioning:done` |
| 15 | Cancelled | inert (`Ban`) | | `order:cancelled` |
| 16 | To order | now | A supplier must be chosen or the PO placed | `goods:to-source`, `goods:to-place` |
| 17 | On order | waiting | With the supplier | `goods:on-order` |
| 18 | To deliver | now | With us; take it to the customer ("2 of 3 delivered") | `goods:received`, `goods:partly-delivered` |
| 19 | Delivered | done | | `goods:delivered`, `tcs:delivered` |
| 20 | To plan | now | Commissioning needs a date | `commissioning:to-plan` |
| 21 | Planned | waiting | Detail: the date | `commissioning:planned` |
| 22 | To invoice | now | Nothing or only part invoiced ("rest PKR …") | `invoicing:not-invoiced`, `invoicing:part` |
| 23 | Invoiced | done | | `invoicing:full` |
| 24 | Awaiting payment | waiting | Balance open, not yet due ("part paid") | `payment:unpaid`, `payment:part` |
| 25 | Paid | done | | `payment:settled` |
| 26 | Not final | now | Costs still estimates | `costs:provisional` |
| 27 | Is GST included? | now, dashed (`CircleDashed`) | Price basis unknown | `trust:basis-unknown`, `excluded:basis-unknown` |
| 28 | Not sent | now | Invoice not sent by courier yet ("copy in") | `tcs:not-started`, `tcs:copy-received` |
| 29 | Sent | waiting | With the courier | `tcs:sent` |
| 30 | To deposit | now | Tax not deposited ("PSID made", "receipt in") | `fbr:pending`, `fbr:generated`, `fbr:receipt` |
| 31 | Deposited | done | | `fbr:deposited` |
| 32 | Old rate | now | Exchange rate older than the limit ("9 days") | `fx:stale` |
| 33 | No rate | now | No usable rate | `fx:unusable`, `fx-capture:none` |
| 34 | Deactivated | inert (`Ban`) | | `user:deactivated` |

`rfq-stage` and `item-price` are UI-only dimensions (not database values). Words that are not chips keep their registry label for text use (`resolveStatus(...).label`): the questions-panel headings ("To ask", "Waiting on the customer", "Answered", "Answers to send") and the Tag words (Customer, Supplier, Customer & supplier, Prospect, Bank, Cash).

Chip usage: `<StatusBadge dimension="goods" value="late" />`. A pill (`rounded-round`); height `--chip-h` (28; 20 with Smaller text) as a minimum, so the label never clips; padding 0 10 (8 on the glyph side); `--text-xs` (16) weight-600 label; the glyph is `--icon-chip`; 1px hairline tinted from the text colour. Status text: `<StatusText tone="now" detail="12 days">Send a reminder</StatusText>` or `<StatusText dimension="goods" value="on_order" detail="Due 3 Nov" />`, at body size (`--text-sm` minimum). Do not invent per-screen colours or words for a status; add it to the registry and the map in `tokens.css`.

## 7. Contrast (WCAG 2.2 AA)

Computed from the token values in `tokens.css` (direction C, 2026-10-22); `src/lib/a11yContrast.test.tsx` checks every pair below and fails CI if a token change breaks one. Text pairs need 4.5:1 and non-text pairs 3:1; secondary and tone text is held to 7:1 because the app is read outdoors.

**Text on surfaces**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| fg on surface (tile) | `#0c1526` | `#ffffff` | 18.25:1 | 4.5:1 | pass |
| fg on canvas (the field) | `#0c1526` | `#eef2f7` | 16.23:1 | 4.5:1 | pass |
| fg on selected | `#0c1526` | `#e3eaf4` | 15.07:1 | 4.5:1 | pass |
| fg-2 on surface | `#28354d` | `#ffffff` | 12.30:1 | 4.5:1 | pass |
| fg-2 on canvas / sunken | `#28354d` | `#eef2f7` | 10.95:1 | 4.5:1 | pass |
| fg-2 on selected | `#28354d` | `#e3eaf4` | 10.16:1 | 4.5:1 | pass |
| fg-muted on surface | `#364259` | `#ffffff` | 10.09:1 | 4.5:1 | pass |
| fg-muted on canvas / sunken | `#364259` | `#eef2f7` | 8.98:1 | 4.5:1 | pass |
| fg-muted on selected | `#364259` | `#e3eaf4` | 8.34:1 | 4.5:1 | pass |
| primary-text (green text) on surface | `#1a7645` | `#ffffff` | 5.64:1 | 4.5:1 | pass |
| primary-text on canvas / sunken | `#1a7645` | `#eef2f7` | 5.02:1 | 4.5:1 | pass |
| primary-text on selected | `#1a7645` | `#e3eaf4` | 4.66:1 | 4.5:1 | pass |
| primary-text on the lowest tint (late block) | `#1a7645` | `#fbe1dd` | 4.55:1 | 4.5:1 | pass |
| primary-text against fg (axe link-in-text-block) | `#1a7645` | `#0c1526` | 3.23:1 | 3:1 | pass |
| on-primary on primary (button) | `#ffffff` | `#1a7b46` | 5.30:1 | 4.5:1 | pass |
| on-primary on primary-hover | `#ffffff` | `#166a3b` | 6.65:1 | 4.5:1 | pass |
| on-primary on primary-active | `#ffffff` | `#115a31` | 8.30:1 | 4.5:1 | pass |

**Navy chrome and the next-step band**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| fg-on-chrome (white) on the navy | `#ffffff` | `#132a4c` | 14.35:1 | 7:1 | pass |
| fg-on-chrome-2 (quiet) on the navy | `#cdd7e6` | `#132a4c` | 9.88:1 | 7:1 | pass |
| fg-on-chrome-2 on a field on the navy | `#cdd7e6` | `#1d3760` | 8.18:1 | 7:1 | pass |
| fg-on-chrome on a hovered field | `#ffffff` | `#26457a` | 9.48:1 | 7:1 | pass |
| late sentence (tone-danger-bg ink) on the navy band | `#fbe1dd` | `#132a4c` | 11.56:1 | 7:1 | pass |
| avatar on the navy: navy initials on white | `#132a4c` | `#ffffff` | 14.35:1 | 7:1 | pass |
| selected segment / pressed toggle: white on navy | `#ffffff` | `#132a4c` | 14.35:1 | 7:1 | pass |

**Colour blocks (To do groups)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Late heading: block-late-fg on block-late-bg | `#8a1010` | `#fbe1dd` | 7.82:1 | 7:1 | pass |
| Today heading: block-today-fg on block-today-bg | `#693400` | `#ffeab0` | 8.44:1 | 7:1 | pass |
| This week heading: block-week-fg on block-week-bg | `#132a4c` | `#e1eaf6` | 11.82:1 | 7:1 | pass |
| Quiet heading: block-quiet-fg on block-quiet-bg | `#28354d` | `#eef2f7` | 10.95:1 | 7:1 | pass |
| fg-2 on the late block | `#28354d` | `#fbe1dd` | 9.91:1 | 7:1 | pass |
| fg-2 on the today block | `#28354d` | `#ffeab0` | 10.34:1 | 7:1 | pass |
| fg-2 on the this-week block | `#28354d` | `#e1eaf6` | 10.14:1 | 7:1 | pass |
| identifier plate (Tag): block-week-fg on tone-info-bg | `#132a4c` | `#e1eaf6` | 11.82:1 | 7:1 | pass |

**Status chips (text on own tint)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| tone-neutral-fg on tone-neutral-bg | `#28354d` | `#e3eaf4` | 10.16:1 | 4.5:1 | pass |
| tone-info-fg on tone-info-bg | `#124a7c` | `#e1eaf6` | 7.53:1 | 4.5:1 | pass |
| tone-success-fg on tone-success-bg | `#0a4e44` | `#d9f0e8` | 8.04:1 | 4.5:1 | pass |
| tone-warning-fg on tone-warning-bg | `#693400` | `#ffeab0` | 8.44:1 | 4.5:1 | pass |
| tone-danger-fg on tone-danger-bg | `#8a1010` | `#fbe1dd` | 7.82:1 | 4.5:1 | pass |
| tone-ink-fg on tone-ink-bg | `#ffffff` | `#132a4c` | 14.35:1 | 4.5:1 | pass |

**Tone text on page surfaces (inline text, no chip)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| tone-info-fg on surface | `#124a7c` | `#ffffff` | 9.15:1 | 7:1 | pass |
| tone-info-fg on selected | `#124a7c` | `#e3eaf4` | 7.55:1 | 7:1 | pass |
| tone-success-fg on surface | `#0a4e44` | `#ffffff` | 9.61:1 | 7:1 | pass |
| tone-success-fg on selected | `#0a4e44` | `#e3eaf4` | 7.93:1 | 7:1 | pass |
| tone-warning-fg on surface | `#693400` | `#ffffff` | 10.04:1 | 7:1 | pass |
| tone-warning-fg on selected | `#693400` | `#e3eaf4` | 8.29:1 | 7:1 | pass |
| tone-danger-fg on surface | `#8a1010` | `#ffffff` | 9.71:1 | 7:1 | pass |
| tone-danger-fg on selected | `#8a1010` | `#e3eaf4` | 8.02:1 | 7:1 | pass |

**Non-text (3:1)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| brand-green (focus ring, indicator, progress) on surface | `#429446` | `#ffffff` | 3.78:1 | 3:1 | pass |
| brand-green on canvas / sunken | `#429446` | `#eef2f7` | 3.36:1 | 3:1 | pass |
| brand-green on selected | `#429446` | `#e3eaf4` | 3.12:1 | 3:1 | pass |
| indicator-on-chrome (active tab bar, focus ring) on the navy | `#4caf52` | `#132a4c` | 5.17:1 | 3:1 | pass |
| indicator-on-chrome on a navy field | `#4caf52` | `#1d3760` | 4.28:1 | 3:1 | pass |
| chrome-input (an edge on the navy) | `#7f93b5` | `#132a4c` | 4.61:1 | 3:1 | pass |
| white ring of the green button on the navy (shadow-on-navy) | `#ffffff` | `#132a4c` | 14.35:1 | 3:1 | pass |
| green button on the navy without the ring (why the ring exists) | `#1a7b46` | `#132a4c` | 2.71:1 | 3:1 | fails alone: the white ring carries the edge |
| border-input on surface | `#68758c` | `#ffffff` | 4.65:1 | 3:1 | pass |
| border-input on canvas / sunken | `#68758c` | `#eef2f7` | 4.14:1 | 3:1 | pass |
| border-strong (secondary button) on surface | `#8592a6` | `#ffffff` | 3.15:1 | 3:1 | pass |
| table header rule (2 px fg) on surface | `#0c1526` | `#ffffff` | 18.25:1 | 3:1 | pass |
| open To do tile ring (2 px fg) on the tile | `#0c1526` | `#ffffff` | 18.25:1 | 3:1 | pass |

Notes: brand green fails 4.5:1 as text on white (3.78:1) and is non-text only; on the navy the indicator and focus ring use `--indicator-on-chrome`. Green text reads `--primary-text` (`#1a7645`): 4.5:1 or better on every surface and tint (5:1 on white and the field) and 3:1 against `--fg`, so a link inside a sentence is told apart without an underline. No green can reach 5:1 on the late tint and still 3:1 against the ink, so the tints are held to WCAG 4.5:1 (v1 kept 5:1). The button fill `--primary` carries white text only. Inside `data-surface="navy"` every re-inked text reads 4.5:1 or better on the navy, its field and its hover (checked by the same test). `--fg-disabled` is exempt under WCAG 1.4.3 (inactive components).

## 8. Focus

`:focus-visible { outline: var(--focus-width) solid var(--brand-green); outline-offset: var(--focus-offset); }`: 2px brand green, offset 2px, on every interactive element, including on the primary button (the offset keeps it off the green fill). Never remove an outline without replacing it. The ring is 3:1 or better against every surface and tint; inside `data-surface="navy"` it is `--indicator-on-chrome` (5.17:1 on the navy). Mouse clicks do not show it.

## 9. Motion

Quiet, fast, and always in answer to something the person did. Only `transform` and `opacity` animate; colour changes on hover use a short transition and are the single exception that does not move anything.

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120 ms | Hover, press, focus, tab switch |
| `--dur-base` | 200 ms | Menu open and close, row state change |
| `--dur-slow` | 320 ms | Panel reveal, rail grow. At most one per view, on load or on selection |
| `--ease-out` | cubic-bezier(0.2, 0.7, 0.2, 1) | Entering, expanding |
| `--ease-standard` | cubic-bezier(0.4, 0, 0.2, 1) | Leaving, looping (skeleton pulse) |

Patterns: menus fade and rise 4px; a selected detail pane fades in and rises 6px; a date rail draws from the left once; a skeleton pulses opacity between 1 and 0.45 over 1.4 s; a button presses 0.5px. No bounce, no spring, no scroll-triggered entrances, no staggered list reveals. Under `prefers-reduced-motion: reduce` every duration token collapses to 0.01 ms and looping animations are removed.

## 10. Icons

**Lucide** (`lucide-react`, ISC licence), one stroke width: **1.75**, round caps and joins, `currentColor`, no fills. Sizes: 16 inside status chips (12 with Smaller text; stroke 2), 12 inside keys and compact marks, 14 for inline facts, **16 default** (buttons, nav, inputs), 20 for list-row icons and the mobile tab bar, 24 for empty and error illustrations. Icons are muted (`--fg-muted`) until they carry an action or a tone. Never an icon-only control without an `aria-label`.

Set in use in the mockups: calendar-check, file-text, package, building-2, wallet (Money), chart-column, search, message-circle-question, send, reply, inbox, truck, alarm-clock-off, clock, circle-alert, triangle-alert, circle-check, check, x, chevron-right, chevron-down, chevron-left, refresh-cw, cloud-off and others (see the spec sheet).

## 11. Density

One default, one alternative, at either text size. Compact is never a default.

| Token | Normal text | Smaller text | Coarse pointer (phones, tablets) |
|---|---|---|---|
| `--control-h` (inputs, buttons, menu rows) | 44 | 32 | 44 at either text size |
| `--control-sm-h` (small buttons, row actions) | 40 | 28 | 44 at either text size |
| `--control-lg-h` (large buttons) | 52 | 40 | 52 at either text size |
| `--segment-h` (one SegmentedControl segment, filter chips) | 40 | 26 | 44 at either text size |
| `--chip-h` (status chip, tag, key; a minimum) | 28 | 20 | |
| `--row-h` (table and list rows) | 56 | 40 | 56 at either text size |
| `--row-h-tall` (two-line rows, the To do tiles) | 64 | 48 | |
| `--head-h` (table header; column bands are 8 less) | 44 | 36 | |
| `--topbar-h` | 64 | 56 | |
| Table text | 16 / 24 | 13 / 20 | |
| Compact table (`data-density="compact"`) | rows 44, text 16 / 22, cells 8 | rows 32, text 12 / 16 | |

Compact is a per-table toggle remembered per user, and since round 2 (consistency spec 3.2) it is off by default: DataTable draws the Comfortable / Compact switch only when a table passes `densitySwitch`, because "Smaller text" in the account menu is the one density control. It never applies to forms or the Today list. DataTable reads `--row-h`, `--row-h-tall` and `--head-h` from its own computed style for windowing and raises them to what the rows in view need (a row with a 36 px small button needs 49), so virtual rows always match what is drawn. Tap targets on phones are at least 44 (`--hit-touch`), and Smaller text never shrinks a tap target: the coarse-pointer heights are the same at both sizes (`src/lib/tokens.test.ts`).

## 12. Layout

Desktop navigation is a 64 px **navy** top bar (`--topbar-h`; 56 with Smaller text; `data-surface="navy"`), the wordmark on its own white plate (BRAND 6). Phones get the same navy bar on top; the bottom tab bar stays white. The 224px left rail (`--nav-w`) was explored for Today and not built. Exactly five destinations in this order: Today, RFQs, Orders, Companies, Money (owner decision 2026-10-19; engineers get the first four). Reports lives inside Money (`/reports` redirects there). A `⌘K` search field sits with the navigation. Phones use a bottom tab bar with the same five.

Navigation is at most two levels: the main destinations, then one strip of tabs inside a destination (Money: Who owes us, Invoices & GST, Expenses, Month end). Never a third strip: a page reached from inside a tab (Match bank statement, Margins, Things to check, a report) has a back link (on a phone, the phone bar's back arrow) and a title instead. On a phone no tab strip scrolls sideways: it wraps into a grid, or the list itself is the page (Settings). A count beside a destination or a tab means "needs you" (to do) and nothing else, and agrees with the person's Today list; a tab with nothing to do shows no number. It is drawn by one component, `NeedsCount` (`src/ui/Tag.tsx`: warning tint, mono, ", N need you" for screen readers; `SegmentedControl` and `Tab` take it as `needs`); every other count is written in words (a lede, a footer, "Waiting · 5"). Page content is capped at 860px for single-column work lists and 1280px for tables. The active destination is marked by a 4px rounded green indicator (on the navy, `--indicator-on-chrome`) and white or ink text, never a green fill. A selected segment or a pressed toggle is filled navy with white text.

### Page templates (round 2)

Every page uses one of three templates, built from shared parts in `src/ui` (API in `design/INVENTORY.md`). Gutters are `px-4` on phones and `md:px-8` everywhere; sections are 24 apart (`gap-6`), header parts 16 (`gap-4`). Page titles are `text-2xl font-heavy tracking-tight` in the display face; ledes `text-sm text-fg-muted`, one sentence; meta lines `text-sm text-fg-2` with "·" between at most 5 items.

- **List page** (`pt-6 pb-12`, `max-w-table` 1280): `PageHeader` (an h1 that is `sr-only` on phones because the phone bar already names the page, a lede, at most one green primary and one secondary; nothing else), then at most one strip of tabs or one switch row, then the `DataTable` with its toolbar (search, at most one switch, Filters). Today keeps its own layout.
- **Detail page** (`pt-6 pb-16`, phone `pt-4`, `max-w-detail` 1440): `DetailHeader`. A breadcrumb (md and up, muted), then the h1 (the name, a link to the company on RFQ and Order) with the code beside it in `num text-lg font-medium text-fg-muted` (hidden below md), and on the right **only** the `MoreMenu` ("More" ▾). Under it a chip row of at most 2 `StatusBadge`s (never inside the h1) and the meta line. The page's one green action is **not** in the header: it sits in the shared `NextStepBox` directly under the title, the **navy band** (`rounded-panel`, white sentence at 18 px, the late sentence in the danger tint's ink, the green button with its white ring; a quiet field-coloured block when there is nothing to do), with the next-step sentence (coordinator decision on round-2 spec 5.3; the same on RFQ, Order, and Company where it has an action). At most one facts strip follows.
- **Phone** (below 768): one bar, `useMobileBar({ title, back: 'history', fallback, actions: <MoreMenu touch />, hideTabs })`, with at most 2 actions; its title is the code for RFQs and orders and the name for a company, while the content h1 shows the name. List pages keep the bottom tabs and a toolbar of at most 2 rows. Detail pages put the same green action as the NextStepBox in a `StickyActionBar` (fixed, safe-area pad, primary + at most one secondary + More); the page sets `hideTabs: true` and adds `max-md:pb-[calc(var(--control-lg-h)+2rem)]`. Nothing scrolls sideways.

## 13. Writing in the interface

Sentence case, plain verbs, the same name for an action in the button and in the confirmation ("Send reminder", then "Reminder sent"). Empty states say what is true and what happens next. Errors say what happened, what is safe, and what to do; they do not apologise. Dates are anchored to real days ("bid due in 4 days, Tue 1 Dec"), never to invented follow-up cadences.

## 14. Token hygiene

Every token in `tokens.css` is used by the spec sheet or a mockup. A token is added only with a component that reads it. Primitives (`--neutral-*`) are referenced only by semantic tokens. If two tokens would hold the same value for the same purpose, keep one. The check script in the build notes (grep each `--name` outside its definition) must return no orphans.

## 15. Freeze and Gate 2 decisions

Gate 2 was approved by the owner on 2026-10-14 ("i think I like the mockup for now its good to go"), so this file, `design/tokens.css` and the mockups are frozen. The reference for every screen is the committed HTML in `design/mockups/`, rendered as PNGs in `design/screens/`; `design/ARTIFACTS.md` lists the approved artifact versions and `design/INVENTORY.md` maps every screen element to a primitive. U-tasks build to these; a deviation is listed in the PR and approved by the orchestrator. Re-render the PNGs with `design/tools/render-screens.mjs` after any approved change.

Direction C (2026-10-22) changes the look, not the structure: the mockups in `design/mockups/` still define layout, content and flow, but their colours, type and corners are v1's. Where they disagree on looks, this file and `tokens.css` win.

Governing goal (owner, 2026-10-14): reduce work and logging while keeping the detail that helps sales and engineers and proper bookkeeping. Detail is a by-product of actions people take anyway, and money records are pre-filled, never skipped. Every interaction-count annotation in the mockups serves this goal.

Gate 2 decisions that shape the interface (all recorded in `DECISIONS.md`, 2026-10-14):

1. **Chase and payment-reminder wording** ships as mocked: polite at first, firmer after 30 days overdue (section 13 applies to both).
2. **"Can't quote"** records one reason per supplier inquiry, with an optional per-item override. The RFQ detail reply row shows the inquiry-level reason and only offers the override when the person opens it.
3. **Capture** pre-selects the most likely destination, and one tap confirms it. The chooser is a correction path, not a required step.
4. **Quotation PDFs** print the bank details only if they are filled in `company_profile`. The field is optional; when blank, no heading, no empty block and no placeholder is printed.

## 16. Keyboard

One list of shortcuts, `src/app/shell/shortcuts.ts`, drawn by the Keyboard shortcuts sheet (`?` outside a text box or dialog, the account menu, or "Keyboard shortcuts" in the search palette; desktop only, phones never see an entry). A new key handler is added to that list in the same change: a source test fails otherwise. Single keys (N, C, G then T, /, ?) never act inside a text field or with a dialog open, and Settings, Your details can turn them off (WCAG 2.1.4); Ctrl/⌘ K and Z always work. ⌘ is shown on a Mac, Ctrl elsewhere (`modKeyLabel`). Hints stay quiet: a key in a button's tooltip ("New RFQ · N"), `aria-keyshortcuts` on the control, the palette and table footers; no always-on legends, and no `Kbd` on phones.
