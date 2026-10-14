import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/rfqs/api'
import { searchCompanies } from '@/features/companies/api'

/*
 * RFQ hooks for intake (R05). Same shape as companies (src/features/README.md): one hook per read, one per write,
 * keys from the factory, refreshes named in the invalidation map.
 */

/** Companies matching what is typed in the picker. Nothing is requested until something is typed. */
export function useCompanyMatches(text: string) {
  const q = text.trim()
  return useQuery({
    queryKey: qk.companies.search(q),
    queryFn: () => searchCompanies(q, 8),
    enabled: q.length > 0,
    staleTime: 30_000,
  })
}

/** Everyone who can be asked for a price. Only read once the person reaches the suppliers step. */
export function useSupplierCandidates(enabled: boolean) {
  return useQuery({ queryKey: qk.intake.suppliers(), queryFn: api.listSupplierCandidates, enabled, staleTime: 60_000 })
}

/** What each candidate remembers about each item. `signature` changes when an item's description, brand or family does. */
export function useSupplierMemory(items: readonly api.MemoryQuery[], supplierIds: readonly string[], enabled: boolean) {
  const signature = JSON.stringify([items.map(i => [i.key, i.description, i.brandId, i.familyId]), supplierIds.length])
  return useQuery({
    queryKey: qk.intake.memory(signature),
    queryFn: () => api.getSupplierMemory(items, supplierIds),
    enabled: enabled && items.length > 0,
    staleTime: 60_000,
  })
}

export function useFloatRfq() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: api.FloatInput) => api.floatRfq(input),
    onSuccess: (_saved, input) => invalidateAfter(client, 'rfq.float', { companyId: input.companyId }),
  })
}

export function useSetRfqFloated() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { rfqId: string; floated: boolean }) => api.setRfqFloated(v.rfqId, v.floated),
    onSuccess: (_n, v) => invalidateAfter(client, 'rfq.setFloated', { rfqId: v.rfqId }),
  })
}

export { findRfqByCustomerRef } from '@/features/rfqs/api'
