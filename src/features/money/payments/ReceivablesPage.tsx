import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FilePlus } from 'lucide-react'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { CreateInvoiceDialog } from '@/features/money/invoices/CreateInvoiceDialog'
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
// Admin's held advances (usually nothing to show) are read and drawn after the list too.
const HeldAdvancesPanel = lazyWithReload(() => import('@/features/money/payments/HeldAdvancesPanel').then(m => ({ default: m.HeldAdvancesPanel })))
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

function NextStep({ r, today, onInvoice }: { r: ReceivableRow; today: string; onInvoice: (orderId: string) => void }) {
  const s = receivableNextStep(r, today)
  // "Not invoiced yet" is a state, not a step: the step is to create the invoice, one tap from here (round 3).
  if (r.state !== 'settled' && !isInvoiced(r))
    return (
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          onInvoice(r.orderId)
        }}
        className="inline-flex min-h-touch items-center gap-1 rounded text-left text-sm font-medium text-primary hover:underline md:min-h-0"
        aria-label={`Create invoice for ${orderRef(r.orderNumber)}`}
      >
        <Icon icon={FilePlus} size="sm" />
        Create invoice
      </button>
    )
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
  const [invoicing, setInvoicing] = useState<string | null>(null)
  const [sheet, setSheet] = useState(false)
  // DataTable draws cards below 640 px; there the reminder is a sheet, not a panel at the foot of a long page.
  const cards = useMediaQuery('(max-width: 639px)')
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
    // A phone has no room for the panel beside the cards: the picked card's reminder opens as a bottom sheet.
    if (cards) {
      setSheet(true)
      return
    }
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
      // ONE Next step (R2-06): replaces the Payment chip and the Last reminder columns. Record payment lives in ONE place, the
      // panel of the picked row (round 3: the unlabelled icon button on every row is gone).
      { id: 'next', header: 'Next step', sortable: false, cell: r => <NextStep r={r} today={today} onInvoice={setInvoicing} /> },
    ]
    return cols
  }, [today])

  const tabLabel = 'Who owes us'
  const searching = search.trim() !== ''
  const clearSearch = () => {
    setSearch('')
    setFilter('open')
  }

  return (
    <MoneyFrame
      active="receivables"
      actions={
        // Phone: the panel (and its green Copy and mark reminded) is a sheet, so the page's one green button opens it on the
        // most overdue order. Desktop has the panel beside the table instead.
        cards && mostOverdue?.state === 'overdue' ? (
          <Button
            variant="primary"
            size="touch"
            onClick={() => {
              setPicked(mostOverdue.orderId)
              setSheet(true)
            }}
          >
            Send a reminder
          </Button>
        ) : undefined
      }
    >
      {/* Phone: the key fact stays in view while the cards scroll (the four tiles took half the screen). */}
      <p data-testid="owed-line" className="sticky top-0 z-10 -mx-4 flex flex-wrap items-baseline gap-x-3 border-b bg-canvas px-4 py-2 text-base sm:hidden">
        <span>
          Owed <b className="num font-semibold">PKR {Math.round(totals.outstanding).toLocaleString('en-US')}</b>
        </span>
        {totals.overdueCount > 0 ? (
          <span className="text-tone-danger-fg">
            Overdue <b className="num font-semibold">PKR {Math.round(totals.overdue).toLocaleString('en-US')}</b> · <span className="num">{totals.overdueCount}</span>
          </span>
        ) : null}
      </p>
      <SumBar
        className="max-sm:hidden"
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
                  <h2 className="text-base font-semibold">Balances</h2>
                  {/* ONE tip beside the header (two merges once left a second one beside it): the balance, then reminders. */}
                  <InfoTip label="About the balance and reminders">
                    The balance is what the customer still owes, gross (GST included), after payments recorded. A reminder is due when an
                    order is overdue and has not been reminded in the last 7 days; copying the reminder records it, and the order moves to
                    Waiting on Today.{' '}
                    {isAdmin ? 'Pick an order to see its reminder and Record payment.' : 'Payments are recorded by an admin.'}
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
                <span className="num text-sm text-fg-2">
                  {orderRef(r.orderNumber)}
                  {isInvoiced(r) ? ` · ${r.invoiceNumbers.join(', ')}` : ''}
                </span>
                {/* One action per card: tap it for the reminder, Record payment and Open order (a sheet). */}
                <NextStep r={r} today={today} onInvoice={setInvoicing} />
              </div>
            )}
          />
          <BelowTheFold fallback={null}>
            <HeldAdvancesPanel isAdmin={isAdmin} />
          </BelowTheFold>
        </div>
        {cards ? null : (
          <div ref={panelRef} className="scroll-mt-4">
            <BelowTheFold fallback={<Skeleton className="h-40 w-full" />}>
              <ReminderPanel row={selected} today={today} />
            </BelowTheFold>
          </div>
        )}
      </div>
      {cards ? (
        <Dialog open={sheet && selected !== null} onOpenChange={setSheet}>
          <DialogContent title={selected ? selected.companyName : 'Payment reminder'} size="md">
            {selected ? <ReminderPanel row={selected} today={today} /> : null}
          </DialogContent>
        </Dialog>
      ) : null}
      <CreateInvoiceDialog open={invoicing !== null} onOpenChange={o => (o ? undefined : setInvoicing(null))} orderId={invoicing ?? undefined} />
      <RecordPaymentDialog open={paying !== null || linkedPay !== null} orderId={paying ?? linkedPay} onOpenChange={o => { if (!o) { setPaying(null); if (linkedPay) closeLinked() } }} />
    </MoneyFrame>
  )
}
