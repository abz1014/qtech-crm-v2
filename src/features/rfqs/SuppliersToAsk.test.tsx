import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import type { RfqItemRow } from '@/features/rfqs/api'
import { SuppliersToAskCard } from '@/features/rfqs/SuppliersToAsk'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* Suppliers to ask: search a company or add a new supplier right here; record the ticked ones as asked without copying. */

afterEach(() => {
  installFakeDb(() => ({})).uninstall()
})

const items: RfqItemRow[] = [{ id: 'it-1', number: 1, description: 'Hach HQ1110 meter', brandId: null, brandName: null, familyId: null, qty: 1, unit: 'pcs' }]

function renderCard(props: Partial<React.ComponentProps<typeof SuppliersToAskCard>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onAsk = vi.fn()
  const onRecord = vi.fn()
  const onReplyFrom = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Ayesha Rana', role: 'sales' } }}>
        <MemoryRouter>
          <ToastProvider>
            <SuppliersToAskCard suggestions={[]} items={items} busy={false} excludeIds={new Set(["c-customer"])} onAsk={onAsk} onRecord={onRecord} onReplyFrom={onReplyFrom} {...props} />
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return { onAsk, onRecord, onReplyFrom }
}

describe('SuppliersToAskCard: search or add a supplier', () => {
  it('finds a company already on file and shows it ticked', async () => {
    installFakeDb(call => {
      if (call.target === 'companies' && call.verb === 'select') return { data: [{ id: 's-9', name: 'Orient Analytical', country: 'Pakistan', city: 'Lahore' }] }
      return { data: [] }
    })
    const user = userEvent.setup()
    const { onRecord } = renderCard()
    await user.type(screen.getByRole('combobox', { name: 'Search or add a supplier' }), 'Orient')
    await user.click(await screen.findByRole('option', { name: /Orient Analytical/ }))
    expect(screen.getByRole('checkbox', { name: 'Orient Analytical' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Record as asked' }))
    expect(onRecord).toHaveBeenCalledWith([expect.objectContaining({ supplierId: 's-9', name: 'Orient Analytical' })])
  })

  it('offers Add as a new supplier when nothing matches, saves the company and ticks it', async () => {
    const writes: FakeCall[] = []
    installFakeDb(call => {
      if (call.target === 'companies' && call.verb === 'insert') {
        writes.push(call)
        return { data: { id: 'new-1', name: 'Zed Traders' } }
      }
      return { data: [] }
    })
    const user = userEvent.setup()
    renderCard()
    await user.type(screen.getByRole('combobox', { name: 'Search or add a supplier' }), 'Zed Traders')
    await user.click(await screen.findByRole('option', { name: /Add “Zed Traders” as a new supplier/ }))
    const form = await screen.findByRole('region', { name: 'New supplier' })
    await user.click(within(form).getByRole('button', { name: 'Create and use' }))
    await waitFor(() => expect(writes).toHaveLength(1))
    expect(await screen.findByRole('checkbox', { name: 'Zed Traders' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Copy message for 1 supplier' })).toBeEnabled()
  })

  it('Record as asked needs a ticked supplier; Enter reply from another supplier opens the flow', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    const { onReplyFrom } = renderCard()
    expect(screen.getByRole('button', { name: 'Record as asked' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Enter reply from another supplier' }))
    expect(onReplyFrom).toHaveBeenCalled()
  })

  it('without onReplyFrom (an engineer) there is no way to enter a reply', () => {
    installFakeDb(() => ({ data: [] }))
    renderCard({ onReplyFrom: undefined })
    expect(screen.queryByRole('button', { name: 'Enter reply from another supplier' })).toBeNull()
  })
})
