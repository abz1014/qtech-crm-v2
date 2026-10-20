import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { EstItem, EstLeg, EstPo } from '@/features/money/lib/costEstimate'

/*
 * Order costs (M04): everything the Margin panel on the order page reads and writes. ADMIN ONLY. order_costs and expenses are
 * admin-only by Row Level Security, v_order_money by an explicit role check, so nobody else gets a row; the hooks also never ask
 * for them unless the caller is an admin. This is the only file that names these tables for the panel.
 */

export interface OrderExpenseRow {
  id: string
  paidOn: string
  /** What was paid out (the bank debit). */
  amount: number
  /** Recoverable input tax, left out of the cost the margin uses. */
  inputTax: number
  categoryId: string
  note: string | null
  payeeName: string | null
  legLabel: string | null
  /** The supplier order it is tagged to (for "still owed" on Pay supplier). */
  legId: string | null
}

export interface OrderCostsData {
  /** order_costs.expected_cost_pkr; null when none was entered. */
  expected: number | null
  /** order_costs.costs_complete_at. */
  completeAt: string | null
  expenses: OrderExpenseRow[]
  /** For the supplier-price suggestion. */
  items: EstItem[]
  legs: EstLeg[]
  pos: EstPo[]
}

export async function getOrderCosts(orderId: string): Promise<OrderCostsData> {
  const db = requireSupabase()
  const [cost, expenses, items, legs] = await Promise.all([
    db.from('order_costs').select('expected_cost_pkr, costs_complete_at').eq('order_id', orderId).maybeSingle(),
    fetchAll((from, to) =>
      db
        .from('expenses')
        .select('id, paid_on, amount_pkr, input_tax_pkr, category_id, description, payee_id, supplier_order_id, created_at')
        .eq('order_id', orderId)
        .order('paid_on', { ascending: true })
        .order('created_at', { ascending: true })
        .range(from, to),
    ),
    db.from('order_items').select('id, qty, supplier_unit_price, supplier_order_id, is_service').eq('order_id', orderId),
    db.from('supplier_orders').select('id, currency, created_at').eq('order_id', orderId).order('created_at'),
  ])
  const c = unwrap(cost)
  const legRows = unwrap(legs)
  const legIds = legRows.map(l => l.id)
  const payeeIds = [...new Set(expenses.map(e => e.payee_id).filter((x): x is string => !!x))]
  const [pos, payees] = await Promise.all([
    legIds.length ? db.from('purchase_orders').select('supplier_order_id, revision, currency, lines').in('supplier_order_id', legIds).order('revision', { ascending: false }) : Promise.resolve({ data: [], error: null }),
    payeeIds.length ? db.from('companies').select('id, name').in('id', payeeIds) : Promise.resolve({ data: [], error: null }),
  ])
  const payeeName = new Map(unwrap(payees).map(p => [p.id, p.name]))
  const letter = new Map(legRows.map((l, i) => [l.id, `supplier order ${String.fromCharCode(65 + i)}`]))

  // The latest revision of each leg's PO, as (order item, qty, unit price) lines.
  const latest = new Map<string, EstPo>()
  for (const p of unwrap(pos) as { supplier_order_id: string; revision: number; currency: string; lines: unknown }[]) {
    if (latest.has(p.supplier_order_id)) continue
    const lines = (Array.isArray(p.lines) ? p.lines : []) as { order_item_id?: string; qty?: number | string; unit_price?: number | string }[]
    latest.set(p.supplier_order_id, {
      legId: p.supplier_order_id,
      currency: p.currency.trim(),
      lines: lines
        .filter(l => l.order_item_id && l.unit_price !== undefined && l.unit_price !== null && l.unit_price !== '')
        .map(l => ({ orderItemId: l.order_item_id as string, qty: Number(l.qty ?? 0), unitPrice: Number(l.unit_price) })),
    })
  }

  return {
    expected: c?.expected_cost_pkr == null ? null : Number(c.expected_cost_pkr),
    completeAt: c?.costs_complete_at ?? null,
    expenses: expenses.map(e => ({
      id: e.id,
      paidOn: e.paid_on,
      amount: Number(e.amount_pkr),
      inputTax: Number(e.input_tax_pkr),
      categoryId: e.category_id,
      note: e.description,
      payeeName: e.payee_id ? (payeeName.get(e.payee_id) ?? null) : null,
      legLabel: e.supplier_order_id ? (letter.get(e.supplier_order_id) ?? null) : null,
      legId: e.supplier_order_id ?? null,
    })),
    items: unwrap(items).map(i => ({ id: i.id, qty: Number(i.qty), supplierUnitPrice: i.supplier_unit_price == null ? null : Number(i.supplier_unit_price), legId: i.supplier_order_id, isService: i.is_service })),
    legs: legRows.map(l => ({ id: l.id, currency: l.currency?.trim() ?? null })),
    pos: [...latest.values()],
  }
}

/** Admin. Set (or clear, with null) the expected cost. An explicit edit overwrites: this is the person typing. */
export async function setExpectedCost(orderId: string, value: number | null): Promise<void> {
  const { error } = await requireSupabase().from('order_costs').upsert({ order_id: orderId, expected_cost_pkr: value }, { onConflict: 'order_id' })
  if (error) throw error
}

/**
 * Admin. Fill the expected cost from the supplier-price estimate, only where none was entered: the row is created when missing and
 * a value already there is never touched (the update is conditional, so a second tab or a double tap cannot overwrite it either).
 * Returns whether it wrote anything.
 */
export async function fillExpectedCostIfEmpty(orderId: string, value: number): Promise<boolean> {
  const db = requireSupabase()
  const inserted = await db.from('order_costs').upsert({ order_id: orderId, expected_cost_pkr: value }, { onConflict: 'order_id', ignoreDuplicates: true }).select('order_id')
  if (inserted.error) throw inserted.error
  if ((inserted.data ?? []).length > 0) return true
  const updated = await db.from('order_costs').update({ expected_cost_pkr: value }).eq('order_id', orderId).is('expected_cost_pkr', null).select('order_id')
  if (updated.error) throw updated.error
  return (updated.data ?? []).length > 0
}

/** Admin. Mark costs complete (the margin turns final) or reopen them. The mark records who set it. */
export async function setCostsComplete(orderId: string, complete: boolean, userId: string): Promise<void> {
  const { error } = await requireSupabase()
    .from('order_costs')
    .upsert({ order_id: orderId, costs_complete_at: complete ? new Date().toISOString() : null, costs_complete_by: complete ? userId : null }, { onConflict: 'order_id' })
  if (error) throw error
}
