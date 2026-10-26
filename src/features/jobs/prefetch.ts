import type { Prefetch } from '@/app/routeChunks'
import { cancelledOrdersQuery, jobFactsQuery, jobInvoicesQuery, jobsListQuery } from '@/features/jobs/hooks'
import { qk } from '@/features/queryKeys'
import { resolveOldAddress } from '@/features/jobs/oldAddress'
import { listOrderAttachments } from '@/features/rfqs/api'
import { prefetchRfqParts, rfqInquiriesQuery, rfqItemsQuery } from '@/features/rfqs/hooks'
import { orderEngineersQuery, orderHeaderQuery, orderItemsQuery, orderLegsQuery, orderMoneyQuery } from '@/features/orders/hooks'

/** The Jobs list's first read, started by the app before the page is drawn (src/app/routeChunks.ts). */
export const prefetchList: Prefetch = ({ client, user }) => client.prefetchQuery(jobsListQuery(user.role))

type Role = 'admin' | 'sales' | 'engineer'
const roleOf = (role: string): Role | null => (role === 'admin' || role === 'sales' || role === 'engineer' ? role : null)

/**
 * The job page's reads, started before the page is drawn, in two rounds (perf/lcp, as the order page): round one is the job itself
 * (the view and the enquiry or order with the names, together); the moment its ids are known, round two starts every panel's read
 * at once, on the same query keys the panels use, so they find the data (or the request on its way) and never ask twice.
 * An engineer's reads carry no price (the same hooks, the same `money` switch).
 */
export const prefetchJob: Prefetch = async ({ client, user, id, pathname }) => {
  const role = roleOf(user.role)
  if (!id || !role) return
  // An old RFQ or order address (the Job page opens for it): the key and the job's facts come back in one round, then the panels as below.
  const old = pathname ? /^\/(rfqs|orders)\/[^/]+\/?$/.exec(pathname) : null
  const found = old ? await resolveOldAddress(client, old[1] === 'rfqs' ? 'rfq' : 'order', id).catch(() => null) : null
  if (old && !found) return
  const key = found ?? decodeURIComponent(id)
  const money = role !== 'engineer'
  const facts = await client.fetchQuery(jobFactsQuery(key))
  if (!facts) return
  const { rfqId, orderId } = facts.job
  await Promise.all([
    rfqId ? client.prefetchQuery(rfqItemsQuery(rfqId)) : null,
    rfqId ? client.prefetchQuery(rfqInquiriesQuery(rfqId, money)) : null,
    rfqId ? prefetchRfqParts(client, rfqId, money) : null,
    orderId ? client.prefetchQuery(orderHeaderQuery(orderId, money)) : null,
    orderId ? client.prefetchQuery(orderItemsQuery(orderId, money)) : null,
    orderId ? client.prefetchQuery(orderLegsQuery(orderId)) : null,
    orderId ? client.prefetchQuery(orderEngineersQuery(orderId)) : null,
    orderId && role !== 'engineer' ? client.prefetchQuery(orderMoneyQuery(orderId, role)) : null,
    orderId && role !== 'engineer' ? client.prefetchQuery(jobInvoicesQuery(key, orderId)) : null,
    orderId ? client.prefetchQuery({ queryKey: qk.orders.part(orderId, 'files'), queryFn: () => listOrderAttachments(orderId) }) : null,
    rfqId && facts.job.cancelledOrders > 0 ? client.prefetchQuery(cancelledOrdersQuery(key, rfqId)) : null,
  ])
}
