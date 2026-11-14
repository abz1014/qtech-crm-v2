import { MutationCache, onlineManager, QueryClient, type Query } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { wireOnlineManager } from '@/lib/connection'
import { refuseOutdatedSave } from '@/lib/pwa/minVersion'

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
 * Saves never wait silently for the network (BUG-RES-1, U07). TanStack's default networkMode 'online' pauses a mutation while
 * the onlineManager says offline: the dialog sat on "Saving" with nothing to say. Instead a save fails fast when there is
 * no connection (or no live session, see holdNetwork in connection.ts) and the form shows the plain sentence and Try
 * again; networkMode 'always' also stops a save that loses signal mid-flight from pausing instead of failing. The refusal is a
 * TypeError, like a failed fetch, so mapPgError gives the U07 sentence "Check your connection and try again. Trying again will
 * not create a duplicate." and Try again reuses the same client request id.
 */
export function refuseOfflineSave(): void {
  if (!onlineManager.isOnline()) throw new TypeError('offline')
}

/** PostgREST's "not ready yet" answers (schema cache loading or connecting to the database, HTTP 503): worth a few tries. */
const TRANSIENT_CODES = new Set(['PGRST000', 'PGRST001', 'PGRST002', 'PGRST003'])
/** Retries for a transient answer (TanStack's backoff: 1, 2, 4 s). Anything else, including no signal, is retried once. */
export const TRANSIENT_RETRIES = 3

/**
 * How often a failed read is tried again (audit 1 major 5: errors were shown 10 to 20 s late). The database client no longer
 * retries by itself (supabaseClient.ts), so this is the only retry: once, a second later, for a failed request or an
 * unexpected answer, so a screen says "could not load" within about two seconds of the second failure instead of sitting on
 * its skeleton; up to TRANSIENT_RETRIES times while PostgREST says it is still starting.
 */
export function retryRead(failureCount: number, error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : ''
  return failureCount < (TRANSIENT_CODES.has(code) ? TRANSIENT_RETRIES : 1)
}

/**
 * The app's one query client. A module singleton (not React context) so non-React code, such as a
 * command-palette source, can use the same cache as the screens.
 *
 * What refreshes after a write stays the invalidation map's job (src/features/invalidation.ts); these defaults only decide
 * how fresh a read must be when a screen mounts, the app comes back to the front, or the network returns.
 */
export const queryClient = new QueryClient({
  // Offline first (the U07 sentence), then an app older than the server's minimum (owner decision 2026-10-22, pwa/minVersion.ts).
  mutationCache: new MutationCache({
    onMutate: () => {
      refuseOfflineSave()
      refuseOutdatedSave()
    },
  }),
  defaultOptions: {
    mutations: { networkMode: 'always' },
    queries: {
      staleTime: 30_000,
      retry: retryRead,
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
