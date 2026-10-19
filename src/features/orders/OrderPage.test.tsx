import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionProvider } from '@/app/SessionProvider'
import { installFakeDb, type FakeCall } from '@/test/fakeSupabase'
import { ToastProvider } from '@/ui/Toast'
import { businessToday } from '@/lib/dates'
import type { OrderHeader, OrderItemRow, OrderLegRow, OrderMoney } from '@/features/orders/api'
import { OrderHeaderBlock } from '@/features/orders/OrderHeaderBlock'
import { OrderItemsPanel } from '@/features/orders/OrderItemsPanel'
import { LegsPanel } from '@/features/orders/LegsPanel'
import OrdersListPage from '@/features/orders/OrdersListPage'
import { orderPrimary } from '@/features/orders/lib/primaryAction'

/*
 * The order page and the orders list after the UX audit of 2026-10-19: one primary (green) button for the whole page, chosen by state;
 * no duplicate Record payment; five item columns; "Supplier orders" in plain words; the list's one Next step column.
 */
const TODAY = businessToday()
const day = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const order: OrderHeader = {
  id: 'o38',
  number: 38,
  companyId: 'c1',
  companyName: 'Punjab Cement Ltd',
  rfqId: null,
  customerPo: '253074',
  orderedOn: day(-12),
  paymentTermsDays: 30,
  needsCommissioning: true,
  plannedOn: day(10),
  doneOn: null,
  cancelledOn: null,
  cancelReason: null,
  imported: false,
  notes: null,
  site: { name: 'Hub plant, kiln line 2', address: 'Hub Chowki Road, Lasbela' },
  contact: { name: 'Mr. Tariq Hussain', phone: '0301 555 0142' },
  owner: { id: 'u', name: 'Ayesha' },
  state: { lifecycle: 'active', goods: 'to_place', commissioning: 'planned', invoicing: 'not_invoiced', dataTrust: 'ok', net: 619000, gst: 111420, gross: 730420, invoiced: 0 },
}
const legBase = { reference: null, receivedOn: null, deliveredOn: null, lastChasedOn: null, chaseCount: 0, inquiryId: null, leadTimes: ['2 wks'] }
const legs: OrderLegRow[] = [
  { ...legBase, id: 'la', supplierId: 's1', supplierName: 'Alpenmark Controls', currency: 'EUR', placedOn: null, expectedOn: null },
  { ...legBase, id: 'lb', supplierId: 's2', supplierName: 'Dubai Instrumentation', currency: 'USD', placedOn: day(-10), expectedOn: day(-3), reference: 'PI-123' },
]
const item = (over: Partial<OrderItemRow>): OrderItemRow => ({ id: 'i', number: 1, description: 'Item', brandName: null, model: null, qty: 1, unit: 'ea', isService: false, legId: null, rfqItemId: null, unitPriceNet: 1000, gstRate: 18, supplierUnitPrice: null, ...over })
const items: OrderItemRow[] = [
  item({ id: 'i1', number: 1, description: 'Belimo NM24A-SR damper actuator, 24 V, modulating, with a long description that wraps', brandName: 'Belimo', qty: 6, unitPriceNet: 48500, supplierUnitPrice: 214, legId: 'la' }),
  item({ id: 'i2', number: 2, description: 'Memosens pH sensor', qty: 2, unitPriceNet: 96500, legId: 'lb' }),
  item({ id: 'i3', number: 3, description: 'Loop check and commissioning', qty: 1, unit: 'job', unitPriceNet: 135000, isService: true }),
]
const money: OrderMoney = { grossTarget: 730420, settled: 0, balance: 730420, paymentState: 'unpaid', dueOn: null, netSale: 619000, actualCost: 0, expectedCost: null, costsState: 'provisional', margin: null, marginState: 'provisional' }

function mount(ui: React.ReactNode, role: 'admin' | 'sales' | 'engineer' = 'admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <SessionProvider value={{ status: 'signed-in', user: { id: 'u', name: 'Someone', role } }}>
        <MemoryRouter>
          <ToastProvider>{ui}</ToastProvider>
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => installFakeDb(() => ({})).uninstall())

const greens = (root: HTMLElement) => [...root.querySelectorAll('button.bg-primary')] as HTMLButtonElement[]

function page(role: 'admin' | 'sales' | 'engineer', o: OrderHeader = order, ls: OrderLegRow[] = legs, m: OrderMoney | null = money) {
  const primary = orderPrimary(o, ls, [], role, role === 'engineer' ? null : m, TODAY)
  const isMoney = role !== 'engineer'
  const its = isMoney ? items : items.map(i => ({ ...i, unitPriceNet: null, gstRate: null, supplierUnitPrice: null }))
  return mount(
    <div id="main">
      <OrderHeaderBlock order={o} legs={ls} items={its} engineers={[{ id: 'e', name: 'Bilal' }]} role={role} orderMoney={isMoney ? m : null} pos={[]} primary={primary} />
      <OrderItemsPanel order={o} items={its} legs={ls} money={isMoney} canEdit={isMoney} basisUnknown={false} />
      <LegsPanel order={o} legs={ls} items={its} pos={[]} money={isMoney} isAdmin={role === 'admin'} canEdit />
    </div>,
    role,
  )
}

describe('the order page: one primary button, chosen by state', () => {
  it('admin: the next step is Issue PO to the supplier not ordered from yet, and it is the only green button', () => {
    installFakeDb(() => ({ data: [] }))
    const { container } = page('admin')
    const next = screen.getByRole('region', { name: 'Next step' })
    expect(next).toHaveTextContent('Order the goods from Alpenmark Controls')
    expect(greens(container)).toHaveLength(1)
    expect(greens(container)[0]).toHaveTextContent('Issue PO')
    // Record payment appears once (the Payment cell), never in the header as well; Add expense is not in the header
    expect(screen.getAllByRole('button', { name: 'Record payment' })).toHaveLength(1)
    expect(within(screen.getByLabelText('State of this order')).getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
    expect(within(container.querySelector('header') as HTMLElement).queryByRole('button', { name: 'Add expense' })).toBeNull()
    // the balance moved from the Invoices panel into the strip
    expect(screen.getByTestId('order-balance')).toHaveTextContent('730,420')
    expect(screen.getByTestId('payments-empty')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Invoices and payments' })).toBeNull()
  })

  it('when every supplier order is delivered, Create invoice becomes the green button and is not repeated in the strip', () => {
    installFakeDb(() => ({ data: [] }))
    const delivered = legs.map(l => ({ ...l, placedOn: day(-10), deliveredOn: day(-1), receivedOn: day(-1) }))
    const { container } = page('admin', { ...order, needsCommissioning: false, state: { ...order.state!, goods: 'delivered', commissioning: 'n_a' } }, delivered)
    expect(greens(container).map(b => b.textContent)).toEqual(['Create invoice'])
    expect(screen.getAllByRole('button', { name: 'Create invoice' })).toHaveLength(1)
  })

  it('the engineer leads with their job: site, contact, planned date and Mark done today; no money anywhere', () => {
    installFakeDb(() => ({ data: [] }))
    const { container } = page('engineer')
    const job = screen.getByRole('region', { name: 'Your job' })
    expect(job).toHaveTextContent('Hub plant, kiln line 2')
    expect(job).toHaveTextContent('Hub Chowki Road, Lasbela')
    expect(within(job).getByRole('link', { name: /0301 555 0142/ })).toHaveAttribute('href', 'tel:03015550142')
    expect(greens(container).map(b => b.textContent)).toEqual(['Mark done today'])
    expect(within(job).getByRole('button', { name: 'Change planned date' })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/PKR|48,500|GST|Invoic|Payment|Record payment|Issue PO|Add expense/)
  })
})

describe('the items table: five columns, the rest behind "Edit GST and lines"', () => {
  it('shows Item, Qty, Unit price, Total and Supplier; GST, Service and Split only while editing', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    page('admin')
    const table = screen.getByRole('table', { name: 'Order items' })
    const headers = within(table)
      .getAllByRole('columnheader')
      .map(h => h.textContent?.replace(/\s+/g, ' ').trim())
    expect(headers).toEqual(['Item', 'Qty', 'Unit price (PKR)', 'Total (PKR)', 'Supplier'])
    expect(within(table).getByText(/Alpenmark Controls/)).toBeInTheDocument()
    expect(within(table).getByText('291,000')).toBeInTheDocument()
    expect(screen.getByTestId('items-gst-summary')).toHaveTextContent('Total with GST 730,420')
    expect(screen.queryByLabelText('GST rate, line 1')).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Exempt the whole order from GST' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Edit GST and lines' }))
    expect(screen.getByLabelText('GST rate, line 1')).toHaveValue('18')
    expect(screen.getByRole('checkbox', { name: 'Service, line 2' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Exempt the whole order from GST' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Split line 1' })).toBeInTheDocument()
  })

  it('an engineer gets Item, Qty and Supplier only', () => {
    installFakeDb(() => ({ data: [] }))
    page('engineer')
    const headers = within(screen.getByRole('table', { name: 'Order items' }))
      .getAllByRole('columnheader')
      .map(h => h.textContent?.trim())
    expect(headers).toEqual(['Item', 'Qty', 'Supplier'])
  })
})

describe('supplier orders, in plain words', () => {
  it('is called Supplier orders with Add supplier; no leg letters; actions name the supplier', () => {
    installFakeDb(() => ({ data: [] }))
    page('admin')
    const panel = screen.getByRole('region', { name: 'Supplier orders' })
    expect(within(panel).getByRole('button', { name: 'Add supplier' })).toBeInTheDocument()
    expect(panel.textContent).not.toMatch(/\bleg\b|Leg [A-Z]\b/i)
    expect(within(panel).getByRole('button', { name: 'Issue PO, Alpenmark Controls' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Delivered today, Dubai Instrumentation' })).toBeInTheDocument()
    // goods from Dubai are late: Chase goods is on the row
    expect(within(panel).getByRole('button', { name: 'Chase goods, Dubai Instrumentation' })).toBeInTheDocument()
  })
})

describe('the orders list: one Next step column', () => {
  const listRows = [
    { id: 'a', number: 38, customer_po_number: '253074', ordered_on: day(-5), owner_id: 'u', company_id: 'c', commissioning_planned_on: null, companies: { name: 'Punjab Cement Ltd' }, company_sites: { name: 'Hub plant' }, order_items: [{ description: 'Belimo actuator', qty: 6, position: 0 }, { description: 'pH sensor', qty: 2, position: 1 }, { description: 'Cable', qty: 1, position: 2 }] },
    { id: 'b', number: 39, customer_po_number: null, ordered_on: day(-9), owner_id: 'u', company_id: 'c2', commissioning_planned_on: null, companies: { name: 'Faisalabad Textile Mills' }, company_sites: null, order_items: [] },
  ]
  const states = [
    { order_id: 'a', lifecycle: 'active', goods_state: 'to_place', commissioning_state: 'n_a', data_trust: 'ok', invoicing_state: 'not_invoiced', gross: 730420 },
    { order_id: 'b', lifecycle: 'active', goods_state: 'late', commissioning_state: 'n_a', data_trust: 'ok', invoicing_state: 'not_invoiced', gross: 1000 },
  ]
  const fake = (c: FakeCall) => {
    if (c.target === 'orders') return { data: listRows }
    if (c.target === 'v_order_state') return { data: states }
    if (c.target === 'users') return { data: [{ id: 'u', name: 'Ayesha' }] }
    if (c.target === 'v_order_money') return { data: [{ order_id: 'a', payment_state: 'unpaid', receivable: 730420, due_on: null, costs_state: 'provisional' }] }
    return { data: [] }
  }

  it('leads with the customer and what was ordered, then one plain next step, then the order number; no state chips', async () => {
    installFakeDb(fake)
    const { container } = mount(<OrdersListPage />, 'admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /ORD-0038/ }).length).toBeGreaterThan(0))
    const a = screen.getAllByRole('row', { name: /ORD-0038/ })[0]
    expect(a).toHaveTextContent('Belimo actuator ×6, pH sensor ×2 + more')
    expect(a).toHaveTextContent('Place the supplier order')
    expect(screen.getAllByRole('row', { name: /ORD-0039/ })[0]).toHaveTextContent('Chase the supplier: goods late')
    expect(container.querySelectorAll('tbody [data-status]')).toHaveLength(0)
    const headers = screen
      .getAllByRole('columnheader')
      .map(h => h.textContent?.trim())
      .filter(Boolean)
    expect(headers.slice(0, 3)).toEqual(['Customer and items', 'Next step', 'Order'])
    expect(screen.getByRole('button', { name: 'Repeat a past order' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New order' })).toBeNull()
  })

  it('the state filters sit behind one Filters button', async () => {
    installFakeDb(fake)
    const user = userEvent.setup()
    mount(<OrdersListPage />, 'admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /ORD-0038/ }).length).toBeGreaterThan(0))
    expect(screen.queryByLabelText('Goods state')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect(screen.getByLabelText('Goods state')).toBeInTheDocument()
    expect(screen.getByLabelText('Payment state')).toBeInTheDocument()
  })
})
