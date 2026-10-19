import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/ui/Icon'
import { Ban, Banknote, CalendarDays, CircleCheck, ClipboardCheck, Copy, Ellipsis, FileText, MapPin, Package, Phone, RotateCcw, Scale, Wrench, type LucideIcon } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatAmount } from '@/lib/money'
import { formatDay, formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Breadcrumb } from '@/ui/Breadcrumb'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { CreateInvoiceButton, RecordPaymentButton } from '@/features/money/OrderMoneyButtons'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow, OrderMoney, PersonRow } from '@/features/orders/api'
import { useCancelOrder, useUpdateOrder } from '@/features/orders/hooks'
import { useCompanyProfile } from '@/features/settings/hooks'
import { termsLabel } from '@/features/settings/companyProfile'
import { TapDate, TapText } from '@/features/orders/TapEdit'
import { useMarkDone, useSetPlanned } from '@/features/orders/commissioningActions'
import { ResolveBasisDialog } from '@/features/orders/ResolveBasisDialog'
import { legState } from '@/features/orders/lib/legModel'
import { orderPrimary, waitingText, type PrimaryAction } from '@/features/orders/lib/primaryAction'
import { useLegActions } from '@/features/orders/useLegActions'
import { IssuePoDialog } from '@/features/purchaseOrders/IssuePoDialog'
import { useSentPos } from '@/features/purchaseOrders/hooks'
import { cancellationMessage, sentPoSentence } from '@/features/purchaseOrders/lib/cancelText'
import { copyToClipboard } from '@/lib/clipboard'
import { COMPANY_NAME } from '@/features/rfqs/lib'
import { CANCEL_REASONS, cancelReasonLabel, type CancelReason } from '@/features/orders/lib/cancel'

/*
 * The top of the order page (O03; g2-order-detail.html), reworked by the UX audit of 2026-10-19 (screens.md 8): who it is for, then ONE
 * next step with the page's only primary (green) button, chosen by the order's state (lib/primaryAction.ts), then a short status strip.
 *
 * The strip has one cell per dimension (Goods, Commissioning; for admin and sales Invoicing and Payment; for admin Costs), each a chip
 * and one short line. What the "Invoices and payments" panel used to say (invoiced, received, balance, due date) now lives in the
 * Invoicing and Payment cells, with "Create invoice" (admin and sales) and "Record payment" (admin) beside the figure they change.
 * When either is the next step it is the green button above instead, never both. The ... menu holds Cancel order / Reopen order.
 *
 * An engineer's page leads with their job: the site, its contact, the planned date ("Change planned date") and "Mark done today" (1 tap,
 * nothing typed). No price, invoice, payment or cost is read or drawn for them.
 */

function Cell({ title, icon, children, action }: { title: string; icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start justify-items-start gap-2 px-4 py-3 md:px-5 md:py-4">
      <h2 className="flex items-center gap-1.5 text-sm text-fg-muted">
        <Icon icon={icon} size="sm" />
        {title}
      </h2>
      {children}
      {action}
    </div>
  )
}

/** "1 of 2 not placed · 1 late": the supplier orders in a few words. */
function goodsLine(legs: readonly OrderLegRow[], today: string): string {
  if (legs.length === 0) return 'No supplier orders'
  const states = legs.map(l => legState({ placedOn: l.placedOn, expectedOn: l.expectedOn, receivedOn: l.receivedOn, deliveredOn: l.deliveredOn }, today))
  const count = (s: string) => states.filter(x => x === s).length
  const parts: string[] = []
  if (count('to-place')) parts.push(`${count('to-place')} of ${legs.length} not placed`)
  if (count('late')) parts.push(`${count('late')} late`)
  if (count('on-order')) parts.push(`${count('on-order')} on order`)
  if (count('received') + count('delivered')) parts.push(`${count('received') + count('delivered')} delivered`)
  return parts.join(' · ')
}

export function OrderHeaderBlock({
  order,
  legs,
  items,
  engineers,
  role,
  orderMoney,
  moneyLoading = false,
  pos = [],
  primary: primaryProp,
}: {
  order: OrderHeader
  legs: readonly OrderLegRow[]
  items: readonly OrderItemRow[]
  engineers: readonly PersonRow[]
  role: string
  orderMoney: OrderMoney | null | undefined
  moneyLoading?: boolean
  pos?: readonly LegPo[]
  /** The page's one primary step, when the page worked it out already (orderPrimary). */
  primary?: PrimaryAction | null
}) {
  const { toast } = useToast()
  const today = businessToday()
  const isEngineer = role === 'engineer'
  const isAdmin = role === 'admin'
  const money = role === 'admin' || role === 'sales'
  const profileQ = useCompanyProfile()
  const termsText = termsLabel(order.paymentTermsDays, profileQ.data?.default_payment_terms_days)
  const update = useUpdateOrder(order.id)
  const cancel = useCancelOrder(order.id)
  const [cancelling, setCancelling] = useState(false)
  const [resolving, setResolving] = useState(false)
  const s = order.state
  const cancelled = order.cancelledOn !== null
  const ref = orderRef(order.number)
  const basisUnknown = s?.dataTrust === 'basis_unknown'
  const m = orderMoney
  const gross = s?.gross ?? null
  const invoiced = s?.invoiced ?? null

  const primary = primaryProp === undefined ? orderPrimary(order, legs, pos, role, orderMoney, today) : primaryProp

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
            await cancel.mutateAsync(before)
          },
          settledTitle: 'Order reopened',
          undoneTitle: 'Cancelled again',
        },
      })
    } catch (err) {
      toast({ title: 'Could not reopen', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
    }
  }

  const commissioningLine =
    s?.commissioning === 'n_a' || !order.needsCommissioning
      ? 'None on this order'
      : order.doneOn
        ? `Done ${formatShortDate(order.doneOn, today)}`
        : order.plannedOn
          ? `Planned ${formatShortDate(order.plannedOn, today)}${engineers.length ? ` · ${engineers.map(e => e.name).join(', ')}` : ''}`
          : 'Needs a date'

  const cols = isAdmin ? 'lg:grid-cols-5' : money ? 'lg:grid-cols-4' : 'lg:grid-cols-2'

  return (
    // data-slot="order-actions": every order-level action (the next step, Create invoice, Record payment) is inside the header, once.
    <header data-slot="order-actions">
      <Breadcrumb className="max-md:hidden" items={[{ label: 'Orders', to: '/orders' }, { label: ref, mono: true }]} />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl font-semibold tracking-snug">
            <Link to={`/companies/${order.companyId}`} className="min-w-0 break-words hover:underline">
              {order.companyName}
            </Link>
            <span className="num text-lg font-regular text-fg-2">{ref}</span>
            {/* an active order needs no chip: only Done or Cancelled is news */}
            {s?.lifecycle && s.lifecycle !== 'active' ? <StatusBadge dimension="order" value={s.lifecycle} /> : null}
            {s && s.dataTrust && s.dataTrust !== 'ok' ? <StatusBadge dimension="trust" value={s.dataTrust} /> : null}
          </h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-2">
            {order.site && !isEngineer ? <span>{order.site.name}</span> : null}
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
            {order.orderedOn ? <span>Ordered {formatShortDate(order.orderedOn, today)}</span> : null}
            {order.owner ? <span>Owner {order.owner.name}</span> : null}
            {money ? <span data-testid="order-terms">{termsText}</span> : null}
            {order.imported ? <span className="text-fg-muted">Imported from the old CRM</span> : null}
          </p>
        </div>
        {!isEngineer ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button icon={Ellipsis} variant="quiet" aria-label="More actions" />
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

      {cancelled ? (
        <Banner tone="warning" title={`Cancelled ${order.cancelledOn ? formatDay(order.cancelledOn) : ''}`} className="mt-4">
          {cancelReasonLabel(order.cancelReason) ? `${cancelReasonLabel(order.cancelReason)}. ` : ''}Nothing on this order can be changed while it is cancelled.
        </Banner>
      ) : null}

      {basisUnknown && !cancelled ? (
        <Banner tone="warning" title="Is GST included in these prices?" className="mt-4">
          The old CRM did not say. Until someone answers, this order is left out of margin, GST totals and the net cash that counts towards targets. Its payments still count in gross cash.
        </Banner>
      ) : null}

      {isEngineer ? (
        <EngineerJob order={order} engineers={engineers} primary={primary} legs={legs} today={today} />
      ) : !cancelled ? (
        <NextStep order={order} primary={primary} legs={legs} onResolve={() => setResolving(true)} waiting={waitingText({ legs, needsCommissioning: order.needsCommissioning, plannedOn: order.plannedOn, doneOn: order.doneOn, invoicing: s?.invoicing ?? null, balance: m?.balance ?? null, role })} />
      ) : null}

      <div className={`mt-4 grid grid-cols-2 rounded border bg-surface lg:divide-x ${cols} [&>*]:border-b [&>*]:border-line lg:[&>*]:border-b-0 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1`} aria-label="State of this order">
        <Cell title="Goods" icon={Package}>
          {s?.goods ? <StatusBadge dimension="goods" value={s.goods} /> : null}
          <p className="text-sm text-fg-2">{goodsLine(legs, today)}</p>
        </Cell>
        <Cell title="Commissioning" icon={Wrench}>
          {s?.commissioning ? <StatusBadge dimension="commissioning" value={s.commissioning} /> : null}
          <p className="text-sm text-fg-2">{commissioningLine}</p>
        </Cell>
        {money ? (
          <Cell
            title="Invoicing"
            icon={FileText}
            action={!cancelled && primary?.kind !== 'create-invoice' && s?.invoicing !== 'fully_invoiced' ? <CreateInvoiceButton orderId={order.id} size="sm" /> : null}
          >
            {s?.invoicing ? <StatusBadge dimension="invoicing" value={s.invoicing} /> : null}
            <p className="num text-sm text-fg-2" data-testid="order-invoiced">
              {gross === null
                ? ''
                : (invoiced ?? 0) <= 0
                  ? `PKR ${formatAmount(gross)} to invoice`
                  : (invoiced ?? 0) >= gross
                    ? `Invoiced ${formatAmount(invoiced ?? 0)}`
                    : `Invoiced ${formatAmount(invoiced ?? 0)} of ${formatAmount(gross)}`}
            </p>
          </Cell>
        ) : null}
        {money ? (
          <Cell title="Payment" icon={Banknote} action={isAdmin && !cancelled && primary?.kind !== 'record-payment' ? <RecordPaymentButton orderId={order.id} size="sm" /> : null}>
            {m ? <StatusBadge dimension="payment" value={m.paymentState} /> : null}
            {moneyLoading ? (
              <Skeleton className="h-4 w-32" />
            ) : !m ? (
              <p className="text-sm text-fg-muted">The balance did not load. Reload to try again.</p>
            ) : (
              <p className="num grid gap-px text-sm text-fg-2">
                {m.settled > 0 ? (
                  <span>Received {formatAmount(m.settled)}</span>
                ) : (
                  <span data-testid="payments-empty" className="font-sans">
                    Nothing received yet
                  </span>
                )}
                <span>
                  Balance <b className="font-medium text-fg" data-testid="order-balance">{formatAmount(m.balance)}</b>
                  {m.dueOn && m.balance > 0 ? <span className={cn(m.paymentState === 'overdue' && 'text-tone-danger-fg')}> · due {formatShortDate(m.dueOn, today)}</span> : null}
                </span>
              </p>
            )}
          </Cell>
        ) : null}
        {isAdmin ? (
          <Cell title="Costs" icon={ClipboardCheck}>
            {m?.costsState ? <StatusBadge dimension="costs" value={m.costsState} /> : null}
            <p className="num text-sm text-fg-2">
              {m ? `Paid out ${formatAmount(m.actualCost ?? 0)}${m.expectedCost !== null ? ` of ${formatAmount(m.expectedCost)}` : ''}` : ''}
            </p>
          </Cell>
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
                    await cancel.mutateAsync(before)
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

/**
 * The next step and the page's one primary button (admin and sales). The supplier-order steps act on that supplier order directly
 * (Issue PO opens its dialog; Mark placed and Delivered today stamp it, with Undo); the same step stays on the supplier order's own row as
 * a secondary button. With nothing to do, one quiet sentence says what the order is waiting for.
 */
function NextStep({ order, primary, legs, onResolve, waiting }: { order: OrderHeader; primary: PrimaryAction | null; legs: readonly OrderLegRow[]; onResolve: () => void; waiting: string }) {
  return (
    <section aria-label="Next step" className={cn('mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded border px-4 py-3 md:px-5', primary ? 'border-line-strong bg-surface' : 'bg-sunken')}>
      <p className="min-w-0 text-base">
        <span className="mr-2 text-sm text-fg-muted">Next step</span>
        <span className={cn('font-medium', primary?.late && 'text-tone-danger-fg', !primary && 'font-regular text-fg-2')}>{primary ? primary.why : waiting}</span>
      </p>
      {primary ? <PrimaryButton order={order} action={primary} legs={legs} onResolve={onResolve} /> : null}
    </section>
  )
}

function PrimaryButton({ order, action, legs, onResolve }: { order: OrderHeader; action: PrimaryAction; legs: readonly OrderLegRow[]; onResolve?: () => void }) {
  const leg = action.legId ? legs.find(l => l.id === action.legId) : undefined
  const legActions = useLegActions(order, leg)
  const markDone = useMarkDone(order)
  const [issuing, setIssuing] = useState(false)
  const cls = 'max-sm:w-full'
  switch (action.kind) {
    case 'resolve-basis':
      return (
        <Button variant="primary" icon={Scale} className={cls} onClick={onResolve}>
          {action.label}
        </Button>
      )
    case 'create-invoice':
      return <CreateInvoiceButton orderId={order.id} variant="primary" className={cls} />
    case 'record-payment':
      return <RecordPaymentButton orderId={order.id} variant="primary" className={cls} />
    case 'mark-done':
      return (
        <Button variant="primary" icon={CircleCheck} className={cls} onClick={() => void markDone.run()} busy={markDone.pending} busyLabel="Saving">
          {action.label}
        </Button>
      )
    case 'issue-po':
      return leg ? (
        <>
          <Button variant="primary" icon={FileText} className={cls} onClick={() => setIssuing(true)}>
            {action.label}
          </Button>
          {issuing ? <IssuePoDialog order={order} leg={leg} onClose={() => setIssuing(false)} /> : null}
        </>
      ) : null
    case 'mark-placed':
    case 'deliver':
      return leg && legActions.stamp ? (
        <Button variant="primary" className={cls} onClick={legActions.doStamp} busy={legActions.pending} busyLabel="Saving">
          {legActions.stamp.label}
        </Button>
      ) : null
  }
}

/** The engineer's page leads with their job: where, who to call, when, and the one tap that closes it. */
function EngineerJob({ order, engineers, primary, legs, today }: { order: OrderHeader; engineers: readonly PersonRow[]; primary: PrimaryAction | null; legs: readonly OrderLegRow[]; today: string }) {
  const setPlanned = useSetPlanned(order)
  const cancelled = order.cancelledOn !== null
  const showDate = order.needsCommissioning && !order.doneOn && !cancelled
  const phone = order.contact?.phone ?? null
  return (
    <section aria-label="Your job" className="mt-4 grid gap-3 rounded border border-line-strong bg-surface px-4 py-4 md:px-5">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:gap-6">
        <div className="grid min-w-0 content-start gap-1">
          <span className="flex items-center gap-1.5 text-sm text-fg-muted">
            <Icon icon={MapPin} size="sm" /> Site
          </span>
          <span className="font-medium">{order.site?.name ?? <span className="font-regular text-fg-muted">Not set</span>}</span>
          {order.site?.address ? <span className="text-sm text-fg-2">{order.site.address}</span> : null}
          {order.contact ? (
            <span className="flex flex-wrap items-center gap-x-2 text-sm text-fg-2">
              {order.contact.name}
              {phone ? (
                <a href={`tel:${phone.replace(/\s+/g, '')}`} className="num inline-flex min-h-6 items-center gap-1 text-primary hover:underline">
                  <Icon icon={Phone} size="sm" />
                  {phone}
                </a>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="grid min-w-0 content-start gap-1">
          <span className="flex items-center gap-1.5 text-sm text-fg-muted">
            <Icon icon={Wrench} size="sm" /> Commissioning
          </span>
          {order.needsCommissioning ? (
            <>
              <span className="font-medium">{order.doneOn ? `Done ${formatShortDate(order.doneOn, today)}` : order.plannedOn ? `Planned ${formatDay(order.plannedOn)}` : 'No date yet'}</span>
              {engineers.length ? <span className="text-sm text-fg-2">With {engineers.map(e => e.name).join(' and ')}</span> : null}
            </>
          ) : (
            <span className="text-fg-2">None on this order. Supply only.</span>
          )}
        </div>
      </div>
      {primary || showDate ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {primary ? (
            <>
              {primary.kind === 'deliver' ? <span className={cn('mr-2 text-sm', primary.late ? 'font-medium text-tone-danger-fg' : 'text-fg-2')}>{primary.why}</span> : null}
              <PrimaryButton order={order} action={primary} legs={legs} />
            </>
          ) : null}
          {showDate ? <TapDate value={order.plannedOn} label="Planned date" today={today} onSave={setPlanned} button={{ text: 'Change planned date', icon: CalendarDays }} /> : null}
        </div>
      ) : null}
    </section>
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
  const { toast } = useToast()
  const sent = useSentPos(order.id, true).data ?? []
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
          {sent.length > 0 ? (
            <ul aria-label="Purchase orders already sent" data-testid="cancel-sent-pos" className="grid gap-3 rounded border border-tone-warning-fg/25 bg-tone-warning-bg p-3 text-sm text-tone-warning-fg">
              {sent.map(po => (
                <li key={po.ref} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{sentPoSentence(po)}</span>
                  <Button
                    size="sm"
                    icon={Copy}
                    onClick={async () => {
                      const ok = await copyToClipboard(cancellationMessage(po, COMPANY_NAME))
                      toast(ok ? { title: 'Cancellation message copied', body: `For ${po.supplierName}, ${po.ref}.` } : { title: 'Could not copy the message', body: 'Nothing was changed.', tone: 'danger' })
                    }}
                  >
                    Copy cancellation message
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
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
