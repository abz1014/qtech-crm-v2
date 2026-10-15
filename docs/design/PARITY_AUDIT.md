# Mockup parity audit (main at 69aa74d)

Owner's rule: "make sure that the ui is ditto same as the mockup. dont miss out on anything."

## Method and limits

- Read-only audit. No app code changed.
- Evidence: each approved mockup HTML/CSS read in full (`docs/design/mockups/`), the reference PNGs (`docs/design/screens/`), the committed review screenshots (`docs/design/review/*`, 1440 and 375), the built source on main (ground truth where a review PNG may predate a later fix) and the deviations recorded in `docs/DECISIONS.md`.
- The app was NOT run: it needs a Supabase stack (Docker) and the repo has no mocked-data mode. Spacing and sizes come from the mockup CSS versus the built Tailwind classes, not from fresh screenshots. No new comparison images were produced.
- The RFQ board, Companies list, create-company and merge dialogs, shell and palette have no dedicated g2 mockup; they were compared with `g2-components`, `DESIGN_SYSTEM.md`, `INVENTORY.md` and `BUILD_PLAN.md`. This is stated in each section.
- Deviations that DECISIONS.md records as approved are still listed (status DIFFERENT, decision referenced) so the owner sees every one.
- Row IDs: A- login/team/settings/shell/components, B- Today/intake/chase texts/board, C- RFQ detail and quotation PDF, D- company pages.

## Counts (non-MATCH rows, approximate; counted from the tables)

| Severity | A | B | C | D | Total |
|---|---|---|---|---|---|
| high (missing function or panel) | 6 | 6 | 12 | 4 | 28 |
| medium (visible difference) | 19 | 26 | 17 | 20 | 82 |
| low (cosmetic) | 47 | 61 | 38 | 41 | 187 |
| MATCH rows | 52 | 39 | 33 | 24 | 148 |

## Prioritised fix list (all screens)

High first; the task named is the BUILD_PLAN task the fix belongs to.

1. Mark won and Create order from the quotation: not built anywhere (C-90..C-92) - O01.
2. RFQ detail restructure to the mockup: one "Items and supplier replies" panel, per-item Add reply, row menu, Add item, quotations table in the left column (C-02, C-20, C-22, C-33, C-39, C-60) - R07/R19. Needs owner decision first (per-item vs per-supplier entry).
3. RFQ detail rail: "Suppliers asked" card with memory lines and chase card, "Float to another supplier", suggested suppliers and "Copy enquiry text" for uncovered items (C-42, C-44, C-46, C-50) - R07/R16/R17.
4. Rate bar, live PKR preview and Exchange rates link (C-21, C-40) - R15.
5. Settings: Exchange rates page and nav entry, Settings home for sales/engineer, View-only tag (A-16, A-17, A-18) - R15.
6. Phone: MobileBar back/close/action variants, then RFQ detail 375 back/title bar and sticky action bar with Chase menu, Team phone layout (A-82, C-100, C-103, A-34..A-36) - U02, R07, A04.
7. Palette: Actions group (New RFQ, Capture, Go to), N / C / G-T shortcuts, per-type icons (A-89..A-91) - U08/R12.
8. Today "just chased" pane: "Moved to Waiting" bar with Next ref, switched cells, rail marker, compact "Chased today" card, "Chase again now" (B-39..B-45) - R16.
9. One customer-chase generator: Clarifications panel must use generateCustomerChase (B-84), job title in RFQ-page signatures (B-83), copy banners with return date (B-74), Undo on RFQ-page chase toasts (B-75), supplier escalation next-in-line list (B-87) - R09/R11.
10. Issue-quotation dialog: include tick, Best reply hint, Re-issue chip and new-ref title, Preview PDF, totals labels (C-70, C-72, C-73, C-77, C-80) - R19.
11. "Bid and close" menu incl. "Sent the offer again" (C-07..C-09) - R07.
12. Intake: item grid layout, highlighted blank Spec, "Float item N to them" link, option meta and similar-name flag, inline create as drawn (B-110, B-124, B-128, B-102, B-104/D-121) - R05/R02.
13. Company page: "What" column in site history, order chips Delivered/Payment overdue, Repeat order (D-82, D-84, D-83) - R02/O06/O02 (orders later).
14. Company supplier panel: dashed "dates estimated" delivery squares, imported-only footnote and sub-line, outcome chip icons and "Quoted, RFQ open", currency rate and age, "Quotes in / Supplier since", Roles panel (D-35, D-34, D-41, D-62, D-69, D-03, D-71) - R18/R02.
15. Shared primitives: DateRail (six states), StepList, InlineEditRow, DataTable density toggle / `/` / Esc / focus memory, role-limited EmptyState, avatar sizes (A-118..A-120, A-108, A-109, A-112, A-113, A-114, A-84) - U-series.
16. Company profile: invalid state with inline messages, flagged blanks in read-only view (A-59, A-69) - A06.
17. Quotation PDF: running header on pages 2+, keep totals/terms/signature together, "First issue" line, bold valid-until (C-112, C-121, C-123, C-124) - R19/R20.
18. Today mobile: drop duplicate h1, trim accordion, compact actions, chevrons (B-58, B-61, B-62, B-09); nav counts (B-11/B-164); board filter box, density, Items/Value columns, empty/error copy (B-153..B-162) - R11/U02/R06.
19. Email chase: recipient address and Subject row with Copy subject (B-24, B-26, B-73) - R11.
20. Cosmetics: Sign out red, hatched shortfall bar, "PKR" on pace label, snooze labels, relay icon, remaining low rows.

## Split of the open items

### Genuine data or brief conflicts: need an owner decision first

- Reply entry: per item under each item (mockup, "ditto") versus one form per supplier (D-R07 as built) - C-02, C-20, C-22, C-39.
- "Partly covered" rule (C-23); supplier descriptor line has no data source (C-25); currency control versus "currency is always explicit" in R07 (C-41); "At entry" rate line (C-30); Files panel not in the mockup (C-52); close dialog versus one-tap reason menu (C-08, C-10).
- Partial quotations / include tick versus D-R19 "every item priced" (C-72); GST 16% option versus 18%/Exempt only (C-76); contact job title has no `contacts` column (C-71, C-113, B-25, B-78).
- City versus country: mockups show a city but companies hold `country` only (D-03, D-04, D-121, D-123, B-104).
- Clock times on bids ("17:00") versus date-only data (B-06, B-79); "Mr. Tariq" salutation needs a short-name/title field (B-25); `users.phone` for email signature (B-29); item tags and editable dates in questions need an item link on `clarifications` (B-28, B-71, B-76); "Copied" row pill (B-10); collision line not drawn (B-12); 4th target figure "Waiting: ..." (B-20); "Nothing is saved until you continue" (B-100); enquiry "please include in your reply" asks, which R04 requires but the mockup lacks (B-125); board column set, no mockup (B-150..B-155).
- Change password page exists only in code and SUPABASE.md, the mockup has none (A-71, A-77); "Copy sign-in message" extra (A-45); Money icon wallet (mockups) versus banknote (DESIGN_SYSTEM, navConfig) (A-74); sticky versus static profile save bar (A-67); phone Team pattern (A-34..A-36); Exchange rates timing versus DECISIONS A06 "not linked yet" (A-16, A-18).
- Extras to keep or drop: rail "Brands carried" panel (D-70), "Recent enquiries" table and History placeholder (D-65, D-95), admin Money and Notes panels (D-93, D-94); approved "Not ordered" wording (D-52, D-62); "A received" wording (D-69); approved "they/their" and grouped password display (A-41..A-54).

### Simply undone: no decision blocks them

- A: A-16/A-17/A-18 (once Q3 is confirmed), A-36, A-59, A-82, A-84, A-85, A-89, A-108, A-109, A-113, A-118, A-119, A-120, plus the DIFFERENT rows listed in Part A.
- B: B-07, B-09, B-11, B-14, B-16, B-18, B-19, B-22, B-24, B-26, B-27, B-31, B-35..B-37, B-39..B-45, B-52, B-53, B-58, B-61, B-62, B-73..B-75, B-83..B-85, B-87, B-102, B-103, B-105, B-107, B-110, B-119, B-122, B-124, B-127, B-128, B-153, B-154, B-160..B-162, B-164.
- C: C-05, C-07, C-08, C-09, C-12, C-13, C-15, C-16, C-21, C-33, C-35..C-37, C-40, C-42..C-44, C-46, C-50, C-54, C-55, C-60..C-64, C-70, C-73, C-74, C-77, C-80, C-90..C-92, C-100..C-105, C-112, C-123, C-124, C-126.
- D: D-01, D-05, D-06, D-21, D-22, D-27, D-28, D-34, D-35, D-37..D-41, D-50, D-53, D-54, D-56..D-58, D-66, D-71, D-82, D-86, D-89, D-122 (D-83, D-84, D-85 belong to the later O02/O03/O06 tasks).

---

# Detailed tables

# Part A: Login, Team, Settings, Shell, Components (UI parity audit)

Worktree: main at 69aa74d. Evidence: mockup HTML (g2-login-team-settings, g2-components, g2-today-b2 phone bar, mockup.css, g2-a/d.css), docs/design/screens PNGs, docs/design/review/a04-a06 and u01-u02 PNGs, and the source in src/app, src/features/settings, src/ui, src/dev/gallery. The DB-backed app was not run; review PNGs may predate later fixes, so source is the ground truth. "Approved" = a DECISIONS.md entry accepts the deviation (still listed as DIFFERENT).

Task keys in the fix column: A03 (login), A04 (Team), A06 (Company profile), R15 (Settings > Exchange rates, not built), U02 (shell), U03/U04/U05/U06/U07/U08 (primitives), U09 (gallery), R12 (palette search), O03 / M-tasks (later screens).

## 1. Login (`src/app/pages/SignInPage.tsx`)

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-01 | Card frame | `.login-card` 360px, gap 20, padding 32/32/24, 1px border, radius 4, on canvas | `max-w-[360px] gap-5 px-8 pb-6 pt-8 rounded border bg-surface` on `bg-canvas` | MATCH | - | - |
| A-02 | Wordmark | logo-wordmark.png, height 44, left | same, `h-[44px] justify-self-start` | MATCH | - | - |
| A-03 | Heading and sub | "Sign in" / "Use the email and password your admin gave you." | identical | MATCH | - | - |
| A-04 | Email field | label "Email", placeholder "name@company.pk", autocomplete username | same (adds inputMode email) | MATCH | - | - |
| A-05 | Password field + eye | label "Password", eye adornment, aria "Show password" | eye button toggles Eye/EyeOff, aria "Show password"/"Hide password" | MATCH | - | - |
| A-06 | Primary button | `btn-primary btn-lg btn-block` "Sign in" | `Button primary lg`, full width, "Sign in" | MATCH | - | - |
| A-07 | Forgot line | key-round icon + "Forgot your password? Ask your admin to reset it." under a top rule, no link | identical | MATCH | - | - |
| A-08 | Wrong credentials | danger banner "Email or password is incorrect" / "Check both and try again."; password field invalid, email not | same copy; password `aria-invalid` | MATCH | - | - |
| A-09 | Deactivated banner | warning, user-x icon, "This account is deactivated" / "Ask your admin to reactivate it." | same copy; icon is the shared Banner TriangleAlert, not user-x | DIFFERENT | low | Banner `icon` override, pass UserX (U02/A03) |
| A-10 | Signing in (busy) | fields readonly, button disabled with spinner "Signing in" | `readOnly={busy}`, `Button busy busyLabel="Signing in"` | MATCH | - | - |
| A-11 | Phone 375 | no border, full width, surface bg, padding 24/16; "Fields are 40 px tall on touch" | border-0, surface bg, px-4; inputs and button use `max-sm:h-touch` = 44px | DIFFERENT | low | Mockup says 40 (coarse control height): drop `max-sm:h-touch` (A03) |
| A-12 | Client validation text | none drawn | "Enter your email.", "Enter a valid email address.", "Enter your password." | EXTRA | low | Keep |
| A-13 | Extra error states | wrong credentials, deactivated, busy only | adds "Can’t reach the server / Check your connection and try again." and "Sign-in is not set up in this build" | EXTRA | low | Keep (needed) |

## 2. Team and Settings frame (`SettingsLayout.tsx`, `TeamPage.tsx`, `TeamDialogs.tsx`, `PasswordDialog.tsx`)

### 2a. Settings frame

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-14 | Left nav width and bg | `.set` grid 220px / 1fr; nav bg surface, right border | `md:grid-cols-[200px_...]`, nav `bg-canvas` | DIFFERENT | low | 220px and `bg-surface` (A04/A06) |
| A-15 | Nav heading and links | "Settings" xs semibold muted; links 32px; active = selected bg + 3px green bar inset 6px top/bottom, right-rounded | "Settings" xs medium; links `h-control`; bar `inset-y-0 rounded-l` | DIFFERENT | low | Bar top/bottom 6px, round the right side (A04) |
| A-16 | Nav entries, admin | Team, Company profile, Exchange rates (refresh-cw) | Team, Company profile, Change password (key-round). No Exchange rates | MISSING | high | Build Exchange rates and its nav entry (R15; DECISIONS A06 "not linked yet") |
| A-17 | Nav entries, sales/engineer | Company profile with a "View only" tag at the right; Exchange rates; no Team | Company profile (no tag), Change password | DIFFERENT | medium | Add the View only Tag, Exchange rates (A06/R15) |
| A-18 | Settings home (sales/engineer land here) | title "Settings", sub "Company details for documents, and the rates used to compare prices in other currencies."; Exchange rates card (table Currency / PKR for 1 unit / Source / As of / Rate age with fx chips, "Open exchange rates" button) and Company profile card ("View") | `/settings` redirects to team (admin) or company (others); no home | MISSING | high | Build the Settings home (R15 + A06) |
| A-19 | Content width and padding | `.set-main` padding 32/40/48, inner max 940 | `px-8 pt-6`; Team in `max-w-table` (1280), profile and password in `max-w-list` (860) | DIFFERENT | low | One 940px column, 32/40 padding (A04/A06) |
| A-20 | Page header | `.page-h`: h1 2xl semibold, sub max 62ch, right action | same classes and copy | MATCH | - | - |
| A-21 | Phone settings navigation | only the Team phone frame is drawn (back bar) | a link row above the page: Team / Company profile / Change password | DIFFERENT | low | Mockup silent on phone settings nav; see A-34 and Q6 |

### 2b. Team list

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-22 | Title, sub, Add button | "Team"; "Everyone who can sign in to Q-Tech CRM. Passwords are created and reset here, and shown once."; primary user-plus "Add person" | identical | MATCH | - | - |
| A-23 | Toolbar | search 260px "Search name or email" with icon; All / Active / Deactivated with mono counts; right note "At least one active admin is always required." | search 240px, same placeholder, SegmentedControl with counts, same note | MATCH | - | - |
| A-24 | Columns | Name (sortable), Role, Job title, Status, actions header visually hidden | Name, Role (also sortable), Job title, Status, header text "Actions" visible (a04-team-1440.png) | DIFFERENT | low | Hide the Actions header; Role not sortable (A04) |
| A-25 | Name cell | avatar 28, bold name, "You" tag, mono email | same | MATCH | - | - |
| A-26 | Status chip | `user:active` "Active", `user:deactivated` "Deactivated" with ban icon | `StatusBadge dimension=user` | MATCH | - | - |
| A-27 | Empty job title | n/a | "Not set" muted | EXTRA | low | Keep |
| A-28 | Deactivated row | whole row dimmed (`is-dim`), avatar neutral-400, secondary "Reactivate" (user-check) replaces menu | only avatar at 60% opacity; Reactivate button present (APPROVED A04) | DIFFERENT | low | Dim the whole row (A04) |
| A-29 | Row menu | ellipsis quiet button; Edit job title (pencil), Change role (shield), Reset password (key-round), divider, Deactivate (user-x, red) | identical | MATCH | - | - |
| A-30 | Row highlight while menu open | selected-row background | none | DIFFERENT | low | Use `activeRowId` while the menu is open (A04) |
| A-31 | Footer | in the card: left "6 people · 5 active, 1 deactivated", right "Deactivated people keep their name on everything they created." | left "6 people, 5 active, 1 deactivated" (commas); the sentence sits outside the card, right aligned | DIFFERENT | low | Use " · ", move the sentence into the footer (A04) |
| A-32 | Empty / no match | tile, title, reason, "Clear filter" (components 09) | muted paragraph: `No one matches "x".` / "No one is deactivated." / "No people yet."; no tile, no clear action | DIFFERENT | low | EmptyState with Clear filter (U04/A04) |
| A-33 | Loading / error | skeleton rows; error with retry | skeleton rows; error "Could not load the team" + raw `error.message` + Try again | DIFFERENT | low | "Couldn’t load the team", safe sentence, reference line, never raw text (U04) |
| A-34 | Phone header | own bar: chevron-left Back, "Team", primary "Add" (36px) | shared MobileBar titled "Settings" (logo, search, avatar); h1 "Team" and "Add person" below; link row above | DIFFERENT | medium | Back-bar variant of MobileBar with title and right action (U02/A04) |
| A-35 | Phone rows | 60px, avatar 36, "Name" + "Role · Job title", Deactivated chip, ellipsis; whole row opens the sheet; no search field | table rows 48px, avatar 28, subline "Role · Title" (deactivated as text "Deactivated · "), Reactivate button, search box shown, only the ellipsis opens the menu | DIFFERENT | medium | `mobileRow` cards, 60px, chip, tappable row (A04) |
| A-36 | Phone row actions | bottom sheet: person header (avatar, "Name / Role · Title"), four 44px rows, Deactivate red | same dropdown Popover as desktop | MISSING | medium | Bottom-sheet menu for phones (U03/A04) |
| A-37 | Phone note | "At least one active admin is always required." under the list | inside the toolbar | DIFFERENT | low | Move below the list on phone (A04) |

### 2c. Account menu

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-38 | Header | name (medium) + role (xs muted), divider | same | MATCH | - | - |
| A-39 | Items | Settings (gear), Team (users, admin only), divider, Sign out (log-out, red) | Settings, Team (admin), Change password, Install app (when installable), divider, Sign out in default ink (not red) | DIFFERENT | medium | `danger` on Sign out (U03). Extras: A-77, A-78 |

### 2d. Dialogs

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-40 | Add person | "Add person"; "They sign in with the email below and a password we generate."; Full name, Email (Required), Role select Sales/Engineer/Admin, Job title (Optional), help "The job title prints under the signature on quotations and purchase orders."; lead "Password is generated for you"; Cancel / "Create account" | identical (job title placeholder "Sales coordinator" added) | MATCH | - | - |
| A-41 | Email already used | "Usman Tariq already uses this email. Use a different address, or change his details from the Team list." | same with "their" (APPROVED A04) | DIFFERENT | low | Approved |
| A-42 | Creating | read-only fields, disabled buttons, "Creating account", Esc/close ignored | same via useSubmitForm + Dialog busy | MATCH | - | - |
| A-43 | Account created | success tile; "Account created"; "Give Hira the email and password below so she can sign in."; who-row avatar 32 + name + mono email + role; secret box; warning banner "This password is shown once / Copy it now and send it to Hira yourself. After you close this window it can't be shown again. You would reset it instead."; lead "Copy the password to continue"; Done disabled | same structure and banner copy; sub says "they" (APPROVED); who-row avatar 28 (no 32 size, see A-84); Done locked until copy | DIFFERENT | low | Wording approved; avatar size via A-84 |
| A-44 | Secret box | sunken bg, dashed border-input; code `Vk7x-mQ3p-Rt9w-Hn2e`; copied = solid green border, tinted bg, "Copied", lead "Copied to clipboard" | surface bg, dashed line-strong; value shown as four-character groups with spaces, raw 16 chars copied (APPROVED A04); copied tint, "Copied", "Copied to clipboard" | DIFFERENT | low | Format approved; use `bg-sunken` and `border-line-input` to match (A04) |
| A-45 | Copy sign-in message | not in mockup | "Copy sign-in message" button + note "For WhatsApp. It includes the password." (also unlocks Done) | EXTRA | medium | Mentioned in DECISIONS A04; owner Q1 |
| A-46 | Edit job title | small, pencil tile, sub = name, help "Prints under the signature on quotations and purchase orders.", Cancel / Save | identical (placeholder "Sales engineer") | MATCH | - | - |
| A-47 | Reset confirm | warning tile; "Reset Ayesha Rana’s password?"; "We generate a new password and show it to you once. Her current password stops working and she is signed out on every device."; "Reset password" with key-round | same title; first name and "they" (APPROVED) | DIFFERENT | low | Approved |
| A-48 | Reset result | "Password reset"; "Hira is signed out everywhere. Give her the new password below."; label "New password" | "them"; label "New password" | DIFFERENT | low | Approved |
| A-49 | Change role | "Change Ayesha Rana’s role"; "Takes effect immediately."; radio cards Admin / Sales / Engineer with the three help lines; Cancel / "Change role" | identical; Change role also disabled when unchanged | MATCH | - | - |
| A-50 | Only active admin (role) | warning banner "Bilal is the only active admin / Make someone else an admin first. Q-Tech CRM always needs at least one."; other cards disabled; button disabled | same | MATCH | - | - |
| A-51 | Deactivate confirm | danger tile; "Deactivate Saad Hussain?"; three bullets (log-out, file-text, history); danger "Deactivate Saad" | same; bullets use "them/their" (APPROVED) | DIFFERENT | low | Approved |
| A-52 | Deactivate blocked | danger banner "You can't deactivate the only active admin / Make another person an admin first, then try again."; button plain "Deactivate", disabled | same banner; button reads "Deactivate Bilal" disabled | DIFFERENT | low | Plain "Deactivate" when blocked (A04) |
| A-53 | Reactivate confirm | success tile; "Reactivate Saad Hussain?"; "He can sign in again as Sales with his existing password. If he has forgotten it, reset it from his row afterwards."; "Reactivate" (user-check) | same with "They" (APPROVED) | DIFFERENT | low | Approved |
| A-54 | Result toasts | "Saad Hussain reactivated / He can sign in again as Sales."; "Ayesha Rana deactivated / She is signed out everywhere."; "Role changed to Engineer / Faizan Ahmed" | "They can sign in again as Sales."; body "Signed out everywhere."; role toast identical; extra "Job title saved/cleared" toast | DIFFERENT | low | Deactivate body should read "They are signed out everywhere." (A04); rest approved |
| A-55 | Phone dialogs | bottom sheet with grab handle, stacked 44px buttons | bottom sheet below 768, stacked buttons, no grab handle | DIFFERENT | low | See A-91 |

## 3. Company profile and Change password (`CompanyProfilePage.tsx`, `ChangePasswordPage.tsx`)

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-56 | Admin header | "Company profile" / "Your registered details and standard wording. Only admins can change them." | identical | MATCH | - | - |
| A-57 | Incomplete banner | warning "PDFs can’t be issued until legal name and address are set" / "Quotations and purchase orders print these at the top. Everything else can wait." + "Add them"; non-admin: "Ask an admin to add them in Settings." | identical (straight apostrophe) | MATCH | - | - |
| A-58 | Sections | four cards: Business details, Tax registration, Bank details, Quotations and purchase orders, each with the hint line | same four with hints | MATCH | - | - |
| A-59 | Legal name / Address invalid state | labels with "Needed for PDFs"; empty fields drawn invalid with inline "Add the legal name before issuing a PDF." and "Add the address before issuing a PDF." | "Needed for PDFs" note present; no invalid styling and no inline sentences (banner only) | MISSING | medium | Invalid style + two inline messages while empty (A06) |
| A-60 | Address rows | textarea rows 2 | rows 3 | DIFFERENT | low | rows=2 (A06) |
| A-61 | Phone / Email / Website | one 2-col grid (Phone, Email, Website), phone mono | Phone + Email grid; Website separate row, max 320px; phone not mono | DIFFERENT | low | `num` class on phone (A06) |
| A-62 | Tax registration | NTN, STRN mono, Optional | same | MATCH | - | - |
| A-63 | Bank hint | "Not printed anywhere until the letterhead layout is approved." | "Printed on quotations only when filled in. Leave them blank to print nothing." (APPROVED A06) | DIFFERENT | low | Approved |
| A-64 | Bank fields | Bank, Account title, IBAN mono | same | MATCH | - | - |
| A-65 | Quotation validity | "30" + suffix "days", max 100px, help "A new quotation is valid for this many days from its date." | NumberInput suffix days, max 200px, same help | MATCH | - | - |
| A-66 | Terms | Quotation terms rows 5; PO terms rows 4 | both rows 5 | DIFFERENT | low | PO rows=4 (A06) |
| A-67 | Footer bar | static card: "Nothing to save yet" / circle-dot + "1 unsaved change: Quotation validity"; Discard, Save changes | same copy; sticky bottom bar; no circle-dot icon | DIFFERENT | low | Add the icon; sticky is an addition (Q5) |
| A-68 | Saved toast | "Company profile saved / PDFs can be issued now." | identical (variant when still incomplete) | MATCH | - | - |
| A-69 | Read-only (sales) | lock tag 24px "Only an admin can edit"; fieldsets with title only; `dl` 160px label column; missing values flagged in warning colour with icon; "30 days" | tag 20px; hints kept under titles; label column 180px; missing shows muted "Not set" | DIFFERENT | medium | Warning-coloured flagged blanks, 24px tag, 160px column, no hints (A06) |
| A-70 | Loading / error | not drawn | skeletons; error "Could not load the company profile" + Try again | EXTRA | low | Keep |
| A-71 | Change password page | not in the mockup (no frame, no nav item) | `/settings/password`: "Change password" / "Change the password for your own sign-in. You stay signed in on this device."; Current, New ("At least 12 characters."), Confirm; "Change password"; toast "Password changed" | EXTRA | medium | Owner Q2; needs a mockup if kept |

## 4. Shell

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-72 | Top bar frame | 52px, padding 0 20, gap 24, wordmark 30px, six tabs, search, role text, avatar | `h-topbar px-5 gap-6`, wordmark 124x30, same | MATCH | - | - |
| A-73 | Tabs and indicator | Today, RFQs, Orders, Companies, Money, Reports; active fg + 2px green underline | same order and indicator | MATCH | - | - |
| A-74 | Money icon | `wallet` in every mockup frame | `Banknote` (matches DESIGN_SYSTEM section 10 "banknote") | DIFFERENT | low | Docs disagree: owner Q4 |
| A-75 | Search field | 280px sunken, "Search or jump to", `⌘K` | same; always shows "⌘K" even on Windows/Linux while the palette footer switches to Ctrl | DIFFERENT | low | Platform-aware key (U02/U08) |
| A-76 | Role text + avatar | "Admin"/"Sales" xs muted; 28px avatar, title attr | same; role hidden below xl | MATCH | - | - |
| A-77 | Account menu: Change password | not present | menu item "Change password" | EXTRA | medium | Follows Q2 |
| A-78 | Account menu: Install app | not present | "Install app" when installable (R21) | EXTRA | low | Approved by R21 decisions; no mockup |
| A-79 | Sign out colour | red | default ink (see A-39) | DIFFERENT | low | `danger` item (U03) |
| A-80 | Tablet 768-1279 | icons + active label (money-12) | max-xl collapse | MATCH | - | - |
| A-81 | Phone bar, default | 52px: logo mark 28, destination title, search icon, avatar | identical | MATCH | - | - |
| A-82 | Phone bar, back/close variants | chevron-left (or x) + title + right slot ("Add", an amount, Capture) on detail and sub screens (Team, RFQ detail, Capture, add expenses) | `MobileBar` has only the default form: no back, no close, no right slot | MISSING | high | Add `back`/`close` and `action` to MobileBar; each detail screen depends on it (U02) |
| A-83 | Phone tab bar | 6 equal columns, icon over 11px label, green 2px bar top, safe area | same (20px glyph, `min-h-touch`, safe area) | MATCH | - | - |
| A-84 | Avatar sizes | 22, 28, 32 (who-row), 36 (phone row), 40 (`avatar-lg`) | `Avatar` md 28 and sm 22 only | MISSING | medium | Add 32/36/40 (U02) |
| A-85 | Orders, Money, Reports destinations | full screens | `DestinationPage` stand-in "The Orders screen is not built yet" (also for Money, Reports) | MISSING | high | O03, M01-M13 (other auditors' screens) |
| A-86 | Skip link, inline ErrorBoundary | n/a | present | EXTRA | low | Keep |
| A-87 | Role-limited page | warning tile with lock; "Money is for admins and sales"; "Your role is Engineer. Ask an admin if you need to see invoices or receivables." | `NoAccessPage`: no tile, title "Team is not available to your role", "Your role does not include this page. Everything you can use is in the navigation." + Go to Today | DIFFERENT | medium | Rebuild on a warning EmptyState naming the role (U02/U04) |

### Command palette

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-88 | Frame | 640 wide, 96px from top, input 52px/16px, rows 40px, active row selected bg + 3px green edge, "esc" kbd, footer hints, result count, matches semibold | all present (phone `top-4`) | MATCH | - | - |
| A-89 | Idle content | "Recent" (file-text / building-2 / package icons, "Opened 2 hours ago"), then "Actions": New RFQ (N), Capture a message or photo (C), Go to Today (G T) | "Recent" (all rows with the document glyph, APPROVED INVENTORY), "Companies > New company", "Jump to" Today..Reports. No New RFQ, no Capture, no N / C / G T shortcuts (only the gallery scene has them; no global key handler exists) | MISSING | high | Actions source + N/C/G-T keys; per-type recent icons (U08, R05, Capture task) |
| A-90 | Typing results | "Jump to" (RFQs, orders, companies, items) then "Actions" ("New RFQ for Indus Textile Mills"); meta "RFQ · bid due Tue 1 Dec", "Order · goods late" | groups "Companies", "Contacts", "RFQs" then "Add “x” as a new company"; no orders, items, or New-RFQ-for-company | DIFFERENT | medium | Orders/items when O-tasks land; contextual action (R12 follow-up) |
| A-91 | No results / searching | "Nothing found for “belimo gaskets”" + "Search covers RFQs, orders, companies and items. Try one word, or press N to start an RFQ."; skeleton after 200 ms | heading same; hint "Search finds companies, contacts (name, phone, e-mail), RFQ numbers and customer references, and the places you can open from here."; skeleton after 200 ms | DIFFERENT | low | Use the mockup sentence once N exists (R12) |

## 5. Components (`src/ui`, `/dev/gallery`) vs g2-components.html

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| A-92 | Buttons | 4 variants x 6 states, sizes 40/32/28, icon-only | `Button` (plus touch 44) | MATCH | - | - |
| A-93 | Inputs | text, select, textarea, numeric mono with suffix, invalid/disabled/read-only | `TextField`, `NumberInput`, `Select`, `TextArea` | MATCH | - | - |
| A-94 | Checkbox, Radio, RadioCard, Toggle | as sheet | built | MATCH | - | - |
| A-95 | Combobox | open list with meta, "Add “Ind” as a new company" row | `Combobox createLabel` | MATCH | - | - |
| A-96 | Banner | info/warning/danger/success + action | built | MATCH | - | - |
| A-97 | Tabs, breadcrumb, skeleton | underline tabs with count pill, crumb, skeleton | built | MATCH | - | - |
| A-98 | Progress | continuous bar "3 of 5 items covered" and separate segments | only `ProgressSegments` (segments + "n of m") | DIFFERENT | low | Add the plain bar or drop it from the sheet (U05) |
| A-99 | FileDrop / FileRow | resting, drag-over "Release to add 2 files", "3.8 MB → 640 KB", "7.2 MB. The limit is 5 MB." | strings match | MATCH | - | - |
| A-100 | StatusBadge | 20px chip, shape+colour+label, dashed when not firm | built from registry and tokens | MATCH | - | - |
| A-101 | Money, Margin, MoneyFx, NetGstGross | all rows of the Money sheet | built | MATCH | - | - |
| A-102 | "No rate yet" | line "No GBP rate yet" and a separate quiet chip "not compared — no rate" | single line "No GBP rate yet · not compared" | DIFFERENT | low | Add quiet chip (U06) |
| A-103 | "below cost" | 14px medium danger | `text-sm` regular weight | DIFFERENT | low | font-medium (U06) |
| A-104 | Form validation | summary "Fix 2 fields to continue" with links, field messages, unique violation with "Open it", submitting, double-submit guard | `FormSummary`, `Field`, `renderError`, `useSubmitForm` | MATCH | - | - |
| A-105 | Dialog desktop | widths 400/480/640, 36px tile, footer band + lead, Esc/scrim ignored when busy | same | MATCH | - | - |
| A-106 | Dialog phone sheet | grab handle 36x4 | no grab handle | DIFFERENT | low | Add under `max-md` (U03) |
| A-107 | DataTable core | densities, sorted header, selected edge, group rows, totals, touch 48 | built | MATCH | - | - |
| A-108 | Density switch | toolbar "Comfortable / Compact", remembered per person | `density` prop only | MISSING | medium | Toggle + per-user storage (U04) |
| A-109 | DataTable keyboard | ↑↓ J K, Enter, Space, `/` focuses filter, Esc clears, focus remembered after a detail view | all but `/`, Esc, and focus memory | MISSING | medium | Add them (U04) |
| A-110 | Keyboard focus look | 2px green ring inset on the focused row | `focus-visible:bg-sunken` + outline offset | DIFFERENT | low | Verify ring colour/width (U04) |
| A-111 | DataTable footer | "Showing 7 of 7 RFQs" + key legend always | summary slot; legend only with `onRowOpen`/`selection`, hidden below md | DIFFERENT | low | Show whenever rows focusable (U04) |
| A-112 | DataTable loading / error | toolbar "Loading RFQs", skeleton footer; error "Couldn’t load RFQs" / "Your changes are safe. Check your connection and try again." / "Request failed · Fri 27 Nov, 09:41 · reference 4f1c9a" | skeleton rows only; error text supplied by caller; meta "Reference X" | DIFFERENT | low | Default sentence and time stamp (U04) |
| A-113 | Truncation tooltip | long text truncates with ellipsis and tooltip | `truncate` only when `width` set, no tooltip | MISSING | low | Tooltip on truncated cells (U04) |
| A-114 | EmptyState | four cards: goal (solid border, success tile), first use (dashed), no results, role-limited (warning tile, lock icon) | moods goal / neutral / error; no card border, no warning mood | DIFFERENT | medium | Add warning mood + card border (U04) |
| A-115 | Toast | ink, 380px, Undo ring + "10s", bar, pause, settled sentence, errors stay with action, max 3, Cmd+Z | built to spec | MATCH | - | - |
| A-116 | Tooltip | 400 ms, focus instant, 260px, keyboard hint, disabled-why | built (`forDisabled`, `title`, `shortcut`) | MATCH | - | - |
| A-117 | SegmentedControl | 26/32px, icons, counts, tablist/radiogroup | built | MATCH | - | - |
| A-118 | DateRail | six tones (on track, due soon, due today, overdue, done, no date), flips label near the end, "Asked / Bid due" ends | NOT built as a primitive (INVENTORY). Today has a private rail in `features/today/ContextPane.tsx`: warning tone only, chase rules only | MISSING | high | Shared `DateRail` with six states (U05 follow-up, R09, O03) |
| A-119 | StepList | done / now / todo steps | not built | MISSING | medium | With Intake/Order (R05, O03) |
| A-120 | InlineEditRow | resting, editing (3px green edge), saving, error line | not built as a primitive | MISSING | medium | U04 follow-up with RFQ reply row |
| A-121 | Popover menu / information | 32px items, hints, divider; information card | built | MATCH | - | - |
| A-122 | InlineConfirm, Callout, Tag, CountPill, ToggleButton | as sheet | built | MATCH | - | - |
| A-123 | Gallery coverage | one sheet, every state | `/dev/gallery` has all built primitives and dialog/palette/toast/combobox scenes; lacks tooltip variants (disabled-why, long label, status, two-line), toast paused / two-at-once / phone, density switch, and the three unbuilt primitives ("Not built yet" list) | DIFFERENT | low | Add scenes as primitives land (U09) |
| A-124 | Gallery palette scene | idle shows Recent + Actions (N, C, G T) | gallery stubs the Actions source; the app does not (A-89) | DIFFERENT | medium | Fix the app, not the gallery |

## OWNER DECISION needed

- **Q1 (A-45)**: "Copy sign-in message" (WhatsApp text containing the password) is not in the mockup; DECISIONS A04 accepts it as an unlock for Done. Keep or remove?
- **Q2 (A-71, A-77, A-16, A-17)**: The mockup has no self-service Change password; DECISIONS says reset is admin-initiated; `docs/SUPABASE.md` line 146 tells people to use Account menu > Change password. Keep the built page (needs a mockup) or remove it?
- **Q3 (A-16, A-18)**: Settings Exchange rates and the Settings home are in the mockup and BUILD_PLAN (D07/R15) but DECISIONS A06 says "not linked yet". Confirm they ship with R15.
- **Q4 (A-74)**: Money icon: mockups use wallet, DESIGN_SYSTEM section 10 and navConfig use banknote. Which?
- **Q5 (A-67)**: Company profile save bar sticky (built) vs a static card (mockup).
- **Q6 (A-34, A-35, A-36, A-21)**: Phone Team in the mockup is a back bar, 60px tappable rows, bottom sheet. Confirm that is wanted (needs a new MobileBar variant).
- **Q7 (A-41, A-43, A-44, A-47, A-48, A-51, A-53, A-54)**: Approved deviations for visibility: "they/their" wording and grouped password display. No decision unless the owner wants he/she and hyphens back (needs a gender field).

## UNDONE (not built or not matching)

Missing: A-16, A-17 (partly), A-18, A-36, A-59, A-82, A-84, A-85, A-89, A-108, A-109, A-113, A-118, A-119, A-120.
Not matching (DIFFERENT): A-09, A-11, A-14, A-15, A-19, A-21, A-24, A-28, A-30, A-31, A-32, A-33, A-34, A-35, A-37, A-39, A-52, A-54, A-60, A-61, A-66, A-67, A-69, A-74, A-75, A-79, A-87, A-90, A-91, A-98, A-102, A-103, A-106, A-110, A-111, A-112, A-114, A-123, A-124 (plus approved wording items A-41, A-43, A-44, A-47, A-48, A-51, A-53, A-55, A-63).
Extras (not in mockup): A-12, A-13, A-27, A-45, A-70, A-71, A-77, A-78, A-86.

## Top fixes by priority

1. Palette actions source: New RFQ, Capture, Go to, N / C / G-then-T shortcuts, per-type recent icons (A-89, A-90, A-91).
2. Settings Exchange rates page and Settings home, plus the View only tag (A-16, A-17, A-18) with R15.
3. MobileBar back/close/action variants, then the Team phone layout: 60px tappable rows, Deactivated chip, bottom-sheet row actions (A-82, A-34, A-35, A-36).
4. Shared `DateRail` (six states), `StepList`, `InlineEditRow` (A-118, A-119, A-120).
5. Company profile: invalid state + inline messages for legal name and address; flagged blanks in the read-only view (A-59, A-69).
6. DataTable: density toggle, `/` and Esc, focus memory, truncation tooltip, standard error text (A-108, A-109, A-112, A-113).
7. Role-limited EmptyState (warning, lock) and NoAccessPage rebuilt on it (A-114, A-87).
8. Avatar sizes 32/36/40 (A-84); Sign out red; deactivated banner icon; settings nav 220px and bar shape; dim deactivated rows; dialog grab handle; remaining cosmetic items.


---

# UI parity audit, part B (main @ 69aa74d): Today, Intake + float, Chase texts, RFQ board

Evidence: mockups g2-today-b2 / g2-intake-float / g2-chase-texts (HTML read in full), docs/design/screens PNGs, review PNGs r05/r06/r11, source in src/features/{today,rfqs}, DECISIONS.md, BUILD_PLAN.md, INVENTORY.md. Built behaviour is from source (review PNGs may predate fixes). "Dec" = a DECISIONS.md entry covers the deviation (still listed).

## 1. Today (g2-today-b2) at 1440

### 1a. List column, header, groups, rows
| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-01 | Page head | h1 "Today", "Friday 27 November · 9 need you · 3 due now" | same shape, counts bold | MATCH | - | - |
| B-02 | Filter segmented control | "All 9 / Bids 3 / Sourcing 3 / Money 2" | same; engineer gets no Money tab | MATCH | - | engineer has no mockup frame; consistent with Dec R11 |
| B-03 | Group titles + counts | "Overdue or due today 3", "Due in the next 5 days 5", "Ready to move 1" | identical | MATCH | - | - |
| B-04 | Row layout | icon tile, title, mono ref · party, right chip | same grid | MATCH | - | - |
| B-05 | Row due chip wording | "12d late", "today", "1d", "3d", "4d", "5d", "3d old" | "Nd late", "today", "in Nd" (warning <=3), "Nd old" | DIFFERENT | low | Dec "R11 correction" chose "in Nd"; owner to confirm, else drop "in " (R11) |
| B-06 | Bid row title | "Bid due today, 17:00", "Bid due tomorrow, 12:00" | rules.ts dueWords: "Bid due today" / "Bid due tomorrow" (no times) | DIFFERENT | low | Dec R11 (no clock times). O-1 |
| B-07 | Relay-answers icon | `reply` arrow | lucide Undo2 | DIFFERENT | low | swap icon (R11) |
| B-08 | Other row icons | banknote, file-check, truck, send, message-circle-question, share-2, shopping-cart | same | MATCH | - | - |
| B-09 | Row on mobile | trailing chevron on each row | none | MISSING | low | add chevron at 375 (R11) |
| B-10 | "Copied" row state | frame 2: row unchanged, nothing moved yet | due chip replaced by green "Copied" pill until undo closes | EXTRA | low | Dec R11. O-2 |
| B-11 | Top-bar counts | "Today 9, RFQs 14, Orders 7, Money 3" | AppShell `counts` prop never passed | FIXED 1e18a24 | medium | Dec R11 "not wired". Wire counts (shell/R11) |
| B-12 | Collision line | not drawn in b2 (INVENTORY, BUILD_PLAN R11/D02 name it) | not built | MISSING | low | O-3 |

### 1b. Waiting group
| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-13 | Header | chevron + "Waiting" + count; note "comes back when its date arrives" / collapsed "next nudge Mon 30 Nov" | same strings | MATCH | - | - |
| B-14 | Collapse rule | >5 collapsed and user can open; toggle live at 5 too | toggle `disabled` at <=5; session memory kept | DIFFERENT | low | allow collapsing at <=5 (R16) |
| B-15 | Waiting row | "Customer chased"/"Supplier chased", ref · party, "chased 2 days ago · next nudge on Mon 30 Nov", dimmed, no right chip | same text; dim via bg-sunken + muted | MATCH | - | - |
| B-16 | New item highlight | first in its date, "chased just now", r-new style | sorted by date, "chased just now", no highlight | DIFFERENT | low | R16 |
| B-17 | Payment/goods waiting titles | none | "Payment reminded", "Supplier chased for goods" | EXTRA | low | - |

### 1c. Context pane: draft state
| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-18 | Crumb, h2, sub-line | "Today > RFQ-0177", h2, "Indus Textile Mills — Faisalabad · customer ref RFQ #74037" | crumb ok; sub-line adds "RFQ-0001 · " in front | DIFFERENT | low | drop repeated ref (R16) |
| B-19 | Status chips | Waiting on customer / Due soon / Partly covered; "· asked ×2" after chase | StatusBadges, no "asked ×N" | DIFFERENT | low | R16 |
| B-20 | Situation cells (4, with icons) | Unanswered 2; Asked customer 6 days ago Sat 21 Nov; Bid due in 4 days Tue 1 Dec; Waiting: Endress+Hauser via ABC Traders | same grid, no icons; 4th is "Asked so far ×N" | DIFFERENT | medium | Dec R11. Add icons; O-4 |
| B-21 | Date rail | "Today · Fri 27 Nov", "Asked Sat 21 Nov" / "Bid due Tue 1 Dec" | same | MATCH | - | - |
| B-22 | "Prepared for you" sub-text | "Written from the two open questions. Edit anything before you send." | "Written from what is on record. Edit anything before you send." | DIFFERENT | low | R16 |
| B-23 | Channel switch | WhatsApp / Email | same | MATCH | - | - |
| B-24 | Recipient row | WhatsApp: phone icon, "To Mr. Tariq Mehmood", mono phone. Email: mail icon, address shown | always phone icon; "To {name}" or "No contact on record"; phone only; email never shown (contacts.email exists, api.ts selects only name, phone) | DIFFERENT | medium | select contacts.email, show on Email tab (R16) |
| B-25 | Salutation | "Assalam o Alaikum Mr. Tariq," | full stored name ("Assalam o Alaikum Tariq Mehmood,") | DIFFERENT | medium | O-5 |
| B-26 | Email subject | separate "Subject" row + "Copy subject" button | "Subject: ..." line inside the text; no Copy subject | DIFFERENT | medium | R16 |
| B-27 | Draft text styling | *…* markers faint, keywords bold | plain pre, asterisks plain | DIFFERENT | low | R16 |
| B-28 | Draft body detail | "your RFQ *#74037* (flow meters, Faisalabad plant)", "(item 2)", "(items 2 and 3)" | no parenthetical, no item tags | MISSING | medium | Dec R09/R11 (generator never invents; no item link). O-6 |
| B-29 | Email sign-off | "Sales, Q-Tech Solutions, +92 300 555 0188" | job title yes, phone no | DIFFERENT | low | Dec R07. O-7 |
| B-30 | Action footer | [Copy message and mark chased] [Open RFQ-0177] ... [Snooze, alarm-clock-off icon] | same labels; BellOff icon | MATCH | - | icon low |
| B-31 | Snooze menu | "Tomorrow morning · Sat 28", "Monday · Mon 30 Nov", "Pick a date >" | "Tomorrow, Sat 28 Nov", "Monday, Mon 30 Nov", "Pick a date" (dialog "Snooze until") | DIFFERENT | low | R11 |
| B-32 | Footnote under actions | none in draft state | "Copying records a chase today (asked ×2). Asks for a reply by Wed 28 Oct." plus firm note | EXTRA | low | cf. B-74 |
| B-33 | One-tap copy + stamp | one tap | one tap | MATCH | - | - |
| B-34 | Open questions card | numbered, "asked 21 Nov · no reply" | same | MATCH | - | - |
| B-35 | "What happened" | 17 Nov received; 19 Nov Floated to 3 suppliers; 21 Nov 2 questions sent; 27 Nov Not chased yet | no "Floated to N suppliers" event; adds "Customer asked again" | MISSING | low | R16 |

### 1d. Copied (frame 2) and Just chased (frame 3)
| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-36 | Copied bar | green bar "Copied. Paste it into WhatsApp." replaces header/tabs | same strip but header and tabs remain | DIFFERENT | low | R16 |
| B-37 | Copied footer | "Chased today. Moves to Waiting when the undo closes." + Open | disabled "Marked chased today" + footnote | DIFFERENT | low | R16 |
| B-38 | Undo toast | "Copied. RFQ-0177 marked chased." ring "Undo 7s" | same wording, ring, 10s, Cmd/Ctrl+Z | MATCH | - | - |
| B-39 | Just-chased title | h2 stays "Chase customer for clarifications" | h2 becomes "Customer chased" | DIFFERENT | medium | R16 |
| B-40 | Note bar | "Moved to Waiting. It comes back to your list on Mon 30 Nov, or sooner if the customer replies." + "Next: RFQ-0184" | info Banner "chased just now · next nudge on …" / "It is in Waiting and returns to the list on that day. You can still copy the message again." | DIFFERENT | medium | R16 |
| B-41 | Cells after chase | "Chased customer Today Fri 27 Nov · asked ×2"; "Next nudge Mon 30 Nov · short wait: bid is close" | unchanged cells | MISSING | medium | R16 |
| B-42 | Rail after chase | extra "Next nudge · Mon 30 Nov" marker | none | MISSING | medium | R16 |
| B-43 | "Chased today" card | "Chased today", "WhatsApp to Mr. Tariq Mehmood, copied at 14:32. Asked ×2 now.", stamp "In Waiting", message excerpt, [Open RFQ-0177] [Chase again now], "A third ask suggests closing as no reply." | full draft and big "Copy message and mark chased" still shown for a waiting item | DIFFERENT | high | R16 |
| B-44 | "Chase again now" | present | absent | MISSING | high | R16 |
| B-45 | Open questions / history after chase | "asked 21 Nov · chased 27 Nov · no reply"; "27 Nov Chased customer, asked ×2"; "30 Nov Next nudge if no reply" | plain "asked … · no reply"; "Chased {n days ago}"; no next-nudge line | MISSING | low | R16 |
| B-46 | Header counts after chase | 8 need you, All 8, Bids 2 | Waiting excluded from counts | MATCH | - | - |

### 1e. Target tile
| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-50 | Head | "Your Q4 target" + "PKR 330,000 behind pace" (clock-alert, warning) / "PKR 320,000 ahead of pace" (circle-check) | same; plus "On pace" state | MATCH | - | - |
| B-51 | Figures | "PKR 3,450,000 of PKR 6,000,000" | same | MATCH | - | - |
| B-52 | Pace label | "on pace PKR 3.78M" | "on pace 3.78M" (millions() omits PKR) | DIFFERENT | low | R11 |
| B-53 | Bar | green fill, hatched shortfall, black marker | green fill, solid warning-tinted gap with borders, marker | DIFFERENT | low | R11 |
| B-54 | Day line + working | "Day 58 of 92 v · 34 days left" opens the dl and foot note | identical rows and foot note; extra "N payments are not counted yet (basis unknown)" when relevant | MATCH | - | extra sentence EXTRA low |
| B-55 | No-target state | "No target set for Q4 / Ask an admin to set one on the Team screen. Nothing else on Today depends on it." | same | MATCH | - | - |
| B-56 | Placement + exact on hover | foot of list; hover carries exact values | same (title attrs) | MATCH | - | - |
| B-57 | Tile loading/error | n/a | skeleton; "Your target could not be read. Try again" | EXTRA | low | - |

### 1f. Mobile 375
| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-58 | Top of page | app bar title "Today"; no second heading | page draws its own big h1 "Today" under the app bar (visible in r11 mobile PNG) | DIFFERENT | medium | R11 |
| B-59 | Date line | "Friday 27 November · 9 need you, 3 due now" | middle-dot form | DIFFERENT | low | - |
| B-60 | Tile | boxed compact card, then filter tabs, then groups | flat strip above the header | DIFFERENT | low | R11 |
| B-61 | Accordion content | 2x2 situation grid (short labels), rail ("Today", "Sat 21 Nov"/"Tue 1 Dec"), prep with tabs, clipped message + "Show full message" | full desktop pane (h2, chips, facts, rail, draft) | DIFFERENT | medium | R11 |
| B-62 | Mobile actions | full-width [Copy and mark chased] + icon-only snooze, 44px | "Copy message and mark chased", "Open RFQ-…", "Snooze" text buttons | DIFFERENT | medium | R11 |
| B-63 | Mobile copied | green bar, disabled "Marked chased today", toast | same | MATCH | - | - |
| B-64 | Mobile just-chased | Waiting collapsed (>5) | same rule | MATCH | - | - |
| B-65 | Loading / error / goal-empty | no b2 frame (INVENTORY lists them) | skeleton, "Today could not load", "Nothing needs you today" | MATCH | - | - |
| B-66 | Non-chase rows | no b2 frame | howTo sentence + primary Open button | EXTRA | low | - |

## 2. Intake + float (g2-intake-float)
| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-100 | Page head | crumb "RFQs > New RFQ", h2, lede "Paste what the customer sent. Nothing is saved until you continue." | same crumb/h1; "...until you copy the enquiry or save." | DIFFERENT | low | Dec R05. O-8 |
| B-101 | Company field | search icon, "Search, or type a new company name", focused | Combobox autoFocus, same placeholder | MATCH | - | - |
| B-102 | Option meta | "Mianwali · customer · 2 RFQs · similar name" | "customer · Pakistan" (role · country) | FIXED 416637d | medium | add RFQ count + similar-name flag (R05) |
| B-103 | Add-new row | "Add “X” as a new company" + "Saved as a prospect until the first order" + ⏎ | label + plus icon only | FIXED 416637d | low | R05 |
| B-104 | Inline create | in-page row: Company name, City, Contact, [Create and use][Cancel], "City and contact can wait..." | modal "New company": Company name, Country; [Cancel][Add company] | FIXED 416637d | medium | Dec R02. O-9 |
| B-105 | Items zone before company | faded until company chosen | heading greyed only | FIXED 416637d | low | R05 |
| B-106 | Paste zone | clipboard icon, "Paste the customer's email or item list", "Press Ctrl V anywhere on this page. Each line becomes an item, with quantity and brand picked out." | same copy; real textarea with extra placeholder; "Add an item by hand" | MATCH | - | extras EXTRA low |
| B-107 | Customer chip | avatar MP, name, "Mianwali · contact not added yet", "New prospect", [Change] | Avatar, name, "No country on file", role badge, [Change] | FIXED 416637d | low | Dec R05 (no city) |
| B-108 | Site / Contact selects | absent | Site and Contact selects, "Only site on file" | EXTRA | low | Dec R05 |
| B-109 | Pasted panel | "Pasted just now · 6 lines", chip "4 items found", mark highlight, skipped lines tinted | same | MATCH | - | - |
| B-110 | Item grid | columns "# / Qty / Description / Brand / Family", qty "2 nos", brand chip with check or "no brand", family text; footer "4 items found in 6 lines. Edit any cell to fix a split." + Add item | columns "# / Qty / Unit / Description, brand and family" as input fields with brand/family Selects on a second row, remove X; same footer text | FIXED 416637d | medium | R05 |
| B-111 | Bid due / Customer ref | "Bid due (optional)" "Thu 3 Dec" with calendar icon; "Customer reference (optional)" "Their RFQ number" | same labels, DateInput "e.g. 3 dec", same placeholder | MATCH | - | - |
| B-112 | Top priority | absent | checkbox "Top priority" | EXTRA | low | Dec R05 |
| B-113 | Bottom bar, step 1 | "Creates RFQ-0185 for X with 4 items." [Looks right: find suppliers >] | "Saves as a new RFQ for X with N items." + [Save without floating] + [Looks right: find suppliers >] (sticky) | FIXED 416637d | low | Dec R05 |
| B-114 | Side card | Number RFQ-0185, Customer, Items, Bid due, Sourcing chip | same rows; Number "Given when saved" | DIFFERENT | low | Dec R05 |
| B-115 | Progress list | Customer/Items/Suppliers (n)/Enquiry (date) | same; hidden below lg | MATCH | - | - |
| B-116 | Step 4 item chips | "1 Endress+Hauser Proline... × 2" truncated | same | MATCH | - | - |
| B-117 | Supplier groups/rows | 3 groups with counts; checkbox, name, city, pill "2 same model", reason, memory line, Memory v | same; shows country not city | FIXED 416637d | low | Dec R05 |
| B-118 | Tick rules + order footnote | only first group ticked; "Order follows the reason, then the most recent contact. What we know about a supplier never changes the order." | same | MATCH | - | - |
| B-119 | Step 4 bar | "3 suppliers ticked", warning "Item 4, the actuator, has no supplier ticked." with triangle icon, [Back to items][Write the enquiry >] | no icon; "Item 4, <description>, has no supplier ticked."; + [Save without floating] | FIXED 416637d | low | R05 |
| B-120 | "Ask someone who is not listed" | absent | combobox for any company | EXTRA | low | Dec R05 |
| B-121 | Supplier loading/error/empty | not drawn | skeleton; "Suggestions did not load"; "No supplier on file for these items yet" | EXTRA | low | - |
| B-122 | Enquiry hint | info-style "Spec lines are blank on purpose. Type what the customer gave you under any item, or leave it. The app never writes a spec for you, and a blank one is fine to send." | same text in warning-tone Banner | FIXED 416637d | low | R05 |
| B-123 | Enquiry card | "Enquiry to 3 suppliers / One text for all three. Each supplier skips what they cannot offer." channel tabs, "Send to" chips with x | same | MATCH | - | - |
| B-124 | Spec blanks | "Spec: [left blank]" highlighted pill | plain "Spec: left blank" in an editable textarea | FIXED 416637d | medium | R05 |
| B-125 | WhatsApp enquiry body | greeting, "Please quote your best price, availability and lead time for the following (our ref *RFQ-0185*):", items+Spec, "Kindly reply by *Tuesday 1 December*. If you cannot offer an item...", Thank you., Regards | adds "Please include in your reply: - Unit price and currency - Lead time - Origin and authenticity... - Stock position - MOQ, offer validity and payment terms"; ref is RFQ-#### until copy (Dec R05) | DIFFERENT | medium | BUILD_PLAN R04 requires the asks. O-10 |
| B-126 | Draft editable | static | editable textarea | EXTRA | low | - |
| B-127 | Footer | [Copy & mark floated to 3] [Back to suppliers] … "You paste it into each supplier's chat." | same + [Save without floating]; sentence sits under the textarea | FIXED 416637d | low | R05 |
| B-128 | Floated panel | "Floated to 3 suppliers on Fri 27 Nov", "RFQ-0185 is out for prices", clipboard line, reply-by + bid-due rows, info "Item 4 has no supplier yet. … Float item 4 to them" (link), [Open RFQ-0185][Start another RFQ] | same panel and copy; no "Float item 4 to them" link; adds copy-failed fallback and "No bid due date…" | FIXED 416637d | medium | link to float the item (R05) |
| B-129 | Float toast | "Floated to 3. Copied, and RFQ-0185 marked floated." Undo | same, 10 s, settled/undone texts | MATCH | - | - |
| B-130 | After undo | not drawn | "Float undone" banner and back to enquiry | EXTRA | low | Dec R05 |
| B-131 | Mobile 375 | no intake 375 frame in mockup | single column, sticky bar, side panels hidden | MISSING | low | no mockup |

### 2b. Memory card states (frame 7)
| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-140 | Card header | "What we know about X", "For item 3, ... Matched on brand and description.", tier tag | same | MATCH | - | - |
| B-141 | Cells | Last quoted, Last ordered, "Lead time and stock", Brands carried, Replies, Orders and deliveries / Last contact | same but "Lead time" only | DIFFERENT | low | Dec R17 (no stock) |
| B-142 | Price cell | "USD 412 each ≈ PKR 114,700 at the time · 3 Oct · qty 4" | same plus " (rate N)" | DIFFERENT | low | - |
| B-143 | Old / hidden / thin / no-history | age first; eye-off "Price on file"; "None on file", "Never contacted" | same logic and strings | MATCH | - | - |
| B-144 | "Imported" tag | footnote only | dashed "Imported" tag on prices | EXTRA | low | Dec R17 |

## 3. Chase texts (g2-chase-texts) and where they surface
Surfaces: (a) Today pane (chaseDraft.ts → generateCustomerChase / generateSupplierChase / goods / payment); (b) RFQ detail Supplier replies ("Preview text", "Copy & mark chased", SupplierReplies.tsx, generateSupplierChase); (c) RFQ detail Clarifications panel ("Copy questions for customer", "Copy chase text") which uses a different generator, generateCustomerAsk (lib/clarifications.ts).

| ID | element | mockup | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-70 | Panel framing + context chips | standalone panel with chip "Waiting on customer", "2 open questions · asked 21 Nov · bid due Tue 1 Dec" | lives in Today pane (facts grid) | DIFFERENT | low | see B-18..B-21 |
| B-71 | Customer: question tick list + editable date | "Questions in this message / Untick to leave one out"; "Kindly confirm by [Mon 30 Nov] One working day before the bid is due. You can change it." | none; text editable only in the pasted copy; date computed | MISSING | high | Dec R09/R11. O-6 |
| B-72 | Supplier: item tick list + date | "Items still without a price from this supplier", priced item greyed, "Reply by [Tue 1 Dec] Two working days before our bid. You can change it." | none | MISSING | high | Dec R07 note. R07/R16 |
| B-73 | Recipient row | "WhatsApp to Mr. Tariq Mehmood +92…" / "Email to … procurement@…" | "To {name}" + phone in Today only; none on RFQ page | DIFFERENT | medium | B-24 |
| B-74 | Copy banner | "Copying records a chase today (asked ×2). RFQ-0177 moves to Waiting and returns on Mon 30 Nov." / "Copying records chase 1 for this supplier. RFQ-0179 moves to Waiting and returns if still silent after Mon 30 Nov." (hourglass) | "Copying records a chase today (asked ×2). Asks for a reply by Wed 28 Oct." ; RFQ page: "Copying records a chase today. It lists only the items this supplier has not priced…" | DIFFERENT | medium | use mockup wording + return date (R16) |
| B-75 | Copied inline state | footer "Copied. Marked as chased today." + Undo | Today: toast with Undo; RFQ page chase toasts ("Chase text copied") have no Undo | DIFFERENT | medium | R07/R09 |
| B-76 | Customer first/gentle WhatsApp | "A gentle reminder about your RFQ *#74037* (flow meters, Faisalabad plant). To complete our quotation we still need your confirmation on:" | "A gentle reminder about your RFQ *#x*. To complete…" ; first ask (askCount 0) "To complete our quotation for your RFQ *#x* we need your confirmation on:" | DIFFERENT | low | parenthetical O-6 |
| B-77 | Customer confirm line + close | "Kindly confirm by *Monday 30 November*; our bid is due on Tuesday 1 December." "Thank you for your support." | same | MATCH | - | - |
| B-78 | Customer email | Dear Mr. Tariq / "further to our message of Saturday 21 November" / call offer / "With best regards, … Sales, Q-Tech Solutions, +92…" / subject "RFQ #74037: your confirmation needed by Monday 30 November" | same sentences and subject form; no phone; full contact name; no item tags | DIFFERENT | low | O-5, O-7 |
| B-79 | Customer: bid is close | "…is due *tomorrow, Tuesday 1 December, 12:00*…" ; "Kindly confirm by *5:00 pm today*." | "…due *tomorrow, Tuesday 1 December*…" ; "Kindly confirm by *the end of today*." | DIFFERENT | low | Dec R11. O-1 |
| B-80 | Customer: third ask | "We are writing once more… still open from our messages of 21 and 27 November… If these items are no longer required… Otherwise, kindly confirm by *Thursday 3 December*." | identical sentences | MATCH | - | - |
| B-81 | Firm (>30 days) wording | not in mockup | firm text in all generators | EXTRA | low | Dec 2026-10-14 |
| B-82 | Supplier chase 1st/2nd, WhatsApp + email | "Following up on our enquiry of *Monday 23 November* (ref *RFQ-0179*). Thank you for pricing item 1…", "A second reminder on…", "Could you please reply by *Tuesday 1 December*?…", subject "RFQ-0179: price needed for 2 items by Tuesday 1 December" | same, line for line (supplierChase.ts) | MATCH | - | - |
| B-83 | Signature on RFQ page | "Sales, Q-Tech Solutions" | SupplierReplies and ClarificationsPanel pass {name, company} without jobTitle, so email omits "Sales," (Today passes data.jobTitle) | DIFFERENT | medium | R07/R09 |
| B-84 | Two customer generators | one wording set | Clarifications panel generateCustomerAsk has only first/repeat; no bid-close, third-ask or firm text; its first-ask sentence differs ("Thank you for your RFQ… we need your confirmation") | DIFFERENT | high | route through generateCustomerChase (R09/R16) |
| B-85 | Customer ref format | "#74037" | `#`+ref; a stored "RFQ #74037" would read "#RFQ #74037" | DIFFERENT | low | R16 |
| B-86 | Customer escalation | "3 chases, no answer / This is a suggestion. Nothing is closed for you. [Close as no reply][Keep waiting] / Closing asks for a reason, pre-filled with “No reply from customer”." | same title and lead; closes in one tap with reason no_reply_to_clarification + Undo; says "Closing records the reason “No reply to our questions”." | DIFFERENT | low | Dec R11 |
| B-87 | Supplier escalation | "Chased twice, no reply from Metro Process Controls / Float items 2 and 3 to someone else? Next in line, by reason:" list with memory lines; [Choose suppliers for items 2 and 3][Chase again] | same title; "Float these items to someone else? Nothing is changed until you choose."; no list; [Choose another supplier][Chase again] | MISSING | high | Dec R11. R16/R17 |
| B-88 | Goods / payment texts | no frame (payment in g2-money) | generators exist | EXTRA | low | money part |

## 4. RFQ board (/rfqs)
No dedicated mockup exists (BUILD_PLAN line 464: RFQ board is "composed from DESIGN_SYSTEM.md and the nearest approved mockup"; INVENTORY has no board section). Nearest: g2-components "DataTable" board (screens/components-06-datatable.png), which draws an RFQ table; DESIGN_SYSTEM.md lines 125-126 define the chips. BUILD_PLAN R06 says "state columns from v_rfq_state" but Dec R06 built a table with filters.

| ID | element | approved design | built | status | sev | fix / task |
|---|---|---|---|---|---|---|
| B-150 | Dedicated mockup | none | composed from DataTable | n/a | - | O-11 |
| B-151 | Page head | not drawn | "RFQs", "7 open, 2 overdue. Earliest due date first, priority RFQs ahead of the rest.", [+ New RFQ] | EXTRA | low | - |
| B-152 | Open / Closed switch | "Open 6 | Closed 1" segmented | Tabs "Open 7", "Closed and won 27" | FIXED 1e18a24 | low | - |
| B-153 | Filter box | "Filter RFQs" (search icon, `/` focuses, Esc clears) | none | FIXED 1e18a24 | medium | R06 |
| B-154 | Density toggle | Comfortable / Compact | none | FIXED 1e18a24 | low | R06/U04 |
| B-155 | Columns | RFQ number, Customer, Items count, Bid due (with time), Sourcing, Status, Value (PKR net) | Company (+ "RFQ-0001 · their ref X"), Due (date + "3 days overdue"), Sourcing (+ "N uncovered"), Questions, Bid, Owner | DIFFERENT | medium | no Items or Value column; O-11 |
| B-156 | Sourcing chips | Covered / Partly covered / Awaiting offers / Not floated / No offer anywhere | registry chips with "1 of 2" detail | MATCH | - | - |
| B-157 | Owner + state filters | not drawn | Mine/All and 5 sourcing segments with counts, kept in the URL | EXTRA | low | Dec R06 |
| B-158 | Sort + footer | sortable headers; "Showing 7 of 7 RFQs" + move/open hints | Company/Due/Owner sortable; "Showing 7 of 7 open RFQs" + hints | MATCH | - | - |
| B-159 | Priority flag | not drawn | flag icon by company | EXTRA | low | - |
| B-160 | Goal empty | "Every bid is in. Nothing is open and nothing is due in the next 5 days. New RFQs appear here as soon as you start one." [New RFQ][Capture a message] | "No open RFQs. Nice." + [New RFQ] | FIXED 1e18a24 | low | R06 |
| B-161 | No-match empty | 'No RFQs match “Belimo”… [Clear filter]' | "No RFQs in this view… [Show all open RFQs]" | FIXED 1e18a24 | low | with B-153 |
| B-162 | Loading / error | skeleton; "Couldn't load RFQs", "Your changes are safe…", Try again, "Request failed · date · reference 4f1c9a" | skeleton; "Couldn't load the RFQs", "Nothing was changed…", retry; no reference line | FIXED 1e18a24 | low | R06 |
| B-163 | Mobile 375 | touch rows 48px | cards (company, ref, due, chips, owner) | MATCH | - | no frame |
| B-164 | Nav count "RFQs 14" | top bar | not wired | FIXED 1e18a24 | medium | = B-11 |

## OWNER DECISION needed
- O-1 (B-06, B-79): mockup shows clock times ("Bid due today, 17:00", "12:00", "5:00 pm today"); data has a due date only (Dec R11). Add a due time or accept dates only?
- O-2 (B-10): Dec R11 marks the row "Copied"; mockup frame 2 leaves it unchanged. Keep?
- O-3 (B-12): collision line is in BUILD_PLAN R11/D02 and INVENTORY but not drawn in g2-today-b2. Does it exist?
- O-4 (B-20): 4th figure "Waiting: Endress+Hauser via ABC Traders" (needs the supplier brand/agent behind a question) vs built "Asked so far ×N" (Dec R11). Keep?
- O-5 (B-25, B-78): "Mr. Tariq" needs a title/short-name field; contacts have one name. Add one or accept full names?
- O-6 (B-28, B-71, B-76): item tags "(item 2)", the "(flow meters, Faisalabad plant)" context, the untick list and editable confirm-by date. Dec R09/R11: no item link in `clarifications`, generator never invents. Add the item link (migration) and controls, or accept?
- O-7 (B-29, B-78): email phone line needs users.phone.
- O-8 (B-100): "Nothing is saved until you continue" vs saved on copy/save.
- O-9 (B-104): create company inline with City + Contact (mockup) vs shared modal with Country (Dec R02).
- O-10 (B-125): BUILD_PLAN R04 requires the "please include in your reply" asks; mockup enquiry has none.
- O-11 (B-150..B-155): board has no mockup; BUILD_PLAN R06 says "state columns", built is table + filters. Approve the column set (Items, Value, Owner, Questions, Bid).

## UNDONE (not built or not matching; no decision blocks it)
B-07, B-09, B-11, B-14, B-16, B-18, B-19, B-22, B-24, B-26, B-27, B-31, B-35, B-36, B-37, B-39..B-45, B-52, B-53, B-58, B-61, B-62, B-73, B-74, B-75, B-83, B-84, B-85, B-87, B-102, B-103, B-105, B-107, B-110, B-119, B-122, B-124, B-127, B-128, B-153, B-154, B-160..B-162, B-164.

## Top fixes by priority
1. Waiting / just-chased pane (B-39..B-45): keep title, "Moved to Waiting" bar with "Next: ref", switched cells, rail nudge marker, compact "Chased today" card, "Chase again now" (R16).
2. Unify customer chase: Clarifications panel must use generateCustomerChase (B-84); pass job title in RFQ-page signatures (B-83).
3. Supplier escalation next-in-line list (B-87); copy banners with return date (B-74); Undo on RFQ-page chase toasts (B-75).
4. Chase panel controls (B-71, B-72) once O-6 is decided.
5. Email recipient address and Subject row with Copy subject (B-24, B-26, B-73).
6. Intake: item grid layout (B-110), highlighted blank Spec (B-124), "Float item N to them" link (B-128), option meta + similar-name flag (B-102), inline create (B-104).
7. Today mobile: drop duplicate title, trim accordion, compact actions, chevrons (B-58, B-61, B-62, B-09).
8. Nav counts (B-11/B-164); board filter box, density, Items/Value columns, empty/error copy (B-153..B-162).
9. Cosmetic: hatched bar, "PKR" on pace label, snooze labels, relay icon, "asked ×N" chip detail, due-chip wording.


---

# Part C: RFQ detail and Quotation PDF parity audit

Worktree audited: main @ 69aa74d (`$WT`). Evidence: `docs/design/mockups/g2-rfq-detail.html`, `g2-quotation-pdf.html`, `docs/design/screens/rfq-detail-*.png`, `quotation-pdf-*.png`, committed reviews `docs/design/review/r07`, `r09-r10`, `r17-r18`, `r19`, and source in `src/features/rfqs`, `src/features/quotations`. DECISIONS.md entries referenced: **D-R07** (2026-10-14 R07 entry), **D-R07b** (migration 0032 can't-quote), **D-R08**, **D-R09/10** (2026-10-14 R09, R10), **D-R17** (2026-10-15 R17/R18), **D-R19** (2026-10-15 R19), **D-GATE2-Q4** (bank details only if filled), **D-A06** (profile has no required field; legal name/address block only the PDF). Review PNGs were read as committed; source is ground truth for what is built. The built PDF was judged from the r19 PNGs plus `QuotationDocument.tsx`.

Note on mockup content: the mockup has NO separate "Files/attachments panel" (only photo thumbnails inside answered questions) and NO paste-to-parse control (only the per-item "Add reply" box). Both are built extras (C-52, C-45).

## 1. RFQ detail, page structure and header block (1440)

| ID | element | mockup (what it shows) | built (what it shows) | status | severity | suggested fix + BUILD_PLAN task |
|---|---|---|---|---|---|---|
| C-01 | Page frame | Top nav, crumb `RFQs > RFQ-0177`, 1280 board; left column (Items panel, Quotations panel) + right rail (Suppliers asked, Questions for the customer) | Same shell and crumb. Grid `minmax(0,1fr) 340px` | MATCH | - | - |
| C-02 | Column layout / panel order | Left: "Items and supplier replies" then "Quotations". Right rail: "Suppliers asked", "Questions for the customer" | Left: "Supplier replies" panel, then "Items and prices" panel. Right rail: "Questions for the customer", "Quotations", "Files" | DIFFERENT | high | Re-flow to mockup order: one Items panel (replies under each item), Quotations table in left column below it, Suppliers asked + Questions in rail. D-R07 accepted the split ("reply rows live in their own Supplier replies panel above the per-item comparison"; rail holds the slots). R07 rework / R19 for Quotations placement |
| C-03 | H1 | `RFQ-0177` (mono) + `Indus Textile Mills` | `{ref}` mono + `rfq.company.name` | MATCH | - | Mockup uses short name in H1 and "Indus Textile Mills Ltd" in the Company cell; data-driven, built shows the one stored name in both |
| C-04 | State chips, set | Open, Partly covered, "Waiting on customer, 2", "Answers to relay, 1", "Bid sent Thu 26 Nov", "Due soon" | StatusBadge rfq-outcome, sourcing, clarification (count detail), bid (+ date), deadline | MATCH | - | - |
| C-05 | Deadline chip wording | "Due soon" (populated) / "Due in 7 days" (empty) / "Due in 4 days" (mobile) | `Due soon` with detail `{n} d` or `today` (e.g. "Due soon 4 d") | DIFFERENT | low | Make the chip read "Due in N days". R07 polish |
| C-06 | Extra chip | none | "Top priority" chip when `is_priority` | EXTRA | low | Keep; owner to confirm. R07 |
| C-07 | Header actions | Two buttons: `Issue quotation` (label constant, file-plus icon) and a `Bid and close` dropdown | Three buttons: `Issue quotation`/`Issue R{n+1}` (label changes), primary green `Mark bid sent`, `Close or lose`; `Reopen` when closed | DIFFERENT | medium | Fold Mark bid sent / Sent again / Close reasons into one "Bid and close" menu; keep header label "Issue quotation". R07 |
| C-08 | "Bid and close" menu contents | `Mark bid sent` (hint "no PDF"), `Sent the offer again` (hint "updates date"), rule, note "Close RFQ because", 7 one-tap reasons: The customer chose a competitor, Price too high, No reply to our questions, The customer cancelled, We could not source it, We were too late, Another reason | Separate `Mark bid sent` button (hidden once bid is sent, so "Sent the offer again" does not exist); `Close or lose` opens a Dialog with radios of the same 7 labels pre-filled from state, optional Note, `Close RFQ` | DIFFERENT | medium | "Sent the offer again" (re-stamp quoted_on) is MISSING. Reason labels MATCH. Dialog is 2 taps like the menu and adds a default reason (D-R07); owner to accept or switch to menu. R07 |
| C-09 | Mark bid sent hint | Menu sub-label "no PDF" | none | MISSING | low | Add the hint when menu is built. R07 |
| C-10 | Close dialog | Not a dialog in mockup (menu only) | Title `Close or lose this RFQ`, context `RFQ-… · Company`, lead "The reason is filled in from where this RFQ stands. Change it if it is not right.", `Note` optional "Anything worth remembering", `Cancel` / `Close RFQ`; undo toast | EXTRA | low | See C-08. R07 |
| C-11 | Closed state | not shown | line "Closed {day}: {reason}. {note}" + `Reopen` | EXTRA | low | Mockup silent; keep. R07 |
| C-12 | Issue button disabled until supplier prices exist | Empty state: `Issue quotation` disabled (opacity .55) | Enabled whenever the quotations query has loaded | DIFFERENT | low | Disable when no item has a price. R19 |
| C-13 | Meta strip, 6 cells | Customer ref (`RFQ #74037`, sub "Received Mon 16 Nov"), Company (link, sub "Customer since 2023"), Site (name, sub city), Contact (name, sub phone), Bid due (`Tue 1 Dec`, sub "In 4 days", amber), Owner (avatar + name, sub "Sales") | Same six cells and icons. Company sub line absent; Site sub is `site.address`; Owner has no role sub-line | DIFFERENT | low | Add "Customer since {year}" and the owner's role. R07 |
| C-14 | Meta empty values | "None given" muted; "New customer" sub | `None given`, Site/Contact `Not set`, Bid due `No date` | MATCH | - | - |
| C-15 | Loading | Skeleton: crumb, title, 4 chip skels, 2 action skels, 6 meta skels, items panel with item rows, 3 rail cards | `PageSkeleton`: 4 stacked bars + one h-20 block + 2 big blocks; no meta cells, row skeletons or rail cards | DIFFERENT | low | Mirror the layout in the skeleton. R07 |
| C-16 | Error state | Header kept ("Showing the details saved on this device at 09:42. Replies and questions did not load."), `Try again` in header; panel "Supplier replies did not load" with cloud-off icon, "The connection dropped before the replies arrived. Nothing was changed and nothing you typed is lost. Try again, or come back when you are online.", `Last loaded 09:42 today`, `Reference req_5d71c0e3`, `Try again` + `Back to RFQs`; rail cards "Not loaded…" | Header error: whole page replaced by EmptyState "Couldn't load this RFQ" / "Nothing was changed. Check your connection and try again." / `Try again`. Items error: EmptyState "Couldn't load the items and replies" with the same sentence and `Try again`; header stays | DIFFERENT | medium | Missing: cloud-off icon, last-loaded time, request reference, `Back to RFQs`, "Not loaded" rail cards, header "saved on this device". R07 |
| C-17 | Not found | not in mockup | EmptyState "This RFQ isn't here" + `All RFQs` | EXTRA | low | keep |

## 2. Items, replies, comparison (1440)

| ID | element | mockup (what it shows) | built (what it shows) | status | severity | suggested fix + BUILD_PLAN task |
|---|---|---|---|---|---|---|
| C-20 | Items panel title / meta / Add item | "Items and supplier replies"; `4 items · 6 suppliers asked · 3 items have a price`; `Add item` button in header | Two panels: "Supplier replies" meta `{n} of {m} suppliers replied` and "Items and prices" meta `4 items · 6 suppliers asked · 3 with a price`. No `Add item` on the page (ItemsEditor is used only by intake) | MISSING | high | `Add item` on an existing RFQ missing; merge panels and retitle. R07 |
| C-21 | Rate bar | Strip: "Today's rates, PKR per unit", `USD 279.40 auto · today`, `CNY 38.60 auto · 3 days ago`, stale `EUR 305.20 auto · 12 days ago, stale` (amber), `AED no rate, not compared` / `no current rate · add one below`, link "Exchange rates" | Not built (the string "Exchange rates" exists only in query keys) | MISSING | high | Build the rate bar from `v_fx_latest`, link to Settings > Exchange rates. R15 (D-R07: inline rate prompt not built) |
| C-22 | Item header | Number box, description, meta `2 pcs · Endress+Hauser · Pressure` (qty, brand, family), coverage chip, `Add reply` button | Number box, description, `2 pcs` + brand Tag, coverage chip. No family; no `Add reply` | DIFFERENT | medium | Add family; per-item Add reply (C-39). R07 |
| C-23 | Coverage chip | `Covered, 3 prices` / `Partly covered, 1 price` / `Uncovered item` / `No replies yet` | `Covered, N prices` / `Uncovered item` / `No prices yet`; a single priced item reads "Covered, 1 price", never "Partly covered" | DIFFERENT | medium | Define the "partly" rule and match mockup. Owner decision. R07 |
| C-24 | Column header row | `Supplier | Price | In PKR at today's rate | Lead time | Stock | (menu)` under every item | Same 5 labels at md and up; no actions column | MATCH | - | - |
| C-25 | Supplier descriptor | Name bold + sub `China stock · factory certificate` / `Karachi · agent for Endress+Hauser` | Name only | DIFFERENT | low | No data source for the descriptor. Owner decision. R07 |
| C-26 | Price cell | `CNY 2,980.00` (code muted, mono amount) | Same pattern | MATCH | - | - |
| C-27 | PKR cell, normal | `Lowest` chip + `≈ PKR 115,028` + sub `rate from 3 days ago` (clock) or `USD 279.40, today's rate`, `PKR, no conversion` | Lowest chip + `≈ PKR n`, sub `{CUR} {rate}, rate from N days ago` / `…today's rate`, `PKR, no conversion` | MATCH | - | Built adds the rate value to the "from N days ago" form; trivial |
| C-28 | PKR cell, stale | `rate 12 days old` amber with triangle | `{CUR} {rate}, rate 12 days old` amber triangle | MATCH | - | - |
| C-29 | PKR cell, no rate | `—` plus quiet chip `not compared — no rate` | quiet chip `not compared — no rate` (and `not compared — rate too old` when unusable); no `—` dash | MATCH | - | Extra "rate too old" wording extends the >30 day band |
| C-30 | Rate captured at entry | not shown on live rows | Extra line `At entry {rate} · {day}` + staleness badge, or "fx-capture none" badge | EXTRA | low | D-R07 accepted. Owner may drop. R07 |
| C-31 | Lowest mark logic | Only when >=2 comparable | `comparePrices`; rows sorted cheapest first then uncompared (mockup keeps entry order) | MATCH | - | - |
| C-32 | Lead time / Stock | text; stock dot + `In stock` / `Not in stock` | Same; `—` when unknown | MATCH | - | - |
| C-33 | Row "..." menu | `More for {supplier}`: `Edit reply`, `Copy price`, rule, `Remove reply` | None. Edit is in the Supplier replies form; remove = clear the price | MISSING | high | Add row menu. R07 |
| C-34 | Last price chip (rep-sub) | `Last price for this item: USD 412 ≈ PKR 114,700 at the time · Mar 2026 · same model` (history icon) | Same chip (R17), plus "(rate …)", `ordered/quoted` verb, age mark, `Imported` tag, hidden-price variant | MATCH | - | D-R17 |
| C-35 | Comparison footnote | `Lowest of the 3 with a rate. Compared in PKR at today's rates.` / `Lowest of the 2 with a rate. The AED line is not compared. The EUR rate is 12 days old, so treat the gap as indicative.` / `One price so far. Nothing to compare yet.` | `Lowest of the N compared. Compared in PKR at today's rates.` / `Same currency, compared as quoted.` / `N line is/lines are not compared because there is no rate for its/their currency.` / `One price so far. Nothing to compare yet.` / `Nobody has priced this item.` | DIFFERENT | low | Wording ("with a rate" vs "compared") and the stale-rate "indicative" sentence missing. R07 |
| C-36 | Can't quote row (replied) | Row: supplier, chip `Can't quote` (ban icon), `Doesn't carry this brand`, `· Mon 23 Nov` | Plain muted text `Can't quote: {reason}`; no chip, no date | DIFFERENT | medium | Chip + reason + date. R07 |
| C-37 | Waiting-on row | `Waiting on **Apex Instrumentation Co.** · enquiry sent Sun 22 Nov, chased Wed 25 Nov` + `Add reply` + `Can't quote` dropdown ("One tap records the reason", 5 reasons), inline Undo | Not on the Items panel. In the Supplier replies form: "Sent {day} · chased N times, last {day}" and a row of 5 reason buttons "Can't quote:" shown only when the supplier has no lines; Undo is a toast | DIFFERENT | medium | Function exists (D-R07b) but UI differs (buttons not dropdown, inquiry-wide, per-item override hidden in a details). R07 |
| C-38 | Can't quote 5 reasons | Doesn't carry this brand / Can't source in time / Won't quote this quantity / Item discontinued / Other reason | Same 5 labels | MATCH | - | - |
| C-39 | Add reply box (per item) | Collapsible box under the item: "Add a reply from {supplier}" + hint "Saved to this item only. The currency follows the supplier; there is nothing to pick. Press Enter to save and add another."; Supplier select, `Unit price` with currency prefix, `Lead time`, `Stock` checkbox "In stock"; `Cancel` / `Save reply` | Not built. Separate panel: one form per supplier asking a price for every item, Currency select, Lead time, Stock select (In stock / Not in stock / Not stated), one `Save reply`, note "Currency: {x}, usual for {country}." | DIFFERENT | high | Different interaction model. D-R07 accepted; owner said "ditto". Owner decision. R07 |
| C-40 | Live PKR preview while typing | "Reads as ≈ PKR 163,449 at today's USD rate. It would be the lowest of 2 comparable prices." / "No current {CUR} rate. You can save the reply and add the rate afterwards." | Only a static note "No usable {CUR} rate today. The price is still saved and shows as not compared." | MISSING | medium | Add live conversion line. R15/R07 |
| C-41 | Currency control | Never shown | A Select with note "Currency: USD, as saved." | DIFFERENT | low | BUILD_PLAN R07 says "Currency is always explicit"; mockup hides it. Owner decision. R07 |
| C-42 | Uncovered item block | Red banner "**None of the 5 suppliers who replied quoted this item.** Apex Instrumentation Co. has not replied yet. Float it to someone else before the customer's bid is due." + suggested suppliers (Gulf Instruments Trading FZE "Supplied diaphragm seals before · same item", Rhine Process Technik "Carries Endress+Hauser · same brand") each with `Copy enquiry text` | Danger Banner "None of the N suppliers who replied quoted this item." + "{names} has/have not replied yet. Ask someone else before the bid is due." No suggestions, no Copy enquiry text | DIFFERENT | high | Suggested list + `Copy enquiry text` MISSING (D-R07). Wording differs. R07 (R03/R04 libs exist) |
| C-43 | Item with no replies | Chip `No replies yet`, text "No supplier has been asked about this item." | Chip `No prices yet`; no per-item text | DIFFERENT | low | Align. R07 |
| C-44 | Empty page (nobody asked) | Meta "3 items · nobody asked yet"; block "Ask suppliers for prices" + "Pick the suppliers on the right. One tap copies an enquiry listing every item, ready to paste into WhatsApp or email. Replies are typed in under each item as they arrive."; rail "Suppliers to ask" (ticked suggestions, `Copy enquiry for 2 suppliers`) | "No supplier has been asked about this RFQ yet. Once one is, their reply is typed in here."; no suggestions rail, no copy-enquiry on this page | DIFFERENT | high | Empty block and Suppliers-to-ask rail missing on detail (exist only on `/rfqs/new`). R07/R05 |
| C-45 | Paste-to-parse | not in mockup | `Paste reply` button + "Reads the email or message you copied. Nothing is saved until you accept." + suggestions panel | EXTRA | low | Keep (BUILD_PLAN R08, D-R08); re-home into the Add reply box |
| C-46 | Supplier chase text | Rail card `Chase Apex Instrumentation Co.` with WhatsApp/Email tabs, recipient line (phone/email), full message shown, `Copy and mark chased`, "Chased once already" | Per supplier row: "Sent … · chased N times, last …", `Preview text` toggle (WhatsApp/Email), `Copy & mark chased` | DIFFERENT | medium | Label "Copy & mark chased" vs "Copy and mark chased"; no recipient line; preview hidden by default. R16/R07 |
| C-47 | Item rows at 375 | Card rows | Same pattern; built shows small field labels (Supplier/Price/…) | MATCH | - | - |

## 3. Right rail: Suppliers asked, Questions, Files

| ID | element | mockup (what it shows) | built (what it shows) | status | severity | suggested fix + BUILD_PLAN task |
|---|---|---|---|---|---|---|
| C-50 | "Suppliers asked" card | Header + pill `6 asked · 5 replied`; per supplier: name, chip (`Chased ×1`, `Quoted 2 of 4`), memory line (`Replied 5 of 7 · usually ~2 days, now 5 days` amber / `Asked twice, 1 reply. Not enough history to say more.`), `Sent Sun 22 Nov · replied Mon 23 Nov`; footer `Float to another supplier` | Not built as a card. Status chips sit in each Supplier-replies header; no memory line, no sent/replied line, no Float button | MISSING | high | Add the card using `src/lib/memory`; `Float to another supplier`. R07/R17 |
| C-51 | Questions card header | Title + pill `4 questions` | Title + `N questions` + WhatsApp/Email control in header | MATCH | - | Toggle placement per D-R09/10 |
| C-52 | Files panel | not in mockup | Extra `Files` panel (drop zone, list, refused list) | EXTRA | low | BUILD_PLAN R10; owner to confirm. R10 |
| C-53 | Relay banner | Amber: send icon, "**Lahore Process Controls** is waiting for 1 answer." + `Copy answers` | Same | MATCH | - | - |
| C-54 | Group "To ask" | Chip `To ask`, hint `1 question`, "Raised by …", `Answered with photo` (image icon) + hint "Pick or take a photo. No text needed.", primary `Copy questions for customer` | Same chip/hint/footer; buttons `Answered with photo` (camera icon), `Type answer`, `Withdraw`; `Preview text` + note; hint "Pick or take a photo. No text needed." absent | DIFFERENT | low | Add the hint. D-R09/10. R09 |
| C-55 | Group "Asked ×2" | `Asked ×2`, `2 questions · last asked 6 days ago`, `Copy chase text`, "A chase is due: 3 days since the last ask and the bid is due within 5." | Same chip/hint/button; note "…and the bid is due within 3 days." | DIFFERENT | low | 5 vs 3 days; align with chase rule. R16/R09 |
| C-56 | Group "Answered" | `Answered`, `2 questions · Wed 25 Nov`; "Our answer, relayed to suppliers"; photo row (thumb, filename, `Photo from the customer · 1.4 MB`, open icon); "Answered with a photo" | Same labels; green-bordered block; `AttachmentItem` rows noted "Photo answer"; answered date | MATCH | - | Subtext of photo row differs; low |
| C-57 | Add question | Input `Paste a question or type one` + `Add` | Textarea (placeholder "Paste a question or type one. A pasted message becomes one question per line."), `Add question`/`Add N questions`, per-line tag select, helper text | DIFFERENT | low | Superset. D-R09/10 |
| C-58 | Questions empty | "No questions yet. Ones raised by suppliers, or your own, are listed here and bundled for the customer in one tap." | Identical | MATCH | - | - |

## 4. Quotations list and Issue-quotation dialog

| ID | element | mockup (what it shows) | built (what it shows) | status | severity | suggested fix + BUILD_PLAN task |
|---|---|---|---|---|---|---|
| C-60 | Quotations panel | Left-column panel + sentence "Re-issuing makes a new revision under the same number. Earlier revisions and their PDFs never change." + `Issue R2`; 6-col table `Quotation | Issued | Valid until | Items | Gross, PKR | actions` | Rail card (icon + "Quotations"), same sentence, `Issue R{n}`; each revision a bordered card (Tag ref + chip + `PKR {gross}`; "Issued {day} · valid until {day} · N items"; `Open PDF`, `Share`) | DIFFERENT | medium | Table in left column; `net 915,000` sub-figure absent. R19 |
| C-61 | State chips | `Current` (green check), `Superseded` (circle) | Plain chips, no icon; extra `Expired` | DIFFERENT | low | Add icons; `Expired` EXTRA (bid_state quotation_expired). R19 |
| C-62 | Items count | `2 of 4` | `{n} items` | DIFFERENT | low | "N of M". R19 |
| C-63 | Row actions | Current: `Open PDF` + `Share`; superseded: quiet `Open PDF` only | Both rows have Open PDF + Share; Open PDF icon external-link | DIFFERENT | low | Match. R19 |
| C-64 | Quotations empty | "Nothing issued. Once supplier prices are in, set your price on each item and issue the first quotation." | "No quotation has been issued yet. Re-issuing later makes a new revision under the same number." + primary `Issue quotation` | DIFFERENT | low | Align copy. R19 |
| C-65 | Quotations loading / error | Skeleton; "Not loaded." | Skeleton; Banner "Couldn't load the quotations" + Try again | MATCH | - | - |
| C-66 | Profile-incomplete | not in mockup (placeholders instead; "app blocks PDF generation until legal name and address are set") | Warning banner "A PDF needs the company's legal name and address" with Settings link, in list and dialog; Issue still saves | EXTRA | low | Accepted D-A06/D-R19 |
| C-70 | Dialog frame | Title `Issue quotation QT-26-0042 R2` + chip `Re-issue`; sub "R1 stays exactly as it was sent. This creates R2 under the same number. Customer ref RFQ #74037."; close X | Title built from the previous ref (r19 PNG: "Issue quotation QT-26-0006 R1" for a re-issue that creates R1 from R0); first issue is just "Issue quotation"; context `RFQ-0006 · Company · customer ref …`; revision sentence sits in the footer; no `Re-issue` chip | DIFFERENT | medium | Show the NEW revision in the title, the `Re-issue` chip, sentence under title. Verify the ref shown. R19 |
| C-71 | Top fields | `Addressed to` ("Mr. Tariq Mehmood, Procurement Manager"), `Valid until` text input, third field `Validity` note "30 days from today, the company default" | Same two fields; contact name only; calendar date input; validity note as source line under Valid until | DIFFERENT | low | Job title: owner decision. R19 |
| C-72 | Line grid | Table `[tick] Item | Qty | Unit price, net PKR | GST | Lead time we quote | Line net, PKR` with per-line include checkbox; unquotable line greyed: "No supplier price yet, so there is nothing to quote. Add a reply to include it." | Card per item (description, qty text, price + GST, chips, lead time + hint, line net). No include tick, no Qty column, no disabled-line state | DIFFERENT | high | Include tick missing (D-R19: every item must be priced). Owner decision. R19 |
| C-73 | Best reply hint | `Best reply ≈ PKR 115,028 each` | Not shown | MISSING | medium | Show lowest compared PKR. R19 |
| C-74 | Price chips | `Last sold to this customer: PKR 146,000 (ORD-0031)`, `Last quoted: PKR 152,500 (QT-26-0040)` | `Last sold to this customer` `PKR 1,000, 25 Sep` (date, not order ref); `Last quoted` `PKR 1,200, QT-26-0014` | DIFFERENT | low | Sold chip should carry the order ref. R19 |
| C-75 | Lead time field + hint | placeholder "e.g. 8 to 10 weeks from PO"; hint with info icon "Suppliers say 10 to 14 days (Hengxin), 3 to 4 weeks (ABC)"; may add "Add shipping and clearance." | Same placeholder and hint text without icon or nudge | MATCH | - | Never auto-filled (A2b) |
| C-76 | GST options | `18% / 16% / 0%` | `18% / Exempt` | DIFFERENT | medium | 16% missing (also in the 33-line PDF sample). Owner decision. R19 |
| C-77 | Totals | `Net PKR 1,383,000`, `GST 18% on 3 lines PKR 248,940`, `Gross PKR 1,631,940` | `Net`, `GST` (no rate or line count), `Gross` with decimals | DIFFERENT | low | Label per rate. R19 |
| C-78 | Delivery / Payment | Prefilled, source "from QT-26-0040" with history icon | Same, source shown when equal to previous | MATCH | - | - |
| C-79 | Standard terms | Label + "from the company profile. Change them in Settings, or edit for this quotation only." 4-row textarea | Same help text, 4 rows | MATCH | - | - |
| C-80 | Footer | Hint "Issuing sets the bid as sent today."; `Cancel`, `Preview PDF` (eye), primary `Issue quotation R2` (file-check) | Hint = revision sentence (re-issue) or "Issuing marks the bid as sent today." (first); `Cancel`, `Issue R{n}` / `Issue quotation`. No Preview PDF | DIFFERENT | medium | `Preview PDF` MISSING; label "Issue quotation R2". R19/R20 |
| C-81 | Issued confirmation | not in mockup | Second step `QT-… R{n} issued`, "The bid is marked sent today.", `Done`, `Download PDF`, `Share` | EXTRA | low | Needed for share (D-R19) |
| C-82 | Expired quotation | not shown | `Expired` chip, "expired {date}" amber | EXTRA | low | R19/S18 |
| C-83 | Dialog loading/error | not shown | Skeleton; Banner "Couldn't load the items to quote" | EXTRA | low | - |
| C-84 | Dialog at 375 | not drawn in mockup | Full-width sheet, stacked fields, sticky footer (r19 375 PNG) | MATCH | - | Nothing to compare |
| C-85 | Interaction count | "1 tap per price, then Issue" | Chip = 1 tap, Issue, then Share | MATCH | - | - |

## 5. Won: create the order

| ID | element | mockup (what it shows) | built (what it shows) | status | severity | suggested fix + BUILD_PLAN task |
|---|---|---|---|---|---|---|
| C-90 | `Mark won` on a quotation | Interaction 1 | Not built; no won action in `src/features` (only `convert_rfq_to_order` in generated types) | MISSING | high | O01 |
| C-91 | Dialog `Mark won QT-26-0042 R2` | sub "Faisalabad Textile Mills · 3 lines · gross PKR 1,631,940"; note "Creates order **ORD-0039** with the quoted lines, prices, delivery and payment terms. R1 and R2 stay on the RFQ as they were sent."; optional `Customer PO number` ("optional, add it from the order later", placeholder "Not yet received"); `Cancel` + primary `Create order` | Not built | MISSING | high | O01 |
| C-92 | Won RFQ state | chip `Won` | Status registry has `won`; no UI path sets it | MISSING | high | O01 |

## 6. Mobile 375

| ID | element | mockup (what it shows) | built (what it shows) | status | severity | suggested fix + BUILD_PLAN task |
|---|---|---|---|---|---|---|
| C-100 | Top bar | Page bar: back arrow, centred `RFQ-0177`, `...` | App bar (logo, "RFQs", search, avatar) + crumb `RFQs > RFQ-0033` | DIFFERENT | medium | Detail app bar with back + ref + more. R07 |
| C-101 | Header block | H1 `RFQ-0177`, company line at base size, chips `Bid sent`, `Due in 4 days` | H1 + company stacked at 2xl, chips carry dates | DIFFERENT | low | R07 |
| C-102 | Meta | 4 cells 2x2 (Customer ref, Bid due, Contact, Owner), no icons | 6 cells in 2 columns with icons | DIFFERENT | low | R07 |
| C-103 | Sticky action bar | Bottom: primary `Issue quotation`, icon `Chase` menu (`Chase suppliers 1`, `Chase customer 2`), icon `...` menu (`Mark bid sent`, `Close RFQ`) | No action bar; inline buttons under the title; global bottom tab bar | MISSING | high | R07 (+R16 counts) |
| C-104 | Panels | One column: items, suppliers asked, questions, quotations (card shows "2 of 4 items · net PKR 915,000 / gross 1,079,700") | One column: Supplier replies, Items and prices, Questions, Quotations, Files | DIFFERENT | medium | C-02/C-60. R07/R19 |
| C-105 | Tap targets | 44px | `h-control` buttons; sm buttons smaller | DIFFERENT | low | Audit. U-series |

## 7. Quotation PDF (A4)

| ID | element | mockup (what it shows) | built (what it shows) | status | severity | suggested fix + BUILD_PLAN task |
|---|---|---|---|---|---|---|
| C-110 | Page / fonts | A4, Geist, black on white, hairline greys | A4, Geist 400/500/600 + Geist Mono, same greys, 36pt margins | MATCH | - | - |
| C-111 | Letterhead | Wordmark left, company block right (legal name bold, address, NTN/STRN, phone/email/website), heavy rule | Same; prints only filled fields (dashed placeholders not printed, D-A06) | MATCH | - | - |
| C-112 | Title block | `Quotation`; sub `Supersedes QT-26-0042 R1 of 26 Nov 2026` / `First issue`; dl Quotation no., Revision, Date, Valid until (bold) | `Quotation` + `Supersedes … of 15 Oct 2026`; same dl; no `First issue` sub for R0; Valid until not bold | DIFFERENT | low | Add "First issue", bold valid-until. R19/R20 |
| C-113 | Prepared for | name bold, site name, site address, `Attention: Mr. Tariq Mehmood, Procurement Manager` | name, site name, site address (if set), `Attention: {contact name}` only | DIFFERENT | low | Job title: owner decision. R19 |
| C-114 | References | Your reference, Our RFQ, Currency `Pakistani rupees (PKR)`, Prepared by | Same (Your reference only if set) | MATCH | - | - |
| C-115 | Table | `# | Description | Qty | Unit | Unit price PKR, net | GST | Line net PKR | Lead time`; shaded header; title bold + detail line | Same eight columns, header repeats on each page, title/detail from first line vs rest; Lead time column 78pt (mockup 104px) so "2 weeks from PO" wraps; Unit blank when unit unset | MATCH | - | Column width tweak, cosmetic |
| C-116 | GST cell | `18%`, `16%` | `n%`, `Exempt` for 0 | MATCH | - | 16% unreachable (C-76) |
| C-117 | Totals | Net, `GST at 18%` (+ `GST at 16%`), bold `Total gross` with thick rule, words line | Net, one row per rate, Gross with 1.5pt rule, words line (`amountInWords`); block 330pt wide with labels far left | MATCH | - | Cosmetic width |
| C-118 | Delivery / Payment | Two blocks side by side | Same (only if filled) | MATCH | - | - |
| C-119 | Bank details | not in mockup | Optional block when profile bank fields are filled | EXTRA | low | D-GATE2-Q4 |
| C-120 | Standard terms | Numbered list | Numbered from `termLines` | MATCH | - | - |
| C-121 | Signature | Thank-you sentence left; right rule, `For [Legal name]`, bold signatory, `Sales Engineer, authorised signatory`; anchored near the page foot | Same text/structure; title only if `job_title` set; block follows terms (not bottom-anchored) | DIFFERENT | low | Anchor to foot or accept. R19 |
| C-122 | Footer | `QT-26-0042 R2` left, `Valid until …` centre, `Page 1 of 1` right on every page | Same (confirmed in r19 PNG "Page 1 of 3") | MATCH | - | - |
| C-123 | Running header on pages 2+ | Slim header: small wordmark left; `Quotation QT-26-0051 R0`, customer name, date right | None; page 2+ begins with the repeated column header | MISSING | medium | Add fixed header shown only when pageNumber > 1. R20/R19 |
| C-124 | Keep totals + terms + signature together | "stay together on the last page with the final lines" | Totals, delivery/payment, terms, signature are separate `wrap={false}` blocks and may split across pages | DIFFERENT | low | One wrapping view for the last block. R19 |
| C-125 | Revision marks | `Supersedes …` under the title; `R2` in dl, footer and acceptance line | Same | MATCH | - | - |
| C-126 | Preview PDF before issuing | `Preview PDF` in the dialog | Not built (C-80) | MISSING | medium | R19/R20 |
| C-127 | Open / Share | buttons only | `Open PDF` (new tab), `Share` (Web Share, download fallback) | MATCH | - | - |

## OWNER DECISION needed

- C-02, C-20, C-22, C-39: Mockup enters replies per item under each item (Add reply box). D-R07 built one form per supplier covering all items. Which does the owner want? ("ditto" says per item.)
- C-23: Rule for "Partly covered, 1 price" versus "Covered, 1 price".
- C-25: Supplier descriptor line ("China stock · factory certificate", "Karachi · agent for …") has no source field in DATA_MODEL. Add a supplier note, or drop it from the design?
- C-41: BUILD_PLAN R07 says "Currency is always explicit"; the mockup says "there is nothing to pick". Show a currency control or not?
- C-72: Per-line include tick and partial quotations (mockup list shows "2 of 4", "1 of 4"; D-R19 requires every item priced). Allow partial quotes?
- C-76: GST 16% option (mockup dialog and 33-line PDF sample) versus D-R19 18% / Exempt only.
- C-71, C-113: Contact job title ("Procurement Manager") appears in dialog and PDF; `contacts` has no title column (role lives in `notes`). Add a column or drop the title.
- C-08, C-10: Keep the Close dialog (pre-filled reason) or switch to the one-tap reason menu inside "Bid and close"?
- C-30: Keep the extra "At entry" rate line under each PKR cell (D-R07)?
- C-52: Files panel is not in the mockup; keep it in the rail?

## UNDONE (not built or not matching, no decision needed)

C-02, C-05, C-07, C-08 ("Sent the offer again"), C-09, C-12, C-13, C-15, C-16, C-20 (Add item), C-21 (rate bar), C-22, C-33 (row menu), C-35, C-36, C-37, C-39, C-40, C-42, C-43, C-44, C-46, C-50, C-54, C-55, C-60, C-61, C-62, C-63, C-64, C-70, C-73, C-74, C-77, C-80, C-90, C-91, C-92 (Mark won / Create order), C-100, C-101, C-102, C-103 (sticky action bar + Chase menu), C-104, C-105, C-112, C-123 (running header), C-124, C-126.

## Top fixes by priority

1. Won flow: `Mark won` on the quotation + "Create order" dialog (C-90..C-92), O01.
2. Restructure RFQ detail to the mockup: one "Items and supplier replies" panel with per-item Add reply, row "..." menu, Add item, quotations table in the left column (C-02, C-20, C-22, C-33, C-39, C-60), R07/R19.
3. Rate bar, live PKR preview, Exchange rates link (C-21, C-40), R15.
4. "Suppliers asked" rail card with memory lines and chase card, "Float to another supplier", uncovered-item suggestions with Copy enquiry text, empty-state "Ask suppliers" block (C-42, C-44, C-46, C-50), R07/R16/R17.
5. Mobile 375: back/title bar and sticky action bar with Chase menu (C-100, C-103), R07.
6. Issue dialog: include tick, Best reply hint, Re-issue chip and new-ref title, Preview PDF, GST 16%, totals labels (C-70, C-72, C-73, C-76, C-77, C-80), R19.
7. "Bid and close" menu with "Sent the offer again" (C-07..C-09), R07.
8. PDF: running header on pages 2+, keep-together last block, "First issue", bold valid-until, signature anchoring (C-112, C-121, C-123, C-124), R19/R20.
9. Header polish: Customer since, owner role, deadline chip wording, loading skeleton and error-state parity (C-05, C-13, C-15, C-16), R07.


---

# D - Company page, Companies list, create / merge dialogs (UI parity audit)

Evidence: mockup `docs/design/mockups/g2-company.html` (4 boards, all 1440 only; no 375 board exists, boards are scaled by `.board[data-w]`), PNGs `screens/company-01..04`, review shots `review/r01-r02`, `r17-r18` (built state at r18, fixture data), source `src/features/companies/*` at main 69aa74d, DECISIONS.md (R02, R02 follow-up, 0030, R05, R17/R18 entries), BUILD_PLAN R02/R18/O06/O02.
Mobile note: the mockup has no phone design for the company page; the built 375 layout (quotes/deliveries become stacked label+value cards, bottom tab bar) is composed from DESIGN_SYSTEM (FE-1).
Companies list, create dialog, merge dialog: NO dedicated mockup exists (INVENTORY.md has no row; g2-components.html only has the generic Combobox "Add new" row; g2-intake-float.html shows the inline create in intake). Built from DESIGN_SYSTEM.

## 1. Company page - header and chrome

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| D-01 | Breadcrumb | "Companies > {name}", Companies link in brand green | `Breadcrumb` Companies > name; review png shows Companies in body colour | FIXED (2c352f1) | low | Use primary link colour. R02 |
| D-02 | H1 + role chip | name 2xl, chip "Supplier" (circle icon) / "Customer" (circle-dot) beside it | h1 + `StatusBadge company-role` | MATCH | - | - |
| D-03 | Meta line, supplier populated | "Linz, Austria - Quotes in EUR - Supplier since 2023" | "Austria - Added Oct 2026" (country only; no city; no "Quotes in"; "Added {Mon YYYY}" from created_at, never "Supplier since") | FIXED (2c352f1, city a198ee3) | medium | Add "Quotes in {currency}" (from `open.currency`) and "Supplier since {year}". City has no column -> OWNER DECISION. R02/R18 |
| D-04 | Meta line, low data | "Shenzhen, China - Quotes in CNY - Added Oct 2026" | "China - Added Oct 2026" | FIXED (2c352f1, city a198ee3) | medium | as D-03 |
| D-05 | Meta line, imported only | "Rawalpindi, Pakistan - Quotes in PKR - Imported from the old CRM" | "Pakistan - Imported from the old CRM" (string matches when legacyImported) | FIXED (2c352f1) | low | add "Quotes in PKR" |
| D-06 | Meta line, customer | "Karachi, Pakistan - 3 sites - 3 RFQs - 3 orders" | "Pakistan - 3 sites - 3 RFQs - 3 orders - Added Mar 2024" | FIXED (2c352f1) | low | Drop the extra "Added" on customers (mockup puts "Customer since 2024" in Roles panel). R02 |
| D-07 | Primary action | supplier "Float an RFQ here" (send icon); customer "New RFQ" (file-plus icon) | same labels and icons, goes to `/rfqs/new?company=` | MATCH | - | - |
| D-08 | Edit button | pencil + "Edit" | same | MATCH | - | - |
| D-09 | Overflow "..." | ellipsis icon, no menu content drawn | rendered for admin only; menu item "Merge into another company" | FIXED (2c352f1, menu for every role (Copy link; Merge stays admin-only)) | low | Non-admin loses the ellipsis the mockup shows (signed in as sales). R02 |
| D-10 | App header | logo, 6 tabs with count badges (Today 9, RFQs 14, Orders 7, Money 3), "Search or jump to", role + avatar | tabs without count badges in review png; Money hidden for Engineer (by role) | NOT PART D: nav count badges belong to the shell (Part A); noted | medium | Nav counts belong to the shell auditor; noted. U02 |
| D-11 | Layout | main column + right rail (about 340px) | `lg:grid-cols-[minmax(0,1fr)_340px]`, gap-6, max 1440 | MATCH | - | - |
| D-12 | Page loading / error / not found | not designed | Skeleton; "Couldn't load this company" + Try again; "This company isn't here" + "All companies" | KEPT: state the mockup does not draw | low | - |

## 2. Supplier - "What we know" panel (boards 1-3)

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| D-20 | Panel header | "What we know" + "From our own enquiries, quotes and deliveries, last 24 months" + dashed tag right | same title/meta; `Tag dashed` | MATCH | - | - |
| D-21 | Header meta, low data | "From our own enquiries, quotes and deliveries" (no "last 24 months") | always ", last 24 months" | FIXED (2c352f1) | low | variant text. R18 |
| D-22 | Header meta, imported only | "From enquiries, quotes and deliveries, last 24 months" (no "our own") | always "From our own ..." | FIXED (2c352f1) | low | variant text. R18 |
| D-23 | Tag text | "Includes imported history" / "Low data" / "Imported history only" | same three strings | MATCH | - | - |
| D-24 | Four-cell grid | Brands + Enquiries over Deliveries + Last contacted, vertical divider | `md:grid-cols-2`, same arrangement, stacks at 375 | MATCH | - | - |
| D-25 | Brands cell | "Brands" / "Evidence we hold, not what the supplier claims." rows "Belimo - quoted 4x", "Siemens - listed, no quote yet" | same strings and layout | MATCH | - | - |
| D-26 | Brands empty | not designed | "No brand listed yet. One is added by itself when they quote an item of it." | KEPT: empty state | low | - |
| D-27 | Enquiry summary (3 or more) | "Asked 6 · replied 5 of 6 · couldn't offer 1 of 6" with bold numerals | same string, numerals not bold | FIXED (2c352f1) | low | bold the counts. R18 |
| D-28 | Enquiry summary (under 3) | "Asked twice · 1 reply" (middot) | "Asked twice, 1 reply" (comma) | FIXED (2c352f1) | low | use middot in supplierFacts.ts. R18 |
| D-29 | Enquiry squares + legend | filled check = quoted; outlined minus = couldn't offer; dashed empty = no reply; legend "quoted 4 / couldn't offer 1 / no reply 1" | same 22px squares, same legend text, zero counts hidden | MATCH | - | - |
| D-30 | Usual reply time, known | "About 2 days" / "Middle value of the 3 replies logged in this CRM. 2 imported replies have no real date and are left out." | same strings | MATCH | - | - |
| D-31 | Usual reply time, low | "Not enough replies yet." / "Needs 3 logged replies. There is 1." | same | MATCH | - | - |
| D-32 | Usual reply time, imported only | "Not shown." + imported explanation | same | MATCH | - | - |
| D-33 | Chosen | "2 of 3 times" + "A quoted item was later ordered, and the order went on a leg with them."; none: "Nothing ordered yet." / "No quoted item has gone to an order." | same strings | MATCH | - | - |
| D-34 | Deliveries sub-line | "Late 1 of 4"; imported: "Late 2 of 6, dates estimated" | "Late 1 of 4"; never appends ", dates estimated" | FIXED (2c352f1) | medium | append for legacy deliveries (`deliverySub`). R18 |
| D-35 | Delivery squares | on time = filled check; late = red outlined square WITH clock icon; "on time, dates estimated" = DASHED outlined check; legend "on time 2 / late 1 / on time, dates estimated 1" (imported board: 4 dashed checks, 2 red clocks, legend "on time, dates estimated 4 / late 2") | on time filled check; late red square with no icon; no dashed "estimated" unit, imported counted as plain on time/late | FIXED (2c352f1) | medium | add estimated unit variants (dashed) and clock icon on late; needs per-leg legacy info. R18 |
| D-36 | Delivery extra line | not in mockup | "Late ones usually ran about N days over." | KEPT: DATA_MODEL 5c shows the median days late from 3 late legs | low | drop or approve. R18 |
| D-37 | Deliveries empty | "No deliveries recorded yet. The first PO to this supplier starts the count." | "... The first purchase order to this supplier ..." | FIXED (2c352f1) | low | wording |
| D-38 | Last contacted | left "Tue 24 Nov 2026"; right "Enquiry sent for RFQ-0171 (green mono link). No reply yet." | left formatted day; right plain string, RFQ ref not a link | FIXED (2c352f1) | medium | render ref as link. `lastContactText` is a string today. R18 |
| D-39 | Last contacted, low data | "Enquiry sent for RFQ-0165. Chased once on 19 Nov." | shows newest single event only ("Chased for RFQ-0165.") | FIXED (2c352f1) | low | compose sentence with chase count + date. R18 |
| D-40 | Last contacted, imported | "Order leg for ORD-0020. Imported." | no leg-based text (fallback "Contact on record.") | FIXED (2c352f1) | medium | add leg events and "Imported." suffix. R18 |
| D-41 | Provenance footer | info icon "Where this comes from..." in three variants | populated variant matches; low-data says "With few enquiries" vs mockup "With so few enquiries"; imported-only variant ("All of this was imported from the old CRM, Jan 2024 to Sep 2026 ... Nothing has been logged here since the move.") NOT built (generic "Includes imported history: N of N ..." used) | FIXED (2c352f1) | medium | add imported-only footnote with date span; fix wording. R18 |
| D-42 | Empty (no enquiries) | not designed | "No enquiries yet." + Fine copy | KEPT: empty state | low | - |
| D-43 | Skeleton / error | not designed | skeleton; Banner + Try again | KEPT: loading and error states | low | - |

## 3. Supplier - Recent quotes, Deliveries, Open with them, Contacts, rail panels

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| D-50 | Recent quotes header | `Original currency first. "At the time" uses the rate captured when the quote was logged.` + "All enquiries" link; low data meta "Everything we have from them"; imported "Imported rows are marked" | `... "At the time" is the rate captured ...`; one meta for all states | FIXED (2c352f1) | low | per-state meta. R18 |
| D-51 | Quotes columns | Date, RFQ, Item, Quoted price, "≈ PKR at the time", "Lead time, as written", Outcome | same seven headers | MATCH | - | - |
| D-52 | Item cell sub-line | "Belimo · same model" / "same item" tier label | brand only | APPROVED deviation (DECISIONS 2026-10-15, R17/R18): row shows the brand, not a per-row tier label | low | Approved deviation: DECISIONS 2026-10-15 (R17, R18) |
| D-53 | Awaiting-quote row | PKR col "Awaiting a quote"; "Sent 24 Nov, 3 days ago" under item | note text goes in the PKR col ("Sent 12 Oct, 3 days ago", review png) and also under item; "Awaiting a quote" only when no note | FIXED (2c352f1) | medium | PKR col "Awaiting a quote", note under item only. R18 |
| D-54 | Couldn't-offer row | PKR col "Does not stock this model" | "Doesn't carry this brand" (cantQuote reasonLabel) | KEPT: the reason is the structured can't-quote key (R07), so the words are its label, not free text | low | align string. R18 |
| D-55 | No-reply row | "Sent 2 Jun, never answered"; dashed "No reply" chip | same | MATCH | - | - |
| D-56 | Price cell | "EUR 214.00" (always 2 dp); hidden: lock icon + "Price on file, currency unverified" | review png "EUR 214" (no decimals for whole values); hidden uses EyeOff icon | FIXED (2c352f1) | low | Lock icon, 2 dp. R18 |
| D-57 | PKR at the time | "≈ 69,935" / "at 326.80 · 11 Oct" | "≈ PKR 69,935" / "at the time, rate 326.80 · 16 Sep" | FIXED (2c352f1) | low | match mockup wording |
| D-58 | PKR col, hidden price | "No rate was captured" | "Not shown" | FIXED (2c352f1) | low | match text |
| D-59 | PKR col, PKR quote | "Already in PKR" | same | MATCH | - | - |
| D-60 | Aged-row note | orange "Apr 2025, 19 months ago" | same (tone-warning) | MATCH | - | - |
| D-61 | Imported row date | "Apr 2025" month-year | same | MATCH | - | - |
| D-62 | Outcome chips | with icons (circle-dot "Waiting for a reply", circle-check "Ordered here" + ORD tag, circle "Ordered elsewhere"/"Couldn't offer"/"Not ordered here", circle-dashed "No reply"); low-data "Quoted, RFQ open" | chips have no leading icons; "Not ordered" (approved, DECISIONS R18); no "Quoted, RFQ open" outcome (quoted line on open RFQ shows "Not ordered") | FIXED (2c352f1) | medium | add icons and the RFQ-open outcome; "Not ordered here" wording is an approved deviation. R18 |
| D-63 | Row cap note | none | footer "Showing the latest N of M. Every enquiry is in the list below." | KEPT: row cap note | low | - |
| D-64 | Quotes empty | not designed | "No quote yet. Prices appear here ..." | KEPT: empty state | low | - |
| D-65 | "Recent enquiries" panel | none ("All enquiries" link has no drawn target) | extra table panel (Sent, RFQ, Outcome, Reply time) | KEPT (owner): restyled with the same outcome chips and icons as Recent quotes, 2c352f1 | medium | owner to keep or drop. R18 |
| D-66 | Deliveries table | Purchase order (mono, "PO-26-0017 · R1"), Order, Expected, Received, Result; legacy rows show an "Imported" tag in PO col; "est." after dates | same columns/format and "est."; legacy rows read "No PO issued" | FIXED (2c352f1) | low | show "Imported" tag for legacy. R18 |
| D-67 | Delivery result | "On time" + "1 day early"; "Late 6 days"; "On time" + "dates estimated" | same (plus extra states "Not received, N days past", "Not received yet") | MATCH | - | - |
| D-68 | Contacts panel | name, role, phone mono; "+ Add" | same plus site name, e-mail, edit and trash buttons; empty "No contacts yet. Every field is optional, so a name alone is enough." | KEPT: R02 follow-up edit and remove (job title now shown, a198ee3) | low | additions from R02 follow-up |
| D-69 | Open with them | Enquiry ("RFQ-0171 waiting, 3 days"), Order leg ("ORD-0038 A received"), Currency ("EUR"; low data "CNY, rate 38.85, 8 days old" with orange age) | Enquiry same; Order leg shows "expected 20 Oct"-style text or "None open"; Currency code only (no rate, no age); extra footnote "Enquiries still unanswered and order legs not yet received. ..." | PARTLY FIXED 2c352f1: rate and age added, footnote removed. OPEN (owner): "A received" wording on the Order leg row | medium | add rate + age (staleness) ; OWNER on "A received" wording. R18 |
| D-70 | Brands panel in rail | none (brands live inside What we know) | extra "Brands carried" rail panel (tags, remove X, Add combobox) shown for suppliers | KEPT (owner): rail panel, same panel and tag treatment as Contacts | medium | duplicates the Brands cell; OWNER DECISION. R02 |
| D-71 | Roles panel | customer board only: Customer chip, "Also a supplier?" No, "Customer since" 2024 | shown for all roles: rows "Customer"/"Supplier" (chip or No) + sentence | FIXED (2c352f1) | medium | use mockup labels; add "Customer since"; hide on supplier boards. R02 |

## 4. Customer - Sites with RFQ and order history (board 4; orders are later phase)

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| D-80 | Panel header | "Sites" + "RFQs and orders are filed under the site they are for" + "+ Add site" | same | MATCH | - | - |
| D-81 | Site header | pin icon, bold name, address, "2 RFQs · 2 orders" | same + edit and remove icon buttons | MATCH | - | edit/remove EXTRA (R02 follow-up) |
| D-82 | History columns | Reference, What, Date, State, action | Reference, "Their reference", Date, State | FIXED (2c352f1) | high | No "What" (description, e.g. "Furnace zone thermocouples and transmitters"); built shows customer ref instead. Fetch first item description / order title in getCompanyHistory. R02 / O06 |
| D-83 | Repeat order | "Repeat order" (refresh icon) on each order row | missing | SLOT BUILT 2c352f1: "Repeat order" drawn in the design position, disabled; the action is O02 (create_repeat_order). TRACKED: replace RepeatOrderSlot in SitesPanel.tsx when O02 merges | high | later phase: O02 (create_repeat_order), O06 |
| D-84 | Order state chips | "Delivered" + "Fully invoiced" / "Payment overdue" / "Not invoiced" | order lifecycle chip "Active"/"Done"/"Cancelled" (review png "Done", "Active"); invoicing chips match; no "Payment overdue" | FIXED (2c352f1) | high | use goods state "Delivered" and payment "Payment overdue" from views; later phase O03/O06 |
| D-85 | Order link target | reference tag | links `/orders/:id`; orders screen not built (placeholder) | TRACKED: order link goes to /orders/:id; the Orders screen is O03/O04 | medium | later phase O03/O04 |
| D-86 | RFQ state text | Open + "bid due Tue 1 Dec"; Closed + "no reply from customer"; Won + "became ORD-0040" | "bid due 1 Dec" (no weekday); Closed shows "bid due 15 Aug" (close reason missing); Won matches | FIXED (2c352f1) | medium | weekday; show close reason. R02 / O06 |
| D-87 | Row ordering | RFQs and orders interleaved by date desc | same | MATCH | - | - |
| D-88 | Date format | "24 Nov" mono | same ("No date" fallback) | MATCH | - | - |
| D-89 | Empty site | bold "No RFQs or orders for this site yet." + "Start one from the button above and it will be filed under this site." | one small line "No RFQs or orders for this site yet. Start one and it is filed here." | FIXED (2c352f1) | low | use mockup copy |
| D-90 | "Not filed under a site" block | none | extra muted block | KEPT | low | - |
| D-91 | Sites empty | not designed | "No sites or RFQs yet." | KEPT: empty state | low | - |
| D-92 | Contacts (customer) | Naveed Akhtar / Finance / 0321 555 0173 ... | same plus site name | MATCH | - | - |
| D-93 | Money with them | none | admin-only Receivable/Received/Balance panel | KEPT (owner): Money with them, admin only, same row style as Open with them | medium | OWNER DECISION (DECISIONS R02 built it) |
| D-94 | Notes panel | none | shown when notes exist | KEPT (owner): Notes | low | - |
| D-95 | History panel | none (BUILD_PLAN R02 says "history placeholder") | placeholder "History / Changes to this company / Nothing to show yet. A timeline of edits, merges and notes ..." on every company | FIXED (2c352f1, History placeholder removed) | medium | remove or build; no mockup |

## 5. Mobile 375

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| D-100 | Phone design | none | single column, actions wrap under title, bottom tab bar | KEPT | low | - |
| D-101 | Quotes/deliveries on phone | none | every field stacked with label (very tall, about 7 rows per quote) | FIXED (2c352f1, phone rows compact (labels only on the numbers)) | medium | consider compact card |
| D-102 | Sites tables on phone | none | Reference / Date / State; "Their reference" hidden | KEPT | low | - |
| D-103 | Panel order on phone | none | Contacts rail placed after all main panels | KEPT | low | - |

## 6. Companies list (no mockup)

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| D-110 | Whole screen | none | "Companies", "7 companies. Whether one is a customer or a supplier follows from what you do with it.", "+ New company", table (Company+country, Role, RFQs, Orders), search "Search by name or country", segmented All/Customers/Suppliers/Prospects with counts, footer "Showing 7 of 7 companies" | KEPT: no mockup | low | report only |
| D-111 | Empty / no match | none | "No companies yet" / "No company matches" with Clear search / Add "text" | KEPT: no mockup | low | - |
| D-112 | Role cell, no role | none | "No activity yet" | KEPT: no mockup | low | - |
| D-113 | Mobile | none | RFQs and Orders columns hidden below md | KEPT: no mockup | low | - |

## 7. Create company dialog and inline create

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| D-120 | Dialog on Companies screen | none | "New company", "Only the name is required.", Company name (required), Country (optional, pre-fill with source note), Cancel / "Add company" | KEPT: dialog on the Companies screen, no mockup | low | - |
| D-121 | Inline create in intake | g2-intake-float: inline mini-form under the combobox: "Company name", "City" (Optional), "Contact" (Optional); "Create and use" / "Cancel"; note "City and contact can wait. Add them from the company page later." | modal CreateCompanyDialog (Company name, Country), button "Add company", no City/Contact, no note | FIXED (460537d, city a198ee3) | high | build the inline form as drawn; City needs a column (OWNER DECISION). R02 / R05 |
| D-122 | Combobox create row | `Add “Mianwali Polymers” as a new company` + sub "Saved as a prospect until the first order" | label matches, no sub line | FIXED (460537d) | medium | add sub line. R05 |
| D-123 | Combobox existing rows | "Mianwali · customer · 2 RFQs · similar name" | "customer · Pakistan" | FIXED (460537d, city a198ee3) | low | country accepted (DECISIONS R05); add RFQ count and "similar name" hint |
| D-124 | Duplicate name | none | "A company with this name already exists." + "Open it" | KEPT: duplicate name handling | low | - |

## 8. Merge dialog

| ID | element | mockup | built | status | severity | suggested fix + task |
|---|---|---|---|---|---|---|
| D-130 | Merge dialog | none | "Merge duplicate company", "{name} is the duplicate.", Combobox "Merge into", moved-counts sentence, danger button "Merge into {name}" | KEPT: no mockup | low | report only |
| D-131 | Merge entry | ellipsis (no menu drawn) | admin popover "Merge into another company" | KEPT: no mockup | low | - |

## OWNER DECISION needed
- D-03, D-04, D-121, D-123: mockups show a City ("Linz, Austria", "Mianwali") but companies only have `country`. Add `companies.city` (and capture it in create) or keep country-only (DECISIONS R05)?
- D-70: keep the separate "Brands carried" rail panel (only place to add/remove brands) although the mockup puts brands only inside What we know?
- D-65, D-95: keep the extra "Recent enquiries" table and the "History" placeholder panel (neither in the mockup)?
- D-93, D-94: keep admin "Money with them" and "Notes" panels?
- D-52, D-62: "Not ordered" wording and dropped tier label are an approved deviation (DECISIONS 2026-10-15 R17/R18); confirm.
- D-69: mockup Order leg reads "ORD-0038 A received" (ambiguous); confirm intended wording.

## UNDONE (not built / not matching)
D-01, D-03, D-04, D-05, D-06, D-21, D-22, D-27, D-28, D-34, D-35, D-37, D-38, D-39, D-40, D-41, D-50, D-53, D-54, D-56, D-57, D-58, D-62, D-66, D-69, D-71, D-82, D-83 (O02, later), D-84 (O06, later), D-85 (O03/O04, later), D-86, D-89, D-121, D-122, D-123.

## Top fixes by priority
1. D-82 "What" column in site history; D-84 order state chips (orders later phase; RFQ side now).
2. D-83 "Repeat order" button (O02, later phase).
3. D-121 / D-122 inline create in intake as drawn.
4. D-35 / D-34 / D-41 imported-history rendering (dashed "dates estimated" squares, sub-line, imported-only footnote).
5. D-62 outcome chip icons + "Quoted, RFQ open"; D-53 "Awaiting a quote".
6. D-69 / D-03 currency rate + age, "Quotes in" / "Supplier since".
7. D-71 Roles panel to mockup; D-86 weekday and close reason; D-38/39/40 Last contacted links and sentences.
8. Low: D-27/28, D-56/57/58, D-89, D-01 wording and cosmetics.


---



## Fix log, Part D (branch p4/parity-d)

Every non-MATCH row above now says FIXED with the commit that did it, or why it was kept (owner decision, approved deviation, a state the mockup does not draw) or where it is tracked. Commits: `2c352f1` (header, site history, supplier panels), `460537d` (inline create, similar-name rows), `a198ee3` (companies.city and contacts.job_title from migration 0039).

Open after this branch:
- D-83 the "Repeat order" action (O02, another worker): the slot is in place and disabled.
- D-69 the "A received" wording on the Order leg row (owner).
- D-85 the order link target (Orders screen, O03/O04).
- D-10 nav count badges (shell).
- users.phone (0039) is not shown anywhere on the company page in the mockups; it is for signatures on chase texts and quotations.
