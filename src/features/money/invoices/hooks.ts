import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/invoices/api'

/*
 * Invoice hooks (R01 pattern). Reads take `enabled`: Money's invoice data is for admin and sales, so for an engineer the
 * request is never made. Writes name themselves in the invalidation map.
 */
export function useGstRegister(enabled = true) {
  return useQuery({ queryKey: qk.money.invoices.register(), queryFn: api.listGstRegister, enabled })
}

export function useInvoice(id: string | null | undefined) {
  return useQuery({ queryKey: qk.money.invoices.detail(id ?? ''), queryFn: () => api.getInvoice(id as string), enabled: Boolean(id) })
}

export function useNextInvoiceNumber(enabled = true) {
  return useQuery({ queryKey: qk.money.invoices.nextNumber(), queryFn: api.nextInvoiceNumber, enabled, staleTime: 0, gcTime: 0 })
}

export function useOrderForInvoice(orderId: string | null | undefined) {
  return useQuery({
    queryKey: qk.money.invoices.forOrder(orderId ?? ''),
    queryFn: () => api.orderForInvoice(orderId as string),
    enabled: Boolean(orderId),
    staleTime: 0,
  })
}

export function useInvoiceableOrders(enabled = true) {
  return useQuery({ queryKey: qk.money.invoices.invoiceable(), queryFn: api.listInvoiceableOrders, enabled, staleTime: 30_000 })
}

export function useInvoiceReceipts(id: string | null | undefined) {
  return useQuery({ queryKey: qk.money.invoices.receipts(id ?? ''), queryFn: () => api.listReceipts(id as string), enabled: Boolean(id) })
}

export function useCreateInvoice() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: api.InvoiceInsert) => api.createInvoice(v),
    onSuccess: () => invalidateAfter(client, 'invoice.create', {}),
  })
}

export function useUpdateInvoice(invoiceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<api.InvoicePatch>) => api.updateInvoice(invoiceId, patch),
    onSuccess: () => invalidateAfter(client, 'invoice.update', { invoiceId }),
  })
}

export function useUploadInvoiceReceipt(invoiceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { file: File; today: string }) => api.uploadReceipt(invoiceId, v.file, v.today),
    onSuccess: () => invalidateAfter(client, 'invoice.receipt', { invoiceId }),
  })
}

export function useDeleteInvoiceReceipt(invoiceId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (r: Pick<api.InvoiceReceipt, 'id' | 'path'>) => api.deleteReceipt(r),
    onSuccess: () => invalidateAfter(client, 'invoice.receipt', { invoiceId }),
  })
}

/** The three monthly stamps. Each returns what changed and a function that puts it back (the toast's Undo). */
export function useStamps() {
  const client = useQueryClient()
  const done = () => invalidateAfter(client, 'invoice.stamp', {})
  return {
    async tcs(ids: readonly string[]) {
      const before = await api.snapshotForStamp(ids)
      const n = await api.stampTcsSent(ids)
      await done()
      const changed = before.filter(b => b.tcs_sent_on === null)
      return { n, undo: async () => { await api.restoreStamp(changed, ['tcs_sent_on', 'tcs_number']); await done() } }
    },
    async psid(ids: readonly string[], psid: string) {
      const before = await api.snapshotForStamp(ids)
      const n = await api.stampPsid(ids, psid)
      await done()
      return { n, undo: async () => { await api.restoreStamp(before, ['psid']); await done() } }
    },
    async deposited(ids: readonly string[]) {
      const before = await api.snapshotForStamp(ids)
      const n = await api.stampDeposited(ids)
      await done()
      const changed = before.filter(b => b.tax_deposited_on === null)
      return { n, undo: async () => { await api.restoreStamp(changed, ['tax_deposited_on', 'tax_deposit_amount']); await done() } }
    },
  }
}
