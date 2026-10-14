# Design artifacts

Private Claude artifacts (standalone builds: tokens, CSS, icons and logos inlined; fonts load from Google Fonts). The committed files in `mockups/` are the source of truth; the artifacts are views of them. Open the files locally through any static server rooted at the repo (the pages reference `../tokens.css`, `mockup.css` and `public/brand/*`).

## Gate 2: approved and frozen (2026-10-14, D09)

The owner approved all 12 mockups in chat on 2026-10-14: "i think I like the mockup for now its good to go". The committed HTML below is the frozen source. The build script that inlined the CSS and logos for publishing is not part of the repo. Reference PNGs (one per board or section, at native width, 1440 px viewport) are in `screens/`, named `<page>-NN-<board>.png`; regenerate them with `tools/render-screens.mjs`. `INVENTORY.md` maps every screen element to a primitive.

| Page | Approved version | Artifact | Source | PNGs in `screens/` |
|---|---|---|---|---|
| Today (direction B, revised) | v2 | https://claude.ai/artifact/9Gs1XgWpaBAgn38yFHtKag | `mockups/g2-today-b2.html` | `today-b2-*` |
| Intake and float | v1 | https://claude.ai/artifact/93tks6VcVnHNSedS7VULFa | `mockups/g2-intake-float.html` | `intake-float-*` |
| RFQ detail | v1 | https://claude.ai/artifact/VfEgNkiBpMf5ATSJyWMGaG | `mockups/g2-rfq-detail.html` | `rfq-detail-*` |
| Chase texts | v1 | https://claude.ai/artifact/HgZeP8qSn59SyN2eRkGtGw | `mockups/g2-chase-texts.html` | `chase-texts-*` |
| Order detail | v1 | https://claude.ai/artifact/L5BsQAWgNTbqP5CbNttiE1 | `mockups/g2-order-detail.html` | `order-detail-*` |
| Money | v2 | https://claude.ai/artifact/RENmwt7cQjxez3iTsvRwXM | `mockups/g2-money.html` | `money-*` |
| Company | v1 | https://claude.ai/artifact/EdvhcYs6jv4d4rsUhGFLLu | `mockups/g2-company.html` | `company-*` |
| Quotation PDF | v1 | https://claude.ai/artifact/XN2zs1q1VtuRA7fJYno9DE | `mockups/g2-quotation-pdf.html` | `quotation-pdf-*` |
| Supplier PO PDF | v1 | https://claude.ai/artifact/LFPD2VbdsYaPzgGP5H92aE | `mockups/g2-po-pdf.html` | `po-pdf-*` |
| Login, Team and Settings | v1 | https://claude.ai/artifact/BsTeU6fDu3ShCMnTKAW9ab | `mockups/g2-login-team-settings.html` | `login-team-settings-*` |
| Capture (share-in) | v1 | https://claude.ai/artifact/QHMh9Gzahykh6m1tkFrnt1 | `mockups/g2-capture.html` | `capture-*` |
| Component states | v1 | https://claude.ai/artifact/WmEUXx1AS6hWuw5baRnbgQ | `mockups/g2-components.html` | `components-*` |
| Month-end and burst entry (D15, owner mini-review, not yet approved) | v1 | https://claude.ai/artifact/14Kkj3oVfHiRcYjhvxLGfG | `mockups/g2-month-end.html` (+ `mockups/g2-e.css`) | `month-end-*` |

Shared styles for the sources above: `mockups/mockup.css`, `mockups/g2-a.css` to `g2-d.css` and `tokens.css`. Today (v2) and Money (v2) are the revised versions that carry the corrected target-tile maths and the entry-trim frames respectively.

## Gate 1 artifacts (superseded, kept for the record)

Published 13 Oct 2026. Direction B was chosen at G1; Today B was then revised as `g2-today-b2`.

| Artifact | Link | Source |
|---|---|---|
| Q-Tech CRM: Design system (spec sheet, frozen with `DESIGN_SYSTEM.md`) | https://claude.ai/artifact/64sydSzK8mG7krxkzMWa3R | `mockups/spec-sheet.html` |
| Today, direction A (not chosen) | https://claude.ai/artifact/9Z3zDuUZ3JE9Bs4t2kiCsq | `mockups/today-a.html` |
| Today, direction B (superseded by `g2-today-b2`) | https://claude.ai/artifact/X7HSBimLhwD4jKWiNnoY88 | `mockups/today-b.html` |

## Revision note: Gate 2 entry trim (design/g2-entry-trim)

The Order detail, Money, RFQ detail, Capture, Company page and Chase texts mockups were revised to cut entry burden. Each flow frame now carries a tap-count annotation. New frames: month stamping, record payment, add expense, create invoice (Money) and Won: create the order (RFQ detail); frame e, answer with a photo (Capture). Shared styles live in `mockups/mockup.css`. The artifact URLs above are unchanged; republish the six affected sources after merging.
