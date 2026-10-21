import { describe, expect, it } from 'vitest'
import {
  budgetState,
  categoriesFooter,
  categorySections,
  checkCategoryName,
  checkGroupName,
  deleteAdvice,
  groupLabel,
  kindNote,
  mergeSummary,
  mergeTargets,
  moveCategory,
  nextSort,
  nextSortIn,
  sortCategories,
  usageText,
  type Category,
  type ExpenseGroup,
} from '@/features/settings/categoriesModel'

const c = (id: string, name: string, sort: number, over: Partial<Category> = {}): Category => ({
  id,
  name,
  grp: 'overhead',
  default_paid_via: 'bank',
  sort,
  active: true,
  used: 0,
  group_id: 'office',
  monthly_budget_pkr: null,
  ...over,
})
const rows = [c('a', 'Salaries', 10), c('b', 'Rent', 20), c('c', 'Utilities', 30)]

describe('ordering', () => {
  it('sorts by the saved order, then name', () => {
    expect(sortCategories([c('c', 'Z', 5), c('a', 'B', 5), c('b', 'A', 1)]).map(x => x.id)).toEqual(['b', 'a', 'c'])
  })
  it('moving up swaps with the neighbour and returns only the rows that change', () => {
    expect(moveCategory(rows, 'b', -1)).toEqual([
      { id: 'b', sort: 10 },
      { id: 'a', sort: 20 },
    ])
    expect(moveCategory(rows, 'b', 1)).toEqual([
      { id: 'c', sort: 20 },
      { id: 'b', sort: 30 },
    ])
  })
  it('cannot move past either end', () => {
    expect(moveCategory(rows, 'a', -1)).toEqual([])
    expect(moveCategory(rows, 'c', 1)).toEqual([])
    expect(moveCategory(rows, 'nope', 1)).toEqual([])
  })
  it('renumbers when sort values collide, so the move is real', () => {
    const tied = [c('a', 'A', 0), c('b', 'B', 0), c('c', 'C', 0)]
    const changes = moveCategory(tied, 'c', -1) // order A, C, B
    expect(changes).toEqual([
      { id: 'a', sort: 10 },
      { id: 'c', sort: 20 },
      { id: 'b', sort: 30 },
    ])
  })
  it('a new category goes last', () => {
    expect(nextSort(rows)).toBe(40)
    expect(nextSort([])).toBe(10)
  })
})

describe('checkCategoryName', () => {
  it('trims and collapses spaces', () => {
    expect(checkCategoryName('  Fuel   &  travel ', [])).toEqual({ ok: true, name: 'Fuel & travel' })
  })
  it('refuses empty, too long and a duplicate that ignores case and spaces', () => {
    expect(checkCategoryName('   ', rows).ok).toBe(false)
    expect(checkCategoryName('x'.repeat(61), rows).ok).toBe(false)
    expect(checkCategoryName(' rent ', rows)).toMatchObject({ ok: false, message: 'A category with this name already exists.' })
  })
  it('lets a category keep its own name', () => {
    expect(checkCategoryName('Rent', rows, 'b').ok).toBe(true)
  })
})

describe('categoriesFooter', () => {
  it('counts the categories and the archived ones', () => {
    expect(categoriesFooter([c('a', 'A', 1), c('b', 'B', 2, { active: false }), c('c', 'C', 3)])).toBe('3 categories · 1 archived')
    expect(categoriesFooter([c('a', 'A', 1)])).toBe('1 category')
  })
})

describe('deleteAdvice', () => {
  it('lets an unused category go', () => {
    const a = deleteAdvice(c('x', 'Spare', 1))
    expect(a.canDelete).toBe(true)
  })
  it('refuses a used one and points at Archive and Merge', () => {
    const a = deleteAdvice(c('x', 'Rent', 1, { used: 12 }))
    expect(a.canDelete).toBe(false)
    expect(a.message).toContain('12')
    expect(a.message).toContain('cannot be deleted')
    expect(a.message).toContain('Archive it instead')
    expect(a.message).toContain('merge')
  })
  it('an archived used category says it is already hidden', () => {
    const a = deleteAdvice(c('x', 'Rent', 1, { used: 1, active: false }))
    expect(a.canDelete).toBe(false)
    expect(a.message).toContain('It is archived')
  })
  it('counts in words', () => {
    expect(usageText(0)).toBe('Not used yet')
    expect(usageText(1)).toBe('1 use')
    expect(usageText(5)).toBe('5 uses')
  })
})

const g = (id: string, name: string, kind: ExpenseGroup['kind'], sort: number): ExpenseGroup => ({ id, name, kind, sort })
const GROUPS = [g('cars', 'Vehicles', 'overhead', 20), g('office', 'Office running', 'overhead', 10), g('orders', 'Order costs', 'order_cost', 50), g('empty', 'Site visits', 'overhead', 70)]

describe('categorySections (0082)', () => {
  const list = [
    c('water', 'Water', 20, { group_id: 'office' }),
    c('rent', 'Rent', 10, { group_id: 'office' }),
    c('fuel', 'Fuel', 10, { group_id: 'cars' }),
    c('old', 'Old fuel', 5, { group_id: 'cars', active: false }),
    c('freight', 'Freight', 10, { group_id: 'orders', grp: 'order_cost' }),
    c('lost', 'No group loaded', 10, { group_id: 'gone' }),
  ]
  it('lists every group in order with its active categories in the saved order, and the archived ones apart', () => {
    const { sections, archived } = categorySections(list, GROUPS, { water: 1150, rent: 85000, old: 300, freight: 42000 })
    expect(sections.map(s => [s.group.name, s.rows.map(r => r.name), s.held, s.monthTotal])).toEqual([
      ['Office running', ['Rent', 'Water'], 2, 86150],
      ['Vehicles', ['Fuel'], 2, 300],
      ['Order costs', ['Freight'], 1, 42000],
      ['Site visits', [], 0, 0],
    ])
    expect(archived.map(a => a.name)).toEqual(['Old fuel'])
  })
})

describe('budgetState', () => {
  it('no budget, under (exactly on counts as under) and over', () => {
    expect(budgetState(500, null)).toEqual({ kind: 'none' })
    expect(budgetState(500, 0)).toEqual({ kind: 'none' })
    expect(budgetState(2800, 3000)).toEqual({ kind: 'under', left: 200, budget: 3000 })
    expect(budgetState(3000, 3000)).toEqual({ kind: 'under', left: 0, budget: 3000 })
    expect(budgetState(3400.5, 3000)).toEqual({ kind: 'over', over: 400.5, budget: 3000 })
  })
})

describe('merge', () => {
  const fuel = c('fuel', 'Fuel', 10, { group_id: 'cars', used: 3 })
  const list = [fuel, c('rent', 'Rent', 10, { group_id: 'office' }), c('car', 'Car fuel', 20, { group_id: 'cars' }), c('freight', 'Freight', 10, { group_id: 'orders', grp: 'order_cost' }), c('old', 'Old', 5, { group_id: 'office', active: false })]
  it('offers the active categories of the same kind first, in group order, then the others; never itself or an archived one', () => {
    const t = mergeTargets(fuel, list, GROUPS)
    expect(t.same.map(x => x.name)).toEqual(['Rent', 'Car fuel'])
    expect(t.other.map(x => x.name)).toEqual(['Freight'])
  })
  it('says what will happen', () => {
    expect(mergeSummary(fuel, { name: 'Car fuel' })).toBe('Moves 3 expenses and templates from "Fuel" into "Car fuel". "Fuel" is removed.')
    expect(mergeSummary({ name: 'X', used: 1 }, { name: 'Y' })).toBe('Moves 1 expense or template from "X" into "Y". "X" is removed.')
    expect(mergeSummary({ name: 'X', used: 0 }, { name: 'Y' })).toBe('Nothing uses "X" yet. It is removed and "Y" stays.')
  })
})

describe('groups', () => {
  it('a new category goes last in its group, or last overall when the group is empty', () => {
    const list = [c('a', 'A', 10, { group_id: 'office' }), c('b', 'B', 40, { group_id: 'cars' })]
    expect(nextSortIn(list, 'office')).toBe(20)
    expect(nextSortIn(list, 'empty')).toBe(50)
  })
  it('group names are unique ignoring case and spaces', () => {
    expect(checkGroupName('  site   visits ', GROUPS)).toMatchObject({ ok: false, message: 'A group with this name already exists.' })
    expect(checkGroupName('Site visits', GROUPS, 'empty').ok).toBe(true)
    expect(checkGroupName(' ', GROUPS).ok).toBe(false)
    expect(checkGroupName('Generator', GROUPS)).toEqual({ ok: true, name: 'Generator' })
  })
  it('names the kind only when the group name does not already say it', () => {
    expect(groupLabel(GROUPS[0])).toBe('Vehicles (Running costs)')
    expect(groupLabel(GROUPS[2])).toBe('Order costs')
    expect(kindNote(GROUPS[2])).toBeNull()
    expect(kindNote(GROUPS[1])).toBe('Running costs')
  })
})
