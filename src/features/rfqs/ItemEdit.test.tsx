import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionContext } from '@/app/session'
import type { RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { EditItemDialog, RemoveItemConfirm } from '@/features/rfqs/ItemDialogs'
import { installFakeDb, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'

/* W9: items of an RFQ. Somebody else's entry is shown disabled with whose it is; an item an order line is based on stays. */

afterEach(() => {
  cleanup()
  installFakeDb(() => ({})).uninstall()
})

const rfq = { id: 'r-1', number: 177, company: { id: 'c-1', name: 'Indus Textile Mills' }, createdBy: 'u2', owner: null } as unknown as RfqHeader
const item: RfqItemRow = { id: 'i-1', number: 2, description: 'Cerabar PMC71', brandId: null, brandName: null, familyId: null, qty: 4, unit: 'pcs' }

function setup(ui: (close: () => void) => React.ReactNode, role: string, respond: (c: FakeCall) => FakeResult) {
  const fake = installFakeDb(c => (c.target === 'users' ? { data: [{ id: 'u2', name: 'Ayesha Rana' }] } : respond(c)))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SessionContext.Provider value={{ status: 'signed-in', user: { id: 'u1', name: 'Me', role } }}>
        <ToastProvider>{ui(() => {})}</ToastProvider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return fake
}

describe('edit an item', () => {
  it('disables the fields and says whose entry it is', async () => {
    setup(close => <EditItemDialog rfq={rfq} item={item} onClose={close} />, 'sales', () => ({ data: [] }))
    expect(await screen.findByText('Entered by Ayesha Rana: only they or an admin can change this')).toBeTruthy()
    expect((screen.getByLabelText(/Description/) as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save item' })).toBeNull()
  })

  it('an admin changes it', async () => {
    const fake = setup(close => <EditItemDialog rfq={rfq} item={item} onClose={close} />, 'admin', () => ({ data: [{ id: 'i-1' }] }))
    const box = screen.getByLabelText(/Description/)
    await userEvent.clear(box)
    await userEvent.type(box, 'Cerabar PMC71 0-10 bar')
    await userEvent.click(screen.getByRole('button', { name: 'Save item' }))
    await waitFor(() => expect(fake.calls.some(c => c.target === 'rfq_items' && c.verb === 'update')).toBe(true))
  })
})

describe('remove an item', () => {
  it('shows the database sentence when an order line is based on the item, and keeps the item', async () => {
    setup(
      close => <RemoveItemConfirm rfq={rfq} item={item} onClose={close} />,
      'admin',
      c =>
        c.verb === 'delete'
          ? { error: { code: 'P0001', message: 'An order line is based on this item, so it cannot be removed. Change or remove the order line first.', hint: 'linked_to_order' } as FakeResult['error'] }
          : { data: [] },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByText(/An order line is based on this item/)).toBeTruthy()
  })

  it('is refused up front for somebody else\'s entry', async () => {
    setup(close => <RemoveItemConfirm rfq={rfq} item={item} onClose={close} />, 'sales', () => ({ data: [] }))
    expect(await screen.findByText(/Entered by Ayesha Rana/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})
