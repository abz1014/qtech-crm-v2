import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileDown, Plus } from 'lucide-react'
import { useSeesPrices } from '@/app/session'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Checkbox } from '@/ui/form/Checkbox'
import { Field } from '@/ui/form/Field'
import { TextArea, TextField } from '@/ui/form/TextField'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, OrderItemRow } from '@/features/orders/api'
import { useCreateChallan, useOrderChallans } from '@/features/orders/challans/hooks'
import { defaultDeliverTo, pickPayload, pickProblem, startPick, type ChallanRow, type PickLine } from '@/features/orders/challans/model'
import { buildChallanDoc, challanFileName } from '@/features/orders/challans/pdf/doc'
import { generateChallanPdf } from '@/features/orders/challans/pdf/generate'
import { saveBlob } from '@/features/orders/pdf/download'
import { companyProfileQuery } from '@/features/settings/hooks'

/*
 * Delivery challans of an order (migration 0131): the list of those issued, each with a download, and "New challan". The new one starts as
 * every goods line at its full quantity; untick a line or lower a quantity for a part delivery. Where it goes starts as the site and can be
 * changed. Any role may issue one (an engineer takes the goods to site); the paper has no price on it.
 */
export function ChallansPanel({ order, items }: { order: OrderHeader; items: readonly OrderItemRow[] }) {
  const challans = useOrderChallans(order.id)
  const [making, setMaking] = useState(false)
  const cancelled = order.cancelledOn !== null
  const hasGoods = items.some(i => !i.isService)
  const rows = challans.data ?? []

  return (
    <section aria-label="Delivery challans" className="min-w-0 rounded-panel border bg-surface" data-testid="challans">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3 md:px-5">
        <h2 className="text-base font-semibold">Delivery challans</h2>
        {!cancelled && hasGoods ? (
          <Button size="sm" variant="quiet" icon={Plus} className="ml-auto" onClick={() => setMaking(true)}>
            New challan
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 px-4 py-4 md:px-5">
        {challans.isError ? <p className="text-sm text-fg-muted">The challans did not load. Reload the page to try again.</p> : null}
        {!challans.isError && !challans.isLoading && rows.length === 0 ? (
          <p className="text-sm text-fg-muted">{hasGoods ? 'None issued yet. A challan lists the goods and quantities delivered, with no prices.' : 'This order has no goods to deliver.'}</p>
        ) : null}
        {rows.length > 0 ? (
          <ul className="grid gap-2" aria-label="Challans issued for this order">
            {rows.map(c => (
              <ChallanItem key={c.id} order={order} challan={c} />
            ))}
          </ul>
        ) : null}
      </div>
      {making ? <NewChallanDialog order={order} items={items} onClose={() => setMaking(false)} /> : null}
    </section>
  )
}

function useChallanDownload(order: OrderHeader) {
  const client = useQueryClient()
  const money = useSeesPrices()
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const download = async (challan: ChallanRow) => {
    if (pending) return
    setPending(true)
    try {
      const profile = await client.fetchQuery({ ...companyProfileQuery(money), staleTime: 30_000 })
      const doc = buildChallanDoc(order, challan)
      saveBlob(await generateChallanPdf(doc, profile), challanFileName(doc))
    } catch (err) {
      toast({ title: 'Could not make the challan', body: mapPgError(err, { entity: 'challan' }).message, tone: 'danger' })
    } finally {
      setPending(false)
    }
  }
  return { pending, download }
}

function ChallanItem({ order, challan }: { order: OrderHeader; challan: ChallanRow }) {
  const file = useChallanDownload(order)
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border px-3 py-3" data-challan={challan.number}>
      <span className="num text-sm font-medium">{challan.number}</span>
      <span className="num text-sm text-fg-muted">{formatDay(challan.issuedOn)}</span>
      <span className="text-sm text-fg-muted">{challan.lines.length === 1 ? '1 line' : `${challan.lines.length} lines`}</span>
      <Button size="sm" variant="quiet" icon={FileDown} className="ml-auto" onClick={() => void file.download(challan)} busy={file.pending} busyLabel="Preparing" aria-label={`Download challan ${challan.number}`}>
        Download
      </Button>
    </li>
  )
}

function NewChallanDialog({ order, items, onClose }: { order: OrderHeader; items: readonly OrderItemRow[]; onClose: () => void }) {
  const { toast } = useToast()
  const create = useCreateChallan(order.id)
  const file = useChallanDownload(order)
  const [lines, setLines] = useState<PickLine[]>(() => startPick(items))
  const [deliverTo, setDeliverTo] = useState(() => defaultDeliverTo(order))
  const payload = pickPayload(lines)
  const set = (id: string, patch: Partial<PickLine>) => setLines(ls => ls.map(l => (l.itemId === id ? { ...l, ...patch } : l)))

  const issue = async () => {
    try {
      const challan = await create.mutateAsync({ lines: payload, deliverTo })
      onClose()
      toast({ title: `Challan ${challan.number} issued`, body: order.companyName })
      await file.download(challan)
    } catch (err) {
      toast({ title: 'Could not issue the challan', body: mapPgError(err, { entity: 'challan' }).message, tone: 'danger' })
    }
  }

  return (
    <Dialog open busy={create.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="New delivery challan"
        context="Goods and quantities only, no prices. Untick a line or lower a quantity for a part delivery."
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={create.isPending} busyLabel="Issuing" disabled={payload.length === 0} onClick={() => void issue()}>
              Issue and download
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <ul className="grid gap-3" aria-label="Lines on the challan">
            {lines.map(l => {
              const problem = pickProblem(l)
              return (
                <li key={l.itemId} className="grid gap-2 rounded border px-3 py-3">
                  <Checkbox label={l.description.split(/\r?\n/)[0]} checked={l.include} onCheckedChange={v => set(l.itemId, { include: v === true })} />
                  {l.include ? (
                    <Field label={`Quantity${l.unit ? ` (${l.unit})` : ''}`} error={problem ?? undefined}>
                      <TextField inputMode="decimal" value={l.qty} onChange={e => set(l.itemId, { qty: e.target.value })} />
                    </Field>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <Field label="Deliver to" requirement="optional">
            <TextArea rows={3} maxLength={500} value={deliverTo} onChange={e => setDeliverTo(e.target.value)} />
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  )
}
