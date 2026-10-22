import type { Prefetch } from '@/app/routeChunks'
import { orderEngineersQuery, orderHeaderQuery, orderItemsQuery, orderLegsQuery, orderMoneyQuery, ordersListQuery } from '@/features/orders/hooks'
import { companyProfileQuery } from '@/features/settings/hooks'

type Role = 'admin' | 'sales' | 'engineer'
const roleOf = (role: string): Role | null => (role === 'admin' || role === 'sales' || role === 'engineer' ? role : null)

/** The orders list's first read, started by the app before the page is drawn (src/app/routeChunks.ts). */
export const prefetchList: Prefetch = ({ client, user }) => {
  const role = roleOf(user.role)
  return role ? client.prefetchQuery(ordersListQuery(role)) : Promise.resolve()
}

/**
 * The order page's first reads, the same the page makes for this role (prices and the balance for admin and sales only). The
 * supplier orders are read in the same round: the page applies the items to them when it draws, not when it reads.
 */
export const prefetchOrder: Prefetch = ({ client, user, id }) => {
  const role = roleOf(user.role)
  if (!id || !role) return Promise.resolve()
  const money = role === 'admin' || role === 'sales'
  return Promise.all([
    client.prefetchQuery(orderHeaderQuery(id, money)),
    client.prefetchQuery(orderItemsQuery(id, money)),
    client.prefetchQuery(orderLegsQuery(id)),
    client.prefetchQuery(orderEngineersQuery(id)),
    role === 'engineer' ? null : client.prefetchQuery(orderMoneyQuery(id, role)),
    // The header's terms fall back to the company's default terms: read in this round, not after the header is drawn (perf/lcp:
    // a read started as the header drew was one more round trip before the page counted as painted).
    client.prefetchQuery(companyProfileQuery()),
  ])
}
