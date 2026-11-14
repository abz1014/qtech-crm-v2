import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { businessToday } from '@/lib/dates'
import { formatPaisa, paisaToFixed } from '@/lib/money'
import { rfqRef } from '@/lib/refs'
import { formatShortDate } from '@/lib/formatDay'
import { BarChart } from '@/ui/BarChart'
import { Button } from '@/ui/Button'
import { buttonStyles } from '@/ui/buttonStyles'
import { CARD } from '@/ui/card'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { InfoTip } from '@/ui/InfoTip'
import { Money } from '@/ui/Money'
import { NoPrimary } from '@/ui/NoPrimary'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Skeleton } from '@/ui/Skeleton'
import { cn } from '@/lib/utils'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import { useLostEnquiryCosts, useProfitPage } from '@/features/money/profit/hooks'
import type { LostEnquiryCost } from '@/features/money/profit/api'
import { averageOf, bestMonth, buildPoints, completeMonths, rupeesOf, shortMonth, spanLabel, sumOf, type ProfitPoint, type RangeMonths } from '@/features/money/profit/model'

/*
 * Money > Profitability (owner decision 2026-11-05; admin only, as the Reports). Income is what we INVOICED, GST left out; the cash
 * received beside it includes GST and says so. The average is over the last 12 complete months, this month left out. The chart shows
 * 12 or 24 months of both; the table under it is the monthly profit on invoices (v_month_profit) with cash received (v_month_cash_flow).
 * Under the table, "Spent on enquiries we did not win" lists what was spent on enquiries closed without an order (v_enquiry_costs, state
 * lost; 0136), net of GST paid on purchases. It is a list for the owner to see; the profit figures above are not changed by it.
 * Forest (56-margins-profit #pf-page): the two averages as the page's big figures side by side (stacked on a phone), each with its
 * note; then the chart, the monthly table and the lost-RFQ list each as one card, and "See the profit of each order" an outline
 * button between them. Loading draws the same shapes; a failed read is one card with Try again.
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
            Income is the amount invoiced, with GST left out. Cash received is what customers paid, and it includes GST. The two differ when
            customers pay later than they are invoiced. The average leaves out the current month, because it is not over.
          </InfoTip>
        }
      />
      {q.isError ? (
        <LoadError title="Profitability did not load" onRetry={() => void q.refetch()} />
      ) : q.isPending || !view ? (
        <ProfitLoading />
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
      <section aria-label="Average monthly income" className="grid gap-4" data-testid="profit-average">
        <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:flex lg:flex-wrap">
          <Figure
            label="Average monthly income"
            testId="profit-average-income"
            value={pkr(avgIncome)}
            note={<>Invoiced, GST left out. Last 12 complete months, {span}. This month is left out.</>}
          />
          <Figure label="Average cash received a month" testId="profit-average-cash" value={pkr(avgCash)} note="Includes GST. What customers actually paid in the same 12 months." />
        </div>
        <p className="text-base text-fg-2">
          Average monthly profit on invoices over the same months: <span className="num font-semibold text-fg">{pkr(avgProfit)}</span>.
        </p>
      </section>

      <Card
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
      </Card>

      <ProfitTable rows={[...shown].reverse()} label={`Profit by month, last ${range} months`} />
      <Link to="/money/margins" className={cn(buttonStyles(), 'w-fit max-md:h-touch')}>
        See the profit of each order <ChevronRight aria-hidden="true" className="size-4" />
      </Link>
    </>
  )
}

/** One of the two averages: the label, the figure as the page's big number, and what it counts. */
function Figure({ label, value, note, testId }: { label: string; value: string; note: ReactNode; testId: string }) {
  return (
    <div className="grid min-w-0 content-start gap-1 lg:max-w-[22rem]">
      <h2 className="text-sm font-semibold text-fg">{label}</h2>
      <p className="num text-kpi font-heavy tracking-snug text-fg [overflow-wrap:anywhere]" data-testid={testId}>
        {value}
      </p>
      <p className="text-sm text-fg-2 text-pretty">{note}</p>
    </div>
  )
}

/** A Forest card with its title row (the one card look, src/ui/card.ts). */
function Card({ title, meta, actions, children }: { title: string; meta?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn('grid min-w-0 gap-4 p-card', CARD)}>
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="min-w-0 text-lg font-heavy">{title}</h2>
          {meta}
        </div>
        <span className="flex-1" />
        {actions}
      </header>
      {children}
    </section>
  )
}

/** A failed read: one card that says what happened and offers Try again. */
function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className={cn('mx-auto w-full max-w-[520px] p-card', CARD)}>
      <EmptyState
        mood="error"
        title={title}
        actions={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        Nothing was changed. Try again, and if the error continues, tell the admin.
      </EmptyState>
    </div>
  )
}

/** Loading, in the page's own shapes: the two figures, the chart card and the table card. */
function ProfitLoading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading profitability" className="grid gap-card-gap">
      <div className="grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:flex">
        {[0, 1].map(i => (
          <div key={i} className="grid gap-2">
            <Skeleton className="h-4 w-[10rem]" />
            <Skeleton className="h-9 w-[12rem]" />
            <Skeleton className="h-4 w-[16rem] max-w-full" />
          </div>
        ))}
      </div>
      <div className={cn('grid gap-4 p-card', CARD)}>
        <Skeleton className="h-5 w-[10rem]" />
        <Skeleton className="h-[12rem] w-full rounded-control" />
      </div>
      <div className={cn('grid gap-3 p-card', CARD)}>
        <Skeleton className="h-5 w-[10rem]" />
        {[0, 1, 2, 3].map(r => (
          <Skeleton key={r} className="h-4 w-full" />
        ))}
      </div>
    </div>
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
      label={label}
      columns={columns}
      rows={rows}
      getRowId={r => r.month}
      footerLabel={`Total of ${monthRows.length} months`}
      summary="Income is invoiced, GST left out. Cash received includes GST."
      toolbar={<h2 className="text-lg font-heavy">Profit by month</h2>}
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
  const title = 'Spent on RFQs not won'
  if (isError) return <LoadError title={`${title} did not load`} onRetry={onRetry} />
  if (!rows)
    return (
      <div role="status" aria-busy="true" aria-label={`Loading: ${title}`} className={cn('grid gap-3 p-card', CARD)}>
        <Skeleton className="h-5 w-[12rem]" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
      </div>
    )
  const columns: Column<LostEnquiryCost>[] = [
    {
      id: 'rfq',
      header: 'RFQ',
      value: r => r.rfqNumber,
      cell: r => (
        <Link to={`/rfqs/${r.rfqId}`} className="num rounded font-semibold text-primary underline decoration-1 underline-offset-2 hover:text-fg">
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
    <Card title={title} meta={<InfoTip label="About RFQs not won">Costs paid on an RFQ that was closed without an order, net of GST paid on purchases. The profit figures above are not changed by this list.</InfoTip>}>
      {rows.length === 0 ? (
        <EmptyState title="Nothing spent on a lost RFQ">No cost is recorded against an RFQ that was closed without an order.</EmptyState>
      ) : (
        <DataTable
          flat
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
    </Card>
  )
}
