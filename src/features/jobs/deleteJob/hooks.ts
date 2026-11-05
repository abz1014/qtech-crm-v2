import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import { deleteJob, getJobDeleteBlockers, type JobIds } from '@/features/jobs/deleteJob/api'

/** What stops this job being deleted. Always read fresh when the dialog opens (the books may have moved since the page loaded). */
export function useJobDeleteBlockers(j: JobIds, enabled = true) {
  return useQuery({
    queryKey: [...qk.jobs.all, 'delete-blockers', j.rfqId ?? '', j.orderId ?? ''],
    queryFn: () => getJobDeleteBlockers(j),
    enabled,
    staleTime: 0,
    gcTime: 0,
  })
}

/** The delete itself. It refreshes nothing: the flow leaves the page first, then calls `refreshAfterJobDelete`. */
export function useDeleteJob() {
  return useMutation({ mutationFn: (j: JobIds) => deleteJob(j) })
}

/** After the page is left: drop the deleted pages and refresh the lists, Today, the customer and the money. */
export function refreshAfterJobDelete(client: QueryClient, j: JobIds & { key: string }): Promise<void> {
  client.removeQueries({ queryKey: qk.jobs.detail(j.key) })
  if (j.orderId) client.removeQueries({ queryKey: qk.orders.detail(j.orderId) })
  if (j.rfqId) client.removeQueries({ queryKey: qk.rfqs.detail(j.rfqId) })
  return Promise.all([
    j.orderId ? invalidateAfter(client, 'order.delete', { orderId: j.orderId }) : Promise.resolve(),
    j.rfqId ? invalidateAfter(client, 'rfq.delete', { rfqId: j.rfqId }) : Promise.resolve(),
  ]).then(() => undefined)
}
