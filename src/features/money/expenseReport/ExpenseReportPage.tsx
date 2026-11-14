import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Download, FileText } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { formatPaisa, paisaToFixed, sumPaisa, toPaisa, type Amount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { SumBar, type SumBarItem } from '@/ui/SumBar'
import { Skeleton } from '@/ui/Skeleton'
import { CARD } from '@/ui/card'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useToast } from '@/ui/useToast'
import { ReportCsv } from '@/ui/ReportCsv'
import { ReportsFrame } from '@/features/reports/ReportsFrame'
import { IN_OUT_REPORT_TITLE } from '@/features/money/monthEnd/reportList'
import { downloadReport } from '@/features/money/monthEnd/reportFiles'
import { chosenPeriod, periodLabel, periodOf, shiftPeriod, type Period, type PeriodKind } from '@/features/money/inOut/model'
import { useExpenseReport } from '@/features/money/expenseReport/hooks'
import { entriesCsv, expenseReportCsv, type AcrossDetail, type CategoryLine, type ExpenseReportView, type GroupLine, type ReportEntry, type TrendBar } from '@/features/money/expenseReport/model'

/*
 * Money > Reports > Expenses (owner request 2026-10-22; admin only, the route checks the role). One month or one calendar
 * quarter (?by=quarter&period=2026-Q4, as In vs out). Read top to bottom:
 *   1. how much was spent, against the period before, cash against bank, and the last 6 months / 4 quarters as columns
 *   2. the same money as Profit and loss sees it (running costs, order costs, not a cost, input tax), so the two reports agree
 *   3. where it went: group -> category (open one for its details and every entry), with % of total, the period before and
 *      the budget; or "By detail" across categories (fuel per car)
 *   4. the ten biggest expenses
 * Export CSV and Download PDF write the same figures. Nothing is green here: the report has no primary action.
 * Forest 64-expense-report: the figures are one card of tiles (a line per figure on a phone), Where the money went a card with its
 * switch in the card head, the trend its own card with the same figures as a folded table, the biggest expenses a fold card.
 */

const rupees = (v: Amount) => formatPaisa(toPaisa(v), 'never')
const signed = (v: Amount) => (toPaisa(v) > 0n ? `+${rupees(v)}` : rupees(v))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const KIND_WORD = { overhead: 'Running cost', order_cost: 'Order cost', non_pnl: 'Not a cost' } as const

function usePeriod() {
  const today = businessToday()
  const [params, setParams] = useSearchParams()
  const kind: PeriodKind = params.get('by') === 'quarter' ? 'quarter' : 'month'
  // ?month= (kept by the Report select from a month report) opens that month; ?period= wins when both are there
  const askedKey = params.get('period') ?? (kind === 'month' ? params.get('month') : null)
  const period = useMemo(() => chosenPeriod(kind, askedKey, today), [kind, askedKey, today])
  const now = periodOf(kind, today.slice(0, 7))
  const set = (p: Period) => {
    const next = new URLSearchParams(params)
    next.set('by', p.kind)
    next.set('period', p.key)
    setParams(next, { replace: true })
  }
  return { period, now, set, today }
}

export function ExpenseReportPage() {
  const { period, now, set, today } = usePeriod()
  const q = useExpenseReport(period)
  const v = q.view
  const toast = useToast()
  const [pdfBusy, setPdfBusy] = useState(false)
  const savePdf = async () => {
    if (!v) return
    setPdfBusy(true)
    try {
      const { generateExpenseReportPdf, saveBlob } = await import('@/features/money/expenseReport/pdf/generate')
      saveBlob(await generateExpenseReportPdf(v, formatShortDate(today, undefined, true)), `expenses-${period.key}.pdf`)
    } catch {
      toast.toast({ title: "The PDF could not be made", body: 'Nothing was changed. Try again, or use Export CSV.', tone: 'danger' })
    } finally {
      setPdfBusy(false)
    }
  }
  return (
    <ReportsFrame
      report="expenses"
      csv={v ? () => downloadReport(expenseReportCsv(v), `expenses-${period.key}.csv`) : null}
      period={
        <span className="flex flex-wrap items-center gap-3">
          <SegmentedControl
            aria-label="Month or quarter"
            options={[
              { value: 'month', label: 'Month' },
              { value: 'quarter', label: 'Quarter' },
            ]}
            value={period.kind}
            onValueChange={k => set(periodOf(k as PeriodKind, k === period.kind ? period.key : today.slice(0, 7)))}
            large
          />
          <PeriodPager period={period} atNow={period.key >= now.key} go={by => set(shiftPeriod(period, by))} />
        </span>
      }
    >
      {q.isError ? (
        <div className={cn(CARD, 'p-card')}>
          <EmptyState
            mood="error"
            title="The expenses report did not load"
            actions={
              <Button variant="secondary" onClick={() => void q.refetch()}>
                Try again
              </Button>
            }
          >
            Nothing was changed. Payments, expenses and ticks are kept. Try again, and if the error continues, tell the admin.
          </EmptyState>
        </div>
      ) : q.isPending || !v ? (
        <Loading />
      ) : (
        <>
          <Body v={v} onPick={set} />
          <div className="flex flex-wrap gap-3">
            <Button icon={FileText} busy={pdfBusy} busyLabel="Making PDF" onClick={() => void savePdf()}>
              Download PDF
            </Button>
          </div>
        </>
      )}
    </ReportsFrame>
  )
}

/** The report while it loads, in its own shape: the card of figures, then the Where the money went card with its rows. */
function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading the expenses report" className="grid gap-card-gap">
      <div className={cn(CARD, 'grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-4')}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
          <div key={i} className={cn('grid gap-2 bg-surface px-5 py-4 max-sm:px-4', i > 3 && 'max-md:hidden')}>
            <Skeleton className="w-[6rem]" />
            <Skeleton className="h-6 w-[8rem]" />
            <Skeleton className="w-[7rem]" />
          </div>
        ))}
      </div>
      <div className={cn(CARD, 'overflow-hidden')}>
        <div className="flex min-h-head items-center justify-between gap-4 border-b px-card py-3">
          <Skeleton className="h-5 w-[12rem]" />
          <Skeleton className="h-segment w-[12rem] rounded-pill max-sm:hidden" />
        </div>
        <div className="grid px-card">
          {[0, 1, 2, 3, 4, 5].map(r => (
            <div key={r} className="flex min-h-row items-center gap-4 border-b last:border-b-0">
              <Skeleton className="flex-1" />
              <Skeleton className="w-[5rem]" />
              <Skeleton className="w-12 max-md:hidden" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PeriodPager({ period, atNow, go }: { period: Period; atNow: boolean; go: (by: number) => void }) {
  const unit = period.kind === 'month' ? 'month' : 'quarter'
  return (
    <div role="group" aria-label="Period" className="inline-flex gap-[2px] rounded bg-selected p-[2px]">
      <button type="button" aria-label={`Previous ${unit}`} onClick={() => go(-1)} className="inline-flex h-control w-control items-center justify-center rounded px-2 text-fg-2 hover:text-fg">
        <Icon icon={ChevronLeft} size="sm" />
      </button>
      <span aria-live="polite" data-testid="expense-report-period" className="num inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium">
        {periodLabel(period)}
      </span>
      <button
        type="button"
        aria-label={`Next ${unit}`}
        disabled={atNow}
        onClick={() => go(1)}
        className="inline-flex h-control w-control items-center justify-center rounded px-2 text-fg-2 hover:text-fg disabled:text-fg-disabled"
      >
        <Icon icon={ChevronRight} size="sm" />
      </button>
    </div>
  )
}

function Body({ v, onPick }: { v: ExpenseReportView; onPick: (p: Period) => void }) {
  const [view, setView] = useState<'category' | 'detail'>('category')
  const narrow = useMediaQuery('(max-width: 639px)')
  const trend = <Trend bars={v.trend} kind={v.period.kind} onPick={onPick} />
  return (
    <>
      <Summary v={v} narrow={narrow} />
      <ReportCsv />
      {v.total.count === 0 && v.prev.count === 0 ? (
        <section className={CARD}>
          <EmptyState title={`No expenses in ${v.label}`}>Expenses dated in this period show here. The columns below still show the periods before.</EmptyState>
        </section>
      ) : (
        <section aria-labelledby="exp-where" className={cn(CARD, 'min-w-0 overflow-hidden')}>
          {/* The card head: the question on the left, the switch on the right; on a phone the switch wraps under it. */}
          <header className="flex min-h-head flex-wrap items-center gap-x-4 gap-y-3 border-b px-card py-3">
            <h2 id="exp-where" className="type-section">
              Where the money went
            </h2>
            <SegmentedControl
              className="sm:ml-auto"
              aria-label="Show by"
              options={[
                { value: 'category', label: 'By category' },
                { value: 'detail', label: 'By detail' },
              ]}
              value={view}
              onValueChange={x => setView(x as 'category' | 'detail')}
            />
          </header>
          {view === 'category' ? <Breakdown v={v} /> : <ByDetail v={v} />}
        </section>
      )}
      {/* Desktop: the trend follows the table it explains. A phone reads the figures first; the columns come last. */}
      {narrow ? null : trend}
      {v.top.length > 0 ? <TopTen v={v} narrow={narrow} /> : null}
      {narrow ? trend : null}
    </>
  )
}

// ------------------------------------------------------------------------------------------------ 1 and 2: the summary

const KIND_NOTE = { running: 'Overheads in Profit and loss', order: 'Supplier, freight and customs', notCost: 'Drawings and loan repayments', inputTax: 'Claimed back' } as const

function Summary({ v, narrow }: { v: ExpenseReportView; narrow: boolean }) {
  const up = toPaisa(v.change) > 0n
  const same = toPaisa(v.change) === 0n
  const change = same ? 'the same' : `${up ? '+' : '−'}${rupees(up ? v.change : (-Number(v.change)).toFixed(2))}`
  const pct = v.changePct !== null ? `${Math.abs(v.changePct)}%` : null
  const frozen = v.frozenMonths === 0 ? null : v.frozenMonths === v.months ? 'Locked: figures final' : `${plural(v.frozenMonths, 'month')} locked: figures final`
  const paidElsewhere = toPaisa(v.forHerePaidElsewhere) !== 0n || toPaisa(v.paidForOther) !== 0n
  const paidLine = (
    <>
      By the month each expense is for (September&apos;s salary paid in October is September&apos;s). Paid in {v.label}, by the day paid: PKR {rupees(v.paid.amount)}
      {paidElsewhere
        ? ` (= ${rupees(v.total.amount)}${toPaisa(v.forHerePaidElsewhere) !== 0n ? ` − ${rupees(v.forHerePaidElsewhere)} paid in another month` : ''}${toPaisa(v.paidForOther) !== 0n ? ` + ${rupees(v.paidForOther)} paid now for another month` : ''})`
        : ''}
      .
    </>
  )
  const unexplained =
    toPaisa(v.unexplained) !== 0n ? (
      <p className="type-body flex items-start gap-2 text-tone-danger-fg" data-testid="expense-report-unexplained">
        <Icon icon={CircleAlert} size="sm" className="mt-1 shrink-0" />
        In vs out has {signed(v.unexplained)} more paid out than the entries paid in this period: a locked month was changed after it was locked.
      </p>
    ) : null
  const inOut = (
    <Link
      to={`/money/reports/in-out?by=${v.period.kind}&period=${v.period.key}`}
      className="type-body inline-flex min-h-touch items-center gap-1 justify-self-start font-medium text-primary underline-offset-4 hover:underline md:min-h-control"
    >
      {IN_OUT_REPORT_TITLE}, same period
      <Icon icon={ChevronRight} size="sm" />
    </Link>
  )
  if (narrow) {
    // Phone: ONE card, a line per figure (SumBar lines), so every figure shows without a tap. The by-the-day-paid sentence is the (i).
    return (
      <>
        <SumBar
          phone="lines"
          className={cn(CARD, 'gap-3 p-card')}
          label={`Spent in ${v.label}`}
          caption={
            <span data-testid="expense-report-paid">
              PKR · Spent in {v.label}, {plural(v.total.count, 'expense')}
              {frozen ? ` · ${frozen}` : ''}
              <InfoTip label="What these figures count" className="ml-2">
                {paidLine}
              </InfoTip>
            </span>
          }
          items={[
            { label: 'Spent', amount: v.total.amount },
            { label: `vs ${v.prevLabel}`, figure: pct && !same ? `${change} (${pct})` : change },
            { label: 'Cash', amount: v.total.cash },
            { label: 'Bank', amount: v.total.bank },
            { label: 'Running costs', amount: v.kinds.running },
            { label: 'Order costs', amount: v.kinds.order },
            { label: 'Not a cost', amount: v.kinds.notCost },
            { label: 'GST paid on purchases', amount: v.kinds.inputTax },
          ]}
        />
        {unexplained}
        {inOut}
      </>
    )
  }
  // Desktop: ONE card of tiles (64-expense-report #ex-report), four to a row, each figure with its one line of context; under it
  // ONE muted line, what the figures count.
  const items: SumBarItem[] = [
    { label: 'Spent', amount: v.total.amount, sub: plural(v.total.count, 'expense') },
    { label: `vs ${v.prevLabel}`, figure: change, sub: same || !pct ? undefined : `${up ? 'Up' : 'Down'} ${pct}` },
    { label: 'Cash', amount: v.total.cash, sub: plural(v.total.cashCount, 'expense') },
    { label: 'Bank', amount: v.total.bank, sub: plural(v.total.bankCount, 'expense') },
    { label: 'Running costs', amount: v.kinds.running, sub: KIND_NOTE.running },
    { label: 'Order costs', amount: v.kinds.order, sub: KIND_NOTE.order },
    { label: 'Not a cost', amount: v.kinds.notCost, sub: KIND_NOTE.notCost },
    { label: 'GST paid on purchases', amount: v.kinds.inputTax, sub: KIND_NOTE.inputTax },
  ]
  return (
    <div className="grid gap-3" data-testid="expense-report-total">
      <SumBar label={`Spent in ${v.label}`} className="rounded-card shadow-e1 md:auto-cols-auto md:grid-flow-row md:grid-cols-4" items={items} />
      <p className="type-body max-w-prose text-fg-2">
        <span>
          PKR · Spent in {v.label}, {plural(v.total.count, 'expense')}
          {frozen ? ` · ${frozen}` : ''}.{' '}
        </span>
        <span data-testid="expense-report-paid">{paidLine}</span>
      </p>
      {unexplained}
      {inOut}
    </div>
  )
}

/**
 * The last 6 months or 4 quarters as columns (dataviz: one series, so one neutral hue and the period shown in brand green;
 * thin columns with a 4 px rounded top on one baseline; every column prints its short value above it (a phone cannot hover), the
 * shown period in the stronger weight). A column opens its period. The same figures are a folded table under the columns
 * (F-789), so nobody has to read them off the bars.
 */
export function Trend({ bars, kind, onPick }: { bars: TrendBar[]; kind: PeriodKind; onPick: (p: Period) => void }) {
  const max = bars.reduce((m, b) => (toPaisa(b.amount) > m ? toPaisa(b.amount) : m), 0n)
  const h = (a: string) => (max === 0n ? 0 : Math.max(Number((toPaisa(a) * 1000n) / max) / 10, toPaisa(a) > 0n ? 2 : 0))
  const title = kind === 'month' ? 'Last 6 months, paid out by the day paid' : 'Last 4 quarters, paid out by the day paid'
  const cols = { gridTemplateColumns: `repeat(${bars.length}, minmax(0,1fr))` }
  return (
    // The card holds the columns (the figure; every button in it is a column) and, under them, the same figures as a table.
    <section aria-label={title} className={cn(CARD, 'grid min-w-0 content-start gap-3 p-card')}>
      <figure className="grid min-w-0 gap-3" data-testid="expense-report-trend">
        <figcaption className="type-body text-fg-2">{title}</figcaption>
        <div className="grid h-[9.5rem] items-end gap-1 border-b border-line-strong" style={cols}>
          {bars.map(b => (
            <button
              key={b.period.key}
              type="button"
              data-row-actions=""
              onClick={() => onPick(b.period)}
              aria-label={`${b.current ? `${compact(b.amount)}, ` : ''}${b.label}: PKR ${rupees(b.amount)} spent${b.current ? ', shown' : ''}`}
              aria-current={b.current || undefined}
              title={`${b.label}: PKR ${rupees(b.amount)}`}
              className="group relative flex h-full flex-col items-center justify-end rounded-t-control transition-colors duration-fast hover:bg-sunken focus-visible:outline-offset-0 motion-reduce:transition-none"
            >
              <span className={cn('num mb-1 whitespace-nowrap text-xs', b.current ? 'font-semibold text-fg' : 'font-medium text-fg-2')}>{compact(b.amount)}</span>
              <span className={cn('w-full max-w-[2rem] rounded-t-[0.25rem]', b.current ? 'bg-brand-500' : 'bg-fg-muted')} style={{ height: `${h(b.amount)}%`, maxHeight: 'calc(100% - 1.5rem)' }} />
            </button>
          ))}
        </div>
        <div className="grid gap-1" style={cols} aria-hidden="true">
          {bars.map(b => (
            <span key={b.period.key} className={cn('num text-center text-xs', b.current ? 'font-semibold text-fg' : 'text-fg-muted')}>
              {b.label.replace(/ \d{4}$/, m => (kind === 'quarter' ? m : ''))}
            </span>
          ))}
        </div>
      </figure>
      <details className="group/t rounded-control border">
        <summary className="flex min-h-touch cursor-pointer list-none items-center justify-between gap-3 rounded-control px-4 transition-colors duration-fast hover:bg-sunken motion-reduce:transition-none md:min-h-control [&::-webkit-details-marker]:hidden">
          <span className="type-row">The same figures as a table</span>
          <Icon icon={ChevronDown} size="sm" className="text-fg-muted transition-transform duration-fast group-open/t:rotate-180 motion-reduce:transition-none" />
        </summary>
        <div className="border-t px-4 pb-1">
          <DataTable
            flat
            label={`${title}, spent (PKR)`}
            columns={trendColumns(kind)}
            rows={bars}
            getRowId={b => b.period.key}
            mobileRow={b => (
              <div className={cn('flex items-baseline justify-between gap-3 py-1', b.current && 'font-semibold')}>
                <span>
                  {b.label}
                  {b.current ? <span className="font-regular text-fg-muted"> (shown)</span> : null}
                </span>
                <span className="num">{rupees(b.amount)}</span>
              </div>
            )}
          />
        </div>
      </details>
    </section>
  )
}

/** The trend's columns as a table: the period, and what was paid in it. */
const trendColumns = (kind: PeriodKind): Column<TrendBar>[] => [
  {
    id: 'period',
    header: kind === 'month' ? 'Month' : 'Quarter',
    value: b => b.period.key,
    cell: b => (
      <span className={cn(b.current && 'font-semibold')}>
        {b.label}
        {b.current ? <span className="font-regular text-fg-muted"> (shown)</span> : null}
      </span>
    ),
  },
  { id: 'paid', header: 'Paid (PKR)', kind: 'num', value: b => b.amount, cell: b => <span className={cn('num', b.current && 'font-semibold')}>{rupees(b.amount)}</span> },
]

/** 1,234,560 -> "1.23M", 845,000 -> "845K", 9,500 -> "9.5K": a column cap label. */
function compact(a: string): string {
  const n = Number(a)
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, '')}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`
  return rupees(a)
}

// ------------------------------------------------------------------------------------------------ 3: where it went

function VsPrev({ now, before }: { now: string; before: string }) {
  const d = toPaisa(now) - toPaisa(before)
  if (d === 0n) return <span className="text-fg-muted">same</span>
  return <span className={cn(d > 0n ? 'text-fg' : 'text-fg-muted')}>{signed((Number(d) / 100).toFixed(2))}</span>
}

function BudgetCell({ budget, left }: { budget: string | null; left: string | null }) {
  if (budget === null || left === null) return <span className="text-fg-muted">—</span>
  const over = toPaisa(left) < 0n
  return over ? (
    <span className="inline-flex items-center justify-end gap-1 font-medium text-tone-danger-fg">
      <Icon icon={CircleAlert} size="chip" />
      {rupees((-Number(left)).toFixed(2))} over
    </span>
  ) : (
    <span className="text-fg-2">
      {rupees(left)} left <span className="text-fg-muted">of {rupees(budget)}</span>
    </span>
  )
}

interface CatRow extends CategoryLine {
  group: GroupLine
}

/**
 * Group -> category, as one table: a group is a band with its subtotal, a category a row (% of total, the period before, the
 * budget). Opening a row (click, Enter) shows that category below the table: its details (fuel per car) and every entry.
 */
function Breakdown({ v }: { v: ExpenseReportView }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const rows = useMemo<CatRow[]>(() => v.groups.flatMap(g => g.categories.map(c => ({ ...c, group: g }))), [v])
  const opened = rows.find(r => r.id === openId) ?? null
  const prevShort = v.prevLabel.replace(/ \(.*\)$/, '')
  const columns: Column<CatRow>[] = [
    {
      id: 'name',
      header: 'Group and category',
      value: r => r.name,
      cell: r => (
        <span className="grid gap-1">
          <span className="inline-flex items-center gap-2">
            <Icon icon={ChevronRight} size="sm" className={cn('shrink-0 text-fg-muted', r.count === 0 && 'invisible', openId === r.id && 'rotate-90')} />
            <span className="font-medium">{r.name}</span>
            {r.archived ? <span className="text-sm text-fg-muted">archived</span> : null}
          </span>
          {r.isMisc ? <MiscTitles c={r} /> : null}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'Paid (PKR)',
      kind: 'money',
      width: 150,
      value: r => r.amount,
      // whole rupees, like every figure on the screen (the CSV keeps paisa)
      total: list => <span className="num font-medium">{rupees(paisaToFixed(sumPaisa(list.map(r => r.amount))))}</span>,
      paisa: 'never',
      cell: r => (r.count === 0 ? <span className="text-fg-muted">—</span> : <span className="num">{rupees(r.amount)}</span>),
    },
    { id: 'share', header: '% of total', kind: 'num', width: 110, hideBelowMd: true, value: r => r.share, cell: r => <span className="num">{r.share}%</span> },
    {
      id: 'prev',
      header: `vs ${prevShort}`,
      kind: 'num',
      width: 170,
      hideBelowMd: true,
      value: r => Number(r.amount) - Number(r.prev),
      cell: r => (
        <span className="num grid justify-items-end leading-tight">
          <VsPrev now={r.amount} before={r.prev} />
          <span className="text-xs text-fg-muted">was {rupees(r.prev)}</span>
        </span>
      ),
    },
    { id: 'budget', header: 'Budget', width: 240, align: 'right', hideBelowLg: true, value: r => r.budgetLeft, cell: r => <BudgetCell budget={r.budget} left={r.budgetLeft} /> },
  ]
  return (
    <div className="grid min-w-0" data-testid="expense-report-breakdown">
      {/* flat: the table sits straight on the card (no second edge), its first and last columns on the card's padding. */}
      <div className="min-w-0 px-card pb-2">
        <DataTable
          flat
          label={`Where the money went in ${v.label}`}
          columns={columns}
          rows={rows}
          getRowId={r => r.id}
          activeRowId={openId}
          onRowOpen={r => setOpenId(id => (id === r.id || r.count === 0 ? null : r.id))}
          group={r => ({
            key: r.group.id,
            label: (
              <span>
                {r.group.name}
                {r.group.name.toLowerCase().startsWith(KIND_WORD[r.group.kind].toLowerCase()) ? null : <span className="font-normal text-fg-muted max-md:hidden"> · {KIND_WORD[r.group.kind]}</span>}
                <span className="num sm:hidden">
                  {' · '}
                  {rupees(r.group.amount)} ({r.group.share}%)
                </span>
              </span>
            ),
          })}
          groupStyle="big"
          footerLabel="Total"
          summary="Open a category to see its details and every entry"
          mobileRow={r => (
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-[2px] py-1">
              <span className="min-w-0 font-medium">
                {r.name}
                {r.isMisc ? <MiscTitles c={r} /> : null}
              </span>
              <span className="num text-right">{r.count === 0 ? '—' : rupees(r.amount)}</span>
              <span className="num col-span-2 text-sm text-fg-muted">
                {r.share}% · was {rupees(r.prev)}
                {r.budget !== null ? (
                  <span className="block">
                    <BudgetCell budget={r.budget} left={r.budgetLeft} />
                  </span>
                ) : null}
              </span>
            </div>
          )}
        />
      </div>
      {opened ? <Drill c={opened} label={v.label} onClose={() => setOpenId(null)} /> : null}
    </div>
  )
}

/**
 * 0091: under an "Other", what the one-off spends were, by the title typed ("Courier from shop 3 x, 1,500"), biggest first; the
 * rest are counted. Nothing is left as one lump of "Other".
 */
function MiscTitles({ c }: { c: CategoryLine }) {
  const titled = c.details.filter(d => d.detail)
  if (titled.length === 0) return null
  const shown = titled.slice(0, 4)
  const rest = titled.length - shown.length
  return (
    <ul className="grid gap-px pl-6 text-base text-fg-2" data-testid="misc-titles" aria-label={`${c.name}, by title`}>
      {shown.map(d => (
        <li key={d.key} className="[overflow-wrap:anywhere]">
          {d.detail}
          <span className="num text-fg-muted">
            {' · '}
            {d.count > 1 ? `${d.count} times, ` : ''}
            {rupees(d.amount)}
          </span>
        </li>
      ))}
      {rest > 0 ? <li className="text-fg-muted">and {rest} more, open this row</li> : null}
    </ul>
  )
}

/** One category opened: its details with their totals (fuel per car), then every entry, newest first. */
function Drill({ c, label, onClose }: { c: CategoryLine; label: string; onClose: () => void }) {
  const hasDetails = c.details.some(d => d.detail)
  const ref = useRef<HTMLElement | null>(null)
  // the table can be long: bring the opened category into view (no smooth scroll, so reduced motion is respected)
  useEffect(() => {
    // a block body: newer Chromium returns a Promise from scrollIntoView, and an effect must return nothing but a clean-up
    ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [c.id])
  return (
    // The opened category, at the foot of the card it belongs to: a brand rule over a sunken band, so it reads as the row's own detail.
    <section ref={ref} aria-label={`${c.name}, ${label}`} className="grid gap-4 border-t-2 border-brand-500 bg-sunken px-card py-5" data-testid="expense-report-drill">
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="type-section min-w-0 [overflow-wrap:anywhere]">
          {c.name} <span className="num font-regular text-fg-2">· PKR {rupees(c.amount)}</span>
        </h3>
        <span className="flex-1" />
        <Button size="sm" icon={Download} onClick={() => downloadReport(entriesCsv(c.name, c.entries), `expenses-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`)}>
          Export these
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          Close
        </Button>
      </header>
      <div className="grid gap-x-8 gap-y-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {hasDetails ? (
          <div className="grid content-start gap-1">
            <h4 className="text-sm font-medium text-fg-2">By detail</h4>
            <ul className="grid">
              {c.details.map(d => (
                <li key={d.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b border-line py-2 text-base last:border-b-0">
                  <span className={cn('min-w-0 [overflow-wrap:anywhere]', !d.detail && 'text-fg-muted')}>{d.detail ?? 'No detail'}</span>
                  <span className="num text-sm text-fg-muted">{d.share}%</span>
                  <span className="num text-right">{rupees(d.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className={cn('grid content-start gap-1', !hasDetails && 'lg:col-span-2')}>
          <h4 className="text-sm font-medium text-fg-2">{plural(c.count, 'entry', 'entries')}</h4>
          <ul className="grid">
            {c.entries.map(e => (
              <EntryLine key={e.id} e={e} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function EntryLine({ e, category }: { e: ReportEntry; category?: string }) {
  const words = [category, e.detail, e.who].filter(Boolean).join(' · ')
  return (
    // Phone: the day and the amount on one line, the words under them at full width (a narrow middle column broke "LEA-1234").
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-b border-line py-2 text-base last:border-b-0 sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
      <span className="num text-sm text-fg-2 max-sm:col-start-1 max-sm:row-start-1">{formatShortDate(e.paidOn)}</span>
      <span className="min-w-0 max-sm:col-span-2 max-sm:row-start-2">
        <span className={cn('[overflow-wrap:break-word]', !words && 'text-fg-muted')}>{words || 'No detail'}</span>
        <span className="ml-2 text-sm text-fg-muted">{e.paidVia === 'cash' ? 'Cash' : 'Bank'}</span>
      </span>
      <span className="num text-right max-sm:col-start-2 max-sm:row-start-1">{rupees(e.amount)}</span>
    </li>
  )
}

function ByDetail({ v }: { v: ExpenseReportView }) {
  const columns: Column<AcrossDetail>[] = [
    { id: 'detail', header: 'Detail', value: d => d.detail, cell: d => <span className="font-medium">{d.detail}</span> },
    { id: 'cats', header: 'Categories', hideBelowMd: true, value: d => d.categories.join(', ') },
    { id: 'count', header: 'Count', kind: 'num', width: 100, hideBelowMd: true, value: d => d.count, total: true },
    {
      id: 'amount',
      header: 'Paid (PKR)',
      kind: 'money',
      width: 160,
      value: d => d.amount,
      total: list => <span className="num font-medium">{rupees(paisaToFixed(sumPaisa(list.map(d => d.amount))))}</span>,
      paisa: 'never',
    },
  ]
  return (
    <div className="min-w-0 px-card pb-2" data-testid="expense-report-by-detail">
      <DataTable
        flat
        label={`Spent in ${v.label} by detail, across categories`}
        columns={columns}
        rows={v.byDetail}
        getRowId={d => d.key}
        footerLabel="Expenses with a detail"
        mobileRow={d => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1">
            <span className="font-medium">{d.detail}</span>
            <span className="num text-right">{rupees(d.amount)}</span>
            <span className="col-span-2 text-sm text-fg-muted">
              {d.categories.join(', ')} · {plural(d.count, 'expense')}
            </span>
          </div>
        )}
        empty={<EmptyState title="No details typed in this period">Enter a detail when adding an expense (the car, the bill). This list shows what each one cost, across categories.</EmptyState>}
      />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ 4: the ten biggest

function TopTen({ v, narrow }: { v: ExpenseReportView; narrow: boolean }) {
  const names = new Map(v.groups.flatMap(g => g.categories.map(c => [c.id, c.name] as const)))
  const [open, setOpen] = useState(false)
  const id = useId()
  const title = v.top.length === 10 ? 'The 10 biggest expenses' : `The ${plural(v.top.length, 'expense')}`
  const list = v.top.map(e => <EntryLine key={e.id} e={e} category={names.get(e.categoryId) ?? 'Category removed'} />)
  const summary = `${plural(v.top.length, 'expense')} · PKR ${rupees(paisaToFixed(sumPaisa(v.top.map(e => e.amount))))}`
  // Desktop (and tablet): a fold card, the count and the total on its closed line; a tap opens the entries. A phone shows them open.
  if (!narrow)
    return (
      <section aria-label={title} className={cn(CARD, 'overflow-hidden')} data-testid="expense-report-top">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(o => !o)}
          className="grid min-h-touch w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-card py-4 text-left transition-colors duration-fast hover:bg-sunken motion-reduce:transition-none"
        >
          <span className="grid min-w-0 gap-1">
            <span className="type-section">{title}</span>
            <span className="type-body text-fg-2">{summary}</span>
          </span>
          <Icon icon={ChevronDown} className={cn('text-fg-muted transition-transform duration-fast motion-reduce:transition-none', open && 'rotate-180')} />
        </button>
        {open ? (
          <ol id={id} className="grid border-t px-card py-2">
            {list}
          </ol>
        ) : null}
      </section>
    )
  return (
    <section aria-labelledby="exp-top" className={cn(CARD, 'overflow-hidden')} data-testid="expense-report-top">
      <header className="grid gap-1 border-b px-card py-4">
        <h2 id="exp-top" className="type-section">
          {title}
        </h2>
        <span className="type-body text-fg-2">{summary}</span>
      </header>
      <ol className="grid px-card py-1">{list}</ol>
    </section>
  )
}
