import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { MyClaimsPage } from '@/features/money/expenses/MyClaimsPage'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* 0136 "Which visit?": an engineer's claim can name one of their visits; today's visit is already chosen; the order follows the visit. */
const ME = 'u-eng'
const TODAY = businessToday()

function setup(visits: { id: string; order_id: string; visit_type: string; visit_on: string | null }[]) {
  const db = installFakeDb((c: FakeCall) => {
    if (c.target === 'orders') return { data: [{ id: 'o-42', number: 42, company_id: 'co-1', rfq_id: null, cancelled_on: null }, { id: 'o-7', number: 7, company_id: 'co-2', rfq_id: null, cancelled_on: null }] }
    if (c.target === 'companies') return { data: [{ id: 'co-1', name: 'Lahore Beverages' }, { id: 'co-2', name: 'Margalla Foods' }] }
    if (c.target === 'order_visits') return { data: visits }
    if (c.target === 'rpc:lookup_labels')
      return { data: { companies: {}, orders: { 'o-42': { number: 42, company_id: 'co-1', company_name: 'Lahore Beverages' }, 'o-7': { number: 7, company_id: 'co-2', company_name: 'Margalla Foods' } }, legs: {} } }
    return { data: [] }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: ME, name: 'Eng', role: 'engineer' } }}>
        <ToastProvider>
          <MyClaimsPage />
        </ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return db
}

afterEach(() => installFakeDb(() => ({})).uninstall())

const claimUpserts = (db: ReturnType<typeof installFakeDb>) => db.calls.filter(c => c.target === 'expense_claims' && c.verb === 'upsert')

describe('I paid: Which visit?', () => {
  it("has the engineer's visit of today already chosen, with its job, and sends the claim with that visit", async () => {
    const user = userEvent.setup()
    const db = setup([
      { id: 'v-today', order_id: 'o-42', visit_type: 'survey', visit_on: TODAY },
      { id: 'v-old', order_id: 'o-7', visit_type: 'installation', visit_on: '2026-01-05' },
    ])
    const visit = await screen.findByRole('combobox', { name: /Which visit/ })
    await waitFor(() => expect(visit).toHaveValue('v-today'))
    expect(screen.getByRole('combobox', { name: /^Job/ })).toHaveValue('o-42')
    await user.type(screen.getByRole('textbox', { name: 'How much, PKR' }), '350')
    await user.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(claimUpserts(db)).toHaveLength(1))
    expect((opArgs(claimUpserts(db)[0], 'upsert')?.[0] as Record<string, unknown>[])[0]).toMatchObject({ amount_pkr: 350, order_id: 'o-42', visit_id: 'v-today' })
  })

  it('chooses none when there is no visit today, and the person can pick an older one, which sets its job', async () => {
    const user = userEvent.setup()
    const db = setup([{ id: 'v-old', order_id: 'o-7', visit_type: 'installation', visit_on: '2026-01-05' }])
    const visit = await screen.findByRole('combobox', { name: /Which visit/ })
    expect(visit).toHaveValue('')
    await user.selectOptions(visit, 'v-old')
    expect(screen.getByRole('combobox', { name: /^Job/ })).toHaveValue('o-7')
    await user.type(screen.getByRole('textbox', { name: 'How much, PKR' }), '90')
    await user.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(claimUpserts(db)).toHaveLength(1))
    expect((opArgs(claimUpserts(db)[0], 'upsert')?.[0] as Record<string, unknown>[])[0]).toMatchObject({ order_id: 'o-7', visit_id: 'v-old' })
  })

  it('a claim for another job leaves no visit named', async () => {
    const user = userEvent.setup()
    const db = setup([{ id: 'v-today', order_id: 'o-42', visit_type: 'service', visit_on: TODAY }])
    const visit = await screen.findByRole('combobox', { name: /Which visit/ })
    await waitFor(() => expect(visit).toHaveValue('v-today'))
    await user.selectOptions(screen.getByRole('combobox', { name: /^Job/ }), 'o-7')
    expect(visit).toHaveValue('')
    await user.type(screen.getByRole('textbox', { name: 'How much, PKR' }), '60')
    await user.click(screen.getByRole('button', { name: 'Send for approval' }))
    await waitFor(() => expect(claimUpserts(db)).toHaveLength(1))
    expect((opArgs(claimUpserts(db)[0], 'upsert')?.[0] as Record<string, unknown>[])[0]).toMatchObject({ order_id: 'o-7', visit_id: null })
  })

  it('shows no visit box to a person with no visits', async () => {
    setup([])
    await screen.findByRole('textbox', { name: 'How much, PKR' })
    await waitFor(() => expect(screen.queryByRole('combobox', { name: /Which visit/ })).toBeNull())
  })
})
