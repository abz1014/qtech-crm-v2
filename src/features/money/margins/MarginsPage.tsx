import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { orderRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Money } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import { InfoTip } from '@/ui/InfoTip'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { useToast } from '@/ui/useToast'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { useSetCostsCompleteMany } from '@/features/money/costs/hooks'
import { useOrderMargins } from '@/features/money/hooks'
import { isPaidProvisional, marginPct, marginTotals, sortMargins, type MarginRow } from '@/features/money/margins/model'

/*
 * Money > Month end > Margins (g2-money board "Admin: order margins"; M04). Whole-life margin per order, from v_order_money. Admin
 * only. Reached from the Month end checklist ("Margin not final") and from Reports (?from=reports), with a back link to either.
 * Only orders with costs marked complete are totalled. A provisional margin is shown with the dashed mark and not added up;
 * an order with an unknown price basis has no margin, is labelled, and is left out of every total.
 * Round 2 (R2-13): the margin sits beside the customer, bigger; the cost is ONE line (what the margin uses: the actual cost,
 * with the dashed not-final mark while costs may still come in, and the expected cost under it); "Costs complete" is not
 * shown (rule 2: a done state needs no chip), only "Margin not final" and "Is GST included?".
 */
const COLS = 'md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_90px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]'

type View = 'all' | 'not-final' | 'final'

/** Whole rupees, for the phone's one-line figures. */
const whole = (n: number) => Math.round(n).toLocaleString('en-US')

/** The state in words, plain text (round 3: the amber chip read as a button). */
function stateWord(r: MarginRow): string {
  if (r.state === 'basis_unknown') return 'Is GST included?'
  return r.state === 'provisional' ? 'Not final' : 'Final'
}

/** A margin that is not final is an estimate: grey, with "(est.)" (round 3: "0 so far" showed a 100% margin in full black). */
function MarginFigure({ r, size }: { r: MarginRow; size?: 'lg' }) {
  if (r.state === 'basis_unknown' || r.margin === null) return <Money value={null} prefix={false} size={size} />
  const est = r.state === 'provisional'
  return (
    <span className={cn('inline-flex items-baseline gap-1', est && 'text-fg-muted')}>
      <Money value={r.margin} prefix={false} size={size} strong={!est} className={est ? 'text-fg-muted' : undefined} />
      {est ? <span className="text-xs">(est.)</span> : null}
    </span>
  )
}

function MarginRowView({ r }: { r: MarginRow }) {
  const unknown = r.state === 'basis_unknown'
  const pct = marginPct(r)
  const loss = r.margin !== null && r.margin < 0 && !unknown
  return (
    <li className="border-t first:border-t-0" data-margin-state={r.state}>
      {/* Phone: two lines (round 3: each card was about 230 px). */}
      <div className="grid gap-1 px-4 py-3 md:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 break-words font-medium">
            {r.companyName}{' '}
            <Link to={`/orders/${r.orderId}`} className="num font-regular text-fg-2 hover:underline">
              {orderRef(r.orderNumber)}
            </Link>
          </span>
          <span className={cn('shrink-0', loss && 'text-tone-danger-fg')}>
            <MarginFigure r={r} />
          </span>
        </div>
        <span className="text-sm text-fg-2">
          Sale {r.netSale === null || unknown ? '—' : whole(r.netSale)} · Cost {whole(r.actualCost)}
          {pct ? ` · ${pct}` : ''} · <span className={cn(r.state !== 'final' && 'font-medium text-fg')}>{stateWord(r)}</span>
        </span>
      </div>
      {/* Desktop: one row, six columns. */}
      <div className={`hidden gap-4 px-5 py-3 md:grid ${COLS}`}>
        <div className="grid content-start gap-[2px]">
          <span className="min-w-0 break-words text-sm font-medium">{r.companyName}</span>
          <Link to={`/orders/${r.orderId}`} className="num w-fit rounded text-sm text-fg-2 hover:underline" aria-label={`Open ${orderRef(r.orderNumber)}`}>
            {orderRef(r.orderNumber)}
          </Link>
        </div>
        <div className="grid content-start justify-items-end" data-testid="margin-value">
          <MarginFigure r={r} size="lg" />
        </div>
        <div className={cn('num content-start text-right text-sm', r.state === 'provisional' ? 'text-fg-muted' : 'text-fg', loss && 'text-tone-danger-fg')}>{pct ?? '—'}</div>
        <div className="grid content-start justify-items-end gap-1">
          {unknown || r.netSale === null ? (
            <Money value={null} prefix={false} />
          ) : (
            <>
              <Money value={r.netSale} prefix={false} />
              <span className="text-xs text-fg-2">{r.basis === 'invoice' ? 'invoiced' : 'from items'}</span>
            </>
          )}
        </div>
        <div className="grid content-start justify-items-end gap-1">
          <Money value={r.actualCost} prefix={false} />
          {r.state !== 'final' ? (
            <span className="text-xs text-fg-2">
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
        <div className={cn('content-start text-sm', r.state === 'final' ? 'text-fg-2' : 'font-semibold text-fg')}>{stateWord(r)}</div>
      </div>
    </li>
  )
}

export function MarginsPage() {
  const q = useOrderMargins(true)
  const [params] = useSearchParams()
  const fromReports = params.get('from') === 'reports'
  // Today's "Costs not marked complete" item opens this list on Not final (the orders it counts are paid and not final).
  const [view, setView] = useState<View>(() => (params.get('filter') === 'paid-provisional' ? 'not-final' : 'all'))
  const all = useMemo(() => sortMargins(q.data ?? []), [q.data])
  const totals = useMemo(() => marginTotals(all), [all])
  const paid = useMemo(() => all.filter(isPaidProvisional), [all])
  const notFinal = totals.provisional + totals.basisUnknown
  const rows = useMemo(() => (view === 'all' ? all : view === 'final' ? all.filter(r => r.state === 'final') : all.filter(r => r.state !== 'final')), [all, view])
  const [confirming, setConfirming] = useState(false)
  return (
    <MoneyFrame active={fromReports ? 'reports' : 'month-end'}>
      <MoneySubHeader
        back={fromReports ? { to: '/money/reports', label: 'Reports' } : { to: '/money/month-end', label: 'Month end' }}
        title="Order margins"
        meta={
          <InfoTip label="About margins">
            Margin is the net sale less the expenses tagged to the order, over the whole life of the order; GST is outside both sides.
            Only orders whose costs are marked complete are added up. A margin that is not final is an estimate: costs may still come in.
          </InfoTip>
        }
        actions={
          // The page's one green button: the obvious next step while paid orders still wait for their costs to be marked complete.
          paid.length > 0 ? (
            <Button variant="primary" icon={ClipboardCheck} onClick={() => setConfirming(true)} className="max-md:h-touch">
              {`Mark costs complete (${paid.length} paid)`}
            </Button>
          ) : null
        }
      />
      <section aria-labelledby="margins-h" className="min-w-0 rounded border bg-surface">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-3">
          <h3 id="margins-h" className="text-base font-semibold">
            Every order
          </h3>
          <span className="flex-1" />
          <SegmentedControl
            aria-label="Show"
            value={view}
            onValueChange={v => setView(v as View)}
            options={[
              { value: 'all', label: 'All' },
              { value: 'not-final', label: 'Not final', needs: notFinal },
              { value: 'final', label: `Final (${totals.orders})` },
            ]}
          />
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
            <div className={`hidden border-b bg-sunken px-5 py-2 text-sm text-fg-2 md:grid md:gap-4 ${COLS}`} aria-hidden="true">
              <span>Customer and order</span>
              <span className="text-right">Margin</span>
              <span className="text-right">Margin %</span>
              <span className="text-right">Net sale</span>
              <span className="text-right">Cost</span>
              <span>State</span>
            </div>
            <ul>
              {rows.map(r => (
                <MarginRowView key={r.orderId} r={r} />
              ))}
            </ul>
            {rows.length === 0 ? <p className="px-5 py-6 text-sm text-fg-2">{view === 'final' ? 'No order has its costs marked complete yet.' : 'Every order has its costs marked complete.'}</p> : null}
            <div className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t bg-sunken px-5 py-3 text-sm font-medium md:gap-4 ${COLS}`} data-testid="margin-totals">
              <span>
                Total of <span className="num">{totals.orders}</span> final {totals.orders === 1 ? 'order' : 'orders'}
              </span>
              <span className="num text-right">
                <Money value={totals.orders > 0 ? totals.margin : null} prefix={false} size="lg" />
              </span>
              <span className="num text-right max-md:hidden">{totals.orders > 0 ? marginPct({ margin: totals.margin, netSale: totals.netSale }) ?? '—' : '—'}</span>
              <span className="num text-right max-md:hidden">
                <Money value={totals.orders > 0 ? totals.netSale : null} prefix={false} />
              </span>
              <span className="num text-right max-md:hidden">
                <Money value={totals.orders > 0 ? totals.actualCost : null} prefix={false} />
              </span>
              <span className="max-md:hidden" />
            </div>
            {notFinal > 0 ? (
              <p className="border-t px-5 py-3 text-sm text-fg-2" data-testid="margin-left-out">
                <span className="num">{notFinal}</span> {notFinal === 1 ? 'order' : 'orders'} not final, not in the total
                {totals.basisUnknown > 0 ? ` (${totals.basisUnknown} waiting for "Is GST included?")` : ''}.
              </p>
            ) : null}
          </div>
        )}
      </section>
      {confirming ? <CompleteManyDialog rows={paid} onClose={() => setConfirming(false)} /> : null}
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
