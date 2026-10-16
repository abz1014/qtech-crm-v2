import { fetchAll, requireSupabase } from '@/lib/supabase'
import type { RcExpense, RcInvoice, RcLeg, RcMoney, RcOrder, RcPayment, RcPo, ReconciliationInput } from '@/lib/reconciliation'

/*
 * The rows the reconciliation checks read (M07). ADMIN ONLY: the money views return nothing to anyone else and payments, expenses
 * and costs are admin-only tables, so for any other role every list here would be empty. The hook never asks for them unless
 * the caller is an admin. The checks themselves are pure (src/lib/reconciliation.ts).
 */
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v))

export async function getReconciliationInput(): Promise<ReconciliationInput> {
  const db = requireSupabase()
  const [orders, basis, money, invoices, payments, expenses, legs, pos] = await Promise.all([
    fetchAll((from, to) => db.from('orders').select('id, number, ordered_on, cancelled_on, legacy_flags').range(from, to)),
    fetchAll((from, to) => db.from('v_order_basis').select('order_id, invoice_count, invoice_gross, items_net, items_gross').range(from, to)),
    fetchAll((from, to) => db.from('v_order_money').select('order_id, gross_target, settled, expected_cost, actual_cost, costs_state').range(from, to)),
    fetchAll((from, to) =>
      db
        .from('invoices')
        .select('id, number, order_id, invoice_date, net_amount, gst_amount, copy_received_on, tcs_sent_on, client_received_on, tax_deposited_on, legacy_flags')
        .range(from, to),
    ),
    fetchAll((from, to) => db.from('payments_in').select('id, order_id, amount, received_on').range(from, to)),
    fetchAll((from, to) => db.from('expenses').select('id, order_id, supplier_order_id, amount_pkr, input_tax_pkr, paid_on').range(from, to)),
    fetchAll((from, to) => db.from('supplier_orders').select('id, order_id, placed_on, expected_on, received_on, delivered_on, currency, created_at').order('created_at').range(from, to)),
    fetchAll((from, to) => db.from('purchase_orders').select('supplier_order_id, revision, total, currency').order('revision', { ascending: false }).range(from, to)),
  ])

  const rcOrders: RcOrder[] = orders.map(o => ({
    id: o.id,
    number: Number(o.number),
    orderedOn: o.ordered_on,
    cancelled: o.cancelled_on !== null,
    basisUnknown: (o.legacy_flags ?? []).includes('value_basis_unknown'),
  }))
  const basisBy = new Map(basis.map(b => [b.order_id as string, b]))
  const rcMoney: RcMoney[] = money
    .filter(m => m.order_id)
    .map(m => {
      const b = basisBy.get(m.order_id as string)
      return {
        orderId: m.order_id as string,
        grossTarget: n(m.gross_target),
        settled: n(m.settled),
        itemsNet: n(b?.items_net),
        itemsGross: n(b?.items_gross),
        invoiceCount: n(b?.invoice_count),
        invoiceGross: n(b?.invoice_gross),
        expectedCost: m.expected_cost == null ? null : Number(m.expected_cost),
        actualCost: n(m.actual_cost),
        costsComplete: m.costs_state === 'complete',
      }
    })
  const rcInvoices: RcInvoice[] = invoices.map(i => ({
    id: i.id,
    number: i.number,
    orderId: i.order_id,
    invoiceDate: i.invoice_date,
    net: n(i.net_amount),
    gst: n(i.gst_amount),
    copyReceivedOn: i.copy_received_on,
    tcsSentOn: i.tcs_sent_on,
    clientReceivedOn: i.client_received_on,
    taxDepositedOn: i.tax_deposited_on,
    legacy: (i.legacy_flags ?? []).length > 0,
  }))
  const rcPayments: RcPayment[] = payments.map(p => ({ id: p.id, orderId: p.order_id, amount: n(p.amount), receivedOn: p.received_on }))
  const rcExpenses: RcExpense[] = expenses.map(e => ({ id: e.id, orderId: e.order_id, legId: e.supplier_order_id, cost: n(e.amount_pkr) - n(e.input_tax_pkr), paidOn: e.paid_on }))
  const perOrder = new Map<string, number>()
  const rcLegs: RcLeg[] = legs.map(l => {
    const i = perOrder.get(l.order_id) ?? 0
    perOrder.set(l.order_id, i + 1)
    return {
      id: l.id,
      orderId: l.order_id,
      label: `leg ${String.fromCharCode(65 + i)}`,
      placedOn: l.placed_on,
      expectedOn: l.expected_on,
      receivedOn: l.received_on,
      deliveredOn: l.delivered_on,
      currency: l.currency?.trim() ?? null,
    }
  })
  const seen = new Set<string>()
  const rcPos: RcPo[] = []
  for (const p of pos) {
    if (seen.has(p.supplier_order_id)) continue
    seen.add(p.supplier_order_id)
    rcPos.push({ legId: p.supplier_order_id, total: n(p.total), currency: p.currency.trim() })
  }
  return { orders: rcOrders, money: rcMoney, payments: rcPayments, expenses: rcExpenses, invoices: rcInvoices, legs: rcLegs, pos: rcPos }
}
