export interface MoneyTab {
  key: string
  label: string
  to: string
  adminOnly?: boolean
}

/**
 * The four Money tabs (owner decision 2026-10-19: Money is two levels deep, never three). One name for admin and sales.
 * "Who owes us" is first and is where Money opens for everyone. Margins, Things to check and Match bank statement are
 * reached from the Month end checklist; Reports is a link in the Money header (and from Month end), not a tab.
 * The routes are internal identifiers and keep their old names (/money/receivables is "Who owes us").
 */
export const MONEY_TABS: readonly MoneyTab[] = [
  { key: 'receivables', label: 'Who owes us', to: '/money/receivables' },
  { key: 'gst-register', label: 'Invoices & GST', to: '/money/gst-register' },
  { key: 'expenses', label: 'Expenses', to: '/money/expenses', adminOnly: true },
  // Month end opens on its checklist; the tab stays lit on everything reached from it (bank, margins, things to check).
  { key: 'month-end', label: 'Month end', to: '/money/month-end', adminOnly: true },
]
