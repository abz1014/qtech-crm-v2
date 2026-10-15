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

/**
 * What each candidate remembers about each item. `signature` changes when an item's description, brand or family does.
 * `excludeRfqId` (the RFQ detail page) leaves the open RFQ out of its own memory.
 */
export function useSupplierMemory(items: readonly api.MemoryQuery[], supplierIds: readonly string[], enabled: boolean, excludeRfqId?: string) {
  const signature = JSON.stringify([items.map(i => [i.key, i.description, i.brandId, i.familyId]), excludeRfqId ? supplierIds.join(',') : supplierIds.length, excludeRfqId ?? null])
  return useQuery({
    queryKey: excludeRfqId ? qk.memory.rfq(excludeRfqId, signature) : qk.intake.memory(signature),
    queryFn: () => api.getSupplierMemory(items, supplierIds, excludeRfqId),
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

// ================================================================ RFQ detail (R07)

export function useRfqHeader(id: string | undefined) {
  return useQuery({ queryKey: qk.rfqs.part(id ?? '', 'header'), queryFn: () => api.getRfqHeader(id as string), enabled: Boolean(id) })
}

export function useRfqItems(id: string | undefined) {
  return useQuery({ queryKey: qk.rfqs.part(id ?? '', 'items'), queryFn: () => api.listRfqItems(id as string), enabled: Boolean(id) })
}

export function useRfqInquiries(id: string | undefined) {
  return useQuery({ queryKey: qk.rfqs.part(id ?? '', 'inquiries'), queryFn: () => api.listInquiries(id as string), enabled: Boolean(id) })
}

/** Today's rate per currency. Read-only here; a missing rate never blocks a price. */
export function useFxLatest() {
  return useQuery({ queryKey: qk.fx.latest(), queryFn: api.listFxLatest, staleTime: 60_000 })
}

export function useSaveReply(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: api.SaveReplyInput) => api.saveReply(input),
    onSuccess: () => invalidateAfter(client, 'quote.save', { rfqId }),
  })
}

export function useSetInquiryNoOffer(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { inquiryId: string; noOfferOn: string | null; reason: string | null }) => api.setInquiryNoOffer(input),
    onSuccess: () => invalidateAfter(client, 'inquiry.cantQuote', { rfqId }),
  })
}

export function useSetItemDecline(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { inquiryId: string; itemId: string; reason: string | null }) => api.setItemDecline(v),
    onSuccess: () => invalidateAfter(client, 'inquiry.cantQuote', { rfqId }),
  })
}

export function useStampSupplierChase(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (inquiryId: string) => api.stampSupplierChase(inquiryId),
    onSuccess: () => invalidateAfter(client, 'inquiry.chase', { rfqId }),
  })
}

export function useSetBidSent(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (on: string | null) => api.setBidSent(rfqId, on),
    onSuccess: () => invalidateAfter(client, 'rfq.markBidSent', { rfqId }),
  })
}

export function useSetRfqClosed(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { closedOn: string | null; reason: string | null; note: string | null }) => api.setRfqClosed({ rfqId, ...v }),
    onSuccess: () => invalidateAfter(client, 'rfq.close', { rfqId }),
  })
}

// ================================================================ Clarifications and files (R09, R10)

export function useClarifications(rfqId: string | undefined) {
  return useQuery({ queryKey: qk.rfqs.part(rfqId ?? '', 'clarifications'), queryFn: () => api.listClarifications(rfqId as string), enabled: Boolean(rfqId) })
}

export function useRfqAttachments(rfqId: string | undefined) {
  return useQuery({ queryKey: qk.rfqs.part(rfqId ?? '', 'attachments'), queryFn: () => api.listAttachments(rfqId as string), enabled: Boolean(rfqId) })
}

/** Signed links for these files. Re-signed when the set changes; good for 10 minutes, refreshed a little before. */
export function useFileUrls(rfqId: string | undefined, paths: readonly string[]) {
  const signature = [...paths].sort().join('|')
  return useQuery({
    queryKey: qk.rfqs.fileUrls(rfqId ?? '', signature),
    queryFn: () => api.signFileUrls(paths),
    enabled: Boolean(rfqId) && paths.length > 0,
    staleTime: 8 * 60_000,
  })
}

export function useAddClarifications(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (questions: readonly api.NewQuestion[]) => api.addClarifications(rfqId, questions),
    onSuccess: () => invalidateAfter(client, 'clarification.add', { rfqId }),
  })
}

export function useStampClarificationAsk(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: readonly string[]) => api.stampClarificationAsk(ids),
    onSuccess: () => invalidateAfter(client, 'clarification.ask', { rfqId }),
  })
}

export function useSetClarificationAnswer(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; answer: string | null; answeredAt: string | null }) => api.setClarificationAnswer(v),
    onSuccess: () => invalidateAfter(client, 'clarification.answer', { rfqId }),
  })
}

export function useSetClarificationWithdrawn(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; at: string | null }) => api.setClarificationWithdrawn(v.id, v.at),
    onSuccess: () => invalidateAfter(client, 'clarification.withdraw', { rfqId }),
  })
}

export function useSetInquiryRelayed(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { inquiryId: string; at: string | null }) => api.setInquiryRelayed(v.inquiryId, v.at),
    onSuccess: () => invalidateAfter(client, 'clarification.relay', { rfqId }),
  })
}

export function useUploadAttachment(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { clarificationId: string | null; file: File; path: string }) => api.uploadAttachment({ rfqId, ...v }),
    onSuccess: () => invalidateAfter(client, 'attachment.add', { rfqId }),
  })
}

export function useDeleteAttachment(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (att: Pick<api.AttachmentRow, 'id' | 'path'>) => api.deleteAttachment(att),
    onSuccess: () => invalidateAfter(client, 'attachment.delete', { rfqId }),
  })
}

// ================================================================ RFQ detail parity (Part C of the parity audit)

export function useAddRfqItem(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: string; description: string; qty?: number; unit?: string | null }) => api.addRfqItem({ rfqId, ...input }),
    onSuccess: () => invalidateAfter(client, 'item.add', { rfqId }),
  })
}

export function useRemoveQuoteLine(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { inquiryId: string; itemId: string }) => api.removeQuoteLine(input),
    onSuccess: () => invalidateAfter(client, 'quote.save', { rfqId }),
  })
}

export function useRestoreQuoteLine(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (line: api.QuoteLineRow) => api.restoreQuoteLine(line),
    onSuccess: () => invalidateAfter(client, 'quote.save', { rfqId }),
  })
}

/** The stats behind the memory line under each supplier asked. Never blocks the page: if it fails the line is simply absent. */
export function useSupplierStatsFor(supplierIds: readonly string[]) {
  const key = [...supplierIds].sort().join(',')
  return useQuery({ queryKey: qk.rfqs.stats(key), queryFn: () => api.listSupplierStatsFor(supplierIds), enabled: supplierIds.length > 0, staleTime: 60_000 })
}

export function useAddInquiries(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { supplierIds: readonly string[]; sentOn: string }) => api.addInquiries({ rfqId, ...input }),
    onSuccess: () => invalidateAfter(client, 'inquiry.add', { rfqId }),
  })
}

export function useRemoveInquiries(rfqId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: readonly string[]) => api.removeInquiries(ids),
    onSuccess: () => invalidateAfter(client, 'inquiry.add', { rfqId }),
  })
}
