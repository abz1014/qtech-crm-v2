import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatPaisa, paisaToFixed } from '@/lib/money'
import { rfqRef } from '@/lib/refs'
import { formatShortDate } from '@/lib/formatDay'
import { BarChart } from '@/ui/BarChart'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { InfoTip } from '@/ui/InfoTip'
import { NoPrimary } from '@/ui/NoPrimary'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import { Panel, ReportError, ReportLoading } from '@/features/money/monthEnd/ReportParts'
import { useLostEnquiryCosts, useProfitPage } from '@/features/money/profit/hooks'
import type { LostEnquiryCost } from '@/features/money/profit/api'
import { averageOf, bestMonth, buildPoints, completeMonths, rupeesOf, shortMonth, spanLabel, sumOf, type ProfitPoint, type RangeMonths } from '@/features/money/profit/model'

/*
 * Money > Profitability (owner decision 2026-11-05; admin only, as the Reports). Income is what we INVOICED, GST left out; the cash
 * received beside it includes GST and says so. The average is over the last 12 complete months, this month left out. The chart shows
 * 12 or 24 months of both; the table under it is the monthly profit on invoices (v_month_profit) with cash received (v_month_cash_flow).
 * Under the table, "Spent on enquiries we did not win" lists what was spent on enquiries closed without an order (v_enquiry_costs, state
 * lost; 0136), net of input tax. It is a list for the owner to see; the profit figures above are not changed by it.
 */
const rupees = (p: bigint) => formatPaisa(p, 'never')
const pkr = (p: bigint) => `PKR ${rupees(p)}`

export function ProfitPage() {
  const q = useProfitPage(true)
  const lost = useLostEnquiryCosts(true)
  const today = businessToday()
  const [range, setRange] = useState<RangeMonths>(12)
  const view = useMemo(() => {
    if (!q.profit || !q.flows) return null
    const last12 = buildPoints(completeMonths(today, 12), q.profit, q.flows)
    const shown = range === 12 ? last12 : buildPoints(completeMonths(today, 24), q.profit, q.flows)
    return { last12, shown }
  }, [q.profit, q.flows, today, range])

  return (
    <MoneyFrame active={null}>
      <NoPrimary />
      <MoneySubHeader
        back={{ to: '/money', label: 'Money' }}
        title="Profitability"
        meta={
          <InfoTip label="About profitability">
            Income is what we invoiced, with GST left out. Cash received is what customers paid, and it includes GST. The two differ when
            customers pay later than they are invoiced. The average leaves out the current month, because it is not over.
          </InfoTip>
        }
      />
      {q.isError ? (
        <ReportError title="Profitability did not load" onRetry={q.refetch} />
      ) : q.isPending || !view ? (
        <ReportLoading label="Loading profitability" />
      ) : (
        <>
          <Body last12={view.last12} shown={view.shown} range={range} onRange={setRange} />
          <LostEnquiries rows={lost.data} isError={lost.isError} onRetry={() => void lost.refetch()} />
        </>
      )}
    </MoneyFrame>
  )
}

function Body({ last12, shown, range, onRange }: { last12: ProfitPoint[]; shown: ProfitPoint[]; range: RangeMonths; onRange: (r: RangeMonths) => void }) {
  const avgIncome = averageOf(last12, 'income')
  const avgCash = averageOf(last12, 'cash')
  const avgProfit = averageOf(last12, 'profit')
  const span = spanLabel(last12.map(x => x.month))
  const empty = sumOf(shown, 'income') === 0n && sumOf(shown, 'cash') === 0n
  const best = bestMonth(shown)
  const summary = empty
    ? `No income or cash received in the last ${range} complete months.`
    : `Income and cash received for each of the last ${range} complete months, ${spanLabel(shown.map(x => x.month))}. Average monthly income over the last 12 months is ${pkr(avgIncome)}, GST left out.${best ? ` The highest month was ${shortMonth(best.month)} at ${pkr(best.income)}.` : ''}`
  return (
    <>
      <section aria-label="Average monthly income" className="grid gap-4 rounded-panel border bg-surface p-4 md:grid-cols-2 md:p-6" data-testid="profit-average">
        <div className="grid content-start gap-1">
          <h2 className="text-base font-semibold">Average monthly income</h2>
          <p className="num text-2xl font-semibold" data-testid="profit-average-income">
            {pkr(avgIncome)}
          </p>
          <p className="text-base text-fg-2">Invoiced, GST left out. Last 12 complete months, {span}. This month is left out.</p>
        </div>
        <div className="grid content-start gap-1">
          <h2 className="text-base font-semibold">Average cash received a month</h2>
          <p className="num text-2xl font-semibold" data-testid="profit-average-cash">
            {pkr(avgCash)}
          </p>
          <p className="text-base text-fg-2">Includes GST. What customers actually paid in the same 12 months.</p>
        </div>
        <p className="text-base text-fg-2 md:col-span-2">
          Average monthly profit on invoices over the same months: <span className="num font-medium text-fg">{pkr(avgProfit)}</span>.{' '}
          <Link to="/money/margins" className="inline-flex items-center gap-1 rounded font-medium text-primary-text hover:underline">
            See the profit of each order <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </p>
      </section>

      <Panel
        title="Income by month"
        actions={
          <SegmentedControl
            aria-label="Months shown"
            value={String(range)}
            onValueChange={v => onRange(v === '24' ? 24 : 12)}
            options={[
              { value: '12', label: '12 months' },
              { value: '24', label: '24 months' },
            ]}
            large
          />
        }
        bodyClassName="p-4 md:p-6"
      >
        {empty ? (
          <EmptyState title="Nothing invoiced or received yet">No invoice or payment is dated in these months.</EmptyState>
        ) : (
          <BarChart
            labels={shown.map(x => shortMonth(x.month))}
            series={[
              { name: 'Income (invoiced, no GST)', values: shown.map(x => rupeesOf(x.income)) },
              { name: 'Cash received (includes GST)', values: shown.map(x => rupeesOf(x.cash)) },
            ]}
            reference={{ label: 'Average income', value: rupeesOf(avgIncome) }}
            summary={summary}
            format={n => `PKR ${Math.round(n).toLocaleString('en-US')}`}
            tableCaption={`Income and cash received by month, ${spanLabel(shown.map(x => x.month))}`}
          />
        )}
      </Panel>

      <ProfitTable rows={[...shown].reverse()} label={`Profit by month, last ${range} months`} />
    </>
  )
}

/** The monthly profit on invoices with the cash received beside it; newest month first. Totals are summed from the rows drawn. */
function ProfitTable({ rows, label }: { rows: ProfitPoint[]; label: string }) {
  const columns: Column<ProfitPoint>[] = [
    { id: 'month', header: 'Month', value: r => r.month, cell: r => shortMonth(r.month) },
    { id: 'income', header: 'Income (PKR)', kind: 'money', value: r => paisaToFixed(r.income), total: true, paisa: 'never' },
    { id: 'costs', header: 'Costs (PKR)', kind: 'money', value: r => paisaToFixed(r.costs), total: true, paisa: 'never', hideBelowMd: true },
    { id: 'profit', header: 'Profit (PKR)', kind: 'money', value: r => paisaToFixed(r.profit), total: true, paisa: 'never' },
    { id: 'cash', header: 'Cash received, includes GST (PKR)', kind: 'money', value: r => paisaToFixed(r.cash), total: true, paisa: 'never' },
  ]
  return (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      getRowId={r => r.month}
      footerLabel={`Total of ${rows.length} months`}
      summary="Income is invoiced, GST left out. Cash received includes GST."
      toolbar={<h2 className="text-base font-semibold">Profit by month</h2>}
      mobileRow={r => (
        <span className="grid gap-1">
          <span className="font-medium">{shortMonth(r.month)}</span>
          <span className="num text-base text-fg-2">
            Income {rupees(r.income)} · profit {rupees(r.profit)} · cash received {rupees(r.cash)}
          </span>
        </span>
      )}
    />
  )
}

/** Money spent on enquiries that ended without an order. Its own panel, so a failed read never hides the profit figures. */
function LostEnquiries({ rows, isError, onRetry }: { rows: LostEnquiryCost[] | undefined; isError: boolean; onRetry: () => void }) {
  const title = 'Spent on enquiries we did not win'
  if (isError) return <ReportError title={`${title} did not load`} onRetry={onRetry} />
  if (!rows) return <ReportLoading label={`Loading: ${title}`} />
  const columns: Column<LostEnquiryCost>[] = [
    {
      id: 'rfq',
      header: 'Enquiry',
      value: r => r.rfqNumber,
      cell: r => (
        <Link to={`/rfqs/${r.rfqId}`} className="font-medium text-primary-text hover:underline">
          {rfqRef(r.rfqNumber)}
        </Link>
      ),
    },
    { id: 'company', header: 'Customer', value: r => r.company },
    { id: 'spent', header: 'Spent (PKR)', kind: 'money', value: r => paisaToFixed(r.spent), total: true },
    { id: 'count', header: 'Costs', value: r => r.costCount, hideBelowMd: true },
    { id: 'last', header: 'Last paid', value: r => r.lastPaidOn ?? '', cell: r => (r.lastPaidOn ? formatShortDate(r.lastPaidOn, undefined, true) : ''), hideBelowMd: true },
  ]
  return (
    <Panel title={title} meta={<InfoTip label="About enquiries we did not win">Costs paid on an enquiry that was closed without an order, net of input tax. The profit figures above are not changed by this list.</InfoTip>}>
      {rows.length === 0 ? (
        <EmptyState title="Nothing spent on a lost enquiry">No cost is recorded against an enquiry that was closed without an order.</EmptyState>
      ) : (
        <DataTable
          label={title}
          columns={columns}
          rows={rows}
          getRowId={r => r.rfqId}
          footerLabel={`Total of ${rows.length} ${rows.length === 1 ? 'enquiry' : 'enquiries'}`}
          mobileRow={r => (
            <span className="grid gap-1">
              <span className="font-medium">
                {rfqRef(r.rfqNumber)} · {r.company}
              </span>
              <span className="num text-base text-fg-2">Spent {formatPaisa(r.spent)}</span>
            </span>
          )}
        />
      )}
    </Panel>
  )
}
