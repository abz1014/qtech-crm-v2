import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import { setSupabaseForTests } from '@/lib/supabase'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import { useDeleteJobFlow } from '@/features/jobs/deleteJob/useDeleteJobFlow'
import type { BlockerRow } from '@/features/jobs/deleteJob/model'

/*
 * Delete a job (0132): with nothing in the way the shared confirm; with something the guide ("To do first", "These stay for the books",
 * Check again, Cancel the job instead). Only an admin is offered it.
 */

afterEach(() => {
  cleanup()
  setSupabaseForTests(null)
})

const job = { key: '139', rfqId: 'r-1', orderId: 'o-1', companyId: 'c-1', companyName: 'Indus Textile Mills' }

const payment: BlockerRow = { step: 3, kind: 'payment', order_id: 'o-1', order_number: 38, ref_id: 'p-1', ref_label: 'Rs 10.00 payment', ref_on: '2026-11-02', can_clear: true, why: 'Delete the payment.' }
const invoice: BlockerRow = { step: 4, kind: 'invoice', order_id: 'o-1', order_number: 38, ref_id: 'i-1', ref_label: 'Invoice INV-0042', ref_on: '2026-11-03', can_clear: false, why: 'A numbered invoice is kept for the books. Cancel the job instead.' }

function Harness({ onCancel }: { onCancel?: () => void }) {
  const flow = useDeleteJobFlow(job, onCancel)
  return (
    <>
      {flow.ask ? <button onClick={flow.ask}>Delete job</button> : <p>no delete</p>}
      {flow.node}
    </>
  )
}

function setup(o: { role?: string; blockers?: BlockerRow[][]; onCancel?: () => void; del?: (c: FakeCall) => FakeResult } = {}) {
  const queue = [...(o.blockers ?? [[]])]
  const fake = installFakeDb(call => {
    switch (call.target) {
      case 'rpc:job_delete_blockers':
        return { data: queue.length > 1 ? queue.shift() : queue[0] }
      case 'rpc:delete_job':
        return o.del ? o.del(call) : { data: [] }
      default:
        return { data: [] }
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Owner', role: o.role ?? 'admin' } }}>
        <MemoryRouter initialEntries={['/jobs/139']}>
          <ToastProvider>
            <Routes>
              <Route path="/jobs/:key" element={<Harness onCancel={o.onCancel} />} />
              <Route path="/jobs" element={<p>Jobs list page</p>} />
              <Route path="*" element={<p>Somewhere else</p>} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return { fake }
}

describe('the delete job flow', () => {
  it('only an admin is offered it', () => {
    for (const role of ['sales', 'engineer']) {
      setup({ role })
      expect(screen.getByText('no delete')).toBeInTheDocument()
      cleanup()
    }
  })

  it('with nothing in the way: says what goes, deletes and lands on the jobs list', async () => {
    const { fake } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    expect(await screen.findByText(/Also deletes:/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Jobs list page')).toBeInTheDocument()
    expect(fake.calls.find(c => c.target === 'rpc:delete_job')?.ops[0]).toEqual(['args', [{ p_rfq_id: 'r-1', p_order_id: 'o-1' }]])
    expect(await screen.findByText('Job 139 deleted')).toBeInTheDocument()
  })

  it('with something in the way: shows the guide and no Delete button', async () => {
    const { fake } = setup({ blockers: [[payment, invoice]] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    expect(await screen.findByRole('heading', { name: 'To do first' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'These stay for the books' })).toBeInTheDocument()
    expect(screen.getByText(/Delete the payment:/)).toBeInTheDocument()
    expect(screen.getByText(/Invoice INV-0042/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open this stage' })).toHaveAttribute('href', '/jobs/139?stage=payment')
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(fake.calls.some(c => c.target === 'rpc:delete_job')).toBe(false)
  })

  it('a cost on the enquiry itself is a step with a link to Expenses, and Delete waits until it is gone', async () => {
    const cost: BlockerRow = { step: 5, kind: 'expense', order_id: null, order_number: null, ref_id: 'e-1', ref_label: 'Travel to site, Rs 40.00 (on the enquiry)', ref_on: '2026-11-02', can_clear: true, why: 'Remove the cost (Money, Expenses), or keep the job.' }
    const { fake } = setup({ blockers: [[cost], []] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    expect(await screen.findByRole('heading', { name: 'To do first' })).toBeInTheDocument()
    expect(screen.getByText(/Remove the expense:/)).toBeInTheDocument()
    expect(screen.getByText(/Travel to site, PKR 40.00 \(on the enquiry\)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Expenses' })).toHaveAttribute('href', '/money/expenses')
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(fake.calls.some(c => c.target === 'rpc:delete_job')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument())
  })

  it('Check again reads the books again and turns into the confirm when nothing is left', async () => {
    setup({ blockers: [[payment], []] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    await screen.findByRole('heading', { name: 'To do first' })
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'To do first' })).toBeNull()
  })

  it('a job with a kept record: title without "yet", one-sentence intro, no repeated reason on the invoice, button says Mark the job cancelled', async () => {
    setup({ blockers: [[invoice]], onCancel: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    const dialog = await screen.findByRole('dialog', { name: 'This job cannot be deleted' })
    expect(within(dialog).getByText('Some records of this job stay for the books, so it cannot be deleted.')).toBeInTheDocument()
    expect(within(dialog).getByText(/Invoice INV-0042/)).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/Cancel the job instead/)
    expect(dialog.textContent).not.toMatch(/kept for the books\./)
    expect(within(dialog).getByRole('button', { name: 'Mark the job cancelled' })).toBeInTheDocument()
  })

  it('a kept payment shows its reason without the closing "Cancel the job instead."', async () => {
    const voided: BlockerRow = { ...payment, can_clear: false, why: 'A voided payment is kept as history and cannot be deleted. Cancel the job instead.' }
    setup({ blockers: [[voided]], onCancel: vi.fn() })
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    expect(await screen.findByText('A voided payment is kept as history and cannot be deleted.')).toBeInTheDocument()
    expect(screen.queryByText(/Cancel the job instead/)).toBeNull()
  })

  it('a job with only steps to do keeps "yet" in the title', async () => {
    setup({ blockers: [[payment]] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    expect(await screen.findByRole('dialog', { name: 'This job cannot be deleted yet' })).toBeInTheDocument()
  })

  it('Mark the job cancelled hands over to the cancel flow', async () => {
    const onCancel = vi.fn()
    setup({ blockers: [[invoice]], onCancel })
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Mark the job cancelled' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole('heading', { name: 'These stay for the books' })).toBeNull()
  })

  it('does not offer Mark the job cancelled when there is nothing to cancel', async () => {
    setup({ blockers: [[invoice]] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    await screen.findByRole('heading', { name: 'These stay for the books' })
    expect(screen.queryByRole('button', { name: 'Mark the job cancelled' })).toBeNull()
  })
})
