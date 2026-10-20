import { useMemo, useState } from 'react'
import { Split, TriangleAlert } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, poRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { InfoTip } from '@/ui/InfoTip'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { useToast } from '@/ui/useToast'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useRankedQuotes, useSplitOrderItem, useSupplierChoices } from '@/features/orders/hooks'
import { RankBadge, RankedOptionRow } from '@/features/orders/RankedPicker'
import { forItem, priceTexts, type RankedQuote } from '@/features/orders/lib/ranking'
import { CURRENCIES } from '@/features/orders/lib/currencies'
import { supplierTargetProblem } from '@/features/orders/lib/splitLine'

/*
 * "Split line" (O09; g2-ranking-split.html "Order detail: the Split line dialog"). Moves part of one order line to another supplier.
 * split_order_item does the work: the new line copies the description, brand, unit, selling price and GST rate, takes the chosen supplier's
 * price, and lands on that supplier's leg (the order's existing leg for the supplier and currency, else a new one). GST is rounded to whole
 * rupees per line (DATA_MODEL 2.13, owner decision 2026-10-19), so the order total may move by rounding, about Rs 1 per split.
 *
 * FE-2: Split line on the row (1), choose the supplier (2), Split line in the dialog (3), and the quantity typed.
 * Where the order came from an RFQ the choices are that item's ranked quotes (the same rows the convert dialog shows) and the order's other
 * legs. An order with no RFQ, or an item with no quotes, lists any supplier. Admin and sales only: the ranked rows carry prices.
 *
 * Nothing is sent to the supplier automatically: if the line's PO was already issued, the leg shows "lines changed since PO" afterwards.
 */

type Target = { kind: 'quote'; q: RankedQuote } | { kind: 'leg'; legId: string } | { kind: 'supplier' }

export function SplitLineDialog({
  order,
  item,
  legs,
  pos,
  onClose,
}: {
  order: OrderHeader
  item: OrderItemRow
  legs: readonly OrderLegRow[]
  pos: readonly LegPo[]
  onClose: () => void
}) {
  const { toast } = useToast()
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const split = useSplitOrderItem(order.id)
  const sourceLeg = legs.find(l => l.id === item.legId)
  const sourceName = sourceLeg?.supplierName ?? 'this supplier'
  const fromRfq = Boolean(order.rfqId && item.rfqItemId)
  const rankQ = useRankedQuotes(order.rfqId ?? undefined, role, fromRfq)
  const quotes = useMemo(() => (fromRfq ? forItem(rankQ.data ?? [], item.rfqItemId as string) : []), [fromRfq, rankQ.data, item.rfqItemId])
  const noQuotes = !fromRfq || (rankQ.isSuccess && quotes.length === 0)
  const choices = useSupplierChoices(noQuotes)

  const [qty, setQty] = useState<number | null>(null)
  const [target, setTarget] = useState<Target | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [currency, setCurrency] = useState('PKR')
  const [price, setPrice] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const here = (q: RankedQuote) => Boolean(sourceLeg && q.supplierId === sourceLeg.supplierId && q.currency === (sourceLeg.currency ?? ''))
  const otherLegs = legs.filter(l => l.id !== item.legId)
  const sourcePo = pos.find(p => p.legId === item.legId)

  // With no quotes to choose from the person picks a supplier and currency; that is the one target.
  const effective: Target | null = noQuotes && supplierId ? { kind: 'supplier' } : target
  const targetProblem = effective?.kind === 'supplier' ? supplierTargetProblem(sourceLeg, supplierId, currency) : null
  const valid = qty !== null && qty > 0 && qty < item.qty
  const qtyError = qty !== null && !valid ? `Between 0 and ${item.qty}, not including either: some stay with this supplier.` : undefined

  const resultText = (() => {
    if (!valid || !effective || targetProblem || qty === null) return null
    const stay = Number((item.qty - qty).toFixed(6))
    if (effective.kind === 'quote') return `${stay} stay with ${sourceName}, ${qty} ${qty === 1 ? 'moves' : 'move'} to ${effective.q.supplierName} at ${priceTexts(effective.q).price}.`
    if (effective.kind === 'leg') {
      const to = legs.find(l => l.id === effective.legId)
      return `${stay} stay with ${sourceName}, ${qty} ${qty === 1 ? 'moves' : 'move'} to ${to?.supplierName ?? 'the other supplier'}${to?.currency ? ` (${to.currency})` : ''}.`
    }
    const name = choices.data?.find(c => c.id === supplierId)?.name ?? 'the supplier'
    return `${stay} stay with ${sourceName}, ${qty} ${qty === 1 ? 'moves' : 'move'} to ${name} in ${currency}.`
  })()

  const submit = async () => {
    if (!valid || !effective || targetProblem || qty === null || split.isPending) return
    setError(null)
    try {
      const common = { itemId: item.id, qty }
      if (effective.kind === 'quote') await split.mutateAsync({ ...common, supplierId: effective.q.supplierId, currency: effective.q.currency, supplierUnitPrice: effective.q.price })
      else if (effective.kind === 'leg') await split.mutateAsync({ ...common, legId: effective.legId })
      else await split.mutateAsync({ ...common, supplierId, currency, supplierUnitPrice: price })
      toast({ title: 'Line split', body: `${orderRef(order.number)} · ${item.description}: ${qty} moved` })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'line' }).message)
    }
  }

  return (
    <Dialog open busy={split.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title={`Split line ${item.number}`}
        context={`${item.description} ×${item.qty}${sourceLeg ? ` · from ${sourceLeg.supplierName}` : ''}`}
        icon={Split}
        size="lg"
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={split.isPending}>
              Cancel
            </Button>
            <Button variant="primary" icon={Split} busy={split.isPending} busyLabel="Splitting" disabled={!valid || !effective || targetProblem !== null} onClick={() => void submit()}>
              Split line
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Move how many to another supplier" requirement="required" error={qtyError}>
            <div className="flex items-center gap-3">
              <NumberInput value={qty} onChange={setQty} aria-label="Quantity to move" className="w-24" data-autofocus />
              <span className="text-sm text-fg-muted">
                of <span className="num">{item.qty}</span>
                {qty !== null && valid ? (
                  <>
                    {' '}
                    · <span className="num">{Number((item.qty - qty).toFixed(6))}</span> stay with {sourceLeg?.supplierName ?? 'this supplier'}
                  </>
                ) : null}
              </span>
            </div>
          </Field>

          {noQuotes ? (
            <div className="grid gap-4">
              <Field label="Move to" requirement="required" help="Suppliers you have asked, ordered from or carry a brand for.">
                <Select
                  value={supplierId}
                  onChange={e => {
                    setSupplierId(e.target.value)
                    setCurrency(choices.data?.find(c => c.id === e.target.value)?.lastCurrency ?? 'PKR')
                  }}
                  placeholder={choices.isPending ? 'Loading suppliers' : 'Choose a supplier'}
                  options={(choices.data ?? []).filter(c => c.id !== sourceLeg?.supplierId || currency !== (sourceLeg?.currency ?? '')).map(c => ({ value: c.id, label: c.name }))}
                  aria-label="Move to supplier"
                />
              </Field>
              {supplierId ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Currency" error={targetProblem ?? undefined}>
                    <Select value={currency} onChange={e => setCurrency(e.target.value)} options={CURRENCIES.map(c => ({ value: c, label: c }))} aria-label="Currency" />
                  </Field>
                  <Field label={`Supplier unit price, ${currency}`} requirement="optional">
                    <NumberInput value={price} onChange={setPrice} prefix={currency} aria-label="Supplier unit price" />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-2">
              <span className="text-sm font-medium">Move to</span>
              {rankQ.isPending ? (
                <p className="text-sm text-fg-muted">Loading the ranked quotes</p>
              ) : rankQ.isError ? (
                <Banner tone="danger" title="Couldn't load the ranked quotes" action={<Button onClick={() => void rankQ.refetch()}>Try again</Button>}>
                  Nothing was changed.
                </Banner>
              ) : (
                <>
                  <p className="text-xs font-medium text-fg-muted">
                    Ranked quotes from {order.rfqId ? 'the RFQ' : ''}, item {item.number}
                  </p>
                  <div role="radiogroup" aria-label="Ranked quotes" className="grid gap-1 rounded border p-1">
                    {quotes.map(q => {
                      const isHere = here(q)
                      const on = target?.kind === 'quote' && target.q.lineId === q.lineId
                      return (
                        <button
                          key={q.lineId}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          aria-label={`Move to ${q.supplierName}`}
                          disabled={isHere}
                          onClick={() => setTarget({ kind: 'quote', q })}
                          className={cn('block w-full rounded p-2 text-left hover:bg-sunken disabled:opacity-55 disabled:hover:bg-transparent', on && 'bg-selected')}
                        >
                          {isHere ? (
                            <span className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2">
                              <RankBadge rank={q.rank} />
                              <span className="grid">
                                <b className="text-sm font-medium">{q.supplierName}</b>
                                <span className="text-xs text-fg-muted">Where it is now</span>
                              </span>
                              <span className="num text-right text-xs">{priceTexts(q).price}</span>
                            </span>
                          ) : (
                            <RankedOptionRow q={q} among={quotes} />
                          )}
                        </button>
                      )
                    })}
                  </div>
                  {otherLegs.length > 0 ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
                      <span>Or another supplier on this order:</span>
                      <div role="radiogroup" aria-label="Other suppliers on this order" className="flex flex-wrap gap-2">
                      {otherLegs.map(l => {
                        const on = target?.kind === 'leg' && target.legId === l.id
                        return (
                          <button
                            key={l.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={`Move to ${l.supplierName}${l.currency ? ` (${l.currency})` : ''}`}
                            onClick={() => setTarget({ kind: 'leg', legId: l.id })}
                            className={cn('rounded border px-2 py-1 text-sm text-fg hover:bg-sunken', on ? 'border-primary bg-selected' : 'border-line-strong')}
                          >
                            {l.supplierName}
                            {l.currency ? <span className="ml-1 text-fg-muted">{l.currency}</span> : null}
                          </button>
                        )
                      })}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {resultText ? (
            <div className="grid gap-0.5 rounded bg-sunken px-3 py-2 text-sm" data-testid="split-result">
              <span className="flex items-start gap-1">
                <span>
                  <b className="font-medium">Result:</b> {resultText}
                </span>
                <InfoTip label="What the new line copies" side="top" align="end">
                  The new line copies the description, brand, unit, selling price and GST rate. Order totals stay the same, give or take Rs 1 of GST rounding.
                </InfoTip>
              </span>
            </div>
          ) : null}

          {sourcePo ? (
            <div className="flex items-start gap-3 rounded border border-tone-warning-fg/25 bg-tone-warning-bg px-3 py-2 text-sm">
              <Icon icon={TriangleAlert} className="mt-0.5 text-tone-warning-fg" />
              <p>
                The PO to {sourceName}{' '}
                <b className="num font-semibold">
                  {poRef(sourcePo.number, sourcePo.firstIssuedOn)} · R{sourcePo.revision}
                </b>{' '}
                is already issued. After the split it shows &ldquo;lines changed since R{sourcePo.revision}, re-issue&rdquo;. Nothing is sent to the supplier automatically.
              </p>
            </div>
          ) : null}

          {error ? (
            <Banner tone="danger" title="Couldn't split the line">
              {error} Nothing was changed.
            </Banner>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
