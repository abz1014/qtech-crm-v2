export interface MoneyTab {
  key: string
  label: string
  /** What sales call it, when different ("Order balances" for Receivables, money-10). */
  salesLabel?: string
  to: string
  adminOnly?: boolean
}

/** The Money views, in the order of the mockups (g2-money, g2-month-end). A view task adds its entry and renders <MoneyFrame>. */
export const MONEY_TABS: readonly MoneyTab[] = [
  { key: 'gst-register', label: 'GST register', to: '/money/gst-register' },
  { key: 'receivables', label: 'Receivables', salesLabel: 'Order balances', to: '/money/receivables' },
  { key: 'expenses', label: 'Expenses', to: '/money/expenses', adminOnly: true },
  { key: 'margins', label: 'Margins', to: '/money/margins', adminOnly: true },
  { key: 'exceptions', label: 'Exceptions', to: '/money/exceptions', adminOnly: true },
  // Month-end opens on the Bank tick until the checklist (M10) exists; the tab stays lit on every Month-end view.
  { key: 'month-end', label: 'Month-end', to: '/money/month-end/bank', adminOnly: true },
]

