/*
 * The Companies list's RFQs, Orders and Last activity columns, from both sides of the business (round 3, grade C).
 * A customer's RFQs are the ones it sent us and its orders the ones it placed; a supplier's RFQs are the ones we asked it
 * about (a sent enquiry) and its orders the ones with a supplier order from it. A company that is both counts each RFQ and
 * each order once. Last activity is the latest of those dates. Pure, so the rule is tested without a database.
 */
export interface CustomerRfq {
  id: string
  company_id: string
  received_on: string | null
}
export interface CustomerOrder {
  id: string
  company_id: string
  ordered_on: string | null
}
/** A sent enquiry to a supplier (supplier_inquiries with sent_on). */
export interface SupplierAsk {
  supplier_id: string
  rfq_id: string
  sent_on: string | null
}
/** A supplier order (one supplier's part of an order). `on` is the day it was placed, else the day it was added. */
export interface SupplierLeg {
  supplier_id: string
  order_id: string
  on: string | null
}

export interface CompanyActivity {
  rfqs: number
  orders: number
  last: string | null
}

export function companyActivity(input: {
  rfqs: readonly CustomerRfq[]
  orders: readonly CustomerOrder[]
  asks: readonly SupplierAsk[]
  legs: readonly SupplierLeg[]
}): Map<string, CompanyActivity> {
  const rfqIds = new Map<string, Set<string>>()
  const orderIds = new Map<string, Set<string>>()
  const last = new Map<string, string>()
  const add = (m: Map<string, Set<string>>, company: string, id: string) => {
    const s = m.get(company) ?? new Set<string>()
    s.add(id)
    m.set(company, s)
  }
  // ISO dates compare as text; a timestamp is cut to its day.
  const later = (company: string, day: string | null) => {
    const d = day?.slice(0, 10)
    if (d && d > (last.get(company) ?? '')) last.set(company, d)
  }
  for (const r of input.rfqs) {
    add(rfqIds, r.company_id, r.id)
    later(r.company_id, r.received_on)
  }
  for (const o of input.orders) {
    add(orderIds, o.company_id, o.id)
    later(o.company_id, o.ordered_on)
  }
  for (const a of input.asks) {
    if (!a.sent_on) continue
    add(rfqIds, a.supplier_id, a.rfq_id)
    later(a.supplier_id, a.sent_on)
  }
  for (const l of input.legs) {
    add(orderIds, l.supplier_id, l.order_id)
    later(l.supplier_id, l.on)
  }
  const out = new Map<string, CompanyActivity>()
  for (const id of new Set([...rfqIds.keys(), ...orderIds.keys(), ...last.keys()])) {
    out.set(id, { rfqs: rfqIds.get(id)?.size ?? 0, orders: orderIds.get(id)?.size ?? 0, last: last.get(id) ?? null })
  }
  return out
}
