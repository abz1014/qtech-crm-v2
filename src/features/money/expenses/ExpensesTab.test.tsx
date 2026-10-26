import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ExpensesTab } from '@/features/money/expenses/ExpensesTab'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Money › Expenses list (0086): grouped by the category's group with one total in the toolbar, delete (one confirm, then at once and for good), and a closed month's rows locked.
 */
const OFFICE = 'ca7e9000-0000-4000-8000-000000000001'
const ORDERS = 'ca7e9000-0000-4000-8000-000000000005'
const GROUPS = [
  { id: OFFICE, name: 'Office running', kind: 'overhead', sort: 10 },
  { id: ORDERS, name: 'Order costs', kind: 'order_cost', sort: 50 },
]
const cat = (id: string, name: string, group_id: string, grp: string) => ({ id, name, grp, group_id, default_paid_via: 'cash', sort: 10, active: true, monthly_budget_pkr: null })
const CATEGORIES = [cat('c-water', 'Water', OFFICE, 'overhead'), cat('c-sup', 'Supplier payment', ORDERS, 'order_cost')]
const exp = (id: string, paid_on: string, amount_pkr: number, category_id: string, description: string | null) => ({
  id, paid_on, amount_pkr, category_id, description, input_tax_pkr: 0, paid_via: 'cash', order_id: null, supplier_order_id: null, payee_id: null, recurring_id: null, bank_month: null,
})
const ROWS = [exp('e1', '2026-09-03', 500, 'c-water', 'Office water'), exp('e2', '2026-09-11', 380000, 'c-sup', null), exp('e3', '2026-09-17', 1150, 'c-water', 'Office water')]

function setup(closed: string[] = [], onDelete: () => { data?: unknown; error?: unknown } = () => ({ data: [{ id: 'x' }] })) {
  const db = installFakeDb((c: FakeCall) => {
    if (c.target === 'expense_categories') return { data: CATEGORIES }
    if (c.target === 'expense_groups') return { data: GROUPS }
    if (c.target === 'expenses' && c.verb === 'delete') return onDelete() as never
    if (c.target === 'expenses' && c.verb === 'select') return { data: ROWS }
    if (c.target === 'closed_months') return { data: closed.map(m => ({ month: `${m}-01`, closed_at: '2026-10-03T10:00:00Z', closed_by: 'u1', note: null })) }
    if (c.target === 'users') return { data: [{ id: 'u1', name: 'Wasif' }] }
    if (c.target === 'rpc:lookup_labels') return { data: { companies: {}, orders: {}, legs: {} } }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ExpensesTab initialMonth="2026-09" />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
  return db
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Expenses list (0086)', () => {
  it('groups rows under their group with one month total in the toolbar; no input-tax column in a month with none', async () => {
    setup()
    expect(await screen.findByTestId('expenses-month-total')).toHaveTextContent('PKR 381,650 · 3 expenses')
    const table = screen.getByRole('table', { name: 'Expenses' })
    expect(within(table).getByText('Office running')).toBeInTheDocument()
    expect(within(table).getByText('Order costs')).toBeInTheDocument()
    expect(within(table).queryByText('Input tax (PKR)')).not.toBeInTheDocument()
    // the list ties to the Expenses report for the month shown
    expect(screen.getByRole('link', { name: 'Report for Sep 2026' })).toHaveAttribute('href', '/money/reports/expenses?by=month&period=2026-09')
    // Office running (sort 10) comes before Order costs (sort 50), whatever the dates
    const text = table.textContent ?? ''
    expect(text.indexOf('Office running')).toBeLessThan(text.indexOf('Order costs'))
  })

  it('delete asks once, then runs at once; the toast comes after the server confirms', async () => {
    const user = userEvent.setup()
    const db = setup()
    await screen.findByTestId('expenses-month-total')
    await user.click(screen.getByRole('button', { name: 'More for Supplier payment of 380000' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete expense' }))
    expect(await screen.findByTestId('delete-expense-what')).toHaveTextContent('Supplier payment · PKR 380,000 · 11 Sep 2026')
    expect(screen.getByText('This can’t be undone.')).toBeInTheDocument()
    expect(db.calls.some(c => c.verb === 'delete')).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'expenses' && c.verb === 'delete')).toBe(true))
    expect(await screen.findByText('Expense deleted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Undo/ })).not.toBeInTheDocument()
  })

  it('Cancel on the confirm deletes nothing', async () => {
    const user = userEvent.setup()
    const db = setup()
    await screen.findByTestId('expenses-month-total')
    await user.click(screen.getByRole('button', { name: 'More for Water of 500' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete expense' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(db.calls.some(c => c.verb === 'delete')).toBe(false)
    expect(screen.getByTestId('expenses-month-total')).toHaveTextContent('3 expenses')
  })

  it('a refused delete shows the server sentence and keeps the row', async () => {
    const user = userEvent.setup()
    setup([], () => ({ error: { code: 'P0001', message: 'September 2026 is closed. An admin can reopen it.' } }))
    await screen.findByTestId('expenses-month-total')
    await user.click(screen.getByRole('button', { name: 'More for Water of 500' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete expense' }))
    await user.click(await screen.findByRole('button', { name: 'Delete' }))
    expect((await screen.findAllByText('September 2026 is closed. Reopen the month first, in Lock a month.')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Expense deleted')).not.toBeInTheDocument()
    expect(screen.getByTestId('expenses-month-total')).toHaveTextContent('3 expenses')
  })

  it('a closed month: one line says so, every row is locked and nothing opens for editing', async () => {
    setup(['2026-09'])
    expect(await screen.findByTestId('expenses-closed')).toHaveTextContent('September 2026 is closed. Month closed. Reopen the month first, in Lock a month, to change or delete.')
    await screen.findByTestId('expenses-month-total')
    expect(screen.queryByRole('button', { name: /^More for/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('Locked, the month is closed').length).toBe(3)
  })

  it('a closed month: History sits next to the lock on every row and opens the history of that expense', async () => {
    const user = userEvent.setup()
    const db = setup(['2026-09'])
    await screen.findByTestId('expenses-month-total')
    const buttons = screen.getAllByRole('button', { name: /^History of/ })
    expect(buttons).toHaveLength(3)
    await user.click(buttons[0])
    await waitFor(() => expect(db.calls.some(c => c.target === 'rpc:record_history')).toBe(true))
    const call = db.calls.find(c => c.target === 'rpc:record_history') as FakeCall
    expect(opArgs(call, 'args')?.[0]).toMatchObject({ p_table: 'expenses' })
  })
})
