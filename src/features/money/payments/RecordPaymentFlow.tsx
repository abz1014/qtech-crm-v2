import { useMemo, useState } from 'react'
import { Banknote, ChevronRight } from 'lucide-react'
import { orderRef } from '@/lib/refs'
import { businessToday } from '@/lib/dates'
import { lazyDialog } from '@/lib/lazyDialog'
import { matchesAllWords } from '@/lib/useQueryParamText'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { StatusText } from '@/ui/StatusText'
import { TableFilter } from '@/ui/TableFilter'
import { useReceivables } from '@/features/money/payments/hooks'
import { filterReceivables, isInvoiced, receivableNextStep, receivableSearchText, sortReceivables, type ReceivableRow } from '@/features/money/payments/model'

const RecordPaymentDialog = lazyDialog(() => import('@/features/money/payments/RecordPaymentDialog').then(m => m.RecordPaymentDialog))

/*
 * Record payment with no order yet (F-287, F-642; 52-payments.html#pick, owner decision 13 Nov 2026): + Create > Payment received,
 * and Record payment on Money > Payments, first ask "Which order?", then open today's Record payment form, unchanged. The list is
 * the open orders of To collect (invoiced, not invoiced yet and imported), in To collect's order, one tap each; paid orders are not
 * listed. Search narrows by customer, order number or invoice number (the same words as Search balances). Admin only: the callers
 * draw it for an admin, and the form itself is admin only. From an order (To collect's panel, the job page, a ?pay=1&order= link)
 * the picker is skipped.
 */
export function RecordPaymentFlow({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [orderId, setOrderId] = useState<string | null>(null)
  const close = () => {
    setOrderId(null)
    onOpenChange(false)
  }
  return (
    <>
      <WhichOrderDialog
        open={open && orderId === null}
        onOpenChange={o => (o ? undefined : close())}
        onPick={setOrderId}
      />
      <RecordPaymentDialog open={open && orderId !== null} orderId={orderId} onOpenChange={o => (o ? undefined : close())} />
    </>
  )
}

export function WhichOrderDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (orderId: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        icon={Banknote}
        title="Which order?"
        context="Record payment, step 1 of 2"
        size="md"
        footer={
          <Button data-cancel onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        }
      >
        {open ? <OrderList onPick={onPick} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function OrderList({ onPick }: { onPick: (orderId: string) => void }) {
  const q = useReceivables()
  const [search, setSearch] = useState('')
  const today = businessToday()
  const open = useMemo(() => sortReceivables(filterReceivables(q.data ?? [], 'open')), [q.data])
  const shown = useMemo(() => open.filter(r => matchesAllWords(receivableSearchText(r), search)), [open, search])

  if (q.isError)
    return (
      <EmptyState mood="error" title="The open orders did not load" actions={<Button onClick={() => void q.refetch()}>Try again</Button>}>
        Nothing was recorded. Try again, and if it keeps failing, tell the admin.
      </EmptyState>
    )
  if (q.isPending)
    return (
      <div className="grid gap-3" aria-busy="true" aria-label="Loading the open orders">
        <Skeleton className="h-control w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  if (open.length === 0)
    return (
      <EmptyState mood="goal" title="No open orders">
        Every order is paid. There is nothing to record.
      </EmptyState>
    )
  return (
    <div className="grid gap-3">
      <p className="text-base text-fg-2">Pick the order the money is for. The next step is the Record payment form.</p>
      <TableFilter label="Search open orders" hint="Finds an order by customer, order number or invoice number." value={search} onChange={setSearch} className="sm:w-full" />
      <h3 className="text-sm font-card text-fg-2">Open orders, most overdue first</h3>
      {shown.length === 0 ? (
        <p className="text-base text-fg-2" role="status">
          No open order matches “{search.trim()}”.
        </p>
      ) : (
        <ul aria-label="Open orders" className="grid gap-2">
          {shown.map(r => (
            <li key={r.orderId}>
              <OrderButton r={r} today={today} onPick={onPick} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function OrderButton({ r, today, onPick }: { r: ReceivableRow; today: string; onPick: (orderId: string) => void }) {
  const s = receivableNextStep(r, today)
  return (
    <button
      type="button"
      onClick={() => onPick(r.orderId)}
      className="flex w-full min-w-0 items-center gap-3 rounded-card border bg-surface px-4 py-3 text-left shadow-e1 transition-colors duration-fast ease-out hover:border-line-strong hover:bg-sunken"
    >
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
          <span className="min-w-0 font-card [overflow-wrap:anywhere]">{r.companyName}</span>
          <Money value={r.balance} strong />
        </span>
        <span className="num text-sm text-fg-2">
          <span className="whitespace-nowrap">{orderRef(r.orderNumber)}</span>
          {isInvoiced(r) ? ` · ${r.invoiceNumbers.join(', ')}` : ' · not invoiced yet'}
        </span>
        <StatusText tone={s.tone} detail={s.detail}>
          {s.label}
        </StatusText>
      </span>
      <Icon icon={ChevronRight} className="shrink-0 text-fg-muted" />
    </button>
  )
}
