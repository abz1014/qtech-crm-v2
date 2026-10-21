import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { Select } from '@/ui/form/Select'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { reportOptionsFor, reportTitle, type ReportKey } from '@/features/money/monthEnd/reportList'

/*
 * Money > Reports (round 3, areas audit: "Reports shows one report at a time"). Reports is the fifth Money tab; inside it ONE
 * report is shown, picked from a select ("Report: Profit and loss"), with its period control beside it and Export CSV as the
 * page's one green button. Changing the report keeps the month (?month=2026-09). The h1 and the phone bar name the report.
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
  return (
    <MoneyFrame
      active="reports"
      title={reportTitle(report)}
      actions={
        csv === undefined ? undefined : (
          <Button variant="primary" icon={Download} onClick={() => csv?.()} disabled={!csv}>
            Export CSV
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        {options.length > 1 ? (
          <label className="grid w-full gap-1 text-sm font-medium text-fg-2 sm:w-[320px]">
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
      {children}
    </MoneyFrame>
  )
}
