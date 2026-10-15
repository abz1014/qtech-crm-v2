import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileCheck2 } from 'lucide-react'
import { formatAmount } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { Skeleton } from '@/ui/Skeleton'
import type { InquiryRow, RfqHeader } from '@/features/rfqs/api'
import type { RateTable } from '@/features/rfqs/lib'
import { useQuoteItems } from '@/features/quotations/hooks'
import { useConvertRfq, useLastTerms } from '@/features/orders/hooks'
import { buildPayload, defaultChoices, unpricedItems, type ConvertItem, type ConvertQuote, type SupplierChoice } from '@/features/orders/lib/convert'
import { orderTotals } from '@/features/orders/lib/orderMath'
import { orderRef } from '@/lib/refs'

/*
 * "Mark won" (O01; g2-rfq-detail.html, frame "Won: create the order"). One confirm creates the order through
 * convert_rfq_to_order with an id made here, so a double submit (a double click, Enter twice, a retry after a dropped connection)
 * creates one order. Afterwards the order opens.
 *
 * FE-2 entry burden, listed for the commit:
 *   required     nothing typed when the quotation priced every line. A line the quotation never priced needs a selling price.
 *   pre-filled   the supplier on each line (the lowest comparable quote, today's rates), the payment terms (the company's last order),
 *                prices, delivery and the rest from the RFQ, the date (today) and the owner (the RFQ's).
 *   optional     the customer PO number (it can be added from the order later), a different supplier on any line.
 *   interactions Mark won (1), Create order (2).
 */

export function ConvertDialog({ rfq, inquiries, rates, onClose }: { rfq: RfqHeader; inquiries: InquiryRow[]; rates: RateTable; onClose: () => void }) {
  const navigate = useNavigate()
  const itemsQ = useQuoteItems(rfq.id, true)
  const termsQ = useLastTerms(rfq.company.id, true)
  const convert = useConvertRfq(rfq.id)
  /** Made once per open dialog and kept for any retry: the database returns the same order for the same id. */
  const orderId = useRef(crypto.randomUUID())
  const submitting = useRef(false)

  const items: ConvertItem[] = useMemo(
    () => (itemsQ.data ?? []).map(i => ({ id: i.id, description: i.description, qty: i.qty, unit: i.unit, quotedUnitPriceNet: i.quotedUnitPriceNet })),
    [itemsQ.data],
  )
  const quotes: ConvertQuote[] = useMemo(
    () => inquiries.flatMap(inq => inq.lines.map(l => ({ lineId: l.id, itemId: l.itemId, supplierName: inq.supplierName, unitPrice: l.unitPrice, currency: l.currency }))),
    [inquiries],
  )
  const defaults = useMemo(() => defaultChoices(items, quotes, rates), [items, quotes, rates])

  const [choices, setChoices] = useState<Record<string, SupplierChoice>>({})
  const [typed, setTyped] = useState<Record<string, number | null>>({})
  const [po, setPo] = useState('')
  const [terms, setTerms] = useState<number | null>(null)
  const [termsTouched, setTermsTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The supplier list opens by itself while a line still needs a price, and stays as the person left it once they toggle it. */
  const [listOpen, setListOpen] = useState<boolean | null>(null)

  useEffect(() => {
    if (!termsTouched && termsQ.data) setTerms(termsQ.data.days)
  }, [termsQ.data, termsTouched])

  const choiceOf = (id: string): SupplierChoice => choices[id] ?? defaults.find(d => d.itemId === id)?.choice ?? 'none'
  const effective = useMemo(() => Object.fromEntries(items.map(i => [i.id, choices[i.id] ?? defaults.find(d => d.itemId === i.id)?.choice ?? 'none'])), [items, choices, defaults])
  const missing = unpricedItems(items, typed)
  const priced = items.filter(i => i.quotedUnitPriceNet !== null)
  const gross = orderTotals([
    ...priced.map(i => ({ qty: i.qty, unitPriceNet: i.quotedUnitPriceNet as number, gstRate: itemsQ.data?.find(q => q.id === i.id)?.gstRate ?? 18 })),
    ...items.filter(i => i.quotedUnitPriceNet === null && (typed[i.id] ?? 0) > 0).map(i => ({ qty: i.qty, unitPriceNet: typed[i.id] as number, gstRate: itemsQ.data?.find(q => q.id === i.id)?.gstRate ?? 18 })),
  ]).gross
  const sourced = items.filter(i => effective[i.id] !== 'none' && effective[i.id] !== 'service').length

  const ready = itemsQ.isSuccess && items.length > 0 && missing.length === 0
  const busy = convert.isPending

  const submit = async () => {
    if (!ready || submitting.current) return
    submitting.current = true
    setError(null)
    try {
      const id = await convert.mutateAsync({
        orderId: orderId.current,
        rfqId: rfq.id,
        items: buildPayload(items, effective, typed),
        customerPo: po.trim() || null,
        paymentTermsDays: terms,
      })
      navigate(`/orders/${id}`)
    } catch (err) {
      setError(mapPgError(err, { entity: 'order' }).message)
      submitting.current = false
    }
  }

  const context = (
    <>
      {rfq.company.name} · {items.length} {items.length === 1 ? 'line' : 'lines'}
      {gross > 0 ? <> · gross PKR <span className="num">{formatAmount(gross)}</span></> : null}
    </>
  )

  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Mark won"
        context={itemsQ.isSuccess ? context : rfq.company.name}
        icon={FileCheck2}
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
          <p className="text-sm text-fg-2">
            Creates an order with the quoted lines, prices and payment terms. Each line takes its supplier from the lowest quote. The quotation revisions stay on the RFQ as they were sent.
          </p>

          {itemsQ.isPending ? (
            <div className="grid gap-2" aria-busy="true" aria-label="Loading the lines">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : itemsQ.isError ? (
            <Banner tone="danger" title="Couldn't load the lines" action={<Button onClick={() => void itemsQ.refetch()}>Try again</Button>}>
              Nothing was changed.
            </Banner>
          ) : items.length === 0 ? (
            <Banner tone="warning" title="This RFQ has no lines">
              Add the items to the RFQ first.
            </Banner>
          ) : null}

          <Field label="Customer PO number" requirement="optional" help="Add it from the order later if it has not arrived.">
            <TextField value={po} onChange={e => setPo(e.target.value)} placeholder="Not yet received" autoComplete="off" />
          </Field>

          <Field
            label="Payment terms"
            requirement="optional"
            source={termsQ.data && !termsTouched ? `from the last order, ${orderRef(termsQ.data.orderNumber)}` : undefined}
            edited={termsTouched}
          >
            <NumberInput
              value={terms}
              onChange={v => {
                setTermsTouched(true)
                setTerms(v === null ? null : Math.max(0, Math.round(v)))
              }}
              suffix="days from invoice"
              placeholder="Not set"
              aria-label="Payment terms in days"
            />
          </Field>

          {itemsQ.isSuccess && items.length > 0 ? (
            <details className="rounded border" open={listOpen ?? missing.length > 0} onToggle={e => setListOpen((e.currentTarget as HTMLDetailsElement).open)}>
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
                Suppliers by line
                <span className="ml-2 text-xs font-regular text-fg-muted">
                  {sourced} of {items.length} sourced
                  {missing.length > 0 ? `, ${missing.length} need a price` : ''}
                </span>
              </summary>
              <ul className="grid gap-3 border-t p-3" aria-label="Suppliers by line">
                {items.map((it, n) => {
                  const d = defaults.find(x => x.itemId === it.id)
                  return (
                    <li key={it.id} className="grid gap-2">
                      <p className="text-sm">
                        <span className="num mr-2 text-fg-muted">{n + 1}</span>
                        {it.description}
                        <span className="num ml-2 text-fg-muted">
                          {it.qty}
                          {it.unit ? ` ${it.unit}` : ''}
                        </span>
                      </p>
                      <Select
                        aria-label={`Supplier for line ${n + 1}`}
                        value={choiceOf(it.id)}
                        onChange={e => setChoices(c => ({ ...c, [it.id]: e.target.value }))}
                        options={(d?.options ?? []).map(o => ({ value: o.value, label: o.lowest ? `${o.label} (lowest)` : o.label }))}
                      />
                      {it.quotedUnitPriceNet === null ? (
                        <Field label="Selling price, net PKR" requirement="required" help="The quotation did not price this line.">
                          <NumberInput
                            value={typed[it.id] ?? null}
                            onChange={v => setTyped(t => ({ ...t, [it.id]: v }))}
                            prefix="PKR"
                            aria-label={`Selling price, net PKR, line ${n + 1}`}
                          />
                        </Field>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </details>
          ) : null}

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
