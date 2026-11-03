import { cn } from '@/lib/utils'
import { Skeleton } from '@/ui/Skeleton'
import type { KeyFact } from '@/features/jobs/lib/keyFacts'

/** The Job page header's key facts: Customer PO (admin and sales), Supplier, Delivery. Read-only text, no buttons, no request of its own. */
export function JobKeyFacts({ facts }: { facts: KeyFact[] }) {
  return (
    <dl aria-label="Key facts" className="mt-3 grid gap-2 text-base sm:grid-cols-3 sm:gap-4">
      {facts.map(f => (
        <div key={f.key} className="flex gap-2 sm:grid sm:gap-1" data-fact={f.key}>
          <dt className="text-fg-muted">{f.label}</dt>
          <dd className={cn('min-w-0 font-medium [overflow-wrap:anywhere]', f.key === 'po' && 'num')}>{f.value === null ? <Skeleton className="h-5 w-16" /> : f.value}</dd>
        </div>
      ))}
    </dl>
  )
}
