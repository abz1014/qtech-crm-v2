import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/ui/Skeleton'

/*
 * NextStepBox (UX overhaul 2026-10-20, consistency spec "Next-step box"): the box under a detail page's title with one sentence (what to
 * do, or what the record waits for) and the page's one green button. Shared by the order page and the RFQ page.
 * Direction C draws it as the navy band (data-surface="navy" re-inks the buttons inside; the green one gets its white ring):
 *   tone 'action'  a step to take: the navy band, the sentence in white
 *   tone 'late'    the same band, the sentence in the late block's tint (the danger family, 11.7:1 on navy)
 *   tone 'quiet'   no step waits, only a hint (Forest 71-company-page): a white card with a hairline edge, the sentence in the body ink,
 *                  the button on the right. "Next step" is heard, not drawn: the sentence says it.
 * `loading` draws a placeholder (aria-busy) until the page knows the step.
 */
export function NextStepBox({ text, tone = 'action', action, loading = false }: { text?: ReactNode; tone?: 'action' | 'late' | 'quiet'; action?: ReactNode; loading?: boolean }) {
  if (loading) {
    return (
      <section aria-label="Next step" aria-busy="true" className="mt-4 rounded-panel bg-sunken px-4 py-4 md:px-5">
        <Skeleton className="h-5 w-[18rem] max-w-full" />
      </section>
    )
  }
  const quiet = tone === 'quiet'
  return (
    <section
      aria-label="Next step"
      data-surface={quiet ? undefined : 'navy'}
      className={cn(
        'mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3',
        quiet ? 'rounded-card border bg-surface px-card py-3 text-fg-2' : 'rounded-panel bg-chrome px-4 py-4 text-fg md:px-5',
      )}
    >
      <p className={cn('min-w-0 [text-wrap:wrap]', quiet ? 'text-base' : 'text-lg')}>
        <span className={cn('mr-2 text-base', quiet ? 'sr-only' : 'text-fg-muted')}>Next step</span>
        <span className={cn('font-semibold', tone === 'late' && 'text-tone-danger-bg', quiet && 'font-regular text-fg-2')}>{text}</span>
      </p>
      {action}
    </section>
  )
}
