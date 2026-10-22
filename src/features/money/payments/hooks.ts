import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/payments/api'

/** Payments and receivables hooks (R01 pattern). Reads take `enabled`; a payment row is admin only. */
export function useReceivables(enabled = true) {
  return useQuery({ queryKey: qk.money.receivables.list(), queryFn: api.listReceivables, enabled })
}

/** Who owes us totals, counted on the server (receivables_summary). */
export function useReceivablesSummary(today: string, enabled = true) {
  return useQuery({ queryKey: qk.money.receivables.summary(today), queryFn: () => api.getReceivablesSummary(today), enabled })
}

/** Advances held on cancelled orders (admin only: pass enabled = isAdmin). */
export function useHeldAdvances(enabled: boolean) {
  return useQuery({ queryKey: qk.money.receivables.held(), queryFn: api.listHeldAdvances, enabled })
}

export function usePaymentOrder(orderId: string | null | undefined) {
  return useQuery({
    queryKey: qk.money.receivables.order(orderId ?? ''),
    queryFn: () => api.getPaymentOrder(orderId as string),
    enabled: Boolean(orderId),
    staleTime: 0,
  })
}

export function useRecordPayment(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: api.PaymentInsert) => api.recordPayment(v),
    onSuccess: () => invalidateAfter(client, 'payment.record', { orderId }),
  })
}
