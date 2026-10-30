import { useMemo, useState } from 'react'
import { ChevronDown, Ellipsis, FileText, MessageSquareWarning, Plus, Receipt, RefreshCw, Split, Trash2, TriangleAlert, Truck } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { convertToPaisa, formatAmount, formatPaisa } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef, poRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { EmptyState } from '@/ui/EmptyState'
import { MenuItem, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { StatusBadge } from '@/ui/StatusBadge'
import { useFxLatest } from '@/features/rfqs/hooks'
import { toRateTable } from '@/features/rfqs/lib/comparePrices'
import { LastChanged } from '@/features/history/LastChanged'
import { useHistoryPanel } from '@/features/history/useHistoryPanel'
import { DeletePoRevisionConfirm } from '@/features/purchaseOrders/DeleteRevision'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { isFreshSplitLeg, splitRfqItemIds } from '@/features/orders/lib/splitGroups'
import { poChange } from '@/features/orders/lib/poChange'
import { defaultExpected, legLetter, legState, legSupplierTotal, type LegDates } from '@/features/orders/lib/legModel'
import { useLegActions } from '@/features/orders/useLegActions'
import { useSetLegCancelled } from '@/features/orders/hooks'
import { useToast } from '@/ui/useToast'
import { mapPgError } from '@/lib/pgErrors'
import { lazyDialog, lazyShown } from '@/lib/lazyDialog'
import { useOrderCosts } from '@/features/money/costs/hooks'
import { estimateExpectedCost, stillOwedOnLeg } from '@/features/money/lib/costEstimate'
import { useOpenPoPdf } from '@/features/purchaseOrders/useOpenPoPdf'
import { TapDate, TapText } from '@/features/orders/TapEdit'

// Downloaded the first time it opens, not with the order page (perf/lcp, lazyDialog.tsx).
const IssuePoDialog = lazyShown(() => import('@/features/purchaseOrders/IssuePoDialog').then(m => m.IssuePoDialog))
const GoodsChaseDialog = lazyShown(() => import('@/features/orders/GoodsChaseDialog').then(m => m.GoodsChaseDialog))
const AddLegDialog = lazyShown(() => import('@/features/orders/AddDialogs').then(m => m.AddLegDialog))

// Downloaded the first time it opens (perf/lcp, lazyDialog.tsx).
// Pay <supplier> (redesign phase 1): the one door for a supplier payment, in the supplier's currency with bank charges apart.
const PayDialog = lazyDialog(() => import('@/features/money/expenses/PayDialog').then(m => m.PayDialog))

/*
 * Supplier orders (O03; g2-order-detail.html "Procurement legs"; called "legs" in the database and the code, "supplier orders" on screen
 * since the plain-words decision of 2026-10-19). One supplier in one currency each.
 *
 * FE-2 / A3 (owner decision 2026-10-15: no receiving step): each has ONE next-step button, Mark placed and then Delivered today. One tap
 * each, nothing typed, Undo in the toast. Delivering also sets the stored received date to the same day. The dates read as one line of
 * text that edits on tap (optional). When placed, the expected date is suggested from the placed date plus the supplier's lead time.
 *
 * The page has one green button (the order header's next step, lib/primaryAction.ts); here every button is secondary. Visible on the row:
 * the stamp, "Issue PO" while there is no PO and the goods are neither delivered nor invoiced (admin and sales: a PO carries prices;
 * "Mark placed, no PO" is then in the menu; once delivered or invoiced, Issue PO moves into the menu) and "Chase
 * goods" once the goods are late. The rest is in the row's menu: View PO, Revise PO, Chase goods (before they are late) and Pay <supplier> (admin; the M03 dialog with this supplier as
 * the payee and Supplier payment as the category: the one Add expense per supplier order).
 */
export type LegsPart = 'all' | 'order' | 'delivery'

const STATE_DIM: Record<string, string> = { 'to-place': 'to-place', 'on-order': 'on-order', late: 'late', received: 'received', delivered: 'delivered' }

export function LegsPanel({
  order,
  legs,
  items,
  pos,
  money,
  isAdmin,
  canEdit,
  part = 'all',
}: {
  order: OrderHeader
  legs: readonly OrderLegRow[]
  items: readonly OrderItemRow[]
  pos: readonly LegPo[]
  money: boolean
  isAdmin: boolean
  canEdit: boolean
  /**
   * Which actions this panel carries. The order page draws 'all'. The job page splits them over two stages (P5-D2): 'order' is
   * choosing and placing (Add supplier, Mark placed, Issue and Revise PO, Pay supplier), 'delivery' is the goods coming in
   * (Delivered today, Chase goods, the dates). "Delivered today" is on exactly one of the two, never both.
   */
  part?: LegsPart
}) {
  const fx = useFxLatest()
  const rates = useMemo(() => toRateTable(fx.data ?? []), [fx.data])
  // Admin only (the Margin panel reads the same query, so this is no extra request): what is still owed on each supplier order, the
  // amount Pay supplier starts at (entry-burden J14).
  const costs = useOrderCosts(order.id, isAdmin)
  const owedByLeg = useMemo(() => {
    const out = new Map<string, { amount: number; note: string }>()
    if (!costs.data) return out
    const estRates = Object.fromEntries((fx.data ?? []).map(r => [r.currency, { rate: r.ratePkr, ageDays: r.ageDays }]))
    const est = estimateExpectedCost({ items: costs.data.items, legs: costs.data.legs, pos: costs.data.pos, rates: estRates })
    for (const l of legs) {
      const paid = costs.data.expenses.filter(e => e.legId === l.id).reduce((n, e) => n + e.amount, 0)
      const owed = stillOwedOnLeg(est, l.id, paid)
      if (owed) out.set(l.id, owed)
    }
    return out
  }, [costs.data, fx.data, legs])
  const [chasing, setChasing] = useState<OrderLegRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [issuing, setIssuing] = useState<OrderLegRow | null>(null)
  const poPdf = useOpenPoPdf(order.id)
  const today = businessToday()
  const imported = order.imported

  return (
    <section aria-label={part === 'delivery' ? 'Deliveries' : 'Supplier orders'} className="min-w-0 rounded-panel border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3 md:px-5">
        <h2 className="text-base font-semibold">{part === 'delivery' ? 'Deliveries' : 'Supplier orders'}</h2>
        <InfoTip label="About supplier orders">One supplier's part of this order: their PO, when it was placed, received and delivered.</InfoTip>
        <span className="text-sm text-fg-muted">{legs.length === 0 ? (imported ? 'None recorded for imported orders' : 'None yet') : legs.length === 1 ? '1 supplier' : `${legs.length} suppliers`}</span>
        {/* data-slot="add-leg": adds a supplier by hand. */}
        <span data-slot="add-leg" className="ml-auto contents">
          {money && canEdit && part !== 'delivery' ? (
            <Button icon={Plus} size="sm" className="ml-auto" onClick={() => setAdding(true)}>
              Add supplier
            </Button>
          ) : null}
        </span>
      </div>
      {legs.length === 0 ? (
        <EmptyState title="No supplier orders yet">
          {imported ? 'Imported orders arrive without suppliers. Add a supplier only if you need to track a reorder.' : 'Lines with a supplier appear here, one per supplier. A service has none.'}
        </EmptyState>
      ) : (
        <ul className="divide-y">
          {legs.map((leg, i) => (
            <Leg
              key={leg.id}
              order={order}
              leg={leg}
              letter={legLetter(i)}
              items={items.filter(it => it.legId === leg.id)}
              fromSplit={isFreshSplitLeg(items.filter(it => it.legId === leg.id), splitRfqItemIds(items), pos.some(p => p.legId === leg.id), leg.placedOn !== null)}
              po={pos.find(p => p.legId === leg.id)}
              money={money}
              isAdmin={isAdmin}
              canEdit={canEdit}
              rates={rates}
              owed={owedByLeg.get(leg.id)}
              today={today}
              collapsible={legs.length > 1}
              part={part}
              onChase={() => setChasing(leg)}
              onIssue={() => setIssuing(leg)}
              onViewPo={() => void poPdf.open(leg.id)}
              viewingPo={poPdf.busyLeg === leg.id}
            />
          ))}
        </ul>
      )}
      {chasing ? <GoodsChaseDialog order={order} leg={legs.find(l => l.id === chasing.id) ?? chasing} onClose={() => setChasing(null)} /> : null}
      {adding ? <AddLegDialog order={order} legs={legs} onClose={() => setAdding(false)} /> : null}
      {issuing ? <IssuePoDialog order={order} leg={legs.find(l => l.id === issuing.id) ?? issuing} onClose={() => setIssuing(null)} /> : null}
    </section>
  )
}

function Leg({
  order,
  leg,
  letter,
  items,
  fromSplit,
  po,
  money,
  isAdmin,
  canEdit,
  rates,
  owed,
  today,
  onChase,
  onIssue,
  onViewPo,
  viewingPo,
  collapsible,
  part,
}: {
  order: OrderHeader
  leg: OrderLegRow
  /** Only for the test ids (leg-A, leg-B): the letters are no longer shown. */
  letter: string
  items: OrderItemRow[]
  /** A8: a new supplier order that exists for the parts of split items. */
  fromSplit: boolean
  po: LegPo | undefined
  money: boolean
  isAdmin: boolean
  canEdit: boolean
  rates: ReturnType<typeof toRateTable>
  /** Admin: what is still owed to this supplier, Pay supplier's starting amount. */
  owed?: { amount: number; note: string }
  today: string
  onChase: () => void
  onIssue: () => void
  onViewPo: () => void
  viewingPo: boolean
  /** With two or more suppliers, one already delivered when the page opened folds to one line (UX audit P9). */
  collapsible: boolean
  part: LegsPart
}) {
  const actions = useLegActions(order, leg)
  // Folded only if it was delivered when the page opened: stamping "Delivered today" keeps the row open, with its dates, for the Undo.
  const [folded, setFolded] = useState(() => collapsible && leg.deliveredOn !== null)
  const [addingExpense, setAddingExpense] = useState(false)
  const setCancelled = useSetLegCancelled(order.id)
  const { toast } = useToast()
  const cancelledWithSupplier = leg.cancelledWithSupplierOn ?? null
  const toggleCancelled = () =>
    setCancelled.mutate(
      { id: leg.id, cancelled: cancelledWithSupplier === null },
      {
        onSuccess: () => toast({ title: cancelledWithSupplier === null ? 'Cancelled with the supplier' : 'Live with the supplier again', body: leg.supplierName }),
        onError: err => toast({ title: 'Could not save', body: mapPgError(err, { entity: 'supplier order' }).message, tone: 'danger' }),
      },
    )
  const dates: LegDates = { placedOn: leg.placedOn, expectedOn: leg.expectedOn, receivedOn: leg.receivedOn, deliveredOn: leg.deliveredOn }
  const state = legState(dates, today)
  const stamp = actions.stamp
  /** The default expected date (lead time, else this supplier's usual days, else 30). Dated from today until the order is placed. */
  const suggestion = defaultExpected(leg.placedOn ?? today, leg.leadTimes, actions.medianDays)
  const total = legSupplierTotal(items.map(it => ({ qty: it.qty, supplierUnitPrice: it.supplierUnitPrice, isService: it.isService })))
  const ccy = leg.currency
  const rate = ccy && ccy !== 'PKR' ? rates[ccy] : undefined
  const pkr = rate && rate.staleness !== 'unusable' && total.priced > 0 ? convertToPaisa(total.total, rate.rate) : null
  const name = leg.supplierName
  const [deletingPo, setDeletingPo] = useState(false)
  const poHistory = useHistoryPanel({ table: 'purchase_orders', id: po?.id ?? '', context: po ? `${poRef(po.number, po.firstIssuedOn)} · R${po.revision} · ${name}` : name })
  /** A8 (O09): the latest PO revision lists lines this supplier order no longer matches (a split moved quantity). Admin and sales only: a PO carries prices. */
  const changed = money && po ? poChange(po.lines, items.map(it => ({ id: it.id, description: it.description, qty: it.qty, isService: it.isService }))) : null
  const canChase = Boolean(leg.placedOn && !leg.deliveredOn && leg.expectedOn)
  const late = state === 'late'

  const lines = items.map(it => `${it.description} ×${it.qty}`).join(', ')
  const date = (label: string, field: keyof LegDates, hint?: string) => (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <span className="text-fg-muted">{label}</span>
      <TapDate value={dates[field]} label={`${label} date, ${name}`} today={today} disabled={!canEdit} onSave={actions.saveDate(field, label)} />
      {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
    </span>
  )
  const expectedHint = leg.expectedOn
    ? leg.placedOn && suggestion && suggestion.on === leg.expectedOn
      ? suggestion.label
      : undefined
    : suggestion
      ? leg.placedOn
        ? `suggested: ${suggestion.label}`
        : suggestion.source === 'lead_time'
          ? `suggested from lead time ${suggestion.from}`
          : `${suggestion.days} days after it is placed`
      : undefined

  // The default expected date of an order placed by any route (a PO issued, a typed date) is written by the database (0067); the stamp sends the same date at once.
  // Not placed and no PO yet (admin and sales): Issue PO is the way to place it, so "Mark placed" (an order placed by phone or WhatsApp,
  // no PO) goes into the menu: never two buttons for one step side by side. An engineer, who cannot issue a PO, keeps the stamp as "I placed this order".
  const placeInMenu = Boolean(money && !po && stamp?.step === 'place')
  // Delivered, or the whole order already invoiced, with no PO (an order placed by phone, UX audit P3 and area 9): no "Issue PO" on
  // the row and no "No PO yet" chip, since that step no longer matters; the Ref says what the supplier's paper was, and issuing a PO
  // after the fact stays in the row's menu.
  const delivered = state === 'delivered' || state === 'received'
  const pastPo = delivered || order.state?.invoicing === 'fully_invoiced'
  const issueOnRow = money && !po && !pastPo
  const issueInMenu = money && !po && pastPo
  const menu = Boolean(money && po) || (canChase && !late) || isAdmin || placeInMenu || issueInMenu
  // An engineer may mark an order placed (they sometimes order by phone on site), in their own words.
  const stampLabel = stamp && stamp.step === 'place' && !money ? 'I placed this order' : stamp?.label

  if (folded) {
    return (
      <li aria-label={`Supplier order, ${name}`} data-testid={`leg-${letter}`} className="px-4 py-1 md:px-5">
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setFolded(false)}
          className="flex min-h-[2.75rem] w-full flex-wrap items-center gap-x-2 gap-y-1 rounded text-left hover:bg-sunken"
        >
          <span className="min-w-0 break-words font-medium">{name}</span>
          <span data-testid={`leg-${letter}-state`} className="text-fg-2">
            <span className="text-fg-muted">·</span> Delivered{leg.deliveredOn ? ` ${formatShortDate(leg.deliveredOn, today)}` : ''}
          </span>
          {money && total.priced > 0 ? (
            <span className="num text-fg-2">
              <span className="text-fg-muted">·</span> {`${ccy ?? ''} ${formatAmount(total.total)}`.trim()}
            </span>
          ) : null}
          <ChevronDown size={16} aria-hidden="true" className="ml-auto shrink-0 text-fg-muted" />
        </button>
      </li>
    )
  }

  return (
    <li aria-label={`Supplier order, ${name}`} data-testid={`leg-${letter}`} className="grid gap-3 px-4 py-4 md:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-x-6">
      <div className="grid min-w-0 content-start gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-words font-medium">{name}</span>
          {ccy ? <span className="num inline-flex h-chip items-center rounded-round border border-line-strong px-[6px] text-xs text-fg-2">{ccy}</span> : null}
          <span data-testid={`leg-${letter}-state`}>
            <StatusBadge dimension="goods" value={STATE_DIM[state]} />
          </span>
          {/* the PO chip: the latest issued revision, or "No PO yet" (not once the goods are delivered or the order is invoiced) */}
          {po || !pastPo ? (
          <span data-testid={`leg-${letter}-po`} className={cn('num inline-flex h-chip items-center rounded border px-[6px] text-xs', po ? 'border-line-strong text-fg-2' : 'border-dashed border-line-strong text-fg-muted')}>
            {po ? `${poRef(po.number, po.firstIssuedOn)} · R${po.revision}` : 'No PO yet'}
          </span>
          ) : null}
          {cancelledWithSupplier ? (
            <span data-testid={`leg-${letter}-cancelled`} className="inline-flex h-chip items-center rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-[6px] text-xs text-tone-warning-fg">
              {`Cancelled with supplier ${formatShortDate(cancelledWithSupplier, today)}`}
            </span>
          ) : null}
          {fromSplit ? (
            <span data-testid={`leg-${letter}-from-split`} className="inline-flex items-center gap-1 text-xs text-fg-muted">
              <Split size={12} aria-hidden="true" />
              New, from the split
            </span>
          ) : null}
        </div>
        {money && po?.id ? <LastChanged table="purchase_orders" id={po.id} className="text-base text-fg-2" /> : null}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm" role="group" aria-label={`Dates, ${name}`}>
          {date('Placed', 'placedOn')}
          {date('Expected', 'expectedOn', expectedHint)}
          {date('Delivered', 'deliveredOn')}
          <span className="inline-flex items-baseline gap-x-1">
            <span className="text-fg-muted">Ref</span>
            <TapText
              value={leg.reference}
              label={`Reference, ${name}`}
              empty="add"
              placeholder="Our PO or the supplier's PI"
              disabled={!canEdit}
              render={v => <span className="num">{v}</span>}
              onSave={v => actions.run({ reference: v }, v ? 'Reference saved' : 'Reference cleared', name)}
            />
          </span>
        </div>
        {lines ? <p className="min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]">{lines}</p> : null}
        {changed && po && part !== 'delivery' ? (
          <div role="status" data-testid={`leg-${letter}-changed`} className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-row border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-2 text-sm">
            <Icon icon={TriangleAlert} className="text-tone-warning-fg" />
            <span className="min-w-0 flex-1 text-pretty">
              <b className="font-semibold">
                Lines changed since {poRef(po.number, po.firstIssuedOn)} · R{po.revision}.
              </b>{' '}
              <span className="text-fg-2">{changed.notes.join('. ')}. The PO still lists the earlier lines.</span>
            </span>
            {canEdit ? (
              <Button size="sm" icon={FileText} onClick={onIssue} aria-label={`Revise PO, ${name}`}>
                Revise PO
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid min-w-0 content-start justify-items-start gap-2 lg:justify-items-end">
        {money ? (
          <div className="grid gap-px lg:justify-items-end">
            <span className="num text-base font-medium" data-testid={`leg-${letter}-total`}>
              <span className="mr-1 text-xs font-regular text-fg-muted">{ccy ?? ''}</span>
              {total.priced > 0 ? formatAmount(total.total) : 'Not set'}
            </span>
            {total.of > 0 && total.priced < total.of ? <span className="text-xs text-fg-muted">{`${total.priced} of ${total.of} lines priced`}</span> : null}
            {pkr !== null ? <span className="num text-xs text-fg-muted">≈ PKR {formatPaisa(pkr, 'auto')} today</span> : null}
          </div>
        ) : null}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {stamp && !placeInMenu && (part === 'all' || (part === 'order' ? stamp.step === 'place' : stamp.step !== 'place')) ? (
              <Button size="sm" onClick={actions.doStamp} busy={actions.pending} busyLabel="Saving" aria-label={`${stampLabel}, ${name}`}>
                {stampLabel}
              </Button>
            ) : null}
            {/* data-slot="issue-po" (O07): Issue PO opens the dialog (1 tap, then Issue PO in it: 2 taps). Admin and sales only: a PO carries prices. */}
            {issueOnRow && part !== 'delivery' ? (
              <span data-slot="issue-po" className="contents">
                <Button size="sm" icon={FileText} onClick={onIssue} aria-label={`Issue PO, ${name}`}>
                  Issue PO
                </Button>
              </span>
            ) : null}
            {canChase && late && part !== 'order' ? (
              <Button size="sm" icon={MessageSquareWarning} onClick={onChase} aria-label={`Chase goods, ${name}`}>
                Chase goods
              </Button>
            ) : null}
            {menu && (part !== 'delivery' || (canChase && !late)) ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="quiet" icon={Ellipsis} aria-label={`More for ${name}`} />
                </PopoverTrigger>
                <PopoverContent variant="menu" align="end">
                  {money && po?.id && part !== 'delivery' ? poHistory.item : null}
                  {money && po && part !== 'delivery' ? (
                    <MenuItem icon={FileText} onClick={onViewPo} disabled={viewingPo}>
                      View PO
                    </MenuItem>
                  ) : null}
                  {money && po && part !== 'delivery' ? (
                    <MenuItem icon={RefreshCw} onClick={onIssue}>
                      {`Revise PO (R${po.revision + 1})`}
                    </MenuItem>
                  ) : null}
                  {issueInMenu && part !== 'delivery' ? (
                    <MenuItem icon={FileText} onClick={onIssue}>
                      Issue PO
                    </MenuItem>
                  ) : null}
                  {placeInMenu && part !== 'delivery' ? (
                    <MenuItem icon={Truck} onClick={actions.doStamp} disabled={actions.pending}>
                      Mark placed, no PO
                    </MenuItem>
                  ) : null}
                  {canChase && !late && part !== 'order' ? (
                    <MenuItem icon={MessageSquareWarning} onClick={onChase}>
                      Chase goods
                    </MenuItem>
                  ) : null}
                  {isAdmin && po?.id && part !== 'delivery' ? (
                    <MenuItem icon={Trash2} danger onClick={() => setDeletingPo(true)}>
                      {`Delete latest PO revision (R${po.revision})`}
                    </MenuItem>
                  ) : null}
                  {isAdmin && part !== 'delivery' ? (
                    <MenuItem icon={Receipt} onClick={() => setAddingExpense(true)}>
                      {`Pay ${name}`}
                    </MenuItem>
                  ) : null}
                  {isAdmin && money && leg.placedOn && part !== 'delivery' ? (
                    <MenuItem icon={Trash2} onClick={toggleCancelled} disabled={setCancelled.isPending}>
                      {cancelledWithSupplier ? 'Live with the supplier again' : 'Cancelled with supplier'}
                    </MenuItem>
                  ) : null}
                </PopoverContent>
              </Popover>
            ) : null}
          </div>
        ) : money && po ? (
          <Button size="sm" variant="quiet" icon={FileText} onClick={onViewPo} busy={viewingPo} busyLabel="Opening" aria-label={`View PO, ${name}`}>
            View PO
          </Button>
        ) : null}
        {/* 0121: the customer order is cancelled but the supplier may still be owed: the admin can still pay, and say when the supplier cancelled */}
        {!canEdit && isAdmin && money && leg.placedOn ? (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <Button size="sm" icon={Receipt} onClick={() => setAddingExpense(true)} aria-label={`Pay ${name}`}>
              {`Pay ${name}`}
            </Button>
            <Button size="sm" variant="quiet" onClick={toggleCancelled} busy={setCancelled.isPending} busyLabel="Saving">
              {cancelledWithSupplier ? 'Live with the supplier again' : 'Cancelled with supplier'}
            </Button>
          </div>
        ) : null}
      </div>
      {money && po?.id ? poHistory.node : null}
      {deletingPo && po?.id ? <DeletePoRevisionConfirm orderId={order.id} po={{ id: po.id, number: po.number, revision: po.revision, firstIssuedOn: po.firstIssuedOn }} supplierName={name} onClose={() => setDeletingPo(false)} /> : null}
      {addingExpense ? (
        <PayDialog
          open
          onOpenChange={o => !o && setAddingExpense(false)}
          context={{ orderId: order.id, orderLabel: orderRef(order.number), legId: leg.id, supplierId: leg.supplierId, supplierName: leg.supplierName, currency: leg.currency, amount: owed?.amount, amountNote: owed?.note }}
        />
      ) : null}
    </li>
  )
}
