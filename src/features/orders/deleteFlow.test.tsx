import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { OrderDeleteFacts } from '@/features/orders/api'
import { orderAlsoDeletes, orderBlockers, useDeleteOrderFlow } from '@/features/orders/deleteFlow'
import { LAST_LINE, RemoveLineConfirm } from '@/features/orders/RemoveLine'
import { requireSupabase, setSupabaseForTests, type Db } from '@/lib/supabase'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/*
 * Delete an order (0092 delete_order, W10): the confirm first lists what blocks it, in words that say what to do; with nothing in the
 * way it says what goes too, then removes the returned files and lands on the order list. "Remove line" is refused for the last line.
 */

afterEach(() => {
  cleanup()
  setSupabaseForTests(null)
})

const none: OrderDeleteFacts = { invoices: [], payments: 0, expenses: 0, pos: [], lines: 3, supplierOrders: 2, files: 1 }

describe('orderBlockers', () => {
  it('names each invoice, payment, expense and issued PO with what to do', () => {
    expect(orderBlockers({ ...none, invoices: ['INV-0042', null], payments: 1, expenses: 2, pos: [{ number: 17, issuedOn: '2026-10-02' }] })).toEqual([
      'Has invoice INV-0042: delete it first (Money, Invoices).',
      'Has an invoice with no number yet: delete it first (Money, Invoices).',
      'Has 1 payment recorded (a voided one counts): payments are kept, so cancel the order instead.',
      'Has 2 expenses recorded: remove them first, or keep the order.',
      'Has issued PO PO-26-0017: issued POs are kept, so cancel the order instead.',
    ])
    expect(orderBlockers(none)).toEqual([])
  })
  it('says what goes with the order and leaves out what is zero', () => {
    expect(orderAlsoDeletes(none)).toEqual(['3 lines', '2 supplier orders', '1 file'])
    expect(orderAlsoDeletes({ ...none, supplierOrders: 0, files: 0 })).toEqual(['3 lines'])
  })
})

const order = { id: 'o-1', number: 38, companyName: 'Indus Textile Mills' }

function Harness() {
  const flow = useDeleteOrderFlow(order)
  return (
    <>
      {flow.ask ? <button onClick={flow.ask}>Delete order</button> : <p>no delete</p>}
      {flow.node}
    </>
  )
}

function setup(o: { role?: string; invoices?: { number: string | null }[]; rpc?: (c: FakeCall) => FakeResult } = {}) {
  const fake = installFakeDb(call => {
    switch (call.target) {
      case 'invoices':
        return { data: o.invoices ?? [] }
      case 'payments_in':
      case 'expenses':
        return { data: null, count: 0 }
      case 'order_items':
        return { data: null, count: 3 }
      case 'attachments':
        return { data: null, count: 1 }
      case 'supplier_orders':
        return { data: [{ id: 's1', purchase_orders: [] }, { id: 's2', purchase_orders: [] }] }
      case 'rpc:delete_order':
        return o.rpc ? o.rpc(call) : { data: [] }
      default:
        return { data: [] }
    }
  })
  const removed: [string, string[]][] = []
  const withStorage = {
    ...requireSupabase(),
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          removed.push([bucket, paths])
          return { error: null }
        },
      }),
    },
  }
  setSupabaseForTests(withStorage as unknown as Db)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Owner', role: o.role ?? 'admin' } }}>
        <MemoryRouter initialEntries={['/orders/o-1']}>
          <ToastProvider>
            <Routes>
              <Route path="/orders/:id" element={<Harness />} />
              <Route path="/orders" element={<p>Order list page</p>} />
            </Routes>
          </ToastProvider>
        </MemoryRouter>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return { fake, removed }
}

describe('the delete order flow', () => {
  it('only an admin is offered it', () => {
    for (const role of ['sales', 'engineer']) {
      setup({ role })
      expect(screen.getByText('no delete')).toBeInTheDocument()
      cleanup()
    }
  })

  it('lists the invoice that blocks it and offers no Delete', async () => {
    const { fake } = setup({ invoices: [{ number: 'INV-0042' }] })
    await userEvent.click(screen.getByRole('button', { name: 'Delete order' }))
    expect(await screen.findByText('Has invoice INV-0042: delete it first (Money, Invoices).')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(fake.calls.some(c => c.target === 'rpc:delete_order')).toBe(false)
  })

  it('says what goes, deletes, removes the returned files and lands on the order list', async () => {
    const { fake, removed } = setup({ rpc: () => ({ data: [{ storage_bucket: 'order-files', storage_path: 'o-1/a.pdf' }] }) })
    await userEvent.click(screen.getByRole('button', { name: 'Delete order' }))
    expect((await screen.findByText(/Also deletes:/)).parentElement).toHaveTextContent('Also deletes: 3 lines, 2 supplier orders, 1 file')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Order list page')).toBeInTheDocument()
    expect(fake.calls.find(c => c.target === 'rpc:delete_order')?.ops[0]).toEqual(['args', [{ p_order_id: 'o-1' }]])
    expect(removed).toEqual([['order-files', ['o-1/a.pdf']]])
    expect(await screen.findByText('ORD-0038 deleted')).toBeInTheDocument()
  })
})

describe('Remove line', () => {
  const line = { id: 'l-1', description: 'Gate valve DN50' }
  const renderConfirm = (lineCount: number) => {
    const fake = installFakeDb(() => ({ data: [{ id: 'l-1' }] }))
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <RemoveLineConfirm orderId="o-1" line={line} lineCount={lineCount} onClose={() => undefined} />
        </ToastProvider>
      </QueryClientProvider>,
    )
    return fake
  }

  it('is refused for the last line, with no Delete button', () => {
    const fake = renderConfirm(1)
    expect(screen.getByText(LAST_LINE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(fake.calls.some(c => c.verb === 'delete')).toBe(false)
  })

  it('removes one of several lines', async () => {
    const fake = renderConfirm(2)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Line removed')).toBeInTheDocument()
    expect(fake.calls.some(c => c.target === 'order_items' && c.verb === 'delete')).toBe(true)
  })
})
