import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requireSupabase, unwrap } from '@/lib/supabase'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import { divRoundHalfUp, paisaToFixed, toPaisa } from '@/lib/money'

/*
 * Void and credit notes (migration 0112). An invoice with a number is never deleted: it is voided (kept, at 0) or, once filed or in
 * a closed month, corrected with a credit note. The database enforces every rule; this file only reads, calls the two functions and
 * works out the GST a credit note will carry so the screen can show it before it is issued (the server works it out the same way).
 */
export interface CreditNote {
  id: string
  number: string
  invoiceId: string
  orderId: string | null
  issuedOn: string
  net: number
  gst: number
  reason: string
}

const toNote = (r: {
  id: string
  number: string
  invoice_id: string
  order_id: string | null
  issued_on: string
  net_amount: number | string
  gst_amount: number | string
  reason: string
}): CreditNote => ({
  id: r.id,
  number: r.number,
  invoiceId: r.invoice_id,
  orderId: r.order_id,
  issuedOn: r.issued_on,
  net: Number(r.net_amount),
  gst: Number(r.gst_amount),
  reason: r.reason,
})

export async function listCreditNotes(invoiceId: string): Promise<CreditNote[]> {
  const rows = unwrap(
    await requireSupabase()
      .from('credit_notes')
      .select('id, number, invoice_id, order_id, issued_on, net_amount, gst_amount, reason')
      .eq('invoice_id', invoiceId)
      .order('number'),
  )
  return (rows ?? []).map(toNote)
}

export async function getCreditNote(id: string): Promise<CreditNote | null> {
  const { data, error } = await requireSupabase()
    .from('credit_notes')
    .select('id, number, invoice_id, order_id, issued_on, net_amount, gst_amount, reason')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? toNote(data) : null
}

/** void_invoice (admin): the number stays, the figures go to 0. The server refuses a filed invoice, a closed month, a paid one. */
export async function voidInvoice(invoiceId: string, reason: string): Promise<void> {
  const { error } = await requireSupabase().rpc('void_invoice', { p_invoice_id: invoiceId, p_reason: reason.trim() })
  if (error) throw error
}

/** create_credit_note (admin): CN-0001 series. A null GST is worked out by the server in proportion to the invoice's. */
export async function createCreditNote(v: { invoiceId: string; net: number; reason: string; gst?: number | null; issuedOn?: string }): Promise<{ id: string; number: string }> {
  const rows = unwrap(
    await requireSupabase().rpc('create_credit_note', {
      p_invoice_id: v.invoiceId,
      p_net: v.net,
      p_reason: v.reason.trim(),
      p_gst: v.gst ?? undefined,
      p_issued_on: v.issuedOn,
    }),
  )
  const r = Array.isArray(rows) ? rows[0] : rows
  return { id: r.credit_note_id, number: r.number }
}

/**
 * The GST a credit note of `net` carries: the invoice's GST in proportion (whole rupees, half away from zero), all that is left
 * when the credit completes the invoice, never more than is left. The server (create_credit_note) works it out the same way.
 */
export function creditGst(invoice: { net: number; gst: number }, credited: { net: number; gst: number }, net: number): number {
  if (!(net > 0) || !(invoice.net > 0)) return 0
  const leftGst = toPaisa(invoice.gst) - toPaisa(credited.gst)
  if (toPaisa(credited.net) + toPaisa(net) >= toPaisa(invoice.net)) return Number(paisaToFixed(leftGst > 0n ? leftGst : 0n))
  const share = divRoundHalfUp(toPaisa(invoice.gst) * toPaisa(net), toPaisa(invoice.net) * 100n) * 100n
  return Number(paisaToFixed(share < leftGst ? share : leftGst > 0n ? leftGst : 0n))
}

export const creditNoteKeys = {
  forInvoice: (invoiceId: string) => [...qk.money.invoices.detail(invoiceId), 'credit-notes'] as const,
  one: (id: string) => [...qk.money.invoices.all, 'credit-note', id] as const,
}

export function useCreditNotes(invoiceId: string | null | undefined, enabled = true) {
  return useQuery({ queryKey: creditNoteKeys.forInvoice(invoiceId ?? ''), queryFn: () => listCreditNotes(invoiceId as string), enabled: enabled && Boolean(invoiceId) })
}

/** A void or a credit note changes the same things a new invoice does: the register, receivables, aging, GST, Today, the order. */
export function useVoidInvoice() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { invoiceId: string; reason: string }) => voidInvoice(v.invoiceId, v.reason),
    onSuccess: () => invalidateAfter(client, 'invoice.create', {}),
  })
}

export function useCreateCreditNote() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: Parameters<typeof createCreditNote>[0]) => createCreditNote(v),
    onSuccess: async (_n, v) => {
      await invalidateAfter(client, 'invoice.create', {})
      await client.invalidateQueries({ queryKey: creditNoteKeys.forInvoice(v.invoiceId) })
    },
  })
}
