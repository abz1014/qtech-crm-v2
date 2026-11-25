/*
 * The Forest final audit (e2e/audit-forest): every screen it visits, once, as data. Built from the app's route table
 * (src/app/routes.tsx, src/features/money/MoneyScreen.tsx, jobs/JobsScreen.tsx, companies/CompaniesScreen.tsx) and the role list of
 * e2e/verify-roles/routes.ts. Pure redirects (/rfqs, /orders, /reports, /money/month-end/<report>) are left out: they land on a screen
 * that is already here. Placeholders are filled from the audit's own seed (seed.ts):
 *   {job} {orderJob} {company} {supplier} {order} {invoice} {month} {directJob}   the small "world" (verify-roles fixtures); in the
 *                                                     long-text state the same placeholders name the long world's records
 *   {long:job}                                        the long world's RFQ job, in every state
 *   {fx:<state>}                                                       a Job page of the realistic seed (e2e/audit/seed.ts), by state
 *
 * Flags:
 *   wide    also audited at 1920 (wide tables)
 *   light   one state only (ok, normal text) at the five widths: a variant of a screen already audited in full
 *   long    also audited in the long-text state (with the long world in the placeholders, or the list that shows it)
 *   dialog  the address opens a dialog (a deep link): audited open, no empty/loading/error states and no opener discovery
 *   noStates  the screen has no data of its own to delay or refuse (static page)
 */
export type Role = 'admin' | 'sales' | 'engineer' | 'anon'

export interface AuditRoute {
  /** Unique id: the folder name of its screenshots. */
  id: string
  path: string
  roles: readonly Role[]
  wide?: boolean
  light?: boolean
  long?: boolean
  dialog?: boolean
  noStates?: boolean
  /** Opener discovery also looks in the top bar and the rail (only on Home: the shell is the same everywhere). */
  shell?: boolean
}

const ALL = ['admin', 'sales', 'engineer'] as const
const AS = ['admin', 'sales'] as const
const A = ['admin'] as const

export const AUDIT_ROUTES: readonly AuditRoute[] = [
  // ---------------------------------------------------------------- signed out
  { id: 'login', path: '/login', roles: ['anon'], noStates: true },
  // ---------------------------------------------------------------- Home
  { id: 'todo', path: '/todo', roles: ALL, long: true, shell: true },
  { id: 'todo-review', path: '/todo/review', roles: A },
  { id: 'help', path: '/todo?help=', roles: ALL, dialog: true },
  { id: 'not-found', path: '/nope', roles: ALL, light: true, noStates: true },
  { id: 'no-access', path: '/settings/team', roles: ['sales'], light: true, noStates: true },
  // ---------------------------------------------------------------- Sell / Deliver / Jobs
  { id: 'jobs', path: '/jobs', roles: ALL, wide: true, long: true },
  { id: 'jobs-sell', path: '/jobs?lane=sell', roles: ALL, wide: true },
  { id: 'jobs-deliver', path: '/jobs?lane=deliver', roles: ALL, wide: true },
  { id: 'jobs-history', path: '/jobs?chip=history', roles: ALL, wide: true, light: true },
  { id: 'job', path: '/jobs/{job}', roles: ALL, long: true },
  { id: 'job-order', path: '/jobs/{orderJob}', roles: ALL, long: true },
  { id: 'job-direct', path: '/jobs/{directJob}', roles: ALL, light: true },
  { id: 'job-not-sent', path: '/jobs/{fx:notSent}', roles: ALL, light: true },
  { id: 'job-waiting', path: '/jobs/{fx:waiting}', roles: ALL, light: true },
  { id: 'job-prices-in', path: '/jobs/{fx:pricesIn}', roles: ALL },
  { id: 'job-quoted', path: '/jobs/{fx:quoted}', roles: ALL, light: true },
  { id: 'job-compare', path: '/jobs/{fx:compare}', roles: ALL, wide: true, light: true },
  { id: 'job-not-placed', path: '/jobs/{fx:notPlaced}', roles: ALL, light: true },
  { id: 'job-po-issued', path: '/jobs/{fx:poIssued}', roles: ALL, light: true },
  { id: 'job-multi-leg', path: '/jobs/{fx:multiLeg}', roles: ALL },
  { id: 'job-delivered', path: '/jobs/{fx:delivered}', roles: ALL, light: true },
  { id: 'job-invoiced', path: '/jobs/{fx:invoiced}', roles: ALL },
  { id: 'job-paid', path: '/jobs/{fx:paid}', roles: ALL, light: true },
  { id: 'job-missing', path: '/jobs/9999999', roles: ALL, light: true, noStates: true },
  // The comparative statement has no page since 2026-11-16 (Excel and PDF downloads on the job page; the old address opens the job).
  { id: 'issue-quotation', path: '/jobs/{fx:pricesIn}?issue=1', roles: AS, dialog: true },
  { id: 'mark-won', path: '/jobs/{fx:quoted}?won=1', roles: AS, dialog: true },
  { id: 'new-rfq', path: '/rfqs/new', roles: ALL },
  { id: 'capture', path: '/capture', roles: ALL },
  { id: 'i-paid', path: '/my-expenses', roles: ['sales', 'engineer'] },
  // ---------------------------------------------------------------- Companies
  { id: 'companies', path: '/companies', roles: ALL, wide: true, long: true },
  { id: 'company-new', path: '/companies?new=1', roles: ALL, dialog: true },
  { id: 'company', path: '/companies/{company}', roles: ALL, long: true },
  { id: 'company-fx', path: '/companies/{fx:customer}', roles: ALL, light: true },
  { id: 'supplier', path: '/companies/{supplier}', roles: ALL, long: true },
  { id: 'supplier-fx', path: '/companies/{fx:supplier}', roles: ALL, light: true },
  // ---------------------------------------------------------------- Money
  { id: 'money', path: '/money', roles: A },
  { id: 'receivables', path: '/money/receivables', roles: AS, wide: true, long: true },
  { id: 'record-payment', path: '/money/receivables?pay=1&order={order}', roles: A, dialog: true },
  { id: 'invoices', path: '/money/gst-register', roles: AS, wide: true, long: true },
  { id: 'invoice-detail', path: '/money/gst-register?invoice={invoice}', roles: AS, dialog: true },
  { id: 'invoice-new', path: '/money/gst-register?new=1&order={order}', roles: AS, dialog: true },
  { id: 'invoices-attention', path: '/money/gst-register?attention=1', roles: AS, light: true },
  { id: 'payments', path: '/money/payments', roles: A, wide: true },
  { id: 'expenses', path: '/money/expenses', roles: A, wide: true, long: true },
  { id: 'expense-add', path: '/money/expenses?add=1', roles: A, dialog: true },
  { id: 'expense-burst', path: '/money/expenses?burst=1', roles: A, dialog: true },
  { id: 'month-end', path: '/money/month-end', roles: A },
  { id: 'bank', path: '/money/month-end/bank', roles: A, wide: true },
  { id: 'margins', path: '/money/margins', roles: A, wide: true },
  { id: 'exceptions', path: '/money/exceptions', roles: A },
  { id: 'profit', path: '/money/profit', roles: A, wide: true },
  { id: 'review-imported', path: '/money/review-imported', roles: A },
  { id: 'gst-to-fbr', path: '/money/accounts/gst', roles: A },
  { id: 'reports', path: '/money/reports', roles: AS },
  { id: 'report-pnl', path: '/money/reports/pnl?month={month}', roles: A },
  { id: 'report-aging', path: '/money/reports/aging', roles: A, wide: true },
  { id: 'report-owe', path: '/money/reports/owe', roles: A, wide: true },
  { id: 'report-gst', path: '/money/reports/gst?month={month}', roles: A, wide: true },
  { id: 'report-team', path: '/money/reports/team?month={month}', roles: A },
  { id: 'report-in-out', path: '/money/reports/in-out', roles: A, wide: true },
  { id: 'report-expenses', path: '/money/reports/expenses?by=month', roles: A, wide: true },
  { id: 'report-expenses-quarter', path: '/money/reports/expenses?by=quarter', roles: A, wide: true, light: true },
  { id: 'report-rfqs', path: '/money/reports/rfqs', roles: AS, wide: true },
  // ---------------------------------------------------------------- Settings
  { id: 'settings', path: '/settings', roles: ALL },
  { id: 'settings-team', path: '/settings/team', roles: A, wide: true },
  { id: 'settings-targets', path: '/settings/targets', roles: A, wide: true },
  { id: 'settings-export', path: '/settings/export', roles: A },
  { id: 'settings-categories', path: '/settings/categories', roles: A },
  { id: 'settings-product-categories', path: '/settings/product-categories', roles: A },
  { id: 'settings-company', path: '/settings/company', roles: ALL },
  { id: 'settings-details', path: '/settings/details', roles: ALL, noStates: true },
  { id: 'settings-exchange-rates', path: '/settings/exchange-rates', roles: AS },
  { id: 'settings-tax-deadlines', path: '/settings/tax-deadlines', roles: AS },
  { id: 'settings-backups', path: '/settings/backups', roles: A },
  { id: 'settings-password', path: '/settings/password', roles: ALL, noStates: true },
]

export interface Width {
  w: number
  h: number
}
export const WIDTHS: readonly Width[] = [
  { w: 320, h: 640 },
  { w: 375, h: 812 },
  { w: 768, h: 1024 },
  { w: 1024, h: 768 },
  { w: 1440, h: 900 },
]
export const WIDE: Width = { w: 1920, h: 1080 }
export const at = (w: number): Width => [...WIDTHS, WIDE].find(x => x.w === w) as Width
