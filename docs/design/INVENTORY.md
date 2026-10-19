# Screen to primitive inventory

Frozen with Gate 2 (2026-10-14, D09). Every UI element in the approved mockups maps to a named primitive, or to a named composite built only from primitives. U-tasks build the primitives; screen tasks build the composites. States for every primitive are in `mockups/g2-components.html` (PNGs `screens/components-*`). Nothing on a screen may use a one-off control, colour, size or shadow: if an element is not listed, it is not approved.

## 1. Primitives

Names are the component names to build. "Ref" is the section of `g2-components` (`screens/components-NN-*`) that shows its states.

| Primitive | What it covers | Ref | Task |
|---|---|---|---|
| `Icon` | The only way to draw a Lucide icon: sizes 12 (chip), 14, 16, 20, 24; stroke 1.75 (2 in chips); decorative by default | 01, spec sheet | U02 (built) |
| `Button` | Primary, secondary, quiet, danger; sizes 40, 32 (40 on touch), 28, plus a 44 touch size for phone chrome; busy state; icon-only variant needs `aria-label` | 01 Controls | U02 (built; the shell and the error page need it) |
| `TextField` | Single-line input; `numeric` variant is mono and right aligned; prefix/suffix adornment (currency, unit); invalid, disabled, read only | 01 | U07 (built: `TextField`, `NumberInput`) |
| `TextArea` | Multi-line input, optional label | 01 | U07 (built) |
| `Select` | Native-styled select | 01 | U07 (built) |
| `Combobox` | Search-as-you-type with the "Add new" row (company, supplier, contact) | 01 | U07 (built) |
| `Checkbox`, `Radio`, `ToggleButton` | Selection controls; ToggleButton is the pressed/not-pressed filter ("Lowest only") | 01, 13 | U07 (built: `Checkbox`, `Radio`, `RadioCard`, `ToggleButton`) |
| `Banner` | Info, warning, error, success strips with optional action | 01 | U02 (built) |
| `Tabs` | Page and panel tabs with count pills (tablist semantics; not used for site navigation, which is a `nav` of links in `AppShell`) | 01 | U03 (built) |
| `Breadcrumb` | Page ancestry on detail pages | 01 | U03 (built) |
| `Skeleton` | Loading placeholder for text, rows and cards | 01 | U04 (built) |
| `FileDrop`, `FileRow` | Drop zone (resting, drag-over, added, too large), added-file rows with size and shrink note | 01 | U07 (built: `FileDrop`, `FileRow`) |
| `Kbd` | Key hint (`⌘K`, `Esc`, `Enter`) | 01, 07 | U02 (built; the shell search shows `⌘K`) |
| `Avatar` | Initials circle for a person (28, or 22 inside key figures) | 01 | U02 (built) |
| `Tag` | Mono identifier or brand tag; dashed when not firm | 13 | U05 (built) |
| `CountPill` | Count beside tab or group names | 13 | U05 (built) |
| `StatusBadge` | Chip for any status value; shape, colour and label together; tones from `tokens.css` | 02 | U05 (built; registry in `src/lib/status.ts`) |
| `Money` | Net / GST / gross, PKR grouping, foreign variant, estimate, stale-rate and basis-unknown marks, tabular mono | 03 | U06 (built: `Money`, `Margin`, `MoneyFx`, `NetGstGross`) |
| `StatusTrack` | Three-step track beside a chip for the invoice courier (TCS) and FBR dimensions | money-01, 02 | U05 (built) |
| `SumBar`, `AfterDrawings` | The Money summary strip (label, figure, one line of context) and the Amendment A6 "Not in P&L" and "After drawings" lines set apart below a month result | money-07, 10 | U06 (built) |
| `Form`, `Field` | RHF + Zod form, label, help, error line, submitting and unique-violation states | 04 | U07 (built: `Form`, `FormField`, `Field`, `useSubmitForm`, `DateInput`, source note) |
| `Dialog` | Modal (Radix), header, body, footer, destructive confirm variant, focus return | 05 | U03 (built) |
| `DataTable` | Comfortable and compact density, sorted column, keyboard row focus, selected row, empty, loading, error, footer totals, group rows | 06 | U04 (built; also selection, virtualised past 80 rows, CSV export) |
| `CommandPalette` | Cmd+K / Ctrl+K, recent, actions, jump to, searching, empty | 07 | U08 (built: shell with pluggable sources; recent rows keep the document glyph) |
| `Toast` | With Undo (10 s), plain, error | 08 | U03 (built: `ToastProvider`, `useToast`) |
| `EmptyState` | Heading, what happens next, optional action; role-limited variant | 09 | U04 (built; goal, neutral and error moods; the role-limited wording is a screen concern) |
| `Tooltip` | Short hover and focus hint; also carries exact values behind rounded figures | 10 | U03 (built) |
| `SegmentedControl` | 2 to 5 options, counts, large size; tablist or radiogroup semantics | 11 | U03 (built) |
| `DateRail` | Start-to-due rail with today marker; tones on track, due soon, due today, overdue, done, no date | 12 | Built (`src/ui/DateRail.tsx`, parity pass); Today's context pane uses it |
| `Popover` | `Menu` variant (actions, 32 px items) and information variant | 13 | U03 (built) |
| `InlineConfirm` | In-place "Copied. Marked as chased today. Undo" line | 13 | U03 (built) |
| `Callout` | Dashed quiet note; no tone | 13 | U03 (built) |
| `StepList`, `ProgressSegments` | "n of m" segments and process steps | 13 | Built: `ProgressSegments`, `ProgressBar` (both in `Tag.tsx`) and `StepList` (`src/ui/StepList.tsx`) |
| `InlineEditRow` | Table row edited in place: resting, editing, saving, error; Enter saves, Esc cancels | 13 | Built (`src/ui/InlineEditRow.tsx`, parity pass): the caller owns the fields and validation |
| `InfoTip` | Small (i) button that opens one short explanation; replaces explanatory footnotes and sub-lines under panels | UX 2026-10-19 | Built (`src/ui/InfoTip.tsx`); see below |

### Building blocks added by the UX audit (2026-10-19, DECISIONS.md)

**`InfoTip`** (`import { InfoTip } from '@/ui/InfoTip'`; props `label: string` (required, the accessible name, e.g. "About TCS"), `children` (one or two plain sentences or short JSX, no form controls), optional `side`, `align`, `className`). A 24px (i) button (Lucide `Info`, muted ink, global focus ring) with an invisible 44px (`--hit-touch`) tap area on `pointer: coarse`. It opens the information `Popover` (`role="dialog"`, named by `label`, at most 32ch wide, `text-sm`) on click, tap or Enter; Esc, an outside click or a second press closes it and focus returns to the button; hover alone never opens it, so it behaves the same on phones. Its click does not bubble, so it can sit in a clickable row or card. Use it where a panel printed an explanatory footnote or sub-line (PSID, TCS, FBR, "Margin not final"); never for the only copy of something the person must act on. Gallery: section `infotip` and scene `infotip-open`.

**Phone one-bar** (`useMobileBar` in `src/app/shell/MobileBarContext.tsx`; drawn by `MobileBar` and `BottomTabs` in `MobileChrome.tsx`). A phone detail page calls `useMobileBar({ title, back, fallback, actions, hideTabs })` and the phone shows ONE bar, back + title + actions, in place of the default bar (logo, title, search, Capture, avatar). `back` is a route (`'/rfqs'`), `'history'` (the previous screen in the app, else `fallback`, default `'/'`, replacing the entry) or the original object `{ to?, onClick?, label? }`; `close: { to?, onClick? }` draws an x instead. `actions` is the right slot: a small "more" menu (a `size="touch"` quiet icon `Button` with `Ellipsis` and `aria-label="More actions"`, opening `PopoverContent variant="menu" align="end"`). `hideTabs: true` removes the bottom tab bar while the page is mounted, for pages with their own sticky action bar (that bar keeps `env(safe-area-inset-bottom)` itself). Below 768 only; the default returns on unmount. `action` is the old name of `actions` (TeamPage). Gallery: section `phonebar` (not photographed: it draws shell parts).

**`useChannelPreference`** (`import { useChannelPreference, type ContactChannel } from '@/lib/useChannelPreference'`; `const [channel, setChannel] = useChannelPreference()`, `ContactChannel = 'whatsapp' | 'email'`). Remembers the person's last WhatsApp / Email choice on this device in `localStorage` under `qtech.channel.<user id>` (`qtech.channel.anon` signed out), every read and write in try/catch; default `'whatsapp'`. Feed it to the WhatsApp/Email `SegmentedControl` of `ChasePrep`, reminders and enquiries so they open on the channel used last time. No visual of its own.

## 2. Composites (built from the primitives; screen tasks own them)

| Composite | Made of | Used on |
|---|---|---|
| `AppShell` (top bar, six role-filtered destinations, `⌘K` trigger, role text, account avatar, phone bar and bottom tab bar; a detail page swaps the phone bar for the one-bar form, see section 1). Built in U02: destinations are a `nav` of links with `aria-current="page"`, not `Tabs`; the role is plain text, not a `Tag`; the account menu (`Popover`, name, role, Sign out calling the `session.signOut()` stub) was built in U03; the `⌘K` button opens the U08 palette | `Icon`, `Button`, `Kbd`, `Avatar` | every screen |
| `PageHeader` (title, sub line, actions, breadcrumb) | `Breadcrumb`, `Button`, `StatusBadge` | all detail and register pages |
| `Panel` (titled card with header, meta, actions) | `Button`, `Tag`, `SegmentedControl` | Money, Order, Company |
| `KeyValue` list | `Money`, `Tag`, `StatusBadge` | Order, Company, Today detail |
| `TotalsBar` (net / GST / gross summary) | `Money` | Money, Order (the three-cell `NetGstGross` is built in U06; a screen composes the bar from it and `SumBar`) |
| `TargetTile` (progress to quarterly target, pace marker, working) | `Money`, `Tooltip`, `Callout` | Today |
| `ChasePrep` (prepared draft, WhatsApp/Email switch, "Copy and mark chased", stamp) | `SegmentedControl`, `TextArea`, `Button`, `InlineConfirm`, `Toast` | Today, RFQ detail, Money |
| `SupplierSuggestion` row and `MemoryCard` (plain reasons, counts, no scores) | `Checkbox`, `Tag`, `CountPill`, `Popover` | Intake and float |
| `ReplyRow` (supplier reply captured inline, lowest price mark, can't-quote reason) | `InlineEditRow`, `Money`, `StatusBadge`, `Tooltip` | RFQ detail |
| `ClarificationPanel` (to ask / asked / answered / relay pending, photo answer) | `Tabs`, `FileRow`, `StatusBadge`, `Button` | RFQ detail |
| `ItemRow` (item, coverage, GST per line, spec line) | `DataTable`, `Money`, `ProgressSegments`, `Tag` | RFQ, Order |
| `LegCard` (procurement leg, dates, lines, total, expense add) | `Panel`, `Money`, `StatusBadge`, `DateRail`, `Button` | Order detail |
| `DimensionBar` (order status dimensions) | `StatusBadge` | Order detail |
| `MarginPanel` (provisional / basis-unknown marks) | `Panel`, `Money`, `Tooltip` | Order detail, Money (admin only) |
| `RegisterTable` (GST register, month stamping batch bar, TCS and FBR tracks) | `DataTable`, `Checkbox`, `StatusBadge`, `TextField`, `Button` | Money |
| `ReminderPane` (payment reminder draft, counters) | `ChasePrep`, `StatusBadge` | Money |
| `RateStrip` and rates table (staleness bands, manual override) | `Banner`, `DataTable`, `Money`, `TextField` | RFQ detail, Money |
| `UnitChart` (per-brand history) | `ProgressSegments`, `Tag` | Company |
| `CapturePicker` (what to do, on which RFQ, tap count) | `Dialog` (sheet on phone), radio cards via `Radio`, `FileRow`, `FileDrop`, `Button` | Capture |
| `PdfDocument` (letterhead from `company_profile`, line table, totals, terms, signature) | print styles only; `Money` formatting | Quotation, PO |
| `LoginCard`, `SecretReveal` (password shown once, copy) | `TextField`, `Button`, `Banner`, `Dialog` | Login, Team |
| `SettingsNav` + settings forms | `Tabs`, `Form`, `Field`, `Banner` | Settings |

Mockup-only chrome that is not built: phone status bar and home bar, board captions, tap-count pins and bars (`taps-bar`, `pin`), OS and chat mock surfaces on Capture (`os-*`), board scaffolding. Tap-count annotations are design evidence; they belong in tests and the interaction-count checks, not in the app.

## 3. Screen by screen

PNG names are in `screens/`. "Element" is anything a user sees or touches.

### Today (`today-b2-*`, source `g2-today-b2.html`)
| Element | Primitive or composite |
|---|---|
| Top bar, destinations, search, role text | `AppShell` (nav links), `Kbd`, `Avatar` |
| Target tile with working, ahead, none and collapsed states | `TargetTile`, `Money`, `Tooltip`, `EmptyState` (no target) |
| Action list groups, rows with reason line, due and age, the clarification collision line | `DataTable`-style list rows, `StatusBadge`, `Tag`, `DateRail` |
| Waiting group (dimmed, chased n days ago, next nudge) | list group, `StatusBadge`, `Tooltip` |
| Context pane: crumb, key figures, chips, date rail, history | `PageHeader`, `KeyValue`, `DateRail`, `Tag` |
| Prepared draft, WhatsApp / Email switch, copy and mark, undo | `ChasePrep`, `SegmentedControl`, `Button`, `Toast` (Undo), `InlineConfirm` |
| Snooze menu | `Popover` (Menu) |
| Mobile: list with accordion pane | `AppShell` phone bar and bottom tab bar, `Popover`, `Button` |
| Empty (goal state), loading, error | `EmptyState`, `Skeleton`, `Banner` |

### Intake and float (`intake-float-*`)
| Element | Primitive or composite |
|---|---|
| Company field with inline create | `Combobox`, `Field` |
| Paste area and split item rows | `TextArea`, `ItemRow`, `TextField` |
| Supplier groups with plain reasons, "supplied before" ticked | `SupplierSuggestion`, `Checkbox`, `Tag`, `CountPill` |
| Memory card and its sample-size states | `MemoryCard`, `Popover` (information) |
| Draft with blank `Spec:` | `TextArea`, `Callout` |
| Copy & mark floated, 10 s undo | `Button`, `Toast` (Undo), `InlineConfirm` |
| Step trail and tally | `StepList` |

### RFQ detail (`rfq-detail-*`)
| Element | Primitive or composite |
|---|---|
| Header, owner, due date, bid and close actions | `PageHeader`, `StatusBadge`, `DateRail`, `Button`, `Popover` (Menu) |
| Items with coverage, uncovered flag | `ItemRow`, `ProgressSegments`, `StatusBadge` |
| Supplier reply rows, lowest price, currency, can't-quote reason (inquiry-level, optional item override) | `ReplyRow`, `InlineEditRow`, `Money`, `Select`, `Tag` |
| Rate strip and rate states | `RateStrip`, `Banner`, `Tooltip` |
| Clarifications with photo answer | `ClarificationPanel`, `FileRow`, `Tabs`, `CountPill` |
| Issue quotation dialog | `Dialog`, `Form`, `TextField`, `TextArea`, `Money` |
| Won: create the order | `Dialog`, `Form`, `Button` |
| Chase draft | `ChasePrep` |
| Empty, loading, error, mobile 375 (sticky actions) | `EmptyState`, `Skeleton`, `Banner`, `Button` |

### Chase texts (`chase-texts-*`)
| Element | Primitive or composite |
|---|---|
| Customer clarification and supplier chase drafts | `ChasePrep`, `TextArea`, `SegmentedControl` |
| Subject, recipient, channel | `Field`, `Tag` |
| Wording by situation (first nudge, later, 30 days overdue) | `DataTable` (documentation board), `StatusBadge` |

### Order detail (`order-detail-*`)
| Element | Primitive or composite |
|---|---|
| Header, status dimensions | `PageHeader`, `DimensionBar`, `StatusBadge` |
| Items with GST per line | `DataTable`, `Money` |
| Procurement legs, dates, expense add | `LegCard`, `DateRail`, `Button`, `Dialog` |
| Commissioning and dates | `StepList`, `KeyValue`, `DateRail` |
| Margin panel (admin only) with provisional and basis-unknown marks | `MarginPanel`, `Money`, `Tooltip` |
| Engineer variant: no money apart from sale and supplier prices | same primitives; `Money` omitted by role |
| Issue PO dialog | `Dialog`, `Form`, `Money`, `Select` |
| Legacy basis-unknown, loading, error, tablet 768 | `Banner`, `Skeleton`, `EmptyState` |

### Money (`money-*`)
| Element | Primitive or composite |
|---|---|
| Views switch (register, receivables, cash, margins, rates) | `Tabs`, `CountPill` |
| Totals bar | `TotalsBar`, `Money` |
| GST register with TCS and FBR tracks, month stamping, batch bar | `RegisterTable`, `DataTable`, `Checkbox`, `StatusBadge`, `TextField`, `Button`, `Toast` (Undo) |
| Record payment, add expense, create invoice | `Dialog`, `Form`, `Field`, `Money`, `Combobox` |
| Receivables and reminder pane | `DataTable`, `ReminderPane`, `ChasePrep` |
| Cash month, order margins, exchange rates | `Panel`, `DataTable`, `Money`, `MarginPanel`, `RateStrip` |
| Sales variants (invoices, balances, register only) | same, with role-filtered columns |
| Loading, error, tablet 768 | `Skeleton`, `Banner` |

### Company (`company-*`)
| Element | Primitive or composite |
|---|---|
| Header, tags, contacts | `PageHeader`, `Tag`, `Avatar`, `KeyValue` |
| Supplier memory: populated, low data, imported history only | `MemoryCard`, `UnitChart`, `Tooltip`, `Callout` |
| Customer sites with RFQ and order history | `Panel`, `DataTable`, `StatusBadge` |
| Brand and unit history | `UnitChart`, `Tag` |

### Quotation PDF and PO PDF (`quotation-pdf-*`, `po-pdf-*`)
| Element | Primitive or composite |
|---|---|
| Letterhead (from `company_profile`), reference block, customer block | `PdfDocument` |
| Line table, running header on pages 2 and 3, "continued" marker | `PdfDocument` |
| Totals, amount in words, terms, signature | `PdfDocument`, `Money` format |
| Bank details (printed only when filled in `company_profile`) | `PdfDocument` optional block |
| PO price-source labels | `PdfDocument`, `Tag` |

### Login, Team, Settings (`login-team-settings-*`)
| Element | Primitive or composite |
|---|---|
| Login with "ask your admin" line | `LoginCard`, `TextField`, `Button`, `Banner` |
| Team list, row menu, account menu | `DataTable`, `Popover` (Menu), `StatusBadge`, `Avatar` |
| Add person (password shown once), reset, change role, deactivate, reactivate | `Dialog`, `Form`, `SecretReveal`, `Select`, `Banner` |
| Company profile (incomplete, complete with unsaved change, read only) | `SettingsNav`, `Form`, `Field`, `Banner`, `Button` |
| Settings home and exchange rates | `SettingsNav`, `RateStrip`, `DataTable` |

### Capture (`capture-*`)
| Element | Primitive or composite |
|---|---|
| Share-in sheet, captured text and photo | `CapturePicker`, `FileRow`, `TextArea` |
| What to do (answer, photo answer, supplier questions, notes, new RFQ), most likely pre-selected | `Radio` cards in `CapturePicker` |
| On which RFQ (recents, search all) | `Combobox`, `Radio` list |
| Split into questions with ticks | `Checkbox` list |
| Save action with tap count | `Button` |
| Signed-out resume, desktop drag-drop, size limits and failures | `Banner`, `FileDrop`, `FileRow`, `Dialog` |

### Components sheet (`components-*`)
The sheet is the primitive reference: sections 01 to 13 correspond to the rows in the primitives table. Every state used by the screens above also appears here.
