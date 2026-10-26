import { useState, type ReactNode } from 'react'
import { Icon } from '@/ui/Icon'
import { Ban, Banknote, CalendarDays, CircleCheck, ClipboardCheck, CopyPlus, FileText, MapPin, MessageSquareWarning, Package, Phone, Plus, RotateCcw, Scale, Trash2, Truck, Wrench, type LucideIcon } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatAmount } from '@/lib/money'
import { formatDay, formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DetailHeader } from '@/ui/DetailHeader'
import { InfoTip } from '@/ui/InfoTip'
import { MessageActions } from '@/ui/MessageActions'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { MenuItem, MenuSeparator } from '@/ui/Popover'
import { MoreMenu } from '@/ui/MoreMenu'
import { Skeleton } from '@/ui/Skeleton'
import { NextStepBox } from '@/ui/NextStepBox'
import { StatusBadge } from '@/ui/StatusBadge'
import { StatusText } from '@/ui/StatusText'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { useToast } from '@/ui/useToast'
import { CreateInvoiceButton, RecordPaymentButton } from '@/features/money/OrderMoneyButtons'
import { InvoicePdfButton } from '@/features/money/invoices/pdf/InvoicePdfButton'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow, OrderMoney, PersonRow } from '@/features/orders/api'
import { useCancelOrder, useUpdateOrder } from '@/features/orders/hooks'
import { useDeleteOrderFlow } from '@/features/orders/deleteFlow'
import { useEntryAccess } from '@/features/records/useEntryAccess'
import { LastChanged } from '@/features/history/LastChanged'
import { useHistoryPanel } from '@/features/history/useHistoryPanel'
import { useInFlight } from '@/lib/useInFlight'
import { useCompanyProfile } from '@/features/settings/hooks'
import { termsLabel } from '@/features/settings/companyProfile'
import { TapDate, TapText } from '@/features/orders/TapEdit'
import { useMarkDone, useSetPlanned } from '@/features/orders/commissioningActions'
import { ResolveBasisDialog } from '@/features/orders/ResolveBasisDialog'
import { CopyReminderButton } from '@/features/orders/CopyReminderButton'
import { legState } from '@/features/orders/lib/legModel'
import { orderFacts, pageStep, recordPaymentPlace, type PrimaryAction } from '@/features/orders/lib/primaryAction'
import type { OrderStep } from '@/features/orders/lib/orderSteps'
import { useLegActions } from '@/features/orders/useLegActions'
import { useSentPos } from '@/features/purchaseOrders/hooks'
import { cancellationMessage, sentPoSentence } from '@/features/purchaseOrders/lib/cancelText'
import { copyToClipboard } from '@/lib/clipboard'
import { COMPANY_NAME } from '@/features/rfqs/lib/chaseCommon'
import { CANCEL_REASONS, cancelReasonLabel, type CancelReason } from '@/features/orders/lib/cancel'
import { lazyDialog, lazyShown } from '@/lib/lazyDialog'

// Downloaded the first time it opens, not with the order page (perf/lcp, lazyDialog.tsx).
const CommissioningEditDialog = lazyShown(() => import('@/features/orders/CommissioningPanel').then(m => m.CommissioningEditDialog))
const IssuePoDialog = lazyShown(() => import('@/features/purchaseOrders/IssuePoDialog').then(m => m.IssuePoDialog))
const GoodsChaseDialog = lazyShown(() => import('@/features/orders/GoodsChaseDialog').then(m => m.GoodsChaseDialog))
const AddLegDialog = lazyShown(() => import('@/features/orders/AddDialogs').then(m => m.AddLegDialog))
const NewOrderDialog = lazyShown(() => import('@/features/orders/NewOrderDialog').then(m => m.NewOrderDialog))
// Record payment from the More menu: its form library (react-hook-form) is not on the order page's first download.
const RecordPaymentDialog = lazyDialog(() => import('@/features/money/payments/RecordPaymentDialog').then(m => m.RecordPaymentDialog))

/*
 * The top of the order page (O03; g2-order-detail.html), reworked by the UX audit of 2026-10-19 (screens.md 8): who it is for, then ONE
 * next step with the page's only primary (green) button, then a short status strip. The step comes from lib/orderSteps.ts, the same
 * ordering as the orders list's "Next step" column; lib/primaryAction.ts turns it into this page's button and sentence.
 *
 * The title follows the shared DetailHeader (round-2 spec 5.3): the customer's name (a link) and the order number in the h1, at most
 * one chip under it (Done or Cancelled; an active order has none), the meta line, the More menu, then the NextStepBox. Estimated
 * dates (imported orders) are a dashed underline on the ordered date with an InfoTip, not a chip.
 *
 * The strip has one cell per dimension (Goods, Commissioning; for admin and sales Invoicing and Payment; for admin Costs), each a
 * status text (icon and word, no box) and one short line. What the "Invoices and payments" panel used to say (invoiced, received, balance, due date) now lives in the
 * Invoicing and Payment cells, with "Create invoice" (admin and sales) and "Record payment" (admin) beside the figure they change.
 * When either is the next step it is the green button above instead, never both. The ... menu holds Cancel order / Reopen order.
 *
 * The step is only shown once the supplier orders (and for admin and sales their POs and the balance) have loaded, so the green button
 * never jumps from a wrong guess to the right one; the page passes `next: null` until then (a quiet placeholder), and when they fail.
 *
 * An engineer gets the same Next step band (its button: Delivered today; Mark done today once the planned date has come), then their
 * job: the site, its contact, the planned date ("Change planned date"), the goods, and "Mark done today" as a secondary button before that.
 * No price, invoice, payment or cost is read or drawn for them.
 */

export interface NextForPage {
  step: OrderStep
  primary: PrimaryAction | null
  text: string
}

function Cell({ title, icon, children, action }: { title: string; icon: LucideIcon; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start justify-items-start gap-2 px-4 py-3 md:px-5 md:py-4">
      <h2 className="flex items-center gap-[6px] text-sm text-fg-muted">
        <Icon icon={icon} size="sm" />
        {title}
      </h2>
      {children}
      {action}
    </div>
  )
}

/** "1 of 2 not ordered yet · 1 late": the supplier orders that supply goods, in a few words (the goods status words, src/lib/status.ts). */
function goodsLine(legs: readonly OrderLegRow[], today: string): string {
  if (legs.length === 0) return 'No supplier orders'
  const states = legs.map(l => legState({ placedOn: l.placedOn, expectedOn: l.expectedOn, receivedOn: l.receivedOn, deliveredOn: l.deliveredOn }, today))
  const count = (s: string) => states.filter(x => x === s).length
  const parts: string[] = []
  if (count('to-place')) parts.push(`${count('to-place')} of ${legs.length} not ordered yet`)
  if (count('late')) parts.push(`${count('late')} late`)
  if (count('on-order')) parts.push(`${count('on-order')} ordered`)
  if (count('received') + count('delivered')) parts.push(`${count('received') + count('delivered')} delivered`)
  return parts.join(' · ')
}

/**
 * The Costs cell's line (admin): "Costs 1,268,000 of 6,350,000 expected"; once more is paid out than expected, "Costs 1,480,000
 * (expected 640,000) · over by 840,000" in the warning colour (UX audit P6), never "Paid out 1,480,000 of 640,000".
 */
function CostsLine({ actual, expected }: { actual: number; expected: number | null }) {
  if (expected !== null && actual > expected) {
    return (
      <p className="text-sm font-medium text-tone-warning-fg" data-testid="order-costs">
        Costs <span className="num">{formatAmount(actual)}</span> (expected <span className="num">{formatAmount(expected)}</span>) · over by{' '}
        <span className="num">{formatAmount(actual - expected)}</span>
      </p>
    )
  }
  return (
    <p className="text-sm text-fg-2" data-testid="order-costs">
      {actual > 0 ? (
        <>
          Costs <span className="num">{formatAmount(actual)}</span>
        </>
      ) : (
        'No costs yet'
      )}
      {expected !== null ? (
        <>
          {actual > 0 ? ' of ' : ' · '}
          <span className="num">{formatAmount(expected)}</span> expected
        </>
      ) : null}
    </p>
  )
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
  next: nextProp,
}: {
  order: OrderHeader
  legs: readonly OrderLegRow[]
  items: readonly OrderItemRow[]
  engineers: readonly PersonRow[]
  role: string
  orderMoney: OrderMoney | null | undefined
  moneyLoading?: boolean
  pos?: readonly LegPo[]
  /** The page's next step, worked out by the page once everything it needs has loaded; null until then (or when it failed to load). */
  next?: NextForPage | null
}) {
  const { toast } = useToast()
  const today = businessToday()
  const isEngineer = role === 'engineer'
  const isAdmin = role === 'admin'
  const money = role === 'admin' || role === 'sales'
  const profileQ = useCompanyProfile()
  const termsText = termsLabel(order.paymentTermsDays, profileQ.data?.default_payment_terms_days)
  const update = useUpdateOrder(order.id)
  const entry = useEntryAccess({ createdBy: order.createdBy ?? null, ownerId: order.owner?.id ?? null })
  const [resolving, setResolving] = useState(false)
  const s = order.state
  const cancelled = order.cancelledOn !== null
  const ref = orderRef(order.number)
  const basisUnknown = s?.dataTrust === 'basis_unknown'
  const m = orderMoney
  const gross = s?.gross ?? null
  const invoiced = s?.invoiced ?? null
  // Only supplier orders that supply a goods line count, as v_order_state counts them.
  const goodsLegs = legs.filter(l => items.some(i => i.legId === l.id && !i.isService))
  // Done, but the customer still owes (admin and sales know the balance; an engineer's "Done" is about their job).
  const owing = money && !cancelled && s?.lifecycle === 'done' && (m?.balance ?? 0) > 0

  const next = nextProp === undefined ? pageStep(orderFacts(order, legs, items, pos, role, orderMoney, today)) : nextProp
  const primary = next?.primary ?? null
  const paymentPlace = recordPaymentPlace(order, orderMoney, primary?.kind, role)

  const commissioningLine =
    s?.commissioning === 'n_a' || !order.needsCommissioning
      ? 'None on this order'
      : order.doneOn
        ? `Done ${formatShortDate(order.doneOn, today)}`
        : order.plannedOn
          ? `Planned ${formatShortDate(order.plannedOn, today)}${engineers.length ? ` · ${engineers.map(e => e.name).join(', ')}` : ''}`
          : 'Needs a date'

  const cols = isAdmin ? 'lg:grid-cols-5' : 'lg:grid-cols-4'

  const estimated = s?.dataTrust === 'estimated_dates'
  const orderedText = order.orderedOn ? `Ordered ${formatShortDate(order.orderedOn, today)}` : null
  const customerPo = (
    <span>
      Customer PO{' '}
      <TapText
        value={order.customerPo}
        label="Customer PO number"
        empty="add"
        placeholder="Not yet received"
        disabled={isEngineer || cancelled || !entry.can}
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
  )
  // Estimated dates (an imported order) are a dashed underline with an InfoTip, not a chip (consistency spec 1.4, trust:estimated).
  const ordered = estimated ? (
    <>
      <span data-testid="order-dates-estimated" className="underline decoration-dashed decoration-fg-muted underline-offset-4">
        {orderedText ?? 'Dates estimated'}
      </span>
      <InfoTip label="About these dates">
        The old CRM did not record exact dates for this order, so its dates are estimates. Change any of them if you know the real one.
      </InfoTip>
    </>
  ) : order.imported && orderedText ? (
    `${orderedText}, imported from the old CRM`
  ) : (
    (orderedText ?? (order.imported ? 'Imported from the old CRM' : null))
  )

  return (
    // data-slot="order-actions": every order-level action (the next step, Create invoice, Record payment) is inside this block, once.
    // The <header> (DetailHeader) is the title block only: who, the code, at most the Done/Cancelled chip, the meta line. The next step
    // and the state strip are the page's first content under it (screen audit: at most 2 chips in a page header).
    <div data-slot="order-actions">
      <DetailHeader
        name={order.companyName}
        nameHref={`/companies/${order.companyId}`}
        code={ref}
        breadcrumb={[{ label: 'Orders', to: '/orders' }, { label: ref, mono: true }]}
        more={!isEngineer ? <OrderMoreMenu order={order} recordPayment={paymentPlace === 'menu'} /> : undefined}
        // an active order needs no chip: only Done or Cancelled is news. Never "Done" while the customer still owes (UX audit P1): an
        // order that is done but not paid shows its payment word ("Waiting for payment", "Overdue") instead.
        chips={
          owing ? (
            <StatusBadge dimension="payment" value={m?.paymentState ?? 'unpaid'} />
          ) : s?.lifecycle && s.lifecycle !== 'active' ? (
            <StatusBadge dimension="order" value={s.lifecycle} />
          ) : undefined
        }
        meta={[
          order.site && !isEngineer ? order.site.name : null,
          customerPo,
          ordered,
          order.owner ? `Owner ${order.owner.name}` : null,
          money ? <span data-testid="order-terms">{termsText}</span> : null,
        ]}
      />
      {cancelled ? (
        <Banner tone="warning" title={`Cancelled ${order.cancelledOn ? formatDay(order.cancelledOn) : ''}`} className="mt-4">
          {cancelReasonLabel(order.cancelReason) ? `${cancelReasonLabel(order.cancelReason)}. ` : ''}Nothing on this order can be changed while it is cancelled.
        </Banner>
      ) : null}
      {isEngineer ? null : <LastChanged table="orders" id={order.id} className="mt-3 text-base text-fg-2" />}
      {!entry.can && !isEngineer && !cancelled && entry.note ? (
        <p className="mt-3 text-base text-fg-2" role="note" data-slot="not-yours">
          {`The customer PO number is closed. ${entry.note}.`}
        </p>
      ) : null}

        {/* An unknown price basis is asked even on a cancelled order (its invoices and payments still need the net split): the admin's
            button is the green next step on a live order, and a plain button here on a cancelled one. */}
        {basisUnknown && !isEngineer ? (
          <Banner
            tone="warning"
            title="Is GST included in these prices?"
            className="mt-4"
            action={
              isAdmin && cancelled ? (
                <Button icon={Scale} onClick={() => setResolving(true)}>
                  Is GST included?
                </Button>
              ) : undefined
            }
          >
            The old CRM did not say. Until someone answers, this order is left out of margin, GST totals and the net cash that counts towards targets. Its payments still count in gross cash.
          </Banner>
        ) : null}

        {!cancelled ? <NextStep order={order} next={next} legs={legs} engineers={engineers} orderMoney={orderMoney} onResolve={() => setResolving(true)} /> : null}
        {isEngineer ? <EngineerJob order={order} engineers={engineers} next={next} goodsLegs={goodsLegs} today={today} /> : null}

        {isEngineer ? null : (
          <div
            className={`mt-4 grid grid-cols-2 max-[399px]:grid-cols-1 max-[399px]:[&>*:last-child:nth-child(odd)]:col-span-1 rounded border bg-surface lg:divide-x ${cols} [&>*]:border-b [&>*]:border-line lg:[&>*]:border-b-0 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1`}
            role="group"
            aria-label="State of this order"
          >
            <Cell title="Goods" icon={Package}>
              {s?.goods && s.goods !== 'n_a' ? <StatusText dimension="goods" value={s.goods} /> : null}
              <p className="text-sm text-fg-2">{goodsLine(goodsLegs, today)}</p>
            </Cell>
            <Cell title="Commissioning" icon={Wrench}>
              {/* no 'n/a' chip: the line says there is none */}
              {s?.commissioning && s.commissioning !== 'n_a' ? <StatusText dimension="commissioning" value={s.commissioning} /> : null}
              <p className="text-sm text-fg-2">{commissioningLine}</p>
            </Cell>
            {money ? (
              <Cell
                title="Invoicing"
                icon={FileText}
                action={
                  <div className="flex flex-wrap gap-2">
                    {(invoiced ?? 0) > 0 ? <InvoicePdfButton orderId={order.id} size="sm" /> : null}
                    {!cancelled && primary?.kind !== 'create-invoice' && s?.invoicing !== 'fully_invoiced' ? <CreateInvoiceButton orderId={order.id} size="sm" /> : null}
                  </div>
                }
              >
                {s?.invoicing ? <StatusText dimension="invoicing" value={s.invoicing} /> : null}
                <p className="text-sm text-fg-2" data-testid="order-invoiced">
                  {gross === null ? null : (invoiced ?? 0) <= 0 ? (
                    <>
                      PKR <span className="num">{formatAmount(gross)}</span> to invoice
                    </>
                  ) : (invoiced ?? 0) >= gross ? (
                    <>
                      Invoiced <span className="num">{formatAmount(invoiced ?? 0)}</span>
                    </>
                  ) : (
                    <>
                      Invoiced <span className="num">{formatAmount(invoiced ?? 0)}</span> of <span className="num">{formatAmount(gross)}</span>
                    </>
                  )}
                </p>
              </Cell>
            ) : null}
            {money ? (
              <Cell
                title="Payment"
                icon={Banknote}
                // only once an invoice exists and while something is owed (UX audit P2): never on an order not yet invoiced, nor on a paid one
                action={paymentPlace === 'cell' ? <RecordPaymentButton orderId={order.id} size="sm" /> : null}
              >
                {m ? <StatusText dimension="payment" value={m.paymentState} /> : null}
                {moneyLoading ? (
                  <Skeleton className="h-4 w-32" />
                ) : !m ? (
                  <p className="text-sm text-fg-muted">The balance did not load. Reload to try again.</p>
                ) : (
                  <p className="grid gap-px text-sm text-fg-2">
                    {m.settled > 0 ? (
                      <span>
                        Received <span className="num">{formatAmount(m.settled)}</span>
                      </span>
                    ) : (
                      <span data-testid="payments-empty">Nothing received yet</span>
                    )}
                    <span>
                      Balance <b className="num font-medium text-fg" data-testid="order-balance">{formatAmount(m.balance)}</b>
                      {/* one danger mark per cell: the Overdue line above carries it */}
                      {m.dueOn && m.balance > 0 ? <span> · due {formatShortDate(m.dueOn, today)}</span> : null}
                    </span>
                    {/* HW-50: more received than the gross is said, not hidden under "Paid": a refund or a credit may be due */}
                    {(m.overpaidBy ?? 0) > 0 ? (
                      <span className="font-medium text-tone-warning-fg" data-testid="order-overpaid">
                        Overpaid by PKR <span className="num">{formatAmount(m.overpaidBy ?? 0)}</span>
                      </span>
                    ) : null}
                  </p>
                )}
              </Cell>
            ) : null}
            {isAdmin ? (
              <Cell title="Costs" icon={ClipboardCheck}>
                {m?.costsState ? <StatusText dimension="costs" value={m.costsState} /> : null}
                {m ? <CostsLine actual={m.actualCost ?? 0} expected={m.expectedCost} /> : null}
              </Cell>
            ) : null}
          </div>
        )}

      {resolving ? <ResolveBasisDialog order={order} items={items} money={orderMoney} onClose={() => setResolving(false)} /> : null}
    </div>
  )
}

/**
 * The order's "More" menu (the shared MoreMenu): Cancel order (with a reason, and Undo) or Reopen order. A "More" text button beside
 * the title from tablet up, and an icon in the phone's one bar (useMobileBar) below 768. Engineers have none.
 */
export function OrderMoreMenu({ order, touch = false, recordPayment = false }: { order: OrderHeader; touch?: boolean; /** Admin: Record payment lives here before an invoice (an advance) or once paid. */ recordPayment?: boolean }) {
  const { toast } = useToast()
  const cancel = useCancelOrder(order.id)
  const once = useInFlight() // HW-15: one cancel / reopen per press, however many clicks
  const [cancelling, setCancelling] = useState(false)
  const [paying, setPaying] = useState(false)
  const cancelled = order.cancelledOn !== null
  const ref = orderRef(order.number)
  const today = businessToday()
  const del = useDeleteOrderFlow({ id: order.id, number: order.number, companyName: order.companyName })
  const history = useHistoryPanel({ table: 'orders', id: order.id, context: `${ref} · ${order.companyName}`, imported: order.imported })

  const reopen = () =>
    once(async () => {
      if (order.cancelledOn === null) return
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
    })

  return (
    <>
      <MoreMenu touch={touch} label="More actions">
          {history.item}
          {recordPayment ? (
            <MenuItem icon={Banknote} onClick={() => setPaying(true)}>
              Record payment
            </MenuItem>
          ) : null}
          {cancelled ? (
            <MenuItem icon={RotateCcw} onClick={() => void reopen()}>
              Reopen order
            </MenuItem>
          ) : (
            <MenuItem icon={Ban} danger onClick={() => setCancelling(true)}>
              Cancel order
            </MenuItem>
          )}
          {del.ask ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onClick={del.ask}>
                Delete order
              </MenuItem>
            </>
          ) : null}
      </MoreMenu>
      {del.node}
      {history.node}
      {recordPayment ? <RecordPaymentDialog open={paying} onOpenChange={setPaying} orderId={order.id} /> : null}
      {cancelling ? (
        <CancelDialog
          order={order}
          busy={cancel.isPending}
          onClose={() => setCancelling(false)}
          onConfirm={reason =>
            once(async () => {
              // idempotent: an order already cancelled (a second press that slipped through) is not written again
              if (order.cancelledOn !== null) return setCancelling(false)
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
            })
          }
        />
      ) : null}
    </>
  )
}

/**
 * Where the page's one primary button sits: in place on a laptop; on a phone (below 768) in the shared StickyActionBar fixed to the
 * bottom of the screen, so the next step is always one tap away. The page hides the bottom tabs while it shows (useMobileBar hideTabs)
 * and leaves room for it. Drawn in one place only, so the button's dialog is never mounted twice.
 */
function PrimaryPlacement({ children }: { children: ReactNode }) {
  const phone = useMediaQuery('(max-width: 767px)')
  if (!phone) return <>{children}</>
  return <StickyActionBar label="Order actions" primary={children} />
}

/**
 * The next step and the page's one primary button (admin and sales). The supplier-order steps act on that supplier order directly
 * (Issue PO opens its dialog; Chase goods its message; Mark placed and Delivered today stamp it, with Undo); the same step stays on the
 * supplier order's own row as a secondary button. With no button for this person, the sentence says what the order is waiting for.
 */
function NextStep({
  order,
  next,
  legs,
  engineers,
  orderMoney,
  onResolve,
}: {
  order: OrderHeader
  next: NextForPage | null
  legs: readonly OrderLegRow[]
  engineers: readonly PersonRow[]
  orderMoney: OrderMoney | null | undefined
  onResolve: () => void
}) {
  if (!next) return <NextStepBox loading />
  const { primary, step, text } = next
  return (
    <NextStepBox
      text={text}
      tone={step.tone === 'late' ? 'late' : primary ? 'action' : 'quiet'}
      action={
        primary ? (
          <PrimaryPlacement>
            <PrimaryButton order={order} action={primary} legs={legs} engineers={engineers} orderMoney={orderMoney} onResolve={onResolve} />
          </PrimaryPlacement>
        ) : null
      }
    />
  )
}

function PrimaryButton({
  order,
  action,
  legs,
  engineers,
  orderMoney,
  onResolve,
}: {
  order: OrderHeader
  action: PrimaryAction
  legs: readonly OrderLegRow[]
  engineers?: readonly PersonRow[]
  orderMoney?: OrderMoney | null
  onResolve?: () => void
}) {
  const leg = action.legId ? legs.find(l => l.id === action.legId) : undefined
  const legActions = useLegActions(order, leg)
  const markDone = useMarkDone(order)
  const [open, setOpen] = useState(false)
  const cls = 'max-sm:w-full'
  // a supplier-order step names its supplier for assistive tech, as the same button on the supplier order's row does
  const aria = action.supplierName ? `${action.label}, ${action.supplierName}` : undefined
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
    case 'copy-reminder':
      return <CopyReminderButton order={order} money={orderMoney} className={cls} />
    case 'mark-done':
      return (
        <Button variant="primary" icon={CircleCheck} className={cls} onClick={markDone.run} busy={markDone.pending} busyLabel="Saving">
          {action.label}
        </Button>
      )
    case 'add-supplier':
      return (
        <>
          <Button variant="primary" icon={Plus} className={cls} onClick={() => setOpen(true)}>
            {action.label}
          </Button>
          {open ? <AddLegDialog order={order} legs={legs} onClose={() => setOpen(false)} /> : null}
        </>
      )
    case 'plan-commissioning':
      return (
        <>
          <Button variant="primary" icon={CalendarDays} className={cls} onClick={() => setOpen(true)}>
            {action.label}
          </Button>
          {open ? <CommissioningEditDialog order={order} engineers={engineers ?? []} onClose={() => setOpen(false)} /> : null}
        </>
      )
    case 'issue-po':
      return leg ? (
        <>
          <Button variant="primary" icon={FileText} className={cls} onClick={() => setOpen(true)} aria-label={aria}>
            {action.label}
          </Button>
          {open ? <IssuePoDialog order={order} leg={leg} onClose={() => setOpen(false)} /> : null}
        </>
      ) : null
    case 'chase-goods':
      return leg ? (
        <>
          <Button variant="primary" icon={MessageSquareWarning} className={cls} onClick={() => setOpen(true)} aria-label={aria}>
            {action.label}
          </Button>
          {open ? <GoodsChaseDialog order={order} leg={leg} onClose={() => setOpen(false)} /> : null}
        </>
      ) : null
    case 'repeat-order':
      return (
        <>
          <Button variant="primary" icon={CopyPlus} className={cls} onClick={() => setOpen(true)}>
            {action.label}
          </Button>
          {open ? <NewOrderDialog sourceId={order.id} onClose={() => setOpen(false)} /> : null}
        </>
      )
    case 'mark-placed':
    case 'deliver':
      return leg && legActions.stamp ? (
        <Button variant="primary" icon={Truck} className={cls} onClick={legActions.doStamp} busy={legActions.pending} busyLabel="Saving" aria-label={`${legActions.stamp.label}, ${leg.supplierName}`}>
          {legActions.stamp.label}
        </Button>
      ) : null
  }
}

/**
 * The engineer's page leads with their job: where, who to call, when, the goods, and the one green button of the step (Delivered today;
 * Mark done today once the planned date has come). Before that date "Mark done today" is still one tap, as a secondary button.
 */
function EngineerJob({
  order,
  engineers,
  next,
  goodsLegs,
  today,
}: {
  order: OrderHeader
  engineers: readonly PersonRow[]
  next: NextForPage | null
  goodsLegs: readonly OrderLegRow[]
  today: string
}) {
  const setPlanned = useSetPlanned(order)
  const markDone = useMarkDone(order)
  const cancelled = order.cancelledOn !== null
  const open = order.needsCommissioning && !order.doneOn && !cancelled
  const primary = next?.primary ?? null
  const phone = order.contact?.phone ?? null
  return (
    <section aria-label="Your job" className="mt-4 grid gap-3 rounded-panel border border-line-strong bg-surface px-4 py-4 md:px-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-6">
        <div className="grid min-w-0 content-start gap-1">
          <span className="flex items-center gap-[6px] text-sm text-fg-muted">
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
          <span className="flex items-center gap-[6px] text-sm text-fg-muted">
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
        <div className="grid min-w-0 content-start justify-items-start gap-1">
          <span className="flex items-center gap-[6px] text-sm text-fg-muted">
            <Icon icon={Package} size="sm" /> Goods
          </span>
          {order.state?.goods && order.state.goods !== 'n_a' ? <StatusText dimension="goods" value={order.state.goods} /> : null}
          <span className="text-sm text-fg-2">{goodsLine(goodsLegs, today)}</span>
        </div>
      </div>
      {/* The step and its green button are in the Next step band above, as on the admin's and sales' page (UX audit P7). */}
      {next && open ? (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          {/* before the planned date "Mark done today" is still one tap, just not the page's green button */}
          {open && primary?.kind !== 'mark-done' ? (
            <Button icon={CircleCheck} onClick={markDone.run} busy={markDone.pending} busyLabel="Saving">
              Mark done today
            </Button>
          ) : null}
          {open ? <TapDate value={order.plannedOn} label="Planned date" today={today} onSave={setPlanned} button={{ text: 'Change planned date', icon: CalendarDays }} /> : null}
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
  onConfirm: (reason: CancelReason) => Promise<unknown>
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
            <Button variant="danger" busy={busy} busyLabel="Cancelling" disabled={!reason} onClick={() => (reason ? onConfirm(reason) : undefined)}>
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
                  <MessageActions
                    size="sm"
                    to={po.contact ?? { name: po.supplierName }}
                    text={cancellationMessage(po, COMPANY_NAME)}
                    email={{ subject: `${po.ref} cancelled` }}
                    copy={{
                      label: 'Copy cancellation message',
                      onCopy: async () => {
                        const ok = await copyToClipboard(cancellationMessage(po, COMPANY_NAME))
                        toast(ok ? { title: 'Cancellation message copied', body: `For ${po.supplierName}, ${po.ref}.` } : { title: 'Could not copy the message', body: 'Nothing was changed.', tone: 'danger' })
                      },
                    }}
                  />
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
