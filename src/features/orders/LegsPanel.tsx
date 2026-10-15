import { useMemo, useState } from 'react'
import { FileText, MessageSquareWarning, Plus, Receipt } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { convertToPaisa, formatAmount, formatPaisa } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { poRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { useFxLatest } from '@/features/rfqs/hooks'
import { toRateTable } from '@/features/rfqs/lib'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useUpdateLeg } from '@/features/orders/hooks'
import { before, editPatch, legLetter, legState, legSupplierTotal, nextStamp, stampPatch, suggestExpected, type LegDates, type LegPatch } from '@/features/orders/lib/legModel'
import { AddLegDialog } from '@/features/orders/AddDialogs'
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
 * "Issue PO" / "View PO" (admin and sales). TRACKED GAPS: "Add expense" waits for Expenses (M03); "Issue PO" and "View PO" are wired by the
 * supplier PO task (O07) through the data-slot="issue-po" place on each leg.
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
              po={pos.find(p => p.legId === leg.id)}
              money={money}
              isAdmin={isAdmin}
              canEdit={canEdit}
              rates={rates}
              today={today}
              onChase={() => setChasing(leg)}
            />
          ))}
        </ul>
      )}
      {chasing ? <GoodsChaseDialog order={order} leg={legs.find(l => l.id === chasing.id) ?? chasing} onClose={() => setChasing(null)} /> : null}
      {adding ? <AddLegDialog order={order} legs={legs} onClose={() => setAdding(false)} /> : null}
    </section>
  )
}

function Leg({
  order,
  leg,
  letter,
  items,
  po,
  money,
  isAdmin,
  canEdit,
  rates,
  today,
  onChase,
}: {
  order: OrderHeader
  leg: OrderLegRow
  letter: string
  items: OrderItemRow[]
  po: LegPo | undefined
  money: boolean
  isAdmin: boolean
  canEdit: boolean
  rates: ReturnType<typeof toRateTable>
  today: string
  onChase: () => void
}) {
  const { toast } = useToast()
  const update = useUpdateLeg(order.id)
  const dates: LegDates = { placedOn: leg.placedOn, expectedOn: leg.expectedOn, receivedOn: leg.receivedOn, deliveredOn: leg.deliveredOn }
  const state = legState(dates, today)
  const stamp = nextStamp(dates)
  const suggestion = suggestExpected(leg.placedOn, leg.leadTimes)
  const leadHint = leg.leadTimes.length > 0 ? [...leg.leadTimes].sort((a, b) => b.length - a.length)[0] : null
  const total = legSupplierTotal(items.map(it => ({ qty: it.qty, supplierUnitPrice: it.supplierUnitPrice, isService: it.isService })))
  const ccy = leg.currency
  const rate = ccy && ccy !== 'PKR' ? rates[ccy] : undefined
  const pkr = rate && rate.staleness !== 'unusable' && total.priced > 0 ? convertToPaisa(total.total, rate.rate) : null
  const label = `leg ${letter}`

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
    const patch = stampPatch(stamp.step, dates, today, leg.leadTimes)
    const verb = stamp.step === 'place' ? 'Marked placed' : 'Marked delivered'
    const extra = patch.expected_on ? `expected ${formatDay(patch.expected_on)}, from lead time ${leadHint ?? ''}`.replace(/, from lead time $/, '') : ''
    void run(patch, verb, [leg.supplierName, extra].filter(Boolean).join(' · '))
  }
  const saveDate = (field: keyof LegDates, name: string) => (value: string | null) =>
    run(editPatch(field, value, dates, leg.leadTimes), value ? `${name} date set` : `${name} date cleared`, leg.supplierName)

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
    ? suggestion && suggestion.on === leg.expectedOn
      ? `from lead time ${suggestion.from}`
      : undefined
    : leadHint
      ? `suggested from lead time ${leadHint}`
      : undefined

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
            <Button size="sm" variant="quiet" icon={Receipt} disabled title="Arrives with Expenses (M03)" aria-label={`Add expense, ${label}`}>
              Add expense
            </Button>
          ) : null}
        </div>
        {lines ? <p className="line-clamp-2 text-sm text-fg-muted">{lines}</p> : null}
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
        {/* data-slot="issue-po" (O07): Issue PO / View PO for this leg. Drawn as the mockup places it, disabled until the PO task wires it. */}
        <span data-slot="issue-po" className="contents">
          {money && canEdit ? (
            <Button size="sm" variant={po ? 'quiet' : 'secondary'} icon={FileText} disabled title="Arrives with the supplier PO (O07)" aria-label={`${po ? 'View PO' : 'Issue PO'}, ${label}`}>
              {po ? 'View PO' : 'Issue PO'}
            </Button>
          ) : null}
        </span>
      </div>
    </li>
  )
}
