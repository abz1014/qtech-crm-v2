import { forMonthOf, RENT_CATEGORY_ID, monthKey, monthKeyLabel, shiftMonth, type Category, type RecurringTemplate } from '@/features/money/expenses/model'

export { forMonthOf, RENT_CATEGORY_ID }

/*
 * For-month (redesign phase 1, owner approval 2026-10-22): a monthly bill (salaries, rent, internet) paid on or before the 10th is
 * for LAST month. September's salary paid on 5 October is filed "for September" (expenses.period), so the Expenses report, Month
 * end and the Expenses screen agree (screenshots 69 and 70 disagreed). Every other expense is for the month it was paid in, and
 * its period stays empty. Exception (owner, 0106): Rent is paid in advance, so it is always for the month it is paid in. Money "Paid out" figures stay by the day paid.
 */

/** The last day of the month on which a payment is still for the month before. */
export const BILL_CUTOFF_DAY = 10

/** The seeded categories that are monthly bills even before a template is set up: Salaries, Rent, Utilities, Electricity, Internet and phone. */
export const MONTHLY_BILL_CATEGORY_IDS: readonly string[] = [
  'ca7e0000-0000-4000-8000-000000000001',
  'ca7e0000-0000-4000-8000-000000000002',
  'ca7e0000-0000-4000-8000-000000000003',
  'ca7e0000-0000-4000-8000-000000000019',
  'ca7e0000-0000-4000-8000-000000000020',
]

/** A category paid every month: a seeded bill, or one with an active monthly template. */
export function isMonthlyBill(categoryId: string | null | undefined, templates: readonly Pick<RecurringTemplate, 'categoryId' | 'active'>[]): boolean {
  if (!categoryId) return false
  return MONTHLY_BILL_CATEGORY_IDS.includes(categoryId) || templates.some(t => t.active && t.categoryId === categoryId)
}

/**
 * The month a template's bill is due for, seen from `today`: a template paid on day 1 to 10 pays LAST month's bill (salaries on the
 * 5th), any other (or one with no day) this month's.
 */
export function billPeriod(t: Pick<RecurringTemplate, 'dayOfMonth'> & { categoryId?: string | null }, today: string): string {
  const key = monthKey(today)
  if (t.categoryId === RENT_CATEGORY_ID) return key
  return t.dayOfMonth !== null && t.dayOfMonth >= 1 && t.dayOfMonth <= BILL_CUTOFF_DAY ? shiftMonth(key, -1) : key
}

/** The two periods a panel needs to know about on `today`: last month and this month. */
export const billPeriods = (today: string): [string, string] => [shiftMonth(monthKey(today), -1), monthKey(today)]

export interface DueBill {
  template: RecurringTemplate
  /** The month it is for ("2026-09"). */
  period: string
}

/** Active templates whose bill period has no expense yet (recurring_id, period is unique), each with its period. */
export function dueBills(templates: readonly RecurringTemplate[], recorded: ReadonlyMap<string, ReadonlySet<string>>, today: string): DueBill[] {
  return templates.flatMap(t => {
    if (!t.active) return []
    const period = billPeriod(t, today)
    if (t.startMonth && t.startMonth > period) return []
    return recorded.get(period)?.has(t.id) ? [] : [{ template: t, period }]
  })
}

/**
 * The template a one-off expense of a monthly bill category settles for `period`: the only active one of that category not yet
 * recorded for it. Two or more (two salaries on one category) link none: the person records each from Monthly bills instead.
 */
export function templateToSettle(
  categoryId: string,
  period: string,
  templates: readonly RecurringTemplate[],
  recorded: ReadonlyMap<string, ReadonlySet<string>>,
): RecurringTemplate | null {
  const open = templates.filter(t => t.active && t.categoryId === categoryId && (!t.startMonth || t.startMonth <= period) && !recorded.get(period)?.has(t.id))
  return open.length === 1 ? open[0] : null
}

/**
 * New expenses of a monthly bill category that came in through Add expense or the Add expenses sheet: file each under its month
 * (`period`, when the caller has not chosen one) and, when exactly one active template of the category is still open for that
 * month, link it (`recurring_id`) so the bill is no longer due and cannot be recorded twice. Rows already linked (an "Every month"
 * row) are left alone. `recorded` must hold the month, else nothing is linked (unknown is not the same as not recorded). A
 * template settled by one row counts as recorded for the rows after it.
 */
export function linkMonthlyBills<T extends { category_id: string; paid_on: string; period?: string | null; recurring_id?: string }>(
  rows: readonly T[],
  templates: readonly RecurringTemplate[],
  recorded: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): T[] {
  const working = new Map([...(recorded ?? [])].map(([k, v]) => [k, new Set(v)]))
  return rows.map(r => {
    if (r.recurring_id || !isMonthlyBill(r.category_id, templates)) return r
    const period = r.period ?? forMonthOf(r.paid_on, r.category_id)
    const open = working.has(period) ? templateToSettle(r.category_id, period, templates, working) : null
    if (open) working.get(period)?.add(open.id)
    return { ...r, period, ...(open ? { recurring_id: open.id } : {}) }
  })
}

/** "for September" when an expense is for another month than the one it was paid in, else null. */
export function forMonthNote(paidOn: string, period: string | null | undefined): string | null {
  if (!period || period === monthKey(paidOn)) return null
  return `for ${monthKeyLabel(period).split(' ')[0]}${period.slice(0, 4) === paidOn.slice(0, 4) ? '' : ` ${period.slice(0, 4)}`}`
}

/** The choices of the For box: the month before the one paid in, that month, and the one after (an advance). */
export function forMonthChoices(paidOn: string): { value: string; label: string }[] {
  const m = monthKey(paidOn)
  return [shiftMonth(m, -1), m, shiftMonth(m, 1)].map(v => ({ value: v, label: monthKeyLabel(v) }))
}

/** The category names, for messages: "Salaries". */
export const nameOf = (id: string, categories: readonly Category[]): string => categories.find(c => c.id === id)?.name ?? 'Expense'
