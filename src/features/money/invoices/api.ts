import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import { orderRef } from '@/lib/refs'
import type { TableRow, ViewRow } from '@/features/dbTypes'
import type { GstRow, OrderAmounts } from '@/features/money/invoices/model'

/*
 * Invoices and the GST register (M01): every database call for this area. Admin and sales may read and write invoices
 * (DATA_MODEL section 10); Row Level Security is the gate, the app only mirrors it. The stamp functions (migration 0020) are
 * SECURITY INVOKER and take a set of invoice ids, so one tap stamps a whole ticked month.
 */
export const RECEIPT_BUCKET = 'gst-receipts'

const num = (v: number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v))

const toRow = (r: ViewRow<'v_gst_register'>): GstRow => ({
  invoiceId: r.invoice_id as string,
  number: r.number,
  invoiceDate: r.invoice_date,
  orderId: r.order_id,
  orderNumber: r.order_number === null ? null : Number(r.order_number),
  companyId: r.company_id,
  companyName: r.company_name,
  net: num(r.net_amount),
  gst: num(r.gst_amount),
  gross: num(r.gross_amount),
  courierState: r.courier_state ?? 'not_started',
  fbrState: r.fbr_state ?? 'pending',
  fbrException: !!r.fbr_exception,
  needsAttention: !!r.needs_fbr_attention,
  psid: r.psid,
  taxDepositedOn: r.tax_deposited_on,
})

/** Every invoice, newest first. The register is small (a few hundred a year), so it is read whole and grouped by month on screen. */
export async function listGstRegister(): Promise<GstRow[]> {
  const db = requireSupabase()
  const rows = await fetchAll<ViewRow<'v_gst_register'>>((from, to) =>
    db.from('v_gst_register').select('*').order('invoice_date', { ascending: false, nullsFirst: false }).order('number', { ascending: false }).range(from, to),
  )
  return rows.map(toRow)
}

// ------------------------------------------------------------------ one invoice

export type InvoiceRow = TableRow<'invoices'>

export async function getInvoice(id: string): Promise<InvoiceRow | null> {
  const db = requireSupabase()
  const { data, error } = await db.from('invoices').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

export interface InvoicePatch {
  copy_received_on: string | null
  tcs_sent_on: string | null
  tcs_number: string | null
  client_received_on: string | null
  psid: string | null
  wasif_receipt_on: string | null
  tax_deposited_on: string | null
  tax_deposit_amount: number | null
  notes: string | null
}

export async function updateInvoice(id: string, patch: Partial<InvoicePatch>): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('invoices').update(patch).eq('id', id)
  if (error) throw error
}

// ------------------------------------------------------------------ create

export interface NextNumber {
  nextNumber: string
  lastNumber: string | null
  lastDate: string | null
}

export async function nextInvoiceNumber(): Promise<NextNumber> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('next_invoice_number')
  if (error) throw error
  const r = Array.isArray(data) ? data[0] : data
  return { nextNumber: r?.next_number ?? 'INV-0001', lastNumber: r?.last_number ?? null, lastDate: r?.last_date ?? null }
}

export interface OrderForInvoice {
  id: string
  number: number
  companyId: string
  companyName: string
  cancelled: boolean
  amounts: OrderAmounts
}

/** What a new invoice on this order starts from: the order's lines, what earlier invoices carry, and the payment terms. */
export async function orderForInvoice(orderId: string): Promise<OrderForInvoice | null> {
  const db = requireSupabase()
  const { data: order, error } = await db.from('orders').select('id, number, company_id, payment_terms_days, cancelled_on').eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!order) return null
  const [company, totals, items, invoices] = await Promise.all([
    db.from('companies').select('name').eq('id', order.company_id).maybeSingle(),
    db.from('v_order_items_total').select('net, gst').eq('order_id', orderId).maybeSingle(),
    db.from('order_items').select('gst_rate').eq('order_id', orderId),
    db.from('invoices').select('net_amount, gst_amount').eq('order_id', orderId),
  ])
  const lines = unwrap(items) ?? []
  const inv = unwrap(invoices) ?? []
  return {
    id: order.id,
    number: Number(order.number),
    companyId: order.company_id,
    companyName: unwrap(company)?.name ?? '',
    cancelled: order.cancelled_on !== null,
    amounts: {
      itemsNet: num(unwrap(totals)?.net),
      itemsGst: num(unwrap(totals)?.gst),
      lineCount: lines.length,
      exemptLineCount: lines.filter(l => Number(l.gst_rate) === 0).length,
      invoicedNet: inv.reduce((s, i) => s + num(i.net_amount), 0),
      invoicedGst: inv.reduce((s, i) => s + num(i.gst_amount), 0),
      paymentTermsDays: order.payment_terms_days === null ? null : Number(order.payment_terms_days),
    },
  }
}

export interface InvoiceInsert {
  id: string
  orderId: string
  number: string
  invoiceDate: string
  net: number
  gst: number
}

/** The id comes from the form (a retry cannot add a second invoice); the number is Q-Tech's own series and is unique. */
export async function createInvoice(v: InvoiceInsert): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('invoices')
    .insert({ id: v.id, order_id: v.orderId, number: v.number.trim(), invoice_date: v.invoiceDate, net_amount: v.net, gst_amount: v.gst })
  if (error) throw error
}

export interface InvoiceableOrder {
  id: string
  ref: string
  company: string
}

/** Orders a new invoice can go on: not cancelled and not fully invoiced yet (v_order_state, so an engineer-proof derived value). */
export async function listInvoiceableOrders(): Promise<InvoiceableOrder[]> {
  const db = requireSupabase()
  const orders = unwrap(
    await db.from('orders').select('id, number, company_id').is('cancelled_on', null).order('number', { ascending: false }).limit(300),
  ) ?? []
  if (orders.length === 0) return []
  const ids = orders.map(o => o.id)
  const [states, companies] = await Promise.all([
    db.from('v_order_state').select('order_id, invoicing_state').in('order_id', ids),
    db.from('companies').select('id, name').in('id', [...new Set(orders.map(o => o.company_id))]),
  ])
  const full = new Set((unwrap(states) ?? []).filter(s => s.invoicing_state === 'fully_invoiced').map(s => s.order_id))
  const names = new Map((unwrap(companies) ?? []).map(c => [c.id, c.name]))
  return orders.filter(o => !full.has(o.id)).map(o => ({ id: o.id, ref: orderRef(Number(o.number)), company: names.get(o.company_id) ?? '' }))
}

// ------------------------------------------------------------------ stamps (a month at a time)

export interface StampSnapshot {
  id: string
  tcs_sent_on: string | null
  tcs_number: string | null
  psid: string | null
  tax_deposited_on: string | null
  tax_deposit_amount: number | null
}

/** The stamped fields as they are now, kept so Undo can put them back. */
export async function snapshotForStamp(ids: readonly string[]): Promise<StampSnapshot[]> {
  const db = requireSupabase()
  if (ids.length === 0) return []
  const rows = unwrap(await db.from('invoices').select('id, tcs_sent_on, tcs_number, psid, tax_deposited_on, tax_deposit_amount').in('id', [...ids])) ?? []
  return rows.map(r => ({ ...r, tax_deposit_amount: r.tax_deposit_amount === null ? null : Number(r.tax_deposit_amount) }))
}

export async function stampTcsSent(ids: readonly string[]): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_tcs_sent', { p_invoice_ids: [...ids] })
  if (error) throw error
  return Number(data ?? 0)
}

export async function stampPsid(ids: readonly string[], psid: string): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_fbr_psid', { p_invoice_ids: [...ids], p_psid: psid })
  if (error) throw error
  return Number(data ?? 0)
}

export async function stampDeposited(ids: readonly string[]): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_tax_deposited', { p_invoice_ids: [...ids] })
  if (error) throw error
  return Number(data ?? 0)
}

/** Undo of a stamp: every invoice that was changed goes back to the values it had before. */
export async function restoreStamp(before: readonly StampSnapshot[], fields: ReadonlyArray<keyof Omit<StampSnapshot, 'id'>>): Promise<void> {
  const db = requireSupabase()
  for (const b of before) {
    const patch: Record<string, string | number | null> = {}
    // the fields come from the stamped set, all columns of InvoicePatch
    for (const f of fields) patch[f] = b[f]
    const { error } = await db.from("invoices").update(patch as Partial<InvoicePatch>).eq("id", b.id)
    if (error) throw error
  }
}

// ------------------------------------------------------------------ receipts (gst-receipts)

export interface InvoiceReceipt {
  id: string
  /** The invoice the file is attached to. Not the one being viewed when the receipt covers a PSID group. */
  invoiceId: string
  path: string
  fileName: string
  sizeBytes: number | null
}

/** The PSID as a group key: trimmed, and null when empty (an invoice with no PSID is a group of one). */
export const psidKey = (psid: string | null | undefined): string | null => {
  const t = psid?.trim()
  return t ? t : null
}

/**
 * Receipts for an invoice. One FBR deposit (one PSID) covers every invoice of that PSID, so the receipt uploaded on any of them is
 * listed on all of them (audit T1). Without a PSID it is this invoice's own files only.
 */
export async function listReceipts(invoiceId: string, psid?: string | null): Promise<InvoiceReceipt[]> {
  const db = requireSupabase()
  const key = psidKey(psid)
  let ids = [invoiceId]
  if (key) {
    const group = unwrap(await db.from('invoices').select('id').eq('psid', key)) ?? []
    ids = Array.from(new Set([invoiceId, ...group.map(g => g.id)]))
  }
  const rows = unwrap(await db.from('attachments').select('id, invoice_id, path, file_name, size_bytes').in('invoice_id', ids).order('created_at')) ?? []
  return rows.map(r => ({ id: r.id, invoiceId: r.invoice_id as string, path: r.path, fileName: r.file_name, sizeBytes: r.size_bytes }))
}

/**
 * Object first, then its row; a row that cannot be written takes the object back out. The receipt date is stamped when it was empty,
 * on this invoice and on every other invoice with the same PSID (one receipt per PSID group, audit T1), so the FBR-attention item
 * clears for the whole deposit with one upload.
 */
export async function uploadReceipt(invoiceId: string, file: File, today: string, psid?: string | null): Promise<void> {
  const db = requireSupabase()
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1] ?? (file.type === 'application/pdf' ? 'pdf' : 'jpg')).toLowerCase()
  const path = `${invoiceId}/${crypto.randomUUID()}.${ext}`
  const up = await db.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw up.error
  const res = await db.from('attachments').insert({
    bucket: RECEIPT_BUCKET,
    path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    invoice_id: invoiceId,
  })
  if (res.error) {
    await db.storage.from(RECEIPT_BUCKET).remove([path])
    throw res.error
  }
  const key = psidKey(psid)
  const stamp = db.from('invoices').update({ wasif_receipt_on: today }).is('wasif_receipt_on', null)
  const { error } = await (key ? stamp.eq('psid', key) : stamp.eq('id', invoiceId))
  if (error) throw error
  if (key) {
    // The invoice the file hangs on is stamped even if its saved PSID is not the one typed in the open form.
    const own = await db.from('invoices').update({ wasif_receipt_on: today }).eq('id', invoiceId).is('wasif_receipt_on', null)
    if (own.error) throw own.error
  }
}

export async function deleteReceipt(r: Pick<InvoiceReceipt, 'id' | 'path'>): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('attachments').delete().eq('id', r.id)
  if (error) throw error
  await db.storage.from(RECEIPT_BUCKET).remove([r.path])
}

export async function signReceipt(path: string, seconds = 600): Promise<string> {
  const db = requireSupabase()
  const { data, error } = await db.storage.from(RECEIPT_BUCKET).createSignedUrl(path, seconds)
  if (error) throw error
  return data.signedUrl
}
