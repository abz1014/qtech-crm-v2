export interface MoneyTab {
  key: string
  label: string
  to: string
  adminOnly?: boolean
}

/**
 * The Money tabs (owner decision 2026-10-19: Money is two levels deep, never three; round 3: Reports is the fifth tab, so a
 * report page lights a tab). One name for admin and sales. "To collect" is first and is where Money opens for everyone.
 * Margins, Mistakes to fix, Bank check and Profitability are reached from the Lock a month checklist or the More money pages row and light no tab (owner decision 2026-11: they are not the Lock a month tab); Margins opened from Reports keeps Reports lit.
 * The routes are internal identifiers and keep their old names (/money/receivables is "To collect").
 */
export const MONEY_TABS: readonly MoneyTab[] = [
  { key: 'receivables', label: 'To collect', to: '/money/receivables' },
  { key: 'gst-register', label: 'Invoices', to: '/money/gst-register' },
  { key: 'expenses', label: 'Expenses', to: '/money/expenses', adminOnly: true },
  // Lock a month opens on its checklist and is lit on that checklist only.
  { key: 'month-end', label: 'Lock a month', to: '/money/month-end', adminOnly: true },
  { key: 'reports', label: 'Reports', to: '/money/reports' },
]

/**
 * Money pages that are not a tab (admin only), shown as a row of links under the tabs so they are not found only through Lock a month.
 * Each opens on its own address; the page's own back link leads to Money.
 */
export const MORE_MONEY_PAGES: readonly { label: string; to: string }[] = [
  { label: 'Margins', to: '/money/margins' },
  { label: 'Mistakes to fix', to: '/money/exceptions' },
  { label: 'Bank check', to: '/money/month-end/bank' },
  { label: 'Review imported', to: '/money/review-imported' },
  { label: 'GST to FBR', to: '/money/accounts/gst' },
  { label: 'Profitability', to: '/money/profit' },
]

/** The page title for a Money view: its tab's name. */
export const moneyTabLabel = (key: string | null): string => MONEY_TABS.find(t => t.key === key)?.label ?? 'Money'
