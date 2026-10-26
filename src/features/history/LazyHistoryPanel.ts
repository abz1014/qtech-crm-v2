import { lazyDialog } from '@/lib/lazyDialog'

/** The History panel, downloaded the first time it opens, so it is not in the first-load bundle. */
export const LazyHistoryPanel = lazyDialog(() => import('@/features/history/HistoryPanel').then(m => m.HistoryPanel))
