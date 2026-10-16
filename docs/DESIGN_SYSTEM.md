# Q-Tech CRM v2 design system

Status: v1, **frozen 14 Oct 2026** (Gate 2 approved, D09). Changes now need an entry in [`DECISIONS.md`](DECISIONS.md) and the orchestrator's approval; see section 15. Source of truth for every value is [`design/tokens.css`](design/tokens.css). This file explains the rules. The live specimen is [`design/mockups/spec-sheet.html`](design/mockups/spec-sheet.html). Brand inputs come from [`BRAND.md`](BRAND.md) and are unchanged: deep green `#1a7b46` for actions and green text, brand green `#429446` for non-text only, teal success, 4px radius, light theme, mono tabular numbers.

Direction in one line: an instrument panel that has been tidied by someone who cares. Flat white and cool-grey surfaces, one-pixel hairlines doing the separating, a single quiet green for "this is where you act or where you are", and numbers set in a monospace so columns of rupees line up like a ledger.

## 1. Webfont

**Geist** (sans) and **Geist Mono**, both SIL OFL, self-hosted through `@fontsource/geist-sans` and `@fontsource/geist-mono` (weights 400, 500, 600 and 400, 500; latin subset; woff2; about 60 KB total). `font-display: swap` with the system stack as fallback.

Why: it is the one family that gives the sans and the monospace the same skeleton, so a PKR amount set in mono sits next to a label in sans without a visible seam. Its figures are tabular in the mono and its sans has a calm, slightly technical voice that suits instrumentation without looking like a default shadcn/Inter build. It is built for dense product UI at 12 to 14 px. BRAND.md said "no webfont"; this is the permitted refinement, and the fallback stack keeps the app usable if the font fails.

Gaps: Geist has no glyph for the rupee sign (U+20A8). Render the symbol through the fallback in a `<span class="cur">` at the same size, or use the text prefix `PKR` in dense tables. Latin only; Urdu text, if ever needed, needs a separate Nastaliq face (out of scope for v1).

## 2. Type scale

| Token | Size / line | Use |
|---|---|---|
| `--text-xs` | 12 / 16 | Captions, chip labels, kbd, meta lines, compact tables |
| `--text-sm` | 13 / 20 | **Default for dense UI**: tables, lists, buttons, secondary copy |
| `--text-base` | 14 / 22 | Body copy, form values, row titles |
| `--text-lg` | 16 / 24 | Panel and card titles |
| `--text-xl` | 20 / 28 | Section headers, big inline figures |
| `--text-2xl` | 28 / 34 | Page titles |
| `--text-display` | 36 / 40 | One headline number per screen (target tile). Mono, weight 500 |

Weights: 400 body, 500 for emphasis, titles, buttons and nav, 600 for page and panel headings only. Never 700. Tracking: `-0.02em` at 28 px and up, `-0.01em` from 16 to 20 px, none below.

Rules:

- Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows.
- Line length for running text: 66 characters maximum (`max-width: 66ch`). Tables and lists are exempt.
- Titles use `text-wrap: balance`, paragraphs `text-wrap: pretty`.
- Muted text is `--fg-muted` (5.7:1 or better on every surface), never a lighter grey.

### Mono and tabular figures

Set in `--font-mono` with `font-variant-numeric: tabular-nums` (class `.num`):

- PKR amounts, quantities, percentages, margins.
- RFQ, PO, invoice, challan, quotation numbers and customer refs (`RFQ-0177`, `PO 000001`, `RFQ #74037`).
- Part numbers and model codes.
- Dates and times in tables, lists and rails (`Tue 1 Dec`, `17:00`).
- Phone numbers, NTN, STRN.

Right-align numeric columns. Amounts carry thousands separators. A number inside a sentence is set mono at the sentence's size and weight 500 (`<b class="num">4</b> days`). Plain counts in sans UI (a nav badge) use `.tab` (sans with tabular-nums) or mono, whichever sits next to other mono data.

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
| `--neutral-300` | `#b3b3bb` |
| `--neutral-400` | `#8a8a93` |
| `--neutral-500` | `#6e6e77` |
| `--neutral-600` | `#5a5a63` |
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
| Text | `--fg` / `--fg-2` / `--fg-muted` | neutral-900 / 700 / 600 |
| Disabled | `--fg-disabled` | neutral-300 (WCAG-exempt) |
| Hairline | `--border` | neutral-150 |
| Hover or popover edge | `--border-strong` | neutral-200 |
| Form control edge | `--border-input` | neutral-400 (3.42:1) |
| Primary action, links, green text | `--primary` `#1a7b46` | hover `#166a3b`, active `#115a31` |
| Non-text green | `--brand-green` `#429446` | focus ring, active indicator, selected control fill, progress, logo |

The green rule from BRAND.md stands: green means primary action, active or selected, or focus. Anything else that is green gets its green removed. Nothing in the UI uses brand green for text.

## 6. Status tones

Six tones. Every derived state in the app resolves to one of them through `data-status="group:value"`, which sets `--status-fg` and `--status-bg`. A chip is always **shape + colour + label**: a glyph chosen by tone (hollow circle neutral, dotted circle info, check success, clock warning, alert circle danger) plus the text. Colour is never the only signal. A dashed border means "not firm" (data trust, prospect).

| Tone | Text | Tint | Ratio | Meaning |
|---|---|---|---|---|
| `neutral` | `--tone-neutral-fg` `#3d3d44` | `--tone-neutral-bg` `#eeeef1` | 9.30:1 | Inert, informational or closed states |
| `info` | `--tone-info-fg` `#1d6fb8` | `--tone-info-bg` `#e3f0fb` | 4.51:1 | In progress, waiting on someone else |
| `success` | `--tone-success-fg` `#0f766e` | `--tone-success-bg` `#e0f2f1` | 4.73:1 | Done, covered, settled, delivered |
| `warning` | `--tone-warning-fg` `#b45309` | `--tone-warning-bg` `#fef3c7` | 4.51:1 | Needs action soon, incomplete, uncertain |
| `danger` | `--tone-danger-fg` `#c62828` | `--tone-danger-bg` `#fde8e8` | 4.79:1 | Overdue, late, failed, nowhere to buy |
| `ink` | `--tone-ink-fg` `#ffffff` | `--tone-ink-bg` `#26262b` | 15.06:1 | Emphasis without hue (company role: both) |

Mapping rule: **warning** = someone here should act soon, or the data is incomplete; **info** = in progress or waiting on someone else; **success** = finished or fully covered; **danger** = late, overdue or nowhere to buy; **neutral** = inert or closed; **ink** is reserved for company role "both".

| Status | Values (tone) |
|---|---|
| RFQ outcome | Open (info) · Won (success) · Closed (neutral) |
| RFQ sourcing | Not floated (warning) · Awaiting offers (info) · Partly covered (info) · Covered (success) · No offer anywhere (danger) |
| Clarification | To ask (warning) · Waiting on customer (info) · Answers to relay (warning) · Answered (success) · Withdrawn (neutral) |
| Bid | To bid (warning) · Bid sent (success) |
| Deadline risk | Due soon (warning) · Overdue (danger) |
| Supplier inquiry | Shortlisted (neutral) · Sent (info) · Chased (warning) · Quoted (success) · No offer (danger) |
| Order lifecycle | Active (info) · Cancelled (neutral) · Done (success) |
| Goods | To source (warning) · To place (warning) · On order (info) · Late (danger) · Received (info) · Partly delivered (info) · Delivered (success) |
| Commissioning | n/a (neutral) · To plan (warning) · Planned (info) · Done (success) |
| Invoicing | Not invoiced (warning) · Part invoiced (info) · Fully invoiced (success) |
| Payment | Unpaid (neutral) · Part paid (info) · Settled (success) · Overdue (danger) |
| Costs | Provisional (warning) · Complete (success) |
| Data trust | Basis unknown (warning, dashed) · Estimated dates (neutral, dashed) |
| Invoice courier (TCS) | Not started (neutral) · Copy received (info) · Sent (info) · Delivered (success) |
| FBR | Pending (warning) · Generated (info) · Receipt received (info) · Deposited (success) |
| Company role | Customer (info) · Supplier (neutral) · Both (ink) · Prospect (neutral, dashed) |

Usage: `<span class="chip" data-status="goods:late">…</span>`. Chip height 20, padding 0 8 (6 on the glyph side), 12px weight-500 label, 12px glyph, 1px hairline tinted from the text colour. Do not invent per-screen colours for a status; add it to the map in `tokens.css`.

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
| fg-muted on surface | `#5a5a63` | `#ffffff` | 6.82:1 | 4.5:1 | pass |
| fg-muted on canvas | `#5a5a63` | `#fafafb` | 6.54:1 | 4.5:1 | pass |
| fg-muted on sunken / hover | `#5a5a63` | `#f4f4f6` | 6.21:1 | 4.5:1 | pass |
| fg-muted on selected | `#5a5a63` | `#eeeef1` | 5.89:1 | 4.5:1 | pass |
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
| tone-info-fg on tone-info-bg | `#1d6fb8` | `#e3f0fb` | 4.51:1 | 4.5:1 | pass |
| tone-success-fg on tone-success-bg | `#0f766e` | `#e0f2f1` | 4.73:1 | 4.5:1 | pass |
| tone-warning-fg on tone-warning-bg | `#b45309` | `#fef3c7` | 4.51:1 | 4.5:1 | pass |
| tone-danger-fg on tone-danger-bg | `#c62828` | `#fde8e8` | 4.79:1 | 4.5:1 | pass |
| tone-ink-fg on tone-ink-bg | `#ffffff` | `#26262b` | 15.06:1 | 4.5:1 | pass |

**Tone text on page surfaces (inline text, no chip)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| tone-info-fg on surface | `#1d6fb8` | `#ffffff` | 5.23:1 | 4.5:1 | pass |
| tone-info-fg on canvas | `#1d6fb8` | `#fafafb` | 5.01:1 | 4.5:1 | pass |
| tone-success-fg on surface | `#0f766e` | `#ffffff` | 5.47:1 | 4.5:1 | pass |
| tone-success-fg on canvas | `#0f766e` | `#fafafb` | 5.25:1 | 4.5:1 | pass |
| tone-warning-fg on surface | `#b45309` | `#ffffff` | 5.02:1 | 4.5:1 | pass |
| tone-warning-fg on canvas | `#b45309` | `#fafafb` | 4.81:1 | 4.5:1 | pass |
| tone-danger-fg on surface | `#c62828` | `#ffffff` | 5.62:1 | 4.5:1 | pass |
| tone-danger-fg on canvas | `#c62828` | `#fafafb` | 5.39:1 | 4.5:1 | pass |

**Non-text (3:1)**

| Pair | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| brand-green (focus ring, indicator, progress) on surface | `#429446` | `#ffffff` | 3.78:1 | 3:1 | pass |
| brand-green (focus ring, indicator, progress) on canvas | `#429446` | `#fafafb` | 3.62:1 | 3:1 | pass |
| brand-green (focus ring, indicator, progress) on sunken / hover | `#429446` | `#f4f4f6` | 3.44:1 | 3:1 | pass |
| brand-green (focus ring, indicator, progress) on selected | `#429446` | `#eeeef1` | 3.26:1 | 3:1 | pass |
| border-input on surface | `#8a8a93` | `#ffffff` | 3.42:1 | 3:1 | pass |
| border-input on sunken | `#8a8a93` | `#f4f4f6` | 3.11:1 | 3:1 | pass |
| tone-warning-fg dot on surface | `#b45309` | `#ffffff` | 5.02:1 | 3:1 | pass |

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

**Lucide** (`lucide-react`, ISC licence), one stroke width: **1.75**, round caps and joins, `currentColor`, no fills. Sizes: 12 inside chips (stroke 2 for legibility), 14 for inline facts, **16 default** (buttons, nav, inputs), 20 for list-row icons and the mobile tab bar, 24 for empty and error illustrations. Icons are muted (`--fg-muted`) until they carry an action or a tone. Never an icon-only control without an `aria-label`.

Set in use in the mockups: calendar-check, file-text, package, building-2, wallet (Money), chart-column, search, message-circle-question, send, reply, inbox, truck, alarm-clock-off, clock, circle-alert, triangle-alert, circle-check, check, x, chevron-right, chevron-down, chevron-left, refresh-cw, cloud-off and others (see the spec sheet).

## 11. Density

One default, one alternative.

| | Default | Compact (DataTable only, `data-density="compact"`) |
|---|---|---|
| Row height | 40 (`--row-h`) | 32 |
| Cell padding x | 12 | 8 |
| Table text | 13 / 20 | 12 / 16 |
| Control height | 32 (40 on coarse pointers) | 32 |

Compact is a per-table toggle remembered per user; it never applies to forms or the Today list. On touch devices rows are 48 and controls 40; tap targets on phones are at least 44 (`--hit-touch`).

## 12. Layout

Desktop navigation is either a 224px left rail (`--nav-w`) or a 52px top bar (`--topbar-h`); the Today directions explore both. Exactly six destinations in this order: Today, RFQs, Orders, Companies, Money, Reports. A `⌘K` search field sits with the navigation. Phones use a bottom tab bar with the same six. Page content is capped at 860px for single-column work lists and 1280px for tables. The active destination is marked by a 2 to 3px brand-green indicator plus `--bg-selected` or an underline, never a green fill.

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
