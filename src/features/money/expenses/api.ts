import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import { businessDaysFromNow } from '@/lib/dates'
import { orderRef } from '@/lib/refs'
import type { TableRow } from '@/features/dbTypes'
import { lookupLabels, type Labels } from '@/features/money/lookupLabels'
import {
  monthEnd,
  monthStart,
  type Category,
  type DetailUse,
  type ExpenseGroup,
  type ExpenseInsert,
  type ListedExpense,
  type PaidVia,
  type RecurringTemplate,
} from '@/features/money/expenses/model'

/** The details typed since a month's first day ("2025-11-01"), per month and category (v_month_cash_out_detail, 0079). */
export async function listRecentDetails(since: string): Promise<DetailUse[]> {
  const db = requireSupabase()
  const rows = await fetchAll<{ category_id: string | null; detail: string | null; expense_count: number | null; last_paid_on: string | null }>((from, to) =>
    db
      .from('v_month_cash_out_detail')
      .select('category_id, detail, expense_count, last_paid_on')
      .gte('month', since)
      .not('detail', 'is', null)
      .range(from, to),
  )
  return rows.flatMap(r => (r.detail && r.category_id ? [{ detail: r.detail, categoryId: r.category_id, count: r.expense_count ?? 0, last: r.last_paid_on ?? '' }] : []))
}

/*
 * Expenses (M03, M11): every database call for this area. Admin only, enforced by Row Level Security; the screens also
 * do not make these requests for anyone else (hooks pass `enabled`).
 */
export const RECEIPT_BUCKET = 'expense-receipts'

type CategoryRow = TableRow<'expense_categories'>
const toCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  grp: r.grp as Category['grp'],
  groupId: r.group_id,
  defaultPaidVia: r.default_paid_via as PaidVia,
  sort: r.sort,
  active: r.active,
  budget: r.monthly_budget_pkr === null ? null : Number(r.monthly_budget_pkr),
})

export async function listCategories(): Promise<Category[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('expense_categories').select('*').order('sort')) ?? []
  return rows.map(toCategory)
}

/** The expense groups (0082), in their saved order. */
export async function listGroups(): Promise<ExpenseGroup[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('expense_groups').select('id, name, kind, sort').order('sort').order('name')) ?? []
  return rows.map(r => ({ id: r.id, name: r.name, kind: r.kind as ExpenseGroup['kind'], sort: r.sort }))
}

/**
 * Every expense paid from one month to another ("2026-07" to "2026-09"), oldest first: what the Expenses report reads for the
 * period it shows (a quarter is at most three months of rows, so the list is read whole, paged past the 1,000-row cap).
 */
export async function listExpensesBetween(fromMonth: string, toMonth: string): Promise<ExpenseListing> {
  const db = requireSupabase()
  const raw = await fetchAll<TableRow<'expenses'>>((from, to) =>
    db
      .from('expenses')
      .select('*')
      .gte('paid_on', monthStart(fromMonth))
      .lte('paid_on', monthEnd(toMonth))
      .order('paid_on', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, to),
  )
  const rows = raw.map(toListed)
  const payeeIds = [...new Set(rows.map(r => r.payeeId).filter((x): x is string => !!x))]
  const orderIds = [...new Set(rows.map(r => r.orderId).filter((x): x is string => !!x))]
  const labels = await lookupLabels({ companies: payeeIds, orders: orderIds })
  return { rows, payees: { ...labels.companies }, orders: orderRefsOf(labels) }
}

const toListed = (r: TableRow<'expenses'>): ListedExpense => ({
  id: r.id,
  paidOn: r.paid_on,
  amount: Number(r.amount_pkr),
  inputTax: Number(r.input_tax_pkr),
  categoryId: r.category_id,
  paidVia: r.paid_via as PaidVia,
  note: r.description,
  orderId: r.order_id,
  legId: r.supplier_order_id,
  payeeId: r.payee_id,
  recurringId: r.recurring_id,
  bankMonth: r.bank_month,
})

export interface ExpenseListing {
  rows: ListedExpense[]
  /** payee id to name, order id to "ORD-0038": the words the list shows beside a category. */
  payees: Record<string, string>
  orders: Record<string, string>
}

/** Expenses paid in one month ("2026-11"), newest first. */
export async function listExpenses(month: string): Promise<ExpenseListing> {
  const db = requireSupabase()
  const raw = await fetchAll<TableRow<'expenses'>>((from, to) =>
    db
      .from('expenses')
      .select('*')
      .gte('paid_on', monthStart(month))
      .lte('paid_on', monthEnd(month))
      .order('paid_on', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, to),
  )
  const rows = raw.map(toListed)
  const payeeIds = [...new Set(rows.map(r => r.payeeId).filter((x): x is string => !!x))]
  const orderIds = [...new Set(rows.map(r => r.orderId).filter((x): x is string => !!x))]
  // payee names and order numbers in one lookup_labels call (ids in the body: no URL-length limit)
  const labels = await lookupLabels({ companies: payeeIds, orders: orderIds })
  return { rows, payees: { ...labels.companies }, orders: orderRefsOf(labels) }
}

const orderRefsOf = (labels: Labels): Record<string, string> =>
  Object.fromEntries(Object.entries(labels.orders).map(([id, o]) => [id, orderRef(Number(o.number))]))

/** Company names by id (lookup_labels). */
export async function companyNames(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  return { ...(await lookupLabels({ companies: ids })).companies }
}

/** "ORD-0038" by order id (lookup_labels). */
export async function orderRefs(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {}
  return orderRefsOf(await lookupLabels({ orders: ids }))
}

/** The category tally of the last 30 days, for the first row's default (A6.5). */
export async function recentCategoryUse(): Promise<{ category_id: string; paid_on: string }[]> {
  const db = requireSupabase()
  return fetchAll((from, to) =>
    db.from('expenses').select('category_id, paid_on').gte('paid_on', businessDaysFromNow(-30)).range(from, to),
  )
}

/** The category last used on this order, or null when it has no expense yet (A3: from an order, the last category used). */
export async function lastCategoryForOrder(orderId: string): Promise<string | null> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('expenses').select('category_id').eq('order_id', orderId).order('created_at', { ascending: false }).limit(1),
  )
  return rows?.[0]?.category_id ?? null
}

/**
 * One atomic bulk insert. Every row carries its client id and the request is an upsert that ignores duplicates, so a
 * double submit (or a retry after a dropped reply) adds nothing twice. The month lock refuses the whole request.
 */
export async function insertExpenses(rows: readonly (ExpenseInsert & Partial<TagColumns>)[]): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('expenses').upsert([...rows], { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

export interface TagColumns {
  order_id: string | null
  supplier_order_id: string | null
  payee_id: string | null
  reference: string | null
}

export interface ExpensePatch {
  amount_pkr: number
  category_id: string
  paid_on: string
  paid_via: PaidVia
  description: string | null
  input_tax_pkr: number
  order_id: string | null
  supplier_order_id: string | null
  payee_id: string | null
}

export async function updateExpense(id: string, patch: ExpensePatch): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('expenses').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteExpense(id: string): Promise<void> {
  const db = requireSupabase()
  const files = unwrap(await db.from('attachments').select('path').eq('expense_id', id)) ?? []
  const { error } = await db.from('expenses').delete().eq('id', id)
  if (error) throw error
  // The rows went with the expense (cascade); the stored photos are removed by the app.
  if (files.length) await db.storage.from(RECEIPT_BUCKET).remove(files.map(f => f.path))
}

// ------------------------------------------------------------------ receipts

export interface Receipt {
  id: string
  path: string
  fileName: string
  sizeBytes: number | null
}

export async function listReceipts(expenseId: string): Promise<Receipt[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('attachments').select('id, path, file_name, size_bytes').eq('expense_id', expenseId).order('created_at')) ?? []
  return rows.map(r => ({ id: r.id, path: r.path, fileName: r.file_name, sizeBytes: r.size_bytes }))
}

/** Upload one photo to {expense_id}/{uuid}.ext, then record it. A row that cannot be written takes its object back out. */
export async function uploadReceipt(expenseId: string, file: File): Promise<void> {
  const db = requireSupabase()
  const ext = (/\.([a-z0-9]{1,5})$/i.exec(file.name)?.[1] ?? (file.type === 'image/png' ? 'png' : 'jpg')).toLowerCase()
  const path = `${expenseId}/${crypto.randomUUID()}.${ext}`
  const up = await db.storage.from(RECEIPT_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) throw up.error
  const res = await db.from('attachments').insert({
    bucket: RECEIPT_BUCKET,
    path,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: file.size,
    expense_id: expenseId,
  })
  if (res.error) {
    await db.storage.from(RECEIPT_BUCKET).remove([path])
    throw res.error
  }
}

export async function deleteReceipt(r: Pick<Receipt, 'id' | 'path'>): Promise<void> {
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

// ------------------------------------------------------------------ tags: order and leg

export interface OrderOption {
  id: string
  ref: string
  company: string
}

/** Recent orders to tag an expense to. The newest 300 are enough for a picker that is typed into. */
export async function listOrderOptions(): Promise<OrderOption[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('orders').select('id, number, company_id').order('number', { ascending: false }).limit(300)) ?? []
  const names = await companyNames([...new Set(rows.map(r => r.company_id))])
  return rows.map(r => ({ id: r.id, ref: orderRef(r.number), company: names[r.company_id] ?? '' }))
}

/**
 * A supplier payment tagged to an order whose only leg is obvious: tag the leg and the payee too, so "we owe" on that leg is right
 * without another cell to fill. An order with two or more legs stays tagged to the order alone (the margin is right either way).
 * Best effort: if the legs cannot be read the payment is still saved, tagged to the order.
 */
export async function withSingleLeg<T extends { order_id?: string | null; category_id: string }>(
  rows: readonly T[],
  supplierPaymentId: string,
): Promise<(T & Partial<Pick<TagColumns, 'supplier_order_id' | 'payee_id'>>)[]> {
  const orderIds = [...new Set(rows.filter(r => r.order_id && r.category_id === supplierPaymentId).map(r => r.order_id as string))]
  if (orderIds.length === 0) return [...rows]
  try {
    const db = requireSupabase()
    const legs = unwrap(await db.from('supplier_orders').select('id, order_id, supplier_id').in('order_id', orderIds)) ?? []
    const byOrder = new Map<string, typeof legs>()
    for (const l of legs) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), l])
    return rows.map(r => {
      const own = r.order_id && r.category_id === supplierPaymentId ? byOrder.get(r.order_id) : undefined
      return own && own.length === 1 ? { ...r, supplier_order_id: own[0].id, payee_id: own[0].supplier_id } : r
    })
  } catch {
    return [...rows]
  }
}

export interface LegOption {
  id: string
  /** "supplier order A": by order of creation (owner glossary 2026-10-19; the database still calls it a leg). */
  label: string
  supplierId: string
  supplierName: string
}

export async function listLegOptions(orderId: string): Promise<LegOption[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('supplier_orders').select('id, supplier_id, created_at').eq('order_id', orderId).order('created_at')) ?? []
  const names = await companyNames([...new Set(rows.map(r => r.supplier_id))])
  return rows.map((r, i) => ({ id: r.id, label: `supplier order ${String.fromCharCode(65 + i)}`, supplierId: r.supplier_id, supplierName: names[r.supplier_id] ?? '' }))
}

// ------------------------------------------------------------------ recurring templates

const toTemplate = (r: TableRow<'recurring_expenses'>): RecurringTemplate => ({
  id: r.id,
  label: r.label,
  categoryId: r.category_id,
  amount: Number(r.amount),
  dayOfMonth: r.day_of_month,
  active: r.active,
  startMonth: r.start_month,
  notes: r.notes,
  paidVia: (r.paid_via as PaidVia | null) ?? null,
})

export async function listRecurring(): Promise<RecurringTemplate[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('recurring_expenses').select('*').order('label')) ?? []
  return rows.map(toTemplate)
}

/** Template ids already recorded for a period ("2026-11"). */
export async function recordedRecurring(period: string): Promise<string[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('expenses').select('recurring_id').eq('period', period).not('recurring_id', 'is', null)) ?? []
  return rows.map(r => r.recurring_id as string)
}

export interface RecurringInput {
  /** The template being edited. */
  id?: string
  /** A new template: the client id it is inserted under, so a retry adds it once (BUG-RV-07 pattern). */
  newId?: string
  label: string
  categoryId: string
  amount: number
  dayOfMonth: number | null
  active: boolean
  startMonth: string | null
  notes: string | null
  /** How it is usually paid; null follows the category. */
  paidVia?: PaidVia | null
}

export async function saveRecurring(input: RecurringInput): Promise<void> {
  const db = requireSupabase()
  const row = {
    label: input.label,
    category_id: input.categoryId,
    amount: input.amount,
    day_of_month: input.dayOfMonth,
    active: input.active,
    start_month: input.startMonth,
    notes: input.notes,
    ...(input.paidVia !== undefined ? { paid_via: input.paidVia } : {}),
  }
  const res = input.id
    ? await db.from('recurring_expenses').update(row).eq('id', input.id)
    : await db.from('recurring_expenses').insert({ ...row, id: input.newId })
  if (res.error && !(res.error.code === '23505' && !input.id && input.newId)) throw res.error
}

/**
 * Record a template for a period: one expense with (recurring_id, period). A second press (or a second tab) hits the
 * unique key on (recurring_id, period) and nothing is added; the caller treats that as "already recorded".
 */
export async function recordRecurring(t: RecurringTemplate, args: { id: string; period: string; paidOn: string; paidVia: PaidVia }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('expenses').insert({
    id: args.id,
    amount_pkr: t.amount,
    category_id: t.categoryId,
    paid_on: args.paidOn,
    paid_via: args.paidVia,
    description: t.label,
    recurring_id: t.id,
    period: args.period,
  })
  if (error) throw error
}
