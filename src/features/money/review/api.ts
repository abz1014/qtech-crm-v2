import { fetchAll, requireSupabase } from '@/lib/supabase'
import { formatAmount } from '@/lib/money'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { lookupLabels } from '@/features/money/lookupLabels'
import { fetchReceivablesList } from '@/features/money/payments/api'
import type { Confidence, Proposal, ReviewItem, ReviewState } from '@/features/money/review/model'

/*
 * Review imported: every database call (admin only; the functions refuse anyone else and the app does not ask). The review state
 * is set by set_legacy_review (0096); the proposals come from link_imported_invoices with p_dry_run = true, which changes nothing.
 */
const num = (v: number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v))
const rs = (n: number): string => `PKR ${formatAmount(n, 'never')}`

interface OrderRow {
  id: string
  number: number
  company_id: string
  ordered_on: string | null
  cancelled_on: string | null
  customer_po_number: string | null
  legacy_review: string | null
}
interface InvoiceRow {
  id: string
  number: string | null
  invoice_date: string | null
  net_amount: number
  gst_amount: number
  company_id: string | null
  order_id: string | null
  notes: string | null
  legacy_review: string | null
}

const open = ['to_review', 'live']

/** Imported orders and invoices waiting for the owner ('to_review') or kept open ('live'), with what the books say about each. */
export async function listReviewItems(): Promise<ReviewItem[]> {
  const db = requireSupabase()
  const [orders, invoices, receivables] = await Promise.all([
    fetchAll<OrderRow>(
      (from, to) =>
        db
          .from('orders')
          .select('id, number, company_id, ordered_on, cancelled_on, customer_po_number, legacy_review')
          .in('legacy_review', open)
          .order('number')
          .range(from, to) as unknown as PromiseLike<{ data: OrderRow[] | null; error: { code?: string; message: string } | null }>,
    ),
    fetchAll<InvoiceRow>(
      (from, to) =>
        db
          .from('invoices')
          .select('id, number, invoice_date, net_amount, gst_amount, company_id, order_id, notes, legacy_review')
          .in('legacy_review', open)
          .order('invoice_date')
          .range(from, to) as unknown as PromiseLike<{ data: InvoiceRow[] | null; error: { code?: string; message: string } | null }>,
    ),
    fetchReceivablesList({ p_with_value: true }),
  ])
  const byOrder = new Map(receivables.map(r => [r.order_id, r]))
  const labels = await lookupLabels({ companies: [...orders.map(o => o.company_id), ...invoices.map(i => i.company_id).filter((x): x is string => !!x)] })
  const company = (id: string | null) => (id ? (labels.companies[id] ?? 'Customer') : 'No customer on file')
  const orderItems: ReviewItem[] = orders.map(o => {
    const r = byOrder.get(o.id)
    const invoiced = (r?.invoice_numbers ?? []).length
    const gross = num(r?.gross_target)
    const settled = num(r?.settled)
    const facts = !r
      ? 'Goods may still be open'
      : invoiced === 0
        ? `Not invoiced, ${rs(gross)} from the items${settled > 0 ? `, received ${rs(settled)}` : ''}`
        : `Received ${rs(settled)} of ${rs(gross)}, invoice ${(r.invoice_numbers ?? []).join(', ')}`
    return {
      kind: 'order',
      id: o.id,
      title: orderRef(Number(o.number)),
      company: company(o.company_id),
      facts: [facts, o.customer_po_number ? `PO ${o.customer_po_number}` : null, o.cancelled_on ? 'cancelled' : null].filter(Boolean).join(' · '),
      state: o.legacy_review as ReviewState,
      amount: gross,
    }
  })
  const invoiceItems: ReviewItem[] = invoices.map(i => {
    const gross = num(i.net_amount) + num(i.gst_amount)
    return {
      kind: 'invoice',
      id: i.id,
      title: `Invoice ${i.number ?? ''}`.trim(),
      company: company(i.company_id),
      facts: [`${rs(gross)}${i.invoice_date ? `, ${formatShortDate(i.invoice_date, undefined, true)}` : ''}`, i.order_id ? 'linked to an order' : 'not linked to an order yet'].join(' · '),
      state: i.legacy_review as ReviewState,
      amount: gross,
    }
  })
  return [...orderItems, ...invoiceItems]
}

/** The owner's decision on one record. */
export async function setLegacyReview(v: { kind: 'order' | 'invoice'; id: string; state: ReviewState }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('set_legacy_review', { kind: v.kind, id: v.id, state: v.state })
  if (error) throw error
}

/** What one proposal reads like: both sides in words. */
export interface ProposalView extends Proposal {
  invoice: string
  invoiceFacts: string
  order: string
  orderFacts: string
  company: string
}

/** link_imported_invoices(p_dry_run = true): the proposals, certain and likely, with both sides named. Nothing is linked. */
export async function findMatches(): Promise<ProposalView[]> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('link_imported_invoices', { p_dry_run: true })
  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return []
  const invoiceIds = [...new Set(rows.map(r => r.invoice_id))]
  const orderIds = [...new Set(rows.map(r => r.order_id))]
  const [invoices, orders] = await Promise.all([
    db.from('invoices').select('id, number, invoice_date, net_amount, gst_amount, company_id').in('id', invoiceIds),
    db.from('orders').select('id, number, ordered_on, customer_po_number, company_id').in('id', orderIds),
  ])
  if (invoices.error) throw invoices.error
  if (orders.error) throw orders.error
  const labels = await lookupLabels({ companies: [...(invoices.data ?? []).map(i => i.company_id), ...(orders.data ?? []).map(o => o.company_id)].filter((x): x is string => !!x) })
  const inv = new Map((invoices.data ?? []).map(i => [i.id, i]))
  const ord = new Map((orders.data ?? []).map(o => [o.id, o]))
  return rows.map(r => {
    const i = inv.get(r.invoice_id)
    const o = ord.get(r.order_id)
    return {
      invoiceId: r.invoice_id,
      orderId: r.order_id,
      confidence: r.confidence as Confidence,
      reasons: r.reasons ?? [],
      invoice: `Invoice ${i?.number ?? ''}`.trim(),
      invoiceFacts: i ? `${rs(num(i.net_amount) + num(i.gst_amount))}${i.invoice_date ? `, ${formatShortDate(i.invoice_date, undefined, true)}` : ''}` : '',
      order: o ? orderRef(Number(o.number)) : 'Order',
      orderFacts: [o?.ordered_on ? `ordered ${formatShortDate(o.ordered_on, undefined, true)}` : null, o?.customer_po_number ? `PO ${o.customer_po_number}` : null].filter(Boolean).join(' · '),
      company: (i?.company_id && labels.companies[i.company_id]) || (o?.company_id && labels.companies[o.company_id]) || 'Customer',
    }
  })
}

/** One link the owner accepted (a "likely" one they checked, or any proposal). */
export async function linkOne(v: { invoiceId: string; orderId: string }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('link_imported_invoice', { p_invoice_id: v.invoiceId, p_order_id: v.orderId })
  if (error) throw error
}

/**
 * Links exactly the given proposals, one link_imported_invoice call each, and returns how many were linked. The bulk RPC
 * (link_imported_invoices with p_dry_run = false) links every certain match it finds, so it would also link the ones the owner
 * turned down with "Not this"; it takes no list. Stops at the first failure (the earlier links stay).
 */
export async function linkAllCertain(pairs: readonly { invoiceId: string; orderId: string }[]): Promise<number> {
  let n = 0
  for (const p of pairs) {
    await linkOne({ invoiceId: p.invoiceId, orderId: p.orderId })
    n++
  }
  return n
}
