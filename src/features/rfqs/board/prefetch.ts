import type { Prefetch } from '@/app/routeChunks'
import { openRfqsQuery, rfqValuesQuery } from '@/features/rfqs/board/hooks'

/**
 * The RFQ list's first reads, started by the app before the page is drawn (src/app/routeChunks.ts). The Value column is money:
 * read for admin and sales only, as the page does.
 */
export const prefetch: Prefetch = ({ client, user }) =>
  Promise.all([client.prefetchQuery(openRfqsQuery()), user.role === 'admin' || user.role === 'sales' ? client.prefetchQuery(rfqValuesQuery()) : null])
