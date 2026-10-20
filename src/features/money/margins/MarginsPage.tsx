import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Layers, ListFilter } from 'lucide-react'
import { orderRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tag } from '@/ui/Tag'
import { ToggleButton } from '@/ui/ToggleButton'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import { InfoTip } from '@/ui/InfoTip'
import { useOrderMargins } from '@/features/money/hooks'
import { isPaidProvisional, marginTotals, sortMargins, type MarginRow } from '@/features/money/margins/model'

/*
 * Money > Month end > Margins (g2-money board "Admin: order margins"; M04). Whole-life margin per order, from v_order_money. Admin
 * only. Reached from the Month end checklist ("Margin not final") and from Reports (?from=reports), with a back link to either.
 * Only orders with costs marked complete are totalled. A provisional margin is shown with the dashed mark and not added up;
 * an order with an unknown price basis has no margin, is labelled, and is left out of every total.
 */
const COLS = 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_128px]'
const ROW = `grid grid-cols-2 gap-x-4 gap-y-2 border-t px-5 py-3 first:border-t-0 md:gap-4 ${COLS}`

function Label({ children, phone = true }: { children: string; phone?: boolean }) {
  return <span className={cn('text-sm text-fg-muted md:sr-only', !phone && 'sr-only')}>{children}</span>
}

function CostsChip({ state }: { state: MarginRow['state'] }) {
  return state === 'basis_unknown' ? (
    <StatusBadge dimension="trust" value="basis-unknown" label="Is GST included?" />
  ) : (
    <StatusBadge dimension="costs" value={state === 'final' ? 'complete' : 'provisional'} label={state === 'final' ? 'Costs complete' : 'Margin not final'} />
  )
}

function MarginRowView({ r }: { r: MarginRow }) {
  const unknown = r.state === 'basis_unknown'
  return (
    <li className={ROW} data-margin-state={r.state}>
      <div className="col-span-2 grid content-start gap-[2px] md:col-span-1">
        <Label phone={false}>Customer and order</Label>
        <span className="min-w-0 break-words text-sm font-medium">{r.companyName}</span>
        <Link to={`/orders/${r.orderId}`} className="w-fit rounded hover:underline" aria-label={`Open ${orderRef(r.orderNumber)}`}>
          <Tag className="border-0 bg-transparent px-0">{orderRef(r.orderNumber)}</Tag>
        </Link>
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
        <Label>Expected cost</Label>
        <Money value={r.expectedCost} prefix={false} />
      </div>
      <div className="grid content-start gap-1 md:justify-items-end">
        <Label>Actual cost so far</Label>
        <Money value={r.actualCost} prefix={false} />
      </div>
      <div className="grid content-start gap-1 md:justify-items-end">
        <Label>Margin</Label>
        {unknown ? <Money value={null} prefix={false} /> : <Money value={r.margin} prefix={false} provisional={r.state === 'provisional'} mark="underline" strong={r.state === 'final'} />}
      </div>
      <div className="grid content-start gap-1">
        <Label>Costs</Label>
        <span>
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
            Paid, margin not final <span className="num">{paidCount}</span>
          </ToggleButton>
        </header>
        {q.isPending ? (
          <div className="grid gap-3 p-5" aria-busy="true" aria-label="Loading order margins">
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
              <span className="text-right">Net sale</span>
              <span className="text-right">Expected cost</span>
              <span className="text-right">Actual cost so far</span>
              <span className="text-right">Margin</span>
              <span>Costs</span>
            </div>
            <ul>
              {rows.map(r => (
                <MarginRowView key={r.orderId} r={r} />
              ))}
            </ul>
            {onlyPaid && rows.length === 0 ? <p className="px-5 py-6 text-sm text-fg-muted">Every paid order has its costs marked complete.</p> : null}
            <div className={`grid grid-cols-2 gap-x-4 gap-y-1 border-t bg-sunken px-5 py-3 text-sm font-medium md:gap-4 ${COLS}`} data-testid="margin-totals">
              <span className="col-span-2 md:col-span-1">
                Total of <span className="num">{totals.orders}</span> {totals.orders === 1 ? 'order' : 'orders'} with costs complete
              </span>
              <span className="num md:text-right">
                <Money value={totals.orders > 0 ? totals.netSale : null} prefix={false} />
              </span>
              <span className="num md:text-right">
                <Money value={totals.orders > 0 ? totals.expectedCost : null} prefix={false} />
              </span>
              <span className="num md:text-right">
                <Money value={totals.orders > 0 ? totals.actualCost : null} prefix={false} />
              </span>
              <span className="num md:text-right">
                <Money value={totals.orders > 0 ? totals.margin : null} prefix={false} />
              </span>
              <span />
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
    </MoneyFrame>
  )
}
