/*
 * The month's money reports (M10, M05), listed once: their keys (the address, /money/reports/<key>), and their names in plain
 * words (owner glossary 2026-10-19: Aging is "Overdue by age", We owe is "We owe suppliers"; the old "Team" report is
 * "Sales by person" so it no longer shares a name with Settings > Team). Admin only.
 */
export const MONTH_REPORT_KEYS = ['pnl', 'categories', 'aging', 'owe', 'gst', 'team'] as const
export type MonthReportKey = (typeof MONTH_REPORT_KEYS)[number]

export const MONTH_REPORT_TITLE: Record<MonthReportKey, string> = {
  pnl: 'Profit and loss',
  categories: 'Expenses by category',
  aging: 'Overdue by age',
  owe: 'We owe suppliers',
  gst: 'GST and FBR',
  team: 'Sales by person',
}
