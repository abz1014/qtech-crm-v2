import { afterEach, describe, expect, it } from 'vitest'
import * as api from '@/features/settings/api'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { PlainError } from '@/lib/pgErrors'

let uninstall: (() => void) | null = null
afterEach(() => uninstall?.())
const fake = (respond: (c: FakeCall) => { data?: unknown; error?: { code?: string; message: string } | null }) => {
  const f = installFakeDb(respond)
  uninstall = f.uninstall
  return f
}

describe('targets api (M06)', () => {
  it('reads the year and the one before it, as numbers', async () => {
    const f = fake(() => ({ data: [{ id: 't1', user_id: 'u1', year: 2026, quarter: 4, target_net_pkr: '5000000.00' }] }))
    const rows = await api.listTargets(2026)
    expect(rows).toEqual([{ id: 't1', user_id: 'u1', year: 2026, quarter: 4, target_net_pkr: 5_000_000 }])
    expect(f.calls[0].target).toBe('targets')
    expect(opArgs(f.calls[0], 'gte')).toEqual(['year', 2025])
    expect(opArgs(f.calls[0], 'lte')).toEqual(['year', 2026])
  })

  it('reads progress from v_target_progress only, for the year shown', async () => {
    const f = fake(() => ({ data: [{ user_id: 'u1', year: 2026, quarter: 4, target_net: '9000000', achieved_net: '2000000', on_pace_net: '3000000', behind_pace: '1000000', excluded_count: 1 }] }))
    const rows = await api.listTargetProgress(2026)
    expect(rows[0]).toMatchObject({ target_net: 9_000_000, achieved_net: 2_000_000, on_pace_net: 3_000_000, excluded_count: 1 })
    expect(f.calls.map(c => c.target)).toEqual(['v_target_progress'])
    expect(opArgs(f.calls[0], 'eq')).toEqual(['year', 2026])
  })

  it('saves one cell as an upsert keyed on person, year and quarter', async () => {
    const f = fake(() => ({ data: [{ id: 't1', user_id: 'u1', year: 2026, quarter: 2, target_net_pkr: 100 }] }))
    await api.saveTarget({ userId: 'u1', year: 2026, quarter: 2, amount: 100 })
    expect(f.calls[0].verb).toBe('upsert')
    expect(opArgs(f.calls[0], 'upsert')).toEqual([{ user_id: 'u1', year: 2026, quarter: 2, target_net_pkr: 100 }, { onConflict: 'user_id,year,quarter' }])
  })

  it('a refused write (no row comes back) is an error, not a success', async () => {
    fake(() => ({ data: [] }))
    await expect(api.saveTarget({ userId: 'u1', year: 2026, quarter: 2, amount: 100 })).rejects.toBeInstanceOf(PlainError)
    await expect(api.removeTargets(['t1'])).rejects.toBeInstanceOf(PlainError)
  })

  it('copying never overwrites: duplicates are ignored, and an empty list makes no call', async () => {
    const f = fake(() => ({ data: [{ id: 'n1', user_id: 'u1', year: 2026, quarter: 4, target_net_pkr: 7 }] }))
    expect(await api.addTargets([])).toEqual([])
    expect(f.calls).toHaveLength(0)
    const added = await api.addTargets([{ user_id: 'u1', year: 2026, quarter: 4, target_net_pkr: 7 }])
    expect(added).toHaveLength(1)
    expect(opArgs(f.calls[0], 'upsert')?.[1]).toEqual({ onConflict: 'user_id,year,quarter', ignoreDuplicates: true })
  })
})

describe('categories api (M13)', () => {
  it('reads every category with its usage count (expenses plus recurring templates)', async () => {
    const f = fake(() => ({
      data: [
        { id: 'c1', name: 'Rent', grp: 'overhead', default_paid_via: 'bank', sort: 20, active: true, expenses: [{ count: 12 }], recurring_expenses: [{ count: 2 }] },
        { id: 'c2', name: 'Spare', grp: 'non_pnl', default_paid_via: 'cash', sort: 30, active: false, expenses: [{ count: 0 }], recurring_expenses: [{ count: 0 }] },
      ],
    }))
    const rows = await api.listCategories()
    expect(rows.map(r => [r.name, r.used, r.active])).toEqual([
      ['Rent', 14, true],
      ['Spare', 0, false],
    ])
    expect(String(opArgs(f.calls[0], 'select')?.[0])).toContain('expenses(count)')
    expect(String(opArgs(f.calls[0], 'select')?.[0])).toContain('recurring_expenses(count)')
  })

  it('what new expenses choose from is the active categories only, in the saved order', async () => {
    const f = fake(() => ({ data: [] }))
    await api.listActiveCategories()
    expect(f.calls[0].target).toBe('expense_categories')
    expect(opArgs(f.calls[0], 'eq')).toEqual(['active', true])
    expect(f.calls[0].ops.filter(([n]) => n === 'order').map(([, a]) => a[0])).toEqual(['sort', 'name'])
  })

  it('writes the new order one changed row at a time, setting only sort', async () => {
    const f = fake(() => ({ data: [{ id: 'x' }] }))
    await api.reorderCategories([{ id: 'a', sort: 10 }, { id: 'b', sort: 20 }])
    expect(f.calls.map(c => [opArgs(c, 'update'), opArgs(c, 'eq')])).toEqual([
      [[{ sort: 10 }], ['id', 'a']],
      [[{ sort: 20 }], ['id', 'b']],
    ])
  })

  it('surfaces the foreign key refusal from a delete untouched, so the page can word it', async () => {
    fake(() => ({ error: { code: '23503', message: 'update or delete on table "expense_categories" violates foreign key constraint' } }))
    await expect(api.deleteCategory('c1')).rejects.toMatchObject({ code: '23503' })
  })

  it('a rename the database does not apply (no admin rights) is an error', async () => {
    fake(() => ({ data: [] }))
    await expect(api.updateCategory('c1', { name: 'x' })).rejects.toBeInstanceOf(PlainError)
  })
})

describe('expense groups, budgets and merge (0083)', () => {
  it('reads the group and the budget of each category', async () => {
    fake(() => ({
      data: [
        { id: 'c1', name: 'Water', grp: 'overhead', group_id: 'g1', monthly_budget_pkr: '3000.00', default_paid_via: 'cash', sort: 20, active: true, expenses: [{ count: 3 }], recurring_expenses: [{ count: 0 }] },
        { id: 'c2', name: 'Rent', grp: 'overhead', group_id: 'g1', monthly_budget_pkr: null, default_paid_via: 'bank', sort: 10, active: true, expenses: [], recurring_expenses: [] },
      ],
    }))
    const rows = await api.listCategories()
    expect(rows.map(r => [r.name, r.group_id, r.monthly_budget_pkr])).toEqual([
      ['Water', 'g1', 3000],
      ['Rent', 'g1', null],
    ])
  })

  it('reads the groups in their saved order', async () => {
    const f = fake(() => ({ data: [{ id: 'g1', name: 'Office running', kind: 'overhead', sort: 10 }] }))
    expect(await api.listGroups()).toEqual([{ id: 'g1', name: 'Office running', kind: 'overhead', sort: 10 }])
    expect(f.calls[0].target).toBe('expense_groups')
    expect(f.calls[0].ops.filter(([n]) => n === 'order').map(([, a]) => a[0])).toEqual(['sort', 'name'])
  })

  it('adds up this month per category from the detail view', async () => {
    const f = fake(() => ({ data: [{ category_id: 'w', gross_paid: '1150.10' }, { category_id: 'w', gross_paid: '0.20' }, { category_id: 'r', gross_paid: 85000 }] }))
    expect(await api.categoryMonthTotals('2026-10')).toEqual({ w: 1150.3, r: 85000 })
    expect(f.calls[0].target).toBe('v_month_cash_out_detail')
    expect(opArgs(f.calls[0], 'eq')).toEqual(['month', '2026-10-01'])
  })

  it('merges through the one function and returns how many expenses moved', async () => {
    const f = fake(() => ({ data: 13 }))
    expect(await api.mergeCategories('from', 'into')).toBe(13)
    expect(f.calls[0].target).toBe('rpc:merge_expense_categories')
    expect(opArgs(f.calls[0], 'args')).toEqual([{ p_from: 'from', p_into: 'into' }])
  })

  it('a group write the database does not apply is an error', async () => {
    fake(() => ({ data: [] }))
    await expect(api.updateGroup('g1', { name: 'x' })).rejects.toBeInstanceOf(PlainError)
    await expect(api.deleteGroup('g1')).rejects.toBeInstanceOf(PlainError)
  })
})
