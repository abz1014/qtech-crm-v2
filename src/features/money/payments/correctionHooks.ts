import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/payments/correctionApi'

/*
 * Payment corrections (0073), R01 pattern: reads take `enabled` (payments are admin only, so pass `role === 'admin'`), and each
 * write names itself in the invalidation map ('payment.void', 'payment.correct', 'payment.restore'), which refreshes every
 * figure built on payments.
 */

/** One order's payments, voided ones included, for the payment rows on the order page (admin). */
export function useOrderPayments(orderId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.money.receivables.payments(orderId ?? ''),
    queryFn: () => api.listOrderPayments(orderId as string),
    enabled: enabled && Boolean(orderId),
  })
}

/** Void a payment (reason required). */
export function useVoidPayment(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: api.VoidInput) => api.voidPayment(v),
    onSuccess: () => invalidateAfter(client, 'payment.void', { orderId }),
  })
}

/** Correct a payment: the old one is voided and the new figures are recorded; resolves to the new payment's id. */
export function useCorrectPayment(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: api.CorrectionInput) => api.correctPayment(v),
    onSuccess: () => invalidateAfter(client, 'payment.correct', { orderId }),
  })
}

/** Delete a payment (admin): the same lists as a void go stale. */
export function useDeletePayment(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) => api.deletePayment(paymentId),
    onSuccess: () => invalidateAfter(client, 'payment.void', { orderId }),
  })
}

/** Undo of a void or a correction: pass the id of the payment that was voided (for a correction, the original). */
export function useRestorePayment(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (paymentId: string) => api.restorePayment(paymentId),
    onSuccess: () => invalidateAfter(client, 'payment.restore', { orderId }),
  })
}
