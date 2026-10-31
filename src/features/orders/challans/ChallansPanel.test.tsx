import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import type { OrderItemRow } from '@/features/orders/api'
import { header } from '@/features/orders/lib/stepFixtures'
import { ChallansPanel } from '@/features/orders/challans/ChallansPanel'

// the PDF itself is proven in pdf/pdfs.test.tsx; here the download is only noted
const made = vi.hoisted(() => ({ files: [] as string[] }))
vi.mock('@/features/orders/challans/pdf/generate', () => ({
  generateChallanPdf: async (doc: { number: string }) => {
    made.files.push(doc.number)
    return new Blob(['%PDF-'])
  },
}))
vi.mock('@/features/orders/pdf/download', () => ({ saveBlob: () => {} }))

let fake: ReturnType<typeof installFakeDb> | null = null
afterEach(() => {
  fake?.uninstall()
  made.files.length = 0
})

const item = (id: string, over: Partial<OrderItemRow> = {}): OrderItemRow =>
  ({ id, number: 1, description: `Pressure transmitter ${id}`, brandName: null, model: null, qty: 6, unit: 'pcs', isService: false, legId: null, rfqItemId: null, unitPriceNet: 1500, gstRate: 18, supplierUnitPrice: 900, ...over }) as OrderItemRow

const ITEMS = [item('a'), item('b', { qty: 2 }), item('s', { isService: true, description: 'Commissioning' })]
const ORDER = header({ needsCommissioning: true, site: { name: 'Plant 2', address: 'Wah Cantt' } })

const ISSUED = { id: 'c1', order_id: 'o', number: 'DC-0001', issued_on: '2026-10-28', deliver_to: null, notes: null, lines: [{ description: 'X', qty: 1 }] }

function db(extra?: (c: FakeCall) => { data?: unknown } | undefined) {
  return installFakeDb(c => {
    const own = extra?.(c)
    if (own) return own
    if (c.target === 'delivery_challans' && c.verb === 'select') return { data: [ISSUED] }
    if (c.target === 'rpc:create_delivery_challan') return { data: { ...ISSUED, id: 'c2', number: 'DC-0002', issued_on: '2026-10-30' } }
    return { data: null }
  })
}

function mount(order = ORDER) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  qc.setQueryData(['settings', 'profile'], { legal_name: 'Q-Tech', address: null, phone: null, email: null, website: null })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ChallansPanel order={order} items={ITEMS} />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

describe('Delivery challans', () => {
  it('lists the challans issued, newest numbers included', async () => {
    fake = db()
    mount()
    const list = await screen.findByRole('list', { name: 'Challans issued for this order' })
    expect(within(list).getByText('DC-0001')).toBeInTheDocument()
  })

  it('starts a new challan with every goods line (never a service line) at its full quantity, and the site to deliver to', async () => {
    fake = db()
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'New challan' }))
    const lines = screen.getByRole('list', { name: 'Lines on the challan' })
    expect(within(lines).getAllByRole('listitem')).toHaveLength(2)
    expect(within(lines).queryByText('Commissioning')).toBeNull()
    expect(screen.getByRole('textbox', { name: /Deliver to/ })).toHaveValue('Plant 2\nWah Cantt')
    expect(document.body.textContent).not.toMatch(/1500|900/)
  })

  it('issues one for the lines left ticked and the quantities typed, with no price in what is sent', async () => {
    fake = db()
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'New challan' }))
    const lines = within(screen.getByRole('list', { name: 'Lines on the challan' })).getAllByRole('listitem')
    const qty = within(lines[0]).getByRole('textbox')
    await user.clear(qty)
    await user.type(qty, '4')
    await user.click(within(lines[1]).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Issue and download' }))
    await waitFor(() => expect(fake?.calls.some(c => c.target === 'rpc:create_delivery_challan')).toBe(true))
    const call = fake!.calls.find(c => c.target === 'rpc:create_delivery_challan')!
    expect(opArgs(call, 'args')?.[0]).toEqual({ p_order_id: 'o', p_lines: [{ item_id: 'a', qty: 4 }], p_deliver_to: 'Plant 2\nWah Cantt' })
    await waitFor(() => expect(made.files).toEqual(['DC-0002']))
  })

  it('holds the button while a quantity is more than the order has', async () => {
    fake = db()
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: 'New challan' }))
    const lines = within(screen.getByRole('list', { name: 'Lines on the challan' })).getAllByRole('listitem')
    const qty = within(lines[0]).getByRole('textbox')
    await user.clear(qty)
    await user.type(qty, '9')
    expect(screen.getByRole('button', { name: 'Issue and download' })).toBeDisabled()
    expect(within(lines[0]).getByText('The order has 6.')).toBeInTheDocument()
  })

  it('offers no new challan on a cancelled order', async () => {
    fake = db()
    mount(header({ cancelledOn: '2026-10-29' }))
    await screen.findByText('DC-0001')
    expect(screen.queryByRole('button', { name: 'New challan' })).toBeNull()
  })
})
