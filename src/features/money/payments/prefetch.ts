import type { Prefetch } from '@/app/routeChunks'
import { businessToday } from '@/lib/dates'
import { receivablesQuery, receivablesSummaryQuery } from '@/features/money/payments/hooks'

/** Who owes us: its first reads, started by the app before the page is drawn (src/app/routeChunks.ts). Admin and sales only. */
export const prefetch: Prefetch = ({ client, user }) =>
  user.role === 'admin' || user.role === 'sales'
    ? Promise.all([client.prefetchQuery(receivablesQuery()), client.prefetchQuery(receivablesSummaryQuery(businessToday()))])
    : Promise.resolve()
