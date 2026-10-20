import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EyeOff, FileCheck2, Split, TriangleAlert, Truck, X } from 'lucide-react'
import { useSession } from '@/app/session'
import { formatAmount } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { InfoTip } from '@/ui/InfoTip'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { Checkbox } from '@/ui/form/Checkbox'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { TextField } from '@/ui/form/TextField'
import { Skeleton } from '@/ui/Skeleton'
import type { RfqHeader } from '@/features/rfqs/api'
import { useQuoteItems } from '@/features/quotations/hooks'
import { useCompanyProfile } from '@/features/settings/hooks'
import { FALLBACK_PAYMENT_TERMS_DAYS } from '@/features/settings/companyProfile'
import { daysFromTermsText } from '@/features/orders/lib/termsDays'
import { useConvertRfq, useLastTerms, useNextOrderNumber, useRankedQuotes } from '@/features/orders/hooks'
import { useQuotations } from '@/features/quotations/hooks'
import { quotationRef } from '@/features/quotations/lib/refs'
import { RankedPicker } from '@/features/orders/RankedPicker'
import { guessCommissioning, type ConvertItem, type SupplierChoice } from '@/features/orders/lib/convert'
import { orderTotals } from '@/features/orders/lib/orderMath'
import { forItem, priceTexts, rankOne, type RankedQuote } from '@/features/orders/lib/ranking'
import { buildSplitPayload, checkSplit, isSplit, nextRanked, orderLineCount, type Part, type SplitCheck } from '@/features/orders/lib/splitConvert'
import { orderRef } from '@/lib/refs'

/*
 * "Mark won" (O01 + O08; g2-ranking-split.html frames "Convert dialog, nothing changed / splitting an item / parts that do not add up").
 * One confirm creates the order through convert_rfq_to_order with an id made here, so a double submit (a double click, Enter twice, a
 * retry after a dropped connection) creates one order. Afterwards the order opens.
 *
 * Every item arrives already assigned to its rank-1 quote (rank_item_quotes: lowest PKR price at today's rate, a 2% tie band, then delivery
 * record, then order history), with the reason printed under the supplier. Splitting an item's quantity across suppliers is opt-in.
 *
 * FE-2 entry burden, listed for the commit:
 *   required     nothing. A line the quotation never priced was never sold, so it is left out of the order (as g2-ranking-split draws it).
 *   pre-filled   the supplier on each line (its rank-1 quote), the payment terms (the company's last order), prices, delivery and the
 *                rest from the RFQ, the date (today) and the owner (the RFQ's).
 *   optional     the customer PO number (it can be added from the order later), a different supplier on any line, splitting an item.
 *   interactions Mark won (1), Create order (2). A split adds: Split this item (1), the supplier picker (2), a supplier (3) and one
 *                quantity typed; if the next-ranked supplier it offers is fine, 1 tap and 1 quantity. The first part takes the remainder.
 *   not blocked  parts that do not add up to the RFQ quantity: a warning only (the backend allows a partial order). A part with no
 *                quantity yet holds Create order, because a line of nothing cannot be ordered.
 */

type Props = {
  rfq: RfqHeader
  /** Passed by the caller; the ranking replaces the old client-side lowest-quote rule, so these are no longer read here. */
  inquiries?: unknown
  rates?: unknown
  onClose: () => void
}

// Sized for 16px text: the quantity, a supplier price with its currency, and our net price fit their tracks (UX foundation review).
const GRID = 'lg:grid lg:grid-cols-[26px_minmax(0,1.25fr)_72px_minmax(0,1.55fr)_148px_128px] lg:items-start lg:gap-x-3'
const EXTRAS = [
  { value: 'none', label: 'Not sourced yet' },
  { value: 'service', label: 'Service, no supplier' },
]

export function ConvertDialog({ rfq, onClose }: Props) {
  const navigate = useNavigate()
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const itemsQ = useQuoteItems(rfq.id, true)
  const rankQ = useRankedQuotes(rfq.id, role)
  const termsQ = useLastTerms(rfq.company.id, true)
  const profileQ = useCompanyProfile()
  const defaultTerms = profileQ.data?.default_payment_terms_days ?? FALLBACK_PAYMENT_TERMS_DAYS
  const quotesQ = useQuotations(rfq.id)
  const nextNo = useNextOrderNumber(true)
  const convert = useConvertRfq(rfq.id)
  /** Made once per open dialog and kept for any retry: the database returns the same order for the same id. */
  const orderId = useRef(crypto.randomUUID())
  const submitting = useRef(false)

  const items: ConvertItem[] = useMemo(
    () => (itemsQ.data ?? []).map(i => ({ id: i.id, description: i.description, qty: i.qty, unit: i.unit, quotedUnitPriceNet: i.quotedUnitPriceNet, brandName: i.brandName, familyName: i.familyName })),
    [itemsQ.data],
  )
  const ranked = useMemo<readonly RankedQuote[]>(() => rankQ.data ?? [], [rankQ.data])
  const byItem = useMemo(() => Object.fromEntries(items.map(i => [i.id, forItem(ranked, i.id)])) as Record<string, RankedQuote[]>, [items, ranked])

  const [choices, setChoices] = useState<Record<string, SupplierChoice>>({})
  const [splits, setSplits] = useState<Record<string, Part[]>>({})
  const [po, setPo] = useState('')
  const [terms, setTerms] = useState<number | null>(null)
  const [termsTouched, setTermsTouched] = useState(false)
  /** null until the person taps it: the toggle then follows the guess from the lines. */
  const [needsTouched, setNeedsTouched] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Payment terms typed once: the days written on the latest quotation win over the last order's (entry-burden J5/J7). */
  const quotedDays = daysFromTermsText(quotesQ.data?.[0]?.paymentTerms)
  useEffect(() => {
    if (termsTouched) return
    if (quotedDays !== null) setTerms(quotedDays)
    else if (termsQ.data) setTerms(termsQ.data.days)
  }, [termsQ.data, termsTouched, quotedDays])

  /** What an item is assigned to when nobody chooses: its rank-1 quote; a lone quote that cannot be ranked; otherwise nothing yet. */
  const defaultOf = (id: string): SupplierChoice => {
    const qs = byItem[id] ?? []
    return rankOne(qs)?.lineId ?? (qs.length === 1 ? qs[0].lineId : 'none')
  }
  const choiceOf = (id: string): SupplierChoice => choices[id] ?? defaultOf(id)
  const effective = Object.fromEntries(items.map(i => [i.id, choiceOf(i.id)])) as Record<string, SupplierChoice>
  const checks: Record<string, SplitCheck | null> = Object.fromEntries(items.map(i => [i.id, isSplit(splits[i.id]) ? checkSplit(i.qty, splits[i.id]) : null]))
  const anyIncomplete = Object.values(checks).some(c => c?.incomplete)

  /** Only quoted lines are ordered. An item the quotation never priced is shown and left out: the database refuses a line with no selling price. */
  const ordered = items.filter(it => it.quotedUnitPriceNet !== null)
  const gstOf = (id: string) => itemsQ.data?.find(q => q.id === id)?.gstRate ?? 18
  const unitOf = (it: ConvertItem) => it.quotedUnitPriceNet ?? 0
  const totals = orderTotals(items.filter(it => unitOf(it) > 0).map(it => ({ qty: checks[it.id]?.total ?? it.qty, unitPriceNet: unitOf(it), gstRate: gstOf(it.id) })))
  const lineCount = orderLineCount(ordered, splits)

  /** The legs this will make: one per supplier and currency. */
  const legs: string[] = (() => {
    const seen = new Map<string, string>()
    for (const it of ordered) {
      const lineIds = isSplit(splits[it.id]) ? splits[it.id].map(p => p.lineId) : [effective[it.id]]
      for (const lid of lineIds) {
        const q = (byItem[it.id] ?? []).find(x => x.lineId === lid)
        if (q) seen.set(`${q.supplierId}:${q.currency}`, `${q.supplierName} (${q.currency})`)
      }
    }
    return [...seen.values()]
  })()

  const guess = guessCommissioning(
    ordered.map(it => ({ number: items.indexOf(it) + 1, description: it.description, familyName: it.familyName })),
    effective,
    Object.fromEntries(items.map((it, i) => [i + 1, it.id])),
  )
  const needs = needsTouched ?? guess.needs
  /** The latest quotation revision the order follows: "QT-26-0058 R1". */
  const latestQuote = (() => {
    const qs = quotesQ.data ?? []
    if (qs.length === 0) return null
    const last = qs.reduce((a, b) => (b.revision > a.revision ? b : a))
    const first = qs.find(q => q.revision === 0) ?? last
    return quotationRef(last.number, first.issuedOn, last.revision)
  })()

  const ready = itemsQ.isSuccess && ordered.length > 0 && rankQ.isSuccess && !anyIncomplete
  const busy = convert.isPending

  const split = (itemId: string) => {
    const qs = byItem[itemId] ?? []
    setSplits(s => {
      const parts: Part[] = s[itemId] ? [...s[itemId]] : [{ key: crypto.randomUUID(), lineId: choiceOf(itemId), qty: null }]
      const next = nextRanked(qs, new Set(parts.map(p => p.lineId)))
      if (!next) return s
      return { ...s, [itemId]: [...parts, { key: crypto.randomUUID(), lineId: next.lineId, qty: undefined }] }
    })
  }
  const patchPart = (itemId: string, key: string, patch: Partial<Part>) =>
    setSplits(s => ({ ...s, [itemId]: (s[itemId] ?? []).map(p => (p.key === key ? { ...p, ...patch } : p)) }))
  const removePart = (itemId: string, key: string) => {
    const rest = (splits[itemId] ?? []).filter(p => p.key !== key)
    if (rest.length >= 2) {
      setSplits(s => ({ ...s, [itemId]: rest.map((p, i) => (i === 0 && p.qty === undefined ? { ...p, qty: null } : p)) }))
      return
    }
    setChoices(c => ({ ...c, [itemId]: rest[0]?.lineId ?? 'none' }))
    setSplits(s => Object.fromEntries(Object.entries(s).filter(([k]) => k !== itemId)))
  }

  const submit = async () => {
    if (!ready || submitting.current) return
    submitting.current = true
    setError(null)
    try {
      const id = await convert.mutateAsync({
        orderId: orderId.current,
        rfqId: rfq.id,
        items: buildSplitPayload(ordered, effective, {}, splits),
        customerPo: po.trim() || null,
        paymentTermsDays: terms,
        needsCommissioning: needs,
      })
      navigate(`/orders/${id}`)
    } catch (err) {
      setError(mapPgError(err, { entity: 'order' }).message)
      submitting.current = false
    }
  }

  const context = (
    <>
      {rfq.company.name} · {ordered.length} quoted {ordered.length === 1 ? 'line' : 'lines'}
      {totals.gross > 0 ? (
        <>
          {' '}
          · gross PKR <span className="num">{formatAmount(totals.gross)}</span>
        </>
      ) : null}
    </>
  )

  /** The price columns of a line: what we pay (in the quote's currency, then PKR) and what we sell at. */
  const priceCells = (it: ConvertItem, q: RankedQuote | undefined) => (
    <>
      <div className="num text-sm lg:text-right">
        {q ? (
          <>
            {priceTexts(q).price}
            <br />
            <span className="text-xs text-fg-muted">{priceTexts(q).pkr}</span>
          </>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </div>
      <div className="num text-sm lg:text-right">
        {it.quotedUnitPriceNet !== null ? (
          formatAmount(it.quotedUnitPriceNet)
        ) : (
          <span className="text-fg-muted">No selling price</span>
        )}
      </div>
    </>
  )

  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Mark won"
        titleChip={latestQuote ? <span className="num rounded border border-line-strong px-[6px] text-xs leading-5 text-fg-2">{latestQuote}</span> : undefined}
        context={itemsQ.isSuccess ? context : rfq.company.name}
        icon={FileCheck2}
        className="md:w-[min(1080px,calc(100vw-32px))]"
        lead={itemsQ.isSuccess && ordered.length > 0 ? `Creates ${lineCount} order ${lineCount === 1 ? 'line' : 'lines'}.` : undefined}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={FileCheck2} busy={busy} busyLabel="Creating" disabled={!ready} onClick={() => void submit()}>
              Create order
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="flex items-center gap-1 text-sm text-fg-2">
            <span>
              Creates order {nextNo.data ? <b className="num font-medium">{orderRef(nextNo.data)}</b> : 'a new order'}, each item with its best-ranked supplier.
            </span>
            <InfoTip label="How the order is made">
              Each item is assigned to the best-ranked quote: change it from the list, or split an item between two suppliers. Prices and terms copy from the quotation.
            </InfoTip>
          </p>

          {itemsQ.isPending || rankQ.isPending ? (
            <div className="grid gap-2" aria-busy="true" aria-label="Loading the lines">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : itemsQ.isError || rankQ.isError ? (
            <Banner
              tone="danger"
              title="Couldn't load the lines"
              action={
                <Button
                  onClick={() => {
                    void itemsQ.refetch()
                    void rankQ.refetch()
                  }}
                >
                  Try again
                </Button>
              }
            >
              Nothing was changed.
            </Banner>
          ) : items.length === 0 ? (
            <Banner tone="warning" title="This RFQ has no lines">
              Add the items to the RFQ first.
            </Banner>
          ) : (
            <div className="overflow-hidden rounded border" role="group" aria-label="Suppliers by line">
              <div className={cn('hidden border-b bg-sunken px-4 py-2 text-xs font-medium leading-snug text-fg-muted', GRID)}>
                <span />
                <span>Item</span>
                <span className="text-right">Qty</span>
                <span>Buy from, ranked</span>
                <span className="text-right">Supplier price</span>
                <span className="text-right">Sell at, net</span>
              </div>
              {items.map((it, idx) => {
                const n = idx + 1
                if (it.quotedUnitPriceNet === null)
                  return (
                    <div key={it.id} className="border-t border-line-strong first:border-t-0" data-testid={`convert-item-${n}`}>
                      <div className={cn('grid gap-2 bg-canvas px-4 py-3 text-sm leading-5 text-fg-muted', GRID)}>
                        <span className="num pt-px">{n}</span>
                        <b className="font-medium">{it.description}</b>
                        <span className="num lg:pt-1.5 lg:text-right">{it.qty}</span>
                        <span className="flex items-center gap-[6px] text-xs lg:pt-1" data-testid={`convert-item-${n}-left-out`}>
                          <Icon icon={EyeOff} size="sm" />
                          Not in the quotation. Left out of the order.
                        </span>
                        <span className="lg:text-right">—</span>
                        <span className="lg:text-right">No selling price</span>
                      </div>
                    </div>
                  )
                const qs = byItem[it.id] ?? []
                const parts = splits[it.id]
                const isSplitItem = isSplit(parts)
                const chk = checks[it.id]
                const choice = choiceOf(it.id)
                const q = qs.find(x => x.lineId === choice)
                const canSplit = qs.length >= 2 && (isSplitItem ? nextRanked(qs, new Set(parts.map(p => p.lineId))) !== undefined : choice !== 'none' && choice !== 'service')
                return (
                  <div key={it.id} className="border-t border-line-strong first:border-t-0" data-testid={`convert-item-${n}`}>
                    <div className={cn('grid gap-2 px-4 py-3 text-sm leading-5', GRID)}>
                      <span className="num pt-px text-fg-muted">{n}</span>
                      <div className="grid min-w-0 gap-0.5">
                        <b className="font-medium">{it.description}</b>
                        {[it.brandName, it.familyName].filter(Boolean).length > 0 ? <span className="text-xs text-fg-muted">{[it.brandName, it.familyName].filter(Boolean).join(' · ')}</span> : null}
                        {isSplitItem ? <span className="text-xs text-fg-2">split across {parts.length} suppliers</span> : null}
                      </div>
                      <span className="num text-sm lg:pt-1.5 lg:text-right">
                        {it.qty}
                        {it.unit ? <span className="text-fg-muted"> {it.unit}</span> : null}
                      </span>
                      {isSplitItem ? (
                        <>
                          <span className="text-xs text-fg-muted lg:pt-1">
                            Parts below must add up to <span className="num">{it.qty}</span>
                          </span>
                          <span />
                          <span />
                        </>
                      ) : (
                        <>
                          <RankedPicker
                            label={`Supplier for line ${n}`}
                            value={choice}
                            quotes={qs}
                            extras={EXTRAS.filter(e => e.value === 'service' || qs.length !== 1)}
                            onChange={v => setChoices(c => ({ ...c, [it.id]: v }))}
                          />
                          {priceCells(it, q)}
                        </>
                      )}
                    </div>

                    {isSplitItem
                      ? parts.map((p, i) => {
                          const pq = qs.find(x => x.lineId === p.lineId)
                          const qty = chk?.qtys[i] ?? 0
                          const auto = p.qty === null
                          return (
                            <div
                              key={p.key}
                              className={cn('grid gap-2 border-t border-dashed border-line-input bg-canvas px-4 pb-3 pt-2 text-sm', GRID)}
                              data-testid={`convert-item-${n}-part-${i + 1}`}
                            >
                              <span aria-hidden="true" className="hidden lg:block" />
                              <div className="grid min-w-0 content-start justify-items-start gap-0.5 text-xs text-fg-muted">
                                <span>
                                  Part {i + 1} of {parts.length}
                                </span>
                                {i > 0 ? (
                                  <Button size="sm" variant="quiet" icon={X} onClick={() => removePart(it.id, p.key)} aria-label={`Remove part ${i + 1}, line ${n}`}>
                                    Remove part
                                  </Button>
                                ) : null}
                              </div>
                              <div className="grid justify-items-end gap-0.5">
                                <NumberInput
                                  value={p.qty === undefined ? null : qty}
                                  onChange={v => patchPart(it.id, p.key, { qty: v === null ? (i === 0 ? null : undefined) : v })}
                                  aria-label={`Quantity, part ${i + 1}, line ${n}`}
                                  className={cn('w-16', auto && 'border-dashed bg-sunken')}
                                />
                                <span className="text-xs leading-snug text-fg-muted">{auto ? 'remainder, auto' : p.qty === undefined ? 'type it' : 'typed'}</span>
                              </div>
                              <RankedPicker
                                label={`Supplier for part ${i + 1}, line ${n}`}
                                value={p.lineId}
                                quotes={qs}
                                usedLineIds={new Set(parts.filter(x => x.key !== p.key).map(x => x.lineId))}
                                usedNote="A supplier used by another part of this item cannot be picked twice. Quotes from other suppliers can be added from the RFQ."
                                header={`Ranked quotes for item ${n}, with the reason`}
                                onChange={v => patchPart(it.id, p.key, { lineId: v })}
                              />
                              {priceCells(it, pq)}
                            </div>
                          )
                        })
                      : null}

                    {isSplitItem && chk ? (
                      <>
                        {chk.mismatch && !chk.incomplete ? (
                          <div role="alert" className="mx-4 mb-3 flex items-start gap-3 rounded border border-tone-warning-fg/30 bg-tone-warning-bg px-3 py-2 text-xs">
                            <Icon icon={TriangleAlert} size="sm" className="mt-px text-tone-warning-fg" />
                            <span>
                              <b className="font-medium">
                                Parts add up to {chk.total}, but the item is {it.qty}.
                              </b>{' '}
                              Check the quantities. Nothing is blocked: you can still create the order, and {chk.total > it.qty ? 'the extra is ordered as typed' : 'only what is typed is ordered'}.
                            </span>
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t bg-sunken px-4 py-3 text-sm">
                          <span data-testid={`convert-item-${n}-sum`}>
                            Parts:{' '}
                            <span className="num font-medium">
                              {chk.qtys.join(' + ')} = {chk.total}
                            </span>{' '}
                            of <span className="num font-medium">{it.qty}</span>
                          </span>
                          <span className="text-xs text-fg-muted">
                            {chk.incomplete ? 'Type a quantity for every part to create the order.' : 'Each part becomes its own line with its supplier, at the same selling price.'}
                          </span>
                        </div>
                      </>
                    ) : null}

                    {canSplit ? (
                      <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-1">
                        <Button size="sm" icon={Split} onClick={() => split(it.id)} aria-label={`Split this item, line ${n}`}>
                          Split this item
                        </Button>
                        <span className="text-xs text-fg-muted">Adds a part with the next supplier in the ranking. Type its quantity; the first part takes the rest.</span>
                      </div>
                    ) : null}
                  </div>
                )
              })}
              <div className="grid justify-end gap-1 border-t bg-sunken px-4 py-3 text-sm" aria-label="Order totals">
                <div className="flex justify-between gap-8">
                  <span className="text-fg-muted">Net</span>
                  <span className="num">{formatAmount(totals.net)}</span>
                </div>
                <div className="flex justify-between gap-8">
                  <span className="text-fg-muted">GST</span>
                  <span className="num">{formatAmount(totals.gst)}</span>
                </div>
                <div className="flex justify-between gap-8 font-medium">
                  <span>Gross</span>
                  <span className="num">{formatAmount(totals.gross)}</span>
                </div>
              </div>
            </div>
          )}

          {itemsQ.isSuccess && rankQ.isSuccess && legs.length > 0 ? (
            <p className="flex items-center gap-2 text-xs text-fg-muted">
              <Icon icon={Truck} size="sm" />
              <span>
                {legs.length === 1 ? '1 supplier order' : `${legs.length} supplier orders`}: {legs.join(', ')}.
              </span>
            </p>
          ) : null}

          <Checkbox
            label="Needs commissioning"
            help={needsTouched === null && guess.reason ? `Set because ${guess.reason}. Plans the engineer's job and holds the invoice reminder until it is done.` : "Plans the engineer's job and holds the invoice reminder until it is done."}
            checked={needs}
            onCheckedChange={v => setNeedsTouched(v === true)}
          />

          <div className="grid max-w-[360px] gap-[6px]">
            <label htmlFor="convert-po" className="text-sm font-medium">
              Customer PO number <span className="font-regular text-xs text-fg-muted">optional, add it from the order later</span>
            </label>
            <TextField id="convert-po" value={po} onChange={e => setPo(e.target.value)} placeholder="Not yet received" autoComplete="off" />
          </div>

          <Field
            label="Payment terms"
            requirement="optional"
            help="Days the customer has to pay after the invoice. After that the payment counts as late."
            source={
              quotedDays !== null && !termsTouched
                ? 'from the quotation'
                : termsQ.data && !termsTouched
                  ? `from the last order, ${orderRef(termsQ.data.orderNumber)}`
                  : !termsTouched && terms === null && termsQ.isSuccess
                    ? `default terms, ${defaultTerms} days`
                    : undefined
            }
            edited={termsTouched}
          >
            <NumberInput
              value={terms}
              onChange={v => {
                setTermsTouched(true)
                setTerms(v === null ? null : Math.max(0, Math.round(v)))
              }}
              suffix="days from invoice"
              placeholder={`${defaultTerms} (default)`}
              aria-label="Payment terms in days"
            />
          </Field>

          {error ? (
            <Banner tone="danger" title="Couldn't create the order">
              {error} Nothing was created twice: pressing Create order again is safe.
            </Banner>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
