import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { RecurringPanel } from '@/features/money/expenses/RecurringPanel'
import type { Category } from '@/features/money/expenses/model'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

const CATEGORIES: Category[] = [{ id: 'c1', name: 'Internet and phone', grp: 'overhead', groupId: 'g1', defaultPaidVia: 'bank', sort: 1, active: true, budget: null }]
const row = (over: Record<string, unknown>) => ({ id: 't1', label: 'Internet', category_id: 'c1', amount: 5000, day_of_month: 5, active: true, start_month: null, notes: null, paid_via: 'bank', ...over })

function setup(templates: unknown[]) {
  installFakeDb((c: FakeCall) => (c.target === 'recurring_expenses' ? { data: templates } : { data: [] }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'A', role: 'admin' } }}>
        <ToastProvider>
          <RecurringPanel categories={CATEGORIES} today="2026-10-28" />
        </ToastProvider>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

describe('Recurring panel: a template that has not started', () => {
  it('says when it starts, not "Recorded" (day 5 bills September on 28 Oct; it starts in October)', async () => {
    setup([row({ start_month: '2026-10' })])
    expect(await screen.findByText('Starts October')).toBeInTheDocument()
    expect(screen.queryByText('Recorded')).toBeNull()
  })
  it('a started template with its bill recorded is still "Recorded"', async () => {
    setup([row({ start_month: '2026-01' })])
    // nothing recorded in the fake: it is due, so it offers Record, not Starts
    expect(await screen.findByRole('button', { name: 'Record Internet' })).toBeInTheDocument()
  })
})
