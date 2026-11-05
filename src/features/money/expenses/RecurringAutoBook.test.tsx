import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { RecurringDialog } from '@/features/money/expenses/RecurringDialog'
import type { Category, RecurringTemplate } from '@/features/money/expenses/model'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* 0138: "Book it for me" on a recurring bill: off unless chosen, with one sentence saying when to use it. */
const CATEGORIES: Category[] = [{ id: 'c1', name: 'Rent', grp: 'overhead', groupId: 'g1', defaultPaidVia: 'bank', sort: 1, active: true, budget: null }]
const TEMPLATE: RecurringTemplate = { id: 't1', label: 'Office rent', categoryId: 'c1', amount: 120000, dayOfMonth: 5, active: true, startMonth: null, notes: null, paidVia: 'bank' }

function setup(template?: RecurringTemplate) {
  const d = installFakeDb(() => ({ data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'A', role: 'admin' } }}>
        <ToastProvider>
          <RecurringDialog template={template} categories={CATEGORIES} onClose={() => undefined} />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
  return { d, user: userEvent.setup() }
}

const savedRow = (d: ReturnType<typeof setup>['d']) => d.calls.find(c => c.target === 'recurring_expenses' && c.verb === 'update')?.ops.find(o => o[0] === 'update')?.[1][0]

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Book it for me', () => {
  it('is off by default, and says to use it only for fixed amounts', async () => {
    setup()
    const box = await screen.findByRole('checkbox', { name: 'Book it for me' })
    expect(box).not.toBeChecked()
    expect(screen.getByText(/Use it only for fixed amounts/)).toBeInTheDocument()
  })

  it('saves auto_book false unless it was switched on', async () => {
    const { d, user } = setup(TEMPLATE)
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedRow(d)).toBeDefined())
    expect(savedRow(d)).toMatchObject({ auto_book: false })
  })

  it('saves auto_book true after the switch is turned on', async () => {
    const { d, user } = setup(TEMPLATE)
    await user.click(await screen.findByRole('checkbox', { name: 'Book it for me' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedRow(d)).toBeDefined())
    expect(savedRow(d)).toMatchObject({ auto_book: true })
  })
})
