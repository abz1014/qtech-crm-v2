import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { RecurringDialog } from '@/features/money/expenses/RecurringDialog'
import type { Category, RecurringTemplate } from '@/features/money/expenses/model'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* W12b: an admin deletes a recurring template; the expenses recorded from it stay. */
const CATEGORIES: Category[] = [{ id: 'c1', name: 'Rent', grp: 'overhead', groupId: 'g1', defaultPaidVia: 'bank', sort: 1, active: true, budget: null }]
const TEMPLATE: RecurringTemplate = {
  id: 't1',
  label: 'Office rent',
  categoryId: 'c1',
  amount: 120000,
  dayOfMonth: 5,
  active: true,
  startMonth: null,
  notes: null,
  paidVia: 'bank',
}

function setup(role: 'admin' | 'sales' = 'admin') {
  const d = installFakeDb((c: FakeCall) => (c.target === 'expenses' ? { data: null, count: 7 } : { data: [] }))
  const onClose = () => undefined
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Ayesha Rana', role } }}>
        <ToastProvider>
          <RecurringDialog template={TEMPLATE} categories={CATEGORIES} onClose={onClose} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { d, user: userEvent.setup() }
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Delete a recurring expense', () => {
  it('asks first, says past expenses stay (with how many), then deletes the template', async () => {
    const { d, user } = setup()
    await user.click(await screen.findByRole('button', { name: 'Delete recurring expense' }))
    const dialog = (await screen.findAllByRole('dialog')).at(-1) as HTMLElement
    await waitFor(() => expect(within(dialog).getByTestId('delete-recurring-what').textContent).toContain('7 expenses recorded from it stay as they are'))
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(d.calls.some(c => c.target === 'recurring_expenses' && c.verb === 'delete')).toBe(true))
    expect(await screen.findByText('Deleted Office rent')).toBeInTheDocument()
    expect(d.calls.some(c => c.target === 'expenses' && c.verb === 'delete')).toBe(false)
  })

  it('is not offered to anyone but an admin', async () => {
    setup('sales')
    await screen.findByRole('button', { name: 'Save' })
    expect(screen.queryByRole('button', { name: 'Delete recurring expense' })).toBeNull()
  })
})
