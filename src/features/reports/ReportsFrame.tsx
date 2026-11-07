import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { NoPrimary } from '@/ui/NoPrimary'
import { Select } from '@/ui/form/Select'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { reportOptionsFor, reportTitle, type ReportKey } from '@/features/money/monthEnd/reportList'

/*
 * Money > Reports (round 3, areas audit: "Reports shows one report at a time"). Reports is the fifth Money tab; inside it ONE
 * report is shown, picked from a select ("Report: Profit and loss"), with its period control on the same row and Export CSV (a secondary
 * button, never green: a report has no next step) under the summary. Changing the report keeps the month (?month=2026-09). The h1 is the tab's name ("Reports", like the other Money tabs); the select names the report, and the phone bar says "Money".
 *
 *   <ReportsFrame report="owe" period={<MonthPager … />} csv={view ? () => downloadReport(…) : null}>…</ReportsFrame>
 */
export function ReportsFrame({
  report,
  period,
  csv,
  children,
}: {
  report: ReportKey
  /** The report's one period control: the month pager, or Month/Quarter and its pager. */
  period?: ReactNode
  /** Export CSV; null while the figures load (the button shows, disabled). Absent: the report has no CSV. */
  csv?: (() => void) | null
  children: ReactNode
}) {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const options = reportOptionsFor(isAdmin)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const pick = (key: string) => {
    const month = params.get('month')
    navigate({ pathname: `/money/reports/${key}`, search: month ? `?month=${month}` : '' })
  }
  const named = options.length > 1 // the select names the report; with no select (sales, one report) the name is shown
  const name = reportTitle(report)
  return (
    <MoneyFrame
      active="reports"
      barTitle="Money"
      // The select names the report, so the name is not repeated as a line under the heading. It stays for assistive technology
      // (and for the one-report view, where there is no select, it is shown).
      lede={<span className={named ? 'sr-only' : 'max-md:hidden'} data-testid="report-name">{name}</span>}
    >
      <NoPrimary />
      {/* The report's select and its period on ONE row. */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {named ? (
          <label className="grid min-w-0 flex-[1_1_200px] gap-1 text-base font-medium text-fg-2 sm:w-[320px] sm:flex-none">
            Report
            <Select
              data-testid="report-picker"
              value={report}
              onChange={e => pick(e.target.value)}
              options={options.map(o => ({ value: o.key, label: o.title }))}
            />
          </label>
        ) : null}
        {period}
      </div>
      {/* Export CSV sits right under the summary (the report's first block), and is NOT green: a report has no next step. */}
      <div className="grid gap-4 [&>:nth-child(n+3)]:order-2">
        {csv === undefined ? null : (
          <div className="order-1 justify-self-start">
            <Button variant="secondary" icon={Download} onClick={() => csv?.()} disabled={!csv}>
              Export CSV
            </Button>
          </div>
        )}
        {children}
      </div>
    </MoneyFrame>
  )
}
