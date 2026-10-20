import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck, Layers, ListFilter } from 'lucide-react'
import { orderRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { NeedsCount, Tag } from '@/ui/Tag'
import { ToggleButton } from '@/ui/ToggleButton'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import { InfoTip } from '@/ui/InfoTip'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { useToast } from '@/ui/useToast'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { useSetCostsCompleteMany } from '@/features/money/costs/hooks'
import { useOrderMargins } from '@/features/money/hooks'
import { isPaidProvisional, marginTotals, sortMargins, type MarginRow } from '@/features/money/margins/model'

/*
 * Money > Month end > Margins (g2-money board "Admin: order margins"; M04). Whole-life margin per order, from v_order_money. Admin
 * only. Reached from the Month end checklist ("Margin not final") and from Reports (?from=reports), with a back link to either.
 * Only orders with costs marked complete are totalled. A provisional margin is shown with the dashed mark and not added up;
 * an order with an unknown price basis has no margin, is labelled, and is left out of every total.
 * Round 2 (R2-13): the margin sits beside the customer, bigger; the cost is ONE line (what the margin uses: the actual cost,
 * with the dashed not-final mark while costs may still come in, and the expected cost under it); "Costs complete" is not
 * shown (rule 2: a done state needs no chip), only "Margin not final" and "Is GST included?".
 */
const COLS = 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_152px]'
const ROW = `grid grid-cols-2 gap-x-4 gap-y-2 border-t px-5 py-3 first:border-t-0 md:gap-4 ${COLS}`

function Label({ children, phone = true }: { children: string; phone?: boolean }) {
  return <span className={cn('text-sm text-fg-muted md:sr-only', !phone && 'sr-only')}>{children}</span>
}

/** Only the states that ask for something: "Costs complete" is not shown. */
function CostsChip({ state }: { state: MarginRow['state'] }) {
  if (state === 'final') return null
  return state === 'basis_unknown' ? (
    <StatusBadge dimension="trust" value="basis-unknown" label="Is GST included?" />
  ) : (
    <StatusBadge dimension="costs" value="provisional" label="Margin not final" />
  )
}

function MarginRowView({ r }: { r: MarginRow }) {
  const unknown = r.state === 'basis_unknown'
  return (
    <li className={ROW} data-margin-state={r.state}>
      <div className="grid content-start gap-[2px]">
        <Label phone={false}>Customer and order</Label>
        <span className="min-w-0 break-words text-sm font-medium">{r.companyName}</span>
        <Link to={`/orders/${r.orderId}`} className="w-fit rounded hover:underline" aria-label={`Open ${orderRef(r.orderNumber)}`}>
          <Tag className="border-0 bg-transparent px-0">{orderRef(r.orderNumber)}</Tag>
        </Link>
      </div>
      <div className="grid content-start justify-items-end gap-1" data-testid="margin-value">
        <Label>Margin</Label>
        {unknown ? (
          <Money value={null} prefix={false} size="lg" />
        ) : (
          <Money value={r.margin} prefix={false} size="lg" provisional={r.state === 'provisional'} mark="underline" strong />
        )}
      </div>
      <div className="grid content-start gap-1 md:justify-items-end">
        <Label>Net sale</Label>
        {unknown || r.netSale === null ? (
          <Money value={null} prefix={false} />
        ) : (
          <>
            <Money value={r.netSale} prefix={false} />
            <span className="text-xs text-fg-muted">{r.basis === 'invoice' ? 'invoiced' : 'from items'}</span>
          </>
        )}
      </div>
      <div className="grid content-start gap-1 md:justify-items-end">
        <Label>Cost</Label>
        <Money value={r.actualCost} prefix={false} provisional={r.state === 'provisional'} mark="underline" />
        {r.state !== 'final' ? (
          <span className="text-xs text-fg-muted">
            {r.expectedCost !== null ? (
              <>
                so far, <Money value={r.expectedCost} prefix={false} /> expected
              </>
            ) : (
              'so far'
            )}
          </span>
        ) : null}
      </div>
      <div className="col-span-2 grid content-start gap-1 md:col-span-1">
        <span className="empty:hidden">
          <CostsChip state={r.state} />
        </span>
      </div>
    </li>
  )
}

export function MarginsPage() {
  const q = useOrderMargins(true)
  const [params] = useSearchParams()
  const fromReports = params.get('from') === 'reports'
  // Today's "Costs not marked complete" item opens this list filtered to the orders it counts.
  const [onlyPaid, setOnlyPaid] = useState(() => params.get('filter') === 'paid-provisional')
  const all = useMemo(() => sortMargins(q.data ?? []), [q.data])
  const totals = useMemo(() => marginTotals(all), [all])
  const paidCount = useMemo(() => all.filter(isPaidProvisional).length, [all])
  const rows = useMemo(() => (onlyPaid ? all.filter(isPaidProvisional) : all), [all, onlyPaid])
  const [confirming, setConfirming] = useState(false)
  return (
    <MoneyFrame active={fromReports ? 'reports' : 'month-end'}>
      <MoneySubHeader
        back={fromReports ? { to: '/money/reports', label: 'Reports' } : { to: '/money/month-end', label: 'Month end' }}
        title="Order margins"
        meta={
          <InfoTip label="About margins">
            Margin is the net sale less the expenses tagged to the order; GST is outside both sides. Only orders whose costs are marked
            complete are added up. &ldquo;Margin not final&rdquo; means costs may still come in.
          </InfoTip>
        }
      />
      <section aria-labelledby="margins-h" className="min-w-0 rounded border bg-surface">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
          <h3 id="margins-h" className="text-base font-semibold">
            Every order
          </h3>
          <span className="inline-flex h-6 items-center gap-[6px] rounded border border-line-strong bg-selected px-2 text-sm text-fg-2">
            <Icon icon={Layers} size="chip" />
            Whole life of the order
          </span>
          <span className="flex-1" />
          <ToggleButton pressed={onlyPaid} onPressedChange={setOnlyPaid} icon={ListFilter}>
            Paid, margin not final <NeedsCount n={paidCount} />
          </ToggleButton>
          {onlyPaid && rows.length > 1 ? (
            <Button size="sm" icon={ClipboardCheck} onClick={() => setConfirming(true)}>
              {`Mark costs complete for ${rows.length}`}
            </Button>
          ) : null}
        </header>
        {q.isPending ? (
          <div role="status" className="grid gap-3 p-5" aria-busy="true" aria-label="Loading order margins">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : q.isError ? (
          <div className="p-4">
            <Banner
              tone="danger"
              title="Couldn't load the order margins"
              action={
                <Button size="sm" onClick={() => void q.refetch()}>
                  Try again
                </Button>
              }
            >
              Nothing was changed. Check your connection and try again.
            </Banner>
          </div>
        ) : all.length === 0 ? (
          <EmptyState title="No order to show yet">An order appears here as soon as it is made, with its margin once costs are paid.</EmptyState>
        ) : (
          <div>
            <div className={`hidden border-b bg-sunken px-5 py-2 text-xs text-fg-muted md:grid md:gap-4 ${COLS}`} aria-hidden="true">
              <span>Customer and order</span>
              <span className="text-right">Margin</span>
              <span className="text-right">Net sale</span>
              <span className="text-right">Cost</span>
              <span />
            </div>
            <ul>
              {rows.map(r => (
                <MarginRowView key={r.orderId} r={r} />
              ))}
            </ul>
            {onlyPaid && rows.length === 0 ? <p className="px-5 py-6 text-sm text-fg-muted">Every paid order has its costs marked complete.</p> : null}
            <div className={`grid grid-cols-2 gap-x-4 gap-y-1 border-t bg-sunken px-5 py-3 text-sm font-medium md:gap-4 ${COLS}`} data-testid="margin-totals">
              <span className="col-span-2 md:col-span-1">
                Added up: <span className="num">{totals.orders}</span> {totals.orders === 1 ? 'order' : 'orders'} with costs complete
              </span>
              <span className="num text-right">
                <span className="text-fg-muted md:sr-only">Margin </span>
                <Money value={totals.orders > 0 ? totals.margin : null} prefix={false} size="lg" />
              </span>
              <span className="num md:text-right">
                <span className="font-regular text-fg-muted md:sr-only">Net sale </span>
                <Money value={totals.orders > 0 ? totals.netSale : null} prefix={false} />
              </span>
              <span className="num md:text-right">
                <span className="font-regular text-fg-muted md:sr-only">Cost </span>
                <Money value={totals.orders > 0 ? totals.actualCost : null} prefix={false} />
              </span>
              <span className="max-md:hidden" />
            </div>
            {totals.provisional + totals.basisUnknown > 0 ? (
              <p className="border-t px-5 py-3 text-sm text-fg-2" data-testid="margin-left-out">
                Not added up:{' '}
                {[
                  totals.provisional > 0 ? `${totals.provisional} with margin not final` : null,
                  totals.basisUnknown > 0 ? `${totals.basisUnknown} where nobody has said whether GST is included` : null,
                ]
                  .filter(Boolean)
                  .join(', and ')}
                .
              </p>
            ) : null}
          </div>
        )}
      </section>
      {confirming ? <CompleteManyDialog rows={rows} onClose={() => setConfirming(false)} /> : null}
    </MoneyFrame>
  )
}

/** Batch "Mark costs complete" (entry-burden J16). Costs complete is a judgement, so the orders and their figures are listed first. */
function CompleteManyDialog({ rows, onClose }: { rows: readonly MarginRow[]; onClose: () => void }) {
  const session = useSession()
  const userId = session.status === 'signed-in' ? session.user.id : null
  const many = useSetCostsCompleteMany()
  const { toast } = useToast()
  const confirm = () => {
    if (!userId) return
    many.mutate(
      { orderIds: rows.map(r => r.orderId), complete: true, userId },
      {
        onSuccess: () => {
          toast({ title: `Costs marked complete on ${rows.length} orders`, tone: 'success' })
          onClose()
        },
        onError: err => toast({ title: 'Could not mark every order', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' }),
      },
    )
  }
  return (
    <Dialog open busy={many.isPending} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title={`Mark costs complete for ${rows.length} orders?`}
        context="Their margins become final. You can reopen one on its order page."
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={many.isPending}>
              Cancel
            </Button>
            <Button variant="primary" busy={many.isPending} busyLabel="Marking" onClick={confirm}>
              Mark costs complete
            </Button>
          </>
        }
      >
        <ul className="grid gap-2 text-sm">
          {rows.map(r => (
            <li key={r.orderId} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                {r.companyName} <span className="num text-fg-muted">{orderRef(r.orderNumber)}</span>
              </span>
              <span className="text-right">
                <span className="text-xs text-fg-muted">Cost </span>
                <Money value={r.actualCost} prefix={false} />
                <span className="text-xs text-fg-muted"> · Margin </span>
                <Money value={r.margin} prefix={false} />
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
