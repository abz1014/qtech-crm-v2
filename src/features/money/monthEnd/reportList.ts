/*
 * The month's money reports (M10, M05), listed once: their keys (the address, /money/reports/<key>), and their names in plain
 * words (owner glossary 2026-10-19: Aging is "Overdue by age", We owe is "We owe suppliers"; the old "Team" report is
 * "Sales by person" so it no longer shares a name with Settings > Team). Admin only.
 */
export const MONTH_REPORT_KEYS = ['pnl', 'categories', 'aging', 'owe', 'gst', 'team'] as const
export type MonthReportKey = (typeof MONTH_REPORT_KEYS)[number]

export const MONTH_REPORT_TITLE: Record<MonthReportKey, string> = {
  pnl: 'Profit and loss',
  // replaced by the Expenses report (/money/reports/expenses, 2026-10-22); the old address redirects there
  categories: 'Expenses',
  aging: 'Overdue by age',
  owe: 'We owe suppliers',
  gst: 'GST and FBR',
  team: 'Sales by person',
}

/**
 * Money > Reports (round 3: Reports is the fifth Money tab and shows ONE report at a time, picked from a select). Every report
 * the select offers, in its order, with who may open it. The address is /money/reports/<key>; /money/reports opens the first
 * report the person may see.
 */
export type ReportKey = MonthReportKey | 'in-out' | 'expenses' | 'enquiries'

export interface ReportOption {
  key: ReportKey
  title: string
  adminOnly: boolean
}

export const IN_OUT_REPORT_TITLE = 'Money in and out'

export const REPORT_OPTIONS: readonly ReportOption[] = [
  { key: 'pnl', title: MONTH_REPORT_TITLE.pnl, adminOnly: true },
  { key: 'in-out', title: IN_OUT_REPORT_TITLE, adminOnly: true },
  // the Expenses report (2026-10-22) replaced "Expenses by category"; /money/reports/categories redirects to it
  { key: 'expenses', title: 'Expenses', adminOnly: true },
  { key: 'aging', title: MONTH_REPORT_TITLE.aging, adminOnly: true },
  { key: 'owe', title: MONTH_REPORT_TITLE.owe, adminOnly: true },
  { key: 'gst', title: MONTH_REPORT_TITLE.gst, adminOnly: true },
  { key: 'team', title: MONTH_REPORT_TITLE.team, adminOnly: true },
  { key: 'enquiries', title: 'Enquiries and customers', adminOnly: false },
]

export const reportOptionsFor = (isAdmin: boolean): ReportOption[] => REPORT_OPTIONS.filter(o => isAdmin || !o.adminOnly)
export const reportTitle = (key: ReportKey): string => REPORT_OPTIONS.find(o => o.key === key)?.title ?? 'Reports'
