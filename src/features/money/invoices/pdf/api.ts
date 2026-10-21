import { requireSupabase, unwrap } from '@/lib/supabase'
import { toBusinessDate } from '@/lib/dates'
import type { InvoicePdfSource } from '@/features/money/invoices/pdf/doc'
import type { BuyerTax } from '@/features/money/invoices/pdf/model'

/*
 * The database reads (and the one write) of the sales-tax invoice PDF. Invoices are admin and sales only (DATA_MODEL section 10);
 * the button that leads here is not drawn for an engineer, and row security refuses one anyway. The buyer's tax details are
 * company columns (migration 0072), readable and writable by every active role, like the company's name.
 */

const BUYER_COLS = 'id, name, ntn, strn, sales_tax_registered, invoice_address'

type BuyerRow = { id: string; name: string; ntn: string | null; strn: string | null; sales_tax_registered: boolean | null; invoice_address: string | null }

const toBuyer = (c: BuyerRow): BuyerTax & { id: string } => ({
  id: c.id,
  name: c.name,
  ntn: c.ntn,
  strn: c.strn,
  salesTaxRegistered: c.sales_tax_registered,
  invoiceAddress: c.invoice_address,
})

async function readBuyer(companyId: string): Promise<BuyerRow | null> {
  const { data, error } = await requireSupabase().from('companies').select(BUYER_COLS).eq('id', companyId).maybeSingle()
  if (error) throw error
  return data
}

async function readSite(siteId: string): Promise<{ name: string; address: string | null } | null> {
  const { data, error } = await requireSupabase().from('company_sites').select('name, address').eq('id', siteId).maybeSingle()
  if (error) throw error
  return data
}

/** Everything one invoice's PDF needs, or null when the invoice is not there (or not visible to this person). */
export async function loadInvoicePdfSource(invoiceId: string): Promise<InvoicePdfSource | null> {
  const db = requireSupabase()
  const { data: inv, error } = await db
    .from('invoices')
    .select('id, number, invoice_date, net_amount, gst_amount, order_id, company_id')
    .eq('id', invoiceId)
    .maybeSingle()
  if (error) throw error
  if (!inv) return null

  let order: {
    id: string
    number: number
    company_id: string
    site_id: string | null
    customer_po_number: string | null
    ordered_on: string | null
    payment_terms_days: number | null
    legacy_flags: string[]
  } | null = null
  if (inv.order_id) {
    const res = await db
      .from('orders')
      .select('id, number, company_id, site_id, customer_po_number, ordered_on, payment_terms_days, legacy_flags')
      .eq('id', inv.order_id)
      .maybeSingle()
    if (res.error) throw res.error
    order = res.data
  }

  const companyId = order?.company_id ?? inv.company_id
  const orderId = order?.id ?? null
  const [buyer, site, items, others] = await Promise.all([
    companyId ? readBuyer(companyId) : null,
    order?.site_id ? readSite(order.site_id) : null,
    orderId
      ? (async () =>
          unwrap(await db.from('order_items').select('id, description, qty, unit, unit_price_net, gst_rate').eq('order_id', orderId).order('position').order('created_at')))()
      : [],
    orderId ? (async () => unwrap(await db.from('invoices').select('id, number, net_amount, invoice_date, created_at').eq('order_id', orderId).neq('id', invoiceId).order('invoice_date')))() : [],
  ])

  return {
    invoice: { id: inv.id, number: inv.number, invoiceDate: inv.invoice_date, net: inv.net_amount, gst: inv.gst_amount, orderId: inv.order_id },
    order: order
      ? {
          id: order.id,
          number: Number(order.number),
          customerPo: order.customer_po_number,
          orderedOn: order.ordered_on,
          paymentTermsDays: order.payment_terms_days === null ? null : Number(order.payment_terms_days),
          legacyFlags: order.legacy_flags ?? [],
        }
      : null,
    buyer: buyer ? toBuyer(buyer) : null,
    site,
    lines: (items ?? []).map(l => ({
      id: l.id,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unitPriceNet: l.unit_price_net,
      gstRate: l.gst_rate,
    })),
    otherInvoices: (others ?? []).map(o => ({
      id: o.id,
      number: o.number,
      net: o.net_amount,
      // the due basis order_receivables uses (0076): the invoice date, else the order date, else the day it was imported
      dueBasis: o.invoice_date ?? order?.ordered_on ?? (o.created_at ? toBusinessDate(new Date(o.created_at)) : null),
    })),
  }
}

export interface OrderInvoice {
  id: string
  number: string | null
  invoiceDate: string | null
}

/** The order's invoices, oldest first (the order page's button picks one when there are several). */
export async function listOrderInvoices(orderId: string): Promise<OrderInvoice[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('invoices').select('id, number, invoice_date').eq('order_id', orderId).order('invoice_date').order('created_at')) ?? []
  return rows.map(r => ({ id: r.id, number: r.number, invoiceDate: r.invoice_date }))
}

// ------------------------------------------------------------------ buyer tax details (companies, 0072)

export async function getBuyerTax(companyId: string): Promise<(BuyerTax & { id: string }) | null> {
  const row = await readBuyer(companyId)
  return row ? toBuyer(row) : null
}

export interface BuyerTaxPatch {
  ntn: string | null
  strn: string | null
  sales_tax_registered: boolean | null
  invoice_address: string | null
}

export async function saveBuyerTax(companyId: string, patch: BuyerTaxPatch): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('companies').update(patch).eq('id', companyId)
  if (error) throw error
}
