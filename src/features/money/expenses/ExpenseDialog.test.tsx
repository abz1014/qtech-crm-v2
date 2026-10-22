import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { AddExpenseDialog, type ExpenseContext } from '@/features/money/expenses/ExpenseDialog'
import { SUPPLIER_PAYMENT_ID, type ListedExpense } from '@/features/money/expenses/model'
import { expenseDraftKey } from '@/features/money/expenses/addDraft'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

const CATEGORIES = [
  { id: 'c-snacks', name: 'Office supplies & snacks', grp: 'overhead', default_paid_via: 'cash', sort: 50, active: true },
  { id: 'c-rent', name: 'Rent', grp: 'overhead', default_paid_via: 'bank', sort: 20, active: true },
  { id: SUPPLIER_PAYMENT_ID, name: 'Supplier payment', grp: 'order_cost', default_paid_via: 'bank', sort: 110, active: true },
]

function setup(opts: { upsert?: () => FakeResult; del?: () => FakeResult; closed?: string[]; context?: ExpenseContext; lastForOrder?: string; expense?: ListedExpense } = {}) {
  const db = installFakeDb((c: FakeCall) => {
    if (c.target === 'expense_categories') return { data: CATEGORIES }
    if (c.target === 'expenses' && c.verb === 'select') {
      // the order's last category is a different select from the 30-day tally
      if (c.ops.some(([n]) => n === 'eq')) return { data: opts.lastForOrder ? [{ category_id: opts.lastForOrder }] : [] }
      return { data: [{ category_id: 'c-snacks', paid_on: '2026-11-01' }] }
    }
    if (c.target === 'closed_months') return { data: (opts.closed ?? []).map(m => ({ month: `${m}-01`, closed_at: '2026-10-03T10:00:00Z', closed_by: 'u1', note: null })) }
    if (c.target === 'users') return { data: [{ id: 'u1', name: 'Wasif' }] }
    if (c.target === 'expenses' && c.verb === 'delete') return opts.del?.() ?? { data: [{ id: 'e1' }] }
    if (c.target === 'expenses' && c.verb === 'upsert') return opts.upsert?.() ?? {}
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AddExpenseDialog open onOpenChange={() => {}} context={opts.context} expense={opts.expense} />
      </ToastProvider>
    </QueryClientProvider>,
  )
  return db
}
const saves = (db: ReturnType<typeof installFakeDb>) => db.calls.filter(c => c.target === 'expenses' && c.verb === 'upsert')

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Add expense dialog (M03)', () => {
  it('one expense in the default category is one amount and Enter', async () => {
    const user = userEvent.setup()
    const db = setup()
    const amount = await screen.findByRole('textbox', { name: 'Amount, PKR' })
    await waitFor(() => expect(amount).toHaveFocus())
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Office supplies & snacks')
    expect(screen.getByText('Most used in the last 30 days')).toBeInTheDocument()
    await user.keyboard('450{Enter}')
    await waitFor(() => expect(saves(db)).toHaveLength(1))
    const [row] = opArgs(saves(db)[0], 'upsert')?.[0] as { amount_pkr: number; category_id: string; paid_via: string }[]
    expect(row).toMatchObject({ amount_pkr: 450, category_id: 'c-snacks', paid_via: 'cash' })
  })

  it('from a supplier order: Supplier payment, payee and supplier order filled, the amount starts at the balance, two taps to save', async () => {
    const user = userEvent.setup()
    const db = setup({
      context: { orderId: 'o1', orderLabel: 'ORD-0038', legId: 'leg1', legLabel: 'leg A', payeeId: 'p1', payeeName: 'Alpenmark Controls GmbH', amount: 384497, amountNote: 'Still owed on leg A: EUR 2,430.00 less the 412,300 advance' },
    })
    await screen.findByRole('textbox', { name: 'Amount, PKR' })
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Supplier payment')
    expect(screen.getByText('Opened from a supplier order')).toBeInTheDocument()
    // the supplier names the supplier order: no "leg A" (plain words, 2026-10-19)
    expect(screen.getByLabelText('Payee, from the supplier order')).toHaveTextContent('Alpenmark Controls GmbH')
    expect(screen.getByLabelText('Payee, from the supplier order')).not.toHaveTextContent(/leg/i)
    expect(screen.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue('384,497')
    expect(screen.getByText(/Still owed on leg A/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(saves(db)).toHaveLength(1))
    const [row] = opArgs(saves(db)[0], 'upsert')?.[0] as Record<string, unknown>[]
    expect(row).toMatchObject({ amount_pkr: 384497, category_id: SUPPLIER_PAYMENT_ID, order_id: 'o1', supplier_order_id: 'leg1', payee_id: 'p1', paid_via: 'bank' })
  })

  it('from an order: the last category used on it', async () => {
    setup({ context: { orderId: 'o1', orderLabel: 'ORD-0038' }, lastForOrder: 'c-rent' })
    await screen.findByRole('textbox', { name: 'Amount, PKR' })
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Rent')
    expect(screen.getByText('Last used on ORD-0038')).toBeInTheDocument()
  })

  it('input tax is collapsed and shows only on Supplier payment, Freight and Clearing', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByRole('textbox', { name: 'Amount, PKR' })
    expect(screen.queryByText('Input tax, optional')).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Category' }))
    await user.keyboard('sup{Tab}')
    const open = await screen.findByRole('button', { name: /Input tax, optional/ })
    await user.click(open)
    expect(screen.getByText('Cost in margin and P&L')).toBeInTheDocument()
  })

  it('a closed month shows the plain sentence under the date and keeps every entry', async () => {
    const user = userEvent.setup()
    setup({ upsert: () => ({ error: { code: 'P0001', message: 'September 2026 is closed. An admin can reopen it.' } }) })
    const amount = await screen.findByRole('textbox', { name: 'Amount, PKR' })
    await waitFor(() => expect(amount).toHaveFocus())
    await user.keyboard('450')
    await user.click(screen.getByRole('textbox', { name: 'Date paid' }))
    await user.keyboard('30 sep{Enter}')
    expect(await screen.findByText('September 2026 is closed. An admin can reopen it.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue('450')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('edits an existing expense: opens on its values and saves an update, not an insert', async () => {
    const user = userEvent.setup()
    const expense: ListedExpense = {
      id: 'e1', paidOn: '2026-11-03', amount: 1111, inputTax: 0, categoryId: 'c-rent', paidVia: 'bank', note: 'Office, November',
      orderId: null, legId: null, payeeId: null, recurringId: null, bankMonth: null,
    }
    const db = setup({ expense })
    const amount = await screen.findByRole('textbox', { name: 'Amount, PKR' })
    expect(amount).toHaveValue('1,111')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('Rent')
    expect(screen.getByRole('combobox', { name: 'Detail' })).toHaveValue('Office, November')
    await user.clear(amount)
    await user.type(amount, '1500')
    await user.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'expenses' && c.verb === 'update')).toBe(true))
    const call = db.calls.find(c => c.target === 'expenses' && c.verb === 'update')!
    expect(opArgs(call, 'update')?.[0]).toMatchObject({ amount_pkr: 1500, category_id: 'c-rent', paid_on: '2026-11-03' })
    expect(saves(db)).toHaveLength(0)
  })

  it('keeps a draft of what was typed in this tab, so a reload brings the amount back (HW-23)', async () => {
    const user = userEvent.setup()
    const key = expenseDraftKey()
    setup()
    const amount = await screen.findByRole('textbox', { name: 'Amount, PKR' })
    await waitFor(() => expect(amount).toHaveFocus())
    await user.keyboard('8765')
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem(key) ?? '{}')).toMatchObject({ amount: 8765 }))
    cleanup() // closing the dialog forgets the draft
    expect(window.sessionStorage.getItem(key)).toBeNull()

    window.sessionStorage.setItem(key, JSON.stringify({ amount: 8765 })) // as a reload finds it
    setup()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Amount, PKR' })).toHaveValue('8,765'))
  })

  describe('Delete expense', () => {
    const expense: ListedExpense = {
      id: 'e1', paidOn: '2026-11-03', amount: 1111, inputTax: 0, categoryId: 'c-rent', paidVia: 'bank', note: null,
      orderId: null, legId: null, payeeId: null, recurringId: null, bankMonth: null,
    }
    const deletes = (db: ReturnType<typeof installFakeDb>) => db.calls.filter(c => c.target === 'expenses' && c.verb === 'delete')

    it('is a visible button when editing, and not when adding', async () => {
      setup({ expense })
      expect(await screen.findByRole('button', { name: 'Delete expense' })).toBeVisible()
      cleanup()
      setup()
      await screen.findByRole('textbox', { name: 'Amount, PKR' })
      expect(screen.queryByRole('button', { name: 'Delete expense' })).not.toBeInTheDocument()
    })

    it('confirm calls the API and then says Expense deleted', async () => {
      const user = userEvent.setup()
      const db = setup({ expense })
      await user.click(await screen.findByRole('button', { name: 'Delete expense' }))
      expect(await screen.findByTestId('delete-expense-what')).toHaveTextContent('Rent · PKR 1,111 · 3 Nov 2026')
      expect(deletes(db)).toHaveLength(0)
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(deletes(db)).toHaveLength(1))
      expect(await screen.findByText('Expense deleted')).toBeInTheDocument()
    })

    it('a delete that removes 0 rows shows an error, not a success', async () => {
      const user = userEvent.setup()
      setup({ expense, del: () => ({ data: [] }) })
      await user.click(await screen.findByRole('button', { name: 'Delete expense' }))
      await user.click(await screen.findByRole('button', { name: 'Delete' }))
      expect((await screen.findAllByText('Not deleted. You may not have permission, or the month is closed.')).length).toBeGreaterThan(0)
      expect(screen.queryByText('Expense deleted')).not.toBeInTheDocument()
    })

    it('a closed month shows the lock line and no Delete', async () => {
      setup({ expense, closed: ['2026-11'] })
      expect(await screen.findByTestId('expense-closed-line')).toHaveTextContent('Month closed. Reopen it on Month end to change or delete.')
      expect(screen.queryByRole('button', { name: 'Delete expense' })).not.toBeInTheDocument()
    })
  })
})
