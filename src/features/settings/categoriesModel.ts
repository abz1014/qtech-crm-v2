/*
 * Pure helpers for Settings › Expense categories (M13; groups, budgets and merge 0086). Two levels: a group ("Office
 * running") holds categories ("Water"). The group's kind is where its spending shows in Profit and loss, and every category
 * in it takes that kind. A category that expenses point to cannot be deleted (the foreign key is RESTRICT): Archive hides it
 * from new expenses and leaves the old ones as they are; Merge moves every expense of one category into another.
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
  /** The group it is listed under (0086). */
  group_id: string
  /** Optional monthly budget, PKR (0086). */
  monthly_budget_pkr: number | null
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
export const nextSort = (rows: readonly Pick<Category, 'sort'>[]): number => rows.reduce((m, c) => Math.max(m, c.sort), 0) + SORT_STEP

export type NameCheck = { ok: true; name: string } | { ok: false; message: string }
/** The unique index ignores case and outer spaces, so the check does too. */
export function checkCategoryName(raw: string, rows: readonly Pick<Category, 'id' | 'name'>[], selfId?: string): NameCheck {
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
      ? `${n} "${c.name}", so it cannot be deleted. Archive it instead: it stops showing up for new expenses and the old ones keep it. Or merge it into another category.`
      : `${n} "${c.name}", so it cannot be deleted. It is archived, which hides it from new expenses.`,
  }
}

/** The footer line under the list: "17 categories · 15 active". */
export const categoriesFooter = (rows: readonly Pick<Category, 'active'>[]): string => {
  const archived = rows.filter(r => !r.active).length
  return `${rows.length} ${rows.length === 1 ? 'category' : 'categories'}${archived ? ` · ${archived} archived` : ''}`
}

export const usageText = (used: number) => (used === 0 ? 'Not used yet' : `${used} ${used === 1 ? 'use' : 'uses'}`)

// ------------------------------------------------------------------ groups (0086)

/** A group: the first level of the list. Its kind is the P&L place of every category in it. */
export interface ExpenseGroup {
  id: string
  name: string
  kind: CategoryGroup
  sort: number
}

/** Where a group's spending shows, in plain words (the same words as the expense screens). */
export const KIND_WORDS: Record<CategoryGroup, string> = {
  overhead: 'Running costs',
  order_cost: 'Order costs',
  non_pnl: 'Not a cost (drawings, loans)',
}

/** One phrase per kind, for the move and merge dialogs: "count as {phrase} in Profit and loss". */
export const KIND_EFFECT: Record<CategoryGroup, string> = {
  overhead: 'a running cost',
  order_cost: 'an order cost',
  non_pnl: 'no cost at all (like drawings)',
}

/** "Order costs" alone when the group is named after its kind, else "Vehicles (Running costs)". */
export const groupLabel = (g: Pick<ExpenseGroup, 'name' | 'kind'>): string =>
  g.name.trim().toLowerCase() === KIND_WORDS[g.kind].toLowerCase() ? g.name : `${g.name} (${KIND_WORDS[g.kind]})`

/** The kind under a group's name, or nothing when the name already says it ("Order costs"). */
export const kindNote = (g: Pick<ExpenseGroup, 'name' | 'kind'>): string | null =>
  g.name.trim().toLowerCase() === KIND_WORDS[g.kind].toLowerCase() ? null : KIND_WORDS[g.kind]

export const sortGroups = (groups: readonly ExpenseGroup[]): ExpenseGroup[] =>
  [...groups].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))

export interface CategorySection {
  group: ExpenseGroup
  /** Active categories of the group, in the saved order. */
  rows: Category[]
  /** How many categories the group holds, archived ones included (a group can be deleted only when this is 0). */
  held: number
  /** What the group's categories (archived ones too) had paid this month. */
  monthTotal: number
}

/**
 * The page's sections: every group in order (empty ones too, so they can be renamed or deleted) with its active
 * categories, then the archived categories on their own. A category whose group is not loaded yet is listed nowhere.
 */
export function categorySections(
  rows: readonly Category[],
  groups: readonly ExpenseGroup[],
  totals: Readonly<Record<string, number>> = {},
): { sections: CategorySection[]; archived: Category[] } {
  const sorted = sortCategories(rows)
  const sections = sortGroups(groups).map(group => {
    const mine = sorted.filter(c => c.group_id === group.id)
    return {
      group,
      rows: mine.filter(c => c.active),
      held: mine.length,
      monthTotal: Math.round(mine.reduce((s, c) => s + (totals[c.id] ?? 0), 0) * 100) / 100,
    }
  })
  const known = new Set(groups.map(g => g.id))
  return { sections, archived: sorted.filter(c => !c.active && known.has(c.group_id)) }
}

export type BudgetState = { kind: 'none' } | { kind: 'under'; left: number; budget: number } | { kind: 'over'; over: number; budget: number }

/** Spent this month against the monthly budget. Exactly on budget counts as under (nothing left). */
export function budgetState(spent: number, budget: number | null | undefined): BudgetState {
  if (!budget || budget <= 0) return { kind: 'none' }
  const d = Math.round((budget - spent) * 100) / 100
  return d >= 0 ? { kind: 'under', left: d, budget } : { kind: 'over', over: -d, budget }
}

/** "2,800" with thousands separators, whole rupees unless there are paisa. */
export const amountText = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 2 })

/**
 * Where a category can be merged into: every other active category, those of the same kind first (they keep every figure
 * of Profit and loss as it was), each list in the group order, then the saved order.
 */
export function mergeTargets(from: Category, rows: readonly Category[], groups: readonly ExpenseGroup[]): { same: Category[]; other: Category[] } {
  const gsort = new Map(sortGroups(groups).map((g, i) => [g.id, i]))
  const list = rows
    .filter(c => c.id !== from.id && c.active)
    .sort((a, b) => (gsort.get(a.group_id) ?? 99) - (gsort.get(b.group_id) ?? 99) || a.sort - b.sort || a.name.localeCompare(b.name))
  return { same: list.filter(c => c.grp === from.grp), other: list.filter(c => c.grp !== from.grp) }
}

/** The sentence a merge dialog shows before it runs. */
export function mergeSummary(from: Pick<Category, 'name' | 'used'>, into: Pick<Category, 'name'>): string {
  if (from.used === 0) return `Nothing uses "${from.name}" yet. It is removed and "${into.name}" stays.`
  const n = `${from.used} ${from.used === 1 ? 'expense or template' : 'expenses and templates'}`
  return `Moves ${n} from "${from.name}" into "${into.name}". "${from.name}" is removed.`
}

/** The sort value for a category added to a group: after the last one in that group (after every one when it is empty). */
export function nextSortIn(rows: readonly Pick<Category, 'sort' | 'group_id'>[], groupId: string): number {
  const mine = rows.filter(r => r.group_id === groupId)
  return nextSort(mine.length ? mine : rows)
}

/** Group names are unique ignoring case and outer spaces, like category names. */
export function checkGroupName(raw: string, groups: readonly Pick<ExpenseGroup, 'id' | 'name'>[], selfId?: string): NameCheck {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) return { ok: false, message: 'Give the group a name.' }
  if (name.length > 60) return { ok: false, message: 'Keep the name to 60 characters or fewer.' }
  if (groups.some(g => g.id !== selfId && g.name.trim().toLowerCase() === name.toLowerCase())) return { ok: false, message: 'A group with this name already exists.' }
  return { ok: true, name }
}
