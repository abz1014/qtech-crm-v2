import { useEffect, useMemo, useRef, useState } from 'react'
import { FileCheck2, FileText, Info, Lock, TriangleAlert } from 'lucide-react'
import { useSession } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { convertToPaisa, formatAmount, formatPaisa, formatRate } from '@/lib/money'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef, poRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextArea, TextField } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { useFxLatest } from '@/features/rfqs/hooks'
import { useCompanyProfile } from '@/features/settings/hooks'
import { profileGaps } from '@/features/quotations/lib/profileGaps'
import { SettingsLink } from '@/features/quotations/SettingsLink'
import type { OrderHeader, OrderLegRow } from '@/features/orders/api'
import { useUpdateLeg } from '@/features/orders/hooks'
import { expectedAfterIssue, legLetter } from '@/features/orders/lib/legModel'
import { loadPoPdfData, loadPoPreviewData } from '@/features/purchaseOrders/api'
import { useIssuePo, useLastPoToSupplier, useLegPo, useNextPoNumber, usePoPrefill, useSetLegCurrency, useStorePoPdf } from '@/features/purchaseOrders/hooks'
import { generatePurchaseOrderPdf } from '@/features/purchaseOrders/pdf/generate'
import {
  INCOTERMS,
  issueLines,
  lineTotal,
  missingPrices,
  poTotal,
  priceOf,
  sourceOf,
  sourceText,
  termsDefaults,
  type PrefillRow,
  type PriceSource,
  type Typed,
} from '@/features/purchaseOrders/lib/prefill'

/*
 * Issue purchase order (O07; g2-order-detail.html "Issue PO dialog"). Opened from "Issue PO" on a leg.
 *
 * FE-2 entry burden, listed for the commit:
 *   required     a price for every line. Each line is pre-filled from the first source that has one (the order, the supplier's quote,
 *                the supplier's last PO) and says which; only a line nothing knows needs a typed number.
 *   pre-filled   the currency (frozen from the leg), the incoterm and the delivery and payment terms (the supplier's last PO, else the
 *                company profile's PO terms), ship-to (the company profile's address), the date (today), the signatory (the signed-in person).
 *   optional     any edited price or term. Terms are copied from the supplier's last PO; change them only if this order differs.
 *   interactions "Issue PO" on the leg (1), then "Issue PO" in the dialog (2), with nothing typed when every line is priced.
 *
 * Issuing stamps the leg placed today when it is empty (the RPC does this), writes the issued prices back to the order lines, and, when the
 * leg has no expected date, suggests one from the placed date plus the supplier's lead time. The PO is a snapshot: later edits to the
 * order do not change it. The PDF never blocks issuing: with the legal name or address missing from the company profile the PO is still
 * issued, and a plain banner links to Settings, Company.
 */
const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'CNY']

function SourceChip({ source, children }: { source: PriceSource; children: string }) {
  const look: Record<PriceSource, string> = {
    order: 'border-tone-info-fg/25 bg-tone-info-bg text-tone-info-fg',
    quote: 'border-tone-info-fg/25 bg-tone-info-bg text-tone-info-fg',
    last_po: 'border-tone-warning-fg/25 bg-tone-warning-bg text-tone-warning-fg',
    typed: 'border-dashed border-line-strong bg-surface text-fg-muted',
  }
  return <span className={cn('inline-flex h-5 items-center rounded border px-2 text-xs font-medium', look[source])}>{children}</span>
}

export function IssuePoDialog({ order, leg, legIndex, onClose }: { order: OrderHeader; leg: OrderLegRow; legIndex: number; onClose: () => void }) {
  const { toast } = useToast()
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const today = businessToday()
  const prefill = usePoPrefill(leg.id, true)
  const last = useLastPoToSupplier(leg.supplierId, true)
  const existing = useLegPo(leg.id)
  const nextNumber = useNextPoNumber(existing.isSuccess && !existing.data)
  const profileQ = useCompanyProfile()
  const fx = useFxLatest()
  const issue = useIssuePo(order.id)
  const storePdf = useStorePoPdf(order.id)
  const setCurrency = useSetLegCurrency(order.id)
  const updateLeg = useUpdateLeg(order.id)
  const profile = profileQ.data
  const gaps = profileGaps(profile)

  const [typed, setTyped] = useState<Typed>({})
  const [incoterm, setIncoterm] = useState('')
  const [delivery, setDelivery] = useState('')
  const [payment, setPayment] = useState('')
  const [shipTo, setShipTo] = useState('')
  const [edited, setEdited] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const seeded = useRef(false)
  /** Made once per open dialog and kept for any retry: the database returns the same PO for the same id. */
  const claimId = useRef(crypto.randomUUID())
  const submitting = useRef(false)

  const ccy = leg.currency
  const rows = prefill.data ?? []
  const defaults = useMemo(() => termsDefaults(last.data ?? null, profile), [last.data, profile])

  // Seed the terms once, when everything they come from has arrived. Nothing here overwrites what is later typed.
  useEffect(() => {
    if (seeded.current || last.isPending || profileQ.isPending) return
    seeded.current = true
    setIncoterm(defaults.incoterm.value)
    setDelivery(defaults.delivery.value)
    setPayment(defaults.payment.value)
    setShipTo(defaults.shipTo.value)
  }, [last.isPending, profileQ.isPending, defaults])

  const revision = existing.data ? existing.data.revision + 1 : 0
  const number = existing.data?.number ?? nextNumber.data
  const firstYear = existing.data?.firstIssuedOn ?? today
  const tag = number !== undefined ? `${poRef(number, firstYear)} · R${revision}` : revision > 0 ? `R${revision}` : 'New PO · R0'

  const missing = missingPrices(rows, typed)
  const total = poTotal(rows, typed)
  const loading = prefill.isPending || last.isPending || existing.isPending || profileQ.isPending
  const loadFailed = prefill.isError || last.isError || existing.isError
  const ready = !loading && !loadFailed && ccy !== null && rows.length > 0 && missing.length === 0
  const rate = ccy && ccy !== 'PKR' ? (fx.data ?? []).find(r => r.currency === ccy) : undefined
  const pkr = rate && rate.staleness !== 'unusable' ? convertToPaisa(total, rate.ratePkr) : null
  const busy = issue.isPending || storePdf.isPending
  const source = (field: 'incoterm' | 'delivery' | 'payment' | 'shipTo') => {
    const d = { incoterm: defaults.incoterm, delivery: defaults.delivery, payment: defaults.payment, shipTo: defaults.shipTo }[field]
    return d.source ?? undefined
  }
  const touch = (field: string) => setEdited(e => ({ ...e, [field]: true }))

  const draftLines = () =>
    rows.map(r => ({
      order_item_id: r.orderItemId,
      description: r.description,
      qty: r.qty,
      unit: r.unit,
      unit_price: priceOf(r, typed) ?? 0,
      price_source: sourceOf(r, typed),
    }))

  const submit = async () => {
    if (!ready || submitting.current || ccy === null) return
    submitting.current = true
    setError(null)
    try {
      const po = await issue.mutateAsync({
        id: claimId.current,
        legId: leg.id,
        lines: issueLines(rows, typed),
        incoterm: incoterm.trim() || null,
        deliveryTerms: delivery.trim() || null,
        paymentTerms: payment.trim() || null,
        shipTo: shipTo.trim() || null,
      })
      // The leg is placed (the RPC stamped today if it was not placed yet). Suggest the expected date from the lead time, once, when it has none.
      const expected = expectedAfterIssue(leg, today)
      if (expected) updateLeg.mutate({ id: leg.id, patch: { expected_on: expected } })
      const ref = `${poRef(po.number, po.firstIssuedOn)} · R${po.revision}`
      let pdf: Blob | null = null
      let pdfNote: string | null = null
      if (profile && gaps.length === 0) {
        try {
          const blob = await generatePurchaseOrderPdf(await loadPoPdfData(po.id), profile)
          await storePdf.mutateAsync({ po, pdf: blob })
          pdf = blob
        } catch (err) {
          pdfNote = mapPgError(err, { entity: 'PDF' }).message
        }
      } else {
        pdfNote = `Add the ${gaps.join(' and ')} in Settings, Company to make its PDF.`
      }
      onClose()
      toast({
        title: `Issued ${ref}`,
        body: `Leg ${legLetter(legIndex)} is placed.${pdfNote ? ` ${pdfNote}` : ''}`,
        tone: 'success',
        action: pdf
          ? {
              label: 'Open PDF',
              onClick: () => {
                const url = URL.createObjectURL(pdf as Blob)
                window.open(url, '_blank')
                setTimeout(() => URL.revokeObjectURL(url), 60_000)
              },
            }
          : undefined,
      })
    } catch (err) {
      setError(mapPgError(err, { entity: 'purchase order' }).message)
      submitting.current = false
    }
  }

  const preview = async () => {
    if (!profile || gaps.length > 0 || ccy === null || !user) {
      toast({ title: 'The PDF needs the company profile', body: `Add the ${gaps.join(' and ') || 'legal name and address'} in Settings, Company.`, tone: 'danger' })
      return
    }
    setPreviewing(true)
    // A tab opened inside the tap is not blocked as a pop-up; it is pointed at the PDF once the PDF is in hand.
    const tab = window.open('', '_blank')
    try {
      const data = await loadPoPreviewData({
        legId: leg.id,
        number: number ?? 0,
        revision,
        issuedOn: today,
        currency: ccy,
        lines: draftLines(),
        incoterm: incoterm.trim() || null,
        deliveryTerms: delivery.trim() || null,
        paymentTerms: payment.trim() || null,
        shipTo: shipTo.trim() || null,
        signatoryId: user.id,
      })
      const blob = await generatePurchaseOrderPdf(data, profile)
      const url = URL.createObjectURL(blob)
      if (tab) tab.location.href = url
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      tab?.close()
      toast({ title: 'Could not make the preview', body: mapPgError(err, { entity: 'PDF' }).message, tone: 'danger' })
    } finally {
      setPreviewing(false)
    }
  }

  const columns: Column<PrefillRow>[] = [
    {
      id: 'item',
      header: 'Item',
      value: r => r.description,
      cell: r => (
        <span className="grid min-w-0 gap-px">
          <span className="truncate">{r.description}</span>
          <span className="text-xs text-fg-muted">Order line {r.position + 1}</span>
        </span>
      ),
    },
    {
      id: 'qty',
      header: 'Qty',
      kind: 'num',
      value: r => r.qty,
      width: 70,
      cell: r => (
        <span className="num">
          {r.qty}
          {r.unit ? <span className="text-fg-muted"> {r.unit}</span> : null}
        </span>
      ),
    },
    {
      id: 'price',
      header: `Unit price, ${ccy ?? '—'}`,
      align: 'right',
      width: 140,
      cell: r => {
        const n = rows.findIndex(x => x.orderItemId === r.orderItemId)
        return (
          <NumberInput
            aria-label={`Unit price, line ${n + 1}`}
            decimals={2}
            value={priceOf(r, typed)}
            className={cn(priceOf(r, typed) === null && 'border-tone-warning-fg')}
            onChange={v => setTyped(t => ({ ...t, [r.orderItemId]: v }))}
          />
        )
      },
    },
    {
      id: 'source',
      header: 'Price source',
      width: 200,
      cell: r => {
        const n = rows.findIndex(x => x.orderItemId === r.orderItemId)
        const st = sourceText(r, typed, today)
        return (
          <span data-testid={`po-source-${n + 1}`} className="grid gap-px">
            <SourceChip source={sourceOf(r, typed)}>{st.chip}</SourceChip>
            <span className="truncate text-xs text-fg-muted">{st.detail}</span>
          </span>
        )
      },
    },
    {
      id: 'total',
      header: `Line total, ${ccy ?? '—'}`,
      kind: 'money',
      paisa: 'always',
      value: r => lineTotal(r.qty, priceOf(r, typed)),
      width: 150,
    },
  ]
  const conversion =
    pkr !== null && rate ? (
      <span>
        Total in {ccy} · ≈ PKR <span className="num">{formatPaisa(pkr, 'auto')}</span> at <span className="num">{formatRate(rate.ratePkr)}</span>, {rate.source === 'manual' ? 'manual' : 'auto'} rate of{' '}
        {formatDay(rate.asOf).replace(/^\w{3} /, '')}
      </span>
    ) : undefined

  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Issue purchase order"
        context={`Leg ${legLetter(legIndex)} · ${leg.supplierName} · for ${orderRef(order.number)}`}
        icon={FileCheck2}
        size="lg"
        className="md:w-[820px]"
        meta={<span className="num inline-flex h-6 items-center rounded border border-line-strong bg-surface px-2 text-xs text-fg-2">{tag}</span>}
        lead={
          <Button icon={FileText} onClick={() => void preview()} busy={previewing} busyLabel="Preparing" disabled={loading || ccy === null || rows.length === 0}>
            Preview PDF
          </Button>
        }
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={FileCheck2} busy={busy} busyLabel="Issuing" disabled={!ready} onClick={() => void submit()}>
              Issue PO
            </Button>
          </>
        }
      >
        {loading ? (
          <div className="grid gap-3" aria-busy="true" aria-label="Loading the purchase order">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : loadFailed ? (
          <Banner tone="danger" title="Couldn't prepare the purchase order" action={<Button onClick={() => void prefill.refetch()}>Try again</Button>}>
            Nothing was changed.
          </Banner>
        ) : (
          <div className="grid gap-5">
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Currency" help={ccy ? 'Set on this leg. Change it on the leg, not here.' : 'This leg has no currency yet. Choose one to price the PO.'}>
                {ccy ? (
                  <TextField value={ccy} readOnly suffix={<Icon icon={Lock} />} aria-label="Currency" />
                ) : (
                  <Select
                    aria-label="Currency"
                    value=""
                    placeholder="Choose a currency"
                    onChange={e => e.target.value && setCurrency.mutate({ legId: leg.id, currency: e.target.value }, { onSuccess: () => void prefill.refetch() })}
                    options={CURRENCIES.map(c => ({ value: c, label: c }))}
                  />
                )}
              </Field>
              <Field label="Incoterm" source={!edited.incoterm ? source('incoterm') : undefined} edited={edited.incoterm}>
                <Select
                  value={incoterm}
                  placeholder="Not set"
                  onChange={e => {
                    touch('incoterm')
                    setIncoterm(e.target.value)
                  }}
                  options={[...new Set([...(incoterm && !INCOTERMS.includes(incoterm as (typeof INCOTERMS)[number]) ? [incoterm] : []), ...INCOTERMS])].map(v => ({ value: v, label: v }))}
                />
              </Field>
              <Field label="Delivery terms" source={!edited.delivery ? source('delivery') : undefined} edited={edited.delivery}>
                <TextField
                  value={delivery}
                  onChange={e => {
                    touch('delivery')
                    setDelivery(e.target.value)
                  }}
                  autoComplete="off"
                />
              </Field>
              <Field label="Payment terms" className="md:col-span-1" source={!edited.payment ? source('payment') : undefined} edited={edited.payment}>
                <TextField
                  value={payment}
                  onChange={e => {
                    touch('payment')
                    setPayment(e.target.value)
                  }}
                  autoComplete="off"
                />
              </Field>
              <Field label="Ship to" className="md:col-span-2" source={!edited.shipTo ? source('shipTo') : undefined} edited={edited.shipTo}>
                <TextArea
                  rows={2}
                  value={shipTo}
                  onChange={e => {
                    touch('shipTo')
                    setShipTo(e.target.value)
                  }}
                />
              </Field>
            </div>

            {rows.length === 0 ? (
              <Banner tone="warning" title="This leg has no goods lines">
                Put a goods line on the leg before issuing a purchase order.
              </Banner>
            ) : (
              <>
              <DataTable
                label="PO lines"
                rows={rows}
                getRowId={r => r.orderItemId}
                columns={columns}
                twoLine
              />
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded border bg-sunken px-4 py-3 text-xs text-fg-2">
                <span>{conversion ?? `Total in ${ccy ?? '—'}`}</span>
                <span className="num text-sm font-medium text-fg" data-testid="po-total">
                  {ccy ?? ''} {formatAmount(total, 'always')}
                </span>
              </div>
              </>
            )}

            <div className="flex items-start gap-3 rounded bg-sunken px-4 py-3 text-sm text-fg-2">
              <Icon icon={Info} className="mt-[2px] text-fg-muted" />
              <p>
                Incoterm and terms are copied from this supplier&rsquo;s last PO; change them only if this order differs. Issuing saves these prices back to the order items, so the order keeps one
                working price, and stamps leg {legLetter(legIndex)} as placed today. The PO is a snapshot; later edits to the order do not change it.
              </p>
            </div>

            {missing.length > 0 ? (
              <p className="flex items-center gap-2 text-sm text-tone-warning-fg" data-testid="po-missing">
                <Icon icon={TriangleAlert} /> {missing.length === 1 ? 'One line needs a price' : `${missing.length} lines need a price`} before the PO can be issued.
              </p>
            ) : null}
            {gaps.length > 0 ? (
              <Banner tone="warning" title={`A PDF needs the company's ${gaps.join(' and ')}`}>
                The PO can still be issued; its PDF is made once the profile is complete. <SettingsLink />
              </Banner>
            ) : null}
            {error ? (
              <Banner tone="danger" title="Couldn't issue the purchase order">
                {error} Nothing was issued twice: pressing Issue PO again is safe.
              </Banner>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
