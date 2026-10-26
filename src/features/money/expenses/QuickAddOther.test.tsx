import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { QuickAdd } from '@/features/money/expenses/QuickAdd'
import { miscFor, needsTitle, type Category, type ExpenseGroup } from '@/features/money/expenses/model'
import { topCategories } from '@/features/money/expenses/quick'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* 0091: "Other" is always a quick button; text that matches no category is offered as Other: '<text>'; an Other needs its title. */
const GROUPS: ExpenseGroup[] = [
  { id: 'g-office', name: 'Office running', kind: 'overhead', sort: 1 },
  { id: 'g-veh', name: 'Vehicles', kind: 'overhead', sort: 2 },
]
const c = (id: string, name: string, groupId: string, extra: Partial<Category> = {}): Category => ({
  id,
  name,
  grp: 'overhead',
  groupId,
  defaultPaidVia: 'cash',
  sort: 10,
  active: true,
  budget: null,
  ...extra,
})
const CATEGORIES: Category[] = [
  c('c-water', 'Water', 'g-office'),
  c('c-fuel', 'Fuel & travel', 'g-veh'),
  c('m-office', 'Other (Office running)', 'g-office', { isMisc: true }),
  c('m-veh', 'Other (Vehicles)', 'g-veh', { isMisc: true }),
]

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Other: the rules', () => {
  it('is always the last quick button, and only the others fill the rest', () => {
    const top = topCategories([], CATEGORIES, 6, GROUPS)
    expect(top.map(x => x.id)).toEqual(['c-water', 'c-fuel', 'm-office'])
    expect(topCategories([{ id: 'm-veh', count: 9, last: '2026-10-01' }], CATEGORIES, 6, GROUPS).filter(x => x.isMisc)).toHaveLength(1)
  })
  it('picks the Other of the group the words suggest, else the default group', () => {
    expect(miscFor('bike fuel', CATEGORIES, GROUPS)?.id).toBe('m-veh')
    expect(miscFor('courier from shop', CATEGORIES, GROUPS)?.id).toBe('m-office')
    expect(miscFor('x', CATEGORIES.filter(x => !x.isMisc), GROUPS)).toBeNull()
  })
  it('needs a title only for an Other', () => {
    expect(needsTitle(CATEGORIES[2], ' ')).toBe(true)
    expect(needsTitle(CATEGORIES[2], 'Courier')).toBe(false)
    expect(needsTitle(CATEGORIES[0], '')).toBe(false)
  })
})

function setup() {
  const db = installFakeDb((call: FakeCall) => {
    if (call.target === 'expense_groups') return { data: GROUPS.map(g => ({ ...g })) }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <QuickAdd categories={CATEGORIES} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return { db, user: userEvent.setup() }
}

describe('Quick add: Other', () => {
  it('typing a word with no category offers Other: text, which fills Detail and saves under that Other', async () => {
    const { db, user } = setup()
    await user.type(screen.getByRole('textbox', { name: 'Amount (PKR)' }), '1500')
    await user.type(screen.getByRole('textbox', { name: 'Or type what it was' }), 'Courier from shop')
    await user.click(await screen.findByRole('button', { name: "Other: 'Courier from shop'" }))
    const detail = screen.getByRole('textbox', { name: 'What was it for?' })
    expect(detail).toHaveValue('Courier from shop')
    await user.click(screen.getByRole('button', { name: 'Save this expense' }))
    await waitFor(() => expect(db.calls.some(x => x.target === 'expenses' && x.verb === 'upsert')).toBe(true))
    const ins = db.calls.find(x => x.target === 'expenses' && x.verb === 'upsert') as FakeCall
    const row = (opArgs(ins, 'upsert')?.[0] as Record<string, unknown>[])[0]
    expect(row.category_id).toBe('m-office')
    expect(row.description).toBe('Courier from shop')
  })

  it('an Other with no title is a field error under Detail, and nothing is sent', async () => {
    const { db, user } = setup()
    await user.type(screen.getByRole('textbox', { name: 'Amount (PKR)' }), '300')
    await user.click(screen.getByRole('button', { name: 'Other' }))
    await user.click(screen.getByRole('button', { name: 'Save this expense' }))
    expect(await screen.findByText('Write what it was for, e.g. Courier from shop to office')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What was it for?' })).toHaveAttribute('aria-invalid', 'true')
    expect(db.calls.some(x => x.target === 'expenses' && x.verb === 'upsert')).toBe(false)
  })
})
