import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/orders/challans/api'

export const orderChallansQuery = (orderId: string) => ({ queryKey: qk.orders.part(orderId, 'challans'), queryFn: () => api.listChallans(orderId) })

export function useOrderChallans(orderId: string | undefined) {
  return useQuery({ ...orderChallansQuery(orderId ?? ''), enabled: Boolean(orderId) })
}

/** Issuing a challan changes only the challan list; it refreshes with the order's reads like any other edit on the page. */
export function useCreateChallan(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof api.createChallan>[0], 'orderId'>) => api.createChallan({ ...input, orderId }),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}
