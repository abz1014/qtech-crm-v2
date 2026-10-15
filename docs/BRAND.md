# Q-Tech CRM brand and UI tokens

Direction: an instrument panel, not a dashboard. Light theme is the default. Surfaces are flat and neutral, borders are hairlines, and brand green appears only where it carries meaning. Tokens live in `src/index.css` (HSL channels, shadcn convention) and are wired in `tailwind.config.ts`.

## 1. Colours sampled from the logos

Dominant pixel clusters (anti-aliased edges ignored) from `public/brand/logo-wordmark.png` and `logo-mark.png`:

| Role | Hex | Source |
|---|---|---|
| Brand green | `#429446` (wordmark reads `#43944b`) | "SOLUTIONS", tq mark, circle-mark glyph |
| Deep green | `#1a7b46` | Square mark background |
| Mark black | `#010101` | "Q TECH", tq mark |
| Tagline grey | `#737373` (range `#6c6c6c` to `#737373`) | Tagline text |

## 2. Palette

| Token | Hex | HSL | Allowed use |
|---|---|---|---|
| `--brand-green` / `--ring` | `#429446` | 123 38% 42% | Focus ring, active-nav indicator bar, selected checkbox/radio fill, progress fill, logo. Never text on white. |
| `--brand-deep` / `--primary` | `#1a7b46` | 147 65% 29% | Primary button fill, links, any green text, theme-color. |
| `--foreground` | `#111111` | 0 0% 7% | Body text. |
| `--background`, `--card` | `#ffffff` | 0 0% 100% | Page and card surfaces. |
| `--secondary`, `--muted`, `--accent` | `#f5f5f5` | 0 0% 96% | Table headers, hover rows, quiet panels. Neutral, not green. |
| `--border` | `#e5e5e5` | 0 0% 90% | Hairline 1px dividers and card edges. |
| `--input` | `#8c8c8c` | 0 0% 55% | Form control edges (meets 3:1 for non-text). |
| `--muted-foreground` | `#5c5c5c` | 0 0% 36% | Secondary text, labels, captions. |
| `--success` | `#0f766e` | 175 77% 26% | Paid, delivered, done. Teal, not brand green. |
| `--warning` | `#b45309` | 26 90% 37% | Pending, overdue soon. |
| `--danger` / `--destructive` | `#c62828` | 0 66% 47% | Errors, delete, overdue. |
| `--info` | `#1d6fb8` | 208 73% 42% | Neutral notices. |
| Soft tints | success `#e0f2f1`, warning `#fef3c7`, danger `#fde8e8`, info `#e3f0fb` | see CSS | Badge/alert backgrounds only, with the solid colour as text. |

Semantic colours are always paired with an icon or text label, never colour alone. Success is teal so it cannot be mistaken for the green primary action.

Dark theme (`.dark`) is provided but not the default: background `#0e0e0e`, card `#171717`, border `#262626`, text `#ededed`. Primary becomes brand green `#429446` with black text (5.52:1).

## 3. Contrast (WCAG 2.x, computed)

| Pair | Ratio | AA text (4.5) | AA non-text (3.0) |
|---|---|---|---|
| Brand green `#429446` on white | 3.78 | FAIL | pass |
| White on brand green `#429446` | 3.78 | FAIL | pass |
| Deep green `#1a7b46` on white | 5.30 | pass | pass |
| White on deep green (primary button) | 5.30 | pass | pass |
| Secondary grey `#5c5c5c` on white | 6.69 | pass | pass |
| Secondary grey `#5c5c5c` on `#f5f5f5` | 6.13 | pass | pass |
| Logo tagline grey `#737373` on white | 4.74 | pass (barely) | pass |
| Tagline grey `#737373` on `#f5f5f5` | 4.35 | FAIL | pass |
| Body `#111111` on white | 18.88 | pass | pass |
| Success `#0f766e` on white | 5.47 | pass | pass |
| Warning `#b45309` on white | 5.02 | pass | pass |
| Danger `#c62828` on white | 5.62 | pass | pass |
| Info `#1d6fb8` on white | 5.23 | pass | pass |
| Success/warning/danger/info on own soft tint | 4.73 / 4.51 / 4.79 / 4.51 | pass | pass |
| Input edge `#8c8c8c` on white | about 3.4 | n/a | pass |
| Black on brand green (dark primary) | 5.52 | pass | pass |

## 4. The green-for-meaning rule

Brand green fails AA for text in both directions (3.78:1). So:

- Brand green `#429446` is used for non-text only: focus ring, active-state indicator, selected controls, progress, the logo.
- Anything that carries readable green text, including the primary button label and links, uses deep green `#1a7b46`.
- Green means exactly three things: primary action, active/selected state, focus. If an element is green and is none of those, remove the green.
- Success states use teal, plus an icon or label.

## 5. Typography

- UI: system sans stack (`font-sans`). No webfont, so nothing to load.
- Numbers and codes use `font-mono` with tabular figures. Tailwind class `num` = mono + `tabular-nums`; `tabular` is tabular figures only (for sans text in table columns).
- Apply `num` to: PO, invoice, RFQ, quotation and challan numbers; PKR amounts; quantities; dates in tables; phone numbers; NTN/STRN.
- Right-align numeric columns. Amounts show `PKR` prefix or column header, with thousands separators.
- Radius is 4px (`--radius`). Borders 1px hairline; no shadows beyond a single subtle one on floating layers (popovers, dialogs).

## 6. Logo usage

| File | Use |
|---|---|
| `public/brand/logo-wordmark.png` | Login page, printed documents (quotes, invoices), app header at 28 to 32px height on white. Keep clear space equal to the height of the "Q". |
| `public/brand/logo-mark.png` | Square contexts: collapsed sidebar, avatars, PWA/app icon sources. |
| `public/favicon.ico`, `favicon-32.png` | Browser tab (generated from the mark). |
| `public/apple-touch-icon.png` (180) | iOS home screen. |
&
| `public/icon-maskable-512.png` | Maskable manifest icon, made from the mark by `scripts/make-pwa-icons.py` (the white disc fits the 80% safe zone). |

Do not recolour, stretch, outline or place the wordmark on a coloured or photographic background. The wordmark's tagline is too small to read below 24px height; use the mark instead.

## 7. Never

- No gradients, anywhere.
- No glass, blur or translucent frosted panels.
- No glow, neon or coloured shadows.
- No decorative green: no green headers, green card tints, green hover rows, green icons that do not mean action/active/focus.
- No green text in brand green `#429446` on white.
- No colour-only status; always icon or text too.
- No proportional digits in tables or on documents.
