import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/purchaseOrders/api'

/*
 * Supplier PO hooks (O07). The pre-fill and the supplier's last PO are read only while the dialog is open, and never kept, so they are
 * always fresh: a price written back by an earlier issue must show on the next one.
 */

export function usePoPrefill(legId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.purchaseOrders.prefill(legId ?? ''),
    queryFn: () => api.getPrefill(legId as string),
    enabled: enabled && Boolean(legId),
    staleTime: 0,
    gcTime: 0,
  })
}

export function useLastPoToSupplier(supplierId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.purchaseOrders.lastToSupplier(supplierId ?? ''),
    queryFn: () => api.getLastPoToSupplier(supplierId as string),
    enabled: enabled && Boolean(supplierId),
    staleTime: 0,
    gcTime: 0,
  })
}

export function useLegPo(legId: string | undefined, enabled = true) {
  return useQuery({ queryKey: qk.purchaseOrders.leg(legId ?? ''), queryFn: () => api.getLegPo(legId as string), enabled: enabled && Boolean(legId) })
}

export function useNextPoNumber(enabled: boolean) {
  return useQuery({ queryKey: qk.purchaseOrders.nextNumber(), queryFn: api.getNextPoNumber, enabled, staleTime: 0, gcTime: 0 })
}

/** One confirm issues the PO. The id is made by the caller and kept for a retry, so a double tap issues one PO. */
export function useIssuePo(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: api.IssueInput) => api.issuePurchaseOrder(input),
    onSuccess: () => invalidateAfter(client, 'po.issue', { orderId }),
  })
}

export function useStorePoPdf(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { po: { id: string; revision: number }; pdf: Blob }) => api.storePoPdf(v.po, v.pdf),
    onSuccess: () => invalidateAfter(client, 'po.pdf', { orderId }),
  })
}

export function useSetLegCurrency(orderId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { legId: string; currency: string }) => api.setLegCurrency(v.legId, v.currency),
    onSuccess: () => invalidateAfter(client, 'order.update', { orderId }),
  })
}
