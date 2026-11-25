import { cn } from '@/lib/utils'
import { SLOW_LOAD_TEXT, useSlowLoad } from '@/lib/useSlowLoad'
import { CARD } from '@/ui/card'
import { Skeleton } from '@/ui/Skeleton'
import { NotOpenedMessage, OFFLINE_GRACE_MS } from '@/ui/OfflineNotOpened'
import { useConnection } from '@/lib/connection'

/**
 * The page-shaped placeholder while a page's code downloads (the route's Suspense fallback): a title, a line under it and two
 * cards, on the same frame as a list page, so the shell never shows a blank page between a tap and the page (audit 1 cross-lane).
 * After SLOW_LOAD_MS it says it is still loading and what to check. Offline, a page whose code this device never downloaded
 * cannot arrive: after OFFLINE_GRACE_MS the placeholders give way to the sentence that says so (review 24 Nov, screen 11).
 */
export function PageLoading() {
  const slow = useSlowLoad(true)
  const notOpened = useSlowLoad(useConnection() !== 'online', OFFLINE_GRACE_MS)
  if (notOpened) {
    return (
      <div role="status" aria-label="This page is not on this device" className="mx-auto grid w-full max-w-table content-start gap-card-gap px-gutter pb-12 pt-6">
        <NotOpenedMessage />
      </div>
    )
  }
  return (
    <div role="status" aria-label="Loading the page" className="mx-auto grid w-full max-w-table content-start gap-card-gap px-gutter pb-12 pt-6">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-[14rem] max-w-full" />
        <Skeleton className="h-4 w-[22rem] max-w-full" />
      </div>
      {[0, 1].map(i => (
        <div key={i} className={cn(CARD, 'grid gap-3 p-card')}>
          <Skeleton className="h-5 w-[10rem] max-w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ))}
      {slow ? <p className="text-sm text-fg-muted">{SLOW_LOAD_TEXT}</p> : null}
    </div>
  )
}
