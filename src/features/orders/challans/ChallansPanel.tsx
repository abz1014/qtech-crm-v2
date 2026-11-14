import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileDown, FileText, Plus } from 'lucide-react'
import { useSeesPrices } from '@/app/session'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Checkbox } from '@/ui/form/Checkbox'
import { Field } from '@/ui/form/Field'
import { TextArea, TextField } from '@/ui/form/TextField'
import { Skeleton } from '@/ui/Skeleton'
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
export function ChallansPanel({ order, items, inFold = false }: { order: OrderHeader; items: readonly OrderItemRow[]; /** Drawn inside a FoldRow named "Delivery challans" (the job page's Delivery step): no region or heading of its own. */ inFold?: boolean }) {
  const challans = useOrderChallans(order.id)
  const [making, setMaking] = useState(false)
  const cancelled = order.cancelledOn !== null
  const hasGoods = items.some(i => !i.isService)
  const rows = challans.data ?? []
  const canNew = !cancelled && hasGoods
  // Not in a fold: the engineer's job page, its own Forest card (43-job-delivery #e-challans) with phone-sized buttons.
  const card = !inFold
  const line = card ? 'pt-3' : 'border-b py-3'

  const newButton = canNew ? (
    <Button size={card ? 'md' : 'sm'} variant="quiet" icon={Plus} className={cn('ml-auto shrink-0', card && 'max-md:h-control-lg')} onClick={() => setMaking(true)}>
      New challan
    </Button>
  ) : null
  const body = (
    <>
      {challans.isLoading ? <ChallansLoading card={card} /> : null}
      {challans.isError ? <p className={cn('type-body text-fg-muted', line)}>The challans did not load. Reload the page to try again.</p> : null}
      {!challans.isError && !challans.isLoading && rows.length === 0 ? (
        <p className={cn('type-body text-fg-muted', line)}>{hasGoods ? 'None issued yet. A challan lists the goods and quantities delivered, with no prices.' : 'This order has no goods to deliver.'}</p>
      ) : null}
      {rows.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-[minmax(0,1fr)] p-0" aria-label="Challans issued for this order">
          {rows.map(c => (
            <ChallanItem key={c.id} order={order} challan={c} card={card} />
          ))}
        </ul>
      ) : null}
      {making ? <NewChallanDialog order={order} items={items} onClose={() => setMaking(false)} /> : null}
    </>
  )

  if (card) {
    return (
      <section aria-label="Delivery challans" className={cn(CARD, 'min-w-0 p-card')} data-testid="challans">
        <div className="flex items-center gap-3">
          <h2 className="min-w-0 type-section">Delivery challans</h2>
          {newButton}
        </div>
        {body}
      </section>
    )
  }
  return (
    <div className="min-w-0" data-testid="challans">
      {canNew ? <div className="flex min-h-control flex-wrap items-center gap-3 border-b py-2">{newButton}</div> : null}
      {body}
    </div>
  )
}

/** Two rows shaped like a challan (number, day, lines, Download) while the list loads. */
function ChallansLoading({ card }: { card: boolean }) {
  return (
    <div className="grid" role="status" aria-label="Loading challans">
      {[0, 1].map(n => (
        <div key={n} className={cn('flex items-center gap-3 py-3', (!card || n === 0) && 'border-b')}>
          <Skeleton className="h-4 w-[4.5rem]" />
          <Skeleton className="h-4 w-[4.5rem]" />
          <Skeleton className="h-4 w-[3rem]" />
          <Skeleton className={cn('ml-auto w-[6rem]', card ? 'h-control' : 'h-control-sm')} />
        </div>
      ))}
    </div>
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
      const doc = buildChallanDoc(order, challan, money)
      saveBlob(await generateChallanPdf(doc, profile), challanFileName(doc))
    } catch (err) {
      toast({ title: 'Could not make the challan', body: mapPgError(err, { entity: 'challan' }).message, tone: 'danger' })
    } finally {
      setPending(false)
    }
  }
  return { pending, download }
}

function ChallanItem({ order, challan, card }: { order: OrderHeader; challan: ChallanRow; card: boolean }) {
  const file = useChallanDownload(order)
  return (
    <li className={cn('flex min-w-0 items-center gap-3 border-b py-3', card && 'last:border-b-0 last:pb-0')} data-challan={challan.number}>
      {/* the facts wrap among themselves on a narrow phone; Download keeps its place on the right */}
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="num font-card text-sm">{challan.number}</span>
        <span className="num text-sm text-fg-muted">{formatDay(challan.issuedOn)}</span>
        <span className="text-sm text-fg-muted">{challan.lines.length === 1 ? '1 line' : `${challan.lines.length} lines`}</span>
      </span>
      <Button
        size={card ? 'md' : 'sm'}
        variant="quiet"
        icon={FileDown}
        className={cn('shrink-0', card && 'max-md:h-control-lg')}
        onClick={() => void file.download(challan)}
        busy={file.pending}
        busyLabel="Preparing"
        aria-label={`Download challan ${challan.number}`}
      >
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
        icon={FileText}
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
                <li key={l.itemId} className="grid min-w-0 gap-2 rounded-control border p-3">
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
