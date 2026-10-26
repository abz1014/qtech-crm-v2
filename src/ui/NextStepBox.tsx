import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/ui/Skeleton'

/*
 * NextStepBox (UX overhaul 2026-10-20, consistency spec "Next-step box"): the box under a detail page's title with one sentence (what to
 * do, or what the record waits for) and the page's one green button. Shared by the order page and the RFQ page.
 * Direction C draws it as the navy band (data-surface="navy" re-inks the buttons inside; the green one gets its white ring):
 *   tone 'action'  a step to take: the navy band, the sentence in white
 *   tone 'late'    the same band, the sentence in the late block's tint (the danger family, 11.7:1 on navy)
 *   tone 'quiet'   nothing to do: a quiet block, the sentence in regular weight
 * `loading` draws a placeholder (aria-busy) until the page knows the step.
 */
export function NextStepBox({ text, tone = 'action', action, loading = false }: { text?: ReactNode; tone?: 'action' | 'late' | 'quiet'; action?: ReactNode; loading?: boolean }) {
  if (loading) {
    return (
      <section aria-label="Next step" aria-busy="true" className="mt-4 rounded-panel bg-sunken px-4 py-4 md:px-5">
        <Skeleton className="h-5 w-72 max-w-full" />
      </section>
    )
  }
  const quiet = tone === 'quiet'
  return (
    <section
      aria-label="Next step"
      data-surface={quiet ? undefined : 'navy'}
      className={cn('mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-panel px-4 py-4 md:px-5', quiet ? 'bg-sunken' : 'bg-chrome text-fg')}
    >
      <p className="min-w-0 text-lg">
        <span className="mr-2 text-base text-fg-muted">Next step</span>
        <span className={cn('font-semibold', tone === 'late' && 'text-tone-danger-bg', quiet && 'font-regular text-fg-2')}>{text}</span>
      </p>
      {action}
    </section>
  )
}
