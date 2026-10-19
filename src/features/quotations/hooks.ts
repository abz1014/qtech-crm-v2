import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { invalidateAfter } from '@/features/invalidation'
import * as api from '@/features/quotations/api'
import * as companiesApi from '@/features/companies/api'

export function useQuotations(rfqId: string | undefined) {
  return useQuery({ queryKey: qk.rfqs.part(rfqId ?? '', 'quotations'), queryFn: () => api.listQuotations(rfqId as string), enabled: Boolean(rfqId) })
}

/** Items with their working quoted prices. Read only while the dialog is open, and never kept, so it is always fresh. */
export function useQuoteItems(rfqId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.rfqs.part(rfqId ?? '', 'quote-items'),
    queryFn: () => api.listQuoteItems(rfqId as string),
    enabled: enabled && Boolean(rfqId),
    staleTime: 0,
    gcTime: 0,
  })
}

export function usePriceMemory(rfqId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.rfqs.part(rfqId ?? '', 'price-memory'),
    queryFn: () => api.getPriceMemory(rfqId as string),
    enabled: enabled && Boolean(rfqId),
    gcTime: 0,
  })
}

export function useCompanyContacts(companyId: string | undefined, enabled: boolean) {
  return useQuery({
    // The same cache entry as the company page's Contacts panel, so it must hold the same rows: read them with the same
    // query and shape them here (a different queryFn under one key served one screen the other's rows).
    queryKey: qk.companies.part(companyId ?? '', 'contacts'),
    queryFn: () => companiesApi.listContacts(companyId as string),
    select: (rows: companiesApi.ContactRow[]): api.ContactChoice[] => rows.map(r => ({ id: r.id, name: r.name, jobTitle: r.job_title })),
    enabled: enabled && Boolean(companyId),
  })
}

export function useIssueQuotation(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: api.IssueInput) => api.issueQuotation(input),
    onSuccess: () => invalidateAfter(client, 'quotation.issue', { rfqId }),
  })
}

export function useStorePdf(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { quotation: Pick<api.QuotationRow, 'id' | 'revision'>; pdf: Blob }) => api.storePdf(v.quotation, v.pdf),
    onSuccess: () => invalidateAfter(client, 'quotation.pdf', { rfqId }),
  })
}
