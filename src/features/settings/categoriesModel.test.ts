import { describe, expect, it } from 'vitest'
import { categoriesFooter, checkCategoryName, deleteAdvice, groupCategories, moveCategory, moveWithinGroup, nextSort, sortCategories, usageText, type Category } from '@/features/settings/categoriesModel'

const c = (id: string, name: string, sort: number, over: Partial<Category> = {}): Category => ({
  id,
  name,
  grp: 'overhead',
  default_paid_via: 'bank',
  sort,
  active: true,
  used: 0,
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
  it('counts the categories and the active ones', () => {
    expect(categoriesFooter([c('a', 'A', 1), c('b', 'B', 2, { active: false }), c('c', 'C', 3)])).toBe('3 categories · 2 active')
    expect(categoriesFooter([c('a', 'A', 1)])).toBe('1 category · 1 active')
  })
})

describe('deleteAdvice', () => {
  it('lets an unused category go', () => {
    const a = deleteAdvice(c('x', 'Spare', 1))
    expect(a.canDelete).toBe(true)
  })
  it('refuses an used one and points at Deactivate', () => {
    const a = deleteAdvice(c('x', 'Rent', 1, { used: 12 }))
    expect(a.canDelete).toBe(false)
    expect(a.message).toContain('12')
    expect(a.message).toContain('cannot be deleted')
    expect(a.message).toContain('Deactivate')
  })
  it('an already inactive used category says it is already hidden', () => {
    const a = deleteAdvice(c('x', 'Rent', 1, { used: 1, active: false }))
    expect(a.canDelete).toBe(false)
    expect(a.message).toContain('already deactivated')
  })
  it('counts in words', () => {
    expect(usageText(0)).toBe('Not used yet')
    expect(usageText(1)).toBe('1 use')
    expect(usageText(5)).toBe('5 uses')
  })
})

describe('sections by group (audit 2026-10-22)', () => {
  const mixed = [c('a', 'Salaries', 10), c('f', 'Freight', 15, { grp: 'order_cost' }), c('b', 'Rent', 20), c('d', 'Drawings', 25, { grp: 'non_pnl' }), c('e', 'Utilities', 30)]
  it('groups in the fixed order Overheads, Order costs, Not in P&L, each in its saved order, leaving empty groups out', () => {
    expect(groupCategories(mixed).map(g => [g.label, g.rows.map(r => r.id)])).toEqual([
      ['Overheads', ['a', 'b', 'e']],
      ['Order costs', ['f']],
      ['Not in P&L', ['d']],
    ])
    expect(groupCategories([c('a', 'Salaries', 10)]).map(g => g.label)).toEqual(['Overheads'])
  })
  it('moves within the group, past other groups, and not past the group ends', () => {
    // Rent up: passes Freight (order costs) and swaps with Salaries
    expect(moveWithinGroup(mixed, 'b', -1)).toEqual([
      { id: 'b', sort: 10 },
      { id: 'f', sort: 20 },
      { id: 'a', sort: 30 },
      { id: 'd', sort: 40 },
      { id: 'e', sort: 50 },
    ])
    expect(moveWithinGroup(mixed, 'a', -1)).toEqual([])
    expect(moveWithinGroup(mixed, 'e', 1)).toEqual([])
    expect(moveWithinGroup(mixed, 'f', 1)).toEqual([]) // alone in its group
  })
})