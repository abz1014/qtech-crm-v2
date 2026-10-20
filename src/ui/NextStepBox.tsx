import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/ui/Skeleton'

/*
 * NextStepBox (UX overhaul 2026-10-20, consistency spec "Next-step box"): the box under a detail page's title with one sentence (what to
 * do, or what the record waits for) and the page's one green button. Shared by the order page and the RFQ page.
 *   tone 'action'  a step to take: a white box with a stronger edge
 *   tone 'late'    the same, the sentence in the danger colour
 *   tone 'quiet'   nothing to do: a sunken box, the sentence in regular weight
 * `loading` draws a placeholder (aria-busy) until the page knows the step.
 */
export function NextStepBox({ text, tone = 'action', action, loading = false }: { text?: ReactNode; tone?: 'action' | 'late' | 'quiet'; action?: ReactNode; loading?: boolean }) {
  if (loading) {
    return (
      <section aria-label="Next step" aria-busy="true" className="mt-4 rounded border bg-sunken px-4 py-3 md:px-5">
        <Skeleton className="h-5 w-72 max-w-full" />
      </section>
    )
  }
  const quiet = tone === 'quiet'
  return (
    <section aria-label="Next step" className={cn('mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded border px-4 py-3 md:px-5', quiet ? 'bg-sunken' : 'border-line-strong bg-surface')}>
      <p className="min-w-0 text-base">
        <span className="mr-2 text-sm text-fg-muted">Next step</span>
        <span className={cn('font-medium', tone === 'late' && 'text-tone-danger-fg', quiet && 'font-regular text-fg-2')}>{text}</span>
      </p>
      {action}
    </section>
  )
}
