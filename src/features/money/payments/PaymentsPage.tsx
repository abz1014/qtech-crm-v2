import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Banknote } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatAmount } from '@/lib/money'
import { formatDay } from '@/lib/formatDay'
import { lazyDialog } from '@/lib/lazyDialog'
import { orderRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Money } from '@/ui/Money'
import { SumBar } from '@/ui/SumBar'
import { MoneyFrame } from '@/features/money/MoneyFrame'
import { isMonthKey } from '@/features/money/monthKey'
import { PAID_VIA_LABEL, monthKeyLabel, shiftMonth, type PaidVia } from '@/features/money/expenses/model'
import { useClosedMonths, usePnlMonths } from '@/features/money/monthEnd/hooks'
import { MonthPager, MonthStateChip } from '@/features/money/monthEnd/MonthEndFrame'
import { usePaymentsReceived } from '@/features/money/payments/hooks'
import { receivedTotal, type ReceivedPayment } from '@/features/money/payments/model'

const RecordPaymentFlow = lazyDialog(() => import('@/features/money/payments/RecordPaymentFlow').then(m => m.RecordPaymentFlow))

/*
 * Money > Payments (52-payments.html; owner gate 2, 13 Nov 2026, F-236): the payments received, one month at a time, newest first.
 * Admin only (the route is, and payments_in is admin only by Row Level Security). Every way of paying is listed; a voided payment
 * is not (it is history on its order). Read only: to correct, void or delete a payment you open its order, where its row menu is.
 * The month rides in the address (?month=2026-10), so the Reports tab keeps it too. The one green button, Record payment, asks
 * "Which order?" first (RecordPaymentFlow). Amounts are gross, GST included; the GST inside the month is the P&L's figure (the same
 * one Money home prints), never worked out here. Money lists print the order reference only (gate 2, decision 19).
 */
const day = (iso: string) => formatDay(iso).replace(/^\w+ /, '')
const viaWord = (v: string) => PAID_VIA_LABEL[v as PaidVia] ?? v
const plural = (n: number) => `${n} ${n === 1 ? 'payment' : 'payments'}`

export function PaymentsPage() {
  const thisMonth = businessToday().slice(0, 7)
  const [params, setParams] = useSearchParams()
  const asked = params.get('month')
  const month = isMonthKey(asked) && asked <= thisMonth ? asked : thisMonth
  const go = (by: number) => {
    const next = new URLSearchParams(params)
    const to = shiftMonth(month, by)
    if (to >= thisMonth) next.delete('month')
    else next.set('month', to)
    setParams(next, { replace: true })
  }
  const [recording, setRecording] = useState(false)
  const q = usePaymentsReceived(month)
  const pnl = usePnlMonths()
  const closed = useClosedMonths()
  const rows = useMemo(() => q.data ?? [], [q.data])
  const sum = receivedTotal(rows)
  const gst = pnl.data ? (pnl.data[month]?.gstIn ?? '0.00') : null
  const isClosed = (closed.data ?? []).some(c => c.key === month)
  const name = monthKeyLabel(month)

  const columns = useMemo<Column<ReceivedPayment>[]>(
    () => [
      {
        id: 'date',
        header: 'Date received',
        value: r => r.receivedOn,
        cell: r => (
          <time dateTime={r.receivedOn} className="num whitespace-nowrap">
            {day(r.receivedOn)}
          </time>
        ),
      },
      {
        id: 'customer',
        header: 'Customer and order',
        value: r => r.company ?? '',
        cell: r => <CustomerCell r={r} />,
      },
      { id: 'via', header: 'Paid via', value: r => viaWord(r.paidVia), cell: r => <ViaCell r={r} /> },
      { id: 'amount', header: 'Amount received', kind: 'money', value: r => String(r.amount), total: true, cell: r => <Money value={r.amount} prefix={false} strong /> },
    ],
    [],
  )

  return (
    <MoneyFrame
      active="payments"
      lede={<span className="max-md:hidden">All amounts in PKR. Amounts include GST.</span>}
      actions={
        <Button variant="primary" icon={Banknote} onClick={() => setRecording(true)}>
          Record payment
        </Button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <MonthPager month={month} thisMonth={thisMonth} go={go} />
        {isClosed ? <MonthStateChip closed /> : null}
      </div>
      {q.isSuccess && rows.length > 0 ? (
        <SumBar
          label={`Received in ${name}, includes GST`}
          desktop="strip"
          items={[
            { label: `Received in ${name}`, amount: sum.total, sub: `${plural(sum.count)}, GST included` },
            { label: 'GST inside it, about', amount: gst, tone: 'muted', sub: 'owed to FBR' },
          ]}
        />
      ) : null}
      <DataTable
        label={`Payments received in ${name}`}
        columns={columns}
        rows={rows}
        getRowId={r => r.id}
        twoLine
        loading={q.isPending}
        error={q.isError ? { title: 'Payments did not load', message: 'Nothing was changed. Try again, and if it keeps failing, tell the admin.', onRetry: () => void q.refetch() } : null}
        footerLabel={plural(rows.length)}
        empty={
          <EmptyState
            title={`No payments in ${name}`}
            actions={
              <Button variant="secondary" onClick={() => setRecording(true)}>
                Record a payment
              </Button>
            }
          >
            No payment was received that month. Voided payments are not listed.
          </EmptyState>
        }
        mobileRow={r => (
          <div className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 font-card [overflow-wrap:anywhere]">{r.company ?? 'Customer'}</span>
              <Money value={r.amount} strong />
            </div>
            <OrderLink r={r} />
            <span className="text-sm text-fg-2">
              Received <time dateTime={r.receivedOn} className="num">{day(r.receivedOn)}</time> · {viaWord(r.paidVia)}
              {r.reference ? <span className="num"> · {r.reference}</span> : null}
            </span>
          </div>
        )}
      />
      {q.isSuccess && rows.length > 0 ? (
        <p role="status" className="text-sm text-fg-2" data-testid="payments-count">
          {plural(sum.count)} in {name}, PKR {formatAmount(sum.total, 'never')} with GST. Voided payments are not listed.
        </p>
      ) : null}
      <RecordPaymentFlow open={recording} onOpenChange={setRecording} />
    </MoneyFrame>
  )
}

function OrderLink({ r }: { r: ReceivedPayment }) {
  if (!r.orderId || r.orderNumber === null) return null
  const ref = orderRef(r.orderNumber)
  return (
    <Link to={`/orders/${r.orderId}`} className="num justify-self-start text-sm font-card text-primary underline underline-offset-2" aria-label={`Open ${ref}`} onClick={e => e.stopPropagation()}>
      {ref}
    </Link>
  )
}

function CustomerCell({ r }: { r: ReceivedPayment }) {
  return (
    <span className="grid gap-px">
      <span className="min-w-0 font-card [overflow-wrap:anywhere]">{r.company ?? 'Customer'}</span>
      <OrderLink r={r} />
    </span>
  )
}

function ViaCell({ r }: { r: ReceivedPayment }) {
  return (
    <span className="grid gap-px">
      <span>{viaWord(r.paidVia)}</span>
      {r.reference ? <span className="num text-xs text-fg-muted [overflow-wrap:anywhere]">{r.reference}</span> : null}
    </span>
  )
}
