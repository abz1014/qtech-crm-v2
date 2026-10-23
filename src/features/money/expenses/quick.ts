import { cleanDetail, SUPPLIER_PAYMENT_ID, type Category, type CategoryUse, type ExpenseInsert, type PaidVia } from '@/features/money/expenses/model'

/*
 * Quick add (redesign phase 1): amount, tap a category, Save; the row stays open for the next one. Pure rules only.
 *   - Supplier payments are never offered here (one door: Pay on the supplier order or on We owe suppliers, so every supplier
 *     payment lowers what we owe).
 *   - The buttons are the categories used most in the last 30 days, then the everyday small spends, six in all.
 *   - Cash or bank comes from the category until the person taps the other.
 */

export const BANK_CHARGES_ID = 'ca7e0000-0000-4000-8000-000000000008'

/** The small spends offered before there is any history (Fuel & travel, Office supplies & snacks, Water, Staff meals, Courier, Repairs). */
export const EVERYDAY_IDS: readonly string[] = [
  'ca7e0000-0000-4000-8000-000000000004',
  'ca7e0000-0000-4000-8000-000000000005',
  'ca7e0000-0000-4000-8000-000000000018',
  'ca7e0000-0000-4000-8000-000000000023',
  'ca7e0000-0000-4000-8000-000000000006',
  'ca7e0000-0000-4000-8000-000000000007',
]

/** Active categories a person may pick for an ordinary expense: everything but Supplier payment. */
export const pickableCategories = (categories: readonly Category[]): Category[] => categories.filter(c => c.active && c.id !== SUPPLIER_PAYMENT_ID)

/** The quick-add buttons: most used in the last 30 days first, then the everyday ones, then the rest in their order; `limit` in all. */
export function topCategories(use: readonly CategoryUse[], categories: readonly Category[], limit = 6): Category[] {
  const ok = new Map(pickableCategories(categories).map(c => [c.id, c]))
  const out: Category[] = []
  const add = (id: string) => {
    const c = ok.get(id)
    if (c && !out.includes(c) && out.length < limit) out.push(c)
  }
  for (const u of use) add(u.id)
  for (const id of EVERYDAY_IDS) add(id)
  for (const c of [...ok.values()].sort((a, b) => a.sort - b.sort)) add(c.id)
  return out
}

export interface QuickEntry {
  id: string
  amount: number
  categoryId: string
  paidOn: string
  paidVia: PaidVia
  detail: string
  /** The month a monthly bill is for ("2026-09"); null for an ordinary expense. */
  period: string | null
  /** The monthly template this payment settles for `period`, so it is not due again. */
  recurringId: string | null
  /** GST on the bill that is claimed back (input tax); 0 without a GST invoice. */
  inputTax: number
}

export type QuickProblem = 'amount' | 'category' | 'tax'

/** What stops a quick entry from saving, in the order the person meets the fields; null when it can be saved. */
export function quickProblem(e: Pick<QuickEntry, 'amount' | 'categoryId' | 'inputTax'>): QuickProblem | null {
  if (!(e.amount > 0) || !Number.isFinite(e.amount)) return 'amount'
  if (!e.categoryId || e.categoryId === SUPPLIER_PAYMENT_ID) return 'category'
  if (e.inputTax < 0 || e.inputTax > e.amount) return 'tax'
  return null
}

export function quickInsert(e: QuickEntry): ExpenseInsert {
  return {
    id: e.id,
    amount_pkr: e.amount,
    category_id: e.categoryId,
    paid_on: e.paidOn,
    paid_via: e.paidVia,
    description: cleanDetail(e.detail),
    input_tax_pkr: e.inputTax > 0 ? e.inputTax : 0,
    ...(e.period ? { period: e.period } : {}),
    ...(e.recurringId && e.period ? { recurring_id: e.recurringId } : {}),
  }
}

/** The running total under the quick add: what was added on this screen today, and how much. */
export function sessionTotal(saved: readonly { amount: number }[]): { count: number; total: number } {
  return { count: saved.length, total: Math.round(saved.reduce((s, x) => s + x.amount, 0) * 100) / 100 }
}
