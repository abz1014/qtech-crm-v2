import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useInOutReport } from '@/features/money/inOut/hooks'

import { IN_OUT_TITLE, inOutCsv, periodOf } from '@/features/money/inOut/model'
import { ArrowLeftRight, ChartColumn,ChevronRight, Clock, FileText, Percent, Scale, Truck, Users, type LucideIcon } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { formatPaisa, toPaisa, type Amount } from '@/lib/money'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { useOrderMargins } from '@/features/money/hooks'
import { marginTotals } from '@/features/money/margins/model'
import { MonthPager } from '@/features/money/monthEnd/MonthEndFrame'
import { ExportCsvButton } from '@/features/money/monthEnd/ReportParts'
import { csvFile, downloadReport } from '@/features/money/monthEnd/reportFiles'
import { useAgingReport, useAsOf, useCategoryReport, useGstReport, useOweReport, usePnlReport, useTeamReport } from '@/features/money/monthEnd/reportHooks'
import { MONTH_REPORT_TITLE, type MonthReportKey } from '@/features/money/monthEnd/reportList'
import {
  agingCsv,
  categoriesCsv,
  defaultMonthEndMonth,
  gstCsv,
  isMonthKey,
  monthKeyLabel,
  monthName,
  payablesCsv,
  pnlCsv,
  shiftMonth,
  teamCsv,
} from '@/features/money/monthEnd/model'
import { SalesReports } from '@/features/reports/SalesReports'

/*
 * Money > Reports (owner decision 2026-10-19): the ONE place for reports. It replaces the old top-level Reports page, the six
 * Month-end report tabs and the "Reports for October" panel on the checklist.
 *   Admin  the money reports for a month (the pager picks it; last month by default), each a line with its headline figure in
 *          whole rupees, Open and Export CSV, plus Order margins (every order); then the enquiry and customer reports.
 *   Sales  the enquiry and customer reports (counts only; no money report is shown or requested).
 * `/reports` and `/money/month-end/<report>` lead here.
 */
export function ReportsPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  return (
    <MoneyFrame active="reports">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-xl font-semibold tracking-snug">Reports</h2>
        <span className="text-sm text-fg-muted">{isAdmin ? 'Money for a month, then enquiries and customers.' : 'How enquiries turn into orders, and who comes back.'}</span>
      </div>
      {isAdmin ? <MoneyReports /> : null}
      <SalesReports />
    </MoneyFrame>
  )
}

/** The month in the address (?month=2026-09), the month that just ended when absent, never later than this month. */
function useReportMonth() {
  const today = businessToday()
  const [params, setParams] = useSearchParams()
  const asked = params.get('month')
  const thisMonth = today.slice(0, 7)
  const month = isMonthKey(asked) && asked <= thisMonth ? asked : defaultMonthEndMonth(today)
  const go = (by: number) => {
    const next = new URLSearchParams(params)
    next.set('month', shiftMonth(month, by))
    next.delete('asof')
    setParams(next, { replace: true })
  }
  return { today, month, thisMonth, go, search: `?month=${month}` }
}

const Pkr = ({ v }: { v: Amount }) => <span className="num">PKR {formatPaisa(toPaisa(v), 'never')}</span>

interface Line {
  key: MonthReportKey | 'margins' | 'in-out'
  icon: LucideIcon
  title: string
  to: string
  summary: ReactNode
  csv: (() => void) | null
}

function MoneyReports() {
  const m = useReportMonth()
  const { asOf } = useAsOf(m.month, m.today)
  const pnl = usePnlReport(m.month)
  const cat = useCategoryReport(m.month)
  const aging = useAgingReport(asOf)
  const owe = useOweReport(asOf)
  const gst = useGstReport(m.month)
  const team = useTeamReport(m.month, m.today)
  const margins = useOrderMargins(true)
  const name = monthName(m.month)
  const asOfWords = `${Number(asOf.slice(8))} ${monthName(asOf.slice(0, 7))}`
  const mt = margins.data ? marginTotals(margins.data) : null
  const to = (k: MonthReportKey) => `/money/reports/${k}${m.search}`
  const inOutPeriod = useMemo(() => periodOf('month', m.month), [m.month])
  const inOut = useInOutReport(inOutPeriod)

  const lines: Line[] = [
    {
      key: 'in-out',
      icon: ArrowLeftRight,
      title: IN_OUT_TITLE,
      to: `/money/reports/in-out?by=month&period=${m.month}`,
      summary: inOut.view ? (
        <>
          In <Pkr v={inOut.view.cash.in} />, out <Pkr v={inOut.view.cash.out} />; profit (invoiced) <Pkr v={inOut.view.profit.profit} />. Also by quarter
        </>
      ) : null,
      csv: inOut.view ? () => downloadReport(inOutCsv(inOut.view!), `in-vs-out-${m.month}.csv`) : null,
    },
    {
      key: 'pnl',
      icon: ChartColumn,
      title: MONTH_REPORT_TITLE.pnl,
      to: to('pnl'),
      summary: pnl.view ? (
        <>
          Result <Pkr v={pnl.view.result} />, after drawings <Pkr v={pnl.view.afterDrawings} />
        </>
      ) : null,
      csv: pnl.view ? () => downloadReport(pnlCsv(pnl.view!), csvFile('profit-and-loss', m.month)) : null,
    },
    {
      key: 'categories',
      icon: FileText,
      title: MONTH_REPORT_TITLE.categories,
      to: to('categories'),
      summary: cat.view ? (
        <>
          <span className="num">{cat.view.all.count}</span> {cat.view.all.count === 1 ? 'expense' : 'expenses'}, <Pkr v={cat.view.all.gross} /> paid
        </>
      ) : null,
      csv: cat.view ? () => downloadReport(categoriesCsv(cat.view!, m.month, 'all'), csvFile('expenses-by-category', m.month)) : null,
    },
    {
      key: 'aging',
      icon: Clock,
      title: MONTH_REPORT_TITLE.aging,
      to: to('aging'),
      summary: aging.view ? (
        <>
          On {asOfWords}: <span className="num">{aging.view.rows.length}</span> {aging.view.rows.length === 1 ? 'invoice' : 'invoices'} open, <Pkr v={aging.view.outstanding} />
        </>
      ) : null,
      csv: aging.view ? () => downloadReport(agingCsv(aging.view!), csvFile('overdue-by-age', m.month)) : null,
    },
    {
      key: 'owe',
      icon: Truck,
      title: MONTH_REPORT_TITLE.owe,
      to: to('owe'),
      summary: owe.view ? (
        <>
          On {asOfWords}: about <Pkr v={owe.view.owed} /> on <span className="num">{owe.view.owedCount}</span> supplier {owe.view.owedCount === 1 ? 'order' : 'orders'}
        </>
      ) : null,
      csv: owe.view ? () => downloadReport(payablesCsv(owe.view!), csvFile('we-owe-suppliers', m.month)) : null,
    },
    {
      key: 'gst',
      icon: Scale,
      title: MONTH_REPORT_TITLE.gst,
      to: to('gst'),
      summary: gst.view ? (
        gst.view.selected ? (
          <>
            <span className="num">{gst.view.selected.invoiceCount}</span> {gst.view.selected.invoiceCount === 1 ? 'invoice' : 'invoices'}, GST <Pkr v={gst.view.selected.gst} />
          </>
        ) : (
          `No invoices dated in ${name}`
        )
      ) : null,
      csv: gst.view ? () => downloadReport(gstCsv(gst.view!), csvFile('gst-and-fbr', m.month)) : null,
    },
    {
      key: 'team',
      icon: Users,
      title: MONTH_REPORT_TITLE.team,
      to: to('team'),
      summary: team.view ? (
        <>
          <Pkr v={team.view.credited} /> net credited to <span className="num">{team.view.creditedPeople}</span> {team.view.creditedPeople === 1 ? 'person' : 'people'}
        </>
      ) : null,
      csv: team.view ? () => downloadReport(teamCsv(team.view!, m.month), csvFile('sales-by-person', m.month)) : null,
    },
  ]

  return (
    <section aria-labelledby="rep-money" className="grid gap-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 id="rep-money" className="text-lg font-semibold tracking-snug">
          Money for {monthKeyLabel(m.month)}
        </h3>
        <MonthPager month={m.month} thisMonth={m.thisMonth} go={m.go} label="Report month" />
      </header>
      <ul aria-label="Money reports" className="grid overflow-hidden rounded border bg-surface">
        {lines.map(l => (
          <ReportLine key={l.key} line={l} />
        ))}
        <li data-testid="report-margins" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-3">
          <Link to="/money/margins?from=reports" className="flex min-h-touch min-w-[220px] items-center gap-3 text-base font-medium hover:underline md:min-h-0">
            <Icon icon={Percent} size="md" className="text-fg-muted" />
            Order margins
          </Link>
          <span className="min-w-0 flex-1 text-sm text-fg-2 max-md:basis-full">
            {mt ? (
              <>
                Every order. <span className="num">{mt.orders}</span> with costs complete, margin <Pkr v={mt.margin} />
                {mt.provisional ? (
                  <>
                    ; <span className="num">{mt.provisional}</span> not final yet
                  </>
                ) : null}
              </>
            ) : margins.isError ? (
              'Could not load'
            ) : (
              <Skeleton className="h-3 w-48" />
            )}
          </span>
          <Link to="/money/margins?from=reports" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            Open <Icon icon={ChevronRight} size="sm" />
          </Link>
        </li>
      </ul>
    </section>
  )
}

function ReportLine({ line }: { line: Line }) {
  return (
    <li data-testid={`report-${line.key}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-3 first:border-t-0">
      <Link to={line.to} className="flex min-h-touch min-w-[220px] items-center gap-3 text-base font-medium hover:underline md:min-h-0">
        <Icon icon={line.icon} size="md" className="text-fg-muted" />
        {line.title}
      </Link>
      <span className="min-w-0 flex-1 text-sm text-fg-2 max-md:order-last max-md:basis-full">{line.summary ?? <Skeleton className="h-3 w-48" />}</span>
      <Link to={line.to} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" aria-label={`Open ${line.title}`}>
        Open <Icon icon={ChevronRight} size="sm" />
      </Link>
      <ExportCsvButton onClick={() => line.csv?.()} disabled={!line.csv} />
    </li>
  )
}
