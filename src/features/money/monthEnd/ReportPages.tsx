import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Info, Lock, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { SumBar } from '@/ui/SumBar'
import { Tag } from '@/ui/Tag'
import { DataTable, type Column } from '@/ui/DataTable'
import { Avatar } from '@/ui/Avatar'
import { formatPaisa, toPaisa, type Amount } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { MonthBar, MonthEndFrame } from '@/features/money/monthEnd/MonthEndFrame'
import { useMonthEnd, type MonthEndCtx } from '@/features/money/monthEnd/useMonthEnd'
import {
  AsOfField,
  ClockTag,
  ExportCsvButton,
  Panel,
  ReportError,
  ReportLoading,
} from '@/features/money/monthEnd/ReportParts'
import { csvFile, downloadReport } from '@/features/money/monthEnd/reportFiles'
import {
  useAgingReport,
  useAsOf,
  useCategoryReport,
  useGstReport,
  useOweReport,
  usePnlReport,
  useTeamReport,
} from '@/features/money/monthEnd/reportHooks'
import {
  AGING_BUCKETS,
  BUCKET_LABEL,
  BUCKET_TITLE,
  PAYABLE_STATE_LABEL,
  agingCsv,
  barShare,
  categoriesCsv,
  gstCsv,
  isEmptyMonth,
  monthName,
  negate,
  payablesCsv,
  pnlCsv,
  teamCsv,
  type AgingRow,
  type CategoryLine,
  type GstMonthRow,
  type PayableRow,
  type TeamRow,
  type ViaFilter,
} from '@/features/money/monthEnd/model'

/*
 * The six Month-end reports (M10; M05 amended: the cash month is the P&L here). Each is one tap on its tab and one tap on Export
 * CSV, which writes the figures on the page. Layout: g2-month-end "Report: profit and loss", "expenses by category", "aging",
 * "what we owe", "GST and FBR month" and "team". Every figure comes from the database views of migration 0028; nothing is
 * recomputed here beyond adding what is drawn.
 */
function ReportPage({
  active,
  title,
  children,
  hideBar,
}: {
  active: string
  title: string
  children: (ctx: MonthEndCtx) => ReactNode
  hideBar?: boolean
}) {
  const ctx = useMonthEnd()
  return (
    <MonthEndFrame active={active} ctx={ctx}>
      <h2 className="sr-only">{title}</h2>
      {hideBar ? null : <MonthBar ctx={ctx} />}
      {children(ctx)}
    </MonthEndFrame>
  )
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const Num = ({ children }: { children: ReactNode }) => <span className="num">{children}</span>
const pkr = (v: Amount) => `PKR ${formatPaisa(toPaisa(v))}`

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
        {amount !== undefined ? <Money value={amount} prefix={false} strong={tone === 'total' || tone === 'result'} /> : null}
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
    <ReportPage active="pnl" title="Profit and loss">
      {ctx => <PnlBody ctx={ctx} />}
    </ReportPage>
  )
}

function PnlBody({ ctx }: { ctx: MonthEndCtx }) {
  const q = usePnlReport(ctx.month)
  const v = q.view
  if (q.isError) return <ReportError title="The profit and loss did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading the profit and loss" />
  if (isEmptyMonth(v)) return <Empty ctx={ctx} what="No payment was received and no expense was paid." />
  const name = monthName(ctx.month)
  const split = v.payments.count - v.payments.unresolved.length
  const spent = toPaisa(v.orderCosts.net) + toPaisa(v.overheads.net)
  const base = Math.max(Number(toPaisa(v.netIn)), Number(spent), 1)
  const w = (x: bigint) => `${Math.min(100, Math.max(0, (Number(x) / base) * 100))}%`
  const resultPositive = toPaisa(v.result) > 0n
  return (
    <>
      <SumBar
        label="Profit and loss"
        items={[
          {
            label: 'Net in',
            amount: v.netIn,
            paisa: 'auto',
            sub: (
              <>
                <Num>{split}</Num> {split === 1 ? 'payment' : 'payments'}
                {v.payments.unresolved.length ? <>, excludes {formatPaisa(toPaisa(v.unresolvedGross))} unresolved</> : null}
              </>
            ),
          },
          { label: 'GST in the payments', amount: v.gstIn, paisa: 'auto', sub: 'Shown here, never counted as revenue' },
          { label: 'Result', amount: v.result, paisa: 'auto', sub: 'Net in less order costs and overheads' },
          {
            label: 'After drawings',
            amount: v.afterDrawings,
            paisa: 'auto',
            sub: <>Result less {formatPaisa(toPaisa(v.notInPnl.total.net))} not in the P&amp;L</>,
          },
        ]}
      />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="grid gap-6">
          <Panel
            title="Profit and loss"
            meta={<ClockTag>By payment date</ClockTag>}
            actions={<ExportCsvButton onClick={() => downloadReport(pnlCsv(v), csvFile('profit-and-loss', ctx.month))} />}
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
              <Line tone="sub" label="less GST inside the payments" tag="not revenue" basis="Shared by invoice" amount={negate(v.gstIn)} />
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
              <Line tone="total" label="Net in" amount={v.netIn} />
              <Line tone="group" label="Money out, counted in the P&L" />
              <Line
                label="Order costs"
                basis={
                  <>
                    <Num>{v.orderCosts.count}</Num> {v.orderCosts.count === 1 ? 'expense' : 'expenses'}
                    {toPaisa(v.orderCosts.inputTax) > 0n ? <>, net of <Num>{formatPaisa(toPaisa(v.orderCosts.inputTax))}</Num> input tax</> : null}
                  </>
                }
                amount={negate(v.orderCosts.net)}
              />
              <Line label="Overheads" basis={<><Num>{v.overheads.count}</Num> {v.overheads.count === 1 ? 'expense' : 'expenses'}</>} amount={negate(v.overheads.net)} />
              <Line tone="result" label={`Result for ${name}`} amount={v.result} />
            </div>
          </Panel>

          <section aria-label="Not in P&L" className="overflow-hidden rounded border border-dashed border-line-input bg-canvas">
            <header className="flex flex-wrap items-center gap-3 border-b border-dashed border-line-input px-5 py-3">
              <h3 className="text-sm font-semibold">Not in P&amp;L</h3>
              <span className="text-xs text-fg-muted">Owner drawings and loan repayment are money out, but not a cost of doing business</span>
            </header>
            {v.notInPnl.lines.length === 0 ? (
              <p className="px-5 py-4 text-sm text-fg-muted">Nothing was drawn or repaid in {name}.</p>
            ) : (
              <div role="table" aria-label="Not in P&L">
                {v.notInPnl.lines.map(l => (
                  <Line key={l.categoryId} label={l.category} basis={<><Num>{l.count}</Num> {l.count === 1 ? 'expense' : 'expenses'}, {l.paidVia}</>} amount={negate(l.net)} />
                ))}
                <Line tone="total" label="Not in P&L, total" basis={<><Num>{v.notInPnl.total.count}</Num> {v.notInPnl.total.count === 1 ? 'expense' : 'expenses'}</>} amount={negate(v.notInPnl.total.net)} />
              </div>
            )}
            <div className="flex items-baseline justify-between gap-4 rounded-b border-t bg-selected px-5 py-4">
              <div className="grid">
                <span className="text-base font-semibold">After drawings</span>
                <span className="text-xs text-fg-muted">
                  Result <Num>{formatPaisa(toPaisa(v.result))}</Num> less <Num>{formatPaisa(toPaisa(v.notInPnl.total.net))}</Num>
                </span>
              </div>
              <Money value={v.afterDrawings} size="xl" strong data-testid="after-drawings" />
            </div>
          </section>
        </div>

        <div className="grid gap-6">
          <Panel title="Where the net in went" meta={<span className="num text-xs text-fg-muted">PKR {formatPaisa(toPaisa(v.netIn))}</span>}>
            <div className="grid gap-3 px-5 py-4">
              <div role="img" aria-label="Order costs, overheads and result against net in" className="flex h-4 overflow-hidden rounded border bg-surface">
                <i className="block bg-fg" style={{ width: w(toPaisa(v.orderCosts.net)) }} />
                <i className="block bg-fg-muted" style={{ width: w(toPaisa(v.overheads.net)) }} />
                {resultPositive ? <i className="block flex-1 bg-surface" /> : null}
              </div>
              <ul className="grid gap-2 text-sm">
                <li className="flex items-center gap-2">
                  <i className="size-[10px] rounded-[2px] bg-fg" />
                  Order costs <span className="text-xs text-fg-muted"><Num>{v.orderCosts.count}</Num> expenses</span>
                  <span className="flex-1" />
                  <Money value={v.orderCosts.net} prefix={false} />
                </li>
                <li className="flex items-center gap-2">
                  <i className="size-[10px] rounded-[2px] bg-fg-muted" />
                  Overheads <span className="text-xs text-fg-muted"><Num>{v.overheads.count}</Num> expenses</span>
                  <span className="flex-1" />
                  <Money value={v.overheads.net} prefix={false} />
                </li>
                <li className="flex items-center gap-2">
                  <i className="size-[10px] rounded-[2px] border border-line-strong bg-surface" />
                  Result
                  <span className="flex-1" />
                  <Money value={v.result} prefix={false} />
                </li>
              </ul>
            </div>
          </Panel>

          <Panel title="Cash lines" meta={<span className="text-xs text-fg-muted">What actually left</span>}>
            <dl className="text-table">
              {[
                ['All expenses paid, ' + v.cash.allPaidCount, v.cash.allPaid],
                ['of which input tax', v.cash.inputTax],
                ['paid in cash, ' + v.cash.cashCount, v.cash.cashAmount],
                ['paid by bank, ' + v.cash.bankCount, v.cash.bankAmount],
              ].map(([k, amt]) => (
                <div key={k} className="flex min-h-[40px] items-center justify-between gap-4 border-t px-5 first:border-t-0">
                  <dt className="text-fg-2">{k}</dt>
                  <dd>
                    <Money value={amt} prefix={false} />
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <aside className="flex items-start gap-3 rounded bg-sunken px-4 py-3 text-xs text-fg-muted">
            <Icon icon={Info} size="md" className="mt-px" />
            <p>This counts money on the day it moved. It will not match the GST register, which counts invoices on their date.</p>
          </aside>
        </div>
      </div>
    </>
  )
}

// ------------------------------------------------------------------------------------------------ expenses by category

const VIA_LABEL: Record<ViaFilter, string> = { all: 'All paid via', bank: 'Bank', cash: 'Cash' }

export function CategoriesPage() {
  return (
    <ReportPage active="categories" title="Expenses by category">
      {ctx => <CategoriesBody ctx={ctx} />}
    </ReportPage>
  )
}

function CategoriesBody({ ctx }: { ctx: MonthEndCtx }) {
  const q = useCategoryReport(ctx.month)
  const [via, setVia] = useState<ViaFilter>('all')
  const v = q.view
  const lines = useMemo(() => (v ? v.groups.flatMap(g => g.lines).filter(l => via === 'all' || l.paidVia === via) : []), [v, via])
  const columns = useMemo<Column<CategoryLine>[]>(
    () => [
      {
        id: 'category',
        header: 'Category',
        value: l => l.category,
        cell: l => <span className="font-medium">{l.category}</span>,
      },
      { id: 'count', header: 'Count', kind: 'num', value: l => l.count, total: true },
      {
        id: 'via',
        header: 'Paid via',
        value: l => l.paidVia,
        cell: l => <StatusBadge dimension="paid-via" value={l.paidVia} />,
      },
      { id: 'gross', header: 'Gross paid', kind: 'money', value: l => l.gross, total: true },
      { id: 'tax', header: 'Input tax', kind: 'money', value: l => l.inputTax, total: true, cell: l => (toPaisa(l.inputTax) > 0n ? <Money value={l.inputTax} prefix={false} /> : <span className="text-fg-muted">{'—'}</span>) },
      {
        id: 'net',
        header: 'Net cost',
        kind: 'money',
        value: l => l.net,
        total: true,
        cell: l => {
          const grp = v?.groups.find(g => g.grp === l.grp)?.lines ?? []
          return (
            <span className="inline-flex items-center justify-end gap-3">
              <span aria-hidden="true" className="hidden h-1 w-[72px] overflow-hidden rounded-round bg-selected md:block">
                <i className="block h-full rounded-round bg-fg-2" style={{ width: `${barShare(l.net, grp) * 100}%` }} />
              </span>
              <Money value={l.net} prefix={false} />
            </span>
          )
        },
      },
    ],
    [v],
  )
  if (q.isError) return <ReportError title="The expenses by category did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading the expenses by category" />
  const over = v.groups.find(g => g.grp === 'overhead')!.total
  const ord = v.groups.find(g => g.grp === 'order_cost')!.total
  const non = v.groups.find(g => g.grp === 'non_pnl')!
  if (v.all.count === 0) return <Empty ctx={ctx} what="No expense was paid." />
  return (
    <>
      <SumBar
        label="Expenses by group"
        items={[
          { label: 'Overheads', amount: over.net, sub: <><Num>{over.count}</Num> {over.count === 1 ? 'expense' : 'expenses'}, in the P&amp;L</> },
          {
            label: 'Order costs',
            amount: ord.net,
            sub: (
              <>
                <Num>{ord.count}</Num> {ord.count === 1 ? 'expense' : 'expenses'}
                {toPaisa(ord.inputTax) > 0n ? <>, net of <Num>{formatPaisa(toPaisa(ord.inputTax))}</Num> input tax</> : null}
              </>
            ),
          },
          {
            label: 'Not in P&L',
            amount: non.total.net,
            sub: (
              <>
                <Num>{non.total.count}</Num> {non.total.count === 1 ? 'expense' : 'expenses'}
                {non.lines.length ? `: ${non.lines.map(l => l.category.toLowerCase().replace('owner ', '').replace(' repayment', '')).join(', ')}` : ''}
              </>
            ),
          },
          {
            label: 'Paid out',
            amount: v.all.gross,
            sub: (
              <>
                <Num>{v.all.count}</Num> {v.all.count === 1 ? 'expense' : 'expenses'}, <Num>{v.via.cashCount}</Num> cash and <Num>{v.via.bankCount}</Num> bank
              </>
            ),
          },
        ]}
      />
      <DataTable
        label="Expenses by category"
        columns={columns}
        rows={lines}
        getRowId={l => l.categoryId}
        group={l => ({ key: l.grp, label: v.groups.find(g => g.grp === l.grp)?.title ?? l.grp })}
        footerLabel="All expenses"
        noun="categories"
        twoLine={false}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">Expenses by category</h2>
            <ClockTag>By payment date</ClockTag>
            <span className="flex-1" />
            <SegmentedControl
              aria-label="Paid via"
              value={via}
              onValueChange={x => setVia(x as ViaFilter)}
              options={(['all', 'bank', 'cash'] as const).map(k => ({ value: k, label: VIA_LABEL[k] }))}
            />
            <ExportCsvButton onClick={() => downloadReport(categoriesCsv(v, ctx.month, via), csvFile('expenses-by-category', ctx.month))} />
          </div>
        }
        empty={<EmptyState title="No expenses paid this way">Choose another way of paying to see the rest.</EmptyState>}
      />
    </>
  )
}

// ------------------------------------------------------------------------------------------------ aging

export function AgingPage() {
  return (
    <ReportPage active="aging" title="Aging">
      {ctx => <AgingBody ctx={ctx} />}
    </ReportPage>
  )
}

function AgingBody({ ctx }: { ctx: MonthEndCtx }) {
  const { asOf, chosen, setAsOf } = useAsOf(ctx.month, ctx.today)
  const q = useAgingReport(asOf)
  const v = q.view
  const columns = useMemo<Column<AgingRow>[]>(
    () => [
      {
        id: 'customer',
        header: 'Customer and invoice',
        value: r => r.customer,
        cell: r => (
          <span className="grid gap-px">
            <span className="truncate font-medium">{r.customer}</span>
            <span className="num truncate text-xs text-fg-muted">
              {r.invoiceNumber}
              {r.orderRef ? ` · ${r.orderRef}` : ''}
            </span>
          </span>
        ),
      },
      { id: 'date', header: 'Invoice date', kind: 'date', value: r => r.invoiceDate, cell: r => <span className="num">{formatShortDate(r.invoiceDate, asOf)}</span> },
      { id: 'days', header: 'Days', kind: 'num', value: r => r.ageDays },
      { id: 'gross', header: 'Invoice gross', kind: 'money', value: r => r.gross, total: true, hideBelowMd: true },
      { id: 'applied', header: 'Paid by then', kind: 'money', value: r => (toPaisa(r.applied) > 0n ? r.applied : null), total: true, hideBelowMd: true },
      ...AGING_BUCKETS.map(
        (b): Column<AgingRow> => ({
          id: `b${b}`,
          header: BUCKET_LABEL[b],
          kind: 'money',
          value: r => (r.bucket === b ? r.remaining : null),
          total: true,
          cell: r =>
            r.bucket === b ? (
              <span className={cn('-mx-2 inline-block rounded px-2 py-[2px]', b === '61-90' && 'bg-tone-warning-bg', b === '90+' && 'bg-tone-danger-bg')}>
                <Money value={r.remaining} prefix={false} />
              </span>
            ) : (
              <span className="text-fg-muted">{'—'}</span>
            ),
        }),
      ),
    ],
    [asOf],
  )
  if (q.isError) return <ReportError title="The aging did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading the aging" />
  const asOfLabel = `${Number(asOf.slice(8))} ${monthName(asOf.slice(0, 7))} ${asOf.slice(0, 4)}`
  return (
    <>
      <SumBar
        label="Aging buckets"
        items={AGING_BUCKETS.map(b => ({
          label: BUCKET_TITLE[b],
          amount: v.totals[b].amount,
          paisa: 'auto' as const,
          sub: <>
            <Num>{v.totals[b].count}</Num> {v.totals[b].count === 1 ? 'invoice' : 'invoices'}
          </>,
        }))}
      />
      <div className="grid">
        <DataTable
          label="Aging of what customers owe"
          columns={columns}
          rows={v.rows}
          getRowId={r => r.invoiceId}
          twoLine
          footerLabel={`${plural(v.rows.length, 'invoice')} open`}
          className={v.advances.length ? 'rounded-b-none' : undefined}
          toolbar={
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-base font-semibold">Aging of what customers owe</h2>
              <ClockTag>As of {asOfLabel}</ClockTag>
              <span className="flex-1" />
              <AsOfField value={asOf} onChange={d => setAsOf(d)} />
              {chosen ? (
                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setAsOf(null)}>
                  Back to month end
                </button>
              ) : null}
              <ExportCsvButton onClick={() => downloadReport(agingCsv(v), csvFile('aging', ctx.month))} />
            </div>
          }
          empty={<EmptyState mood="goal" title="Nobody owes an invoice">Every invoice dated up to {asOfLabel} is paid.</EmptyState>}
        />
        {v.advances.length ? (
          <ul aria-label="Advances held" className="rounded-b border border-t-0 border-dashed border-line-input bg-canvas">
            {v.advances.map(a => (
              <li key={a.orderId} className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 text-sm">
                <Icon icon={Wallet} size="md" className="text-fg-muted" />
                <span className="grid">
                  <span>Advance held, not invoiced yet</span>
                  <span className="text-xs text-fg-muted">
                    {a.orderRef ? <Num>{a.orderRef}</Num> : null} · {a.customer}. Held apart, never shown as negative aging.
                  </span>
                </span>
                <Money value={a.held} />
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-2 text-xs text-fg-muted">
          Payments are applied first in, first out to the oldest invoice of each order. Invoices dated after {asOfLabel} are left out. Total outstanding{' '}
          <Num>{formatPaisa(toPaisa(v.outstanding))}</Num>.
        </p>
      </div>
    </>
  )
}

// ------------------------------------------------------------------------------------------------ we owe

export function OwePage() {
  return (
    <ReportPage active="owe" title="What we owe">
      {ctx => <OweBody ctx={ctx} />}
    </ReportPage>
  )
}

function OweBody({ ctx }: { ctx: MonthEndCtx }) {
  const { asOf, chosen, setAsOf } = useAsOf(ctx.month, ctx.today)
  const q = useOweReport(asOf)
  const v = q.view
  const columns = useMemo<Column<PayableRow>[]>(
    () => [
      {
        id: 'supplier',
        header: 'Supplier and leg',
        value: r => r.supplier,
        cell: r => (
          <span className="grid gap-px">
            <span className="truncate font-medium">{r.supplier}</span>
            <span className="num truncate text-xs text-fg-muted">
              {r.orderRef ?? ''}
              {r.leg ? ` · ${r.leg}` : ''}
            </span>
          </span>
        ),
      },
      { id: 'currency', header: 'Currency', value: r => r.currency, cell: r => <Tag>{r.currency}</Tag> },
      { id: 'committed', header: 'Committed', kind: 'money', value: r => r.committed, paisa: 'always', cell: r => (r.committed === null ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.committed} prefix={false} paisa="always" />) },
      { id: 'rate', header: 'Rate', kind: 'num', value: r => (r.rate === null ? null : Number(r.rate)), cell: r => (r.rate === null ? <span className="text-fg-muted">no rate</span> : <span className={cn('num', r.currency === 'PKR' && 'text-fg-muted')}>{Number(r.rate).toFixed(2)}</span>) },
      { id: 'committedPkr', header: 'Committed, PKR', kind: 'money', value: r => r.committedPkr, total: true, cell: r => (r.committedPkr === null ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.committedPkr} prefix={false} />) },
      { id: 'paid', header: 'Paid, PKR', kind: 'money', value: r => r.paidPkr, total: true, cell: r => (toPaisa(r.paidPkr) === 0n ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.paidPkr} prefix={false} />) },
      { id: 'owed', header: 'Owed, PKR (≈)', kind: 'money', value: r => r.owedPkr, total: true, cell: r => (r.owedPkr === null ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.owedPkr} prefix={false} strong />) },
      {
        id: 'state',
        header: 'State',
        sortable: false,
        cell: r => (
          <span className="grid justify-items-start gap-px">
            <Tag>{PAYABLE_STATE_LABEL[r.state]}{r.flag === 'overpaid' ? ', paid over' : ''}</Tag>
            <span className="text-xs text-fg-muted">
              {r.state === 'owing' ? (toPaisa(r.paidPkr) === 0n ? 'No payment yet' : 'Part paid') : r.state === 'settled' ? (r.flag === 'overpaid' ? 'Owed shown as 0' : 'Within 3% of paid, or paid') : r.state === 'unpriced' ? 'No price on the items yet' : 'No rate for this currency'}
            </span>
          </span>
        ),
      },
    ],
    [],
  )
  if (q.isError) return <ReportError title="What we owe did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading what we owe" />
  const asOfLabel = `${Number(asOf.slice(8))} ${monthName(asOf.slice(0, 7))} ${asOf.slice(0, 4)}`
  return (
    <>
      <SumBar
        label="What we owe"
        items={[
          { label: 'Owed, open legs', amount: v.owed, sub: <><Num>{v.owedCount}</Num> {v.owedCount === 1 ? 'leg' : 'legs'}, about, at the rate on {Number(asOf.slice(8))} {monthName(asOf.slice(0, 7)).slice(0, 3)}</> },
          { label: 'Committed, all legs', amount: v.committed, sub: <><Num>{v.committedLegs}</Num> placed {v.committedLegs === 1 ? 'leg' : 'legs'} on live orders</> },
          { label: 'Paid so far', amount: v.paid, sub: <><Num>{v.paidLegs}</Num> {v.paidLegs === 1 ? 'leg' : 'legs'} with a payment</> },
          { label: 'Settled (≈)', count: v.settledCount, sub: 'Within 3% of paid, or paid over' },
        ]}
      />
      <DataTable
        label="What we owe suppliers"
        columns={columns}
        rows={v.rows}
        getRowId={r => r.legId}
        twoLine
        footerLabel={plural(v.rows.length, 'leg')}
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">What we owe suppliers</h2>
            <ClockTag>As of {asOfLabel}</ClockTag>
            <span className="flex-1" />
            <AsOfField value={asOf} onChange={d => setAsOf(d)} />
            {chosen ? (
              <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setAsOf(null)}>
                Back to month end
              </button>
            ) : null}
            <ExportCsvButton onClick={() => downloadReport(payablesCsv(v), csvFile('we-owe', ctx.month))} />
          </div>
        }
        empty={<EmptyState mood="goal" title="Nothing is owed to suppliers">No placed leg has a price to pay on {asOfLabel}.</EmptyState>}
      />
      <p className="text-xs text-fg-muted">
        Owed is approximate: the committed amount at the rate on or before {asOfLabel}, less what was paid. Open legs{' '}
        <Num>{formatPaisa(toPaisa(v.owed))}</Num> + settled (≈) <Num>{formatPaisa(toPaisa(v.settledLeft))}</Num> − paid over <Num>{formatPaisa(toPaisa(v.paidOver))}</Num> ={' '}
        <Num>{formatPaisa(toPaisa(v.committed) - toPaisa(v.paid))}</Num> committed less paid.
      </p>
    </>
  )
}

// ------------------------------------------------------------------------------------------------ GST and FBR

export function GstFbrPage() {
  return (
    <ReportPage active="gst" title="GST and FBR month">
      {ctx => <GstBody ctx={ctx} />}
    </ReportPage>
  )
}

function GstBody({ ctx }: { ctx: MonthEndCtx }) {
  const q = useGstReport(ctx.month)
  const v = q.view
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
      { id: 'net', header: 'Net', kind: 'money', value: r => r.net, total: true },
      { id: 'gst', header: 'GST', kind: 'money', value: r => r.gst, total: true },
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
      { id: 'depositedAmount', header: 'Deposited, PKR', kind: 'money', value: r => r.depositedAmount, total: true },
      { id: 'todeposit', header: 'To deposit, PKR', kind: 'money', value: r => r.toDeposit, total: true },
      { id: 'tax', header: 'Input tax paid', kind: 'money', value: r => r.inputTax, total: true },
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
          { label: `${name} invoices`, count: sel?.invoiceCount ?? 0, sub: <>Net PKR <Num>{formatPaisa(toPaisa(sel?.net ?? 0))}</Num></> },
          { label: 'Output GST', amount: sel?.gst ?? '0', paisa: 'auto', sub: <>On the <Num>{sel?.invoiceCount ?? 0}</Num> {name} invoices</> },
          { label: 'Deposited', amount: sel?.depositedAmount ?? '0', paisa: 'auto', sub: <><Num>{sel?.depositedCount ?? 0}</Num> of <Num>{sel?.invoiceCount ?? 0}</Num> invoices, in <Num>{sel?.psidSets ?? 0}</Num> PSID {sel?.psidSets === 1 ? 'set' : 'sets'}</> },
          { label: 'Still to deposit', amount: sel?.toDeposit ?? '0', paisa: 'auto', sub: <><Num>{(sel?.invoiceCount ?? 0) - (sel?.depositedCount ?? 0)}</Num> {(sel?.invoiceCount ?? 0) - (sel?.depositedCount ?? 0) === 1 ? 'invoice' : 'invoices'}</> },
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
            <span className="flex-1" />
            {v.showInputTax ? (
              <span className="inline-flex h-6 items-center gap-[6px] rounded bg-tone-ink-bg px-2 text-xs font-medium text-tone-ink-fg">
                <Icon icon={Lock} size="chip" />
                Input tax: admin only
              </span>
            ) : null}
            <ExportCsvButton onClick={() => downloadReport(gstCsv(v), csvFile('gst-and-fbr', ctx.month))} />
          </div>
        }
        empty={<EmptyState title="No invoices yet">Invoices appear here by their date, with their PSID sets and deposits.</EmptyState>}
      />
      {v.showInputTax ? (
        <Panel title="Output GST and input tax, side by side" meta={<span className="text-xs text-fg-muted">Never netted on this page</span>}>
          <div className="grid gap-4 px-5 py-4">
            <div className="grid divide-y rounded border md:grid-cols-2 md:divide-x md:divide-y-0">
              <div className="grid gap-1 px-4 py-3">
                <span className="text-xs text-fg-2">Output GST, {name} invoices</span>
                <span className="num text-base">
                  {pkr(sel?.gst ?? 0)} · {plural(sel?.invoiceCount ?? 0, 'invoice')}
                </span>
              </div>
              <div className="grid gap-1 px-4 py-3">
                <span className="flex items-center gap-2 text-xs text-fg-2">
                  Input tax paid in {name}, for the tax agent
                  <Tag>
                    <Icon icon={Lock} size="chip" />
                    Admin
                  </Tag>
                </span>
                <span className="num text-base">{pkr(sel?.inputTax ?? 0)}</span>
              </div>
            </div>
            <p className="text-xs text-fg-muted">
              Filing stays with the tax agent. Input tax is the part of a Supplier payment, Clearing or Freight amount that Q-Tech can claim; the P&amp;L and margins use the amount without it.
            </p>
          </div>
        </Panel>
      ) : null}
      <aside className="flex items-start gap-3 rounded bg-sunken px-4 py-3 text-xs text-fg-muted">
        <Icon icon={Lock} size="md" className="mt-px" />
        <p>
          Sales see the register and its CSV without the input-tax column. Output GST and input tax are shown here side by side and never netted.{' '}
          <Link to="/money/gst-register" className="font-medium text-primary hover:underline">
            Open the GST register
          </Link>
        </p>
      </aside>
    </>
  )
}

// ------------------------------------------------------------------------------------------------ team

export function TeamPage() {
  return (
    <ReportPage active="team" title="Team">
      {ctx => <TeamBody ctx={ctx} />}
    </ReportPage>
  )
}

function TeamBody({ ctx }: { ctx: MonthEndCtx }) {
  const q = useTeamReport(ctx.month, ctx.today)
  const v = q.view
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
      { id: 'net', header: `Net credited, ${monthName(ctx.month)}`, kind: 'money', value: r => r.net, total: true, cell: r => (r.net === null ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.net} prefix={false} />) },
      { id: 'qtd', header: 'Quarter to date', kind: 'money', value: r => r.quarterNet, total: true, cell: r => (r.quarterNet === null ? <span className="text-fg-muted">{'—'}</span> : <Money value={r.quarterNet} prefix={false} />) },
      {
        id: 'target',
        header: v ? `Against the Q${v.quarter} target` : 'Against the target',
        sortable: false,
        cell: r =>
          r.quarterTarget === null ? (
            <span className="text-fg-muted">No target set</span>
          ) : (
            <span className="num text-xs text-fg-2">
              {formatPaisa(toPaisa(r.quarterNet ?? 0))} of {formatPaisa(toPaisa(r.quarterTarget))}
            </span>
          ),
      },
    ],
    [ctx.month, v],
  )
  if (q.isError) return <ReportError title="The team report did not load" onRetry={q.refetch} />
  if (q.isPending || !v) return <ReportLoading label="Loading the team report" />
  return (
    <>
      <SumBar
        label="Team"
        items={[
          { label: 'Net cash credited', amount: v.credited, paisa: 'auto', sub: <><Num>{v.creditedPayments}</Num> {v.creditedPayments === 1 ? 'payment' : 'payments'} credited to <Num>{v.creditedPeople}</Num> {v.creditedPeople === 1 ? 'person' : 'people'}</> },
          { label: 'Not credited', amount: v.unresolved, paisa: 'auto', sub: <><Num>{v.unresolvedCount}</Num> unresolved {v.unresolvedCount === 1 ? 'payment' : 'payments'}</> },
          { label: 'Quarter to date', amount: v.quarterToDate, paisa: 'auto', sub: `Q${v.quarter} to date, from the payments counted for targets` },
          { label: `Days left in Q${v.quarter}`, count: v.daysLeft, sub: <>Until {formatShortDate(v.quarterEnd, ctx.today, true)}</> },
        ]}
      />
      <DataTable
        label="Team: net cash credited"
        columns={columns}
        rows={v.rows}
        getRowId={r => r.userId}
        twoLine
        footerLabel="Credited to people"
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">Team: net cash credited</h2>
            <ClockTag>By payment date</ClockTag>
            <span className="flex-1" />
            <ExportCsvButton onClick={() => downloadReport(teamCsv(v, ctx.month), csvFile('team', ctx.month))} />
          </div>
        }
        empty={<EmptyState title="Nobody is credited">No payment counted towards a person in {monthName(ctx.month)}.</EmptyState>}
      />
      <p className="text-xs text-fg-muted">
        The total matches Net in on the P&amp;L tab. The unresolved <Num>{formatPaisa(toPaisa(v.unresolved))}</Num> has no net yet, so nobody is credited for it.
      </p>
    </>
  )
}
