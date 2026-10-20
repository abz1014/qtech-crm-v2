import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import { orderRef } from '@/lib/refs'
import { paisaToFixed, toPaisa } from '@/lib/money'
import type { TableRow } from '@/features/dbTypes'
import { companyNames } from '@/features/money/expenses/api'
import { legLabelOf, lookupLabels } from '@/features/money/lookupLabels'
import { monthEnd, monthStart, type CategoryGroup } from '@/features/money/expenses/model'
import type { RawBank, RawDeposit, RawExpense, RawPayment } from '@/features/money/bank/model'

/*
 * Bank tick (M12): every database call for this area. Admin only, enforced by Row Level Security; the hooks pass
 * `enabled`, so nobody else makes these requests. Ticking writes one column (bank_month on payments and expenses,
 * tax_bank_month on invoices), which the month lock leaves editable after a close.
 */
const fixed = (n: number | string): string => paisaToFixed(toPaisa(n))

/**
 * Everything that can appear on the statement of one month ("2026-10"): bank rows ticked against it, and bank rows not
 * ticked yet and dated up to its end (older ones included). Cash rows and voided payments are never read.
 */
export async function loadBank(month: string): Promise<RawBank> {
  const db = requireSupabase()
  const start = monthStart(month)
  const end = monthEnd(month)

  const [payments, expenses, invoices] = await Promise.all([
    fetchAll<TableRow<'payments_in'>>((from, to) =>
      db
        .from('payments_in')
        .select('*')
        .eq('paid_via', 'bank')
        .is('voided_at', null) // 0073: a voided payment is history, never on a statement
        .or(`bank_month.eq.${start},and(bank_month.is.null,received_on.lte.${end})`)
        .order('received_on', { ascending: false })
        .range(from, to),
    ),
    fetchAll<TableRow<'expenses'>>((from, to) =>
      db
        .from('expenses')
        .select('*')
        .eq('paid_via', 'bank')
        .or(`bank_month.eq.${start},and(bank_month.is.null,paid_on.lte.${end})`)
        .order('paid_on', { ascending: false })
        .range(from, to),
    ),
    fetchAll<TableRow<'invoices'>>((from, to) =>
      db
        .from('invoices')
        .select('*')
        .not('tax_deposited_on', 'is', null)
        .or(`tax_bank_month.eq.${start},and(tax_bank_month.is.null,tax_deposited_on.lte.${end})`)
        .order('tax_deposited_on', { ascending: false })
        .range(from, to),
    ),
  ])

  const orderIds = [
    ...new Set(
      [...payments.map(p => p.order_id), ...expenses.map(e => e.order_id), ...invoices.map(i => i.order_id)].filter(
        (x): x is string => !!x,
      ),
    ),
  ]
  const categoryIds = [...new Set(expenses.map(e => e.category_id))]
  const [orders, categories, legs] = await Promise.all([
    ordersById(orderIds),
    categoriesById(categoryIds),
    legLabels(expenses.map(e => e.supplier_order_id).filter((x): x is string => !!x)),
  ])
  const companyIds = [
    ...new Set(
      [...expenses.map(e => e.payee_id), ...invoices.map(i => i.company_id), ...orderIds.map(id => orders[id]?.companyId)].filter(
        (x): x is string => !!x,
      ),
    ),
  ]
  const names = await companyNames(companyIds)
  const companyOfOrder = (id: string | null) => (id ? (names[orders[id]?.companyId ?? ''] ?? null) : null)

  const rawPayments: RawPayment[] = payments.map(p => ({
    id: p.id,
    receivedOn: p.received_on,
    amount: fixed(p.amount),
    reference: p.reference,
    orderRef: p.order_id ? (orders[p.order_id]?.ref ?? null) : null,
    company: companyOfOrder(p.order_id),
    bankMonth: p.bank_month,
  }))
  const rawExpenses: RawExpense[] = expenses.map(e => ({
    id: e.id,
    paidOn: e.paid_on,
    amount: fixed(e.amount_pkr),
    inputTax: fixed(e.input_tax_pkr),
    categoryName: categories[e.category_id]?.name ?? 'Expense',
    grp: categories[e.category_id]?.grp ?? 'overhead',
    note: e.description,
    payee: e.payee_id ? (names[e.payee_id] ?? null) : null,
    orderRef: e.order_id ? (orders[e.order_id]?.ref ?? null) : null,
    leg: e.supplier_order_id ? (legs[e.supplier_order_id] ?? null) : null,
    bankMonth: e.bank_month,
  }))
  const rawDeposits: RawDeposit[] = invoices.map(i => ({
    id: i.id,
    number: i.number,
    invoiceDate: i.invoice_date,
    company: (i.company_id ? names[i.company_id] : null) ?? companyOfOrder(i.order_id),
    psid: i.psid,
    depositedOn: i.tax_deposited_on as string,
    amount: fixed(i.tax_deposit_amount ?? i.gst_amount),
    bankMonth: i.tax_bank_month,
  }))
  return {
    payments: rawPayments,
    expenses: rawExpenses,
    deposits: rawDeposits,
  }
}

async function ordersById(ids: string[]): Promise<Record<string, { ref: string; companyId: string }>> {
  if (ids.length === 0) return {}
  const { orders } = await lookupLabels({ orders: ids })
  return Object.fromEntries(Object.entries(orders).map(([id, o]) => [id, { ref: orderRef(Number(o.number)), companyId: o.company_id }]))
}

async function categoriesById(ids: string[]): Promise<Record<string, { name: string; grp: CategoryGroup }>> {
  if (ids.length === 0) return {}
  const db = requireSupabase()
  const rows = unwrap(await db.from('expense_categories').select('id, name, grp').in('id', ids)) ?? []
  return Object.fromEntries(rows.map(r => [r.id, { name: r.name, grp: r.grp as CategoryGroup }]))
}

/**
 * "supplier order A", "supplier order B": the leg's place among its order's legs (by created_at, then id), as the Add expense
 * dialog names them. One lookup_labels call; it used to be two reads with `in.(...)` lists.
 */
export async function legLabels(legIds: string[]): Promise<Record<string, string>> {
  if (legIds.length === 0) return {}
  const { legs } = await lookupLabels({ legs: legIds })
  return Object.fromEntries(Object.entries(legs).map(([id, l]) => [id, legLabelOf(Number(l.position))]))
}

export type TickKind = 'payment' | 'expense' | 'fbr'

/** Tick (month "2026-10") or untick (null) one or more rows. One request, whatever the number of rows. */
export async function setBankMonth(kind: TickKind, ids: readonly string[], month: string | null): Promise<void> {
  const db = requireSupabase()
  const value = month ? monthStart(month) : null
  const ids2 = [...ids]
  const res =
    kind === 'payment'
      ? await db.from('payments_in').update({ bank_month: value }).in('id', ids2)
      : kind === 'expense'
        ? await db.from('expenses').update({ bank_month: value }).in('id', ids2)
        : await db.from('invoices').update({ tax_bank_month: value }).in('id', ids2)
  if (res.error) throw res.error
}
