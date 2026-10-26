import { useEffect, useRef, useState } from 'react'
import { mapPgError } from '@/lib/pgErrors'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { listUncategorised } from '@/features/settings/productCategories/api'
import { fillBatches, planFill, planSummary, type CategoryOption, type FillPlan } from '@/features/settings/productCategories/fillModel'
import { useApplyFillBatch, useRefreshAfterFill } from '@/features/settings/productCategories/hooks'

/*
 * Fill missing categories (C5; admin only): the keyword dictionary names a category for every RFQ item and order line that has none.
 *   1. Check   reads the items without a category and shows how many would go to each category, and how many it will leave alone
 *              (the dictionary was unsure, did not recognise the text, or names a category that is not curated here). Nothing is written.
 *   2. Fill    writes them in batches of 200, one category at a time, and says how far it is. Only items that STILL have no category
 *              change, so a second run, or a category someone chose meanwhile, is never overwritten. If a batch fails it stops and says
 *              how many were filled; the rest can be run again. Every changed item is in the history (the audit log), under the admin.
 */
type Phase = { kind: 'reading' } | { kind: 'preview'; plan: FillPlan } | { kind: 'filling'; plan: FillPlan; done: number } | { kind: 'done'; plan: FillPlan; done: number } | { kind: 'failed'; message: string }

export function FillDialog({ families, onClose }: { families: readonly CategoryOption[]; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' })
  const apply = useApplyFillBatch()
  const refresh = useRefreshAfterFill()
  const { toast } = useToast()
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    void (async () => {
      try {
        const [rfq, order] = await Promise.all([listUncategorised('rfq_items'), listUncategorised('order_items')])
        if (!cancelled.current) setPhase({ kind: 'preview', plan: planFill(rfq, order, families) })
      } catch (err) {
        if (!cancelled.current) setPhase({ kind: 'failed', message: mapPgError(err, { entity: 'item' }).message })
      }
    })()
    return () => {
      cancelled.current = true
    }
    // read once, when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const run = async (plan: FillPlan) => {
    let done = 0
    setPhase({ kind: 'filling', plan, done })
    try {
      for (const batch of fillBatches(plan)) {
        done += await apply.mutateAsync(batch)
        setPhase({ kind: 'filling', plan, done })
      }
      await refresh()
      setPhase({ kind: 'done', plan, done })
      toast({ title: 'Categories filled', body: `${done} ${done === 1 ? 'item' : 'items'}`, tone: 'success' })
    } catch (err) {
      await refresh()
      setPhase({ kind: 'failed', message: `${mapPgError(err, { entity: 'item' }).message} ${done} ${done === 1 ? 'item was' : 'items were'} filled before it stopped. Run it again to carry on.` })
    }
  }

  const busy = phase.kind === 'filling'
  const plan = phase.kind === 'preview' || phase.kind === 'filling' || phase.kind === 'done' ? phase.plan : null
  const total = plan?.total ?? 0

  return (
    <Dialog open busy={busy} onOpenChange={o => (o || busy ? null : onClose())}>
      <DialogContent
        size="sm"
        title="Fill missing categories"
        context="Gives every RFQ item and order line without a category the one the dictionary names."
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              {phase.kind === 'done' ? 'Close' : 'Cancel'}
            </Button>
            {phase.kind === 'preview' && phase.plan.total > 0 ? (
              <Button variant="primary" onClick={() => void run(phase.plan)}>
                {`Fill ${phase.plan.total} ${phase.plan.total === 1 ? 'item' : 'items'}`}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="grid gap-4" aria-live="polite">
          {phase.kind === 'reading' ? (
            <div role="status" aria-busy="true" aria-label="Reading the items" className="grid gap-2">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}
          {phase.kind === 'failed' ? (
            <Banner tone="danger" title="Not everything was filled">
              {phase.message}
            </Banner>
          ) : null}
          {plan ? (
            <>
              <p className="text-base font-medium" data-testid="fill-summary">
                {plan.total === 0 ? 'Nothing to fill.' : phase.kind === 'done' ? `Filled ${phase.done} of ${total}.` : phase.kind === 'filling' ? `Filling… ${phase.done} of ${total}` : `${planSummary(plan)} would be filled.`}
              </p>
              {phase.kind === 'filling' ? <progress className="h-3 w-full" max={total} value={phase.done} aria-label="Items filled" /> : null}
              {plan.groups.length > 0 ? (
                <ul className="grid gap-1" aria-label="Items per category">
                  {plan.groups.map(g => (
                    <li key={g.familyId} className="flex items-baseline justify-between gap-3 border-b py-1 text-base last:border-b-0">
                      <span className="min-w-0">{g.name}</span>
                      <span className="num text-fg-2">{g.rfqItemIds.length + g.orderItemIds.length}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-base text-fg-muted" data-testid="fill-left-alone">
                {plan.scanned} without a category. Left alone: {plan.unsure} where two categories fit, {plan.unknown} the dictionary does not know.
              </p>
              <p className="text-base text-fg-muted">Changes are made in batches of 200 and every one is kept in the history.</p>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
