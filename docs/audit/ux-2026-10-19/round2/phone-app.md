# Phone and installable-app audit: qtech-crm-v2

Date: 2026-10-20. This is a read-only audit. I read `origin/main` @ 33d10e7 (exported to `scratchpad/audit2/src-main`) and the shell changes on `origin/ux/foundation`, `origin/ux/money-today` and `origin/ux/rfqs`. I also checked the public live site https://qtech-crm-v2.vercel.app: the login page at 375x812 in the built-in browser, plus the manifest, `sw.js`, the icons and the precache list via curl. I did not sign in. Nothing was edited or committed.

Paths below are repo-relative. Line numbers are for `origin/main` unless a branch is named.

## Score: "works like a good phone app"

| | Score | Why |
|---|---|---|
| **main now** | **6 / 10** | **Good:** a real PWA with a share target, Capture drafts kept in IndexedDB, a safe update prompt, idempotent retries, a phone tab bar, bottom-sheet dialogs and table cards. **Hurting it:** 13px inputs (iPhone zooms on every field), 28px small buttons, Android Back ignores open sheets, the keyboard hides the Save bars, an offline cold start shows the sign-in form, nothing refreshes when you come back to the app, and the PDF can break after a deploy. |
| **with ux/foundation + ux/money-today (+ ux/rfqs)** | **7 / 10** | **Fixed by the branches:** 16px inputs for most fields, 40 to 44px controls on touch, bigger text, 5 tabs with count badges, a one-bar Back on phone sub-screens, New RFQ drafts kept and a leave guard (ux/rfqs). **Still open:** Back/keyboard/offline/resume/stale-chunk. |

The real-device test script `docs/testing/R24_DEVICE_TEST.md` has never been run: its results table is blank, and `docs/AUDIT_ORDER_LIFECYCLE.md:116` confirms it. Its step A9 ("Airplane mode, the app still opens") will probably show the sign-in form instead (see 2c).

---

## 1. PWA install surface

### Manifest

File: `public/manifest.webmanifest`. The live copy is identical and served as `application/manifest+json`.

- **What it has:**
  - `name` "Q-Tech CRM", `short_name` "Q-Tech" and `id`/`start_url`/`scope` "/". Start goes through RoleLanding to /today.
  - `display` standalone, `orientation` any, `theme_color` #1a7b46 and `background_color` #ffffff.
- **Icons:**
  - 192 and 512 `any`, 512 `maskable`, all RGB PNGs on live.
  - `apple-touch-icon.png` is 180x180 (index.html:10).
  - Missing: a 192 maskable icon and a monochrome icon (Android 13 themed icons). Both are optional.
- **share_target:**
  - POST multipart to `/capture` with title, text, url and `files` (accept `image/*`, `application/pdf`). This is correct for Android Chrome and WebAPK.
  - **Gap:** the Capture intake only accepts png, jpeg, heic, heif and pdf (`src/features/rfqs/lib/clarifications.ts:135`). WebP or GIF images shared from WhatsApp land in the sheet and are then rejected as "can't be added".
  - Excel and Word files (common for RFQs) can't be shared in at all.
- **Not present:**
  - `shortcuts`: long-press the icon to get Capture, New RFQ or Today.
  - `screenshots`: Chrome's richer install sheet needs them.
  - `launch_handler` / `handle_links`.

### iOS meta (index.html)

- **Present:** `apple-mobile-web-app-capable`, `mobile-web-app-capable`, title "Q-Tech", status-bar `default` and the apple-touch-icon.
- **No `apple-touch-startup-image`:** iPhone launches to a blank white screen, then "Loading" (`src/app/pages/Splash.tsx`). Low value to fix.
- **Viewport is `width=device-width, initial-scale=1.0`:** there is no `viewport-fit=cover` and no `interactive-widget`. Consequences are in section 3.

### Install flow

- **Android:**
  - `src/lib/pwa/install.ts` captures `beforeinstallprompt` and calls `preventDefault()`, which suppresses Chrome's own mini-infobar.
  - "Install" is then offered only in:
    - `src/features/settings/InstallBanner.tsx`, rendered in `SettingsLayout.tsx:81`.
    - The account menu (`src/app/shell/AccountMenu.tsx:47`).
  - Engineers who never open Settings are never nudged.
  - The copy sells "opens full screen". It never says the real reason: **install, then WhatsApp Share lists Q-Tech**. The share target only exists after install.
- **iPhone:**
  - A one-time 15s toast (`src/app/shell/PwaPrompts.tsx:36-40`) plus the Settings banner: "Tap Share, then Add to Home Screen".
  - `isIosSafari` (`install.ts:68-72`) excludes Chrome, Edge and Firefox on iOS, so iPhone users on Chrome get no hint at all. Those browsers can add to the home screen since iOS 16.4.
  - On recent iOS Safari the Share button can sit behind the "•••" menu, so "Tap Share" may not match what they see.
  - The hint only appears inside the signed-in shell. The person signs in in Safari and is then told to add the app to the home screen. The home-screen app has **separate storage on iOS**, so they must sign in again. Nothing tells them that; only the R24 doc does.
  - There is no "Add to Home Screen" item in the account menu on iPhone.

### iPhone and Capture (no share target)

- **The phone empty state** (`src/features/capture/CaptureParts.tsx:183-193`) is clear for text: "Add what you copied. Tap and hold here, then tap Paste", plus Choose photos and Choose files.
- **Missing:**
  - A one-line "how" for the WhatsApp side: hold the message, then Copy; for a photo, save it first, then Choose photos.
  - A **Paste button**. The paste zone is a plain `<textarea>`. When the clipboard holds only an image copied in WhatsApp, iOS may not offer "Paste" in a plain text field, so this needs checking on a device. `navigator.clipboard.read()` behind a button would take images and text, with iOS showing its own Allow Paste prompt.
- **R24 B4-B5 only test text**, not a photo.

## 2. Service worker

File: `src/sw.ts`. Build config: `vite.config.ts:27-56`. Update logic: `src/lib/pwa/updates.ts`.

### 2a. Caching

- **Shell:** Workbox `precacheAndRoute` for `index.html`, every JS and CSS chunk, woff2, icons and brand images. Live: 85 entries, about 1.18 MB brotli on first install.
- **Navigations** get the cached `index.html`, so the app opens offline.
- **No runtime caching:** no Supabase response is ever stored, which is by design and the right call.
- `sw.js` is served `Cache-Control: no-cache` (vercel.json) and assets are immutable.
- **Not precached:**
  - `termLines-*.js`: the PDF renderer, 1.49 MB raw / 490 KB br. It is dropped by the 1 MB filter.
  - Two `render-*.js` chunks (10-12 KB). These are dropped by `globIgnores: ['**/assets/render-*']`, even though they are tiny. The renderer is now named `termLines`, so that ignore rule is out of date.
  - So the first quotation or PO PDF on a phone costs about 500 KB, and it fails offline.

### 2b. Updates

- **Flow:** `registerType: 'prompt'`. The new worker waits, then a sticky "New version available, Reload" toast appears (`PwaPrompts.tsx:18-34`).
- **Reload is blocked while a form is dirty** (`dirtyForms.ts`). Nice.
- **Update checks** happen at startup and on `visibilitychange` after 60 minutes (`updates.ts:39-63`).
- **On a cold start** with no open windows, the waiting worker activates, so most phones pick up a deploy at the next launch. Android and iOS kill background PWAs often.
- **Risk: stale chunks after a deploy.**
  - A long-lived window on the old version asks for the old `render-XXXX.js` / `termLines-XXXX.js`, which are not in the old precache.
  - Vercel's SPA rewrite answers missing `/assets/*.js` with **200 text/html**. I verified this live with `/assets/render-OLDHASH.js`.
  - The dynamic import in `src/features/quotations/pdf/generate.ts:9` and `src/features/purchaseOrders/pdf/generate.ts:9` then fails with a MIME error.
  - Result: "make quotation PDF" breaks until the person reloads. Nothing handles `vite:preloadError` or retries the import.

### 2c. Offline and session

- **Capture:**
  - The draft goes to IndexedDB, debounced 300 ms (`src/app/capture/CaptureProvider.tsx:79-97`). It is kept 7 days and cleared on sign-out (`src/lib/capture/forget.ts`).
  - The offline banner says "Your capture is kept on this phone. Save when you are back online" (`CaptureSheet.tsx:383-387`).
  - The share POST is stored *before* the session check (`src/lib/capture/shareTarget.ts`). The sign-in page then says "Your shared item is safe" (`SignInPage.tsx:98-113`). This is well done.
- **Forms:**
  - `useSubmitForm` (`src/ui/form/useSubmitForm.ts`) keeps typed values on failure, maps network errors to plain words, and reuses the request id so a retry after a lost reply does not duplicate.
  - Nothing is persisted. If Android discards the backgrounded PWA while the engineer is in WhatsApp copying a number, the form is gone.
  - ux/rfqs adds a New RFQ draft store and a leave guard (`src/features/rfqs/lib/intakeDraftStore.ts`, `useLeaveGuard.ts`). That covers the New RFQ screen only.
- **Offline cold start:**
  - **There is no offline screen.**
  - With a stored session and no signal, the role lookup fails (`src/app/AuthProvider.tsx:93-101`, `query.isError` gives `signed-out` + `unreachable`), and `RequireSession` (`src/app/guards.tsx:14`) redirects to `/login`.
  - If the 1-hour access token had expired, supabase-js most likely reports no session, so the plain "Sign in" form shows. This is my reading of the library, not tested.
  - Either way the person sees a password form although they are still signed in. It heals itself within about 30 to 60 seconds of signal returning (token refresh tick or the 60 s poll), but it looks like a logout.
  - Capture is unreachable in that state, except via the share target.
- **Session expiry mid-form:** `RequireSession` navigates away, so typed form data is lost; Capture survives. This is rare, because refresh tokens never time out (see section 4).

## 3. Phone ergonomics from the code

- **16px input text (iOS zoom):**
  - **main:** `controlClass` is `text-sm` = 13px (`src/ui/form/fieldContext.ts:15`). Live login inputs compute to 13px. iPhone zooms on every field focus.
  - **ux/foundation:** adds `max-md:text-[16px]` to `controlClass`. Fixed for TextField, NumberInput, DateInput and Combobox.
  - **Still under 16px on foundation** (`text-sm`, which becomes 15px there):
    - The Capture paste textarea (`CaptureParts.tsx:168`, autofocused when the sheet opens).
    - The New RFQ enquiry textarea (`src/features/rfqs/IntakeParts.tsx:235`).
    - The BurstSheet note input (`src/features/money/expenses/BurstSheet.tsx:836`).
  - Do not "fix" this with `maximum-scale=1`: that breaks pinch zoom.
- **Tap targets:**
  - **Chrome:** the phone chrome uses 44px (`size="touch"`, `--hit-touch`). Tab-bar cells are 44px or more. On coarse pointers `--control-h` is 40, and menu items are 40.
  - **main, too small:**
    - 118 `size="sm"` buttons at 28px. This includes the Dialog close X (`src/ui/Dialog.tsx`).
    - SegmentedControl filter chips at 26px (`src/ui/SegmentedControl.tsx:74`).
    - DateInput's calendar button at 28px (`src/ui/form/DateInput.tsx:131`).
    - Capture checkboxes at 16px (`CaptureParts.tsx:411,430`).
    - `tel:` and `mailto:` links at 24px (`src/features/companies/CompanyPage.tsx:392-397`).
  - **ux/foundation:** sm buttons and segments become 40 on touch.
  - **Still small on foundation:** the DateInput calendar button, the Capture checkboxes and the `tel:` links.
- **Sticky bars and safe area:**
  - The bottom tabs (`src/app/shell/MobileChrome.tsx:80`), the Dialog footer (`Dialog.tsx:165`) and BurstSheet (`BurstSheet.tsx:420`) use `env(safe-area-inset-bottom)`.
  - **index.html lacks `viewport-fit=cover`, so the inset is always 0 and this code does nothing.** iOS letterboxes instead, which is safe but leaves a dead strip.
  - The RFQ phone sticky bar (`src/features/rfqs/RfqHeaderBlock.tsx:352`) and the Capture footer have no inset.
  - Toasts are pinned at `bottom-[76px]` (`src/ui/Toast.tsx:112`).
- **Bottom tab bar:**
  - main: 6 tabs for admin and sales; at 12px the labels fit at 375.
  - money-today: 5 tabs, Reports moved into Money.
  - foundation: count badges, and `minmax(min-content,1fr)` so "Companies" never clips.
  - Hidden via `hideTabs` on screens with their own sticky bar (`MobileBarContext.tsx`).
- **Keyboard:**
  - No `visualViewport` handling anywhere and no `interactive-widget` in the viewport meta.
  - The shell is `h-dvh` (`AppShell.tsx:61`). The Capture sheet is `max-md:h-dvh` (`CaptureSheet.tsx:583`) and Dialog sheets are `max-h-[calc(100dvh-16px)]`. `dvh` does not shrink for the on-screen keyboard (iOS, or Android Chrome 108+ by default).
  - So the Save button in the Capture footer, Dialog footers and BurstSheet sits **under the keyboard**, and people must dismiss it to save.
- **Input types:**
  - Amounts use `inputMode="decimal"` (`NumberInput.tsx:63`, RecordPayment, Expense, FX).
  - Phone fields use `type="tel"`; Company Profile and My Details have `autocomplete="tel"`. Email fields use `type=email` with inputMode email.
  - The login form has `autocomplete="username"` / `"current-password"`, and Change password uses `new-password`.
  - Business fields correctly use `autocomplete="off"`.
  - Search fields mostly lack `type="search"` / `enterKeyHint`. Minor.
- **Dates:**
  - DateInput is typed day-first ("27 nov") with the full keyboard (`inputMode="text"`). The native picker sits behind a 28px icon and is opened with `showPicker()`. On a phone the picker should be the main path.
  - BurstSheet uses a native `type="date"` (`BurstSheet.tsx:805`).
- **Pull-to-refresh:**
  - None. `<main>` is an inner scroller (`AppShell.tsx:70`), so Chrome's pull-to-refresh never fires, and iOS home-screen apps have none.
  - Combined with `refetchOnWindowFocus: false` globally (`src/lib/queryClient.ts:8`), **coming back to the app from WhatsApp shows stale lists** until you change tab. Only the session is re-checked on focus (`AuthProvider.tsx:65`).
- **Scroll restoration:**
  - BrowserRouter has no ScrollRestoration, and `<main>` persists across routes. Nothing resets or restores its `scrollTop`.
  - Likely result: a detail page can open part-way down, and Back does not reliably return to the list position. This needs checking on a phone.
  - DataTable restores only the focused row (`src/ui/DataTable.tsx:290-316`).
- **Android Back:**
  - The MobileBar Back uses the history index with a fallback when the screen was opened from a link (`MobileChrome.tsx:11-26`). Good.
  - **The system Back button ignores sheets.** Radix dialogs push no history entry, so Back leaves the page under an open Dialog and loses its typed input.
  - The Capture sheet lives in the shell provider, so Back changes the page *behind* it while it stays open. On the first screen, Back exits the app.
  - No `popstate` / `beforeunload` handling exists on main (ux/rfqs adds `beforeunload` for New RFQ only).
- **Deep links from WhatsApp:**
  - In-app links survive sign-in: `RequireSession` passes `from`, and `SignInRoute` returns there (`routes.tsx:43-47`).
  - Android WebAPK opens in-scope links in the installed app. iPhone always opens Safari, which needs a separate sign-in.
  - Outbound, the chase and reminder flows only copy text: "Copy and mark reminded" in `src/features/money/payments/ReminderPanel.tsx:206,287` and `src/features/orders/GoodsChaseDialog.tsx:70,123`. Then the person switches to WhatsApp, finds the chat and pastes.
  - A `https://wa.me/<number>?text=` button would open the right chat with the text filled in. The contact phone is already in the draft (`ReminderPanel.tsx:246`).

## 4. Login on phones

- **Password managers:**
  - Correct `autocomplete`, `name` and `type` on both fields, plus a show-password toggle (`src/app/pages/SignInPage.tsx:120-151`).
  - Inputs are 13px on main, so iPhone zooms in on the email field.
- **Session length:**
  - supabase-js defaults: localStorage, `autoRefreshToken` (`src/lib/supabase.ts:39`).
  - `supabase/config.toml` sets `jwt_expiry` 3600 and leaves `[auth.sessions]` commented out, so there is no timebox or inactivity limit. **People stay signed in until they sign out** (check that the hosted project's dashboard matches).
  - No "remember me" is needed.
  - Rotation is on with `refresh_token_reuse_interval = 10` (`config.toml:178-181`). On flaky mobile data, a refresh whose reply is lost and that is retried more than 10 s later can be refused as reuse, which signs the person out. Raising it (free setting) is cheap insurance.
- **No magic link and no "forgot password":** the admin resets. That is right for an iPhone home-screen app, because email links open Safari, not the installed app.
- **iPhone caveats:**
  - Safari tabs lose localStorage after 7 days unused (ITP); the home-screen app does not. This is another reason to push install.
  - The admin's sign-in message (`src/features/settings/PasswordDialog.tsx:46`) links `/login`. It should also say "on iPhone: Add to Home Screen first, then sign in there".

---

## Top 12 fixes, ranked by value

All cost $0.

| # | Fix | Effort | Where |
|---|---|---|---|
| 1 | **Merge ux/foundation, then finish its leftovers.** Make every phone input 16px: the Capture textarea, New RFQ enquiry textarea and BurstSheet note. Simplest is one rule in `index.css`: `@media (max-width:767px){input,textarea,select{font-size:16px}}`. Make the DateInput calendar button and Capture checkboxes 44px, and the `tel:` links 44px tall. | S | `src/ui/form/fieldContext.ts`, `src/index.css`, `src/features/capture/CaptureParts.tsx:168,411,430`, `src/features/rfqs/IntakeParts.tsx:235`, `src/features/money/expenses/BurstSheet.tsx:836`, `src/ui/form/DateInput.tsx:131`, `src/features/companies/CompanyPage.tsx:392` |
| 2 | **Android Back closes the open sheet.** While the Capture sheet, a Dialog bottom sheet, BurstSheet, RowActionSheet or the palette is open on a phone, push a same-URL history entry (`navigate(loc, {state:{sheet:1}})`). Back then closes it instead of leaving the page and losing the input. | M | new `src/lib/useBackToClose.ts`; `src/ui/Dialog.tsx`, `src/features/capture/CaptureSheet.tsx`, `src/app/capture/CaptureProvider.tsx`, `src/features/settings/RowActionSheet.tsx`, `src/ui/CommandPalette.tsx`, `BurstSheet.tsx` |
| 3 | **Deploys must not break the PDF.** Handle `vite:preloadError` and failed `import()` in the two PDF `generate.ts` files by applying the waiting update or reloading, with a toast ("Q-Tech was updated, reloading to make the PDF"). Drop the outdated `render-*` globIgnore so the 10 KB render chunks are precached. Optionally apply a waiting update on the next tab change when no form is dirty. | S | `vite.config.ts:39`, `src/main.tsx`, `src/lib/pwa/updates.ts`, `src/features/quotations/pdf/generate.ts:9`, `src/features/purchaseOrders/pdf/generate.ts:9` |
| 4 | **Keep Save above the keyboard.** For Android Chrome, add `interactive-widget=resizes-content` to the viewport meta so `dvh` shrinks. For iOS, a 15-line `visualViewport` listener sets `--kb` (the keyboard height), and sheet footers and sticky bars use it as a bottom offset. | S–M | `index.html:5`, new `src/lib/pwa/keyboard.ts` (called from `src/main.tsx`), `src/ui/Dialog.tsx`, `CaptureSheet.tsx:583`, `BurstSheet.tsx:296,420`, `RfqHeaderBlock.tsx:352` |
| 5 | **"No signal" is not "signed out".** Cache the last resolved `{id,name,role}`. When a stored session exists and the lookup fails with a network error, render the shell with an offline banner ("No connection. You're still signed in; Capture still works.") instead of redirecting to the password form. Retry on `online`. Also fixes R24 step A9. | M | `src/app/AuthProvider.tsx:93-101`, `src/app/guards.tsx:14`, `src/app/pages/SignInPage.tsx` |
| 6 | **Refresh when the app comes back.** Enable `refetchOnWindowFocus` (TanStack uses `visibilitychange`) at least for touch or standalone. `staleTime` 30 s already limits the cost. Optionally add a "Refresh" item on the phone bar, since there is no pull-to-refresh. | S | `src/lib/queryClient.ts:8`, `src/app/shell/MobileChrome.tsx` |
| 7 | **Sell the install on Android, because it unlocks WhatsApp Share.** Show a one-time, dismissible install nudge on Today when `canPrompt`, worded "Install Q-Tech to share WhatsApp messages and photos straight in". Use the same copy in the Settings banner. | S | `src/app/shell/PwaPrompts.tsx`, `src/features/settings/InstallBanner.tsx:43`, `src/lib/pwa/install.ts` |
| 8 | **iPhone install clarity.** Show the Add-to-Home-Screen hint on the sign-in page too, and say "you'll sign in once more inside the app". Cover Chrome and Edge on iOS. Word the steps for the "•••", then Share, then Add to Home Screen layout. Add an "Add to Home Screen" item to the account menu on iOS. Put the steps in the admin's sign-in message. | S | `src/lib/pwa/install.ts:68-72`, `PwaPrompts.tsx:39`, `InstallBanner.tsx:67`, `SignInPage.tsx`, `AccountMenu.tsx:47`, `src/features/settings/PasswordDialog.tsx:46` |
| 9 | **"Open in WhatsApp" for chase and reminder drafts.** Add a `wa.me/92…?text=` link next to "Copy and mark", so one tap opens the right chat with the message filled in (and marks the item reminded or chased). It is a top-level link: no CSP change. | S–M | `src/features/money/payments/ReminderPanel.tsx:206-290`, `src/features/orders/GoodsChaseDialog.tsx:63-124`, `src/features/rfqs/ChaseParts.tsx`, `ClarificationsPanel.tsx` |
| 10 | **iPhone Capture paste.** Add a "Paste" button using `navigator.clipboard.read()` (images and text), plus one line on how to copy in WhatsApp. Accept `image/webp` (and gif) in the intake, since the share target already lets them in. Add a photo-paste step to R24. | S–M | `src/features/capture/CaptureParts.tsx:183-193`, `src/features/rfqs/lib/clarifications.ts:135`, `docs/testing/R24_DEVICE_TEST.md` |
| 11 | **Forms survive an app kill or session loss.** Extend ux/rfqs' draft and leave-guard pattern to the other long phone forms: Record payment, Expense burst and the company dialogs. When the session ends while `hasDirtyForms()` is true, show a sign-in overlay rather than navigating to /login. | M | `src/ui/form/useSubmitForm.ts`, `src/lib/pwa/dirtyForms.ts`, `src/app/guards.tsx`, ux/rfqs `src/features/rfqs/useLeaveGuard.ts` + `lib/intakeDraftStore.ts` as the template |
| 12 | **Scroll position.** Reset `<main>` scrollTop on forward navigation and restore it on Back. Keep a map in sessionStorage keyed by `location.key`. | S | `src/app/shell/AppShell.tsx:70` |

### Smaller items (S each)

- Add `viewport-fit=cover` so the existing `env(safe-area-inset-*)` code works, or delete it; test on an iPhone with a home bar (`index.html`, `MobileChrome.tsx:80`, `Dialog.tsx:165`).
- Add `shortcuts` (Capture, New RFQ, Today), `screenshots` and a 192 maskable icon (`public/manifest.webmanifest`).
- Raise `refresh_token_reuse_interval` and confirm the hosted project has no session timebox (`supabase/config.toml:181`, dashboard).
- Add `type="search"` / `enterKeyHint="search"` on list filters (`src/ui/TableFilter.tsx:44`, `src/features/rfqs/board/BoardPage.tsx:213`).
- Run R24 on a real Android and iPhone; it is still blank.
