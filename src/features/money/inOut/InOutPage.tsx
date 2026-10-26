import { useEffect, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatPaisa, toPaisa, type Amount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { InfoTip } from '@/ui/InfoTip'
import { ReportsFrame } from '@/features/reports/ReportsFrame'
import { ClockTag, Panel, ReportError, ReportLoading, TwoProfitsTip } from '@/features/money/monthEnd/ReportParts'
import { downloadReport } from '@/features/money/monthEnd/reportFiles'
import { useInOutReport } from '@/features/money/inOut/hooks'
import {
  IN_OUT_TITLE,
  change,
  chosenPeriod,
  inOutCsv,
  periodLabel,
  periodOf,
  shiftPeriod,
  type InOutView,
  type Period,
  type PeriodKind,
  type TrendRow,
} from '@/features/money/inOut/model'

/*
 * Money > Reports > In vs out (owner request and decision 2026-10-20; admin only, as Expenses). A month or a calendar quarter,
 * picked with Month / Quarter and the arrows (both ride in the address: ?by=quarter&period=2026-Q4). Two views side by side,
 * each with the previous period beside it:
 *   Cash in vs out              the money trail, on the day money moved, GST included (v_month_cash_flow; closed months frozen)
 *   Profit (invoiced basis)     sales on their invoice date without GST, an order's costs with its sales (v_month_profit)
 * then one plain line on why they differ, money out by category with each category's details (the car, the bill), and the last
 * 6 months or 4 quarters. Export CSV writes the same figures with paisa; the screen shows whole rupees.
 */


const rupees = (v: Amount) => formatPaisa(toPaisa(v), 'never')
const pkr = (v: Amount) => `PKR ${rupees(v)}`
const signed = (v: Amount) => (toPaisa(v) > 0n ? `+${rupees(v)}` : rupees(v))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function usePeriod() {
  const today = businessToday()
  const [params, setParams] = useSearchParams()
  const kind: PeriodKind = params.get('by') === 'quarter' ? 'quarter' : 'month'
  // ?month= (kept by the Report select from a month report) opens that month; ?period= wins when both are there
  const askedKey = params.get('period') ?? (kind === 'month' ? params.get('month') : null)
  const period = useMemo(() => chosenPeriod(kind, askedKey, today), [kind, askedKey, today])
  const now = periodOf(kind, today.slice(0, 7))
  // HW-22: a period that is not real or still to come falls back to now; the address then names the period actually shown
  useEffect(() => {
    if (askedKey === null || askedKey === period.key) return
    setParams(
      prev => {
        const next = new URLSearchParams(prev)
        next.set('by', period.kind)
        next.set('period', period.key)
        return next
      },
      { replace: true },
    )
  }, [askedKey, period, setParams])
  const set = (p: Period) => {
    const next = new URLSearchParams(params)
    next.set('by', p.kind)
    next.set('period', p.key)
    setParams(next, { replace: true })
  }
  return { period, now, set, today }
}

export function InOutPage() {
  const { period, now, set, today } = usePeriod()
  const q = useInOutReport(period)
  const v = q.view
  return (
    <ReportsFrame
      report="in-out"
      csv={v ? () => downloadReport(inOutCsv(v), `money-in-and-out-${period.key}.csv`) : null}
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
          <InfoTip label={`About ${IN_OUT_TITLE.toLowerCase()}`}>
            Cash in and out is the money trail: every payment received and every expense or supplier payment, on the day it moved, GST
            included. Profit on invoices counts sales on their invoice date without GST, and each order&apos;s supplier costs with its sales.
            Quarters are calendar quarters (Q1 is January to March).
          </InfoTip>
        </span>
      }
    >
      {q.isError ? (
        <ReportError title={`${IN_OUT_TITLE} did not load`} onRetry={q.refetch} />
      ) : q.isPending || !v ? (
        <ReportLoading label={`Loading ${IN_OUT_TITLE.toLowerCase()}`} />
      ) : (
        <Body v={v} onPick={set} />
      )}
    </ReportsFrame>
  )
}

function PeriodPager({ period, atNow, go }: { period: Period; atNow: boolean; go: (by: number) => void }) {
  const unit = period.kind === 'month' ? 'month' : 'quarter'
  return (
    <div role="group" aria-label="Period" className="inline-flex gap-[2px] rounded bg-selected p-[2px]">
      <button
        type="button"
        aria-label={`Previous ${unit}`}
        onClick={() => go(-1)}
        className="inline-flex h-control w-control items-center justify-center rounded px-2 text-fg-2 hover:text-fg"
      >
        <Icon icon={ChevronLeft} size="sm" />
      </button>
      <span aria-live="polite" className="num inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium">
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

/** One figure line: label, its basis in small words, this period, the previous one and the change. */
function Row({ label, sub, now, before, strong, testId }: { label: string; sub?: ReactNode; now: Amount; before: Amount; strong?: boolean; testId?: string }) {
  return (
    <div role="row" data-testid={testId} className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-[2px] border-b px-5 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_120px_120px_100px]', strong && 'bg-sunken')}>
      <span role="rowheader" className={cn('text-base', strong && 'font-semibold')}>
        {label}
        {sub ? <span className="block text-sm text-fg-muted">{sub}</span> : null}
      </span>
      <span role="cell" className={cn('num text-right text-base', strong && 'font-semibold')}>
        {rupees(now)}
      </span>
      <span role="cell" className="num text-right text-sm text-fg-muted max-md:col-start-2">
        <span className="md:hidden">before </span>
        {rupees(before)}
      </span>
      <span role="cell" className="num text-right text-sm text-fg-2 max-md:hidden">
        {signed(change(now, before))}
      </span>
    </div>
  )
}

function Head({ prev }: { prev: string }) {
  return (
    <div role="row" className="hidden min-h-[36px] grid-cols-[minmax(0,1fr)_120px_120px_100px] items-center gap-x-4 border-b bg-sunken px-5 text-xs font-medium text-fg-muted md:grid">
      <span role="columnheader">Line</span>
      <span role="columnheader" className="text-right">
        PKR
      </span>
      <span role="columnheader" className="text-right">
        {prev}
      </span>
      <span role="columnheader" className="text-right">
        Change
      </span>
    </div>
  )
}

function Body({ v, onPick }: { v: InOutView; onPick: (p: Period) => void }) {
  const prev = periodLabel(shiftPeriod(v.period, -1))
  const r = v.reconcile
  const empty = v.cash.payments === 0 && v.cash.expenses === 0 && v.profit.invoices === 0
  const frozen =
    v.cash.frozenMonths === 0 ? null : v.cash.frozenMonths === v.cash.months ? 'Closed: figures frozen when the month was closed' : `${plural(v.cash.frozenMonths, 'month')} closed: frozen when closed`
  return (
    <>
      {empty ? (
        <section className="rounded-panel border bg-surface">
          <EmptyState title={`Nothing in ${v.label} yet`}>No payment, expense or invoice is dated in it. The trend below still shows the periods before.</EmptyState>
        </section>
      ) : null}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel title="Cash in and out" meta={<><ClockTag>On the day money moved</ClockTag>{frozen ? <span className="text-sm text-fg-muted" data-testid="in-out-frozen">{frozen}</span> : null}</>}>
          <div role="table" aria-label="Cash in and out">
            <Head prev={prev} />
            <Row testId="cash-in" label="Money in" sub={`${plural(v.cash.payments, 'customer payment')} received, GST included`} now={v.cash.in} before={v.prevCash.in} />
            <Row testId="cash-out" label="Money out" sub={`${plural(v.cash.expenses, 'expense')} and supplier payments, input tax included`} now={v.cash.out} before={v.prevCash.out} />
            <Row testId="cash-net" label="Cash in minus cash out" now={v.cash.net} before={v.prevCash.net} strong />
          </div>
        </Panel>
        <Panel title="Profit on invoices" meta={<><ClockTag>By invoice date</ClockTag><TwoProfitsTip /></>}>
          <div role="table" aria-label="Profit on invoices">
            <Head prev={prev} />
            <Row label="Sales" sub={`${plural(v.profit.invoices, 'invoice')}, GST taken out`} now={v.profit.sales} before={v.prevProfit.sales} />
            <Row label="Order costs" sub="Supplier, freight and clearing, counted with the order's sales" now={v.profit.orderCosts} before={v.prevProfit.orderCosts} />
            <Row label="Overheads" sub="When paid, input tax taken out" now={v.profit.overheads} before={v.prevProfit.overheads} />
            <Row testId="profit" label="Profit on invoices" now={v.profit.profit} before={v.prevProfit.profit} strong />
          </div>
        </Panel>
      </div>

      <section aria-labelledby="in-out-why" className="grid gap-2 rounded-panel border bg-surface px-5 py-4" data-testid="in-out-why">
        <h2 id="in-out-why" className="flex flex-wrap items-center gap-2 text-base font-semibold">
          Why profit and cash differ in {v.label}
          <InfoTip label="About supplier bills">
            Supplier bills are not booked here, so a supplier cost still unpaid is not in profit yet. What we still owe suppliers is in the We
            owe suppliers report.
          </InfoTip>
        </h2>
        <p className="num text-base">
          Profit on invoices {pkr(v.profit.profit)} less cash in minus cash out {pkr(v.cash.net)} = {signed(r.gap)}, made of:
        </p>
        <ul className="grid gap-1 text-base text-fg-2">
          <li>
            <span className="num font-medium text-fg">{signed(r.owedMore)}</span> customers owe us more (invoiced, not yet paid), or less when they paid
            off earlier invoices
          </li>
          <li>
            <span className="num font-medium text-fg">{signed(change(0, r.gst))}</span> GST inside those invoices: collected for FBR, not ours
          </li>
          <li>
            <span className="num font-medium text-fg">{signed(r.costsAhead)}</span> supplier costs paid before their sale was invoiced (held for it), or
            less when earlier payments are matched now
          </li>
          <li>
            <span className="num font-medium text-fg">{signed(r.drawingsAndTax)}</span> owner drawings, loan repayments and input tax: cash out that is not
            a cost
          </li>
          {toPaisa(r.other) !== 0n ? (
            <li>
              <span className="num font-medium text-fg">{signed(r.other)}</span> other: a closed month&apos;s frozen cash figure differs from the books
            </li>
          ) : null}
        </ul>
      </section>

      <CategoryPanel v={v} prev={prev} />
      <TrendPanel v={v} onPick={onPick} />
    </>
  )
}

interface DetailLine {
  id: string
  categoryId: string
  detail: string | null
  count: number
  amount: string
}

function CategoryPanel({ v, prev }: { v: InOutView; prev: string }) {
  const rows: DetailLine[] = v.categories.flatMap(c => c.details.map((d, i) => ({ id: `${c.categoryId}-${i}`, categoryId: c.categoryId, ...d })))
  if (toPaisa(v.unexplainedOut) !== 0n) rows.push({ id: 'unexplained', categoryId: '', detail: 'Changed after the month was closed', count: 0, amount: v.unexplainedOut })
  const byId = new Map(v.categories.map(c => [c.categoryId, c]))
  const columns: Column<DetailLine>[] = [
    { id: 'detail', header: 'Detail', value: r => r.detail ?? 'No detail', cell: r => <span className={cn(r.detail ? 'text-fg' : 'text-fg-muted')}>{r.detail ?? 'No detail'}</span> },
    { id: 'count', header: 'Count', kind: 'num', width: 90, value: r => r.count, total: true, hideBelowMd: true },
    { id: 'amount', header: 'Paid (PKR)', kind: 'money', width: 160, value: r => r.amount, total: true, paisa: 'never' },
  ]
  return (
    <DataTable
      label={`Money out by category, ${v.label}`}
      columns={columns}
      rows={rows}
      getRowId={r => r.id}
      group={r => {
        const c = byId.get(r.categoryId)
        return {
          key: r.categoryId || 'unexplained',
          label: c ? (
            <span>
              {c.name} <span className="num text-sm font-normal text-fg-muted">· {prev}: {rupees(c.prev)}</span>
            </span>
          ) : (
            'Other'
          ),
        }
      }}
      groupStyle="big"
      // Phone: one line per detail (name, count, amount), so the table never scrolls sideways at 375.
      mobileRow={r => (
        <span className="flex min-w-0 items-baseline justify-between gap-3">
          <span className={cn('min-w-0 [overflow-wrap:anywhere]', r.detail ? 'text-fg' : 'text-fg-muted')}>
            {r.detail ?? 'No detail'}
            {r.count > 0 ? <span className="text-fg-muted"> · <span className="num">{r.count}</span></span> : null}
          </span>
          <span className="num shrink-0 font-medium">{rupees(r.amount)}</span>
        </span>
      )}
      footerLabel="Money out"
      noun="lines"
      toolbar={
        <h2 className="text-base font-semibold">Money out by category, {v.label}</h2>
      }
      empty={<EmptyState title="Nothing was paid out">Expenses and supplier payments dated in this period show here.</EmptyState>}
    />
  )
}

function TrendPanel({ v, onPick }: { v: InOutView; onPick: (p: Period) => void }) {
  const title = v.period.kind === 'month' ? 'The last 6 months' : 'The last 4 quarters'
  const columns: Column<TrendRow>[] = [
    { id: 'period', header: v.period.kind === 'month' ? 'Month' : 'Quarter', value: t => t.label, cell: t => <span className={cn(t.period.key === v.period.key && 'font-semibold')}>{t.label}</span> },
    { id: 'in', header: 'Money in (PKR)', kind: 'money', value: t => t.in, paisa: 'never' },
    { id: 'out', header: 'Money out (PKR)', kind: 'money', value: t => t.out, paisa: 'never' },
    { id: 'net', header: 'Cash in minus out (PKR)', kind: 'money', value: t => t.net, paisa: 'never' },
    { id: 'profit', header: 'Profit on invoices (PKR)', kind: 'money', value: t => t.profit, paisa: 'never' },
  ]
  return (
    <DataTable
      label={title}
      columns={columns}
      rows={v.trend}
      getRowId={t => t.period.key}
      activeRowId={v.period.key}
      onRowOpen={t => onPick(t.period)}
      summary="Open a row to see that period"
      toolbar={<h2 className="text-base font-semibold">{title}</h2>}
      mobileRow={t => (
        <span className="grid gap-1">
          <span className={cn('font-medium', t.period.key === v.period.key && 'font-semibold')}>{t.label}</span>
          <span className="num text-sm text-fg-2">
            In {rupees(t.in)} · out {rupees(t.out)} · profit {rupees(t.profit)}
          </span>
        </span>
      )}
    />
  )
}
