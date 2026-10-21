import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CircleAlert, Download, FileText, Lock } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { formatPaisa, paisaToFixed, sumPaisa, toPaisa, type Amount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { useToast } from '@/ui/useToast'
import { ReportsFrame } from '@/features/reports/ReportsFrame'
import { IN_OUT_REPORT_TITLE } from '@/features/money/monthEnd/reportList'
import { ReportError, ReportLoading } from '@/features/money/monthEnd/ReportParts'
import { downloadReport } from '@/features/money/monthEnd/reportFiles'
import { chosenPeriod, periodLabel, periodOf, shiftPeriod, type Period, type PeriodKind } from '@/features/money/inOut/model'
import { useExpenseReport } from '@/features/money/expenseReport/hooks'
import {
  entriesCsv,
  expenseReportCsv,
  type AcrossDetail,
  type CategoryLine,
  type ExpenseReportView,
  type GroupLine,
  type ReportEntry,
  type TrendBar,
} from '@/features/money/expenseReport/model'

/*
 * Money > Reports > Expenses (owner request 2026-10-22; admin only, the route checks the role). One month or one calendar
 * quarter (?by=quarter&period=2026-Q4, as In vs out). Read top to bottom:
 *   1. how much was spent, against the period before, cash against bank, and the last 6 months / 4 quarters as columns
 *   2. the same money as Profit and loss sees it (running costs, order costs, not a cost, input tax), so the two reports agree
 *   3. where it went: group -> category (open one for its details and every entry), with % of total, the period before and
 *      the budget; or "By detail" across categories (fuel per car)
 *   4. the ten biggest expenses
 * Export CSV and Download PDF write the same figures. Nothing is green here: the report has no primary action.
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
      toast.toast({ title: "Couldn't make the PDF", body: 'Nothing was changed. Try again, or use Export CSV.', tone: 'danger' })
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
        <ReportError title="The expenses report did not load" onRetry={q.refetch} />
      ) : q.isPending || !v ? (
        <ReportLoading label="Loading the expenses report" />
      ) : (
        <>
          <Body v={v} onPick={set} />
          <div className="flex flex-wrap gap-2">
            <Button icon={FileText} busy={pdfBusy} busyLabel="Making PDF" onClick={() => void savePdf()}>
              Download PDF
            </Button>
          </div>
        </>
      )}
    </ReportsFrame>
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
  return (
    <>
      <Summary v={v} onPick={onPick} />
      {v.total.count === 0 && v.prev.count === 0 ? (
        <section className="rounded border bg-surface">
          <EmptyState title={`No expenses in ${v.label}`}>Expenses dated in this period show here. The columns above still show the periods before.</EmptyState>
        </section>
      ) : (
        <section aria-labelledby="exp-where" className="overflow-hidden rounded border bg-surface">
          <header className="flex min-h-[56px] flex-wrap items-center gap-3 border-b px-5 py-2">
            <h3 id="exp-where" className="text-lg font-semibold">
              Where the money went
            </h3>
            <span className="flex-1" />
            <SegmentedControl
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
      {v.top.length > 0 ? <TopTen v={v} /> : null}
    </>
  )
}

// ------------------------------------------------------------------------------------------------ 1 and 2: the summary

function Summary({ v, onPick }: { v: ExpenseReportView; onPick: (p: Period) => void }) {
  const up = toPaisa(v.change) > 0n
  const same = toPaisa(v.change) === 0n
  const cashShare = toPaisa(v.total.amount) === 0n ? 0 : Number((toPaisa(v.total.cash) * 1000n) / toPaisa(v.total.amount)) / 10
  const frozen = v.frozenMonths === 0 ? null : v.frozenMonths === v.months ? 'Closed: figures frozen' : `${plural(v.frozenMonths, 'month')} closed: figures frozen`
  return (
    <section aria-label={`Spent in ${v.label}`} className="overflow-hidden rounded border bg-surface">
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <div className="grid content-start gap-3">
          <p className="text-base text-fg-2">
            Spent in {v.label}
            {frozen ? (
              <span className="ml-2 inline-flex items-center gap-1 text-sm text-fg-muted" data-testid="expense-report-frozen">
                <Icon icon={Lock} size="chip" />
                {frozen}
              </span>
            ) : null}
          </p>
          <p className="text-display font-medium tracking-tight" data-testid="expense-report-total">
            <span className="text-xl font-medium text-fg-muted">PKR </span>
            {rupees(v.total.amount)}
          </p>
          <p className="text-base text-fg-2">
            <span className="num">{plural(v.total.count, 'expense')}</span>
            {' · '}
            {same ? (
              <>the same as {v.prevLabel}</>
            ) : (
              <>
                <b className="num font-semibold text-fg">PKR {rupees(up ? v.change : (-Number(v.change)).toFixed(2))}</b>
                {v.changePct !== null ? <span className="num"> ({Math.abs(v.changePct)}%)</span> : null} {up ? 'more' : 'less'} than {v.prevLabel}
              </>
            )}
          </p>
          <CashBank v={v} cashShare={cashShare} />
          <Link
            to={`/money/reports/in-out?by=${v.period.kind}&period=${v.period.key}`}
            className="inline-flex min-h-touch items-center gap-1 justify-self-start text-sm font-medium text-primary hover:underline md:min-h-0"
          >
            {IN_OUT_REPORT_TITLE}, same period
            <Icon icon={ChevronRight} size="sm" />
          </Link>
          {toPaisa(v.unexplained) !== 0n ? (
            <p className="flex items-start gap-2 text-sm text-tone-danger-fg" data-testid="expense-report-unexplained">
              <Icon icon={CircleAlert} size="sm" className="mt-[3px]" />
              In vs out has {signed(v.unexplained)} more paid out than these entries: a closed month was changed after it was closed.
            </p>
          ) : null}
        </div>
        <Trend bars={v.trend} kind={v.period.kind} onPick={onPick} />
      </div>
      <dl className="grid grid-cols-2 border-t md:grid-cols-4" aria-label="In profit and loss">
        <Kind label="Running costs" sub="Overheads in Profit and loss" amount={v.kinds.running} testId="kind-running" />
        <Kind label="Order costs" sub="Supplier, freight, customs" amount={v.kinds.order} testId="kind-order" />
        <Kind label="Not a cost" sub="Owner drawings, loan repayments" amount={v.kinds.notCost} testId="kind-notcost" />
        <Kind label="Input tax" sub="Claimed back, so not a cost" amount={v.kinds.inputTax} testId="kind-tax" />
      </dl>
    </section>
  )
}

function Kind({ label, sub, amount, testId }: { label: string; sub: string; amount: string; testId: string }) {
  return (
    <div className="grid gap-[2px] border-line px-5 py-3 max-md:odd:border-r md:border-r md:last:border-r-0 max-md:[&:nth-child(-n+2)]:border-b">
      <dt className="text-sm text-fg-2">{label}</dt>
      <dd className="num text-lg font-semibold" data-testid={testId}>
        {rupees(amount)}
      </dd>
      <dd className="text-xs text-fg-muted">{sub}</dd>
    </div>
  )
}

function CashBank({ v, cashShare }: { v: ExpenseReportView; cashShare: number }) {
  if (v.total.count === 0) return null
  return (
    <div className="grid gap-2" data-testid="expense-report-via">
      <div className="flex h-2 gap-[2px] overflow-hidden" aria-hidden="true">
        {toPaisa(v.total.cash) > 0n ? <span className="h-full rounded-[2px] bg-fg-2" style={{ width: `${cashShare}%` }} /> : null}
        {toPaisa(v.total.bank) > 0n ? <span className="h-full flex-1 rounded-[2px] bg-line-input" /> : null}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-2">
          <i className="size-[10px] rounded-[2px] bg-fg-2" aria-hidden="true" />
          Cash <b className="num font-medium">{rupees(v.total.cash)}</b>
          <span className="num text-fg-muted">({plural(v.total.cashCount, 'payment')})</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-[10px] rounded-[2px] bg-line-input" aria-hidden="true" />
          Bank <b className="num font-medium">{rupees(v.total.bank)}</b>
          <span className="num text-fg-muted">({plural(v.total.bankCount, 'payment')})</span>
        </span>
      </div>
    </div>
  )
}

/**
 * The last 6 months or 4 quarters as columns (dataviz: one series, so one neutral hue and the period shown in the selected green;
 * thin columns with a 4 px rounded top on one baseline; only the shown period carries its value, every column says its value when
 * hovered or focused, and the same figures are a table for screen readers). A column opens its period.
 */
function Trend({ bars, kind, onPick }: { bars: TrendBar[]; kind: PeriodKind; onPick: (p: Period) => void }) {
  const max = bars.reduce((m, b) => (toPaisa(b.amount) > m ? toPaisa(b.amount) : m), 0n)
  const h = (a: string) => (max === 0n ? 0 : Math.max(Number((toPaisa(a) * 1000n) / max) / 10, toPaisa(a) > 0n ? 2 : 0))
  const title = kind === 'month' ? 'Last 6 months' : 'Last 4 quarters'
  return (
    <figure className="grid content-start gap-2" data-testid="expense-report-trend">
      <figcaption className="text-base text-fg-2">{title}</figcaption>
      <div className="grid h-[148px] items-end gap-1 border-b border-line" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0,1fr))` }}>
        {bars.map(b => (
          <button
            key={b.period.key}
            type="button"
            onClick={() => onPick(b.period)}
            aria-label={`${b.current ? `${compact(b.amount)}, ` : ''}${b.label}: PKR ${rupees(b.amount)} spent${b.current ? ', shown' : ''}`}
            aria-current={b.current || undefined}
            title={`${b.label}: PKR ${rupees(b.amount)}`}
            className="group relative flex h-full flex-col items-center justify-end rounded-t-[2px] focus-visible:outline-offset-0"
          >
            {b.current ? <span className="num mb-1 whitespace-nowrap text-xs font-medium text-fg">{compact(b.amount)}</span> : null}
            <span className="num pointer-events-none absolute -top-1 hidden whitespace-nowrap rounded bg-tone-ink-bg px-2 py-[2px] text-xs text-tone-ink-fg shadow-pop group-hover:block group-focus-visible:block">
              {rupees(b.amount)}
            </span>
            <span
              className={cn('w-full max-w-[24px] rounded-t-[4px] transition-opacity duration-fast', b.current ? 'bg-brand-green' : 'bg-line-input group-hover:opacity-80')}
              style={{ height: `${h(b.amount)}%`, maxHeight: 'calc(100% - 22px)' }}
            />
          </button>
        ))}
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0,1fr))` }} aria-hidden="true">
        {bars.map(b => (
          <span key={b.period.key} className={cn('num text-center text-xs', b.current ? 'font-semibold text-fg' : 'text-fg-muted')}>
            {b.label.replace(/ \d{4}$/, m => (kind === 'quarter' ? m : ''))}
          </span>
        ))}
      </div>
      <ul className="sr-only" aria-label={`${title}, spent (PKR)`}>
        {bars.map(b => (
          <li key={b.period.key}>
            {b.label}: {rupees(b.amount)}
          </li>
        ))}
      </ul>
    </figure>
  )
}

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
        <span className="inline-flex items-center gap-2">
          <Icon icon={ChevronRight} size="sm" className={cn('shrink-0 text-fg-muted', r.count === 0 && 'invisible', openId === r.id && 'rotate-90')} />
          <span className="font-medium">{r.name}</span>
          {r.archived ? <span className="text-sm text-fg-muted">archived</span> : null}
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
    <div className="grid" data-testid="expense-report-breakdown">
      <DataTable
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
              {r.group.name.toLowerCase().startsWith(KIND_WORD[r.group.kind].toLowerCase()) ? null : (
                <span className="font-normal text-fg-muted max-md:hidden"> · {KIND_WORD[r.group.kind]}</span>
              )}
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
        className="rounded-none border-0"
        mobileRow={r => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-[2px] py-1">
            <span className="min-w-0 font-medium">{r.name}</span>
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
      {opened ? <Drill c={opened} label={v.label} onClose={() => setOpenId(null)} /> : null}
    </div>
  )
}

/** One category opened: its details with their totals (fuel per car), then every entry, newest first. */
function Drill({ c, label, onClose }: { c: CategoryLine; label: string; onClose: () => void }) {
  const hasDetails = c.details.some(d => d.detail)
  const ref = useRef<HTMLElement | null>(null)
  // the table can be long: bring the opened category into view (no smooth scroll, so reduced motion is respected)
  useEffect(() => ref.current?.scrollIntoView?.({ block: 'nearest' }), [c.id])
  return (
    <section ref={ref} aria-label={`${c.name}, ${label}`} className="grid gap-4 border-t-2 border-brand-green bg-canvas px-5 py-4" data-testid="expense-report-drill">
      <header className="flex flex-wrap items-center gap-3">
        <h4 className="text-lg font-semibold">
          {c.name} <span className="num font-normal text-fg-2">· PKR {rupees(c.amount)}</span>
        </h4>
        <span className="flex-1" />
        <Button
          size="sm"
          icon={Download}
          onClick={() => downloadReport(entriesCsv(c.name, c.entries), `expenses-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`)}
        >
          Export these
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          Close
        </Button>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {hasDetails ? (
          <div className="grid content-start gap-1">
            <h5 className="text-sm font-medium text-fg-2">By detail</h5>
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
          <h5 className="text-sm font-medium text-fg-2">{plural(c.count, 'entry', 'entries')}</h5>
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
    <li className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line py-2 text-base last:border-b-0">
      <span className="num text-sm text-fg-2">{formatShortDate(e.paidOn)}</span>
      <span className="min-w-0">
        <span className={cn('[overflow-wrap:anywhere]', !words && 'text-fg-muted')}>{words || 'No detail'}</span>
        <span className="ml-2 text-sm text-fg-muted">{e.paidVia === 'cash' ? 'Cash' : 'Bank'}</span>
      </span>
      <span className="num text-right">{rupees(e.amount)}</span>
    </li>
  )
}

function ByDetail({ v }: { v: ExpenseReportView }) {
  const columns: Column<AcrossDetail>[] = [
    { id: 'detail', header: 'Detail', value: d => d.detail, cell: d => <span className="font-medium">{d.detail}</span> },
    { id: 'cats', header: 'Categories', hideBelowMd: true, value: d => d.categories.join(', ') },
    { id: 'count', header: 'Count', kind: 'num', width: 100, hideBelowMd: true, value: d => d.count, total: true },
    { id: 'amount', header: 'Paid (PKR)', kind: 'money', width: 160, value: d => d.amount, total: list => <span className="num font-medium">{rupees(paisaToFixed(sumPaisa(list.map(d => d.amount))))}</span>, paisa: 'never' },
  ]
  return (
    <div data-testid="expense-report-by-detail">
      <DataTable
        label={`Spent in ${v.label} by detail, across categories`}
        columns={columns}
        rows={v.byDetail}
        getRowId={d => d.key}
        footerLabel="Expenses with a detail"
        className="rounded-none border-0"
        mobileRow={d => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1">
            <span className="font-medium">{d.detail}</span>
            <span className="num text-right">{rupees(d.amount)}</span>
            <span className="col-span-2 text-sm text-fg-muted">
              {d.categories.join(', ')} · {plural(d.count, 'expense')}
            </span>
          </div>
        )}
        empty={
          <EmptyState title="No details typed in this period">
            Type a detail when you add an expense (the car, the bill) and this list shows what each one cost, across categories.
          </EmptyState>
        }
      />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ 4: the ten biggest

function TopTen({ v }: { v: ExpenseReportView }) {
  const names = new Map(v.groups.flatMap(g => g.categories.map(c => [c.id, c.name] as const)))
  return (
    <section aria-labelledby="exp-top" className="overflow-hidden rounded border bg-surface" data-testid="expense-report-top">
      <header className="flex min-h-[56px] items-center border-b px-5">
        <h3 id="exp-top" className="text-lg font-semibold">
          {v.top.length === 10 ? 'The 10 biggest expenses' : `The ${plural(v.top.length, 'expense')}`}
        </h3>
      </header>
      <ol className="grid px-5 py-1">
        {v.top.map(e => (
          <EntryLine key={e.id} e={e} category={names.get(e.categoryId) ?? 'Category removed'} />
        ))}
      </ol>
    </section>
  )
}
