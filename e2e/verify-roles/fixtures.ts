import { api, adminPost, karachiToday, servicePost } from './lib'

/*
 * One small "world" for the verify-roles suite, made through the REST API as the admin (and, for the imported order, as the
 * service role, which is the legacy import's path). Every record carries a unique tag so specs and reruns never collide.
 * It holds money everywhere an engineer must not see it: selling and supplier prices, an invoice, a payment, an expense and
 * an expected cost on one order, plus an imported order whose legacy_source carries the old order value and cost.
 */
export const IDS = {
  admin: 'a0000000-0000-4000-8000-000000000001',
  sales: 'a0000000-0000-4000-8000-000000000002',
  engineer: 'a0000000-0000-4000-8000-000000000003',
} as const
export const SUPPLIER_PAYMENT = 'ca7e0000-0000-4000-8000-000000000011'

export interface World {
  tag: string
  company: { id: string; name: string }
  supplier: { id: string; name: string }
  rfq: { id: string; number: number }
  rfqItem: string
  order: { id: string; number: number }
  leg: string
  invoice: { id: string; number: string }
  legacyOrder: { id: string; number: number }
  month: string
  /** Distinctive amounts, so a leak is recognisable in text: none of these may reach an engineer outside the allowances. */
  amounts: { sell: number; supplier: number; invoiceNet: number; invoiceGst: number; payment: number; expense: number; cost: number; legacyValue: number; legacyCost: number }
}

function lastMonthKey(): string {
  const [y, m] = karachiToday().split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function seedWorld(label = 'VR'): Promise<World> {
  const tag = `${label}${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`
  const amounts = { sell: 187431, supplier: 98123, invoiceNet: 374862, invoiceGst: 67475, payment: 100009, expense: 196246, cost: 196511, legacyValue: 250777, legacyCost: 180333 }
  const today = karachiToday()

  const company = await adminPost<{ id: string; name: string }>('companies', { name: `${tag} Customer Mills` })
  const supplier = await adminPost<{ id: string; name: string }>('companies', { name: `${tag} Supplier Instruments`, country: 'United Arab Emirates' })

  const rfq = await adminPost<{ id: string; number: number }>('rfqs', { company_id: company.id, owner_id: IDS.sales, customer_ref: `${tag}-REF` })
  const item = await adminPost('rfq_items', {
    rfq_id: rfq.id, position: 0, description: `${tag} Cerabar PMC51 pressure transmitter`, qty: 2, quoted_unit_price_net: amounts.sell,
  })
  const inquiry = await adminPost('supplier_inquiries', { rfq_id: rfq.id, supplier_id: supplier.id, sent_on: today })
  await adminPost('supplier_quote_lines', { inquiry_id: inquiry.id, rfq_item_id: item.id, unit_price: amounts.supplier, currency: 'PKR', lead_time: '2 weeks' })
  const q = await api('admin', '/rest/v1/rpc/issue_quotation', { method: 'POST', body: { p_quotation_id: crypto.randomUUID(), p_rfq_id: rfq.id } })
  if (q.status >= 300) throw new Error(`issue_quotation: ${q.status} ${q.text}`)

  const order = await adminPost<{ id: string; number: number }>('orders', { company_id: company.id, owner_id: IDS.sales, customer_po_number: `${tag}-PO` })
  const leg = await adminPost('supplier_orders', { order_id: order.id, supplier_id: supplier.id, currency: 'PKR' })
  await adminPost('order_items', {
    order_id: order.id, position: 0, description: `${tag} Cerabar PMC51 pressure transmitter`, qty: 2, unit_price_net: amounts.sell, gst_rate: 18,
    supplier_order_id: leg.id, supplier_unit_price: amounts.supplier,
  })
  await adminPost('order_engineers', { order_id: order.id, user_id: IDS.engineer })
  const invoice = await adminPost<{ id: string; number: string }>('invoices', {
    order_id: order.id, number: `INV-${tag}`, invoice_date: today, net_amount: amounts.invoiceNet, gst_amount: amounts.invoiceGst,
  })
  await adminPost('payments_in', { order_id: order.id, amount: amounts.payment, reference: `${tag} IBFT` })
  await adminPost('expenses', { order_id: order.id, supplier_order_id: leg.id, amount_pkr: amounts.expense, category_id: SUPPLIER_PAYMENT, description: `${tag} supplier paid` })
  await adminPost('order_costs', { order_id: order.id, expected_cost_pkr: amounts.cost })

  // An order as the legacy import writes it: the old row in legacy_source, on the order, its line and its supplier leg.
  const legacyRow = { id: `${tag}-old`, order_value: amounts.legacyValue, cost_value: amounts.legacyCost, order_gst_amount: 45140, invoice_number: `OLD-${tag}` }
  const legacyOrder = await servicePost<{ id: string; number: number }>('orders', {
    company_id: company.id, owner_id: IDS.sales, legacy_source: { table: 'orders', row: legacyRow },
  })
  const legacyLeg = await servicePost('supplier_orders', {
    order_id: legacyOrder.id, supplier_id: supplier.id, currency: 'PKR', legacy_source: { table: 'orders', rows: [legacyRow] },
  })
  await servicePost('order_items', {
    order_id: legacyOrder.id, position: 0, description: `${tag} imported flow meter`, qty: 1, unit_price_net: amounts.legacyValue, gst_rate: 18,
    supplier_order_id: legacyLeg.id, legacy_source: { table: 'orders', row: legacyRow },
  })

  return {
    tag, company, supplier, rfq, rfqItem: item.id, order, leg: leg.id, invoice, legacyOrder, month: lastMonthKey(), amounts,
  }
}

export function fill(path: string, w: World): string {
  return path
    .replaceAll('{rfq}', w.rfq.id)
    .replaceAll('{order}', w.order.id)
    .replaceAll('{legacyOrder}', w.legacyOrder.id)
    .replaceAll('{company}', w.company.id)
    .replaceAll('{supplier}', w.supplier.id)
    .replaceAll('{invoice}', w.invoice.id)
    .replaceAll('{month}', w.month)
}
