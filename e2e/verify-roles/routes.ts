/*
 * EVERY route and deep link the app answers, once, as data (verify-roles suite). Update THIS file when a route is added,
 * renamed or redirected; the crawl (roles.spec.ts) visits each line as every role.
 *
 * Written against main AND the UX restructure about to merge (ux/foundation, ux/money-today, ux/orders, ux/rfqs: five tabs,
 * Money in two levels, Reports inside Money). Where the two differ the expectation accepts both, and the line says how.
 *
 *   ok        the role gets the screen (not the no-access page, not "Page not found", not the sign-in page)
 *   new       a route the restructure adds: the screen, or "Page not found" while it is not merged yet
 *   no        the role must not get the screen: the no-access page or "Page not found" (the app shows the no-access page in
 *             place, inside the shell, rather than redirecting; guards.tsx)
 * landsOn     for a redirect: where an allowed role must end up
 * prices      money an ENGINEER may see on this screen by owner decision: 'supplier', 'm3', 'fx'. Since the owner decision of
 *             2026-10-22 (engineers see NO prices: SECURITY_REVIEW M-3) no route grants any: the field stays for a future
 *             decision. Anything that looks like money on an engineer's screen or in their network answers is a failure.
 * Placeholders: {rfq} {order} {company} {supplier} {invoice} {month} {legacyOrder} {job} (the RFQ's job key) {directJob} (the imported order's job key, O-n), filled from the suite's own fixtures.
 */
export type Expect = 'ok' | 'new' | 'no'
export type Allowance = 'supplier' | 'm3' | 'fx'

export interface Opener {
  /** Accessible name of the button that opens the dialog (main and post names in one RegExp). */
  name: RegExp
  /** Roles that must see it. Every other staff role must NOT see it (asserted). */
  roles: readonly ('admin' | 'sales' | 'engineer')[]
  /** Open it and scan the dialog (false: a download or a one-tap action; presence is checked only). */
  open?: boolean
  /** The button may legitimately be missing in some states (e.g. the post-merge one green button by state). */
  optional?: boolean
}

export interface RouteSpec {
  path: string
  admin: Expect
  sales: Expect
  engineer: Expect
  landsOn?: RegExp
  prices?: readonly Allowance[]
  /** Buttons that open dialogs (or are role-gated actions) on this screen. */
  openers?: readonly Opener[]
  /** Accessible names that must be absent for the engineer here (money columns, money actions). */
  engineerAbsent?: readonly RegExp[]
  note?: string
}

const AS = ['admin', 'sales'] as const
const A = ['admin'] as const
const ALL = ['admin', 'sales', 'engineer'] as const
const MONTH_REPORTS = ['pnl', 'categories', 'aging', 'owe', 'gst', 'team'] as const

export const ROUTES: readonly RouteSpec[] = [
  // ------------------------------------------------------------------ shell
  { path: '/', admin: 'ok', sales: 'ok', engineer: 'ok', landsOn: /\/today$/, note: 'role landing' },
  { path: '/login', admin: 'ok', sales: 'ok', engineer: 'ok', landsOn: /\/today$/, note: 'signed in: the sign-in page sends you on' },
  { path: '/today', admin: 'ok', sales: 'ok', engineer: 'ok' },
  { path: '/no-access', admin: 'no', sales: 'no', engineer: 'no', note: 'the bare no-access page' },
  { path: '/nope', admin: 'no', sales: 'no', engineer: 'no' },
  // ------------------------------------------------------------------ RFQs
  { path: '/rfqs', admin: 'ok', sales: 'ok', engineer: 'ok', engineerAbsent: [/Value \(PKR/] },
  { path: '/rfqs?tab=closed', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'old board address; post-merge maps to ?show=closed' },
  { path: '/rfqs?show=prices', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'post-merge board filter' },
  { path: '/rfqs/new', admin: 'ok', sales: 'ok', engineer: 'ok' },
  {
    path: '/rfqs/{rfq}',
    admin: 'ok',
    sales: 'ok',
    engineer: 'ok',
    openers: [
      { name: /^Add item$/, roles: ALL },
      { name: /^(Float to another supplier|Ask more suppliers)$/, roles: ALL, optional: true },
      { name: /^Issue quotation$/, roles: AS, optional: true },
    ],
    // Owner decision 2026-10-22: pricing actions and price columns are admin and sales only.
    engineerAbsent: [
      /^Issue quotation$/, /^Revise quotation$/, /^Mark won$/, /^Open PDF$/, /^Share$/, /^Gross, PKR$/, /^Price, PKR today/,
      /^Add reply/, /^Enter reply/, /^Edit reply/, /^Paste reply/, /^Copy price$/, /^How are prices compared\?$/,
    ],
  },
  { path: '/rfqs/{rfq}?issue=1', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'deep link: Issue quotation dialog (admin and sales; an engineer gets the page without it)' },
  { path: '/rfqs/{rfq}?won=1', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'deep link: Mark won dialog (admin and sales; an engineer gets the page without it)' },
  { path: '/rfqs/{rfq}/extra', admin: 'no', sales: 'no', engineer: 'no' },
  // ------------------------------------------------------------------ Orders
  {
    path: '/orders',
    admin: 'ok',
    sales: 'ok',
    engineer: 'ok',
    openers: [{ name: /^(New order|Repeat a past order)$/, roles: AS }],
    engineerAbsent: [/^Gross \(PKR\)/, /^Value \(PKR\)/, /^Invoicing state$/, /^Payment state$/],
  },
  { path: '/orders?tab=done', admin: 'ok', sales: 'ok', engineer: 'ok' },
  { path: '/orders?invoicing=open&payment=unpaid', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'money filters are ignored for an engineer' },
  {
    path: '/orders/{order}',
    admin: 'ok',
    sales: 'ok',
    engineer: 'ok',
    openers: [
      { name: /^Record payment$/, roles: A },
      { name: /^Create invoice$/, roles: AS, optional: true },
      { name: /^Add line$/, roles: AS, optional: true }, // post-merge: behind the "Edit GST and lines" toggle
      { name: /^(Add leg|Add supplier)$/, roles: AS },
      { name: /^Edit notes$/, roles: AS },
      { name: /^Issue PO/, roles: AS },
      { name: /^More( actions)?$/, roles: AS, open: false },
    ],
    engineerAbsent: [
      /^Add expense/, /^Split line/, /^Edit price/, /^Resolve price basis$/, /^Is GST included/, /^View PO/, /^Re-issue PO/,
      /^Edit GST and lines$/, /Exempt the whole order from GST/, /^Unit net/, /^Line gross/, /^Supplier unit price/,
      /^Unit price \(PKR\)/, /^Total \(PKR\)/,
    ],
  },
  { path: '/orders/{legacyOrder}', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'an imported order (legacy_source set by the import)' },
  { path: '/orders/{order}/extra', admin: 'no', sales: 'no', engineer: 'no' },
  // ------------------------------------------------------------------ Jobs (redesign phase 5; reachable by address until the nav switch)
  {
    path: '/jobs',
    admin: 'ok',
    sales: 'ok',
    engineer: 'ok',
    // an engineer sees the same list, which holds no money for anyone; the one green button starts an enquiry (admin and sales)
    openers: [{ name: /^New enquiry$/, roles: AS, open: false }], // it goes to the intake page: presence only
    engineerAbsent: [/^Value/, /^Gross/, /PKR/],
  },
  { path: '/jobs?chip=history', admin: 'ok', sales: 'ok', engineer: 'ok' },
  {
    path: '/jobs/{job}',
    admin: 'ok',
    sales: 'ok',
    engineer: 'ok',
    // no prices, no money panel, no price-carrying files and no quotation or invoice actions for an engineer
    engineerAbsent: [/^Money for this job$/, /^Send quotation$/, /^Mark won$/, /^Costs/, /^Has prices/, /^Gross, PKR$/, /^Price, PKR today/, /^Enter reply/, /^Edit reply/, /^Paste reply/],
  },
  { path: '/jobs/{directJob}', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'an order with no enquiry: Job O-n, the ruler starts at Order' },
  { path: '/jobs/9999999', admin: 'no', sales: 'no', engineer: 'no', note: 'no such job: the not-found state' },
  { path: '/jobs/{job}/extra', admin: 'no', sales: 'no', engineer: 'no' },
  // ------------------------------------------------------------------ Companies
  { path: '/companies', admin: 'ok', sales: 'ok', engineer: 'ok', openers: [{ name: /^New company$/, roles: ALL }] },
  { path: '/companies?new=1', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'deep link: New company dialog' },
  {
    path: '/companies/{company}',
    admin: 'ok',
    sales: 'ok',
    engineer: 'ok',
    openers: [{ name: /^Repeat order ORD-/, roles: AS, optional: true }],
    engineerAbsent: [/^Money with them$/, /^Receivable/, /^Merge into another company$/],
  },
  { path: '/companies/{supplier}', admin: 'ok', sales: 'ok', engineer: 'ok', engineerAbsent: [/^About the prices$/] },
  // ------------------------------------------------------------------ Money (two levels after the restructure)
  { path: '/money', admin: 'ok', sales: 'ok', engineer: 'no', landsOn: /\/money\/(gst-register|receivables)$/, note: 'main opens GST register, post opens Who owes us' },
  { path: '/money/gst-register', admin: 'ok', sales: 'ok', engineer: 'no', openers: [{ name: /^Create invoice$/, roles: AS }, { name: /^More$/, roles: A, open: false, optional: true }] },
  { path: '/money/gst-register?invoice={invoice}', admin: 'ok', sales: 'ok', engineer: 'no', note: 'deep link: invoice detail dialog' },
  { path: '/money/gst-register?new=1&order={order}', admin: 'ok', sales: 'ok', engineer: 'no', note: 'deep link: Create invoice dialog' },
  { path: '/money/gst-register?attention=1', admin: 'ok', sales: 'ok', engineer: 'no' },
  { path: '/money/gst-register?tcs=1', admin: 'ok', sales: 'ok', engineer: 'no' },
  { path: '/money/receivables', admin: 'ok', sales: 'ok', engineer: 'no', openers: [{ name: /^Record payment$/, roles: A, optional: true }] },
  { path: '/money/receivables?pay=1&order={order}', admin: 'ok', sales: 'ok', engineer: 'no', note: 'deep link: Record payment, admin only (sales get the page without the dialog)' },
  { path: '/money/expenses', admin: 'ok', sales: 'no', engineer: 'no', openers: [{ name: /^Add expenses?$/, roles: A }] },
  { path: '/money/expenses?add=1&order={order}', admin: 'ok', sales: 'no', engineer: 'no' },
  { path: '/money/month-end', admin: 'ok', sales: 'no', engineer: 'no' },
  { path: '/money/month-end?month={month}', admin: 'ok', sales: 'no', engineer: 'no' },
  { path: '/money/month-end/bank', admin: 'ok', sales: 'no', engineer: 'no' },
  ...MONTH_REPORTS.map(
    (k): RouteSpec => ({
      path: `/money/month-end/${k}?month={month}`,
      admin: 'ok',
      sales: 'no',
      engineer: 'no',
      note: 'old report address; post-merge redirects to /money/reports/<key> with the month kept',
    }),
  ),
  { path: '/money/margins', admin: 'ok', sales: 'no', engineer: 'no' },
  { path: '/money/margins?filter=paid-provisional', admin: 'ok', sales: 'no', engineer: 'no' },
  { path: '/money/exceptions', admin: 'ok', sales: 'no', engineer: 'no' },
  { path: '/money/reports', admin: 'new', sales: 'new', engineer: 'no', note: 'post-merge: the one Reports view' },
  ...MONTH_REPORTS.map((k): RouteSpec => ({ path: `/money/reports/${k}?month={month}`, admin: 'new', sales: 'no', engineer: 'no' })),
  { path: '/money/reports/expenses?by=quarter', admin: 'new', sales: 'no', engineer: 'no' },   // 0086: the Expenses report
  { path: '/money/reports/bogus', admin: 'no', sales: 'no', engineer: 'no' },
  { path: '/money/nope', admin: 'no', sales: 'no', engineer: 'no' },
  { path: '/reports', admin: 'ok', sales: 'ok', engineer: 'no', note: 'main: Reports screen; post: redirects to /money/reports' },
  { path: '/reports?range=quarter', admin: 'ok', sales: 'ok', engineer: 'no', note: 'old link with a query string' },
  // ------------------------------------------------------------------ Settings
  { path: '/settings', admin: 'ok', sales: 'ok', engineer: 'ok', engineerAbsent: [/^Exchange rates$/] },
  { path: '/settings/team', admin: 'ok', sales: 'no', engineer: 'no', openers: [{ name: /^Add person$/, roles: A }] },
  { path: '/settings/targets', admin: 'ok', sales: 'no', engineer: 'no' },
  { path: '/settings/categories', admin: 'ok', sales: 'no', engineer: 'no' },
  { path: '/settings/company', admin: 'ok', sales: 'ok', engineer: 'ok' },
  { path: '/settings/details', admin: 'ok', sales: 'ok', engineer: 'ok' },
  { path: '/settings/exchange-rates', admin: 'ok', sales: 'ok', engineer: 'no', note: 'rates are currency amounts: admin and sales (2026-10-22)' },
  { path: '/settings/password', admin: 'ok', sales: 'ok', engineer: 'ok' },
  { path: '/settings/nope', admin: 'no', sales: 'no', engineer: 'no' },
  // ------------------------------------------------------------------ Capture (share target and sign-in return point)
  { path: '/capture', admin: 'ok', sales: 'ok', engineer: 'ok', note: 'opens the Capture sheet' },
]

/** Engineer: words a screen uses for money of the business. Allowed nowhere for an engineer (journeys P03 list, extended). */
export const ENGINEER_MONEY_WORDS = /\b(Invoic\w*|Margins?|Receivables?|Spread|Selling price|Who owes us|Balance|Profit|Payments? (in|received)|Record payment|Expenses?)\b/
/**
 * Engineer: an amount of money in text (Money renders "PKR1,234" with no space; plain strings use "PKR 1,234", "≈ PKR", "Rs"). "Rs" must
 * start a word: a fixture's random name suffix ("VRs37s5xf0") is not rupees.
 */
export const CURRENCY_AMOUNT = /(PKR|(?<![A-Za-z0-9])Rs\.?)\s*[−-]?\d|\b(USD|EUR|GBP|AED|CNY|CHF|JPY|SGD)\s*[−-]?\d/
/** Engineer: a GST amount (a rate such as "GST 18%" is not an amount). */
export const GST_AMOUNT = /GST\s*(?!\d+(\.\d+)?\s*%)[^%\n]{0,12}\d{1,3}(,\d{3})+/

/**
 * Text an engineer may see everywhere: their own target tile (s10: targets "S own"). Excluded from the scan. Since 2026-10-22 the
 * tile is not drawn for an engineer at all (its amounts are PKR), so this matches nothing; MONEY_REQUEST catches its read.
 */
export const ENGINEER_OWN_SELECTORS = ['section[aria-label$=" target"]']

/**
 * REST objects an engineer's browser must never even ask for (journeys P03 MONEY_REQUEST, plus the A6 objects). Since the owner
 * decision of 2026-10-22 (engineers see no prices) also every read that only carries prices or rates: the supplier ranking, the
 * supplier and customer price memories, the PO line pre-fill, the exchange rates and the person's own target.
 */
export const MONEY_REQUEST =
  /\/rest\/v1\/(rpc\/)?(rank_item_quotes|customer_price_memory|supplier_item_memory|po_line_prefill|v_fx_latest|fx_rates|my_target_progress|v_order_money|v_order_basis|v_payment_net|v_cash_month|v_month_\w+|v_gst_\w+|v_invoice_state|v_target_progress|order_costs|expenses|expense_categories|expense_groups|merge_expense_categories|recurring_expenses|payments_in|invoices|closed_months|month_snapshots|audit_log|order_receivables|receivables_list|receivables_summary|month_end_status|month_end_check_details|aging_as_of|payables_as_of|money_exceptions_input|month_pnl_drift|month_pnl_adjusted|close_month|close_months_through|reopen_month|next_invoice_number|stamp_payment_reminder|stamp_tcs_sent|stamp_fbr_psid|stamp_tax_deposited)\b/
