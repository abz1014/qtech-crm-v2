# Q-Tech CRM v2 design system

Status: v1, **frozen 14 Oct 2026** (Gate 2 approved, D09). Changes now need an entry in [`DECISIONS.md`](DECISIONS.md) and the orchestrator's approval; see section 15. Source of truth for every value is [`design/tokens.css`](design/tokens.css). This file explains the rules. The live specimen is [`design/mockups/spec-sheet.html`](design/mockups/spec-sheet.html). Brand inputs come from [`BRAND.md`](BRAND.md) and are unchanged: deep green `#1a7b46` for actions and green text, brand green `#429446` for non-text only, teal success, 4px radius, light theme, mono tabular numbers.

Direction in one line: an instrument panel that has been tidied by someone who cares. Flat white and cool-grey surfaces, one-pixel hairlines doing the separating, a single quiet green for "this is where you act or where you are", and numbers set in a monospace so columns of rupees line up like a ledger.

## 1. Webfont

**Geist** (sans) and **Geist Mono**, both SIL OFL, self-hosted through `@fontsource/geist-sans` and `@fontsource/geist-mono` (weights 400, 500, 600 and 400, 500; latin subset; woff2; about 60 KB total). `font-display: swap` with the system stack as fallback.

Why: it is the one family that gives the sans and the monospace the same skeleton, so a PKR amount set in mono sits next to a label in sans without a visible seam. Its figures are tabular in the mono and its sans has a calm, slightly technical voice that suits instrumentation without looking like a default shadcn/Inter build. It is built for dense product UI; since 2026-10-19 the app sets it at 14 to 16 px by default (section 2). BRAND.md said "no webfont"; this is the permitted refinement, and the fallback stack keeps the app usable if the font fails.

Gaps: Geist has no glyph for the rupee sign (U+20A8). Render the symbol through the fallback in a `<span class="cur">` at the same size, or use the text prefix `PKR` in dense tables. Latin only; Urdu text, if ever needed, needs a separate Nastaliq face (out of scope for v1).

## 2. Type scale

Owner decision 2026-10-19 (DECISIONS.md): the text was "very small", so **Normal** is now the bigger scale below, for everyone. A person can pick **Smaller** (Settings > Your details, or the account menu); that puts `data-text="small"` on `<html>` and restores the frozen Gate 2 scale. The choice is kept per device (`localStorage`, `qtech.text-size`) and applied before the first paint (`src/ui/useTextSize.ts`). This is a deliberate, owner-requested deviation from the approved mockups: readability outranks pixel parity for size and density.

| Token | Normal (default) | Smaller (`data-text="small"`) | Use |
|---|---|---|---|
| `--text-xs` | 14 / 20 | 12 / 16 | Captions, chip labels, kbd, meta lines, small buttons, compact tables |
| `--text-sm` | 15 / 22 | 13 / 20 | **Default for UI**: tables, lists, buttons, labels, secondary copy |
| `--text-base` | 16 / 24 | 14 / 22 | Body copy, row titles |
| `--text-lg` | 18 / 26 | 16 / 24 | Panel and card titles |
| `--text-xl` | 22 / 30 | 20 / 28 | Section headers, big inline figures |
| `--text-2xl` | 30 / 36 | 28 / 34 | Page titles |
| `--text-display` | 38 / 44 | 36 / 40 | One headline number per screen (target tile). Mono, weight 500 |
| `--text-table` | 15 / 22 (= sm) | 13 / 20 | DataTable body; compact switches it to xs |

On a phone every input is 16px whatever the scale, so iOS Safari never zooms the page (`controlClass` in `src/ui/form/fieldContext.ts`). Nothing around text has a fixed pixel height or line-height: chips, keys, segments, small buttons, table heads and rows read the tokens in section 11, so they grow with the text instead of clipping it.

Weights: 400 body, 500 for emphasis, titles, buttons and nav, 600 for page and panel headings only. Never 700. Tracking: `-0.02em` at 28 px and up, `-0.01em` from 16 to 20 px, none below.

Rules:

- Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows.
- Line length for running text: 66 characters maximum (`max-width: 66ch`). Tables and lists are exempt.
- Titles use `text-wrap: balance`, paragraphs `text-wrap: pretty`.
- Muted text is `--fg-muted` (8.37:1 on white, 7.62 on sunken, 7.23 on selected, and 7.13 on the lightest chip tint, the danger tint: 7.1:1 or better wherever it can sit), never a lighter grey, and only for captions, hints and placeholders. Body copy and data in primitives use `--fg` or `--fg-2`.

### Mono and tabular figures

Set with `font-variant-numeric: tabular-nums` (class `.num`), in the sans (`--font-sans`) since 2026-10-20: Geist Mono's only zero is slashed and the owner read it as a struck-out digit; Geist's tabular figures have a plain zero and still line up in columns. Never turn on `slashed-zero` or the `zero` feature. `--font-mono` stays for pasted raw text only:

- PKR amounts, quantities, percentages, margins.
- RFQ, PO, invoice, challan, quotation numbers and customer refs (`RFQ-0177`, `PO 000001`, `RFQ #74037`).
- Part numbers and model codes.
- Dates and times in tables, lists and rails (`Tue 1 Dec`, `17:00`).
- Phone numbers, NTN, STRN.

Right-align numeric columns. Amounts carry thousands separators. A number inside a sentence is set `.num` at the sentence's size and weight 500 (`<b class="num">4</b> days`). Plain counts in sans UI (a nav badge) use `.tab` (sans with tabular-nums) or mono, whichever sits next to other mono data.

## 3. Spacing

A strict 4px rhythm: `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 20, `--sp-6` 24, `--sp-8` 32, `--sp-10` 40, `--sp-12` 48, `--sp-16` 64. Use `gap` for sibling spacing, never margins.

Defaults: 16 inside a list row or card, 20 inside a panel with a header, 24 between page sections, 32 to 40 page gutters on desktop, 16 on phones. Tight groups (icon to label) 6 to 8, icon-to-icon 4.

Radius: `--radius` 4px on every box (buttons, inputs, chips, cards, popovers). `--radius-round` only for dots, avatars and the ends of a progress bar. No other radii.

## 4. Elevation

Hairlines first. A panel is a white surface with a 1px `--border` on the canvas, nothing more. There are exactly two shadows and both belong to overlays:

| Token | Use |
|---|---|
| `--shadow-pop` | Menus, popovers, tooltips, command palette results |
| `--shadow-modal` | Dialogs and sheets, over `--bg-scrim` |

Both begin with a 1px ring so they still read on a white page. No shadow on cards, buttons, sticky bars or hover states. No gradients, glass, blur or glow, anywhere.

## 5. Colour

### Neutral ramp (primitives)

Cool grey, hue about 240 degrees, chroma under 3 percent. Components never reference primitives directly; they use the semantic tokens below.

| Token | Hex |
|---|---|
| `--neutral-0` | `#ffffff` |
| `--neutral-25` | `#fafafb` |
| `--neutral-50` | `#f4f4f6` |
| `--neutral-100` | `#eeeef1` |
| `--neutral-150` | `#e3e3e7` |
| `--neutral-200` | `#d2d2d8` |
| `--neutral-250` | `#c8c8cf` (added 2026-10-19: the readable hairline) |
| `--neutral-300` | `#b3b3bb` |
| `--neutral-400` | `#8a8a93` |
| `--neutral-500` | `#6e6e77` |
| `--neutral-600` | `#5a5a63` |
| `--neutral-650` | `#4d4d55` (added 2026-10-19: secondary text) |
| `--neutral-700` | `#3d3d44` |
| `--neutral-800` | `#26262b` |
| `--neutral-900` | `#111113` |

### Semantic roles

| Role | Token | Resolves to |
|---|---|---|
| App canvas | `--bg-canvas` | neutral-25 |
| Panel, list, input | `--bg-surface` | neutral-0 |
| Table header, hover | `--bg-sunken` | neutral-50 |
| Selected row, active nav, track | `--bg-selected` | neutral-100 |
| Modal scrim | `--bg-scrim` | 42% black |
| Text | `--fg` / `--fg-2` / `--fg-muted` | neutral-900 / 700 / 650 |
| Disabled | `--fg-disabled` | neutral-300 (WCAG-exempt) |
| Hairline | `--border` | neutral-250 (1.66:1 on white, 1.60 on canvas, 1.52 on sunken, 1.44 on selected; up from 1.28 on white) |
| Hover or popover edge, secondary button | `--border-strong` | neutral-300 (2.08:1) |
| Form control edge | `--border-input` | neutral-400 (3.42:1) |
| Primary action, links, green text | `--primary` `#1a7b46` | hover `#166a3b`, active `#115a31` |
| Non-text green | `--brand-green` `#429446` | focus ring, active indicator, selected control fill, progress, logo |

The green rule from BRAND.md stands: green means primary action, active or selected, or focus. Anything else that is green gets its green removed. Nothing in the UI uses brand green for text.

## 6. Status tones

Six tones. Every derived state in the app resolves to one of them through `data-status="group:value"`, which sets `--status-fg` and `--status-bg`. A chip is always **shape + colour + label**: a glyph chosen by tone (hollow circle neutral, dotted circle info, check success, clock warning, alert circle danger) plus the text. Colour is never the only signal. A dashed border means "not firm" (data trust, prospect).

| Tone | Text | Tint | Ratio | Meaning |
|---|---|---|---|---|
| `neutral` | `--tone-neutral-fg` `#3d3d44` | `--tone-neutral-bg` `#eeeef1` | 9.30:1 | Inert, informational or closed states |
| `info` | `--tone-info-fg` `#185f9e` | `--tone-info-bg` `#e3f0fb` | 5.72:1 | In progress, waiting on someone else |
| `success` | `--tone-success-fg` `#0b625b` | `--tone-success-bg` `#e0f2f1` | 6.23:1 | Done, all priced, settled, delivered |
| `warning` | `--tone-warning-fg` `#92400e` | `--tone-warning-bg` `#fef3c7` | 6.37:1 | Needs action soon, incomplete, uncertain |
| `danger` | `--tone-danger-fg` `#b21f1f` | `--tone-danger-bg` `#fde8e8` | 5.75:1 | Overdue, late, failed, nowhere to buy |
| `ink` | `--tone-ink-fg` `#ffffff` | `--tone-ink-bg` `#26262b` | 15.06:1 | Emphasis without hue (company role: both) |

Mapping rule: **warning** = someone here should act soon, or the data is incomplete; **info** = in progress or waiting on someone else; **success** = finished or fully covered; **danger** = late, overdue or nowhere to buy; **neutral** = inert or closed; **ink** is reserved for company role "both".

| Status | Values (tone) |
|---|---|
| RFQ outcome | Open (info) · Won (success) · Closed (neutral) |
| RFQ sourcing | Not sent to suppliers (warning) · Waiting for prices (info) · Partly priced (info) · All priced (success) · No price yet (danger) |
| Clarification | To ask (warning) · Waiting on customer (info) · Answers to send (warning) · Answered (success) · Withdrawn (neutral) |
| Quotation (`bid`) | To quote (warning) · Quotation sent (success) · Quotation expired (warning) |
| Deadline risk | Due soon (warning) · Overdue (danger) |
| Supplier inquiry | Shortlisted (neutral) · Sent (info) · Chased (warning) · Quoted (success) · Can't quote (danger) |
| Order lifecycle | Active (info) · Cancelled (neutral) · Done (success) |
| Goods | To source (warning) · To place (warning) · On order (info) · Late (danger) · Received (info) · Partly delivered (info) · Delivered (success) |
| Commissioning | Not needed (neutral) · To plan (warning) · Planned (info) · Done (success) |
| Invoicing | Not invoiced (warning) · Part invoiced (info) · Fully invoiced (success) |
| Payment | Unpaid (neutral) · Part paid (info) · Settled (success) · Overdue (danger) |
| Costs | Not final (warning) · Complete (success) |
| Data trust | Is GST included? (warning, dashed) · Estimated dates (neutral, dashed) |
| Invoice courier (TCS) | Not started (neutral) · Copy received (info) · Sent (info) · Delivered (success) |
| FBR | Pending (warning) · Generated (info) · Receipt received (info) · Deposited (success) |
| Company role | Customer (info) · Supplier (neutral) · Both (ink) · Prospect (neutral, dashed) |

Labels follow the plain-words glossary (DECISIONS 2026-10-19). Only the words changed; the `data-status` keys and the view values did not (`src/lib/status.ts`, guarded by `status.test.ts`).

Usage: `<span class="chip" data-status="goods:late">…</span>`. Chip height `--chip-h` (24; 20 with Smaller text) as a minimum, so the label never clips; padding 0 8 (6 on the glyph side); `--text-xs` weight-500 label; the glyph is `--icon-chip` (16; 12 with Smaller text), big enough that neutral (hollow circle), info (dotted circle) and success (check) chips differ by shape without colour; 1px hairline tinted from the text colour. Do not invent per-screen colours for a status; add it to the map in `tokens.css`.

## 7. Contrast (WCAG 2.2 AA)

Computed from the token values by the build script; every pair below passes. Text pairs need 4.5:1 and non-text pairs need 3:1.

**Text on surfaces**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| fg on surface | `#111113` | `#ffffff` | 18.86:1 | 4.5:1 | pass |
| fg on canvas | `#111113` | `#fafafb` | 18.08:1 | 4.5:1 | pass |
| fg on sunken / hover | `#111113` | `#f4f4f6` | 17.17:1 | 4.5:1 | pass |
| fg on selected | `#111113` | `#eeeef1` | 16.29:1 | 4.5:1 | pass |
| fg-2 on surface | `#3d3d44` | `#ffffff` | 10.77:1 | 4.5:1 | pass |
| fg-2 on canvas | `#3d3d44` | `#fafafb` | 10.33:1 | 4.5:1 | pass |
| fg-2 on sunken / hover | `#3d3d44` | `#f4f4f6` | 9.81:1 | 4.5:1 | pass |
| fg-2 on selected | `#3d3d44` | `#eeeef1` | 9.30:1 | 4.5:1 | pass |
| fg-muted on surface | `#4d4d55` | `#ffffff` | 8.37:1 | 4.5:1 | pass |
| fg-muted on canvas | `#4d4d55` | `#fafafb` | 8.03:1 | 4.5:1 | pass |
| fg-muted on sunken / hover | `#4d4d55` | `#f4f4f6` | 7.62:1 | 4.5:1 | pass |
| fg-muted on selected | `#4d4d55` | `#eeeef1` | 7.23:1 | 4.5:1 | pass |
| primary on surface | `#1a7b46` | `#ffffff` | 5.30:1 | 4.5:1 | pass |
| primary on canvas | `#1a7b46` | `#fafafb` | 5.08:1 | 4.5:1 | pass |
| primary on sunken / hover | `#1a7b46` | `#f4f4f6` | 4.82:1 | 4.5:1 | pass |
| primary on selected | `#1a7b46` | `#eeeef1` | 4.57:1 | 4.5:1 | pass |
| primary-hover on surface | `#166a3b` | `#ffffff` | 6.65:1 | 4.5:1 | pass |
| primary-hover on canvas | `#166a3b` | `#fafafb` | 6.37:1 | 4.5:1 | pass |
| primary-hover on sunken / hover | `#166a3b` | `#f4f4f6` | 6.05:1 | 4.5:1 | pass |
| primary-hover on selected | `#166a3b` | `#eeeef1` | 5.74:1 | 4.5:1 | pass |
| on-primary on primary (button) | `#ffffff` | `#1a7b46` | 5.30:1 | 4.5:1 | pass |
| on-primary on primary-hover | `#ffffff` | `#166a3b` | 6.65:1 | 4.5:1 | pass |
| on-primary on primary-active | `#ffffff` | `#115a31` | 8.30:1 | 4.5:1 | pass |

**Status chips (text on own tint)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| tone-neutral-fg on tone-neutral-bg | `#3d3d44` | `#eeeef1` | 9.30:1 | 4.5:1 | pass |
| tone-info-fg on tone-info-bg | `#185f9e` | `#e3f0fb` | 5.72:1 | 4.5:1 | pass |
| tone-success-fg on tone-success-bg | `#0b625b` | `#e0f2f1` | 6.23:1 | 4.5:1 | pass |
| tone-warning-fg on tone-warning-bg | `#92400e` | `#fef3c7` | 6.37:1 | 4.5:1 | pass |
| tone-danger-fg on tone-danger-bg | `#b21f1f` | `#fde8e8` | 5.75:1 | 4.5:1 | pass |
| tone-ink-fg on tone-ink-bg | `#ffffff` | `#26262b` | 15.06:1 | 4.5:1 | pass |

**Tone text on page surfaces (inline text, no chip)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| tone-info-fg on surface | `#185f9e` | `#ffffff` | 6.63:1 | 4.5:1 | pass |
| tone-info-fg on canvas | `#185f9e` | `#fafafb` | 6.35:1 | 4.5:1 | pass |
| tone-success-fg on surface | `#0b625b` | `#ffffff` | 7.21:1 | 4.5:1 | pass |
| tone-success-fg on canvas | `#0b625b` | `#fafafb` | 6.91:1 | 4.5:1 | pass |
| tone-warning-fg on surface | `#92400e` | `#ffffff` | 7.09:1 | 4.5:1 | pass |
| tone-warning-fg on canvas | `#92400e` | `#fafafb` | 6.80:1 | 4.5:1 | pass |
| tone-danger-fg on surface | `#b21f1f` | `#ffffff` | 6.76:1 | 4.5:1 | pass |
| tone-danger-fg on canvas | `#b21f1f` | `#fafafb` | 6.48:1 | 4.5:1 | pass |
| tone-info-fg on selected (a chip-coloured word in a selected row) | `#185f9e` | `#eeeef1` | 5.72:1 | 4.5:1 | pass |
| tone-success-fg on selected | `#0b625b` | `#eeeef1` | 6.23:1 | 4.5:1 | pass |
| tone-warning-fg on selected (failed at 4.34:1 before 2026-10-19) | `#92400e` | `#eeeef1` | 6.12:1 | 4.5:1 | pass |
| tone-danger-fg on selected | `#b21f1f` | `#eeeef1` | 5.83:1 | 4.5:1 | pass |

**Non-text (3:1)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| brand-green (focus ring, indicator, progress) on surface | `#429446` | `#ffffff` | 3.78:1 | 3:1 | pass |
| brand-green (focus ring, indicator, progress) on canvas | `#429446` | `#fafafb` | 3.62:1 | 3:1 | pass |
| brand-green (focus ring, indicator, progress) on sunken / hover | `#429446` | `#f4f4f6` | 3.44:1 | 3:1 | pass |
| brand-green (focus ring, indicator, progress) on selected | `#429446` | `#eeeef1` | 3.26:1 | 3:1 | pass |
| border-input on surface | `#8a8a93` | `#ffffff` | 3.42:1 | 3:1 | pass |
| border-input on sunken | `#8a8a93` | `#f4f4f6` | 3.11:1 | 3:1 | pass |
| border (hairline, divider) on surface / canvas / sunken / selected | `#c8c8cf` | `#ffffff` … `#eeeef1` | 1.66 / 1.60 / 1.52 / 1.44 | none (decorative) | pass |
| border-strong on surface | `#b3b3bb` | `#ffffff` | 2.08:1 | none (decorative) | pass |
| tone-warning-fg dot on surface | `#92400e` | `#ffffff` | 7.09:1 | 3:1 | pass |

Notes: brand green fails 4.5:1 as text on white (3.78:1) and is therefore non-text only. Primary text on `--bg-selected` is 4.57:1, so a selected row may carry a green link, but prefer `--fg`. `--fg-disabled` is exempt under WCAG 1.4.3 (inactive components).

## 8. Focus

`:focus-visible { outline: var(--focus-width) solid var(--brand-green); outline-offset: var(--focus-offset); }`: 2px brand green, offset 2px, on every interactive element, including on the primary button (the offset keeps it off the green fill). Never remove an outline without replacing it. The ring is 3.4:1 or better against every surface. Mouse clicks do not show it.

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
| `--control-h` (inputs, buttons, menu rows) | 40 | 32 | 44 at either text size |
| `--control-sm-h` (small buttons, row actions) | 36 | 28 | 40 at either text size |
| `--control-lg-h` (large buttons) | 44 | 40 | 44 at either text size |
| `--segment-h` (one SegmentedControl segment, filter chips) | 36 | 26 | 40 at either text size |
| `--chip-h` (status chip, tag, key; a minimum) | 24 | 20 | |
| `--row-h` (table and list rows) | 48 | 40 | 48 at either text size |
| `--row-h-tall` (two-line rows) | 56 | 48 | |
| `--head-h` (table header; column bands are 8 less) | 40 | 36 | |
| `--topbar-h` | 56 | 52 | |
| Table text | 15 / 22 | 13 / 20 | |
| Compact table (`data-density="compact"`) | rows 40, text 14 / 20, cells 8 | rows 32, text 12 / 16 | |

Compact is a per-table toggle remembered per user; it never applies to forms or the Today list. DataTable reads `--row-h`, `--row-h-tall` and `--head-h` from its own computed style for windowing and raises them to what the rows in view need (a row with a 36 px small button needs 49), so virtual rows always match what is drawn. Tap targets on phones are at least 44 (`--hit-touch`), and Smaller text never shrinks a tap target: the coarse-pointer heights are the same at both sizes (`src/lib/tokens.test.ts`).

## 12. Layout

Desktop navigation is either a 224px left rail (`--nav-w`) or a 52px top bar (`--topbar-h`); the Today directions explore both. Exactly five destinations in this order: Today, RFQs, Orders, Companies, Money (owner decision 2026-10-19; engineers get the first four). Reports lives inside Money (`/reports` redirects there). A `⌘K` search field sits with the navigation. Phones use a bottom tab bar with the same five.

Navigation is at most two levels: the main destinations, then one strip of tabs inside a destination (Money: Who owes us, Invoices & GST, Expenses, Month end). Never a third strip: a page reached from inside a tab (Match bank statement, Margins, Things to check, a report) has a back link (on a phone, the phone bar's back arrow) and a title instead. On a phone no tab strip scrolls sideways: it wraps into a grid, or the list itself is the page (Settings). A count beside a destination or a tab means "needs you" (to do) and nothing else, and agrees with the person's Today list; a tab with nothing to do shows no number. Page content is capped at 860px for single-column work lists and 1280px for tables. The active destination is marked by a 2 to 3px brand-green indicator plus `--bg-selected` or an underline, never a green fill.

## 13. Writing in the interface

Sentence case, plain verbs, the same name for an action in the button and in the confirmation ("Send reminder", then "Reminder sent"). Empty states say what is true and what happens next. Errors say what happened, what is safe, and what to do; they do not apologise. Dates are anchored to real days ("bid due in 4 days, Tue 1 Dec"), never to invented follow-up cadences.

## 14. Token hygiene

Every token in `tokens.css` is used by the spec sheet or a mockup. A token is added only with a component that reads it. Primitives (`--neutral-*`) are referenced only by semantic tokens. If two tokens would hold the same value for the same purpose, keep one. The check script in the build notes (grep each `--name` outside its definition) must return no orphans.

## 15. Freeze and Gate 2 decisions

Gate 2 was approved by the owner on 2026-10-14 ("i think I like the mockup for now its good to go"), so this file, `design/tokens.css` and the mockups are frozen. The reference for every screen is the committed HTML in `design/mockups/`, rendered as PNGs in `design/screens/`; `design/ARTIFACTS.md` lists the approved artifact versions and `design/INVENTORY.md` maps every screen element to a primitive. U-tasks build to these; a deviation is listed in the PR and approved by the orchestrator. Re-render the PNGs with `design/tools/render-screens.mjs` after any approved change.

Governing goal (owner, 2026-10-14): reduce work and logging while keeping the detail that helps sales and engineers and proper bookkeeping. Detail is a by-product of actions people take anyway, and money records are pre-filled, never skipped. Every interaction-count annotation in the mockups serves this goal.

Gate 2 decisions that shape the interface (all recorded in `DECISIONS.md`, 2026-10-14):

1. **Chase and payment-reminder wording** ships as mocked: polite at first, firmer after 30 days overdue (section 13 applies to both).
2. **"Can't quote"** records one reason per supplier inquiry, with an optional per-item override. The RFQ detail reply row shows the inquiry-level reason and only offers the override when the person opens it.
3. **Capture** pre-selects the most likely destination, and one tap confirms it. The chooser is a correction path, not a required step.
4. **Quotation PDFs** print the bank details only if they are filled in `company_profile`. The field is optional; when blank, no heading, no empty block and no placeholder is printed.
