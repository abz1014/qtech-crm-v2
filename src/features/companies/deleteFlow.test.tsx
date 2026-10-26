import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import { inUseWords, useDeleteCompanyFlow } from '@/features/companies/deleteFlow'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* W12a: delete an unused company; a company in use says so and offers Merge into... instead of Delete. */

afterEach(() => {
  cleanup()
  installFakeDb(() => ({})).uninstall()
})

describe('inUseWords', () => {
  it('counts what the page knows', () => {
    expect(inUseWords(3, 1)).toBe('Used by 3 RFQs and 1 order, so it cannot be deleted.')
    expect(inUseWords(0, 2)).toBe('Used by 2 orders, so it cannot be deleted.')
    expect(inUseWords(0, 0)).toMatch(/invoices or expenses/)
  })
})

function Harness({ used, onMerge }: { used: { rfqs: number; orders: number }; onMerge: () => void }) {
  const flow = useDeleteCompanyFlow({ id: 'c-1', name: 'Alpenmark Controls' }, used, onMerge)
  return (
    <>
      {flow.ask ? <button onClick={flow.ask}>Delete company</button> : <p>no delete</p>}
      {flow.node}
    </>
  )
}

function setup(o: { role?: string; used?: { rfqs: number; orders: number }; rpc?: (c: FakeCall) => FakeResult; onMerge?: () => void } = {}) {
  const fake = installFakeDb(c => (c.target === 'rpc:delete_company' && o.rpc ? o.rpc(c) : { data: null }))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Owner', role: o.role ?? 'admin' } }}>
        <MemoryRouter initialEntries={['/companies/c-1']}>
          <ToastProvider>
            <Routes>
              <Route path="/companies/:id" element={<Harness used={o.used ?? { rfqs: 0, orders: 0 }} onMerge={o.onMerge ?? (() => undefined)} />} />
              <Route path="/companies" element={<p>Company list page</p>} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return fake
}

describe('the delete company flow', () => {
  it('only an admin is offered it', () => {
    for (const role of ['sales', 'engineer']) {
      setup({ role })
      expect(screen.getByText('no delete')).toBeInTheDocument()
      cleanup()
    }
  })

  it('an unused company is deleted and the person lands on the company list', async () => {
    const fake = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete company' }))
    expect(screen.getByRole('dialog', { name: 'Delete Alpenmark Controls?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Company list page')).toBeInTheDocument()
    expect(fake.calls.find(c => c.target === 'rpc:delete_company')?.ops[0]).toEqual(['args', [{ p_company_id: 'c-1' }]])
    expect(await screen.findByText('Alpenmark Controls deleted')).toBeInTheDocument()
  })

  it('a company with RFQs says so, offers Merge into... and no Delete', async () => {
    const onMerge = vi.fn()
    const fake = setup({ used: { rfqs: 3, orders: 1 }, onMerge })
    await userEvent.click(screen.getByRole('button', { name: 'Delete company' }))
    expect(await screen.findByText(/Used by 3 RFQs and 1 order, so it cannot be deleted\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Merge into…' }))
    expect(onMerge).toHaveBeenCalled()
    expect(fake.calls.some(c => c.target === 'rpc:delete_company')).toBe(false)
  })

  it('an in_use refusal from the database turns the confirm into the same offer', async () => {
    setup({
      rpc: () => ({ error: { code: 'P0001', message: 'This company is used by RFQs, orders, invoices or expenses, so it cannot be deleted. Merge it into another company instead.', hint: 'in_use' } as never }),
    })
    await userEvent.click(screen.getByRole('button', { name: 'Delete company' }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('button', { name: 'Merge into…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})
