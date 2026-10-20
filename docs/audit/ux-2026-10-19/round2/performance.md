# Performance audit: qtech-crm-v2

- **Commit:** origin/main `33d10e7`, audited 2026-10-20. Read-only: nothing in the repo was changed.
- **Method:**
  - A production build in a throwaway worktree, built with the public Supabase URL and a dummy key so the bundle matches production.
  - Source-map breakdown of the entry chunk.
  - Lighthouse 12.8.2 run against the live `/login` page.
  - A code trace of every screen, from route to hook to `api.ts`, plus a read of the migrations.
- **What the numbers are:** request counts and "rounds" come from reading the code, not from a recorded trace. A **round** is one sequential trip to Supabase (Singapore). On Pakistani 4G a round costs about 300–600 ms, more on patchy signal.
- **Spot-checked against source:**
  - The invalidation await (`invalidation.ts:220`)
  - The two stages of `loadTodayData` (`today/api.ts:405-428`)
  - The legs gate (`orders/hooks.ts:32`)
  - The `restoreStamp` loop
  - `listRfqValues`
  - The policy pattern (128 `create policy`, none wraps the role check in `(select …)`)

---

## Verdict

**Perceived speed on a mid-range Android over 4G: 4 / 10.**

**What works:**
- The app shell is solid. Routes are lazy-loaded and the PDF renderer is lazy.
- A service worker precaches the shell, so opens after the first are not bound by JS download.
- The login page has TBT 20 ms and CLS 0.

**What hurts:**
1. **Data waterfalls.** Most screens need 2–6 sequential rounds before they are complete.
2. **The Today pipeline runs on every screen.** The shell's nav counts run the full Today load, about 20–28 requests in at least 4 rounds, under every screen.
3. **Saves are slow.** Every save waits until all of its invalidated queries have refetched, which often includes the full Today reload. Every tap of Save, Snooze or Issue costs about 1–3 s, and issuing a quotation about 5–9 s.
4. **No cache survives a cold open.** Every app open starts from empty skeletons.
5. **Patchy network is handled badly.** A cold open on a flaky network can drop the person on the sign-in page with "unreachable", or on an endless splash when the phone is offline.

The bundle is a second-order problem. The network round trips are the first-order one.

---

## 1. Bundle

### 1.1 Sizes

| Asset | Raw | Gzip | Note |
|---|---|---|---|
| **Entry** `index-*.js` (the only script in index.html; no modulepreload) | 952 KB | **285 KB** (Vite) / 278 KB (budget script, gzip -9) | 290 KB brotli on the wire, live |
| CSS `index-*.css` | 78 KB | 15.5 KB | Render-blocking: about 600 ms on Lighthouse mobile |
| Fonts on first paint (Geist 400, 500, 600 woff2) | 103 KB | n/a | Geist Mono 400/500 adds 20 KB where used |
| Money chunk | 192 KB | 52.6 KB | lazy |
| RFQs chunk | 174 KB | 53.2 KB | lazy |
| Orders chunk | 118 KB | 34.8 KB | lazy |
| Companies chunk | 61 KB | 17.5 KB | lazy |
| Intake chunk | 59 KB | 17.9 KB | lazy |
| Today chunk | 49 KB | 15.7 KB | lazy |
| RecordPaymentDialog chunk | 52 KB | 15.8 KB | lazy |
| CaptureSheet chunk | 39 KB | 11.6 KB | lazy |
| **PDF renderer** `termLines-*.js` (react-pdf) | 1,492 KB | **507 KB** | Lazy, and correctly kept out of the precache. Loaded only through the `pdf/render` dynamic imports. |
| All JS (72 files) | — | 1,077 KB | 570 KB without the PDF chunk |
| SW precache (85 entries) | 2,473 KB | ≈1,050 KB brotli | **PNGs are 416 KB of it (40%)** |

### 1.2 What is in the entry chunk (952 KB raw, from source maps)

- **react-dom:** 127 KB.
- **Supabase:** about 219 KB.
  - auth-js 104 KB
  - realtime-js plus phoenix 58 KB. Realtime is never used: there is no `.channel(`.
  - storage-js plus iceberg 28 KB
  - postgrest-js 17.5 KB
  - the supabase-js wrapper 11 KB
- **zod 53 KB, react-hook-form 38 KB and @hookform/resolvers.** These are only there for the 2-field `SignInPage`, which is imported eagerly in `routes.tsx:8`.
- **Feature code the shell pulls in: about 120 KB.**
  - rfqs 52 KB, today 33 KB, orders 21 KB, companies 14 KB.
  - Includes `today/rules.ts`, `today/api.ts`, `orders/api.ts`, `rfqs/api.ts`, `companies/api.ts` and `ranking/reasons.ts`.
  - They come in through `useNavCounts.ts:3-5` and `CaptureProvider`.
- **TanStack Query 37 KB.**
- **UI libraries:**
  - lucide 26 KB
  - tailwind-merge 20 KB
  - `DataTable` 15 KB
  - cmdk 12 KB
  - Radix plus floating-ui about 55 KB

### 1.3 Code splitting

**Lazy:**
- The six destinations: Today, Companies, RFQs, Money, Orders, Reports
- Intake and Capture
- All the settings sub-pages

**Eager:**
- `SignInPage`
- `SettingsLayout` and `SettingsHome`
- The shell
- Every feature module that `useNavCounts` reaches

Lazy routes use `Suspense fallback={null}`. On a first visit, before the precache finishes, the content area stays blank while a 15–53 KB chunk downloads.

**PDF libraries:** not loaded eagerly. The 507 KB gzip chunk downloads on the first "Issue quotation" or "Issue PO". That is about 3 s at 1.5 Mbps, and nothing preloads it while the dialog is open.

### 1.4 Fonts

- **What is in place:**
  - Self-hosted latin woff2 files.
  - `font-display: swap`.
  - CSP `font-src 'self'`.
  - Precached by the SW.
- **Gaps:**
  - No `<link rel=preload>`, so the fonts are found only after the CSS is parsed and text renders.
  - Three separate Sans weights (103 KB). A single variable Geist file, or dropping the 500 weight, would cut both requests and bytes.
  - The build also emits `.woff` files (the PDF fonts). They are not precached and not on the critical path.

### 1.5 Images

| File | Size | How it is used |
|---|---|---|
| `brand/logo-mark.png` | **131 KB** | Shown at **28×28 px** on every mobile screen (`MobileChrome.tsx:52`) |
| `brand/logo-wordmark.png` | **85 KB** | **The LCP element of the login page** (181×44). Also the TopBar (124×30). |
| `icon-512.png` | 98 KB | Only needed for install, but precached |
| `icon-maskable-512.png` | 77 KB | Only needed for install, but precached |

The PDFs reuse the wordmark, so keep a hi-res copy for them and serve a small one in the UI.

### 1.6 Bundle budget in CI: it under-measures

- `scripts/bundle-budget.mjs` fails the build if the initial JS is over 300 KB gzip. That part is good.
- **The problem:** the `build` job in `ci.yml:79-82` runs `npm run build` **without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`**.
  - `getSupabase()` then constant-folds to `null` (`lib/supabase.ts:57`).
  - `createClient` and all of supabase-js are tree-shaken away.
- **Measured effect:** without the variables, the same commit builds a 724 KB / 225.6 KB gzip entry. With them it builds 952 KB / 285 KB.
- **So the gate reports about 220 KB, while production is 278 KB.** The real headroom is about 22 KB, not about 80 KB.
- **Fix:** set dummy `VITE_` variables in that step (S).

---

## 2. Data loading per screen

### 2.1 Problems that affect every screen

**1. The session gate.**
- `AuthProvider.tsx:22-30` resolves `users` + `current_user_role()` (2 requests, 1 round) before anything inside the shell renders. Until then the user sees `Splash`.
- If the access token has expired (`jwt_expiry` 3600 s, so most opens), auth-js first makes a refresh round trip.
- The first request to supabase.co also pays DNS, TCP and TLS setup.
- **So a cold open costs 2–3 rounds before any screen data is requested.**
- There is no `preconnect` hint in `index.html`.
- **Rechecks after the first load:**
  - Every 60 s.
  - Twice on focus: `refetchOnWindowFocus: 'always'` plus a manual `focus` listener (`:65`, `:79`).
  - At most every 5 s after any data request (`:73-77`).
  - Each recheck is 2 requests.

**2. The shell loads Today on every screen.**
- `AppShell` → `useNavCounts.ts:18-20` runs the full `useTodayView`, plus `useOpenRfqs` (2 fetchAll) and `useActiveOrderCount`.
- `useTodayData` has `refetchOnMount: 'always'` (`today/hooks.ts:28`), so opening Today fetches it again.
- `buildToday` runs twice: once in the shell, once on the screen.
- **Cost by role:**

  | Role | Today requests | Plus the shell's other queries |
  |---|---|---|
  | Admin | about 25 | about 28 in all |
  | Sales | about 19 | |
  | Engineer | about 15 | |

- These requests run under **every** screen and compete for bandwidth with that screen's own requests.

**3. Saves wait for all of their refetches (an invalidation storm).**
- `invalidateAfter` returns `Promise.all(invalidateQueries…)` (`invalidation.ts:220-222`). All 83 `onSuccess` handlers return it.
- TanStack v5 waits for that promise, so `mutateAsync` and `isPending` stay busy until every active refetch is done.
- `qk.today.all` is almost always active (see problem 2), so most writes include the full Today reload.

| Write | What it refetches | Requests |
|---|---|---|
| `order.update` (about 15 order-page actions) | Order page (about 16), lists, Today (about 24), session (2) | **about 45, about 4 rounds of spinner per tap** |
| `po.issue` (with the dialog's follow-ups) | | about 90 |
| `expense.save` | | 30–50 |
| `invoice.create`, `invoice.update`, `payment.record` | | 35–45 each |
| `today.chase` | 6 root prefixes | about 40 |
| `quote.save` | The whole RFQ page (about 21), board, candidates | |
| `attachment.*` | The whole RFQ page | |
| `site.*`, `contact.*` | The whole company detail, including history and supplier record | |

- `bank.tick` is the exception and a good model: it is optimistic and debounced.
- **Correctness gap:** `order.update` does not invalidate `money.orderCosts`, so the Margin panel can go stale after an item or leg edit.

**4. Cache settings.**
- Global defaults: `staleTime` 30 s, `gcTime` 5 min, `retry` 1, `refetchOnWindowFocus` false.
- Nothing is persisted, so every cold PWA open shows empty skeletons.
- No realtime subscriptions anywhere. That is intentional (`invalidation.ts:14`).
- `placeholderData` is used only on the closed RFQ board. Without it, the month pager blanks every report on each change.
- Month-end queries all use `staleTime: 0`.
- These queries use `staleTime 0` or `gcTime 0` and refetch every time a dialog opens:
  - Quote items and price memory
  - Next order, invoice and PO numbers
  - Last terms
  - PO prefill

**5. `fetchAll`** (`lib/supabase.ts:80`) reads pages of 1,000 rows one after another, so each extra 1,000 rows adds a round. Several paged view reads have **no `ORDER BY`**, so rows can be skipped or repeated once a result passes 1,000:
- `margins/api.ts:11`
- `orders/api.ts:693`
- `today/api.ts:119-124`
- `companies/api.ts:51`

### 2.2 Per screen (cold cache, admin, in-app navigation; add the shell's about 28 requests on a hard load)

| Screen | Requests | Critical path | Main problems |
|---|---|---|---|
| **Today** (`today/api.ts:405-428`) | about 25 + target 1 + desktop context pane about 16 = **about 45** | **at least 5 rounds** (session, stage 1, then a 3-round stage 2) | **Stage 2 waits for all of stage 1.** `loadInquiries` takes 3 sequential rounds. `loadOrders` and the costs chunk loops run one chunk after another (`:245`, `:334`). **Whole-table reads:** every company (fetchAll, used only for names); all of `v_supplier_stats`; every awaiting inquiry and open question on all RFQs ever, closed ones included, filtered in JS (`:100`, `:149`, grows without limit); `order_receivables()` for every order ever, keeping only the overdue ones. **Bug:** the actors read (`:128`) is not paged, so it truncates at 1,000 rows. |
| **RFQ board** (`board/api.ts`) | about 5 | 1 round + pages | `listRfqValues` fetches **every quoted `rfq_items` row ever**, open and closed (`:138-146`). The closed count runs an exact count over the view even on the Open tab. Phone cards are not virtualised. |
| **RFQ page** (`RfqDetailScreen.tsx`) | **about 29 + N** | Header and items after 2 rounds; suggestions after 4 or more | **One `supplier_item_memory` RPC per distinct item**, each scoring every candidate supplier's whole history (`rfqs/api.ts:53-79`). The key contains the supplier set, so asking a supplier refires all N calls. The candidates prefetch is 2 whole-table fetchAll calls. **Photos:** thumbnails are the full 1800 px JPEG; signed URLs sit under `rfqs.detail`, so any write re-signs them and every photo downloads again. **CPU:** `ItemsPanel` and `suggestSuppliers` are O(S²·I) and partly unmemoised (minor). |
| **Issue quotation** (from the RFQ page) | — | **13–15 sequential rounds, about 5–9 s** | N item updates → RPC → `getQuotation` → awaited invalidation (including Today) → `loadPdfData` (4 rounds) → cold 507 KB PDF chunk → upload → update. |
| **Orders list** (`orders/api.ts:668-701`) | 5 | 1 round + pages | Every order, state, assignment and money row ever is loaded, then filtered in JS, including "My jobs" for engineers and the Done/Cancelled history. |
| **Order page** (`OrderDetailScreen.tsx`) | **about 30** | **5–6 rounds** | Header, then lookups (2 rounds). Items, then brands. **Legs are gated on items for no reason** (`hooks.ts:32`; items are used only in `select`). POs wait for leg ids. Attachments, costs and fx mount only after the lists load, so they start at round 4. One supplier-median query per leg. `orders select('*')` ships `legacy_source`. |
| **Issue PO** (`IssuePoDialog.tsx:153-178`) | about 90 with storms | **about 11 rounds** before the dialog closes | Includes a redundant `updateLeg` (the 0067 trigger already sets `expected_on`) and a 4-round `loadPdfData`. |
| **Companies list** (`companies/api.ts:44-73`) | 4 fetchAll | 1 round + pages | Fetches **every row of `rfqs` and `orders`** just to count them per company. |
| **Company page** | customer about 12; supplier 25–30 | 3–4 rounds | Everything waits for `useCompany`. History fetches items in batches of 80 and calls `order_receivables()` for every order in the database. Brand quotes fetch all of the supplier's quote lines. |
| **Money tabs** (`MoneyFrame.tsx:70-74`) | +5 on every tab | — | Every tab loads the **whole GST register (all years, `select('*')`)**, all receivables (3 requests) and the month-end status, only to show tab counts. |
| **Money: Receivables** | about 9 | 4 rounds | `.in()` lists of invoice numbers and company ids for every order with a balance. **This will return HTTP 400 (URL too long) after a few hundred orders** (`payments/api.ts:39,76`). The unpaged `order_receivables` RPC is silently capped at 1,000 rows. |
| **Money: Expenses** | about 11 | 2 rounds | `select('*')` ships `legacy_source`. |
| **Money: Bank** | about 13 | 4 rounds | 3 fetchAll `select('*')`, then lookups, then leg labels (2 steps). |
| **Money: Margins** | 7 + companies ÷ 80 | 2 + companies ÷ 80 rounds | Company chunks are read in a sequential `await` loop (`margins/api.ts:17-19`). Fetches the whole `orders` table to drop cancelled ones. Renders an unvirtualised `<ul>` of every order. |
| **Month end** (`monthEnd/**`) | **about 30** | **about 6 rounds** | `ReportsList` mounts only after status and close state load, then fires 6 reports. **The same month snapshot is fetched 6 times**, once per report chain. Avoidable sequential awaits in `monthEnd/api.ts` at `:166-167`, `:184-185`, `:287-290`, `:322-323`. Every tab switch reloads everything (`staleTime: 0`). |
| **Undo stamp** (`invoices/api.ts:213-218`) | N | N rounds | One awaited update per invoice: a 20-invoice undo takes about 6–12 s. |
| **Search / palette** | 1 RPC | — | Fine: 150 ms debounce and AbortSignal. A 250 ms debounce would suit touch screens better. |

**Pagination and virtualisation.**
- No list is paged on the server.
- `DataTable` virtualises desktop rows above 80, but **phone cards (`mobileRow`) are not virtualised** (`ui/DataTable.tsx:204`). That covers the Orders list, GST register, Receivables, Expenses and the RFQ board.
- Over 2–3 years of history these lists will render hundreds of cards on phones.

---

## 3. Live login page (Lighthouse 12.8.2, simulated throttling) and the service worker

| | Mobile (Slow 4G 1.6 Mbps / 150 ms RTT, 4× CPU) | Desktop |
|---|---|---|
| Performance score | **85** | 100 |
| FCP | **3.1 s** (observed unthrottled: 1.27 s) | 0.5 s |
| LCP | **3.5 s**: `brand/logo-wordmark.png` (85 KB) | 0.5 s |
| TBT | 20 ms | 0 ms |
| CLS | 0 | 0.001 |
| Speed Index / TTI | 3.1 s / 3.5 s | 0.5 s / 0.5 s |
| Total bytes | 510 KiB (JS 290 KB br, logo 85 KB, fonts 104 KB, CSS 16 KB, icons 23 KB) | 511 KiB |

**Lighthouse flags:**
- 200 KiB of unused JS on `/login`. This is everything the shell imports.
- 72 KiB of image savings from the logo.
- About 600–750 ms of render-blocking CSS.

**Why FCP is late:** `index.html` has an empty `#root`, so nothing paints until the 290 KB script has downloaded and run.

**Hosting:** served from Vercel's `bom1` (Mumbai) edge, with `immutable` caching on `/assets/*` and `no-cache` on `sw.js`. Accessibility and best-practices both score 100.

### 3.1 Service worker (`src/sw.ts`)

- **Strategy:** `injectManifest`. It precaches the app shell: JS, CSS, woff2, PNG and the manifest. In total that is 85 entries, 2.47 MB raw, about 1.05 MB brotli.
  - PDF chunk: excluded by size.
  - `render-*` chunks: excluded by glob.
  - Navigations: answered with the cached `index.html`.
  - Runtime caching: none. Supabase is never touched.
- **Registration:** through workbox-window after page load. An update waits for a "Reload" toast and never interrupts a dirty form. This is well designed.
- **Cost on first visit:** about 1.05 MB of background download right after the first load, 40% of it PNGs that are oversized or only needed for install.

### 3.2 Offline and patchy-network behaviour

- **Fully offline:**
  - The shell opens from the precache.
  - `navigator.onLine` is false, so TanStack (`networkMode: 'online'`) pauses the session query.
  - The person sees **"Loading" forever** with no message. If the access token also needed a refresh, the result depends on how auth-js handles the failed refresh; the likely outcome is the sign-in page. No data is ever shown offline.
- **Patchy (online but failing):**
  - `resolveUser` fails after 1 retry.
  - **The person is sent to `/login` with the "unreachable" notice**, even though they have a valid session.
- **Capture:** the Capture sheet's IndexedDB queue (R22) is the only offline-tolerant feature.
- **Fix:** persist the query cache plus the last resolved user, then render from them and revalidate (improvement 3 below).

---

## 4. Postgres (migrations 0001–0068)

**Scale.** The legacy history is small: 176 RFQs and 37 orders in total. At that pace no view is slow enough to notice for 2–3 years. The issues below start to show in the low thousands of rows. Supplier-side tables (inquiries and quote lines) grow 10–20× faster than RFQs.

**1. The role check runs once per row in every security policy (biggest lever).**
- All 128 policies call `public.current_user_role()` or `auth.uid()` directly.
- None uses the `(select …)` wrapper, which Supabase's `auth_rls_initplan` lint asks for. Verified: zero matches.
- `current_user_role()` is SQL, STABLE, SECURITY DEFINER and has `set search_path=''`, so Postgres cannot inline it. It runs a `users` lookup **for every row of every table read**, including inside invoker views and their correlated subqueries.
- `v_order_state` adds about 3 more calls per row (0016:44).
- An admin Today load at thousands of rows would make 10⁵ or more calls, which is seconds of CPU on the free tier.
- **Fix:** one migration that does `ALTER POLICY … USING ((select public.current_user_role()) …)`. Expect roughly 5–10× less CPU on invoker views. The S14 role tests confirm access is unchanged.

**2. The views compute everything because the app filters on computed columns.**

| View | Problem | Who reads it this way |
|---|---|---|
| `v_order_state` | About 8 correlated subqueries per order for admin, plus a join to all of `v_order_money` | Today, the Orders list and the active count filter on `lifecycle` / `goods_state` / `invoicing_state`, so every order is computed on every read |
| `v_supplier_stats` (0066:20) | 7 aggregate subqueries per supplier | Read in full in three places: `today/api.ts:124`, `orders/api.ts:609` (needs only `supplier_id`), `rfqs/api.ts:21` |
| `v_inquiry_state` | Recomputes the rfq_items count once per inquiry | Today reads every inquiry ever |
| `v_month_pnl` | Computes `v_month_pnl_live` 3 times, and no month filter can push down | `monthEnd/api.ts:119` reads all months |
| `v_order_money` (0059:111) | Looks up `company_profile` again for every order, and re-reads invoices | |
| `v_rfq_state` | | Fine for `outcome=open` (the expensive columns run only for returned rows). Costly for the history count and `v_report_float` / `v_report_rfq_outcomes`. |
| `v_invoice_state` | Single table, fully pushable | Good |
| `aging_as_of` | One set-based pass | Good |

**3. Matching functions.**
- Affected: `supplier_item_memory`, `customer_price_memory`, `rank_item_quotes`, `po_line_prefill`.
- They score **every** historical quote, PO and leg line of each candidate, using 5–6 SQL helpers that cannot be inlined (`set search_path`), plus regex. There is no prefilter.
- The GIN `model_tokens` indexes (0007:95, 0009:100) and the trigram `item_text_norm` indexes (0024:21-24) are **never used**, because every match wraps the column in a function.
- **Fix:** add an exact prefilter, `model_tokens && tokens OR brand_id = … OR family_id = …`, and batch the per-item RPC into one call. Cost grows with supplier history, so this is the first DB issue users will feel.

**4. Indexes.**
- **Missing indexes that matter: none.** Every join and delete-check foreign key is covered.
- **Unindexed, and fine at this scale:**
  - `created_by` and the other user foreign keys
  - date and `bank_month` filter columns
- **Redundant:** `rfqs_company_idx` (covered by 0034:25) and `supplier_inquiries_supplier_idx` (covered by 0024:25).

**5. Triggers.**
- `audit_row_change` (0013) writes the full old and new row as JSON on 29 tables. That includes `legacy_source` and the quotation and PO `lines`.
- The CPU cost is trivial. **Storage is the risk:** about 40–200 MB a year against the **free tier's 500 MB cap**.
- **Fix:** store only changed keys and skip no-op updates (S).

**6. Month close.** `close_months_through` runs `take_month_snapshot` per month: all the month views as definer. At cutover it must finish within the 8 s statement timeout, so close the months in chunks if needed.

**Side bug found:** `month_end_check_details` `pending` (0064:76-80) lacks the `gst_amount > 0` condition that `month_end_status` has (0058:702-704). GST-exempt invoices are listed but not counted.

---

## 5. Top 12 improvements, ranked by user-visible gain

All are free. None needs a paid service.

| # | What | Where | Gain on 4G | Effort |
|---|---|---|---|---|
| 1 | **Stop making saves wait for refetches.** Fire `invalidateAfter` without awaiting it, or await only the current screen's own key. Use `refetchType: 'none'` for keys that are off screen (Today, board, `companies.all`, `intake.all`). Narrow the broad maps: `attachment.*` → the attachments part; `site/contact.*` → that part; `order.update` → the board + count instead of `orders.lists()`; add `money.orderCosts`. Make snooze optimistic. | `src/features/invalidation.ts:220` and the 83 `onSuccess` sites | Every save, snooze, chase, issue and upload returns **1–3 s sooner**. Removes most background traffic. | S |
| 2 | **Take the Today pipeline out of the shell.** Read nav counts from the cache only (`getQueryData`, or a query with `enabled: false`), or add one cheap `nav_counts()` RPC. Drop `refetchOnMount: 'always'`. This also takes about 120 KB of feature code out of the entry chunk. | `src/app/shell/useNavCounts.ts:18-20`; `today/hooks.ts:28,72` | **20–28 fewer requests and about 4 rounds** competing on every cold open of any non-Today screen. Shrinks every storm in #1. | S (cache) / M (RPC) |
| 3 | **Persist the query cache and the session user.** Use `persistQueryClient` with an IndexedDB or localStorage persister, `maxAge` about 24 h, a buster tied to the build, and a purge on `SIGNED_OUT` or deactivation (next to `forgetDeviceCaptures`). Render from the cached user and data immediately, then revalidate. Don't drop to `/login` when the network is "unreachable" and a session exists; show the cached data with an "offline" banner instead. | `src/lib/queryClient.ts`, `src/app/AuthProvider.tsx` | **Cold opens paint at once** instead of after 3–6 rounds. The app becomes usable on patchy data and offline (read-only). | M |
| 4 | **Slim the session gate.** Add `<link rel="preconnect" href="https://yafbphagorydbitfgfmg.supabase.co" crossorigin>`. Make one RPC that returns user + role. Remove the duplicate focus listener. Raise `ACTIVITY_RECHECK_MS` from 5 s to about 60 s; RLS still blocks a deactivated user. | `index.html`, `AuthProvider.tsx:22-30,65,73-79` | About 1 round plus TLS setup off every cold open; fewer background requests. | S |
| 5 | **Flatten the order page.** Remove the `items !== undefined` gate. Fetch POs by order id. Start attachments, costs and fx at the top of the screen. Use one header request with embeds and explicit columns. Embed brand, supplier and engineer names. | `orders/hooks.ts:32,128`; `OrderDetailScreen.tsx:76-170`; `orders/api.ts:59-76,201-213` | 6 rounds → 2: **about 1.2–2.4 s faster** to a complete order page | S–M |
| 6 | **Slim the Today load.** Filter inquiries and clarifications with `.in('rfq_id', open)`. Drop the all-companies fetchAll (use `companies(name)` embeds). Narrow `v_supplier_stats` to the ids needed. Run the actors and relay reads alongside the inquiry read. Run the chunk loops with `Promise.all`. Page the actors read (fixes the 1,000-row truncation). Later: one `today_facts()` RPC. | `src/features/today/api.ts:64-338` | Today from at least 5 rounds to about 2, and stops growing with all-time history | M (L for the RPC) |
| 7 | **Faster "Issue quotation" and "Issue PO".** Close the dialog when the RPC returns, then build and upload the PDF in the background. Preload `pdf/render` when the dialog opens (507 KB gzip). Have the RPCs return the row and accept prices. Drop the redundant `updateLeg`. Bring `loadPdfData` down to 1–2 rounds. | `IssueQuotationDialog.tsx:221-233`, `IssuePoDialog.tsx:153-178`, `quotations/api.ts:192-260`, `purchaseOrders/api.ts:167-237` | **5–9 s → about 1–2 s** perceived for the most important sales action | M |
| 8 | **Month end.** Read the snapshot once per month under a shared key, or add one `month_end_reports()` RPC. Parallelise the 4 sequential awaits. Don't gate the reports on status. Use `staleTime` 30 s and `keepPreviousData` on the month pager. | `src/features/money/monthEnd/{api,hooks,useMonthEnd}.ts`, `ChecklistPage.tsx:88-362` | About 30 requests / 6 rounds → about 10 / 2. No blank reports when switching months. | M |
| 9 | **RFQ page.** Batch `supplier_item_memory` into one RPC with a key that ignores the asked-supplier set. Add an SQL prefilter (tokens/brand/family) that finally uses the GIN indexes. Move signed URLs out of `rfqs.detail`. Store a small thumbnail at upload (the canvas compressor already exists). Memoise the `ItemsPanel` comparisons. | `rfqs/api.ts:53-79`, `rfqs/hooks.ts:33,162-170`, 0049 / 0066 SQL, `FileBits.tsx:32`, `ItemsPanel.tsx:307-430` | Suggestions arrive 2 rounds sooner. Photos stop re-downloading after every write. Less server CPU as history grows. | S–M |
| 10 | **Defuse reads that grow without limit.** Limit `listRfqValues` to open RFQs. Compute company counts in SQL instead of fetching all `rfqs` and `orders`. Make the Orders list load active orders by default and page the history. Replace MoneyFrame's whole-register read with a counts RPC. Move the receivables `.in()` lookups into the RPC (fixes the URL-length 400). Page `order_receivables`. Add `.order()` to every fetchAll. Use explicit columns instead of `select('*')` (stops shipping `legacy_source`). Virtualise or cap the phone cards. | `board/api.ts:138`, `companies/api.ts:44-73`, `orders/api.ts:668-701`, `MoneyFrame.tsx:70`, `payments/api.ts:39,76`, `ui/DataTable.tsx:204` | Keeps screens at today's speed in years 2–3 and **prevents Receivables and the Money tabs from failing outright** | S–M |
| 11 | **Wrap the role check in RLS policies** with `(select public.current_user_role())` and `(select auth.uid())`. Use `left join lateral` so unused aggregates can be skipped. Compute `v_month_pnl` once. Slim the audit trigger. | One new migration (see §4) | 5–10× less DB CPU on the free tier's shared CPU. Grows in value with data. Protects the 500 MB storage cap. | S |
| 12 | **First visit and first paint.** Put an inline HTML/CSS splash inside `#root` (FCP lands before the 290 KB script runs). Resize `logo-mark.png` (131 KB → about 3 KB at 84 px) and the wordmark (85 KB → about 8 KB at 2×). Keep the hi-res copy for the PDFs. Take the 512 px icons out of the precache. Preload Geist 400. Lazy-load `SignInPage`, which takes zod, RHF and resolvers (about 25 KB gzip) out of the entry. Fix the CI budget build (dummy `VITE_` variables). | `index.html`, `public/brand/*`, `vite.config.ts` globPatterns, `routes.tsx:8`, `.github/workflows/ci.yml:79` | Login LCP **3.5 s → about 2 s**. About 400 KB off the precache. An honest budget gate. | S |

---

## 6. Quick wins (each about an hour or less, S, no behaviour risk beyond what is noted)

1. `invalidateAfter(...)` → `void invalidateAfter(...)` in `onSuccess`, except where a dialog reads fresh data right after `mutateAsync`; check those call sites first.
2. Remove `&& items !== undefined` from `useOrderLegs` (`orders/hooks.ts:32`).
3. Read nav counts from the cache instead of mounting `useTodayView` in the shell. Drop `refetchOnMount: 'always'` (`today/hooks.ts:28,72`).
4. `AuthProvider`: remove the manual `focus` listener and set `ACTIVITY_RECHECK_MS = 60_000`.
5. `index.html`: add the Supabase `preconnect` and an inline "Q-Tech · Loading" splash inside `#root`. The CSP already allows inline styles.
6. Re-export the two logo PNGs at 2–3× display size. Take `icon-512*.png` out of the precache `globPatterns`.
7. `ci.yml` build step: `VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=dummy npm run build`, so the budget measures the real entry chunk.
8. `restoreStamp`: run the updates with `Promise.all`, or use one RPC (`invoices/api.ts:213`).
9. `listRfqValues`: restrict to open RFQs. Today: add `.in('rfq_id', open)` to the inquiry and clarification reads.
10. Run the 4 sequential awaits in `monthEnd/api.ts` and the chunk loops in `today/api.ts:245,334` and `margins/api.ts:17` with `Promise.all`.
11. One migration: wrap the policy role checks in `(select …)`. Drop the 2 redundant indexes.
12. Add `.order('id')` to the fetchAll calls that have none: `margins/api.ts:11`, `orders/api.ts:693`, `today/api.ts:119-124`, `companies/api.ts:51`.

---

## Appendix: how this was measured

- **Worktree:** `git worktree add --detach <scratch>/audit2/perfwt origin/main`, then `npm ci`.
- **Production-equivalent build:** `VITE_SUPABASE_URL=<public project URL> VITE_SUPABASE_ANON_KEY=<dummy> npx vite build --sourcemap`.
- **Without the variables** (as CI builds it): the entry is 724 KB / 225.6 KB gzip.
- **Bundle budget:** `node scripts/bundle-budget.mjs dist` reports initial JS 929.5 KB raw / 277.6 KB gzip, OK. With the CI-style build the same script under-reports.
- **Entry composition:** `npx source-map-explorer@2.5.3 dist/assets/index-*.js --json`.
- **Lighthouse:** `npx lighthouse@12.8.2 https://qtech-crm-v2.vercel.app/login`, default mobile and `--preset=desktop`. The reports are in `audit2/lh/`.
- **Live headers and sizes:** curl (`audit2/live/`). No sign-in; no Supabase endpoint was called.
- **Not measured:** real-device timings, and live request waterfalls behind sign-in. The e2e perf suite (`e2e/perf/perf.spec.ts`) reports request waves for Today and the RFQ page in CI; extending it to the order page and month end would catch regressions in items 5 and 8.
