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
  /** The P&L kind; always the kind of the category's group (0086 keeps them in step). */
  grp: CategoryGroup
  /** The group it is listed under ("Office running"), 0086. */
  groupId: string
  defaultPaidVia: PaidVia
  sort: number
  /** false: archived (hidden from pickers, history kept). */
  active: boolean
  /** Optional monthly budget in PKR (gross paid), 0086. */
  budget: number | null
}

/** The first level of the expense list (0086): "Office running", "Vehicles", "Order costs". Its kind is the P&L place of its categories. */
export interface ExpenseGroup {
  id: string
  name: string
  kind: CategoryGroup
  sort: number
}

/** The seeded groups (0086), by fixed id. */
export const GROUP_IDS = {
  office: 'ca7e9000-0000-4000-8000-000000000001',
  vehicles: 'ca7e9000-0000-4000-8000-000000000002',
  staff: 'ca7e9000-0000-4000-8000-000000000003',
  other: 'ca7e9000-0000-4000-8000-000000000004',
  orderCosts: 'ca7e9000-0000-4000-8000-000000000005',
  owner: 'ca7e9000-0000-4000-8000-000000000006',
} as const

/** The P&L kind of a group, in words: where its spending shows in Profit and loss. */
export const KIND_LABEL: Record<CategoryGroup, string> = { overhead: 'Running costs', order_cost: 'Order costs', non_pnl: 'Not a cost (drawings, loans)' }

export const sortGroups = (groups: readonly ExpenseGroup[]): ExpenseGroup[] =>
  [...groups].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

export interface GroupedCategories {
  group: ExpenseGroup
  categories: Category[]
}

/**
 * Categories under their groups, in the saved order (groups by sort, then categories by sort and name). A category whose group
 * is not in the list (not loaded yet) is left out. `activeOnly` hides archived ones (pickers); empty groups are kept unless `dropEmpty`.
 */
export function groupCategories(
  categories: readonly Category[],
  groups: readonly ExpenseGroup[],
  opts: { activeOnly?: boolean; dropEmpty?: boolean; keepId?: string | null } = {},
): GroupedCategories[] {
  const byGroup = new Map<string, Category[]>()
  for (const c of categories) {
    if (opts.activeOnly && !c.active && c.id !== opts.keepId) continue
    byGroup.set(c.groupId, [...(byGroup.get(c.groupId) ?? []), c])
  }
  return sortGroups(groups)
    .map(group => ({ group, categories: (byGroup.get(group.id) ?? []).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)) }))
    .filter(g => !opts.dropEmpty || g.categories.length > 0)
}

/**
 * The group a newly typed category most likely belongs to: the group of an active category one of whose words starts with a
 * word of the typed name (3 letters or more): "Bike fuel" -> "Fuel & travel" -> Vehicles; "water bottles" -> "Water" -> Office
 * running. The earliest typed word that finds one decides; null when none does (or the group is not loaded).
 */
export function guessGroupId(typed: string, categories: readonly Category[], groups: readonly ExpenseGroup[]): string | null {
  const words = typed.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3)
  const known = new Set(groups.map(g => g.id))
  for (const w of words) {
    const hit = categories.find(c => c.active && known.has(c.groupId) && c.name.toLowerCase().split(/[^a-z0-9]+/).some(n => n.startsWith(w)))
    if (hit) return hit.groupId
  }
  return null
}

/** The group new categories go to when none is chosen: Office running, else the first group of running costs. */
export function defaultGroupId(groups: readonly ExpenseGroup[]): string | null {
  return groups.find(g => g.id === GROUP_IDS.office)?.id ?? sortGroups(groups).find(g => g.kind === 'overhead')?.id ?? sortGroups(groups)[0]?.id ?? null
}

export const SUPPLIER_PAYMENT_ID = 'ca7e0000-0000-4000-8000-000000000011'
export const FREIGHT_ID = 'ca7e0000-0000-4000-8000-000000000012'
export const CLEARING_ID = 'ca7e0000-0000-4000-8000-000000000013'

/** Owner decision 2026-10-14: input tax is shown (collapsed, optional) on these three categories only. */
export const INPUT_TAX_CATEGORIES: readonly string[] = [SUPPLIER_PAYMENT_ID, FREIGHT_ID, CLEARING_ID]
export const showsInputTax = (categoryId: string | null | undefined): boolean => !!categoryId && INPUT_TAX_CATEGORIES.includes(categoryId)

export const GROUP_LABEL: Record<CategoryGroup, string> = { overhead: 'Overhead', order_cost: 'Order cost', non_pnl: 'Not in P&L' }
export const PAID_VIA_LABEL: Record<PaidVia, string> = { bank: 'Bank', cash: 'Cash' }

/** "Office running · cash": the trailing text of a category in the type-ahead (its group, else its kind, and how it is usually paid). */
export const categoryMeta = (c: Category, groups?: readonly ExpenseGroup[]): string =>
  `${groups?.find(g => g.id === c.groupId)?.name ?? GROUP_LABEL[c.grp]} · ${c.defaultPaidVia}`

/** Active categories first in their own order; used where only a pick is offered. */
export const activeCategories = (all: readonly Category[]): Category[] => all.filter(c => c.active).sort((a, b) => a.sort - b.sort)

export function paidViaFor(categoryId: string, categories: readonly Category[]): PaidVia {
  return categories.find(c => c.id === categoryId)?.defaultPaidVia ?? 'bank'
}

export interface CategoryUse {
  id: string
  count: number
  /** The latest date it was used. */
  last: string
}

/** Categories by how often they were used in a list of recent expenses, most used first (ties: the one used last). */
export function rankCategoryUse(rows: readonly { category_id: string; paid_on: string }[]): CategoryUse[] {
  const tally = new Map<string, CategoryUse>()
  for (const r of rows) {
    const t = tally.get(r.category_id) ?? { id: r.category_id, count: 0, last: '' }
    t.count += 1
    if (r.paid_on > t.last) t.last = r.paid_on
    tally.set(r.category_id, t)
  }
  return [...tally.values()].sort((a, b) => b.count - a.count || (a.last < b.last ? 1 : a.last > b.last ? -1 : 0) || a.id.localeCompare(b.id))
}

/** The category used most in a list of recent expenses (ties: the one used last). Null when there are none. */
export function mostUsedCategory(rows: readonly { category_id: string; paid_on: string }[]): { id: string; count: number } | null {
  const best = rankCategoryUse(rows)[0]
  return best ? { id: best.id, count: best.count } : null
}

/** The "Recent" section of the category picker: up to `limit` active categories, most used in the last 30 days first. */
export function recentCategories(use: readonly CategoryUse[], categories: readonly Category[], limit = 5): Category[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  return use.flatMap(u => {
    const c = byId.get(u.id)
    return c && c.active ? [c] : []
  }).slice(0, limit)
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

/**
 * The month a monthly bill paid on `paidOn` is for (0087 for-month): last month when paid on day 1 to 10 (September's salary on
 * 5 October), else the month paid ("2026-10-05" -> "2026-09", "2026-10-22" -> "2026-10").
 */
export function forMonthOf(paidOn: string): string {
  const day = Number(paidOn.slice(8, 10))
  return day >= 1 && day <= 10 ? shiftMonth(monthKey(paidOn), -1) : monthKey(paidOn)
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
  /** "Every month": saving also makes a recurring template, and links this expense to it for its month. */
  repeat?: boolean
  /** The id the row's recurring template is saved under (made with the row, so a retry adds it once). */
  templateId?: string
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
    repeat: false,
    templateId: crypto.randomUUID(),
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
  /** Present only for an "Every month" row: its template and the month it pays. */
  recurring_id?: string
  /** The month it is for: an "Every month" row's, or a monthly bill's (0087 for-month). */
  period?: string | null
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
    // 0087: a bill paid by the 10th is for last month, the month its template is then due for (billPeriod)
    ...(r.repeat && r.templateId ? { recurring_id: r.templateId, period: forMonthOf(r.date) } : {}),
  }))
}

/** What an "Every month" row saves as its recurring template: named by its detail (else its category), due on its day (1 to 28). */
export interface RepeatTemplate {
  newId: string
  label: string
  categoryId: string
  amount: number
  dayOfMonth: number
  startMonth: string
  paidVia: PaidVia
}

export function repeatTemplates(rows: readonly BurstRow[], categories: readonly Category[]): RepeatTemplate[] {
  return rows
    .filter(r => r.repeat && r.templateId && isSavable(r))
    .map(r => ({
      newId: r.templateId as string,
      label: cleanDetail(r.note) ?? categories.find(c => c.id === r.categoryId)?.name ?? 'Monthly expense',
      categoryId: r.categoryId,
      amount: r.amount as number,
      dayOfMonth: Math.min(Number(r.date.slice(8, 10)) || 1, 28),
      startMonth: forMonthOf(r.date),
      paidVia: effectivePaidVia(r, categories),
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
  /** How it is usually paid (0086); null follows the category's own default. */
  paidVia: PaidVia | null
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
  /** The month a monthly bill is for ("2026-09", 0087 for-month); null: the month it was paid in. */
  period: string | null
}

export interface ExpenseFilters {
  /** A group id (0086: the group the category is listed under), or 'all'. */
  group: string | 'all'
  categoryId: string | 'all'
  paidVia: PaidVia | 'all'
}

export const NO_FILTERS: ExpenseFilters = { group: 'all', categoryId: 'all', paidVia: 'all' }

export function filterExpenses(rows: readonly ListedExpense[], f: ExpenseFilters, categories: readonly Category[]): ListedExpense[] {
  return rows.filter(r => {
    if (f.categoryId !== 'all' && r.categoryId !== f.categoryId) return false
    if (f.group !== 'all' && categories.find(c => c.id === r.categoryId)?.groupId !== f.group) return false
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

// ------------------------------------------------------------------ the list, by group (0086)

/** The section a listed expense sits in: its category's group ("Office running"), in the groups' saved order. */
export interface ListSection {
  key: string
  name: string
  sort: number
}

export function sectionOf(r: Pick<ListedExpense, 'categoryId'>, categories: readonly Category[], groups: readonly ExpenseGroup[]): ListSection {
  const cat = categories.find(c => c.id === r.categoryId)
  const g = cat ? groups.find(x => x.id === cat.groupId) : undefined
  return g ? { key: g.id, name: g.name, sort: g.sort } : { key: 'none', name: 'Other', sort: Number.MAX_SAFE_INTEGER }
}

/** The rows in section order (groups by their sort, rows keep their order inside each), so a grouped table draws one block per group. */
export function bySection<T extends Pick<ListedExpense, 'categoryId'>>(rows: readonly T[], categories: readonly Category[], groups: readonly ExpenseGroup[]): T[] {
  return rows
    .map((r, i) => ({ r, i, s: sectionOf(r, categories, groups) }))
    .sort((a, b) => a.s.sort - b.s.sort || a.s.name.localeCompare(b.s.name) || a.i - b.i)
    .map(x => x.r)
}

/** Per section: how many and how much (gross), in paisa-safe sums. */
export function sectionTotals(rows: readonly ListedExpense[], categories: readonly Category[], groups: readonly ExpenseGroup[]): Map<string, { count: number; total: number }> {
  const out = new Map<string, { count: number; total: number }>()
  for (const r of rows) {
    const k = sectionOf(r, categories, groups).key
    const t = out.get(k) ?? { count: 0, total: 0 }
    t.count += 1
    t.total = Math.round((t.total + r.amount) * 100) / 100
    out.set(k, t)
  }
  return out
}

/** "PKR 2,330,850": whole rupees with separators, paisa only when there are some. */
export const pkr = (n: number): string => `PKR ${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
