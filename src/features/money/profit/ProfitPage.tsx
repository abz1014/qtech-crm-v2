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
import { Money } from '@/ui/Money'
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
 * lost; 0136), net of GST paid on purchases. It is a list for the owner to see; the profit figures above are not changed by it.
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
      <section
        aria-label="Average monthly income"
        className="grid gap-4 rounded-panel border bg-surface p-4 md:flex md:flex-wrap md:items-baseline md:gap-x-8 md:gap-y-2 md:rounded-none md:border-x-0 md:bg-transparent md:px-0 md:py-2"
        data-testid="profit-average"
      >
        {/* From 768 up the averages are one strip: label and figure inline, the two notes joined in one muted line under it. */}
        <div className="grid content-start gap-1 md:flex md:items-baseline md:gap-2">
          <h2 className="text-base font-semibold md:font-normal md:text-fg-2">Average monthly income</h2>
          <p className="num text-2xl font-semibold md:text-base" data-testid="profit-average-income">
            {pkr(avgIncome)}
          </p>
          <p className="text-base text-fg-2 md:hidden">Invoiced, GST left out. Last 12 complete months, {span}. This month is left out.</p>
        </div>
        <div className="grid content-start gap-1 md:flex md:items-baseline md:gap-2">
          <h2 className="text-base font-semibold md:font-normal md:text-fg-2">Average cash received a month</h2>
          <p className="num text-2xl font-semibold md:text-base" data-testid="profit-average-cash">
            {pkr(avgCash)}
          </p>
          <p className="text-base text-fg-2 md:hidden">Includes GST. What customers actually paid in the same 12 months.</p>
        </div>
        <p className="hidden text-base text-fg-muted md:order-last md:block md:basis-full">
          Income is invoiced, GST left out. Cash received includes GST: what customers actually paid. Last 12 complete months, {span}. This month is left out.
        </p>
        <p className="text-base text-fg-2 md:basis-full">
          Average monthly profit on invoices over the same months: <span className="num font-medium text-fg">{pkr(avgProfit)}</span>.{' '}
          <Link to="/money/margins" className="inline-flex items-center gap-1 rounded font-medium text-primary-text hover:underline md:hidden">
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
        flat
        bodyClassName="p-4 md:px-0 md:py-4"
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
      {/* From 768 up the way on to each order sits under the table, so the strip at the top stays figures only. */}
      <Link to="/money/margins" className="hidden w-fit items-center gap-1 rounded font-medium text-primary-text hover:underline md:inline-flex">
        See the profit of each order <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </>
  )
}

type DrawnRow = ProfitPoint & { run?: string }

/** Newest-first months with each run of two or more empty ones (nothing invoiced, paid or received) folded into one row labelled "Jan to Sep 2026". */
function runEmptyMonths(rows: ProfitPoint[]): DrawnRow[] {
  const empty = (r: ProfitPoint) => r.income === 0n && r.cash === 0n && r.costs === 0n && r.profit === 0n
  const out: DrawnRow[] = []
  for (let i = 0; i < rows.length; ) {
    let j = i
    while (j < rows.length && empty(rows[j])) j++
    if (j - i >= 2) {
      const newest = rows[i].month
      const oldest = rows[j - 1].month
      const run = newest.slice(0, 4) === oldest.slice(0, 4) ? `${shortMonth(oldest).slice(0, 3)} to ${shortMonth(newest)}` : `${shortMonth(oldest)} to ${shortMonth(newest)}`
      out.push({ ...rows[i], run })
      i = j
    } else {
      out.push(rows[i])
      i++
    }
  }
  return out
}

/** The monthly profit on invoices with the cash received beside it; newest month first. Totals are summed from the rows drawn. */
function ProfitTable({ rows: monthRows, label }: { rows: ProfitPoint[]; label: string }) {
  // Presentation only: two or more empty months in a row show as one line, "Jan to Sep 2026: nothing recorded". Every figure stays as it was (an empty month adds 0).
  const rows = useMemo(() => runEmptyMonths(monthRows), [monthRows])
  const money = (get: (r: DrawnRow) => bigint) => (r: DrawnRow) => (r.run ? <span /> : <Money value={paisaToFixed(get(r))} prefix={false} paisa="never" />)
  const columns: Column<DrawnRow>[] = [
    { id: 'month', header: 'Month', value: r => r.month, cell: r => (r.run ? <span className="text-fg-2">{r.run}: nothing recorded</span> : shortMonth(r.month)) },
    { id: 'income', header: 'Income (PKR)', kind: 'money', value: r => paisaToFixed(r.income), total: true, paisa: 'never', cell: money(r => r.income) },
    { id: 'costs', header: 'Costs (PKR)', kind: 'money', value: r => paisaToFixed(r.costs), total: true, paisa: 'never', hideBelowMd: true, cell: money(r => r.costs) },
    { id: 'profit', header: 'Profit (PKR)', kind: 'money', value: r => paisaToFixed(r.profit), total: true, paisa: 'never', cell: money(r => r.profit) },
    { id: 'cash', header: 'Cash received, includes GST (PKR)', kind: 'money', value: r => paisaToFixed(r.cash), total: true, paisa: 'never', cell: money(r => r.cash) },
  ]
  return (
    <DataTable
      className="md:rounded-none md:border-x-0"
      label={label}
      columns={columns}
      rows={rows}
      getRowId={r => r.month}
      footerLabel={`Total of ${monthRows.length} months`}
      summary="Income is invoiced, GST left out. Cash received includes GST."
      toolbar={<h2 className="text-base font-semibold">Profit by month</h2>}
      mobileRow={r =>
        r.run ? (
          <span className="text-fg-2">{r.run}: nothing recorded</span>
        ) : (
        <span className="grid gap-1">
          <span className="font-medium">{shortMonth(r.month)}</span>
          <span className="num text-base text-fg-2">
            Income {rupees(r.income)} · profit {rupees(r.profit)} · cash received {rupees(r.cash)}
          </span>
        </span>
        )
      }
    />
  )
}

/** Money spent on enquiries that ended without an order. Its own panel, so a failed read never hides the profit figures. */
function LostEnquiries({ rows, isError, onRetry }: { rows: LostEnquiryCost[] | undefined; isError: boolean; onRetry: () => void }) {
  const title = 'Spent on RFQs we did not win'
  if (isError) return <ReportError title={`${title} did not load`} onRetry={onRetry} />
  if (!rows) return <ReportLoading label={`Loading: ${title}`} />
  const columns: Column<LostEnquiryCost>[] = [
    {
      id: 'rfq',
      header: 'RFQ',
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
    <Panel flat title={title} meta={<InfoTip label="About RFQs we did not win">Costs paid on an RFQ that was closed without an order, net of GST paid on purchases. The profit figures above are not changed by this list.</InfoTip>}>
      {rows.length === 0 ? (
        <EmptyState title="Nothing spent on a lost RFQ">No cost is recorded against an RFQ that was closed without an order.</EmptyState>
      ) : (
        <DataTable
          className="md:rounded-none md:border-x-0"
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
