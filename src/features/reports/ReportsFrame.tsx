import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useSession } from '@/app/session'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { NoPrimary } from '@/ui/NoPrimary'
import { Select } from '@/ui/form/Select'
import { CsvButton } from '@/ui/ReportCsv'
import { ReportCsvContext } from '@/ui/reportCsvContext'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { reportOptionsFor, reportTitle, type ReportKey } from '@/features/money/monthEnd/reportList'

/*
 * Money > Reports (round 3, areas audit: "Reports shows one report at a time"). Reports is the fifth Money tab; inside it ONE
 * report is shown, picked from a select ("Report: Profit and loss"), with its period control on the same row and Export CSV (a secondary
 * button, never green: a report has no next step) under the summary (<ReportCsv />, drawn by each report body). Changing the report keeps the month (?month=2026-09). The h1 is the tab's name ("Reports", like the other Money tabs); the select names the report, and the phone bar says "Money".
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
  const wide = useMediaQuery('(min-width: 768px)')
  const [claimed, setClaimed] = useState(false)
  const ctx = useMemo(() => ({ csv, claim: setClaimed }), [csv])
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
        {/* 768 and up: Export CSV on this row, right-aligned (it was its own 36px row). Below 768 the report body's slot draws it. */}
        {csv !== undefined && wide ? <CsvButton csv={csv} className="ml-auto" /> : null}
      </div>
      {/* Export CSV: each report body draws <ReportCsv /> right under its summary (not green: a report has no next step). */}
      {csv !== undefined && !claimed && !wide ? <CsvButton csv={csv} /> : null}
      <ReportCsvContext.Provider value={ctx}>{children}</ReportCsvContext.Provider>
    </MoneyFrame>
  )
}
