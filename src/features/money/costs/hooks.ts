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
