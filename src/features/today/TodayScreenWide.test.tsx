import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import { ToastProvider } from '@/ui/Toast'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import TodayScreen from '@/features/today/TodayScreen'

describe('Today at desktop width', () => {
  it('draws the pane and the collision line', async () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia
    const asked = new Date(Date.now() - 9 * 86400000).toISOString()
    installFakeDb((c: FakeCall) => {
      if (c.target === 'v_rfq_state') return { data: [{ rfq_id: 'r1', number: 1, company_id: 'c', owner_id: 'me', received_on: '2026-01-01', due_on: '2099-01-01', is_priority: false, quoted_on: null, closed_on: null, outcome: 'open', sourcing_state: 'floated_awaiting', bid_state: 'to_bid', quotation_valid_until: null, companies: { name: 'Acme', city: null } }] }
      if (c.target === 'clarifications') return { data: [{ id: 'q1', rfq_id: 'r1', question: 'Q?', rfq_item_id: null, first_asked_at: asked, last_asked_at: asked, last_asked_by: 'other', ask_count: 1 }] }
      if (c.target === 'users') return { data: [{ id: 'me', role: 'sales', name: 'Me', job_title: null, phone: null }, { id: 'other', role: 'sales', name: 'Ali Raza', job_title: null, phone: null }] }
      return { data: [] }
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'me', name: 'Me', role: 'sales' } }}>
          <MemoryRouter>
            <ToastProvider>
              <TodayScreen />
            </ToastProvider>
          </MemoryRouter>
        </SessionContext.Provider>
      </QueryClientProvider>,
    )
    expect((await screen.findAllByText('Chase customer for clarifications')).length).toBeGreaterThan(1) // the row and the pane's heading
    expect(await screen.findAllByText(/Ali chased this/)).not.toHaveLength(0)
  })
})
