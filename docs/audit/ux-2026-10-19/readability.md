# Typography, readability, density and contrast audit: qtech-crm-v2

Branch `phase0/stabilise` at `7a29f3a`, 2026-10-19. Read-only: no repo file edited, the app was not run, no browser used.

**Method**
- Class counts come from a script over `src/**/*.{ts,tsx}`. It skips tests and `__snapshots__` and matches `text-{xs,sm,base,table,lg,xl,2xl,display}` and `text-[…]`, including responsive prefixes.
- Contrast ratios use the WCAG 2.x luminance formula on the hex values in `docs/design/tokens.css`.
- Text widths were measured with the repo's own Geist and Geist Mono WOFF files (`node_modules/@fontsource/*`), read through `node_modules/fontkit`.
- Screenshots viewed:
  - Mockups: `screens/today-b2-01-target-tile-with-the-working.png`, `order-detail-01-admin-populated.png`, `components-06-datatable.png`, `today-b2-06-mobile-375.png`, `money-06-admin-receivables-with-the-payment-reminder-pane.png`, `rfq-detail-08-mobile-375.png`.
  - The built app: `review/o01-o03/o03-order-admin-1440.png`, `review/p9-e2-fix/board-all-1440.png`, `review/p9-e2-fix/board-375.png`.

---

## 0. Bottom line

- **About 90% of all sized text in the app is 12 or 13 px.** Of 1,092 size classes outside `src/dev`, 513 are `text-xs` (12 px) and 467 are `text-sm` (13 px). Only 57 are `text-base` (14 px).
- **What the owner reads most is at 12 px:**
  - status chips
  - due and overdue hints
  - table column headers
  - field errors and help text
  - every small button (at least 121 call sites)
  - SumBar labels, tooltips and toast text
  - the order items table, which is compact by default
- Body copy is 14 px. The design system calls 13 px "the default for dense UI" (`docs/DESIGN_SYSTEM.md:20`), and Geist was chosen because it is "built for dense product UI at 12 to 14 px" (`:11`).
- **Contrast passes AA but is thin:**
  - Normal text is fine: `--fg` gives 18.9:1 and `--fg-muted` gives 6.8:1.
  - The status chips sit right on the AA line: info and warning text on their own tints measure **4.51:1**.
  - Warning text on a selected row measures **4.34:1**, which fails AA.
  - Muted grey is used 774 times; plain `text-fg` is used 107 times.
- **The scale is easy to change.** No component uses an arbitrary `text-[Npx]` size, because the Tailwind `fontSize` theme is replaced with tokens (`tailwind.config.ts:72-81`). Changing the tokens rescales the whole app, and the 17 mockups as well (they all link `../tokens.css`).
- **What makes it costly is the hard-coded heights and widths around the text:**
  - fixed heights: 26, 28 and 20 px controls and chips
  - fixed line-heights
  - the JavaScript row heights in DataTable
  - the top bar, which has **no room left at 1280 to 1366 px** (`e2e/money-books/shell-overflow.spec.ts:6`: "At exactly 1280 px the top bar … was 7 px too wide")

---

## 1. The current type scale and where each size is used

### 1.1 Tokens (`docs/design/tokens.css`, copied verbatim to `src/index.css:125-131, 157-179`)

| Token | Size / line height | Line ratio | Use according to DESIGN_SYSTEM §2 |
|---|---|---|---|
| `--text-xs` | 12 / 16 | 1.33 | captions, chip labels, kbd, meta lines, compact tables |
| `--text-sm` | 13 / 20 | 1.54 | **default for dense UI**: tables, lists, buttons, secondary copy |
| `--text-base` | 14 / 22 | 1.57 | body copy (`body` in `index.css:358`), form values, row titles |
| `--text-lg` | 16 / 24 | 1.5 | panel and card titles |
| `--text-xl` | 20 / 28 | 1.4 | section headers, big inline figures (SumBar) |
| `--text-2xl` | 28 / 34 | 1.21 | page titles |
| `--text-display` | 36 / 40 | 1.11 | one headline number (target tile) |
| `--text-table` | = sm, 13 / 20 | | DataTable body (`DataTable.tsx:692`); compact mode switches it to xs, 12 / 16 (`index.css:170-175`) |

Sizes and layout tokens:
- Density tokens: `--control-h` 32, `--row-h` 40 and `--cell-px` 12.
- On coarse pointers, controls go to 40 and rows to 48 (`index.css:177-179`).
- `--hit-touch` is 44 and `--topbar-h` is 52.
- All values are **px**. The browser's own font-size setting (Chrome, Settings, Appearance, Font size) therefore does nothing. Only Ctrl and + page zoom enlarges the app.

### 1.2 Counts per feature folder (excluding tests and `src/dev`)

| Folder | xs 12 | sm 13 | base 14 | table | lg 16 | xl 20 | 2xl 28 | display | **share at 12–13 px** |
|---|---|---|---|---|---|---|---|---|---|
| features/money | 141 | 96 | 23 | 4 | 1 | 3 | 1 | 1 | **88%** |
| features/rfqs | 127 | 113 | 13 | 0 | 5 | 2 | 3 | 0 | **91%** |
| features/orders | 56 | 76 | 6 | 0 | 1 | 0 | 2 | 0 | **94%** |
| features/companies | 28 | 35 | 1 | 0 | 0 | 0 | 2 | 0 | **95%** |
| features/settings | 27 | 24 | 3 | 0 | 2 | 0 | 7 | 0 | 81% |
| features/today | 23 | 28 | 7 | 0 | 1 | 1 | 1 | 0 | 84% |
| features/capture | 16 | 25 | 0 | 0 | 2 | 1 | 0 | 0 | 93% |
| features/quotations | 21 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 100% |
| features/fx | 2 | 5 | 0 | 0 | 0 | 0 | 1 | 0 | 88% |
| features/purchaseOrders | 5 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 100% |
| features/reports | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 50% |
| app/shell | 4 | 5 | 0 | 0 | 2 | 0 | 0 | 0 | 82% |
| app/pages and app root | 1 | 7 | 1 | 0 | 0 | 2 | 1 | 0 | 67% |
| src/ui (primitives) | 51 | 27 | 3 | 1 | 4 | 2 | 0 | 1 | 88% |
| src/ui/form | 11 | 11 | 0 | 0 | 0 | 0 | 0 | 0 | 100% |
| **Total** | **513** | **467** | **57** | **5** | **19** | **11** | **18** | **2** | **≈90%** |

Notes on the counts:
- The sm column includes 2 responsive `sm:text-sm` in `TargetTile.tsx`.
- There are **no arbitrary font sizes** (`text-[Npx]`: 0) and no inline `fontSize` on screen.
- The only non-token font sizes are in the two PDFs:
  - `quotations/pdf/QuotationDocument.tsx` uses 7.5 to 11 pt, with a 22 pt title.
  - `purchaseOrders/pdf/PurchaseOrderDocument.tsx` uses the same range.
  - The PDFs are out of scope here, but 7.5 to 8.5 pt print is also small for customers.
- `text-table` is used only 5 times: once in DataTable and 4 times in `ReportPages.tsx`. Most cell renderers set their own `text-sm` or `text-xs`, for example `rfqs/board/BoardParts.tsx:28,43,52,111`. So enlarging only `--text-table` would not enlarge table content; xs and sm have to move too.

**Per primitive (src/ui):**

| Primitive | What is 12 px (`text-xs`) | What is 13 px (`text-sm`) |
|---|---|---|
| `StatusBadge.tsx:32` | the whole chip (h-5, 20 px tall, medium) | none |
| `Tag.tsx:9,22,37` | PO, currency and leg tags; CountPill (h-4, 16 px); "n of n" | none |
| `Button.tsx:45` | **size sm: 28 px tall, 12 px** | md: 32 px, 13 px; lg: 40 px, 14 px |
| `SegmentedControl.tsx:68,74` | every segment (26 px tall) | none |
| `Tabs.tsx:44` | count pill (18 px) | tab label |
| `DataTable.tsx:707,737,442,455,774` | column headers (36 px row, medium, muted), column bands (28 px), group rows, footer ("Showing n of n") | body (via `--text-table`) |
| `Money.tsx:42,97,196,200,216,282` | "PKR" prefix, currency code, notes, labels | `sm` size only; otherwise inherits |
| `SumBar.tsx:43,49,91,112` | figure label ("Outstanding"), sub line, warnings | none |
| `DateRail.tsx:99,127` | "Today" or due label (leading 14 px) and both end dates | none |
| `form/Field.tsx:52,57,64,78` | Required/Optional, **error text**, **help text**, source tag | label (`:48`) |
| `form/fieldContext.ts:15` | none | every input, select and textarea value |
| `Toast.tsx:197,203,229` | body (at 80% opacity), Undo and action buttons | title |
| `Tooltip.tsx:45,109` | every tooltip, including the "why is this disabled" texts | none |
| `Avatar.tsx:5-8` | initials (sizes sm to xl) | 2xl |
| `Kbd.tsx:10`, `CommandPalette.tsx:253,268,288,308` | keys, group headings, hints, footer | rows |
| `StepList.tsx:39`, `InlineEditRow`, `Popover`, `EmptyState` | notes and meta | body |

### 1.3 The most important information currently set at 12–13 px

| Information | Size | Where |
|---|---|---|
| **Status chips**: To bid, Overdue, Not invoiced, Part paid and so on (every lifecycle state) | 12 px medium, 20 px tall | `ui/StatusBadge.tsx:32`; spec `DESIGN_SYSTEM.md:142` |
| **Due and overdue hints** on the RFQ board ("3 days overdue", "in 2 days") and "1 uncovered" | 12 px | `rfqs/board/BoardParts.tsx:43,52,113` |
| **Today list**: the due badge ("1d", "3d"), the RFQ ref and company line, the waiting line, group headers | 12 px | `today/TodayScreen.tsx:278,261,270,161` |
| **Table cells, including PKR amounts** | 13 px mono (comfortable), **12 px in compact** | `DataTable.tsx:692`; amounts inherit (`Money.tsx` "Omit to inherit … table cells") |
| **Order items**: unit net, line net, GST, gross | **12 px**: the table defaults to compact | `orders/OrderItemsPanel.tsx:353` |
| Table column headers | 12 px medium, muted | `DataTable.tsx:737` |
| Form **error** and help text | 12 px | `form/Field.tsx:57,64` |
| Form values and labels | 13 px | `form/fieldContext.ts:15`, `form/Field.tsx:48` |
| Small buttons ("Add line", "Mark placed", row actions) | 12 px, 28 px tall | `Button.tsx:45`, at least 121 call sites (money 35, rfqs 27, orders 17, companies 15) |
| Top navigation labels and counts | 13 px medium; counts 12 px | `shell/TopBar.tsx:42,53` |
| Phone tab bar labels | 12 px | `shell/MobileChrome.tsx:78` |
| Key-figure labels ("Outstanding", "Overdue") and sub-lines | 12 px | `SumBar.tsx:43,49` |
| Order leg step labels ("Placed", "Expected") and hints | 12 px | `orders/LegsPanel.tsx:213,215` |
| Segmented filters (Open or Closed, Mine or All, the Today filters) | 12 px, 26 px tall | `SegmentedControl.tsx:68,74` |
| Undo toast body and the Undo button | 12 px | `Toast.tsx:197,203` |
| Disabled-reason tooltips | 12 px | `Tooltip.tsx:45` |

### 1.4 Density defaults
- **The default is comfortable**: rows 40, cells padded 12, table text 13 (`DESIGN_SYSTEM.md:242-249`). Density is a per-person, per-table setting kept in `localStorage` under `qtech.density.<user>.<table>` (`ui/useTableDensity.ts:21`). The RFQ board has its own key, `qtech.rfqs.density`, defaulting to comfortable (`rfqs/board/BoardPage.tsx:42-49`).
- **Three tables are compact by default:**
  - `orders/OrderItemsPanel.tsx:353`: Order items, the main money table on the order page. It has a switch, but it starts compact.
  - `companies/SupplierPanel.tsx:410`: "Recent enquiries". It has no toolbar, so **no switch: it is locked compact**.
  - `companies/SitesPanel.tsx:330`: "RFQs and orders at {site}". Also locked compact, with no switch.
  - Why the last two are locked: `DataTable.tsx:153-155` shows the switch only when a toolbar is given.

---

## 2. Other readability factors

### 2.1 Font family and weights
- The fonts are Geist and Geist Mono at weights 400, 500 and 600 (never 700), self-hosted (`index.css:12-46`).
- Measured from the WOFF files: **x-height 0.53 em, cap height 0.71 em** for both families. At 12 px the lowercase is about 6.4 px tall; at 13 px, about 6.9 px. That is average for a UI face, so the size, not the font, is what makes it small.
- Geist 400 is thin-stroked. On 96 to 120 dpi Windows panels at 12–13 px, grey 400-weight text is the hardest combination to read.
- `-webkit-font-smoothing: antialiased` (`index.css:361`) does nothing on Windows and makes text thinner on macOS.
- Weight 500 is used for nav, buttons, chips and table headers, which helps.

### 2.2 Line height
- The token line heights are generous: 1.33, 1.54 and 1.57.
- Fixed line-heights that will not grow with the text:

| Utility | Uses | Where |
|---|---|---|
| `leading-4` (16 px) | 20 | `Field.tsx:52-78`, `Toast.tsx:197` |
| `leading-5` (20 px) | 18 | various |
| `leading-[18px]` | 6 | various |
| `leading-[14px]` | 3 | `DateRail.tsx:99`, `orders/RankedPicker.tsx`, `orders/ConvertDialog.tsx` |
| `leading-[17px]` | 1 | |
| `leading-[21px]` | 2 | `money/payments/ReminderPanel.tsx`, `rfqs/IntakeParts.tsx` |

  At 14 px, a 16 px line height gives a 1.14 ratio: cramped multi-line errors and help text.

### 2.3 Colour and contrast

Ratios are computed from the token hex values. AA requires 4.5:1 for normal text.

| Text token | on surface #fff | on canvas #fafafb | on sunken #f4f4f6 (table header, hover) | on selected #eeeef1 (selected row, active) |
|---|---|---|---|---|
| `--fg` #111113 | 18.86 | 18.08 | 17.17 | 16.29 |
| `--fg-2` #3d3d44 | 10.77 | 10.33 | 9.81 | 9.30 |
| `--fg-muted` #5a5a63 | **6.82** | 6.54 | 6.21 | 5.89 |
| `--primary` #1a7b46 (links, green text) | 5.30 | 5.08 | 4.82 | **4.57** (borderline) |
| `--tone-info-fg` #1d6fb8 | 5.23 | 5.01 | 4.76 | **4.51** (borderline) |
| `--tone-warning-fg` #b45309 | 5.02 | 4.81 | 4.57 | **4.34: fails AA** |
| `--tone-success-fg` #0f766e | 5.47 | 5.25 | 4.98 | 4.73 |
| `--tone-danger-fg` #c62828 | 5.62 | 5.39 | 5.12 | 4.86 |
| `--fg-disabled` #b3b3bb | 2.08 | | | (disabled only; WCAG-exempt) |

Status chips (tone text on its own tint, 12 px medium):

| Chip | Ratio |
|---|---|
| neutral | 9.30 |
| **info** | **4.51** |
| success | 4.73 |
| **warning** | **4.51** |
| danger | 4.79 |
| ink | 15.06 |

- The info and warning chips ("Open", "Awaiting offers", "To bid", "Due soon", "Not invoiced") pass AA by 0.01. At 12 px they are the hardest-to-read elements in the app for older eyes, even though axe passes them.
- **Warning text in a selected DataTable row is 4.34:1.** Selected rows use `bg-selected` (mockup legend in `components-06-datatable.png`), and the board's "due soon" hints use warning text (`BoardParts.tsx:43,113`). That is an AA failure the gallery axe run does not exercise.
- **How much text is grey:** `text-fg-muted` appears 774 times, `text-fg-2` 192 times and plain `text-fg` 107 times (besides the body default). 365 lines are both 12 px and muted. "Passes AA" (6.8:1) is still a weak signal when most secondary data (refs, dates, hints, headers) is small and grey.
- **Lines and edges:**
  - Hairlines (`--border` #e3e3e7) are **1.28:1** on white. Row and panel dividers are faint for older eyes; they are non-text, so WCAG does not require more.
  - `--border-input` #8a8a93 is 3.42:1, which just meets 1.4.11.
  - Surface against canvas is 1.04:1, so panels separate only by their hairline.
- Toast body text: white at 80% opacity on ink is 10.17:1, which is fine. The month-end lock bar's `opacity-80` 12 px line (`monthEnd/ChecklistPage.tsx:139`) is fine too.

### 2.4 Letter case
- There are no all-caps labels anywhere in `src`: the grep for `uppercase`, `text-transform` and `tracking-wide*` returns 0. This matches `DESIGN_SYSTEM.md:31`.
- Codes such as RFQ-0177, ORD-0038 and INV-2256 are uppercase by nature and set in mono. That is fine.

### 2.5 Number formatting
- Amounts are set in Geist Mono with tabular figures (`.num`, `index.css:392-395`), comma thousands, a true minus sign, and paisa only when not zero (`lib/money.ts:56-65`).
- The "PKR" prefix is 12 px, muted, in sans (`Money.tsx:42,97`).
- The target tile abbreviates to "3.78M" (`today/targetModel.ts:79`).
- Mono dates ("Wed 21 Oct") read a little spaced out in tables (`review/p9-e2-fix/board-all-1440.png`).
- Grouping is Western (1,949,800), not lakh or crore (19,49,800). This is worth a one-line check with the owner, but it is not a typography defect.

### 2.6 Line length
- Running text is capped: Dialog paragraphs at `max-w-[62ch]` (`Dialog.tsx:156`, 9 uses) and `max-w-prose` (66ch, 16 uses). This follows `DESIGN_SYSTEM.md:32`.
- The caps are in `ch`, so they scale with the font. A bigger type scale keeps about the same characters per line. No issue.

### 2.7 Icon-only controls
- At **768 to 1279 px** the top bar shows icons only, with the active label (`TopBar.tsx:51`, `max-xl:sr-only`). Labels for the other five places are in a `title` tooltip only.
  - A 1366×768 laptop at 125% Windows scaling is **1093 CSS px**, so it gets the icon-only bar.
  - Search and Capture also collapse to icons below 1280 (`TopBar.tsx:68,83`).
- Other icon-only controls:
  - 5 `Button iconOnly` call sites. The type requires an aria-label (`Button.tsx:71`).
  - The phone action bars (Chase and "…" in `rfq-detail-08-mobile-375.png`; snooze in `today-b2-06-mobile-375.png`).
- They are accessible, but an older reader has to remember what each icon means.

### 2.8 Mobile: sizes and tap targets
- **There is no type step on phones.** No `max-md:text-*` size classes exist. Phones get the same 12–13 px as desktop. The page title in the mobile bar is 16 px (`MobileChrome.tsx:36,47`).
- **iOS zooms into every input.** Inputs are 13 px (`fieldContext.ts:15`), and iOS Safari zooms the page when the focused field is under 16 px (the viewport meta is `width=device-width, initial-scale=1.0`, `index.html:5`). The page then stays zoomed after the keyboard closes.
- Tap targets:
  - **Meet 44 px:** `--hit-touch` 44; the tab bar (`min-h-touch`); the action bars (asserted at 44 px in `e2e/rfqs/detail.spec.ts:704-708` and `e2e/today/today.spec.ts:312`); Toast actions (`max-md:h-touch`).
  - **Below 44 px:**
    - `Button size="sm"` is 28 px, with **no touch override** on any of the 121 call sites.
    - `SegmentedControl` is 26 px. It is used for the phone filters (`board-375.png` stacks four of them).
    - Coarse-pointer controls are 40, not 44 (`index.css:178`).
  - All of these meet WCAG 2.2 2.5.8 (24 px) but not the design system's own rule of 44 on phones (`DESIGN_SYSTEM.md:249`).
- **The phone tab bar is full already.** Six equal columns (`MobileChrome.tsx:70`, `minmax(0,1fr)`) are 62.5 px wide at 375 and 60 px at 360. "Companies" at 12 px medium measures **64.1 px**, so it already overflows its column. At 13 px it is 69.4 px; at 14 px, 74.8 px.

### 2.9 What the owner actually sees (CSS viewport under Windows scaling)

| Laptop | Scaling | CSS width | Top bar mode | 13 px text renders at |
|---|---|---|---|---|
| 1366×768 | 100% | 1366 | xl: full labels (the tightest case) | 13 device px |
| 1366×768 | 125% | 1093 | md to xl: **icons only** | 16.25 device px |
| 1920×1080 | 100% | 1920 | 2xl | 13 device px (very small on a 15.6" panel) |
| 1920×1080 | 125% (Windows default) | 1536 | 2xl | 16.25 device px |
| 1920×1080 | 150% | 1280 | xl, at the exact width that overflowed by 7 px | 19.5 device px |

---

## 3. Scores

| Area | Score | Why |
|---|---|---|
| Text size | **4 / 10** | About 90% of sized text is 12–13 px. Chips, due hints, errors, small buttons, headers and the compact order table are 12 px. Only page and panel titles are large. Fine for a young power user at 125% scaling; small for an older owner on 1366@100% or 1920@100%. |
| Contrast | **7 / 10** | Primary and muted text pass comfortably (18.9 and 6.8). Chips sit at 4.51 for info and warning. Warning on a selected row fails at 4.34. The UI is mostly grey (774 muted against 107 fg), and dividers are 1.28:1. |
| Visual hierarchy | **6 / 10** | Page titles (28) and panel titles (16) are clear. Inside panels, 12, 13 and 14 px are 1 px apart and barely distinguishable, so hierarchy depends on grey against black and weight 500. Badges, hints, refs and headers all collapse into one small grey layer. |
| Density | **5 / 10** (packed) | 40 px rows, 32 px controls, 28 px small buttons, two-line cells, 8 to 11 column tables, 5-chip dimension strips, and three tables compact by default. Orderly, as in the mockups, but tuned for speed, not reading. |
| Mobile readability | **4 / 10** | Desktop sizes on phones, 13 px inputs that make iOS zoom, 26–28 px targets on filters and small buttons, and a tab bar already over-full at 12 px. The good parts: 44 px action bars, 48 px rows on touch, cards instead of tables. |

---

## 4. Proposal: a larger, calmer scale

### 4.1 Approach
- Keep the token architecture. It is the reason this is cheap.
- Ship it as **two layers**:
  1. **"Large" as a per-person setting** (`[data-text="large"]` on `<html>`). The owner gets bigger text at once, and the default stays pixel-identical, so 0 baselines change and there is no parity deviation for other users.
  2. **A modest "Normal" bump (+1 px) as the new default**, decided after the owner has used Large for a week. It costs the baselines and needs a recorded parity deviation (see 4.6).
- Both layers are pure token overrides in `docs/design/tokens.css`, re-copied into `src/index.css`, so `npm run check:tokens` stays green. `scripts/check-token-parity.mjs` compares every selector block, so the new block simply has to exist in both files.

### 4.2 Token values

| Token | Current | **Normal** (proposed new default) | **Large** (user setting) |
|---|---|---|---|
| `--text-xs` / `--lh-xs` | 12 / 16 | **13 / 18** | **14 / 20** |
| `--text-sm` / `--lh-sm` | 13 / 20 | **14 / 20** | **15 / 22** |
| `--text-base` / `--lh-base` | 14 / 22 | **15 / 24** | **16 / 24** |
| `--text-lg` / `--lh-lg` | 16 / 24 | **18 / 26** | **18 / 26** |
| `--text-xl` / `--lh-xl` | 20 / 28 | **22 / 30** | **22 / 30** |
| `--text-2xl` / `--lh-2xl` | 28 / 34 | 28 / 34 | **30 / 36** |
| `--text-display` | 36 / 40 | 36 / 40 | 36 / 40 |
| `--text-table` (comfortable) | 13 / 20 | **14 / 20** (= sm) | **15 / 22** (= sm) |
| `--text-table` (compact) | 12 / 16 | **13 / 18** (= xs) | **14 / 20** (= xs) |
| `--control-h` (pointer: fine) | 32 | **36** | **40** |
| `--control-h` (coarse) | 40 | **44** | **44** |
| `--row-h` comfortable / compact | 40 / 32 | **44 / 36** | **48 / 40** |
| two-line row (JavaScript constant) | 48 | **52** | **56** |
| coarse row | 48 | 52 | 56 |
| `--topbar-h` | 52 | **56** | **56** |
| Button sm height (`Button.tsx:45`) | 28 | **32** | **36** |
| SegmentedControl height (`SegmentedControl.tsx:74`) | 26 | **32** | **36** |
| Chip, Tag and Kbd height (`h-5`) | 20 | **22** | **24** |
| Top nav label / count | 13 / 12 | 14 / 13 | **15 / 14** |
| Phone tab label (`MobileChrome.tsx:78`) | 12 | 12, inactive set to `fg-2` | 13 with a shorter label (see below) |
| Phone input text | 13 | **16** (stops the iOS zoom) | 16 |

Colour changes. These go in Normal, and work for both layers:

| Token | Current | Proposed | Result |
|---|---|---|---|
| `--fg-muted` | #5a5a63 | **#4a4a52** | 8.78 / 7.99 / 7.58 on surface / sunken / selected |
| `--tone-info-fg` | #1d6fb8 | **#185f9e** | 5.72 on its tint, 6.63 on white, 5.72 on selected |
| `--tone-warning-fg` | #b45309 | **#92400e** | 6.37 tint, 7.09 white, **6.12 selected**: fixes the 4.34 failure |
| `--tone-success-fg` | #0f766e | **#0b625b** | 6.23 tint, 7.21 white |
| `--tone-danger-fg` | #c62828 | **#b21f1f** | 5.75 tint, 6.76 white |
| `--border` | `--neutral-150` | **`--neutral-200` #d2d2d8** | 1.51:1, up from 1.28; rows and panels readable |
| `--border-strong` | `--neutral-200` | `#c4c4cc` | 1.73:1 |

Mapping rule for weight: 12–13 px data in grey (refs, due hints, item sub-lines) should become `fg-2`, not `fg-muted`.

### 4.3 Components that need layout work once the text is bigger

1. **Top bar at 1280 to 1440 (`shell/TopBar.tsx`).**
   - Measured with Geist 500, the six labels plus four counts grow by **+24 px** at 14 px, **+45 px** at 15 px and **+69 px** at 16 px. Capture grows by another 3 to 11 px.
   - There is no slack to absorb this at 1280 (`shell-overflow.spec.ts:6`) and little at 1366.
   - Room to reclaim between 1280 and 1535 px:
     - Drop the nav **icons** and keep the labels: saves 6 × (16 + 8) = **144 px**. Labels read better than icons for the owner.
     - Hide the `⌘K` and `C` key hints: about 60–75 px.
     - Hide the "Admin" role label, which the account menu already shows: about 45 px.
     - Narrow the search box from 240 to 200: 40 px.
   - That is about 290 px in total, enough for Large.
   - Also **keep the labels at 1024 to 1279** (1366@125% gives 1093 CSS px) by dropping icons rather than labels.
   - Re-run `e2e/money-books/shell-overflow.spec.ts`.
2. **Wide tables.**
   - Money columns grow with the font (Geist Mono "2,300,764.00"): 86 px at 12, 101 at 14, 108 at 15, 115 at 16.
   - Badges grow too: "Awaiting offers 0 of 1" is 169 px at 12 and 191 at 14.
   - Tables at risk:
     - Order items, 11 columns (`OrderItemsPanel.tsx`).
     - Receivables, which has hard breakpoints at 1360 and 1440 (`ReceivablesPage.tsx:42,186`; asserted as 8, 6 and 8 visible columns at 1440, 1360 and 1280 in `e2e/money-books/payment-reminder.spec.ts:120-135`). Under Large these move up by about 96 px (min 1456 and 1536).
     - The RFQ board, 8 columns.
     - The GST register, Margins, Bank tick and Reports (P&L, aging).
   - Use the existing `hideBelowLg` and `hideClass` on low-value columns (`DataTable.tsx:422`) rather than horizontal scroll.
3. **Fixed heights that will clip** (change `h-` to `min-h-` or to a token):
   - `Button.tsx:45,54` (`h-[28px]`, `w-[28px]`)
   - `SegmentedControl.tsx:74` (`h-[26px]`)
   - `StatusBadge.tsx:32`, `Tag.tsx:9`, `Kbd.tsx:9` (`h-5`); `Tag.tsx:22` CountPill (`h-4`); `Tabs.tsx:44` (`h-[18px]`)
   - `DataTable.tsx:697-737`: header `h-[36px]`, bands `h-[28px]`
   - `Toast.tsx:203,229` (`h-[28px]`)
   - `CommandPalette.tsx:237,308`
   - Month-end and bank 26 px tabs (`MonthEndFrame.tsx`, `MonthEndNav.tsx`, `BankTickPage.tsx`)
   - `orders/OrderItemsPanel.tsx:232`: the GST select, `h-[28px]`
   - In all there are 8 × `h-[26px]` and 13 × `h-[28px]` in `src`.
4. **DateRail** (`DateRail.tsx:95-99`): the label row is reserved with `pt-[18px]` and `leading-[14px]`. Use `pt-[var(--lh-xs)]` and `leading-[var(--lh-xs)]`. The Today context pane's stacked labels hard-code `top-[18px]` (`today/ContextPane.tsx:798`). Collision maths there already uses measured widths, which is good.
5. **DataTable JavaScript row heights**: `rowH = 48 / 32 / 40` and `GROUP_H = 36` (`DataTable.tsx:59,203`) drive windowing. Read them from `--row-h`, or map them from the text-size mode, or virtualised lists will misplace rows.
6. **Fixed line-heights**: 20 × `leading-4`, 18 × `leading-5` and 12 × arbitrary `leading-[…px]` (see 2.2). Swap them for `leading-[var(--lh-xs)]` and the like.
7. **Phone tab bar**: 6 columns of 62.5 px cannot hold "Companies" at 13 px or more. Either keep 12 px with darker inactive labels, or use a shorter phone label ("Firms" or "Clients"; this is an owner copy decision), or show 5 tabs plus More.
8. **Fixed-width side panels** absorb it by wrapping, but check them for awkward wraps:
   - Reminder panel at 392 px (`ReceivablesPage.tsx:186`)
   - RFQ header columns at 240 and 280 (`RfqHeaderBlock.tsx`)
   - Tooltip at 260 (`Tooltip.tsx:45`)
   - Dialogs at 400, 480 and 640 (`Dialog.tsx`)

### 4.4 The "Text size: Normal / Large" setting
- **Where:**
  - Settings, My details (`features/settings/MyDetailsPage.tsx`): a `SegmentedControl` labelled "Text size" with Normal and Large.
  - The same choice in the account menu (`app/shell/AccountMenu.tsx`), so it is two taps from any screen.
- **Storage:** `localStorage` key `qtech.textsize.<user id>`, the same pattern as `useTableDensity.ts:21`. It is free and per device. Later, an optional `profiles.text_size` column (one migration, still free) lets it follow the owner from laptop to phone.
- **How it applies:**
  - `document.documentElement.dataset.text = 'large'`, set in `src/main.tsx` before `createRoot().render`. It cannot go in an inline script in `index.html`, because the CSP is `script-src 'self'` (`vercel.json`).
  - It is updated live when the setting changes.
  - The CSS is one block in `tokens.css` and `index.css`: `[data-text="large"] { --text-xs:14px; --lh-xs:20px; … --control-h:40px; --row-h:48px; }`.
  - `[data-density="compact"]` keeps working without changes: it sets `--text-table: var(--text-xs)`, which resolves to the inherited large value.
  - The coarse-pointer rule needs a matching `[data-text="large"]` variant inside the `@media (pointer: coarse)` block.
- **Alternative considered:** converting the tokens to `rem` and scaling `html { font-size }`. That would also make Chrome's own font-size setting work, but it scales everything, including spacing caps and 2xl titles. Explicit token overrides are more controlled and keep parity checking simple. Recommended: explicit overrides.

### 4.5 Cost

| Item | Large only (opt-in) | Normal as the new default |
|---|---|---|
| **Visual baselines** (`e2e/__screenshots__/`, 41 × w1440 + 41 × w375 = **82 PNGs**) | **0 changed.** Optionally add a `w1440-large` project (16 sections = 16 new PNGs) | **All 82 regenerated.** Every section and scene contains text. Use the CI `update_baselines` workflow (`docs/design/VISUAL_TESTS.md` steps 3–5; Linux only, `ubuntu-24.04`) |
| **Mockup parity** | No deviation for the default. Large is a documented user preference | **A deliberate, owner-requested deviation** from the Gate-2 frozen mockups (`ARTIFACTS.md:7`; the owner's "ditto same as the mockup" rule, `PARITY_AUDIT.md:3`). All 17 mockups link `../tokens.css`, so they re-scale automatically. Re-render the **117 reference PNGs** in `docs/design/screens/` with `docs/design/tools/render-screens.mjs`, or keep them as the historical record. Add a DECISIONS.md entry and update `DESIGN_SYSTEM.md` §2 (type table), §3 (chip height 20, `:142`) and §11 (density table). The published claude.ai artifacts become stale (republishing is optional) |
| **axe and contrast** | Re-run `e2e/gallery.axe.spec.ts` with Large on, plus the per-suite axe at 1440 and 375 | Re-run everything. Bigger text cannot lower contrast, and the darker tones raise every ratio. The real risk is clipping and overflow, not contrast |
| **e2e selectors** | **Unaffected.** Specs use role, name and test id; 0 tests assert `text-*` classes. `src/ui/__snapshots__/Money.test.tsx.snap` holds class names and changes only if Money's classes change, not token values | Same |
| **Layout assertions at risk** | Only if the specs are run in Large | `money-books/shell-overflow.spec.ts` (1280, 1366, 1440 × 7 screens); `money-books/payment-reminder.spec.ts:70,120-135` (column counts); no-sideways-scroll checks in `bank.spec.ts:243`, `month-end.spec.ts:197`, `reports.spec.ts:86`, `ranking.spec.ts:267`, `settings-admin.spec.ts:47`, `today.spec.ts:314`; the gallery "page does not scroll sideways" test. The ≥44 px tap assertions can only get easier |
| Token parity CI | Add the block to both files | Edit both files |
| Review PNGs (`docs/design/review/`, 392) | Not needed | Become stale documentation; regenerating is optional |

---

## 5. Prioritised recommendations (quick wins first)

| # | Change | Where | Effort | Baseline cost |
|---|---|---|---|---|
| 1 | **Tell the owner today**: Ctrl and + (110–125%) works now, because tokens are px and page zoom scales them. Chrome's "Font size" setting does not work. On a 1920 laptop, Windows scaling at 125% gives about 16 px text. | none (advice) | S | 0 |
| 2 | Order items opens **comfortable**, not compact, so amounts go from 12 to 13 px | `orders/OrderItemsPanel.tsx:353` | S | 0 (not in the gallery) |
| 3 | Unlock the two locked-compact tables (default comfortable, or give them the switch) | `companies/SupplierPanel.tsx:410`, `companies/SitesPanel.tsx:330` | S | 0 |
| 4 | **Phone inputs at 16 px** so iOS stops zooming (`max-md:text-lg` on the control class; `lg` is 16 px today) | `ui/form/fieldContext.ts:15` (`controlClass`, used by `form/TextField.tsx:42,53`); the prefix and suffix caps at `TextField.tsx:19` | S | about 1–2 w375 PNGs (forms section) |
| 5 | Keep **nav labels on at 1024–1279** by dropping icons instead of labels; drop the key hints and role label below 1536 | `app/shell/TopBar.tsx:42-93` | S–M | 0 (TopBar is not in the gallery); re-run `shell-overflow.spec.ts` |
| 6 | Fix warning text on selected rows (4.34:1): darken `--tone-warning-fg`, or keep row selection off `bg-selected` | `tokens.css` (and the `index.css` copy) | S | most PNGs (chips are everywhere): bundle with #9 |
| 7 | **"Text size: Large" setting** (4.4) plus the fixed-height and line-height fixes (4.3 items 3–6) | tokens block, `main.tsx`, `MyDetailsPage.tsx`, `AccountMenu.tsx`, about 12 primitives, `DataTable.tsx:59,203` | M | 0 changed (+16 optional new) |
| 8 | Phone tap targets: `Button sm` gets `max-md:h-touch`, SegmentedControl is 44 on coarse pointers, `--control-h` coarse goes to 44 | `Button.tsx:45`, `SegmentedControl.tsx:74`, `index.css:178` | M | w375 PNGs for forms, navigation, overlays and similar (about 8) |
| 9 | **Normal +1 px default plus calmer colours** (4.2): darker muted and tone text, stronger hairlines, data-bearing 12 px grey moved to `fg-2` | `tokens.css`, `index.css`, many feature files for `fg-2` | M–L | all 82 baselines; 117 mockup PNGs re-rendered or frozen; DECISIONS and DESIGN_SYSTEM entries |
| 10 | Wide-table pass for the larger scale: column hiding priorities, Receivables breakpoints (`ReceivablesPage.tsx:42,186`), board badge widths, the phone tab-bar label decision | money, rfqs, orders, shell | M | follows #7 and #9 |
| 11 | (Out of scope, noted) Quotation and PO PDFs at 7.5–8.5 pt | `quotations/pdf/QuotationDocument.tsx`, `purchaseOrders/pdf/PurchaseOrderDocument.tsx` | S | 0 |

**Suggested order:**
1. Items 1 to 5 this week. They cost no baselines, apart from 1–2 PNGs for #4.
2. Item 7 next, so the owner can use Large.
3. Decide on item 9 (the new default) after a week of the owner using Large, and record it in DECISIONS.md as an owner-requested deviation from the frozen mockups.
