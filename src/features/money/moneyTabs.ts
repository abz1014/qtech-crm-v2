export interface MoneyTab {
  key: string
  label: string
  /** The label in the one-row phone strip, where five long names do not fit at 320 px. */
  short: string
  to: string
  adminOnly?: boolean
}

/**
 * The Money tabs (owner decision 2026-10-19: Money is two levels deep, never three; round 3: Reports is the fifth tab, so a
 * report page lights a tab). One name for admin and sales. "Who owes us" is first and is where Money opens for everyone.
 * Margins, Things to check and Match bank statement are reached from the Month end checklist and keep Month end lit.
 * The routes are internal identifiers and keep their old names (/money/receivables is "Who owes us").
 */
export const MONEY_TABS: readonly MoneyTab[] = [
  { key: 'receivables', label: 'Who owes us', short: 'Owed', to: '/money/receivables' },
  { key: 'gst-register', label: 'Invoices & GST', short: 'Invoices', to: '/money/gst-register' },
  { key: 'expenses', label: 'Expenses', short: 'Expenses', to: '/money/expenses', adminOnly: true },
  // Month end opens on its checklist; the tab stays lit on everything reached from it (bank, margins, things to check).
  { key: 'month-end', label: 'Month end', short: 'Month end', to: '/money/month-end', adminOnly: true },
  { key: 'reports', label: 'Reports', short: 'Reports', to: '/money/reports' },
]

/** The page title for a Money view: its tab's name. */
export const moneyTabLabel = (key: string | null): string => MONEY_TABS.find(t => t.key === key)?.label ?? 'Money'
