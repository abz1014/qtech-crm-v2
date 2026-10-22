import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Receipt, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { SumBar } from '@/ui/SumBar'
import { Tag } from '@/ui/Tag'
import { DataTable, type Column } from '@/ui/DataTable'
import { Avatar } from '@/ui/Avatar'
import { InfoTip } from '@/ui/InfoTip'
import { formatPaisa, paisaToFixed, sumPaisa, toPaisa, type Amount } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { ReportsFrame } from '@/features/reports/ReportsFrame'
import { MonthPager, MonthStateChip } from '@/features/money/monthEnd/MonthEndFrame'
import { type MonthReportKey } from '@/features/money/monthEnd/reportList'
import { useMonthEnd, type MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'
import { Banner } from '@/ui/Banner'
import {
  AsOfControl,
  ClockTag,
  Panel,
  TwoProfitsTip,
  ReportError,
  ReportLoading,
} from '@/features/money/monthEnd/ReportParts'
import { csvFile, downloadReport, payHref } from '@/features/money/monthEnd/reportFiles'
import {
  useAgingReport,
  useAsOf,
  useGstReport,
  useOweReport,
  usePnlReport,
  useTeamReport,
} from '@/features/money/monthEnd/reportHooks'
import {
  AGING_BUCKETS,
  IMPORTED_GROUP_LABEL,
  BUCKET_LABEL,
  BUCKET_TITLE,
  advanceLabel,
  agingCsv,
  gstCsv,
  isEmptyMonth,
  monthName,
  negate,
  payablesCsv,
  payableStateWord,
  pnlCsv,
  teamCsv,
  unconvertedByCurrency,
  type AgingRow,
  type GstMonthRow,
  type PayableRow,
  type TeamRow,
} from '@/features/money/monthEnd/model'

/*
 * The six money reports for a month (M10; M05 amended: the cash month is the P&L here), opened from Money > Reports
 * (/money/reports/<key>?month=2026-09). Each page has a back link to Reports, the month pager and one tap on Export CSV, which
 * writes the exact figures (with paisa). On screen every amount is in whole rupees (owner decision 2026-10-19). Layout:
 * g2-month-end "Report: profit and loss", "expenses by category", "aging", "what we owe", "GST and FBR month" and "team",
 * without the old strip of report tabs. Every figure comes from the database views of migration 0028; nothing is recomputed
 * here beyond adding what is drawn.
 */
type SetCsv = (make: (() => void) | null) => void

/**
 * One report in Money > Reports (round 3: one report at a time, the report select and the month pager on top, Export CSV the
 * page's one green button). The body hands its CSV up with `useCsv` once its figures are in.
 */
function ReportPage({ report, children }: { report: MonthReportKey; children: (ctx: MonthEndCtx, setCsv: SetCsv) => ReactNode }) {
  const ctx = useMonthEnd()
  const [csv, setCsvState] = useState<{ run: () => void } | null>(null)
  const setCsv = useCallback<SetCsv>(make => setCsvState(make ? { run: make } : null), [])
  return (
    <ReportsFrame
      report={report}
      csv={csv ? csv.run : null}
      period={
        <span className="flex flex-wrap items-center gap-3">
          <MonthPager month={ctx.month} thisMonth={ctx.thisMonth} go={ctx.go} />
          {ctx.state ? <MonthStateChip closed={ctx.state.kind === 'closed'} /> : null}
        </span>
      }
    >
      {children(ctx, setCsv)}
    </ReportsFrame>
  )
}

/** Hands a report's CSV to the frame's Export CSV while the figures `key` stand; null while they load. */
function useCsv(setCsv: SetCsv, key: unknown, make: (() => void) | null) {
  const ref = useRef(make)
  ref.current = make
  const ready = make !== null
  useEffect(() => {
    setCsv(ready ? () => ref.current?.() : null)
    return () => setCsv(null)
  }, [setCsv, key, ready])
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const Num = ({ children }: { children: ReactNode }) => <span className="num">{children}</span>
/** Whole rupees on screen; the CSV keeps the paisa. */
const rupees = (v: Amount | bigint) => formatPaisa(typeof v === 'bigint' ? v : toPaisa(v), 'never')
const pkr = (v: Amount) => `PKR ${rupees(v)}`
/** A money column in whole rupees, with its total (and group subtotals) summed in paisa and rounded once. */
function whole<T>(get: (r: T) => Amount | null | undefined) {
  return {
    paisa: 'never' as const,
    total: (rows: T[]) => <Money value={paisaToFixed(sumPaisa(rows.map(r => get(r) ?? 0)))} prefix={false} paisa="never" strong />,
  }
}

function Empty({ ctx, what }: { ctx: MonthEndCtx; what: string }) {
  return (
    <section className="rounded border bg-surface">
      <EmptyState title={`Nothing to report for ${monthKeyLabel(ctx.month)}`}>
        {what} The report fills in as payments and expenses are recorded in {monthName(ctx.month)}.
      </EmptyState>
    </section>
  )
}

// ------------------------------------------------------------------------------------------------ P&L

/** One line of the statement: label, basis, amount. */
function Line({
  label,
  basis,
  amount,
  tone = 'line',
  tag,
}: {
  label: ReactNode
  basis?: ReactNode
  amount?: Amount
  tone?: 'group' | 'line' | 'sub' | 'total' | 'result'
  tag?: string
}) {
  return (
    <div
      role="row"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-t px-5 first:border-t-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,auto)]',
        tone === 'group' && 'min-h-[40px] bg-sunken text-sm font-semibold',
        tone === 'line' && 'min-h-[44px] text-table',
        tone === 'sub' && 'min-h-[36px] text-table',
        tone === 'total' && 'min-h-[40px] bg-sunken text-table font-semibold',
        tone === 'result' && 'min-h-[52px] bg-selected text-base font-semibold',
      )}
    >
      <span role="cell" className={cn('flex flex-wrap items-center gap-2 py-2', tone === 'sub' && 'pl-4 text-fg-2')}>
        {label}
        {tag ? <Tag dashed>{tag}</Tag> : null}
      </span>
      <span role="cell" className="hidden text-fg-muted md:block">
        {basis}
      </span>
      <span role="cell" className="num text-right">
        {amount !== undefined ? <Money value={amount} prefix={false} paisa="never" plainNegative strong={tone === 'total' || tone === 'result'} /> : null}
      </span>
      {basis ? (
        <span role="presentation" className="col-span-2 -mt-1 pb-2 text-xs text-fg-muted md:hidden">
          {basis}
        </span>
      ) : null}
    </div>
  )
}

export function PnlPage() {
  return (
    <ReportPage report="pnl">
      {(ctx, setCsv) => <PnlBody ctx={ctx} setCsv={setCsv} />}
    </ReportPage>
  )
}

function PnlBody({ ctx, setCsv }: { ctx: MonthEndCtx; setCsv: SetCsv }) {
  const q = usePnlReport(ctx.month)
  const v = q.view
  useCsv(setCsv, v, v ? () => downloadReport(pnlCsv(v), csvFile('profit-and-loss', ctx.month)) : null)
  if (q.isError) return <ReportError title="The profit and loss did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading the profit and loss" />
  if (isEmptyMonth(v)) return <Empty ctx={ctx} what="No payment was received and no expense was paid." />
  const name = monthName(ctx.month)
  const split = v.payments.count - v.payments.unresolved.length
  const spent = toPaisa(v.orderCosts.net) + toPaisa(v.overheads.net)
  const base = Math.max(Number(toPaisa(v.netIn)), Number(spent), 1)
  const w = (x: bigint) => `${Math.min(100, Math.max(0, (Number(x) / base) * 100))}%`
  const resultPositive = toPaisa(v.result) > 0n
  const drawings = toPaisa(v.notInPnl.total.net) !== 0n || v.notInPnl.lines.length > 0 || toPaisa(v.adjustNonPnl) !== 0n
  return (
    <>
      <SumBar
        className={drawings ? 'max-sm:grid-cols-1' : undefined}
        label="Profit and loss"
        items={[
          {
            label: 'Received after GST',
            amount: v.netIn,
            sub: (
              <>
                <Num>{split}</Num> {split === 1 ? 'payment' : 'payments'}
                {v.payments.unresolved.length ? <>, leaves out {rupees(v.unresolvedGross)} not split yet</> : null}
              </>
            ),
          },
          { label: 'Profit', amount: v.result, sub: 'On money received, after costs' },
          ...(drawings ? [{ label: 'After drawings', amount: v.afterDrawings, sub: <>Profit less {rupees(v.notInPnl.total.net)} drawn or repaid</> }] : []),
        ]}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="grid gap-6">
          <Panel
            title="Profit on money received"
            meta={
              <>
                <ClockTag>By payment date</ClockTag>
                <TwoProfitsTip />
                {v.frozenAt ? <span className="text-xs text-fg-muted" data-testid="pnl-frozen">Frozen when the month was closed</span> : null}
              </>
            }
          >
            <div role="table" aria-label="Profit and loss">
              <div role="row" className="hidden min-h-[36px] grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,auto)] items-center gap-x-4 border-b bg-sunken px-5 text-xs font-medium text-fg-muted md:grid">
                <span role="columnheader">Line</span>
                <span role="columnheader">Basis</span>
                <span role="columnheader" className="text-right">
                  PKR
                </span>
              </div>
              <Line tone="group" label="Money in" />
              <Line label="Payments received, gross" basis={<><Num>{v.payments.count}</Num> {v.payments.count === 1 ? 'payment' : 'payments'}</>} amount={v.grossReceived} />
              <Line tone="sub" label="less GST inside the payments" tag="GST, not ours" basis="Shared by invoice" amount={negate(v.gstIn)} />
              {v.payments.unresolved.length ? (
                <Line
                  tone="sub"
                  label="less payments not yet split"
                  tag="excluded"
                  basis={
                    <>
                      <Num>{v.payments.unresolved.length}</Num> {v.payments.unresolved.length === 1 ? 'payment' : 'payments'}
                      {v.payments.unresolved[0]?.orderRef ? <>, <Num>{v.payments.unresolved.map(u => u.orderRef).filter(Boolean).join(', ')}</Num></> : null}
                    </>
                  }
                  amount={negate(v.unresolvedGross)}
                />
              ) : null}
              <Line tone="total" label="Received, after GST" amount={v.netIn} />
              <Line tone="group" label="Money out, counted in the P&L" />
              <Line
                label="Order costs"
                basis={
                  <>
                    <Num>{v.orderCosts.count}</Num> {v.orderCosts.count === 1 ? 'expense' : 'expenses'}
                    {toPaisa(v.orderCosts.inputTax) > 0n ? <>, net of <Num>{rupees(v.orderCosts.inputTax)}</Num> input tax</> : null}
                  </>
                }
                amount={negate(v.orderCosts.net)}
              />
              <Line label="Overheads" basis={<><Num>{v.overheads.count}</Num> {v.overheads.count === 1 ? 'expense' : 'expenses'}</>} amount={negate(v.overheads.net)} />
              {toPaisa(v.adjustResult) !== 0n ? (
                <Line tone="sub" label="Changes to closed months" tag="counted this month" basis="Found after those months were closed" amount={v.adjustResult} />
              ) : null}
              <Line tone="result" label={`Profit for ${name}`} amount={v.result} />
            </div>
          </Panel>

          {/* Shown only when something was drawn or repaid: an empty panel every month was noise. */}
          {drawings ? (
          <section aria-label="Not in P&L" className="overflow-hidden rounded border border-dashed border-line-input bg-canvas">
            <header className="flex flex-wrap items-center gap-3 border-b border-dashed border-line-input px-5 py-3">
              <h3 className="text-base font-semibold">Drawings and loan repayment</h3>
              <InfoTip label="About drawings">Owner drawings and loan repayment are money out, but not a cost of doing business, so they are not in the profit.</InfoTip>
            </header>
            {v.notInPnl.lines.length === 0 ? null : (
              <div role="table" aria-label="Not in P&L">
                {v.notInPnl.lines.map(l => (
                  <Line key={l.categoryId} label={l.category} basis={<><Num>{l.count}</Num> {l.count === 1 ? 'expense' : 'expenses'}, {l.paidVia}</>} amount={negate(l.net)} />
                ))}
                {toPaisa(v.adjustNonPnl) !== 0n ? (
                  <Line tone="sub" label="Changes to closed months" tag="counted this month" amount={negate(v.adjustNonPnl)} />
                ) : null}
                <Line tone="total" label="Drawn or repaid, total" basis={<><Num>{v.notInPnl.total.count}</Num> {v.notInPnl.total.count === 1 ? 'expense' : 'expenses'}</>} amount={negate(v.notInPnl.total.net)} />
              </div>
            )}
            <div className="flex items-baseline justify-between gap-4 rounded-b border-t bg-selected px-5 py-4">
              <div className="grid">
                <span className="text-base font-semibold">After drawings</span>
                <span className="text-xs text-fg-muted">
                  Profit <Num>{rupees(v.result)}</Num> less <Num>{rupees(v.notInPnl.total.net)}</Num>
                </span>
              </div>
              <Money value={v.afterDrawings} size="xl" paisa="never" strong data-testid="after-drawings" />
            </div>
          </section>
          ) : null}
        </div>

        <div className="grid gap-6">
          <Panel title="Where the money went" meta={<span className="num text-sm text-fg-2">PKR {rupees(v.netIn)} received</span>}>
            <div className="grid gap-3 px-5 py-4">
              <div role="img" aria-label="Order costs, overheads and profit against money received" className="flex h-4 overflow-hidden rounded border bg-surface">
                <i className="block bg-fg" style={{ width: w(toPaisa(v.orderCosts.net)) }} />
                <i className="block bg-fg-muted" style={{ width: w(toPaisa(v.overheads.net)) }} />
                {resultPositive ? <i className="block flex-1 bg-surface" /> : null}
              </div>
              <ul className="grid gap-2 text-sm">
                <li className="flex items-center gap-2">
                  <i className="size-[10px] rounded-[2px] bg-fg" />
                  Order costs <span className="text-xs text-fg-muted">{plural(v.orderCosts.count, 'expense')}</span>
                  <span className="flex-1" />
                  <Money value={v.orderCosts.net} prefix={false} paisa="never" plainNegative />
                </li>
                <li className="flex items-center gap-2">
                  <i className="size-[10px] rounded-[2px] bg-fg-muted" />
                  Overheads <span className="text-xs text-fg-muted">{plural(v.overheads.count, 'expense')}</span>
                  <span className="flex-1" />
                  <Money value={v.overheads.net} prefix={false} paisa="never" plainNegative />
                </li>
                <li className="flex items-center gap-2">
                  <i className="size-[10px] rounded-[2px] border border-line-strong bg-surface" />
                  Profit
                  <span className="flex-1" />
                  <Money value={v.result} prefix={false} paisa="never" plainNegative />
                </li>
              </ul>
            </div>
          </Panel>

          <Panel title="Paid out this month">
            <dl className="text-table">
              {[
                [`All expenses paid, ${plural(v.cash.allPaidCount, 'expense')}`, v.cash.allPaid],
                ['of which input tax', v.cash.inputTax],
                [`paid in cash, ${v.cash.cashCount}`, v.cash.cashAmount],
                [`paid by bank, ${v.cash.bankCount}`, v.cash.bankAmount],
              ].map(([k, amt]) => (
                <div key={k} className="flex min-h-[40px] items-center justify-between gap-4 border-t px-5 first:border-t-0">
                  <dt className="text-fg-2">{k}</dt>
                  <dd>
                    <Money value={amt} prefix={false} paisa="never" />
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  )
}

// ------------------------------------------------------------------------------------------------ aging

export function AgingPage() {
  return (
    <ReportPage report="aging">
      {(ctx, setCsv) => <AgingBody ctx={ctx} setCsv={setCsv} />}
    </ReportPage>
  )
}

function AgingBody({ ctx, setCsv }: { ctx: MonthEndCtx; setCsv: SetCsv }) {
  const { asOf, chosen, setAsOf } = useAsOf(ctx.month, ctx.today)
  const q = useAgingReport(asOf)
  const v = q.view
  useCsv(setCsv, v, v ? () => downloadReport(agingCsv(v), csvFile('overdue-by-age', ctx.month)) : null)
  const columns = useMemo<Column<AgingRow>[]>(
    () => [
      {
        id: 'customer',
        header: 'Customer and invoice',
        value: r => r.customer,
        cell: r => (
          <span className="grid gap-px">
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{r.customer}</span>
            <span className="min-w-0 num text-xs text-fg-muted [overflow-wrap:anywhere]">
              {r.invoiceNumber}
              {r.orderRef ? ` · ${r.orderRef}` : ''}
            </span>
          </span>
        ),
      },
      { id: 'date', header: 'Invoice date', kind: 'date', value: r => r.invoiceDate, cell: r => <span className="num">{formatShortDate(r.invoiceDate, asOf)}</span> },
      { id: 'days', header: 'Days', kind: 'num', value: r => r.ageDays },
      { id: 'gross', header: 'Invoice gross', kind: 'money', value: r => r.gross, ...whole<AgingRow>(r => r.gross), hideBelowMd: true },
      { id: 'applied', header: 'Paid by then', kind: 'money', value: r => (toPaisa(r.applied) > 0n ? r.applied : null), ...whole<AgingRow>(r => r.applied), hideBelowMd: true },
      ...AGING_BUCKETS.map(
        (b): Column<AgingRow> => ({
          id: `b${b}`,
          header: BUCKET_LABEL[b],
          kind: 'money',
          value: r => (r.bucket === b && !r.importedUnlinked ? r.remaining : null),
          ...whole<AgingRow>(r => (r.bucket === b && !r.importedUnlinked ? r.remaining : null)),
          cell: r =>
            r.bucket === b && !r.importedUnlinked ? (
              <span className={cn('-mx-2 inline-block rounded px-2 py-[2px]', b === '61-90' && 'bg-tone-warning-bg', b === '90+' && 'bg-tone-danger-bg')}>
                <Money value={r.remaining} prefix={false} paisa="never" />
              </span>
            ) : (
              <span className="text-fg-muted">{'—'}</span>
            ),
        }),
      ),
      {
        id: 'imported',
        header: IMPORTED_GROUP_LABEL,
        kind: 'money',
        value: r => (r.importedUnlinked ? r.remaining : null),
        ...whole<AgingRow>(r => (r.importedUnlinked ? r.remaining : null)),
        cell: r =>
          r.importedUnlinked ? (
            <span className="text-fg-2">
              <Money value={r.remaining} prefix={false} paisa="never" />
            </span>
          ) : (
            <span className="text-fg-muted">{'—'}</span>
          ),
      },
    ],
    [asOf],
  )
  if (q.isError) return <ReportError title="Overdue by age did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading overdue by age" />
  const asOfLabel = `${Number(asOf.slice(8))} ${monthName(asOf.slice(0, 7))} ${asOf.slice(0, 4)}`
  return (
    <>
      <SumBar
        label="Overdue by age"
        items={AGING_BUCKETS.map(b => ({
          label: BUCKET_TITLE[b],
          amount: v.totals[b].amount,
          
          sub: <>
            <Num>{v.totals[b].count}</Num> {v.totals[b].count === 1 ? 'invoice' : 'invoices'}
          </>,
        })).concat(
          v.imported.count
            ? [
                {
                  label: IMPORTED_GROUP_LABEL,
                  amount: v.imported.amount,
                  sub: (
                    <>
                      <Num>{v.imported.count}</Num> {v.imported.count === 1 ? 'invoice' : 'invoices'}, not counted as late
                    </>
                  ),
                },
              ]
            : [],
        )}
      />
      <div className="grid">
        <DataTable
          label="What customers owe, by how late"
          columns={columns}
          rows={v.rows}
          getRowId={r => r.invoiceId}
          twoLine
          footerLabel={`${plural(v.rows.length, 'invoice')} open`}
          className={v.advances.length ? 'rounded-b-none' : undefined}
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold">What customers owe, by how late</h2>
              <InfoTip label="About overdue by age">
                As of {asOfLabel}. Payments are applied first in, first out to the oldest invoice of each order. Invoices dated after{' '}
                {asOfLabel} are left out.
              </InfoTip>
              <span className="flex-1" />
              <AsOfControl asOf={asOf} chosen={chosen} onChange={setAsOf} />
            </div>
          }
          empty={<EmptyState mood="goal" title="Nobody owes an invoice">Every invoice dated up to {asOfLabel} is paid.</EmptyState>}
          mobileRow={r => (
            <span className="grid gap-1">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{r.customer}</span>
                <Money value={r.remaining} prefix={false} paisa="never" strong />
              </span>
              <span className="text-sm text-fg-2">
                <Num>{r.invoiceNumber}</Num>
                {r.orderRef ? <> · <Num>{r.orderRef}</Num></> : null} ·{' '}
                <span className={cn(!r.importedUnlinked && r.bucket === '61-90' && 'text-tone-warning-fg', !r.importedUnlinked && r.bucket === '90+' && 'font-medium text-tone-danger-fg')}>
                  {r.importedUnlinked ? <>{IMPORTED_GROUP_LABEL}, </> : null}
                  <Num>{r.ageDays}</Num> days old
                </span>
              </span>
            </span>
          )}
        />
        {v.advances.length ? (
          <ul aria-label="Advances held" className="rounded-b border border-t-0 border-dashed border-line-input bg-canvas">
            {v.advances.map(a => (
              <li key={a.orderId} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 text-sm">
                <Icon icon={Wallet} size="md" className="text-fg-muted" />
                <span className="grid">
                  <span>{advanceLabel(a)}</span>
                  <span className="text-xs text-fg-muted">
                    {a.orderRef ? <Num>{a.orderRef}</Num> : null} · {a.customer}
                    {a.cancelled ? '. Nobody owes it: refund it or keep it.' : ''}
                  </span>
                </span>
                <Money value={a.held} paisa="never" />
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-sm text-fg-2">
          Total outstanding <Num>PKR {rupees(v.outstanding)}</Num>
        </p>
      </div>
    </>
  )
}

// ------------------------------------------------------------------------------------------------ we owe

export function OwePage() {
  return (
    <ReportPage report="owe">
      {(ctx, setCsv) => <OweBody ctx={ctx} setCsv={setCsv} />}
    </ReportPage>
  )
}

/** "USD 2,640.00": an amount in its own currency. */
const inCurrency = (currency: string, v: Amount, paisa: 'always' | 'never' = 'never') => `${currency} ${formatPaisa(toPaisa(v), paisa)}`
const rateTitle = (r: PayableRow) => (r.rate !== null && r.currency !== 'PKR' ? `At ${Number(r.rate).toFixed(2)} PKR per ${r.currency}` : undefined)

/** What is owed on one supplier order, in words a person can act on: PKR when converted, its own currency when unpaid, else why not. */
function OwedCell({ r }: { r: PayableRow }) {
  if (r.owedPkr !== null)
    return (
      <span title={rateTitle(r)}>
        <Money value={r.owedPkr} prefix={false} paisa="never" strong />
      </span>
    )
  if (r.state === 'no_rate' && r.committed !== null)
    return toPaisa(r.paidPkr) === 0n ? <span className="num font-medium">{inCurrency(r.currency, r.committed)}</span> : <span className="text-fg-2">Needs a rate</span>
  return <span className="text-fg-muted">{'—'}</span>
}

/**
 * We owe suppliers (round 3, was the worst Money screen): five columns (supplier and order, committed in its own currency, paid,
 * owed, state); a missing exchange rate is ONE banner, never "PKR 0" in the headline and never the same sentence on every
 * row; what cannot be converted is shown in its own currency. Phone: one card per supplier order.
 */
function OweBody({ ctx, setCsv }: { ctx: MonthEndCtx; setCsv: SetCsv }) {
  const { asOf, chosen, setAsOf } = useAsOf(ctx.month, ctx.today)
  const q = useOweReport(asOf)
  const v = q.view
  useCsv(setCsv, v, v ? () => downloadReport(payablesCsv(v), csvFile('we-owe-suppliers', ctx.month)) : null)
  const columns = useMemo<Column<PayableRow>[]>(
    () => [
      {
        id: 'supplier',
        header: 'Supplier and order',
        value: r => r.supplier,
        cell: r => (
          <span className="grid gap-px">
            <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{r.supplier}</span>
            <span className="min-w-0 num text-xs text-fg-2 [overflow-wrap:anywhere]">
              {r.orderId && r.orderRef ? (
                <Link to={`/orders/${r.orderId}`} className="rounded hover:underline">
                  {r.orderRef}
                </Link>
              ) : (
                (r.orderRef ?? '')
              )}
              {r.leg ? ` · ${r.leg}` : ''}
            </span>
          </span>
        ),
      },
      {
        id: 'committed',
        header: 'Committed',
        kind: 'money',
        value: r => r.committed,
        cell: r =>
          r.committed === null ? (
            <span className="text-fg-muted">{'—'}</span>
          ) : (
            <span className="num" title={rateTitle(r)}>
              {inCurrency(r.currency, r.committed, 'always')}
            </span>
          ),
      },
      {
        id: 'paid',
        header: 'Paid, PKR',
        kind: 'money',
        value: r => r.paidPkr,
        ...whole<PayableRow>(r => r.paidPkr),
        cell: r => (toPaisa(r.paidPkr) === 0n ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.paidPkr} prefix={false} paisa="never" />),
      },
      { id: 'owed', header: 'Owed', kind: 'money', value: r => r.owedPkr, cell: r => <OwedCell r={r} /> },
      {
        id: 'state',
        header: 'State',
        sortable: false,
        cell: r => <PayState r={r} asOf={asOf} />,
      },
    ],
    [asOf],
  )
  if (q.isError) return <ReportError title="What we owe did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading what we owe" />
  const day = `${Number(asOf.slice(8))} ${monthName(asOf.slice(0, 7)).slice(0, 3)}`
  const asOfLabel = `${Number(asOf.slice(8))} ${monthName(asOf.slice(0, 7))} ${asOf.slice(0, 4)}`
  const unconv = unconvertedByCurrency(v.rows)
  const missing = unconv.map(u => u.currency)
  const partPaid = unconv.reduce((n, u) => n + u.partPaid, 0)
  const owedFigure = [...(toPaisa(v.owed) > 0n || !missing.length ? [`PKR ${rupees(v.owed)}`] : []), ...unconv.filter(u => toPaisa(u.owed) > 0n).map(u => inCurrency(u.currency, u.owed))]
  const orderedFigure = [...(toPaisa(v.committed) > 0n || !missing.length ? [`PKR ${rupees(v.committed)}`] : []), ...unconv.map(u => inCurrency(u.currency, u.committed))]
  const owedOrders = v.owedCount + unconv.reduce((n, u) => n + u.count, 0)
  return (
    <>
      {missing.length ? (
        <Banner tone="warning" title={`No exchange rate for ${day}`}>
          {/* The link sits in the text, not beside it: a side button squeezed the words into one column on a phone. */}
          {missing.join(', ')} {missing.length === 1 ? 'is' : 'are'} shown in {missing.length === 1 ? 'its' : 'their'} own currency.
          {partPaid ? ` ${plural(partPaid, 'supplier order is', 'supplier orders are')} part paid in PKR: what is left shows once a rate is added.` : ''}{' '}
          <Link to="/settings/exchange-rates" className="inline-flex min-h-touch items-center font-medium text-primary underline md:min-h-0">
            Add {missing.join(', ')} rates
          </Link>
        </Banner>
      ) : null}
      <SumBar
        className="max-sm:grid-cols-1"
        label="What we owe"
        items={[
          missing.length
            ? { label: 'Owed', figure: owedFigure.join(' · ') || '0', sub: plural(owedOrders, 'supplier order') }
            : { label: 'Owed', amount: v.owed, sub: <>{plural(v.owedCount, 'supplier order')}, at the rate on {day}</> },
          missing.length
            ? { label: 'Total ordered', figure: orderedFigure.join(' · '), sub: plural(v.rows.length, 'supplier order') }
            : { label: 'Total ordered', amount: v.committed, sub: plural(v.committedLegs, 'supplier order') },
          { label: 'Paid so far', amount: v.paid, sub: <>{plural(v.paidLegs, 'supplier order')} with a payment</> },
        ]}
      />
      <DataTable
        label="What we owe suppliers"
        columns={columns}
        rows={v.rows}
        getRowId={r => r.legId}
        twoLine
        footerLabel={plural(v.rows.length, 'supplier order')}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">What we owe suppliers</h2>
            <InfoTip label="About what we owe">
              As of {asOfLabel}. Owed is approximate: the committed amount at the latest rate in the 30 days up to then, less what was
              paid. A supplier order paid to within 3% counts as paid.
            </InfoTip>
            <span className="flex-1" />
            <AsOfControl asOf={asOf} chosen={chosen} onChange={setAsOf} />
          </div>
        }
        empty={<EmptyState mood="goal" title="Nothing is owed to suppliers">No placed supplier order has a price to pay on {asOfLabel}.</EmptyState>}
        mobileRow={r => (
          <span className="grid gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{r.supplier}</span>
              <span className="shrink-0 text-sm font-medium">{payableStateWord(r)}</span>
            </span>
            <span className="num text-sm text-fg-2">
              {r.orderRef ?? ''}
              {r.leg ? ` · ${r.leg}` : ''}
            </span>
            <span className="text-sm text-fg-2">
              {r.committed !== null ? <span className="num">{inCurrency(r.currency, r.committed)}</span> : 'No price yet'} ordered
              {toPaisa(r.paidPkr) > 0n ? <> · <span className="num">PKR {rupees(r.paidPkr)}</span> paid</> : null}
              {r.owedPkr !== null ? <> · owes <span className="num font-medium text-fg">PKR {rupees(r.owedPkr)}</span></> : null}
            </span>
          </span>
        )}
      />
    </>
  )
}

/** The state word, and Pay where something is owed (the same Pay {supplier} dialog as the order's supplier order menu). */
function PayState({ r, asOf }: { r: PayableRow; asOf: string }) {
  const href = payHref(r, asOf)
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className={cn('text-sm', r.flag === 'overpaid' ? 'font-medium text-tone-warning-fg' : 'text-fg')}>{payableStateWord(r)}</span>
      {href ? (
        <Link to={href} className="inline-flex items-center gap-1 rounded text-sm font-medium text-primary hover:underline" aria-label={`Pay ${r.supplier}${r.orderRef ? `, ${r.orderRef}` : ''}`}>
          <Icon icon={Receipt} size="sm" />
          Pay
        </Link>
      ) : null}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ GST and FBR

export function GstFbrPage() {
  return (
    <ReportPage report="gst">
      {(ctx, setCsv) => <GstBody ctx={ctx} setCsv={setCsv} />}
    </ReportPage>
  )
}

function GstBody({ ctx, setCsv }: { ctx: MonthEndCtx; setCsv: SetCsv }) {
  const q = useGstReport(ctx.month)
  const v = q.view
  useCsv(setCsv, v, v ? () => downloadReport(gstCsv(v), csvFile('gst-and-fbr', ctx.month)) : null)
  const columns = useMemo<Column<GstMonthRow>[]>(
    () => [
      {
        id: 'month',
        header: 'Invoice month',
        value: r => r.month,
        cell: r => (
          <span className="grid gap-px">
            <span className="font-medium">{monthKeyLabel(r.month)}</span>
            {r.month === ctx.month ? <span className="text-xs text-fg-muted">Selected month</span> : null}
          </span>
        ),
      },
      { id: 'count', header: 'Invoices', kind: 'num', value: r => r.invoiceCount, total: true },
      { id: 'net', header: 'Net', kind: 'money', value: r => r.net, ...whole<GstMonthRow>(r => r.net) },
      { id: 'gst', header: 'GST', kind: 'money', value: r => r.gst, ...whole<GstMonthRow>(r => r.gst) },
      { id: 'psid', header: 'PSID sets', kind: 'num', value: r => r.psidSets, total: true },
      {
        id: 'deposited',
        header: 'Deposited',
        kind: 'num',
        value: r => r.depositedCount,
        total: true,
        cell: r => (
          <span className="num">
            {r.depositedCount} of {r.invoiceCount}
          </span>
        ),
      },
      { id: 'depositedAmount', header: 'Deposited, PKR', kind: 'money', value: r => r.depositedAmount, ...whole<GstMonthRow>(r => r.depositedAmount) },
      { id: 'todeposit', header: 'To deposit, PKR', kind: 'money', value: r => r.toDeposit, ...whole<GstMonthRow>(r => r.toDeposit) },
      { id: 'tax', header: 'Input tax paid', kind: 'money', value: r => r.inputTax, ...whole<GstMonthRow>(r => r.inputTax) },
    ],
    [ctx.month],
  )
  if (q.isError) return <ReportError title="The GST and FBR month did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading the GST and FBR month" />
  const sel = v.selected
  const name = monthName(ctx.month)
  const note = v.rows.length
  return (
    <>
      <SumBar
        label="GST and FBR"
        items={[
          { label: `${name} invoices`, count: sel?.invoiceCount ?? 0, sub: <>Net PKR <Num>{rupees(sel?.net ?? 0)}</Num></> },
          { label: 'Output GST', amount: sel?.gst ?? '0',  sub: <>On the <Num>{sel?.invoiceCount ?? 0}</Num> {name} invoices</> },
          { label: 'Deposited', amount: sel?.depositedAmount ?? '0',  sub: <><Num>{sel?.depositedCount ?? 0}</Num> of <Num>{sel?.invoiceCount ?? 0}</Num> invoices, in <Num>{sel?.psidSets ?? 0}</Num> PSID {sel?.psidSets === 1 ? 'set' : 'sets'}</> },
          { label: 'Still to deposit', amount: sel?.toDeposit ?? '0',  sub: <><Num>{(sel?.invoiceCount ?? 0) - (sel?.depositedCount ?? 0)}</Num> {(sel?.invoiceCount ?? 0) - (sel?.depositedCount ?? 0) === 1 ? 'invoice' : 'invoices'}</> },
        ]}
      />
      <DataTable
        label="GST and FBR, by invoice month"
        columns={v.showInputTax ? columns : columns.filter(c => c.id !== 'tax')}
        rows={v.rows}
        getRowId={r => r.month}
        activeRowId={ctx.month}
        footerLabel={`${plural(note, 'month')}`}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">GST and FBR, by invoice month</h2>
            <ClockTag>By invoice date</ClockTag>
            <InfoTip label="About GST and FBR">
              FBR is the tax office: the GST on every invoice is deposited with it, and a PSID is the payment slip number of one deposit.
              Sales see Invoices &amp; GST only, never input tax or this report.
            </InfoTip>
          </div>
        }
        empty={<EmptyState title="No invoices yet">Invoices appear here by their date, with their PSID sets and deposits.</EmptyState>}
        mobileRow={r => (
          <span className="grid gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{monthKeyLabel(r.month)}</span>
              <span className="num text-sm">GST {rupees(r.gst)}</span>
            </span>
            <span className="text-sm text-fg-2">
              {plural(r.invoiceCount, 'invoice')} · <Num>{r.depositedCount}</Num> deposited
              {toPaisa(r.toDeposit) > 0n ? <> · <Num>{rupees(r.toDeposit)}</Num> to deposit</> : null}
            </span>
          </span>
        )}
      />
      {v.showInputTax ? (
        <Panel
          title="Output GST and input tax, side by side"
          meta={
            <InfoTip label="About input tax">
              Never netted on this page; filing stays with the tax agent. Input tax is the part of a Supplier payment, Clearing or Freight
              amount that Q-Tech can claim; the profit and loss and the margins use the amount without it.
            </InfoTip>
          }
        >
          <div className="grid gap-4 px-5 py-4">
            <div className="grid divide-y rounded border md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="grid gap-1 px-4 py-3">
                <span className="text-xs text-fg-2">Output GST, {name} invoices</span>
                <span className="num text-base">
                  {pkr(sel?.gst ?? 0)} · {plural(sel?.invoiceCount ?? 0, 'invoice')}
                </span>
              </div>
              <div className="grid gap-1 px-4 py-3">
                <span className="text-xs text-fg-2">Input tax paid in {name}, for the tax agent</span>
                <span className="num text-base">{pkr(sel?.inputTax ?? 0)}</span>
              </div>
            </div>
          </div>
        </Panel>
      ) : null}
    </>
  )
}

// ------------------------------------------------------------------------------------------------ team

export function TeamPage() {
  return (
    <ReportPage report="team">
      {(ctx, setCsv) => <TeamBody ctx={ctx} setCsv={setCsv} />}
    </ReportPage>
  )
}

function TeamBody({ ctx, setCsv }: { ctx: MonthEndCtx; setCsv: SetCsv }) {
  const q = useTeamReport(ctx.month, ctx.today)
  const v = q.view
  useCsv(setCsv, v, v ? () => downloadReport(teamCsv(v, ctx.month), csvFile('sales-by-person', ctx.month)) : null)
  const columns = useMemo<Column<TeamRow>[]>(
    () => [
      {
        id: 'person',
        header: 'Person',
        value: r => r.name,
        cell: r => (
          <span className="flex items-center gap-3">
            <Avatar name={r.name} />
            <span className="grid gap-px">
              <span className="font-medium">{r.name}</span>
              <span className="text-xs capitalize text-fg-muted">{r.role}</span>
            </span>
          </span>
        ),
      },
      { id: 'payments', header: 'Payments', kind: 'num', value: r => r.payments, total: true },
      { id: 'net', header: `Net credited, ${monthName(ctx.month)}`, kind: 'money', value: r => r.net, ...whole<TeamRow>(r => r.net), cell: r => (r.net === null ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.net} prefix={false} paisa="never" />) },
      { id: 'qtd', header: 'Quarter to date', kind: 'money', value: r => r.quarterNet, ...whole<TeamRow>(r => r.quarterNet), cell: r => (r.quarterNet === null ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.quarterNet} prefix={false} paisa="never" />) },
      {
        id: 'target',
        header: v ? `Against the Q${v.quarter} target` : 'Against the target',
        sortable: false,
        cell: r =>
          r.quarterTarget === null ? (
            <span className="text-fg-muted">No target set</span>
          ) : (
            <span className="grid gap-1">
              <span
                role="img"
                aria-label={`${rupees(r.quarterNet ?? 0)} of ${rupees(r.quarterTarget)}`}
                className="relative block h-[6px] w-full min-w-[96px] max-w-[220px] overflow-hidden rounded-round bg-selected"
              >
                <i className="absolute inset-y-0 left-0 block rounded-round bg-fg-muted" style={{ width: `${Math.min(100, Math.max(0, (Number(r.quarterNet ?? 0) / Math.max(1, Number(r.quarterTarget))) * 100))}%` }} />
              </span>
              <span className="num text-xs text-fg-2">
                {rupees(r.quarterNet ?? 0)} of {rupees(r.quarterTarget)}
              </span>
            </span>
          ),
      },
    ],
    [ctx.month, v],
  )
  if (q.isError) return <ReportError title="Sales by person did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading sales by person" />
  return (
    <>
      <SumBar
        label="Sales by person"
        items={[
          { label: 'Net cash credited', amount: v.credited,  sub: <><Num>{v.creditedPayments}</Num> {v.creditedPayments === 1 ? 'payment' : 'payments'} credited to <Num>{v.creditedPeople}</Num> {v.creditedPeople === 1 ? 'person' : 'people'}</> },
          { label: 'Not credited', amount: v.unresolved,  sub: <><Num>{v.unresolvedCount}</Num> {v.unresolvedCount === 1 ? 'payment' : 'payments'} not split into net and GST</> },
          { label: 'Quarter to date', amount: v.quarterToDate,  sub: `Q${v.quarter} to date, from the payments counted for targets` },
          { label: `Days left in Q${v.quarter}`, count: v.daysLeft, sub: <>Until {formatShortDate(v.quarterEnd, ctx.today, true)}</> },
        ]}
      />
      <DataTable
        label="Net cash credited to each person"
        columns={columns}
        rows={v.rows}
        getRowId={r => r.userId}
        twoLine
        footerLabel="Credited to people"
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">Net cash credited to each person</h2>
            <ClockTag>By payment date</ClockTag>
            <InfoTip label="About sales by person">
              The total matches Received after GST on the Profit and loss report. The <Num>{rupees(v.unresolved)}</Num> not yet split into net
              and GST has no net, so nobody is credited for it.
            </InfoTip>
          </div>
        }
        empty={<EmptyState title="Nobody is credited">No payment counted towards a person in {monthName(ctx.month)}.</EmptyState>}
        mobileRow={r => (
          <span className="grid gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{r.name}</span>
              {r.net === null ? <span className="text-sm text-fg-muted">{'—'}</span> : <Money value={r.net} prefix={false} paisa="never" strong />}
            </span>
            <span className="text-sm text-fg-2">
              {plural(r.payments, 'payment')} · quarter <Num>{rupees(r.quarterNet ?? 0)}</Num>
              {r.quarterTarget !== null ? <> of <Num>{rupees(r.quarterTarget)}</Num></> : ', no target'}
            </span>
          </span>
        )}
      />
    </>
  )
}
