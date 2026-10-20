import { karachiDay, must, rest, uniqueName } from '../../support/stack'
import { USER } from './db'

/*
 * Fixtures for the verify suites. Records a test merely STANDS ON (the customer, the suppliers, an earlier order, the rates) are made
 * here through the REST API as the admin fixture user, so the database's own defaults and triggers run as they would for a person
 * (created_by, owner, credited user, number series). What the test is ABOUT is done on screen. Every name is unique per call, so tests
 * never collide and a retry starts clean.
 */

export type Co = { id: string; name: string }

/** Lower-case letters only (no digits), so a tag never reads as a quantity or a model number to the parsers. */
export const letters = (n = 5): string =>
  Array.from({ length: n }, () => 'abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 23)]).join('')

export async function post<T = { id: string }>(table: string, body: unknown): Promise<T> {
  return (await must(rest<T[]>('admin', table, { method: 'POST', body })))[0]
}

export async function postMany<T = { id: string }>(table: string, body: unknown[]): Promise<T[]> {
  return must(rest<T[]>('admin', table, { method: 'POST', body }))
}

export async function company(prefix: string, extra: Record<string, unknown> = {}): Promise<Co> {
  return post<Co>('companies', { name: uniqueName(prefix), ...extra })
}

/** A supplier: a company with a country (the reply currency follows it: Germany EUR, China CNY, Pakistan PKR). */
export const supplier = (prefix: string, country: string, extra: Record<string, unknown> = {}) => company(prefix, { country, ...extra })

/** Today's rates (PKR per unit), entered by hand as staff do. Defaults: USD 280, EUR 300, CNY 40. */
export async function setRates(rates: Record<string, number> = { USD: 280, EUR: 300, CNY: 40 }, asOf = karachiDay(0)): Promise<void> {
  for (const [currency, rate_pkr] of Object.entries(rates)) {
    await must(
      rest('admin', 'fx_rates?on_conflict=currency,as_of,source', {
        method: 'POST',
        body: { currency, rate_pkr, as_of: asOf, source: 'manual' },
        prefer: 'resolution=merge-duplicates,return=minimal',
      }),
    )
  }
}

/** The company profile the PDFs need (legal name and address). `false` empties them, so PDFs are refused with a banner. */
export async function setProfile(complete = true): Promise<void> {
  await must(
    rest('admin', 'company_profile?id=eq.1', {
      method: 'PATCH',
      body: complete
        ? { legal_name: 'Q-Tech Solutions (Pvt) Ltd', address: 'Office 4, 2nd Floor, Gulberg III, Lahore 54660', phone: '+92 42 555 0138', ntn: '1234567-8', po_terms: '100% advance against proforma' }
        : { legal_name: null, address: null },
      prefer: 'return=minimal',
    }),
  )
}

export interface LineSpec {
  description: string
  qty: number
  /** Selling price per unit, net PKR. */
  price: number
  /** 18 (default) or 0 for exempt. */
  gst?: number
  service?: boolean
  /** Index into `suppliers` for the leg this line is on; omit for a line with no supplier yet ("to source"). */
  leg?: number
  /** Working purchase price in the leg's currency. */
  supplierPrice?: number
  unit?: string
}

export interface OrderSeed {
  order: { id: string; number: number }
  customer: Co
  legs: { id: string; supplier: Co }[]
  items: { id: string; description: string; position: number }[]
}

/**
 * An order made directly (as a WhatsApp or repeat order would be), with one leg per supplier and the lines given.
 * owner: who owns the order (default sales, so Today and "Mine" behave as for a salesperson's order).
 */
export async function order(opts: {
  customer?: Co
  suppliers?: { supplier: Co; currency?: string }[]
  lines: LineSpec[]
  owner?: keyof typeof USER
  terms?: number | null
  orderedOn?: string
  customerPo?: string
  needsCommissioning?: boolean
}): Promise<OrderSeed> {
  const customer = opts.customer ?? (await company('Verify Customer', { city: 'Lahore' }))
  const order = await post<{ id: string; number: number }>('orders', {
    company_id: customer.id,
    ordered_on: opts.orderedOn ?? karachiDay(0),
    payment_terms_days: opts.terms === undefined ? 30 : opts.terms,
    customer_po_number: opts.customerPo ?? `PO-${letters(6).toUpperCase()}`,
    needs_commissioning: opts.needsCommissioning ?? false,
  })
  if (opts.owner && opts.owner !== 'admin') await must(rest('admin', `orders?id=eq.${order.id}`, { method: 'PATCH', body: { owner_id: USER[opts.owner] }, prefer: 'return=minimal' }))
  const legs: OrderSeed['legs'] = []
  for (const s of opts.suppliers ?? []) {
    const leg = await post('supplier_orders', { order_id: order.id, supplier_id: s.supplier.id, currency: s.currency ?? 'PKR' })
    legs.push({ id: leg.id, supplier: s.supplier })
  }
  const items = await postMany<{ id: string; description: string; position: number }>(
    'order_items',
    opts.lines.map((l, i) => ({
      order_id: order.id,
      position: i,
      description: l.description,
      qty: l.qty,
      unit: l.unit ?? 'ea',
      unit_price_net: l.price,
      gst_rate: l.gst ?? 18,
      is_service: l.service ?? false,
      supplier_order_id: l.leg === undefined ? null : legs[l.leg].id,
      supplier_unit_price: l.supplierPrice ?? null,
    })),
  )
  items.sort((a, b) => a.position - b.position)
  return { order, customer, legs, items }
}

/** The next number in the invoice series, as the Create invoice dialog would pre-fill it (so fixtures never bend the series). */
export async function nextInvoiceNumber(): Promise<string> {
  const rows = await must(rest<{ next_number: string }[]>('admin', 'rpc/next_invoice_number', { method: 'POST', body: {} }))
  return rows[0].next_number
}

/** An invoice on an order, numbered from the series. */
export async function invoice(orderId: string, net: number, gst: number, date = karachiDay(0)): Promise<{ id: string; number: string }> {
  const o = (await must(rest<{ company_id: string }[]>('admin', `orders?id=eq.${orderId}&select=company_id`)))[0]
  return post<{ id: string; number: string }>('invoices', { order_id: orderId, company_id: o.company_id, number: await nextInvoiceNumber(), invoice_date: date, net_amount: net, gst_amount: gst })
}

/** A payment received on an order (gross, GST included). */
export async function payment(orderId: string, amount: number, date = karachiDay(0), paidVia: 'bank' | 'cash' = 'bank'): Promise<{ id: string }> {
  return post('payments_in', { order_id: orderId, amount, received_on: date, paid_via: paidVia })
}

/** An RFQ with items, as the admin; owner defaults to the salesperson. */
export async function rfq(opts: { customer?: Co; items: { description: string; qty: number; unit?: string; gst?: number }[]; owner?: keyof typeof USER; extra?: Record<string, unknown> }) {
  const customer = opts.customer ?? (await company('Verify Customer', { city: 'Karachi' }))
  const r = await post<{ id: string; number: number }>('rfqs', { company_id: customer.id, owner_id: USER[opts.owner ?? 'sales'], ...(opts.extra ?? {}) })
  const items = await postMany<{ id: string; position: number; description: string }>(
    'rfq_items',
    opts.items.map((it, i) => ({ rfq_id: r.id, position: i, description: it.description, qty: it.qty, unit: it.unit ?? 'nos', gst_rate: it.gst ?? 18 })),
  )
  items.sort((a, b) => a.position - b.position)
  return { rfq: r, customer, items }
}

/** A supplier asked on an RFQ (sent `daysAgo` days back) and, optionally, its prices per item (in `currency`). */
export async function quote(rfqId: string, sup: Co, prices: { itemId: string; price: number }[], currency = 'PKR', daysAgo = 3) {
  const inq = await post('supplier_inquiries', { rfq_id: rfqId, supplier_id: sup.id, sent_on: karachiDay(-daysAgo) })
  if (prices.length) await postMany('supplier_quote_lines', prices.map(p => ({ inquiry_id: inq.id, rfq_item_id: p.itemId, unit_price: p.price, currency, lead_time: '3 weeks' })))
  return inq
}

/** Calendar helpers in the business time zone (Asia/Karachi). */
export function monthOf(iso: string) {
  const key = iso.slice(0, 7)
  const d = new Date(`${key}-01T00:00:00Z`)
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'long' }).format(d)
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  return { key, start: `${key}-01`, end: `${key}-${String(last).padStart(2, '0')}`, name, label: `${name} ${d.getUTCFullYear()}`, day: (n: number) => `${key}-${String(n).padStart(2, '0')}` }
}

/** The month `back` months before the month of `iso`. */
export function monthBefore(iso: string, back: number) {
  const [y, m] = iso.split('-').map(Number)
  return monthOf(new Date(Date.UTC(y, m - 1 - back, 1)).toISOString().slice(0, 10))
}

export const ref = {
  rfq: (n: number) => `RFQ-${String(n).padStart(4, '0')}`,
  order: (n: number) => `ORD-${String(n).padStart(4, '0')}`,
  quotation: (n: number, issuedOn: string) => `QT-${issuedOn.slice(2, 4)}-${String(n).padStart(4, '0')}`,
  po: (n: number, issuedOn: string) => `PO-${issuedOn.slice(2, 4)}-${String(n).padStart(4, '0')}`,
}

export { karachiDay, uniqueName }
