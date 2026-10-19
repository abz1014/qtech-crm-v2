/*
 * The views under Month-end, in the order of the approved mockup (g2-month-end "Month-end views"): the checklist and the
 * bank tick, a divider, then the six reports. The Checklist is the tab Money › Month-end opens on.
 */
export interface MonthEndView {
  key: string
  label: string
  to: string
  /** A thin divider is drawn before the first view of the next group. */
  group: 1 | 2
}

export const MONTH_END_VIEWS: readonly MonthEndView[] = [
  { key: 'checklist', label: 'Checklist', to: '/money/month-end', group: 1 },
  { key: 'bank', label: 'Bank tick', to: '/money/month-end/bank', group: 1 },
  { key: 'pnl', label: 'P&L', to: '/money/month-end/pnl', group: 2 },
  { key: 'categories', label: 'Expenses by category', to: '/money/month-end/categories', group: 2 },
  { key: 'aging', label: 'Aging', to: '/money/month-end/aging', group: 2 },
  { key: 'owe', label: 'We owe', to: '/money/month-end/owe', group: 2 },
  { key: 'gst', label: 'GST/FBR', to: '/money/month-end/gst', group: 2 },
  { key: 'team', label: 'Team', to: '/money/month-end/team', group: 2 },
]
