/*
 * Pure helpers for Settings › Expense categories (M13). Reports group categories by `grp`; `sort` is the order they
 * are offered in. A category that expenses point to cannot be deleted (the foreign key is RESTRICT): deactivate hides
 * it from new expenses and leaves the old ones as they are.
 */
export type CategoryGroup = 'overhead' | 'order_cost' | 'non_pnl'
export type PaidVia = 'bank' | 'cash'

export interface Category {
  id: string
  name: string
  grp: CategoryGroup
  default_paid_via: PaidVia
  sort: number
  active: boolean
  /** Expenses plus recurring templates that use it. */
  used: number
}

export const GROUP_LABEL: Record<CategoryGroup, string> = {
  overhead: 'Overheads',
  order_cost: 'Order costs',
  non_pnl: 'Not in P&L',
}
export const PAID_VIA_LABEL: Record<PaidVia, string> = { bank: 'Bank', cash: 'Cash' }

export const sortCategories = (rows: readonly Category[]): Category[] =>
  [...rows].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

/** Step between sort values, so a later insert can slot in without renumbering everything. */
export const SORT_STEP = 10

/**
 * Move one category up (-1) or down (+1) in the full order. Returns only the rows whose `sort` changes, renumbered in
 * steps of 10, or [] when it is already at the end.
 */
export function moveCategory(rows: readonly Category[], id: string, dir: -1 | 1): { id: string; sort: number }[] {
  const list = sortCategories(rows)
  const i = list.findIndex(c => c.id === id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= list.length) return []
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  const changes: { id: string; sort: number }[] = []
  next.forEach((c, k) => {
    const sort = (k + 1) * SORT_STEP
    if (c.sort !== sort) changes.push({ id: c.id, sort })
  })
  return changes
}

/** The sort value for a new category: after the last one. */
export const nextSort = (rows: readonly Category[]): number => rows.reduce((m, c) => Math.max(m, c.sort), 0) + SORT_STEP

export type NameCheck = { ok: true; name: string } | { ok: false; message: string }
/** The unique index ignores case and outer spaces, so the check does too. */
export function checkCategoryName(raw: string, rows: readonly Category[], selfId?: string): NameCheck {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) return { ok: false, message: 'Give the category a name.' }
  if (name.length > 60) return { ok: false, message: 'Keep the name to 60 characters or fewer.' }
  const clash = rows.some(c => c.id !== selfId && c.name.trim().toLowerCase() === name.toLowerCase())
  if (clash) return { ok: false, message: 'A category with this name already exists.' }
  return { ok: true, name }
}

/** The plain sentence shown when someone tries to delete a category. */
export function deleteAdvice(c: Pick<Category, 'name' | 'used' | 'active'>): { canDelete: boolean; message: string } {
  if (c.used === 0) return { canDelete: true, message: `Delete "${c.name}"? Nothing uses it, so nothing else changes.` }
  const n = `${c.used} ${c.used === 1 ? 'expense or template uses' : 'expenses and templates use'}`
  return {
    canDelete: false,
    message: c.active
      ? `${n} "${c.name}", so it cannot be deleted. Deactivate it instead: it stops showing up for new expenses and the old ones keep it.`
      : `${n} "${c.name}", so it cannot be deleted. It is already deactivated, which hides it from new expenses.`,
  }
}

export const usageText = (used: number) => (used === 0 ? 'Not used yet' : `${used} ${used === 1 ? 'use' : 'uses'}`)
