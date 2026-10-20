import { useMemo, useState } from 'react'
import { ClipboardCheck, Lock, Plus, RotateCcw } from 'lucide-react'
import { useSession } from '@/app/session'
import { formatShortDate } from '@/lib/formatDay'
import { businessToday } from '@/lib/dates'
import { formatAmount } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Margin } from '@/ui/Money'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { InfoTip } from '@/ui/InfoTip'
import { NumberInput } from '@/ui/form/NumberInput'
import type { OrderHeader, OrderMoney } from '@/features/orders/api'
import { useFxLatest } from '@/features/rfqs/hooks'
import { useCategories } from '@/features/money/expenses/hooks'
import { AddExpenseDialog } from '@/features/money/expenses/ExpenseDialog'
import { useFillExpectedCost, useOrderCosts, useSetCostsComplete, useSetExpectedCost } from '@/features/money/costs/hooks'
import { estimateExpectedCost } from '@/features/money/lib/costEstimate'

/*
 * The Margin panel of the order page (g2-order-detail.html; M04). ADMIN ONLY: the order page mounts it only for an admin, and
 * everything it reads (v_order_money, order_costs, expenses) is admin-only by the database, so another role would get no row.
 *
 * What it says, in the mockup's order: the margin so far with its Provisional mark (never shown without it until costs are marked
 * complete; never calculated while the price basis is unknown); how much of the expected cost has been paid out; net sale, the
 * expected cost (typed, or filled once from the supplier-price estimate, never overwritten), the actual cost with the expenses
 * tagged to the order; the estimate and what it leaves out; "Mark costs complete" and "Add expense".
 */
const ROW = 'flex items-baseline justify-between gap-4 text-sm'

function Row({ label, sub, children, strong }: { label: React.ReactNode; sub?: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={ROW}>
      <span className={cn('min-w-0 text-fg-2', strong && 'font-medium text-fg')}>
        {label}
        {sub ? <span className="ml-2 text-xs text-fg-muted">{sub}</span> : null}
      </span>
      <span className="num shrink-0 text-right">{children}</span>
    </div>
  )
}

/** Paid out, still to pay, and what is left as margin, drawn against the net sale. Counts, never a rating. */
function Bar({ net, paid, stillToPay }: { net: number; paid: number; stillToPay: number }) {
  if (net <= 0) return null
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / net) * 100))}%`
  return (
    <div aria-hidden="true" className="flex h-2 overflow-hidden rounded bg-selected">
      <span className="bg-fg" style={{ width: pct(paid) }} />
      <span className="border-y border-r border-dashed border-line-strong bg-surface" style={{ width: pct(stillToPay) }} />
    </div>
  )
}

function Legend({ swatch, label, value }: { swatch: 'paid' | 'still' | 'margin'; label: string; value: string }) {
  return (
    <div className={ROW}>
      <span className="inline-flex items-center gap-2 text-fg-2">
        <i
          aria-hidden="true"
          className={cn('inline-block size-[10px] rounded-[2px]', swatch === 'paid' && 'bg-fg', swatch === 'still' && 'border border-dashed border-line-strong bg-surface', swatch === 'margin' && 'bg-selected ring-1 ring-inset ring-line')}
        />
        {label}
      </span>
      <span className="num">{value}</span>
    </div>
  )
}

export function MarginPanel({ order, money, loading, error }: { order: OrderHeader; money: OrderMoney | null | undefined; loading: boolean; error: boolean }) {
  const session = useSession()
  const userId = session.status === 'signed-in' ? session.user.id : null
  const { toast } = useToast()
  const m = money
  const costs = useOrderCosts(order.id, true)
  const categories = useCategories()
  const fx = useFxLatest()
  const setExpected = useSetExpectedCost(order.id)
  const fill = useFillExpectedCost(order.id)
  const setComplete = useSetCostsComplete(order.id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<number | null>(null)
  const [adding, setAdding] = useState(false)

  const unknown = m?.marginState === 'basis_unknown'
  const complete = m?.costsState === 'complete'
  const actual = m?.actualCost ?? 0
  const expected = m?.expectedCost ?? null
  const net = m?.netSale ?? null
  const stillToPay = expected !== null ? Math.max(expected - actual, 0) : null
  const ifExpected = expected !== null && net !== null ? net - expected : null

  const estimate = useMemo(() => {
    if (!costs.data) return null
    const rates = Object.fromEntries((fx.data ?? []).map(r => [r.currency, { rate: r.ratePkr, ageDays: r.ageDays }]))
    return estimateExpectedCost({ items: costs.data.items, legs: costs.data.legs, pos: costs.data.pos, rates })
  }, [costs.data, fx.data])
  const categoryName = (id: string) => categories.data?.find(c => c.id === id)?.name ?? 'Expense'
  const today = businessToday()
  const ref = orderRef(order.number)
  const goodsLines = costs.data?.items.filter(i => !i.isService).length ?? 0

  const saveExpected = async (value: number | null) => {
    try {
      await setExpected.mutateAsync(value)
      setEditing(false)
      toast({ title: value === null ? 'Expected cost cleared' : 'Expected cost saved', body: value === null ? ref : `${ref} · PKR ${formatAmount(value)}`, tone: 'success' })
    } catch (err) {
      toast({ title: 'Could not save the expected cost', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
    }
  }
  const fillFromEstimate = async () => {
    if (!estimate || estimate.pkr === null) return
    try {
      const wrote = await fill.mutateAsync(estimate.pkr)
      toast(wrote ? { title: 'Expected cost set from the estimate', body: `${ref} · PKR ${formatAmount(estimate.pkr)}`, tone: 'success' } : { title: 'An expected cost is already set', body: 'It was left as it is.' })
    } catch (err) {
      toast({ title: 'Could not set the expected cost', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
    }
  }
  const mark = async (next: boolean) => {
    if (!userId) return
    try {
      await setComplete.mutateAsync({ complete: next, userId })
      toast({
        title: next ? 'Costs marked complete' : 'Costs reopened',
        body: next ? `${ref} · the margin is final` : `${ref} · the margin is not final again`,
        tone: 'success',
        undo: {
          onUndo: async () => {
            await setComplete.mutateAsync({ complete: !next, userId })
          },
          settledTitle: next ? 'Costs marked complete' : 'Costs reopened',
          undoneTitle: next ? 'Costs reopened' : 'Costs marked complete',
        },
      })
    } catch (err) {
      toast({ title: 'Could not change the costs mark', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
    }
  }

  return (
    <section aria-label="Margin" data-slot="margin-costs" className="rounded border bg-surface">
      <div className="flex items-center gap-2 border-b px-4 py-3 md:px-5">
        <h2 className="text-base font-semibold">Margin</h2>
        <InfoTip label="About the margin">
          Net sale less the costs paid so far. GST sits outside the margin on both sides, and expenses count at true cost, without recoverable input tax. It is final once costs are marked complete.
        </InfoTip>
        {unknown ? <StatusBadge dimension="trust" value="basis-unknown" label="Is GST included?" /> : m ? <StatusBadge dimension="costs" value={complete ? 'complete' : 'provisional'} /> : null}
        <span className="ml-auto inline-flex items-center gap-1 text-xs text-fg-muted">
          <Icon icon={Lock} size="chip" /> Admin only
        </span>
      </div>
      {loading ? (
        <div role="status" className="grid gap-3 p-5" aria-busy="true" aria-label="Loading margin">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : error || !m ? (
        <p className="p-5 text-sm text-fg-muted">The margin could not be read. Reload the page to try again.</p>
      ) : (
        <div className="grid gap-4 p-4 md:p-5">
          <div className="grid gap-1 rounded border border-dashed border-line-strong p-4">
            <div className="flex items-baseline justify-between gap-3 text-sm text-fg-2">
              <span>{unknown ? 'Margin' : 'Margin so far'}</span>
              <span className="text-xs text-fg-muted">{unknown ? 'Not calculated' : 'Sale less costs paid'}</span>
            </div>
            <div className="text-xl">
              <Margin value={m.margin} state={m.marginState as 'provisional' | 'final' | 'basis_unknown' | null} size="xl" />
            </div>
            <p className="text-sm text-fg-2">
              {unknown
                ? `Not worked out until someone answers "Is GST included?" at the top of the page.${actual > 0 ? ` Imported costs of PKR ${formatAmount(actual)} are on file.` : ''}`
                : complete
                  ? 'Final: costs complete.'
                  : expected !== null
                    ? `Not final: ${formatAmount(actual)} of ${formatAmount(expected)} paid.`
                    : 'Not final: counts only what is paid so far.'}
            </p>
          </div>

          {!unknown && expected !== null && net !== null ? (
            <>
              <Bar net={net} paid={actual} stillToPay={stillToPay ?? 0} />
              <div className="grid gap-1">
                <Legend swatch="paid" label="Paid out" value={formatAmount(actual)} />
                <Legend swatch="still" label="Still to pay" value={stillToPay !== null ? formatAmount(stillToPay) : '—'} />
                <Legend swatch="margin" label="Margin if as expected" value={ifExpected !== null ? formatAmount(ifExpected) : '—'} />
              </div>
            </>
          ) : null}

          <div className="grid gap-1 border-t pt-4">
            {!unknown ? (
              <Row label="Net sale" sub={order.state?.invoicing === 'not_invoiced' ? 'from items, not yet invoiced' : 'invoiced'} strong>
                {net !== null ? formatAmount(net) : '—'}
              </Row>
            ) : null}
            <div className={ROW}>
              <span className="min-w-0 text-fg-2">
                Expected cost
                {!editing && !complete ? (
                  <button type="button" onClick={() => { setDraft(expected); setEditing(true) }} className="ml-2 rounded text-xs font-medium text-primary hover:underline" aria-label={expected !== null ? 'Edit the expected cost' : 'Set the expected cost'}>
                    {expected !== null ? 'Edit' : 'Set'}
                  </button>
                ) : null}
              </span>
              {editing ? (
                <span className="flex items-center gap-2">
                  <NumberInput aria-label="Expected cost, PKR" value={draft} onChange={setDraft} prefix="PKR" min={0} autoFocus className="w-40" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void saveExpected(draft) } if (e.key === 'Escape') setEditing(false) }} />
                  <Button size="sm" variant="primary" onClick={() => void saveExpected(draft)} busy={setExpected.isPending} busyLabel="Saving" disabled={draft === null}>
                    Save
                  </Button>
                  <Button size="sm" onClick={() => setEditing(false)} disabled={setExpected.isPending}>
                    Cancel
                  </Button>
                  {expected !== null ? (
                    <Button size="sm" variant="quiet" onClick={() => void saveExpected(null)} disabled={setExpected.isPending}>
                      Clear
                    </Button>
                  ) : null}
                </span>
              ) : (
                <span className="num shrink-0 text-right">{expected !== null ? formatAmount(expected) : <span className="text-fg-muted">Not set</span>}</span>
              )}
            </div>
            <Row label={`Actual cost${costs.data ? `, ${costs.data.expenses.length} tagged ${costs.data.expenses.length === 1 ? 'expense' : 'expenses'}` : ''}`}>{formatAmount(actual)}</Row>
          </div>

          <div className="grid gap-1 border-t pt-4" data-testid="margin-expenses">
            {costs.isPending ? (
              <Skeleton className="h-4 w-2/3" />
            ) : costs.isError ? (
              <p className="text-sm text-fg-muted">The expenses could not be read. Reload the page to try again.</p>
            ) : costs.data.expenses.length === 0 ? (
              <p className="text-sm text-fg-muted" data-testid="margin-expenses-empty">
                No expense on this order yet.
              </p>
            ) : (
              costs.data.expenses.map(e => (
                <div key={e.id} className={ROW}>
                  <span className="flex min-w-0 items-baseline gap-3 text-fg-2">
                    <span className="num shrink-0 text-xs text-fg-muted">{formatShortDate(e.paidOn, today)}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]" title={[categoryName(e.categoryId), e.payeeName ?? e.note].filter(Boolean).join(' · ')}>
                      {[categoryName(e.categoryId), e.payeeName ?? e.note].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="num shrink-0 text-right">
                    {formatAmount(e.amount)}
                    {e.inputTax > 0 ? <span className="block text-xs text-fg-muted">{`${formatAmount(e.inputTax)} input tax`}</span> : null}
                  </span>
                </div>
              ))
            )}
          </div>

          {estimate && goodsLines > 0 ? (
            <div className="grid gap-2 text-xs text-fg-muted" data-testid="cost-estimate">
              {estimate.pkr !== null ? (
                <p>
                  Supplier-price estimate: PKR <span className="num">{formatAmount(estimate.pkr)}</span> at today&apos;s rates. Supplier price only, excludes freight, duty and service.
                  {estimate.linesWithoutPrice > 0 ? ` ${estimate.linesWithoutPrice} ${estimate.linesWithoutPrice === 1 ? 'line has' : 'lines have'} no supplier price yet.` : ''}
                </p>
              ) : (
                <p>
                  No supplier-price estimate yet.{estimate.linesWithoutPrice > 0 ? ` ${estimate.linesWithoutPrice} ${estimate.linesWithoutPrice === 1 ? 'line has' : 'lines have'} no supplier price.` : ''}
                </p>
              )}
              {estimate.unconverted.length > 0 ? <p>{`Left out: there is no current rate for ${estimate.unconverted.join(', ')}.`}</p> : null}
              {estimate.pkr !== null && expected === null && !complete ? (
                <div>
                  <Button size="sm" onClick={() => void fillFromEstimate()} busy={fill.isPending} busyLabel="Setting">
                    Use as the expected cost
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {complete ? (
              <Button size="sm" icon={RotateCcw} onClick={() => void mark(false)} busy={setComplete.isPending} busyLabel="Reopening">
                Reopen costs
              </Button>
            ) : (
              <Button size="sm" icon={ClipboardCheck} onClick={() => void mark(true)} busy={setComplete.isPending} busyLabel="Marking" disabled={unknown}>
                Mark costs complete
              </Button>
            )}
            <Button size="sm" variant="quiet" icon={Plus} onClick={() => setAdding(true)}>
              Add expense
            </Button>
          </div>
        </div>
      )}
      <AddExpenseDialog open={adding} onOpenChange={setAdding} context={{ orderId: order.id, orderLabel: ref }} />
    </section>
  )
}
