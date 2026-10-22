import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Banknote, ExternalLink } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { agoDays, inDays } from '@/lib/timeWords'
import { matchesAllWords, useQueryParamText } from '@/lib/useQueryParamText'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Money } from '@/ui/Money'
import { NoResults } from '@/ui/NoResults'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusText } from '@/ui/StatusText'
import { SumBar } from '@/ui/SumBar'
import { TableFilter } from '@/ui/TableFilter'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { InfoTip } from '@/ui/InfoTip'
import { NothingYetState } from '@/features/help/FirstUseState'
import { useReceivables, useReceivablesSummary } from '@/features/money/payments/hooks'
import { lazyDialog } from '@/lib/lazyDialog'
import { BelowTheFold } from '@/ui/BelowTheFold'
import { lazyWithReload } from '@/lib/importWithReload'
import { Skeleton } from '@/ui/Skeleton'
import {
  daysBetween,
  filterReceivables,
  isInvoiced,
  receivableNextStep,
  receivableSearchText,
  receivableTotals,
  reminderPhrase,
  sortReceivables,
  type ReceivableFilter,
  type ReceivableRow,
} from '@/features/money/payments/model'

// Downloaded the first time it opens (perf/lcp, lazyDialog.tsx).
// The reminder panel under the list is a download of its own, fetched once the list is drawn (perf/lcp, BelowTheFold).
const ReminderPanel = lazyWithReload(() => import('@/features/money/payments/ReminderPanel').then(m => ({ default: m.ReminderPanel })))
const RecordPaymentDialog = lazyDialog(() => import('@/features/money/payments/RecordPaymentDialog').then(m => m.RecordPaymentDialog))

/*
 * Money > Who owes us (M02; g2-money "receivables"; one name for admin and sales since the owner decision of 2026-10-19, and
 * where Money opens). What each order still owes, gross, GST included, through order_receivables(): admin and sales see
 * balances; only admin sees payment rows (there are none on this screen) and only admin can record a payment. On a phone each
 * card carries "Record payment" (admin) and "Open order", so the most frequent admin job needs no detour through the order.
 * Search balances (customer, order number, invoice number; kept in `?q=`) and Open, Overdue and Paid narrow the list; the
 * four figures on top split the outstanding balance by status. Each row has ONE Next step (round-2 R2-06): "Send a reminder"
 * (late), "Reminded 3 days ago" or "Due 3 Nov" (waiting), "Paid" (done). The payment-reminder panel beside the table is M09
 * (ReminderPanel): picking a row selects it (the 3 px green edge) and shows its reminder; the order opens from the order
 * number. Beside the table from 1360 px, under it below that.
 *
 *   /money/receivables?pay=1&order=<id>   opens Record payment for that order (admin)
 */
// Gross and Settled fold away on a phone, and again between 1360 and 1535 px (1439 before the bigger text, DECISIONS 2026-10-19), where
// the reminder panel sits beside the table and the Balance column carries the figure that matters; the table then fits without a
// sideways scroll. They show everywhere else.
const GROSS_SETTLED = 'hidden md:table-cell min-[1360px]:hidden min-[1536px]:table-cell'
const SEARCH_FIELDS = 'customer, order number and invoice number'
const FILTER_WORD: Record<ReceivableFilter, string> = { open: 'Open', overdue: 'Overdue', settled: 'Paid' }
const shortDay = (iso: string) => formatDay(iso).replace(/^\w+ /, '').replace(/ \d{4}$/, '')

function NextStep({ r, today }: { r: ReceivableRow; today: string }) {
  const s = receivableNextStep(r, today)
  return (
    <StatusText tone={s.tone} detail={s.detail}>
      {s.label}
    </StatusText>
  )
}

export function ReceivablesPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useReceivables()
  const [filter, setFilter] = useState<ReceivableFilter>('open')
  const [search, setSearch] = useQueryParamText()
  const [paying, setPaying] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [params, setParams] = useSearchParams()
  const today = businessToday()

  const rows = useMemo(() => q.data ?? [], [q.data])
  // The four figures are counted on the server (receivables_summary, the same rules); until it answers, from the rows.
  const summary = useReceivablesSummary(today)
  const local = useMemo(() => receivableTotals(rows, today), [rows, today])
  const totals = summary.data ?? local
  const byState = useMemo(() => filterReceivables(rows, filter), [rows, filter])
  const shown = useMemo(() => sortReceivables(byState.filter(r => matchesAllWords(receivableSearchText(r), search))), [byState, search])
  // The panel follows the picked row; before a pick (or when it leaves the list) it follows the most overdue row (E-MN-03), else the first.
  const mostOverdue = shown.find(r => r.state === 'overdue') ?? shown[0] ?? null
  const selected = shown.find(r => r.orderId === picked) ?? mostOverdue
  const pick = (r: ReceivableRow) => {
    setPicked(r.orderId)
    // Under 1360 px the panel is below the table: bring it into view.
    if (typeof window !== 'undefined' && !window.matchMedia?.('(min-width: 1360px)').matches) panelRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const linkedPay = isAdmin && params.get('pay') !== null ? params.get('order') : null
  const closeLinked = () => {
    const next = new URLSearchParams(params)
    next.delete('pay')
    next.delete('order')
    setParams(next, { replace: true })
  }

  const columns = useMemo<Column<ReceivableRow>[]>(() => {
    const cols: Column<ReceivableRow>[] = [
      {
        id: 'customer',
        header: 'Customer and order',
        value: r => r.companyName,
        cell: r => (
          <span className="grid gap-px">
            <span className="min-w-0 [overflow-wrap:anywhere] font-medium">{r.companyName}</span>
            <span className="num min-w-0 [overflow-wrap:anywhere] text-xs text-fg-muted">
              <Link to={`/orders/${r.orderId}`} className="underline-offset-2 hover:underline" aria-label={`Open ${orderRef(r.orderNumber)}`}>
                {orderRef(r.orderNumber)}
              </Link>
              {isInvoiced(r) ? ` · ${r.invoiceNumbers.join(', ')}` : ' · not invoiced yet'}
            </span>
          </span>
        ),
      },
      {
        id: 'gross',
        header: 'Gross due',
        kind: 'money',
        hideClass: GROSS_SETTLED,
        value: r => String(r.gross),
        total: true,
        cell: r => (
          <span className="grid justify-items-end gap-px">
            <Money value={r.gross} prefix={false} />
            {!isInvoiced(r) ? <span className="font-sans text-xs text-fg-muted">from items</span> : null}
          </span>
        ),
      },
      { id: 'settled', header: 'Settled', kind: 'money', hideClass: GROSS_SETTLED, value: r => String(r.settled), total: true },
      { id: 'balance', header: 'Balance', kind: 'money', value: r => String(r.balance), total: true, cell: r => <Money value={r.balance} prefix={false} strong /> },
      {
        id: 'due',
        header: 'Due',
        value: r => r.dueOn,
        cell: r => {
          if (!r.dueOn) return <span className="text-fg-muted">{'—'}</span>
          const d = daysBetween(today, r.dueOn)
          // Words only: the row's one danger mark is its Next step (spec 1.2 rule 6).
          return (
            <span className="grid gap-px">
              <span className="num font-medium">{shortDay(r.dueOn)}</span>
              <span className="text-xs text-fg-muted">{d < 0 ? agoDays(-d) : inDays(d)}</span>
            </span>
          )
        },
      },
      // ONE Next step (R2-06): replaces the Payment chip and the Last reminder columns.
      { id: 'next', header: 'Next step', sortable: false, cell: r => <NextStep r={r} today={today} /> },
    ]
    if (isAdmin)
      cols.push({
        id: 'actions',
        header: 'Actions',
        sortable: false,
        cell: r =>
          r.state === 'settled' ? null : (
            <Button size="sm" icon={Banknote} aria-label={`Record payment for ${orderRef(r.orderNumber)}`} title="Record payment" onClick={() => setPaying(r.orderId)} />
          ),
      })
    return cols
  }, [isAdmin, today])

  const tabLabel = 'Who owes us'
  const searching = search.trim() !== ''
  const clearSearch = () => {
    setSearch('')
    setFilter('open')
  }

  return (
    <MoneyFrame active="receivables">
      <SumBar
        label="Balance by status"
        items={[
          { label: 'Outstanding', amount: totals.outstanding, sub: `${totals.openCount} open ${totals.openCount === 1 ? 'order' : 'orders'}` },
          { label: 'Overdue', amount: totals.overdue, tone: totals.overdue > 0 ? 'danger' : undefined, sub: `${totals.overdueCount} ${totals.overdueCount === 1 ? 'order' : 'orders'}${totals.overdueCount ? `, ${reminderPhrase(totals.overdueCount, totals.reminderDueCount)}` : ''}` },
          { label: 'Not yet due', amount: totals.notYetDue, sub: `${totals.notYetDueCount} ${totals.notYetDueCount === 1 ? 'order' : 'orders'}, invoiced` },
          { label: 'Not invoiced yet', amount: totals.notInvoiced, sub: `${totals.notInvoicedCount} ${totals.notInvoicedCount === 1 ? 'order' : 'orders'}, balance from items` },
        ]}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 min-[1360px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <DataTable
            label={tabLabel}
            columns={columns}
            rows={shown}
            getRowId={r => r.orderId}
            twoLine
            onRowOpen={pick}
            activeRowId={selected?.orderId ?? null}
            footerLabel={`${shown.length} ${filter === 'settled' ? 'paid' : filter === 'overdue' ? 'overdue' : 'open'} ${shown.length === 1 ? 'order' : 'orders'}`}
            loading={q.isPending}
            error={q.isError ? { title: 'The balances did not load', message: 'Your invoices and payments are safe. Try again, and if it keeps failing, tell the admin.', onRetry: () => void q.refetch() } : null}
            toolbar={
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="text-base font-semibold">{tabLabel}</h2>
                  <span className="text-sm text-fg-muted">Balance is gross, GST included</span>
                  {/* ONE tip beside the header (two merges once left a second one beside it): the balance, then reminders. */}
                  <InfoTip label="About the balance and reminders">
                    What the customer still owes, GST included, after payments recorded. A reminder is due when an order is overdue and has
                    not been reminded in the last 7 days; copying the reminder records it, and the order moves to Waiting on Today.{' '}
                    {isAdmin ? 'Record a payment with the button on its row.' : 'Payments are recorded by an admin.'}
                  </InfoTip>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <TableFilter label="Search balances" hint="Finds a balance by customer, order number or invoice number." value={search} onChange={setSearch} />
                  <span className="flex-1" />
                  {/* No counts: the Who owes us tab carries the to-remind count (spec 2.2 #18). */}
                  <SegmentedControl
                    aria-label="Filter"
                    value={filter}
                    onValueChange={v => setFilter(v as ReceivableFilter)}
                    options={[
                      { value: 'open', label: FILTER_WORD.open },
                      { value: 'overdue', label: FILTER_WORD.overdue },
                      { value: 'settled', label: FILTER_WORD.settled },
                    ]}
                  />
                </div>
              </div>
            }
            empty={
              searching && byState.length > 0 ? (
                <NoResults query={search} scope="balances" fields={SEARCH_FIELDS} filtersOn={filter === 'open' ? [] : [FILTER_WORD[filter]]} onClear={clearSearch} />
              ) : filter === 'open' && rows.length === 0 ? (
                // No balance has ever been recorded (a new CRM): "Every order is paid in full" would be untrue.
                <NothingYetState screen="receivables" />
              ) : filter === 'open' ? (
                <EmptyState mood="goal" title="Nothing is owed">
                  Every order is paid in full. New balances appear here when an order is won.
                </EmptyState>
              ) : (
                <EmptyState title={filter === 'overdue' ? 'Nothing is overdue' : 'No order is paid in full yet'}>
                  {filter === 'overdue' ? 'Orders appear here once their due date has passed without full payment.' : 'An order is paid in full when its payments reach the gross amount.'}
                </EmptyState>
              )
            }
            mobileRow={r => (
              <div className="grid gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 [overflow-wrap:anywhere] font-medium">{r.companyName}</span>
                  <Money value={r.balance} prefix={false} strong />
                </div>
                <span className="num text-xs text-fg-muted">
                  {orderRef(r.orderNumber)}
                  {isInvoiced(r) ? ` · ${r.invoiceNumbers.join(', ')}` : ' · not invoiced yet'}
                </span>
                <NextStep r={r} today={today} />
                <div className="mt-1 flex flex-wrap gap-2">
                  {isAdmin && r.state !== 'settled' ? (
                    <Button icon={Banknote} size="touch" onClick={() => setPaying(r.orderId)} aria-label={`Record payment for ${orderRef(r.orderNumber)}`}>
                      Record payment
                    </Button>
                  ) : null}
                  <Link
                    to={`/orders/${r.orderId}`}
                    className="inline-flex min-h-touch items-center gap-2 rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken"
                  >
                    <Icon icon={ExternalLink} size="sm" className="text-fg-muted" />
                    Open order
                  </Link>
                </div>
              </div>
            )}
          />
        </div>
        <div ref={panelRef} className="scroll-mt-4">
          <BelowTheFold fallback={<Skeleton className="h-40 w-full" />}>
            <ReminderPanel row={selected} today={today} />
          </BelowTheFold>
        </div>
      </div>
      <RecordPaymentDialog open={paying !== null || linkedPay !== null} orderId={paying ?? linkedPay} onOpenChange={o => { if (!o) { setPaying(null); if (linkedPay) closeLinked() } }} />
    </MoneyFrame>
  )
}
