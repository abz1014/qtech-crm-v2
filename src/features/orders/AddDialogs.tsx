import { useEffect, useRef, useState } from 'react'
import { PackagePlus, Truck } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Checkbox } from '@/ui/form/Checkbox'
import { Field } from '@/ui/form/Field'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useAddItem, useAddLeg, useOrderItems, useSupplierChoices, useUpdateItem } from '@/features/orders/hooks'
import { gstOptions, STANDARD_GST } from '@/features/orders/lib/orderMath'
import { legLabel } from '@/features/orders/lib/legModel'

/*
 * "Add line" and "Add leg" on the order page (g2-order-detail.html: the buttons in the Items and Procurement legs headers).
 *
 * FE-2 entry burden, listed for the commit:
 *   Add line   required: a description and a net unit price. Quantity is 1; GST is the order's rate (0 when the whole order is exempt,
 *              else 18); the leg is optional; a service has no leg. Supplier price is optional.
 *   Add leg    required: the supplier. Currency is pre-filled from what that supplier last quoted or billed in (PKR when unknown).
 */
const CURRENCIES = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'CNY']

export function AddLineDialog({ order, items, legs, onClose }: { order: OrderHeader; items: readonly OrderItemRow[]; legs: readonly OrderLegRow[]; onClose: () => void }) {
  const { toast } = useToast()
  const add = useAddItem(order.id)
  const exempt = items.length > 0 && items.every(i => (i.gstRate ?? STANDARD_GST) === 0)
  const [description, setDescription] = useState('')
  const [qty, setQty] = useState<number | null>(1)
  const [unit, setUnit] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const [gst, setGst] = useState<number | null>(exempt ? 0 : STANDARD_GST)
  const [service, setService] = useState(false)
  const [legId, setLegId] = useState('')
  const [supplierPrice, setSupplierPrice] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  // BUG-RV-07: one id per opening of the dialog (it mounts on open), and a lock so a double tap sends one request.
  const id = useRef(crypto.randomUUID())
  const sending = useRef(false)
  const ccy = legs.find(l => l.id === legId)?.currency ?? ''
  const ready = description.trim() !== '' && qty !== null && qty > 0 && price !== null && price >= 0 && gst !== null && gst >= 0 && gst <= 100

  const save = async () => {
    if (!ready || sending.current) return
    sending.current = true
    setError(null)
    try {
      await add.mutateAsync({
        id: id.current,
        orderId: order.id,
        position: items.length,
        description: description.trim(),
        qty: qty as number,
        unit: unit.trim() || null,
        unitPriceNet: price as number,
        gstRate: gst as number,
        isService: service,
        legId: legId || null,
        supplierUnitPrice: supplierPrice,
      })
      toast({ title: 'Line added', body: `${orderRef(order.number)} · ${description.trim()}` })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'line' }).message)
    } finally {
      sending.current = false
    }
  }

  return (
    <Dialog open busy={add.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Add line"
        context={`${orderRef(order.number)} · ${order.companyName}`}
        icon={PackagePlus}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={add.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={add.isPending} busyLabel="Adding" disabled={!ready} onClick={() => void save()}>
              Add line
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Description" requirement="required">
            <TextField value={description} onChange={e => setDescription(e.target.value)} autoComplete="off" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantity">
              <NumberInput value={qty} onChange={setQty} />
            </Field>
            <Field label="Unit" requirement="optional">
              <TextField value={unit} onChange={e => setUnit(e.target.value)} placeholder="ea, kit, job" autoComplete="off" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit price, net PKR" requirement="required">
              <NumberInput value={price} onChange={setPrice} prefix="PKR" />
            </Field>
            <Field label="GST rate" source={exempt ? 'the order is exempt' : undefined}>
              <Select value={String(gst ?? STANDARD_GST)} onChange={e => setGst(Number(e.target.value))} options={gstOptions()} />
            </Field>
          </div>
          <Checkbox label="A service (commissioning or a service charge): no supplier" checked={service} onCheckedChange={v => setService(v === true)} />
          {!service && legs.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Supplied by" requirement="optional">
                <Select
                  value={legId}
                  onChange={e => setLegId(e.target.value)}
                  placeholder="Not sourced yet"
                  options={legs.map(l => ({ value: l.id, label: l.currency ? `${l.supplierName} (${l.currency})` : l.supplierName }))}
                />
              </Field>
              {legId ? (
                <Field label={`Supplier unit price${ccy ? `, ${ccy}` : ''}`} requirement="optional">
                  <NumberInput value={supplierPrice} onChange={setSupplierPrice} prefix={ccy || undefined} />
                </Field>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <Banner tone="danger" title="Couldn't add the line">
              {error}
            </Banner>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function AddLegDialog({ order, legs, onClose }: { order: OrderHeader; legs: readonly OrderLegRow[]; onClose: () => void }) {
  const { toast } = useToast()
  const add = useAddLeg(order.id)
  const choices = useSupplierChoices(true)
  const id = useRef(crypto.randomUUID())
  const sending = useRef(false)
  const [supplierId, setSupplierId] = useState('')
  const [currency, setCurrency] = useState('PKR')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const used = new Set(legs.map(l => `${l.supplierId}:${l.currency ?? ''}`))
  const chosen = choices.data?.find(c => c.id === supplierId)

  useEffect(() => {
    if (chosen && !touched) setCurrency(chosen.lastCurrency ?? 'PKR')
  }, [chosen, touched])

  const duplicate = used.has(`${supplierId}:${currency}`)
  const save = async () => {
    if (!supplierId || duplicate || sending.current) return
    sending.current = true
    setError(null)
    try {
      await add.mutateAsync({ id: id.current, supplierId, currency })
      toast({ title: 'Supplier added', body: `${orderRef(order.number)} · ${chosen?.name ?? ''}` })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'supplier order' }).message)
    } finally {
      sending.current = false
    }
  }

  return (
    <Dialog open busy={add.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Add supplier"
        context={`${orderRef(order.number)} · one supplier in one currency`}
        icon={Truck}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={add.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={add.isPending} busyLabel="Adding" disabled={!supplierId || duplicate} onClick={() => void save()}>
              Add supplier
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <Field label="Supplier" requirement="required" help="Suppliers you have asked, ordered from or carry a brand for.">
            <Select
              value={supplierId}
              onChange={e => setSupplierId(e.target.value)}
              placeholder={choices.isPending ? 'Loading suppliers' : 'Choose a supplier'}
              options={(choices.data ?? []).map(c => ({ value: c.id, label: c.name }))}
            />
          </Field>
          <Field
            label="Currency"
            source={chosen && !touched ? (chosen.lastCurrency ? `${chosen.name} last used ${chosen.lastCurrency}` : 'PKR unless you change it') : undefined}
            edited={touched}
            error={duplicate ? 'This order already has this supplier in this currency.' : undefined}
          >
            <Select
              value={currency}
              onChange={e => {
                setTouched(true)
                setCurrency(e.target.value)
              }}
              options={CURRENCIES.map(c => ({ value: c, label: c }))}
            />
          </Field>
          {error ? (
            <Banner tone="danger" title="Couldn't add the supplier">
              {error}
            </Banner>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "Choose supplier" (HW-48): gives one goods line that has no supplier its supplier, either on a supplier order the order already has or on
 * a new one (a supplier and the currency it bills in). Once it is saved the order's goods state is read again, so "to source" goes when
 * the last unsourced line is done. Without `itemId` it takes the first goods line with no supplier (the green next step opens it so);
 * the "Choose supplier" button on a line passes that line.
 *
 * FE-2 entry burden: required, the supplier order (or the supplier on a new one). Everything else is pre-filled: the first supplier order
 * of the order, and for a new one the currency that supplier last used. At most 2 taps and one choice.
 */
const NEW_LEG = 'new'

export function ChooseSupplierDialog({ order, legs, itemId, onClose }: { order: OrderHeader; legs: readonly OrderLegRow[]; itemId?: string; onClose: () => void }) {
  const { toast } = useToast()
  const items = useOrderItems(order.id, true)
  const addLeg = useAddLeg(order.id)
  const update = useUpdateItem(order.id)
  const choices = useSupplierChoices(true)
  const newLegId = useRef(crypto.randomUUID())
  const sending = useRef(false)
  const [pick, setPick] = useState<string | null>(null)
  const [supplierId, setSupplierId] = useState('')
  const [currency, setCurrency] = useState('PKR')
  const [touched, setTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const item = (items.data ?? []).find(i => (itemId ? i.id === itemId : !i.isService && i.legId === null))
  const remaining = (items.data ?? []).filter(i => !i.isService && i.legId === null).length
  const choice = pick ?? (legs.length > 0 ? legs[0].id : NEW_LEG)
  const isNew = choice === NEW_LEG
  const chosen = choices.data?.find(c => c.id === supplierId)

  useEffect(() => {
    if (chosen && !touched) setCurrency(chosen.lastCurrency ?? 'PKR')
  }, [chosen, touched])

  const sameLeg = isNew ? legs.find(l => l.supplierId === supplierId && l.currency === currency) : undefined
  const ready = Boolean(item) && (isNew ? supplierId !== '' : true)
  const busy = addLeg.isPending || update.isPending

  const save = async () => {
    if (!item || !ready || sending.current) return
    sending.current = true
    setError(null)
    try {
      let legId = isNew ? sameLeg?.id : choice
      if (isNew && !legId) {
        await addLeg.mutateAsync({ id: newLegId.current, supplierId, currency })
        legId = newLegId.current
      }
      await update.mutateAsync({ id: item.id, patch: { supplier_order_id: legId as string } })
      const leg = legs.find(l => l.id === legId)
      toast({ title: 'Supplier chosen', body: `${item.description} · ${leg ? legLabel(leg, legs) : (chosen?.name ?? '')}` })
      onClose()
    } catch (err) {
      setError(mapPgError(err, { entity: 'line' }).message)
    } finally {
      sending.current = false
    }
  }

  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Choose supplier"
        context={`${orderRef(order.number)} · ${order.companyName}`}
        icon={Truck}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" busy={busy} busyLabel="Saving" disabled={!ready} onClick={() => void save()}>
              Use this supplier
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {items.isPending ? (
            <p className="text-base text-fg-2" role="status">
              Loading the lines
            </p>
          ) : item ? (
            <>
              <p className="text-base" data-testid="choose-supplier-line">
                <span className="text-fg-muted">Line {item.number}: </span>
                <span className="font-medium">{item.description}</span>
                {remaining > 1 ? <span className="text-fg-muted">{` · ${remaining - 1} more with no supplier`}</span> : null}
              </p>
              <Field label="Supplier order" requirement="required" help="A supplier order is one supplier in one currency.">
                <Select
                  value={choice}
                  onChange={e => setPick(e.target.value)}
                  options={[...legs.map(l => ({ value: l.id, label: l.currency ? `${l.supplierName} (${l.currency})` : l.supplierName })), { value: NEW_LEG, label: 'A new supplier order' }]}
                />
              </Field>
              {isNew ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Supplier" requirement="required" help="Suppliers you have asked, ordered from or carry a brand for.">
                    <Select
                      value={supplierId}
                      onChange={e => setSupplierId(e.target.value)}
                      placeholder={choices.isPending ? 'Loading suppliers' : 'Choose a supplier'}
                      options={(choices.data ?? []).map(c => ({ value: c.id, label: c.name }))}
                    />
                  </Field>
                  <Field
                    label="Currency"
                    source={chosen && !touched ? (chosen.lastCurrency ? `${chosen.name} last used ${chosen.lastCurrency}` : 'PKR unless you change it') : undefined}
                    edited={touched}
                    help={sameLeg ? 'This order already has this supplier in this currency: the line goes on it.' : undefined}
                  >
                    <Select
                      value={currency}
                      onChange={e => {
                        setTouched(true)
                        setCurrency(e.target.value)
                      }}
                      options={CURRENCIES.map(c => ({ value: c, label: c }))}
                    />
                  </Field>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-base text-fg-2">Every goods line on this order has a supplier.</p>
          )}
          {error ? (
            <Banner tone="danger" title="Couldn't choose the supplier">
              {error}
            </Banner>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
