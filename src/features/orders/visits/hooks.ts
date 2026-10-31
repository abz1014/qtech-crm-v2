import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/orders/visits/api'
import type { VisitDraft } from '@/features/orders/visits/model'

/* One hook per read and write. A visit write also moves the order's planned and done dates (the database keeps them), so it refreshes the order page like any order edit. */

export const orderVisitsQuery = (orderId: string) => ({ queryKey: qk.orders.part(orderId, 'visits'), queryFn: () => api.listVisits(orderId) })

export function useOrderVisits(orderId: string | undefined, enabled = true) {
  return useQuery({ ...orderVisitsQuery(orderId ?? ''), enabled: enabled && Boolean(orderId) })
}

export function useCreateVisit(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (draft: VisitDraft) => api.createVisit(orderId, draft),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useUpdateVisit(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: Parameters<typeof api.updateVisit>[1] }) => api.updateVisit(v.id, v.patch),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}

export function useDeleteVisit(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteVisit(id),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}
