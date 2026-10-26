# Q-Tech CRM brand and UI tokens

Direction C, **Colour blocks** (owner decision 2026-10-22, DECISIONS.md): a navy top bar, white tiles on a quiet blue-grey field, Late / Today / This week as red, yellow and blue blocks, the next step in a navy band holding the one green button, Archivo with a wide cut for titles, rounded corners. Light theme only. Brand green still appears only where it carries meaning. Tokens live in `docs/design/tokens.css` (copied into `src/index.css`) and are wired in `tailwind.config.ts`; `docs/DESIGN_SYSTEM.md` explains the rules. Sections 2 and 3 below are the original 2026-10 logo study; the live values are in tokens.css and DESIGN_SYSTEM section 5.

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

**Direction C additions** (2026-10-22; values and ratios in DESIGN_SYSTEM 5 and 7):

| Role | Hex | Use |
|---|---|---|
| Navy `--bg-chrome` | `#132a4c` | Top bar, phone bars, the next-step band, a selected segment. White text 14.35:1 |
| Quiet field `--bg-canvas` | `#eef2f7` | Behind the white tiles; the quiet block |
| Late block | `#fbe1dd`, ink `#8a1010` | Only late money or a broken promise |
| Today block | `#ffeab0`, ink `#693400` | Due now |
| This week block | `#e1eaf6`, ink navy | The next five days; also the identifier plate |
| Ink `--fg` | `#0c1526` | Body text (18.25:1 on white) |
| Indicator on navy | `#4caf52` | The active tab bar and focus ring on the navy only (5.17:1); `#429446` everywhere else |

The green button on the navy band carries a 2px white ring: green against navy alone is 2.71:1, below the 3:1 a control's edge needs.

There is no dark theme: tokens.css is light only (`color-scheme: light`). A dark set for direction C would be its own decision.

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

- UI: **Archivo** (SIL OFL, free), self-hosted from `@fontsource-variable/archivo`, subset by `scripts/fonts/subset-archivo.py`: the UI face (weight 400 to 700) and **Archivo Wide** (width 118 %, weight 600 to 800) for page titles, section titles and block headings, at weight 750. CSP keeps `font-src 'self'`. The system sans is the fallback and shows first on a slow first visit.
- 16 px is the smallest text anyone reads; 14 px for timestamps only.
- Numbers and codes use the sans with tabular figures: Tailwind class `num` (Archivo's `tnum`, plain zero). Geist Mono is retired from the app.
- The PDFs (quotation, PO, invoice, expense report) still use Geist (`src/features/quotations/pdf/fonts.ts`); moving them to Archivo is a separate decision, since the printed documents are already with customers.
- Apply `num` to: PO, invoice, RFQ, quotation and challan numbers; PKR amounts; quantities; dates in tables; phone numbers; NTN/STRN.
- Right-align numeric columns. Amounts show `PKR` prefix or column header, with thousands separators.
- Radius is a ladder: 10px controls, 12px rows drawn as tiles, 16px panels and blocks, fully round chips, tags and counts. Colour blocks and white tiles separate, hairlines only where two tiles meet; shadows only on floating layers (popovers, dialogs) and the white ring on the green button over navy.

## 6. Logo usage

| File | Use |
|---|---|
| `public/brand/logo-wordmark.png` | Login page, printed documents (quotes, invoices), app header at 30px height. In the navy top bar it sits on its own white plate (10px corners, 8px side padding), never directly on the navy. Keep clear space equal to the height of the "Q". |
| `public/brand/logo-mark.png` | Square contexts: the top bar below 1280 px and the phone bar (directly on the navy: it is its own green square), avatars, PWA/app icon sources. |
| `public/favicon.ico`, `favicon-32.png` | Browser tab (generated from the mark). |
| `public/apple-touch-icon.png` (180) | iOS home screen. |
&
| `public/icon-maskable-512.png` | Maskable manifest icon, made from the mark by `scripts/make-pwa-icons.py` (the white disc fits the 80% safe zone). |

In the app, show a logo through `<BrandImage name="logo-mark" | "logo-wordmark">` (`src/ui/BrandImage.tsx`), never a bare `<img>`: it serves the `.avif`, then the `.webp`, then the `.png` of the same name in a `<picture>` (the PNG is the fallback and the only format the PDFs use). All three are made by `scripts/make-brand-images.py` and precached (`brand/*.{png,webp,avif}` in `vite.config.ts`); a new brand image needs all three.

Do not recolour, stretch, outline or place the wordmark on a coloured or photographic background. The wordmark's tagline is too small to read below 24px height; use the mark instead.

## 7. Never

- No gradients, anywhere. Colour is flat blocks.
- No glass, blur or translucent frosted panels.
- No glow, neon or coloured shadows.
- No decorative green: no green headers, green card tints, green hover rows, green icons that do not mean action/active/focus. The blocks are red, yellow and blue, never green.
- No red block for anything but late money or a broken promise, and no empty block: an empty group draws nothing.
- No green text in brand green `#429446` on white.
- No colour-only status; always icon or text too.
- No proportional digits in tables or on documents.
