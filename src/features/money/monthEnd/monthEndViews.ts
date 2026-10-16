/* The views under Month-end. Every view task adds its own entry: M12 brings Bank tick; the checklist and report tabs (M10) are the mockup's others. */
export interface MonthEndView {
  key: string
  label: string
  to: string
}

export const MONTH_END_VIEWS: readonly MonthEndView[] = [{ key: 'bank', label: 'Bank tick', to: '/money/month-end/bank' }]
