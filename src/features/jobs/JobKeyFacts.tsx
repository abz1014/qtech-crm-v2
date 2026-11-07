import { cn } from '@/lib/utils'
import { Skeleton } from '@/ui/Skeleton'
import type { KeyFact } from '@/features/jobs/lib/keyFacts'

/**
 * The Job page's key facts, one compact line under the stage block: Customer PO (admin and sales), Supplier, Delivery. Read-only text, no
 * buttons, no request of its own. The PO is shown here once and nowhere else on the page. A value of null means "still loading".
 */
export function JobKeyFacts({ facts }: { facts: KeyFact[] }) {
  return (
    <dl aria-label="Key facts" className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-base">
      {facts.map(f => (
        <div key={f.key} className="flex min-w-0 items-baseline gap-2" data-fact={f.key}>
          <dt className="shrink-0 text-fg-muted">{f.label}</dt>
          <dd className={cn('min-w-0 font-medium [overflow-wrap:anywhere]', f.key === 'po' && 'num')}>{f.value === null ? <Skeleton className="h-5 w-16" /> : f.value}</dd>
        </div>
      ))}
    </dl>
  )
}
