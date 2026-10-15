export interface MoneyTab {
  key: string
  label: string
  to: string
  adminOnly?: boolean
}

export const MONEY_TABS: readonly MoneyTab[] = [
  { key: 'expenses', label: 'Expenses', to: '/money/expenses', adminOnly: true },
  { key: 'margins', label: 'Margins', to: '/money/margins', adminOnly: true },
  { key: 'exceptions', label: 'Exceptions', to: '/money/exceptions', adminOnly: true },
]

