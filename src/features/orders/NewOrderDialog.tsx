import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CopyPlus, Search } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { DateInput } from '@/ui/form/DateInput'
import { Field } from '@/ui/form/Field'
import { TextField } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import type { PastOrder } from '@/features/orders/api'
import { useCreateRepeatOrder, usePastOrder, usePastOrders } from '@/features/orders/hooks'

/*
 * New order from a past order (O02): "WhatsApp order (no RFQ) and repeat order". The customer ordered again, or ordered without an RFQ
 * (a message, a call): start from the closest past order. It is found by company, site, item text, order number or customer PO, and
 * create_repeat_order copies the company, site, contact, payment terms, the lines with their last selling and purchase prices, and the
 * supplier legs that supplied them. The new order has today's date and no dates on its legs (nothing has been ordered yet).
 *
 * FE-2 entry burden, listed for the commit:
 *   required     the source order (found by typing a few letters, or picked from the most recent). Nothing else.
 *   pre-filled   everything the order copies, the date (today), the owner (the signed-in person).
 *   optional     the customer PO number (it can be added from the order later), a different order date.
 *   interactions after choosing the source: Create order (1), plus the PO number when there is one (1): at most 3 with the date.
 *
 * The id of the new order is made when the dialog opens and kept for a retry, so a double submit makes one order. Afterwards the new
 * order opens.
 */
export function NewOrderDialog({ onClose, sourceId }: { onClose: () => void; sourceId?: string }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const create = useCreateRepeatOrder()
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [chosen, setChosen] = useState<PastOrder | null>(null)
  const [po, setPo] = useState('')
  const [orderedOn, setOrderedOn] = useState(businessToday())
  const [error, setError] = useState<string | null>(null)
  const orderId = useRef(crypto.randomUUID())
  const submitting = useRef(false)
  const today = businessToday()

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(text), 200)
    return () => window.clearTimeout(t)
  }, [text])

  const preset = usePastOrder(sourceId)
  useEffect(() => {
    if (preset.data && !chosen) setChosen(preset.data)
  }, [preset.data, chosen])

  const found = usePastOrders(debounced, !chosen && !sourceId)

  const submit = async () => {
    if (!chosen || submitting.current) return
    submitting.current = true
    setError(null)
    try {
      const id = await create.mutateAsync({ orderId: orderId.current, fromOrderId: chosen.id, customerPo: po.trim() || null, orderedOn: orderedOn && orderedOn !== today ? orderedOn : null, companyId: chosen.companyId })
      toast({ title: 'Order created', body: `Copied from ${orderRef(chosen.number)} · ${chosen.companyName}` })
      navigate(`/orders/${id}`)
    } catch (err) {
      setError(mapPgError(err, { entity: 'order' }).message)
      submitting.current = false
    }
  }

  const busy = create.isPending

  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="New order"
        context={chosen ? `Repeat of ${orderRef(chosen.number)} · ${chosen.companyName}` : 'A customer ordered again, or ordered without an RFQ. Start from the closest past order.'}
        icon={CopyPlus}
        size="lg"
        footer={
          <>
            {chosen && !sourceId ? (
              <Button className="mr-auto" onClick={() => setChosen(null)} disabled={busy}>
                Choose another
              </Button>
            ) : null}
            <Button data-cancel onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" icon={CopyPlus} busy={busy} busyLabel="Creating" disabled={!chosen} onClick={() => void submit()}>
              Create order
            </Button>
          </>
        }
      >
        {chosen ? (
          <div className="grid gap-4">
            <div className="grid gap-1 rounded border bg-sunken p-4" data-testid="chosen-order">
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{chosen.companyName}</span>
                <span className="num text-sm text-fg-2">{orderRef(chosen.number)}</span>
              </span>
              <span className="text-sm text-fg-2">
                {chosen.siteName ? `${chosen.siteName} · ` : ''}
                {chosen.orderedOn ? `ordered ${formatShortDate(chosen.orderedOn, today)} · ` : ''}
                {chosen.lineCount} {chosen.lineCount === 1 ? 'line' : 'lines'}
              </span>
              {chosen.summary ? <span className="text-sm text-fg-muted">{chosen.summary}</span> : null}
            </div>
            <p className="text-sm text-fg-2">
              The new order copies the customer, site, contact and payment terms, the lines with their last prices, and the supplier legs that supplied them. Nothing is ordered from the suppliers yet.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Customer PO number" requirement="optional" help="Add it from the order later if it has not arrived.">
                <TextField value={po} onChange={e => setPo(e.target.value)} placeholder="Not yet received" autoComplete="off" data-autofocus />
              </Field>
              <Field label="Order date" requirement="optional" source="Today">
                <DateInput value={orderedOn} onChange={setOrderedOn} />
              </Field>
            </div>
            {error ? (
              <Banner tone="danger" title="Couldn't create the order">
                {error} Nothing was created twice: pressing Create order again is safe.
              </Banner>
            ) : null}
          </div>
        ) : sourceId ? (
          <div className="grid gap-2" aria-busy="true" aria-label="Loading the order">
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <div className="grid gap-3">
            <div className="relative">
              <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
              <TextField
                aria-label="Find a past order"
                placeholder="Company, site, item, order number or customer PO"
                value={text}
                onChange={e => setText(e.target.value)}
                style={{ paddingLeft: 36 }}
                autoComplete="off"
                data-autofocus
              />
            </div>
            {found.isPending ? (
              <div className="grid gap-2" aria-busy="true" aria-label="Searching">
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : found.isError ? (
              <Banner tone="danger" title="Couldn't search the orders" action={<Button onClick={() => void found.refetch()}>Try again</Button>}>
                Nothing was changed.
              </Banner>
            ) : found.data.length === 0 ? (
              <p className="rounded border border-dashed p-4 text-sm text-fg-muted" data-testid="no-past-orders">
                {debounced.trim() ? 'No past order matches that. Try a company name, a site or an item.' : 'There are no past orders to copy yet. Win an RFQ to start the first one.'}
              </p>
            ) : (
              <ul className="grid gap-2" aria-label={debounced.trim() ? 'Past orders that match' : 'Most recent orders'}>
                {found.data.map(o => (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setChosen(o)}
                      className={cn('grid w-full gap-px rounded border bg-surface px-4 py-3 text-left transition-colors duration-fast hover:border-line-input hover:bg-sunken')}
                    >
                      <span className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{o.companyName}</span>
                        <span className="num text-sm text-fg-2">{orderRef(o.number)}</span>
                      </span>
                      <span className="text-sm text-fg-2">
                        {o.siteName ? `${o.siteName} · ` : ''}
                        {o.orderedOn ? `ordered ${formatShortDate(o.orderedOn, today)}` : 'no date'}
                        {o.customerPo ? ` · PO ${o.customerPo}` : ''}
                      </span>
                      {o.summary ? <span className="truncate text-sm text-fg-muted">{o.summary}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
