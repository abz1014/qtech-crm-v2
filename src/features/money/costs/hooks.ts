import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/money/costs/api'

/*
 * Order costs (M04) hooks. Admin only: every read takes `enabled`, so for anyone else no request is made (the network log
 * of a sales or engineer session holds no order_costs, expenses or v_order_money call).
 */
export function useOrderCosts(orderId: string | undefined, enabled: boolean) {
  return useQuery({ queryKey: qk.money.orderCosts(orderId ?? ''), queryFn: () => api.getOrderCosts(orderId as string), enabled: Boolean(orderId) && enabled })
}

export function useSetExpectedCost(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (value: number | null) => api.setExpectedCost(orderId, value),
    onSuccess: () => invalidateAfter(client, 'costs.save', { orderId }),
  })
}

export function useFillExpectedCost(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (value: number) => api.fillExpectedCostIfEmpty(orderId, value),
    onSuccess: () => invalidateAfter(client, 'costs.save', { orderId }),
  })
}

export function useSetCostsComplete(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { complete: boolean; userId: string }) => api.setCostsComplete(orderId, v.complete, v.userId),
    onSuccess: () => invalidateAfter(client, 'costs.save', { orderId }),
  })
}

/** Batch "Mark costs complete" (entry-burden J16): the Margins list's filtered orders, after a confirm that lists them. */
export function useSetCostsCompleteMany() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (v: { orderIds: readonly string[]; complete: boolean; userId: string }) => {
      for (const id of v.orderIds) await api.setCostsComplete(id, v.complete, v.userId)
    },
    onSettled: (_d, _e, v) => {
      for (const orderId of v.orderIds) void invalidateAfter(client, 'costs.save', { orderId })
    },
  })
}
