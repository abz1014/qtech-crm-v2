import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { RecurringReminder } from '@/features/today/RecurringReminder'
import type { TodayItem } from '@/features/today/types'
import { installFakeDb } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

const ITEM = { key: 'recurring_due|x', rule: 'recurring_due', href: '/money/expenses', ref: 'Expenses', title: '2 recurring expenses to record' } as unknown as TodayItem
const BILLS = [
  { id: 'b1', label: 'Rent', dayOfMonth: 1, active: true, startMonth: null, recorded: false, categoryId: 'c-rent', amount: 100000, paidVia: 'bank' as const, period: '2026-11' },
  { id: 'b2', label: 'Electricity', dayOfMonth: 3, active: true, startMonth: null, recorded: false, categoryId: 'c-elec', amount: 18000, paidVia: 'cash' as const, period: '2026-10' },
]

function setup() {
  const d = installFakeDb(() => ({ data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'A', role: 'admin' } }}>
          <ToastProvider>
            <RecurringReminder item={ITEM} bills={BILLS} today="2026-11-05" />
          </ToastProvider>
        </SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { d, user: userEvent.setup() }
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('To do: record the recurring bills in one tap', () => {
  it('offers Record all with the total, and records each bill at the amount shown (edited ones too)', async () => {
    const { d, user } = setup()
    expect(await screen.findByRole('button', { name: 'Record all (Rs 118,000)' })).toBeInTheDocument()

    const field = screen.getByLabelText('Amount for Electricity, PKR')
    await user.clear(field)
    await user.type(field, '21350')
    await user.tab()
    await user.click(await screen.findByRole('button', { name: 'Record all (Rs 121,350)' }))

    await waitFor(() => expect(d.calls.filter(c => c.target === 'expenses' && c.verb === 'insert')).toHaveLength(2))
    const rows = d.calls
      .filter(c => c.target === 'expenses' && c.verb === 'insert')
      .map(c => (c.ops.find(o => o[0] === 'insert')?.[1][0] ?? {}) as Record<string, unknown>)
      .sort((a, b) => String(a.description).localeCompare(String(b.description)))
    expect(rows.map(r => [r.description, r.amount_pkr, r.period, r.paid_via, r.recurring_id])).toEqual([
      ['Electricity', 21350, '2026-10', 'cash', 'b2'],
      ['Rent', 100000, '2026-11', 'bank', 'b1'],
    ])
  })

  it('will not record a cleared amount', async () => {
    const { user } = setup()
    const field = await screen.findByLabelText('Amount for Rent, PKR')
    await user.clear(field)
    await user.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter an amount above zero for Rent')
    expect(screen.getByRole('button', { name: /Record all/ })).toBeDisabled()
  })
})
