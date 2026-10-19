import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, MessageSquareWarning, Plus, Receipt, Split, TriangleAlert } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { convertToPaisa, formatAmount, formatPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, poRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { EmptyState } from '@/ui/EmptyState'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { useFxLatest } from '@/features/rfqs/hooks'
import { toRateTable } from '@/features/rfqs/lib'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useSupplierMedianDays, useUpdateLeg } from '@/features/orders/hooks'
import { isFreshSplitLeg, splitRfqItemIds } from '@/features/orders/lib/splitGroups'
import { poChange } from '@/features/orders/lib/poChange'
import { before, editPatch, legLetter, legState, legSupplierTotal, nextStamp, stampPatch, defaultExpected, type LegDates, type LegPatch } from '@/features/orders/lib/legModel'
import { AddLegDialog } from '@/features/orders/AddDialogs'
import { IssuePoDialog } from '@/features/purchaseOrders/IssuePoDialog'
import { AddExpenseDialog } from '@/features/money/expenses/ExpenseDialog'
import { useOpenPoPdf } from '@/features/purchaseOrders/useOpenPoPdf'
import { GoodsChaseDialog } from '@/features/orders/GoodsChaseDialog'
import { TapDate, TapText } from '@/features/orders/TapEdit'

/*
 * Procurement legs (O03; g2-order-detail.html "Procurement legs"). One supplier in one currency per leg.
 *
 * FE-2 / A3 (owner decision 2026-10-15: no receiving step): each leg has ONE next-step button, Mark placed and then Delivered today. One tap
 * each, nothing typed. Delivering also sets the stored received date to the same day. The stamped date reads as text and edits on tap (optional). When the leg is placed,
 * the expected date is suggested from the placed date plus the upper bound of the supplier's lead time and written then, so
 * "goods late" on Today works without anyone typing a date; it shows where it came from and can be changed.
 * A placed leg that has not arrived has "Chase goods": the R16 message and stamp.
 *
 * Also on a leg, as the mockup draws them: the PO chip ("No PO yet", or "PO-26-0017 · R1" from purchase_orders), "Add expense" (admin) and
 * "Issue PO" / "View PO" (admin and sales; O07, the supplier PO dialog and its PDF), and "Add expense" (admin; the M03 dialog with the leg as its context:
 * the supplier is the payee, the category is Supplier payment).
 */
const STATE_DIM: Record<string, string> = { 'to-place': 'to-place', 'on-order': 'on-order', late: 'late', received: 'received', delivered: 'delivered' }

export function LegsPanel({
  order,
  legs,
  items,
  pos,
  money,
  isAdmin,
  canEdit,
}: {
  order: OrderHeader
  legs: readonly OrderLegRow[]
  items: readonly OrderItemRow[]
  pos: readonly LegPo[]
  money: boolean
  isAdmin: boolean
  canEdit: boolean
}) {
  const fx = useFxLatest()
  const rates = useMemo(() => toRateTable(fx.data ?? []), [fx.data])
  const [chasing, setChasing] = useState<OrderLegRow | null>(null)
  const [adding, setAdding] = useState(false)
  const [issuing, setIssuing] = useState<OrderLegRow | null>(null)
  const poPdf = useOpenPoPdf(order.id)
  const today = businessToday()
  const currencies = new Set(legs.map(l => l.currency).filter(Boolean)).size
  const imported = order.imported

  return (
    <section aria-label="Procurement legs" className="min-w-0 rounded border bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
        <h2 className="text-base font-semibold">Procurement legs</h2>
        <span className="text-sm text-fg-muted">
          {legs.length === 0 && imported
            ? 'None recorded for imported orders'
            : `${legs.length} ${legs.length === 1 ? 'leg' : 'legs'}${legs.length > 0 ? ` · ${currencies} ${currencies === 1 ? 'currency' : 'currencies'} · one currency per supplier` : ''}`}
        </span>
        {/* data-slot="add-leg": adds a supplier leg by hand. */}
        <span data-slot="add-leg" className="ml-auto contents">
          {money && canEdit ? (
            <Button icon={Plus} className="ml-auto" onClick={() => setAdding(true)}>
              Add leg
            </Button>
          ) : null}
        </span>
      </div>
      {legs.length === 0 ? (
        <EmptyState title="No legs on this order">
          {imported
            ? 'Imported orders arrive without suppliers. Add a leg only if you need to track a reorder.'
            : 'Lines with a supplier appear here, one leg per supplier. A service has none.'}
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
              today={today}
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
      {issuing ? <IssuePoDialog order={order} leg={legs.find(l => l.id === issuing.id) ?? issuing} legIndex={Math.max(0, legs.findIndex(l => l.id === issuing.id))} onClose={() => setIssuing(null)} /> : null}
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
  today,
  onChase,
  onIssue,
  onViewPo,
  viewingPo,
}: {
  order: OrderHeader
  leg: OrderLegRow
  letter: string
  items: OrderItemRow[]
  /** A8: a new leg that exists for the parts of split items. */
  fromSplit: boolean
  po: LegPo | undefined
  money: boolean
  isAdmin: boolean
  canEdit: boolean
  rates: ReturnType<typeof toRateTable>
  today: string
  onChase: () => void
  onIssue: () => void
  onViewPo: () => void
  viewingPo: boolean
}) {
  const { toast } = useToast()
  const update = useUpdateLeg(order.id)
  const [addingExpense, setAddingExpense] = useState(false)
  const dates: LegDates = { placedOn: leg.placedOn, expectedOn: leg.expectedOn, receivedOn: leg.receivedOn, deliveredOn: leg.deliveredOn }
  const state = legState(dates, today)
  const stamp = nextStamp(dates)
  const median = useSupplierMedianDays(leg.supplierId)
  const medianDays = median.data ?? null
  /** The default expected date for this leg (lead time, else this supplier's usual days, else 30). Dated from today until the leg is placed. */
  const suggestion = defaultExpected(leg.placedOn ?? today, leg.leadTimes, medianDays)
  const filled = useRef(false)
  const leadHint = leg.leadTimes.length > 0 ? [...leg.leadTimes].sort((a, b) => b.length - a.length)[0] : null
  const total = legSupplierTotal(items.map(it => ({ qty: it.qty, supplierUnitPrice: it.supplierUnitPrice, isService: it.isService })))
  const ccy = leg.currency
  const rate = ccy && ccy !== 'PKR' ? rates[ccy] : undefined
  const pkr = rate && rate.staleness !== 'unusable' && total.priced > 0 ? convertToPaisa(total.total, rate.rate) : null
  const label = `leg ${letter}`
  /** A8 (O09): the latest PO revision lists lines this leg no longer matches (a split moved quantity). Admin and sales only: a PO carries prices. */
  const changed = money && po ? poChange(po.lines, items.map(it => ({ id: it.id, description: it.description, qty: it.qty, isService: it.isService }))) : null

  const run = async (patch: LegPatch & { reference?: string | null }, title: string, body: string) => {
    const prev: LegPatch & { reference?: string | null } = { ...before(dates, patch), ...('reference' in patch ? { reference: leg.reference } : {}) }
    try {
      await update.mutateAsync({ id: leg.id, patch })
      toast({
        title,
        body,
        undo: {
          onUndo: async () => {
            try {
              await update.mutateAsync({ id: leg.id, patch: prev })
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
          },
          settledTitle: title,
          undoneTitle: 'Taken back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not save', body: mapPgError(err, { entity: 'leg' }).message, tone: 'danger' })
    }
  }

  const doStamp = () => {
    if (!stamp) return
    const patch = stampPatch(stamp.step, dates, today, leg.leadTimes, medianDays)
    const verb = stamp.step === 'place' ? 'Marked placed' : 'Marked delivered'
    const extra = patch.expected_on ? `expected ${formatDay(patch.expected_on)}, from lead time ${leadHint ?? ''}`.replace(/, from lead time $/, '') : ''
    void run(patch, verb, [leg.supplierName, extra].filter(Boolean).join(' · '))
  }
  const saveDate = (field: keyof LegDates, name: string) => (value: string | null) =>
    run(editPatch(field, value, dates, leg.leadTimes, medianDays), value ? `${name} date set` : `${name} date cleared`, leg.supplierName)

  const lines = items.map(it => `${it.description} ×${it.qty}`).join(', ')
  const col = (name: string, field: keyof LegDates, hint?: string) => {
    const value = dates[field]
    return (
      <div className={cn('grid min-w-0 content-start gap-1 border-t-2 pt-2', value ? 'border-brand-green' : 'border-line')}>
        <span className="text-xs text-fg-muted">{name}</span>
        <TapDate value={value} label={`${name} date, ${label}`} today={today} disabled={!canEdit} onSave={saveDate(field, name)} />
        {hint ? <span className="text-xs text-fg-muted">{hint}</span> : null}
      </div>
    )
  }
  const expectedHint = leg.expectedOn
    ? leg.placedOn && suggestion && suggestion.on === leg.expectedOn
      ? suggestion.label
      : undefined
    : suggestion
      ? leg.placedOn
        ? `suggested: ${suggestion.label}`
        : `${suggestion.days} days after it is placed (${suggestion.label.replace(/^from /, '')})`
      : undefined

  // A leg placed by any route (a PO issued, a date typed, an import-free manual leg) with no expected date gets the default once, so goods late can fire.
  // It is written as an ordinary edit: the date reads as text and changes on tap, and an Undo is not needed because nothing was replaced.
  useEffect(() => {
    if (filled.current || !canEdit || order.imported || !leg.placedOn || leg.expectedOn || leg.deliveredOn || !suggestion || median.isPending) return
    filled.current = true
    update.mutate({ id: leg.id, patch: { expected_on: suggestion.on } })
  }, [canEdit, order.imported, leg.placedOn, leg.expectedOn, leg.deliveredOn, leg.id, suggestion, median.isPending, update])

  return (
    <li aria-label={`Leg ${letter}, ${leg.supplierName}`} data-testid={`leg-${letter}`} className="grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,0.9fr)]">
      <div className="grid min-w-0 content-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="inline-grid size-5 place-items-center rounded bg-fg text-xs font-medium text-surface">
            {letter}
          </span>
          <span className="min-w-0 break-words font-medium">{leg.supplierName}</span>
          {ccy ? <span className="num inline-flex h-5 items-center rounded border border-line-strong px-[6px] text-xs text-fg-2">{ccy}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span data-testid={`leg-${letter}-state`}>
            <StatusBadge dimension="goods" value={STATE_DIM[state]} />
          </span>
          {/* the PO chip: the latest issued revision, or "No PO yet" */}
          <span data-testid={`leg-${letter}-po`} className={cn('num inline-flex h-5 items-center rounded border px-[6px] text-xs', po ? 'border-line-strong text-fg-2' : 'border-dashed border-line-strong text-fg-muted')}>
            {po ? `${poRef(po.number, po.issuedOn)} · R${po.revision}` : 'No PO yet'}
          </span>
          {fromSplit ? (
            <span data-testid={`leg-${letter}-from-split`} className="inline-flex items-center gap-1 text-xs text-fg-muted">
              <Split size={12} aria-hidden="true" />
              New leg from the split
            </span>
          ) : null}
          <span className="text-sm text-fg-muted">
            Ref{' '}
            <TapText
              value={leg.reference}
              label={`Reference, ${label}`}
              empty="Add reference"
              placeholder="Our PO or the supplier's PI"
              disabled={!canEdit}
              render={v => <span className="num">{v}</span>}
              onSave={v => run({ reference: v }, v ? 'Reference saved' : 'Reference cleared', leg.supplierName)}
            />
          </span>
          {isAdmin && canEdit ? (
            <Button size="sm" variant="quiet" icon={Receipt} onClick={() => setAddingExpense(true)} aria-label={`Add expense, ${label}`}>
              Add expense
            </Button>
          ) : null}
        </div>
        {lines ? <p className="line-clamp-2 text-sm text-fg-muted">{lines}</p> : null}
        {changed && po ? (
          <div
            role="status"
            data-testid={`leg-${letter}-changed`}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-2 text-sm"
          >
            <Icon icon={TriangleAlert} className="text-tone-warning-fg" />
            <span className="min-w-0 flex-1 text-pretty">
              <b className="font-semibold">
                Lines changed since {poRef(po.number, po.issuedOn)} · R{po.revision}.
              </b>{' '}
              <span className="text-fg-2">{changed.notes.join('. ')}. The PO still lists the earlier lines.</span>
            </span>
            {canEdit ? (
              <Button size="sm" variant="primary" icon={FileText} onClick={onIssue} aria-label={`Re-issue PO, ${label}`}>
                Re-issue PO
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3" role="group" aria-label={`Dates, ${label}`}>
        {col('Placed', 'placedOn')}
        {col('Expected', 'expectedOn', expectedHint)}
        {col('Delivered', 'deliveredOn')}
      </div>

      <div className="grid min-w-0 content-start justify-items-start gap-2 lg:justify-items-end">
        {money ? (
          <div className="grid gap-px lg:justify-items-end">
            <span className="num text-base font-medium" data-testid={`leg-${letter}-total`}>
              <span className="mr-1 text-xs font-regular text-fg-muted">{ccy ?? ''}</span>
              {total.priced > 0 ? formatAmount(total.total) : 'Not set'}
            </span>
            <span className="text-xs text-fg-muted">
              {total.of === 0 ? 'No goods lines' : total.priced === total.of ? `${total.of === 1 ? 'The 1 line is' : `All ${total.of} lines`} priced` : `${total.priced} of ${total.of} lines priced`}
            </span>
            {pkr !== null ? <span className="num text-xs text-fg-muted">≈ PKR {formatPaisa(pkr, 'auto')} at today&apos;s rate</span> : null}
          </div>
        ) : null}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            {stamp ? (
              <Button variant="primary" onClick={doStamp} busy={update.isPending} busyLabel="Saving" aria-label={`${stamp.label}, ${label}`}>
                {stamp.label}
              </Button>
            ) : null}
            {leg.placedOn && !leg.deliveredOn && leg.expectedOn ? (
              <Button icon={MessageSquareWarning} onClick={onChase} aria-label={`Chase goods, ${label}`}>
                Chase goods
              </Button>
            ) : null}
          </div>
        ) : null}
        {/* data-slot="issue-po" (O07): Issue PO opens the dialog (1 tap, then Issue PO in it: 2 taps); View PO opens the PDF; a PO that exists can be re-issued as the next revision. Admin and sales only: a PO carries prices. */}
        <span data-slot="issue-po" className="contents">
          {money && po ? (
            <Button size="sm" variant="quiet" icon={FileText} onClick={onViewPo} busy={viewingPo} busyLabel="Opening" aria-label={`View PO, ${label}`}>
              View PO
            </Button>
          ) : null}
          {money && canEdit ? (
            <Button size="sm" variant={po ? 'quiet' : 'secondary'} icon={FileText} onClick={onIssue} aria-label={`${po ? `Issue R${po.revision + 1}` : 'Issue PO'}, ${label}`}>
              {po ? `Issue R${po.revision + 1}` : 'Issue PO'}
            </Button>
          ) : null}
        </span>
      </div>
      {addingExpense ? (
        <AddExpenseDialog
          open
          onOpenChange={o => !o && setAddingExpense(false)}
          context={{ orderId: order.id, orderLabel: orderRef(order.number), legId: leg.id, legLabel: label, payeeId: leg.supplierId, payeeName: leg.supplierName }}
        />
      ) : null}
    </li>
  )
}
