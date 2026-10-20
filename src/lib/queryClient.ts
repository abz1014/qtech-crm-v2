import { onlineManager, QueryClient, type Query } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { wireOnlineManager } from '@/lib/connection'

/** A refresh on return to the app happens only for data at least this old, whatever a query's own staleTime is. */
export const FOCUS_REFETCH_MIN_AGE_MS = 30_000

/**
 * Coming back to the app (from WhatsApp, the lock screen, another tab) refreshes what is on screen, once its data is
 * older than both its staleTime and FOCUS_REFETCH_MIN_AGE_MS. The floor keeps the staleTime-0 reads (Month-end, the
 * reports, a dialog's next number) from refetching on every quick switch: no request storm on a phone that flips between
 * apps. TanStack listens to visibilitychange, so this is the phone case, not a click between windows.
 */
export function refetchOnReturn(query: Query): boolean {
  return Date.now() - query.state.dataUpdatedAt >= FOCUS_REFETCH_MIN_AGE_MS
}

/**
 * The app's one query client. A module singleton (not React context) so non-React code, such as a
 * command-palette source, can use the same cache as the screens.
 *
 * What refreshes after a write stays the invalidation map's job (src/features/invalidation.ts); these defaults only decide
 * how fresh a read must be when a screen mounts, the app comes back to the front, or the network returns.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: refetchOnReturn,
      refetchOnReconnect: true,
    },
  },
})

/**
 * Reference data: changes rarely, and this tab's own edits already refresh it through the invalidation map, so a return
 * to the app does not need to re-read it. Only reads whose hooks set no staleTime of their own take this.
 */
export const REFERENCE_STALE_MS = 5 * 60_000
for (const key of [qk.settings.profile(), qk.settings.categories(), qk.settings.myDetails(), qk.money.categories(), qk.brands.all, qk.fx.latest()]) {
  queryClient.setQueryDefaults(key, { staleTime: REFERENCE_STALE_MS })
}

// Offline at a cold start, or holding requests until the session is live: queries pause instead of failing (connection.ts).
wireOnlineManager(onlineManager)
