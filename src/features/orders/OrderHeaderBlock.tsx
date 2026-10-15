import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, CalendarDays, CircleCheck, Ellipsis, Receipt, RotateCcw, Scale } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatAmount } from '@/lib/money'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { CreateInvoiceButton, RecordPaymentButton } from '@/features/money/OrderMoneyButtons'
import type { OrderHeader, OrderItemRow, OrderLegRow, OrderMoney, PersonRow } from '@/features/orders/api'
import { useCancelOrder, useUpdateOrder } from '@/features/orders/hooks'
import { TapDate, TapText } from '@/features/orders/TapEdit'
import { useMarkDone, useSetPlanned } from '@/features/orders/commissioningActions'
import { ResolveBasisDialog } from '@/features/orders/ResolveBasisDialog'
import { legState } from '@/features/orders/lib/legModel'
import { CANCEL_REASONS, cancelReasonLabel, type CancelReason } from '@/features/orders/lib/cancel'

/*
 * The top of the order page (O03; g2-order-detail.html): who it is for, where it stands (one chip per dimension from v_order_state and,
 * for admin and sales, the money views) and the actions that belong to the whole order.
 *
 * Admin and sales get the menu (Cancel order) and the money actions. An engineer gets the two commissioning actions: "Mark done today"
 * (1 tap, nothing typed) and "Change planned date" (optional). Five chips for admin (Goods, Commissioning, Invoicing, Payment, Costs),
 * four for sales (no Costs), two for an engineer.
 *
 * TRACKED GAPS: "Record payment" (M02), "Add expense" (M03) and "Create invoice" (M01) are drawn in the data-slot="order-actions" place
 * the mockup gives them, disabled and naming the task that wires them.
 */

function Dim({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 content-start justify-items-start gap-2 px-5 py-4">
      <h2 className="text-sm text-fg-muted">{title}</h2>
      {children}
    </div>
  )
}

function goodsSentence(legs: readonly OrderLegRow[], today: string): string {
  if (legs.length === 0) return 'No supplier legs on this order.'
  const states = legs.map(l => legState({ placedOn: l.placedOn, expectedOn: l.expectedOn, receivedOn: l.receivedOn, deliveredOn: l.deliveredOn }, today))
  const count = (s: string) => states.filter(x => x === s).length
  const parts: string[] = []
  if (count('to-place')) parts.push(`${count('to-place')} of ${legs.length} ${legs.length === 1 ? 'leg' : 'legs'} not ordered yet`)
  if (count('received')) parts.push(`${count('received')} received`)
  if (count('delivered')) parts.push(`${count('delivered')} delivered`)
  if (count('late')) parts.push(`${count('late')} late`)
  if (count('on-order')) parts.push(`${count('on-order')} on order`)
  const text = parts.join(', ')
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

export function OrderHeaderBlock({
  order,
  legs,
  items,
  engineers,
  role,
  orderMoney,
}: {
  order: OrderHeader
  legs: readonly OrderLegRow[]
  items: readonly OrderItemRow[]
  engineers: readonly PersonRow[]
  role: string
  orderMoney: OrderMoney | null | undefined
}) {
  const { toast } = useToast()
  const today = businessToday()
  const isEngineer = role === 'engineer'
  const isAdmin = role === 'admin'
  const money = role === 'admin' || role === 'sales'
  const update = useUpdateOrder(order.id)
  const cancel = useCancelOrder(order.id)
  const markDone = useMarkDone(order)
  const setPlanned = useSetPlanned(order)
  const [cancelling, setCancelling] = useState(false)
  const [resolving, setResolving] = useState(false)
  const s = order.state
  const cancelled = order.cancelledOn !== null
  const ref = orderRef(order.number)
  const showDone = order.needsCommissioning && !order.doneOn && !cancelled
  const basisUnknown = s?.dataTrust === 'basis_unknown'

  const reopen = async () => {
    const before = { cancelled_on: order.cancelledOn, cancel_reason: order.cancelReason }
    try {
      // the reason goes with the date: the database refuses a reason on an active order
      await cancel.mutateAsync({ cancelled_on: null, cancel_reason: null })
      toast({
        title: 'Order reopened',
        body: ref,
        undo: {
          onUndo: async () => {
            try {
              await cancel.mutateAsync(before)
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
          },
          settledTitle: 'Order reopened',
          undoneTitle: 'Cancelled again',
        },
      })
    } catch (err) {
      toast({ title: 'Could not reopen', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
    }
  }

  const goodsDetail = goodsSentence(legs, today)
  const commissioningDetail =
    s?.commissioning === 'n_a'
      ? 'No commissioning on this order.'
      : s?.commissioning === 'done'
        ? `Done ${order.doneOn ? formatDay(order.doneOn) : ''}.`
        : s?.commissioning === 'planned'
          ? `Planned ${order.plannedOn ? formatDay(order.plannedOn) : ''}${engineers.length ? ` with ${engineers.map(e => e.name).join(' and ')}` : ''}.`
          : 'Needs a planned date.'
  const invoicingDetail =
    s?.invoicing === 'not_invoiced'
      ? `Nothing invoiced yet.${s.gross !== null ? ` PKR ${formatAmount(s.gross)} gross to invoice.` : ''}`
      : s?.gross !== null && s?.gross !== undefined
        ? `Invoiced against PKR ${formatAmount(s.gross)} gross.`
        : ''
  const m = orderMoney
  const paymentDetail = !m
    ? ''
    : m.settled <= 0
      ? `Nothing received yet. PKR ${formatAmount(m.grossTarget)} to collect.`
      : `PKR ${formatAmount(m.settled)} of ${formatAmount(m.grossTarget)} received.`
  const costsDetail = !m
    ? ''
    : `PKR ${formatAmount(m.actualCost ?? 0)} paid out${m.expectedCost !== null ? ` of ${formatAmount(m.expectedCost)} expected` : ''}.${m.costsState === 'complete' ? '' : ' Not marked complete.'}`

  const cols = isAdmin ? 'lg:grid-cols-5' : money ? 'lg:grid-cols-4' : 'lg:grid-cols-2'

  return (
    <header>
      <Breadcrumb items={[{ label: 'Orders', to: '/orders' }, { label: ref, mono: true }]} />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-x-3 text-2xl font-semibold tracking-snug">
            <Link to={`/companies/${order.companyId}`} className="min-w-0 break-words hover:underline">
              {order.companyName}
            </Link>
            <span className="num text-lg text-fg-2">{ref}</span>
            {s?.lifecycle ? <StatusBadge dimension="order" value={s.lifecycle} /> : null}
            {s && s.dataTrust && s.dataTrust !== 'ok' ? <StatusBadge dimension="trust" value={s.dataTrust} /> : null}
            {order.imported ? <span className="text-sm font-regular text-fg-muted">Imported from the old CRM</span> : null}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-2">
            {order.site ? <span>{order.site.name}</span> : null}
            <span>
              Customer PO{' '}
              <TapText
                value={order.customerPo}
                label="Customer PO number"
                empty="add"
                placeholder="Not yet received"
                disabled={isEngineer || cancelled}
                render={v => <span className="num">{v}</span>}
                onSave={async v => {
                  try {
                    await update.mutateAsync({ customer_po_number: v })
                  } catch (err) {
                    toast({ title: 'Could not save the PO number', body: mapPgError(err, { entity: 'PO number' }).message, tone: 'danger' })
                  }
                }}
              />
            </span>
            {order.orderedOn ? <span>Ordered {formatDay(order.orderedOn)}</span> : null}
            {order.owner ? <span>Owner {order.owner.name}</span> : null}
            {money ? <span>{order.paymentTermsDays !== null ? `Terms ${order.paymentTermsDays} days from invoice` : 'Terms not set'}</span> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* data-slot="order-actions": Record payment (M02), Add expense (M03), Create invoice (M01). Record payment (M02) and Create invoice (M01) open their own dialogs; Add expense is still disabled until its task. */}
          <span data-slot="order-actions" className="contents">
            {isAdmin && !cancelled ? (
              <>
                <RecordPaymentButton orderId={order.id} />
                <Button icon={Receipt} disabled title="Arrives with Expenses (M03)">
                  Add expense
                </Button>
              </>
            ) : null}
            {money && !cancelled ? (
              <CreateInvoiceButton orderId={order.id} />
            ) : null}
            {isAdmin && basisUnknown ? (
              <Button variant="primary" icon={Scale} onClick={() => setResolving(true)}>
                Resolve price basis
              </Button>
            ) : null}
          </span>
          {isEngineer && showDone ? (
            <>
              <Button variant="primary" icon={CircleCheck} onClick={() => void markDone.run()} busy={markDone.pending} busyLabel="Saving">
                Mark done today
              </Button>
              <TapDate value={order.plannedOn} label="Planned date" today={today} onSave={setPlanned} button={{ text: 'Change planned date', icon: CalendarDays }} />
            </>
          ) : null}
          {!isEngineer ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button icon={Ellipsis} aria-label="More actions" />
              </PopoverTrigger>
              <PopoverContent variant="menu" align="end">
                {cancelled ? (
                  <MenuItem icon={RotateCcw} onClick={() => void reopen()}>
                    Reopen order
                  </MenuItem>
                ) : (
                  <MenuItem icon={Ban} danger onClick={() => setCancelling(true)}>
                    Cancel order
                  </MenuItem>
                )}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>
      </div>

      {cancelled ? (
        <Banner tone="warning" title={`Cancelled ${order.cancelledOn ? formatDay(order.cancelledOn) : ''}`} className="mt-4">
          {cancelReasonLabel(order.cancelReason) ? `${cancelReasonLabel(order.cancelReason)}. ` : ''}Nothing on this order can be changed while it is cancelled.
        </Banner>
      ) : null}

      {basisUnknown ? (
        <Banner tone="warning" title="Price basis unknown" className="mt-4">
          The old CRM did not record whether these prices include GST. Until you choose, this order is left out of margin, GST totals and the net cash that counts towards targets. Its payments still count in gross cash.
        </Banner>
      ) : null}

      <div className={`mt-4 grid divide-y rounded border bg-surface sm:grid-cols-2 sm:divide-y-0 lg:divide-x ${cols} [&>*]:border-line`} aria-label="State of this order">
        <Dim title="Goods">
          {s?.goods ? <StatusBadge dimension="goods" value={s.goods} /> : null}
          <p className="text-sm text-fg-2">{goodsDetail}</p>
        </Dim>
        <Dim title="Commissioning">
          {s?.commissioning ? <StatusBadge dimension="commissioning" value={s.commissioning} /> : null}
          <p className="text-sm text-fg-2">{commissioningDetail}</p>
        </Dim>
        {money ? (
          <Dim title="Invoicing">
            {s?.invoicing ? <StatusBadge dimension="invoicing" value={s.invoicing} /> : null}
            <p className="text-sm text-fg-2">{invoicingDetail}</p>
          </Dim>
        ) : null}
        {money ? (
          <Dim title="Payment">
            {m ? <StatusBadge dimension="payment" value={m.paymentState} /> : null}
            <p className="text-sm text-fg-2">{paymentDetail}</p>
          </Dim>
        ) : null}
        {isAdmin ? (
          <Dim title="Costs">
            {m?.costsState ? <StatusBadge dimension="costs" value={m.costsState} /> : null}
            <p className="text-sm text-fg-2">{costsDetail}</p>
          </Dim>
        ) : null}
      </div>

      {cancelling ? (
        <CancelDialog
          order={order}
          busy={cancel.isPending}
          onClose={() => setCancelling(false)}
          onConfirm={async reason => {
            const before = { cancelled_on: order.cancelledOn, cancel_reason: order.cancelReason }
            try {
              await cancel.mutateAsync({ cancelled_on: today, cancel_reason: reason })
              setCancelling(false)
              toast({
                title: 'Order cancelled',
                body: ref,
                undo: {
                  onUndo: async () => {
                    try {
                      await cancel.mutateAsync(before)
                    } catch (err) {
                      toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
                    }
                  },
                  settledTitle: 'Order cancelled',
                  undoneTitle: 'Order is active again',
                },
              })
            } catch (err) {
              toast({ title: 'Could not cancel the order', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
            }
          }}
        />
      ) : null}
      {resolving ? <ResolveBasisDialog order={order} items={items} money={orderMoney} onClose={() => setResolving(false)} /> : null}
    </header>
  )
}

function CancelDialog({
  order,
  busy,
  onClose,
  onConfirm,
}: {
  order: OrderHeader
  busy: boolean
  onClose: () => void
  onConfirm: (reason: CancelReason) => void | Promise<void>
}) {
  const [reason, setReason] = useState<CancelReason | null>(null)
  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        size="sm"
        tone="danger"
        icon={Ban}
        title="Cancel this order"
        context={`${orderRef(order.number)} · ${order.companyName}`}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Keep the order
            </Button>
            <Button variant="danger" busy={busy} busyLabel="Cancelling" disabled={!reason} onClick={() => reason && void onConfirm(reason)}>
              Cancel order
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-fg-muted">The order stays on record and can be reopened. Reports use the reason.</p>
          <RadioGroup aria-label="Reason" value={reason ?? ''} onValueChange={v => setReason(v as CancelReason)} className="gap-2">
            {CANCEL_REASONS.map(r => (
              <Radio key={r.value} value={r.value} label={r.label} />
            ))}
          </RadioGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}
