import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Banknote, ExternalLink } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Money } from '@/ui/Money'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { SumBar } from '@/ui/SumBar'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { InfoTip } from '@/ui/InfoTip'
import { NothingYetState } from '@/features/help/FirstUseState'
import { useReceivables, useReceivablesSummary } from '@/features/money/payments/hooks'
import { RecordPaymentDialog } from '@/features/money/payments/RecordPaymentDialog'
import { ReminderPanel } from '@/features/money/payments/ReminderPanel'
import {
  daysBetween,
  filterReceivables,
  isInvoiced,
  receivableTotals,
  reminderPhrase,
  sortReceivables,
  type ReceivableFilter,
  type ReceivableRow,
} from '@/features/money/payments/model'

/*
 * Money > Who owes us (M02; g2-money "receivables"; one name for admin and sales since the owner decision of 2026-10-19, and
 * where Money opens). What each order still owes, gross, GST included, through order_receivables(): admin and sales see
 * balances; only admin sees payment rows (there are none on this screen) and only admin can record a payment. On a phone each
 * card carries "Record payment" (admin) and "Open order", so the most frequent admin job needs no detour through the order. Open, Overdue and Settled filter the list; the four figures on top split the
 * outstanding balance by status. The payment-reminder panel beside the table is M09 (ReminderPanel): picking a row
 * selects it (the 3 px green edge) and shows its reminder; the order opens from the order number. Beside the table from
 * 1360 px, under it below that.
 *
 *   /money/receivables?pay=1&order=<id>   opens Record payment for that order (admin)
 */
// Gross and Settled fold away on a phone, and again between 1360 and 1535 px (1439 before the bigger text, DECISIONS 2026-10-19), where
// the reminder panel sits beside the table and the Balance column carries the figure that matters; the table then fits without a
// sideways scroll. They show everywhere else.
const GROSS_SETTLED = 'hidden md:table-cell min-[1360px]:hidden min-[1536px]:table-cell'
const DUE_WORD = (d: number) => `${d} ${d === 1 ? 'day' : 'days'}`

export function ReceivablesPage() {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const q = useReceivables()
  const [filter, setFilter] = useState<ReceivableFilter>('open')
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
  const counts = useMemo(
    () => ({ open: filterReceivables(rows, 'open').length, overdue: filterReceivables(rows, 'overdue').length, settled: filterReceivables(rows, 'settled').length }),
    [rows],
  )
  const shown = useMemo(() => sortReceivables(filterReceivables(rows, filter)), [rows, filter])
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
            <span className="truncate font-medium">{r.companyName}</span>
            <span className="num truncate text-xs text-fg-muted">
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
          if (!r.dueOn) return <span className="text-fg-muted">Not invoiced</span>
          const d = daysBetween(today, r.dueOn)
          const overdue = r.state === 'overdue'
          return (
            <span className="grid gap-px">
              <span className="num font-medium">{formatDay(r.dueOn).replace(/^\w+ /, '').replace(/ \d{4}$/, '')}</span>
              <span className={overdue ? 'text-xs text-tone-danger-fg' : 'text-xs text-fg-muted'}>{d < 0 ? `${DUE_WORD(-d)} ago` : d === 0 ? 'today' : `in ${DUE_WORD(d)}`}</span>
            </span>
          )
        },
      },
      {
        id: 'payment',
        header: 'Payment',
        sortable: false,
        cell: r =>
          r.state === 'overdue' && r.dueOn ? (
            <StatusBadge dimension="payment" value="overdue" label={`${DUE_WORD(Math.max(daysBetween(r.dueOn, today), 1))} overdue`} />
          ) : (
            <StatusBadge dimension="payment" value={r.state} label={r.state === 'settled' ? 'Paid' : undefined} />
          ),
      },
      {
        id: 'reminder',
        header: 'Last reminder',
        sortable: false,
        cell: r =>
          r.lastRemindedOn ? (
            <span className="grid gap-px">
              <span className="font-medium">
                Reminded <span className="num">{r.reminderCount}×</span>
              </span>
              <span className="text-xs text-fg-muted">
                last <span className="num">{formatDay(r.lastRemindedOn).replace(/^\w+ /, '')}</span> · {daysBetween(r.lastRemindedOn, today)} days ago
              </span>
            </span>
          ) : (
            <span className="text-fg-muted">{'—'}</span>
          ),
      },
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
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-base font-semibold">{tabLabel}</h2>
                <span className="text-sm text-fg-muted">Balance is gross, GST included</span>
                {/* ONE tip beside the header (two merges once left a second one beside it): the balance, then reminders. */}
                <InfoTip label="About the balance and reminders">
                  What the customer still owes, GST included, after payments recorded. A reminder is due when an order is overdue and has
                  not been reminded in the last 7 days; copying the reminder records it, and the order moves to Waiting on Today.{' '}
                  {isAdmin ? 'Record a payment with the button on its row.' : 'Payments are recorded by an admin.'}
                </InfoTip>
                <span className="flex-1" />
                <SegmentedControl
                  aria-label="Filter"
                  value={filter}
                  onValueChange={v => setFilter(v as ReceivableFilter)}
                  options={[
                    // a count means "needs you": only Overdue carries one
                    { value: 'open', label: 'Open' },
                    { value: 'overdue', label: 'Overdue', count: counts.overdue },
                    { value: 'settled', label: 'Paid' },
                  ]}
                />
              </div>
            }
            empty={
              filter === 'open' && rows.length === 0 ? (
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
                  <span className="truncate font-medium">{r.companyName}</span>
                  <Money value={r.balance} prefix={false} strong />
                </div>
                <span className="num text-xs text-fg-muted">
                  {orderRef(r.orderNumber)}
                  {isInvoiced(r) ? ` · ${r.invoiceNumbers.join(', ')}` : ' · not invoiced yet'}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {r.state === 'overdue' && r.dueOn ? <StatusBadge dimension="payment" value="overdue" label={`${DUE_WORD(Math.max(daysBetween(r.dueOn, today), 1))} overdue`} /> : <StatusBadge dimension="payment" value={r.state} label={r.state === 'settled' ? 'Paid' : undefined} />}
                  {r.dueOn ? <span className="num text-sm text-fg-muted">Due {formatDay(r.dueOn).replace(/^\w+ /, '').replace(/ \d{4}$/, '')}</span> : null}
                </div>
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
          <ReminderPanel row={selected} today={today} />
        </div>
      </div>
      <RecordPaymentDialog open={paying !== null || linkedPay !== null} orderId={paying ?? linkedPay} onOpenChange={o => { if (!o) { setPaying(null); if (linkedPay) closeLinked() } }} />
    </MoneyFrame>
  )
}
