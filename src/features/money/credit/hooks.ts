import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/credit/api'

/** Customer credit hooks (0117, 0118). Admin only: pass `enabled = isAdmin`, so nobody else makes the request. */
export function useCompanyCredit(companyId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.companies.part(companyId ?? '', 'credit'),
    queryFn: () => api.getCompanyCredit(companyId as string),
    enabled: Boolean(companyId) && enabled,
  })
}

/** The orders that still owe money, read when the Apply dialog opens (today's balances, never a cached one). */
export function useApplyTargets(companyId: string, enabled: boolean) {
  return useQuery({ queryKey: [...qk.companies.part(companyId, 'credit'), 'targets'], queryFn: () => api.listApplyTargets(companyId), enabled, staleTime: 0 })
}

export function useCompanyOrders(companyId: string, enabled: boolean) {
  return useQuery({ queryKey: [...qk.companies.part(companyId, 'credit'), 'orders'], queryFn: () => api.listCompanyOrders(companyId), enabled })
}

export function useRecordRefund(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: api.RefundInsert) => api.recordRefund(v),
    onSuccess: () => invalidateAfter(client, 'refund.record', { companyId }),
  })
}

export function useApplyCredit(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: api.ApplyInsert) => api.applyCredit(v),
    onSuccess: () => invalidateAfter(client, 'credit.apply', { companyId }),
  })
}

export function useRemoveCreditEntry(companyId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { kind: 'refund' | 'applied'; id: string }) => (v.kind === 'refund' ? api.deleteRefund(v.id) : api.deleteApplication(v.id)),
    onSuccess: () => invalidateAfter(client, 'credit.remove', { companyId }),
  })
}
