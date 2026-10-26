import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContext } from '@/app/session'
import { alsoDeletes, useDeleteRfqFlow } from '@/features/rfqs/deleteFlow'
import { requireSupabase, setSupabaseForTests, type Db } from '@/lib/supabase'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Delete an RFQ (0092): the confirm reads what goes with it, an RFQ with an order cannot be deleted, the files the database names are
 * removed grouped by bucket (and a file that will not go does not undo the delete), then the person lands on the RFQ list.
 */

afterEach(() => {
  cleanup()
  setSupabaseForTests(null)
})

const rfq = { id: 'r-1', number: 177, company: { name: 'Indus Textile Mills' } }

function Harness() {
  const flow = useDeleteRfqFlow(rfq)
  return (
    <>
      {flow.ask ? <button onClick={flow.ask}>Delete RFQ</button> : <p>no delete</p>}
      {flow.node}
    </>
  )
}

interface Setup {
  role?: string
  orders?: { id: string; number: number; cancelled_on: string | null }[]
  rpc?: (call: FakeCall) => FakeResult
  remove?: (bucket: string, paths: string[]) => { error: { message: string } | null }
}

function setup(o: Setup = {}) {
  const fake = installFakeDb(call => {
    switch (call.target) {
      case 'quotations':
        return {
          data: [
            { number: 12, revision: 0, issued_on: '2026-10-01', pdf_path: 'q/12-0.pdf' },
            { number: 12, revision: 1, issued_on: '2026-10-01', pdf_path: 'q/12-1.pdf' },
          ],
        }
      case 'rfq_items':
        return { data: null, count: 3 }
      case 'supplier_quote_lines':
        return { data: null, count: 5 }
      case 'attachments':
        return { data: null, count: 1 }
      case 'orders':
        return { data: o.orders ?? [] }
      case 'rpc:delete_rfq':
        return o.rpc ? o.rpc(call) : { data: [] }
      default:
        return { data: [] }
    }
  })
  const removed: [string, string[]][] = []
  const base = requireSupabase()
  const withStorage = {
    ...base,
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push([bucket, paths])
          return o.remove ? o.remove(bucket, paths) : { error: null }
        },
      }),
    },
  }
  setSupabaseForTests(withStorage as unknown as Db)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Owner', role: o.role ?? 'admin' } }}>
        <MemoryRouter initialEntries={['/rfqs/r-1']}>
          <ToastProvider>
            <Routes>
              <Route path="/rfqs/:id" element={<Harness />} />
              <Route path="/rfqs" element={<p>RFQ list page</p>} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return { fake, removed, invalidate }
}

const openConfirm = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Delete RFQ' }))
  await screen.findByText(/Also deletes:/)
}

describe('alsoDeletes', () => {
  it('names the quotations with their revisions, and leaves out what is zero', () => {
    expect(
      alsoDeletes({
        quotations: [
          { number: 12, revision: 0, issuedOn: '2026-10-01' },
          { number: 12, revision: 1, issuedOn: '2026-10-01' },
        ],
        items: 1,
        supplierPrices: 0,
        files: 3,
      }),
    ).toEqual(['2 issued quotations (QT-26-0012 R0, R1)', '1 item', '3 files'])
    expect(alsoDeletes({ quotations: [], items: 0, supplierPrices: 0, files: 0 })).toEqual([])
  })
})

describe('the delete RFQ flow', () => {
  it('sales and engineers are offered no delete', () => {
    for (const role of ['sales', 'engineer']) {
      setup({ role })
      expect(screen.getByText('no delete')).toBeInTheDocument()
      cleanup()
    }
  })

  it('shows the counts before it confirms', async () => {
    setup()
    await openConfirm()
    expect(screen.getByRole('dialog', { name: 'Delete RFQ-0177?' })).toBeInTheDocument()
    expect(screen.getByText(/Also deletes:/).parentElement).toHaveTextContent(
      'Also deletes: 2 issued quotations (QT-26-0012 R0, R1), 3 items, 5 supplier prices, 3 files',
    )
    expect(screen.getByText('RFQ-0177 · Indus Textile Mills')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('an RFQ with an order is blocked: the order is named and there is no Delete button', async () => {
    const { fake } = setup({ orders: [{ id: 'o-1', number: 38, cancelled_on: null }] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete RFQ' }))
    expect(await screen.findByText('Has order ORD-0038. Delete or cancel the order first.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(fake.calls.some(c => c.target === 'rpc:delete_rfq')).toBe(false)
  })

  it('a server refusal with the has_order hint turns the confirm into the blocked message', async () => {
    setup({ rpc: () => ({ error: { code: 'P0001', message: 'This RFQ has an order. Delete the order first, then delete the RFQ.', hint: 'has_order' } as never }) })
    await openConfirm()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Has an order. Delete or cancel the order first.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('removes the returned files grouped by bucket, goes to the RFQ list and says it is deleted', async () => {
    const { removed, fake, invalidate } = setup({
      rpc: () => ({
        data: [
          { storage_bucket: 'rfq-files', storage_path: 'r-1/a.pdf' },
          { storage_bucket: 'generated-docs', storage_path: 'q/12-0.pdf' },
          { storage_bucket: 'rfq-files', storage_path: 'r-1/b.png' },
        ],
      }),
    })
    await openConfirm()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('RFQ list page')).toBeInTheDocument()
    expect(fake.calls.find(c => c.target === 'rpc:delete_rfq')?.ops[0]).toEqual(['args', [{ p_rfq_id: 'r-1' }]])
    expect(removed).toEqual([
      ['rfq-files', ['r-1/a.pdf', 'r-1/b.png']],
      ['generated-docs', ['q/12-0.pdf']],
    ])
    expect(await screen.findByText('RFQ-0177 deleted')).toBeInTheDocument()
    expect(screen.queryByText('Some files were not removed')).toBeNull()
    // the RFQ lists, Today and the companies refresh
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    const keys = invalidate.mock.calls.map(c => JSON.stringify(c[0]?.queryKey))
    expect(keys.some(k => k?.includes('rfqs'))).toBe(true)
    expect(keys.some(k => k?.includes('today'))).toBe(true)
  })

  it('a file that will not be removed does not undo the delete: a quiet note, and the person still lands on the list', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    setup({
      rpc: () => ({ data: [{ storage_bucket: 'rfq-files', storage_path: 'r-1/a.pdf' }] }),
      remove: () => ({ error: { message: 'storage is down' } }),
    })
    await openConfirm()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('RFQ list page')).toBeInTheDocument()
    expect(await screen.findByText('RFQ-0177 deleted')).toBeInTheDocument()
    expect(await screen.findByText('Some files were not removed')).toBeInTheDocument()
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('another server error is shown in the dialog and nothing is navigated or removed', async () => {
    const { removed } = setup({ rpc: () => ({ error: { code: '42501', message: 'Only an admin can delete this. Nothing was deleted.', hint: 'admin_only' } as never }) })
    await openConfirm()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/admin/i)
    expect(screen.queryByText('RFQ list page')).toBeNull()
    expect(removed).toEqual([])
  })
})
