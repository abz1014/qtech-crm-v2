import type { AddedFile } from '@/lib/fileIntake'

/*
 * Expenses: the pure rules (M03, M11). No React and no database in here, so every rule can be unit-tested.
 * The categories are rows in `expense_categories` (A6.1); the seed ids are fixed, so the three that carry input tax
 * and the one a leg pre-fills can be named.
 */
export type PaidVia = 'bank' | 'cash'
export type CategoryGroup = 'overhead' | 'order_cost' | 'non_pnl'

export interface Category {
  id: string
  name: string
  grp: CategoryGroup
  defaultPaidVia: PaidVia
  sort: number
  active: boolean
}

export const SUPPLIER_PAYMENT_ID = 'ca7e0000-0000-4000-8000-000000000011'
export const FREIGHT_ID = 'ca7e0000-0000-4000-8000-000000000012'
export const CLEARING_ID = 'ca7e0000-0000-4000-8000-000000000013'

/** Owner decision 2026-10-14: input tax is shown (collapsed, optional) on these three categories only. */
export const INPUT_TAX_CATEGORIES: readonly string[] = [SUPPLIER_PAYMENT_ID, FREIGHT_ID, CLEARING_ID]
export const showsInputTax = (categoryId: string | null | undefined): boolean => !!categoryId && INPUT_TAX_CATEGORIES.includes(categoryId)

export const GROUP_LABEL: Record<CategoryGroup, string> = { overhead: 'Overhead', order_cost: 'Order cost', non_pnl: 'Not in P&L' }
export const PAID_VIA_LABEL: Record<PaidVia, string> = { bank: 'Bank', cash: 'Cash' }

/** "Overhead · cash": the trailing text of a category in the type-ahead (g2-month-end, Row details). */
export const categoryMeta = (c: Category): string => `${GROUP_LABEL[c.grp]} · ${c.defaultPaidVia}`

/** Active categories first in their own order; used where only a pick is offered. */
export const activeCategories = (all: readonly Category[]): Category[] => all.filter(c => c.active).sort((a, b) => a.sort - b.sort)

export function paidViaFor(categoryId: string, categories: readonly Category[]): PaidVia {
  return categories.find(c => c.id === categoryId)?.defaultPaidVia ?? 'bank'
}

/** The category used most in a list of recent expenses (ties: the one used last). Null when there are none. */
export function mostUsedCategory(rows: readonly { category_id: string; paid_on: string }[]): { id: string; count: number } | null {
  const tally = new Map<string, { count: number; last: string }>()
  for (const r of rows) {
    const t = tally.get(r.category_id) ?? { count: 0, last: '' }
    t.count += 1
    if (r.paid_on > t.last) t.last = r.paid_on
    tally.set(r.category_id, t)
  }
  let best: { id: string; count: number; last: string } | null = null
  for (const [id, t] of tally) {
    if (!best || t.count > best.count || (t.count === best.count && t.last > best.last)) best = { id, ...t }
  }
  return best ? { id: best.id, count: best.count } : null
}

// ------------------------------------------------------------------ months and the closed-month error

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-09-30" to "September 2026", the wording of the month-lock error (0027: to_char(.., 'FMMonth YYYY')). */
export function monthLabel(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(isoDate)
  return m ? `${MONTH_NAMES[+m[2] - 1]} ${m[1]}` : ''
}

export const monthKey = (isoDate: string): string => isoDate.slice(0, 7)

/** First day of a month key ("2026-11") */
export const monthStart = (key: string): string => `${key}-01`

export function monthEnd(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

export function shiftMonth(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** "2026-11" to "November 2026". */
export const monthKeyLabel = (key: string): string => monthLabel(monthStart(key))
export const monthKeyShort = (key: string): string => `${monthLabel(monthStart(key)).slice(0, 3)} ${key.slice(0, 4)}`

/** The month a closed-month error names ("September 2026"), or null when the message is some other sentence. */
export function closedMonthOf(message: string | undefined | null): string | null {
  const m = /^(.+?) is closed\.\s*An admin can reopen it\.?$/i.exec((message ?? '').trim())
  return m ? m[1] : null
}

// ------------------------------------------------------------------ burst rows (M11)

export interface BurstRow {
  /** Generated when the row is made and used as the expense id, so a second save cannot add a second expense. */
  id: string
  amount: number | null
  categoryId: string
  /** Where the category came from: the 30-day favourite, the row above, or typed by the person. */
  categorySource: 'most-used' | 'carried' | 'typed'
  /** Text left in the category box that matches no category: the row is unfinished until it is replaced or cleared. */
  categoryText?: string
  date: string
  dateTyped: boolean
  /** null: follows the category's own default. */
  paidVia: PaidVia | null
  /** The Detail field ("LEA-1234", "Office water"), saved as the expense's description. */
  note: string
  photo: AddedFile | null
  inputTax: number | null
  /** Optional tag (audit X1): the order this spend belongs to. Never carried from the row above. */
  orderId: string | null
  /** Text left in the order box that matches no order: the row is unfinished until it is replaced or cleared. */
  orderText?: string
  /** The closed-month sentence for this row after a refused save. */
  error?: string
}

export interface BurstDefaults {
  categoryId: string
  today: string
}

export function newBurstRow(prev: BurstRow | null, d: BurstDefaults, id: string = crypto.randomUUID()): BurstRow {
  return {
    id,
    amount: null,
    categoryId: prev ? prev.categoryId : d.categoryId,
    categorySource: prev ? 'carried' : 'most-used',
    date: d.today,
    dateTyped: false,
    paidVia: null,
    note: '',
    photo: null,
    inputTax: null,
    orderId: null,
  }
}

export const effectivePaidVia = (row: BurstRow, categories: readonly Category[]): PaidVia => row.paidVia ?? paidViaFor(row.categoryId, categories)

/** A row with no amount is an empty row: it is skipped on save rather than refused. */
export const isFilled = (row: BurstRow): boolean => row.amount !== null && row.amount !== 0

export const isSavable = (row: BurstRow): boolean => row.amount !== null && row.amount > 0 && !!row.categoryId && !!row.date && !row.categoryText && !row.orderText

export function burstTotals(rows: readonly BurstRow[]): { count: number; total: number } {
  const filled = rows.filter(isFilled)
  return { count: filled.length, total: filled.reduce((s, r) => s + (r.amount ?? 0), 0) }
}

/** Rows that cannot be saved as they stand: an amount that is not above zero. */
export const invalidRows = (rows: readonly BurstRow[]): BurstRow[] => rows.filter(r => isFilled(r) && !isSavable(r))

export interface ExpenseInsert {
  id: string
  amount_pkr: number
  category_id: string
  paid_on: string
  paid_via: PaidVia
  description: string | null
  input_tax_pkr: number
  /** Present only when the row was tagged to an order. */
  order_id?: string | null
}

export function burstInserts(rows: readonly BurstRow[], categories: readonly Category[]): ExpenseInsert[] {
  return rows.filter(isSavable).map(r => ({
    id: r.id,
    amount_pkr: r.amount as number,
    category_id: r.categoryId,
    paid_on: r.date,
    paid_via: effectivePaidVia(r, categories),
    description: cleanDetail(r.note),
    input_tax_pkr: showsInputTax(r.categoryId) ? (r.inputTax ?? 0) : 0,
    ...(r.orderId ? { order_id: r.orderId } : {}),
  }))
}

/**
 * The save was refused with "September 2026 is closed. An admin can reopen it." The sentence names a month, not a row, so
 * the rows dated in that month carry the error and every row keeps what it holds.
 */
export function markClosedRows(rows: readonly BurstRow[], message: string): BurstRow[] {
  const month = closedMonthOf(message)
  return rows.map(r => ({ ...r, error: month && isSavable(r) && monthLabel(r.date) === month ? message : undefined }))
}

export const clearRowErrors = (rows: readonly BurstRow[]): BurstRow[] => rows.map(r => (r.error ? { ...r, error: undefined } : r))

// ------------------------------------------------------------------ the order tag (audit X1)

export interface OrderTagOption {
  id: string
  /** "ORD-0042". */
  ref: string
  company: string
}

/** Lower is better; -1 means no match. "42" finds ORD-0042 first, then any ORD number containing 42, then a customer name. */
function rankOrder(o: OrderTagOption, q: string): number {
  if (!q) return 0
  const ref = o.ref.toLowerCase()
  if (ref === q) return 0
  if (/^\d+$/.test(q) && Number(ref.replace(/\D/g, '')) === Number(q)) return 0
  if (ref.includes(q)) return 1
  if (o.company.toLowerCase().split(/[\s&]+/).some(w => w.startsWith(q))) return 2
  if (o.company.toLowerCase().includes(q)) return 3
  return -1
}

export function matchOrders(orders: readonly OrderTagOption[], text: string): OrderTagOption[] {
  const q = text.trim().toLowerCase()
  return orders
    .map((o, i) => ({ o, i, r: rankOrder(o, q) }))
    .filter(x => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(x => x.o)
}

// ------------------------------------------------------------------ recurring templates

export interface RecurringTemplate {
  id: string
  label: string
  categoryId: string
  amount: number
  dayOfMonth: number | null
  active: boolean
  startMonth: string | null
  notes: string | null
}

/** Due this month: active, started, and not yet recorded for the period (recurring_id, period is unique). */
export function dueThisMonth(templates: readonly RecurringTemplate[], recordedIds: ReadonlySet<string>, period: string): RecurringTemplate[] {
  return templates.filter(t => t.active && (!t.startMonth || t.startMonth <= period) && !recordedIds.has(t.id))
}

/** The date a recorded template is dated: its day of the month when that day has passed, else today (never in the future). */
export function recurringPaidOn(t: Pick<RecurringTemplate, 'dayOfMonth'>, today: string): string {
  if (!t.dayOfMonth) return today
  const day = `${today.slice(0, 7)}-${String(t.dayOfMonth).padStart(2, '0')}`
  return day < today ? day : today
}

// ------------------------------------------------------------------ list totals and filters

export interface ListedExpense {
  id: string
  paidOn: string
  amount: number
  inputTax: number
  categoryId: string
  paidVia: PaidVia
  note: string | null
  orderId: string | null
  legId: string | null
  payeeId: string | null
  recurringId: string | null
  bankMonth: string | null
}

export interface ExpenseFilters {
  group: CategoryGroup | 'all'
  categoryId: string | 'all'
  paidVia: PaidVia | 'all'
}

export const NO_FILTERS: ExpenseFilters = { group: 'all', categoryId: 'all', paidVia: 'all' }

export function filterExpenses(rows: readonly ListedExpense[], f: ExpenseFilters, categories: readonly Category[]): ListedExpense[] {
  return rows.filter(r => {
    if (f.categoryId !== 'all' && r.categoryId !== f.categoryId) return false
    if (f.group !== 'all' && categories.find(c => c.id === r.categoryId)?.grp !== f.group) return false
    if (f.paidVia !== 'all' && r.paidVia !== f.paidVia) return false
    return true
  })
}

export function listTotals(rows: readonly ListedExpense[]): { count: number; total: number; inputTax: number; cost: number } {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const inputTax = rows.reduce((s, r) => s + r.inputTax, 0)
  // Sums are rounded to paisa so float dust never shows.
  const r2 = (n: number) => Math.round(n * 100) / 100
  return { count: rows.length, total: r2(total), inputTax: r2(inputTax), cost: r2(total - inputTax) }
}

// ------------------------------------------------------------------ the Detail field (owner request 2026-10-20)

/*
 * One optional word or two per expense, kept in expenses.description: the car ("LEA-1234"), the bill ("Office water"). Fuel
 * per car shows in the In vs out report without one category per car. The field suggests what was typed before.
 */

/** How the database matches details (0079): outer spaces gone, inner runs of spaces one, case ignored. */
export const detailKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()
/** The detail as it is saved: trimmed, inner spaces squeezed; empty is null. */
export const cleanDetail = (s: string | null | undefined): string | null => (s ?? '').trim().replace(/\s+/g, ' ') || null

/** One row of v_month_cash_out_detail as the suggestions read it. */
export interface DetailUse {
  detail: string
  categoryId: string
  count: number
  /** The latest date it was used ("2026-10-14"). */
  last: string
}

/**
 * The Detail field's suggestions: one per detail (case and spaces ignored, shown as last typed), the ones used with this
 * category first, then the most used, then the most recent.
 */
export function detailSuggestions(rows: readonly DetailUse[], categoryId: string | null | undefined, limit = 30): string[] {
  const by = new Map<string, { shown: string; shownAt: string; total: number; inCategory: number; last: string }>()
  for (const r of rows) {
    const shown = cleanDetail(r.detail)
    if (!shown) continue
    const k = detailKey(shown)
    const t = by.get(k) ?? { shown, shownAt: '', total: 0, inCategory: 0, last: '' }
    t.total += r.count
    if (categoryId && r.categoryId === categoryId) t.inCategory += r.count
    if (r.last > t.last) t.last = r.last
    if (r.last >= t.shownAt) {
      t.shown = shown
      t.shownAt = r.last
    }
    by.set(k, t)
  }
  return [...by.values()]
    .sort((a, b) => b.inCategory - a.inCategory || b.total - a.total || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || a.shown.localeCompare(b.shown))
    .slice(0, limit)
    .map(t => t.shown)
}
