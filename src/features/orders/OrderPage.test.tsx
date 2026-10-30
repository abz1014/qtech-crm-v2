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
  visitType: null,
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
  const isMoney = role !== 'engineer'
  const its = isMoney ? items : items.map(i => ({ ...i, unitPriceNet: null, gstRate: null, supplierUnitPrice: null }))
  return mount(
    <div id="main">
      <OrderHeaderBlock order={o} legs={ls} items={its} engineers={[{ id: 'e', name: 'Bilal' }]} role={role} orderMoney={isMoney ? m : null} pos={[]} />
      <OrderItemsPanel order={o} items={its} legs={ls} money={isMoney} canEdit={isMoney} basisUnknown={false} />
      <LegsPanel order={o} legs={ls} items={its} pos={[]} money={isMoney} isAdmin={role === 'admin'} canEdit />
    </div>,
    role,
  )
}

describe('the order page: one primary button, chosen by state', () => {
  it('admin: late goods come first (Chase goods), and it is the only green button; its name says which supplier', () => {
    installFakeDb(() => ({ data: [] }))
    const { container } = page('admin')
    const next = screen.getByRole('region', { name: 'Next step' })
    expect(next).toHaveTextContent('Goods from Dubai Instrumentation are 3 days late')
    expect(greens(container)).toHaveLength(1)
    expect(greens(container)[0]).toHaveAccessibleName('Chase goods, Dubai Instrumentation')
    // nothing is invoiced yet, so there is no Record payment anywhere (UX audit P2); Add expense is not in the header
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull()
    expect(within(container.querySelector('header') as HTMLElement).queryByRole('button', { name: 'Add expense' })).toBeNull()
    // the balance moved from the Invoices panel into the strip
    expect(screen.getByTestId('order-balance')).toHaveTextContent('730,420')
    expect(screen.getByTestId('payments-empty')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Invoices and payments' })).toBeNull()
  })

  it('with nothing late, the next step is Issue PO to the supplier not ordered from yet, named for assistive tech', () => {
    installFakeDb(() => ({ data: [] }))
    const onTime = legs.map(l => (l.id === 'lb' ? { ...l, expectedOn: day(5) } : l))
    const { container } = page('admin', order, onTime)
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Order the goods from Alpenmark Controls')
    expect(greens(container)).toHaveLength(1)
    expect(greens(container)[0]).toHaveAccessibleName('Issue PO, Alpenmark Controls')
    // not placed and no PO yet: Issue PO on the row, Mark placed in the row's menu, never both side by side
    const row = within(screen.getByRole('region', { name: 'Supplier orders' })).getByRole('listitem', { name: 'Supplier order, Alpenmark Controls' })
    expect(within(row).getByRole('button', { name: 'Issue PO, Alpenmark Controls' })).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: /Mark placed/ })).toBeNull()
  })

  it('a supplier added with no goods lines is never the next step', () => {
    installFakeDb(() => ({ data: [] }))
    const delivered = legs.map(l => ({ ...l, placedOn: day(-10), deliveredOn: day(-1), receivedOn: day(-1) }))
    const empty = { ...legs[0], id: 'le', supplierName: 'Empty Co', placedOn: null, deliveredOn: null }
    const { container } = page('admin', { ...order, needsCommissioning: false, state: { ...order.state!, goods: 'delivered', commissioning: 'n_a' } }, [...delivered, empty])
    expect(greens(container).map(b => b.textContent)).toEqual(['Create invoice'])
    expect(screen.getByRole('region', { name: 'Next step' })).not.toHaveTextContent('Empty Co')
  })

  it('shows no next step and no green button until the supplier orders have loaded (review finding 7)', () => {
    installFakeDb(() => ({ data: [] }))
    const { container } = mount(<OrderHeaderBlock order={order} legs={[]} items={[]} engineers={[]} role="admin" orderMoney={money} next={null} />)
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveAttribute('aria-busy', 'true')
    expect(greens(container)).toHaveLength(0)
    expect(container.textContent).not.toMatch(/Everything is delivered|Create invoice ·/)
  })

  it('the title is the shared DetailHeader: name and number in the h1, the state chip under it, estimated dates as an InfoTip, the More menu', () => {
    installFakeDb(() => ({ data: [] }))
    const done = { ...order, state: { ...order.state!, lifecycle: 'done', dataTrust: 'estimated_dates' } }
    const { container } = mount(<OrderHeaderBlock order={done} legs={legs} items={items} engineers={[]} role="admin" orderMoney={money} />)
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1.querySelector('[data-status]')).toBeNull()
    expect(h1).toHaveTextContent(`${order.companyName} ORD-0038`)
    expect(container.querySelectorAll('header [data-status]')).toHaveLength(1)
    expect(screen.getByTestId('order-dates-estimated')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'About these dates' })).toBeInTheDocument()
    expect(screen.queryByText('Estimated dates')).toBeNull()
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    // the status strip draws status text, never a tinted chip
    expect(screen.getByLabelText('State of this order').querySelector('[data-status]')).toBeNull()
  })

  it('a cancelled order with an unknown price basis can still be answered by admin (review finding 6)', () => {
    installFakeDb(() => ({ data: [] }))
    const cancelled = { ...order, cancelledOn: day(-1), cancelReason: 'customer_cancelled', state: { ...order.state!, lifecycle: 'cancelled', dataTrust: 'basis_unknown' } }
    mount(<OrderHeaderBlock order={cancelled} legs={legs} items={items} engineers={[]} role="admin" orderMoney={money} />)
    expect(screen.getByText('Is GST included in these prices?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Is GST included?' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Next step' })).toBeNull()
  })

  it('when every supplier order is delivered, Create invoice becomes the green button and is not repeated in the strip', () => {
    installFakeDb(() => ({ data: [] }))
    const delivered = legs.map(l => ({ ...l, placedOn: day(-10), deliveredOn: day(-1), receivedOn: day(-1) }))
    const { container } = page('admin', { ...order, needsCommissioning: false, state: { ...order.state!, goods: 'delivered', commissioning: 'n_a' } }, delivered)
    expect(greens(container).map(b => b.textContent)).toEqual(['Create invoice'])
    expect(screen.getAllByRole('button', { name: 'Create invoice' })).toHaveLength(1)
  })

  it('the engineer leads with their job: site, contact, planned date; Delivered today is green and Mark done today waits for its date', () => {
    installFakeDb(() => ({ data: [] }))
    const { container } = page('engineer')
    const job = screen.getByRole('region', { name: 'Your job' })
    expect(job).toHaveTextContent('Hub plant, kiln line 2')
    expect(job).toHaveTextContent('Hub Chowki Road, Lasbela')
    expect(within(job).getByRole('link', { name: /0301 555 0142/ })).toHaveAttribute('href', 'tel:03015550142')
    // commissioning is planned in 10 days: not the green button yet, still one tap
    expect(greens(container).map(b => b.getAttribute('aria-label'))).toEqual(['Delivered today, Dubai Instrumentation'])
    expect(within(job).getByRole('button', { name: 'Mark done today' })).not.toHaveClass('bg-primary')
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

  it("a split item's one selling price edits in place with Save and Cancel, without turning on Edit GST and lines (review finding 8)", async () => {
    const db = installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    const split = [
      item({ id: 'p1', number: 1, description: 'Pressure transmitter', qty: 3, unitPriceNet: 134000, legId: 'la', rfqItemId: 'r1' }),
      item({ id: 'p2', number: 2, description: 'Pressure transmitter', qty: 1, unitPriceNet: 134000, legId: 'lb', rfqItemId: 'r1' }),
    ]
    mount(<OrderItemsPanel order={order} items={split} legs={legs} money canEdit basisUnknown={false} />)
    // the pencil is one tap away in the default five-column table (two copies exist for the two widths; only one is ever shown)
    await user.click(screen.getAllByRole('button', { name: 'Edit price, Pressure transmitter' })[0])
    const editor = screen.getByRole('group', { name: 'Selling price, Pressure transmitter' })
    expect(within(editor).getByRole('button', { name: 'Cancel price edit' })).toBeInTheDocument()
    await user.clear(within(editor).getByRole('textbox', { name: /Selling price before GST, PKR/ }))
    await user.type(within(editor).getByRole('textbox', { name: /Selling price before GST, PKR/ }), '140000')
    await user.click(within(editor).getByRole('button', { name: 'Save price, Pressure transmitter' }))
    await waitFor(() => expect(db.calls.some(c => c.target === 'order_items' && c.verb === 'update')).toBe(true))
  })

  it('an engineer gets Item, Qty and Supplier only', () => {
    installFakeDb(() => ({ data: [] }))
    page('engineer')
    const headers = within(screen.getByRole('table', { name: 'Order items' }))
      .getAllByRole('columnheader')
      .map(h => h.textContent?.trim())
    expect(headers).toEqual(['Item', 'Qty', 'Supplier'])
  })

  it('a fully invoiced order locks its prices and GST (HW-14) but still takes an extra line', () => {
    installFakeDb(() => ({ data: [] }))
    const invoiced: OrderHeader = { ...order, state: { ...order.state!, invoicing: 'fully_invoiced', invoiced: 730420 } }
    page('sales', invoiced)
    expect(screen.queryByRole('button', { name: 'Edit GST and lines' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Edit price/ })).toBeNull()
    expect(screen.getByRole('note')).toHaveTextContent('Fully invoiced, so prices and GST are locked to match the invoices.')
    expect(screen.getByRole('button', { name: 'Add line' })).toBeEnabled()
  })

  it('an overpaid order says by how much, not just Paid (HW-50)', () => {
    installFakeDb(() => ({ data: [] }))
    page('admin', order, legs, { ...money, settled: 730920.25, balance: 0, overpaidBy: 500.25, paymentState: 'settled' })
    expect(screen.getByTestId('order-overpaid')).toHaveTextContent('Overpaid by PKR 500.25')
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
    { id: 'a', number: 38, customer_po_number: '253074', ordered_on: day(-5), owner_id: 'u', company_id: 'c', commissioning_planned_on: null, companies: { name: 'Punjab Cement Ltd' }, company_sites: { name: 'Hub plant' }, order_items: [{ description: 'Belimo actuator', qty: 6, position: 0, supplier_order_id: 'la', is_service: false }, { description: 'pH sensor', qty: 2, position: 1 }, { description: 'Cable', qty: 1, position: 2 }], supplier_orders: [{ id: 'la', placed_on: null, expected_on: null, delivered_on: null, companies: { name: 'Alpenmark Controls' } }, { id: 'empty', placed_on: null, expected_on: null, delivered_on: null, companies: { name: 'Empty Co' } }] },
    { id: 'b', number: 39, customer_po_number: null, ordered_on: day(-9), owner_id: 'u', company_id: 'c2', commissioning_planned_on: null, companies: { name: 'Faisalabad Textile Mills' }, company_sites: null, order_items: [] },
  ]
  const states = [
    { order_id: 'a', lifecycle: 'active', goods_state: 'to_place', commissioning_state: 'n_a', data_trust: 'ok', invoicing_state: 'not_invoiced', gross: 730420 },
    { order_id: 'b', lifecycle: 'active', goods_state: 'late', commissioning_state: 'n_a', data_trust: 'ok', invoicing_state: 'not_invoiced', gross: 1000 },
  ]
  const fake = (c: FakeCall) => {
    // the id-only read of imported orders (legacy_source is not null): none of these are
    if (c.target === 'orders' && c.ops.some(([m]) => m === 'not')) return { data: [] }
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
    // the supplier is named; a supplier order with no goods line is not counted
    expect(a).toHaveTextContent('Place the order with Alpenmark Controls')
    expect(screen.getAllByRole('row', { name: /ORD-0039/ })[0]).toHaveTextContent('Chase the supplier: goods late')
    expect(container.querySelectorAll('tbody [data-status]')).toHaveLength(0)
    // the Next step is status text (icon and words, no box)
    expect(a.querySelector('[data-tone="now"]')).not.toBeNull()
    const headers = screen
      .getAllByRole('columnheader')
      .map(h => h.textContent?.trim())
      .filter(Boolean)
    expect(headers.slice(0, 3)).toEqual(['Customer and items', 'Next step', 'Order'])
    expect(screen.getByRole('button', { name: 'Repeat a past order' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New order' })).toBeNull()
  })

  it('the active list starts with the most urgent step, not the newest order (R2-05)', async () => {
    // ORD-0038 is late, ORD-0039 only needs placing: by rank 38 comes first, though it is the older order
    installFakeDb(c => (c.target === 'v_order_state' ? { data: [{ ...states[0], goods_state: 'late' }, { ...states[1], goods_state: 'to_place' }] } : fake(c)))
    mount(<OrdersListPage />, 'admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /ORD-0038/ }).length).toBeGreaterThan(0))
    const order = screen.getAllByRole('row').map(r => r.textContent ?? '').filter(t => /ORD-00(38|39)/.test(t))
    expect(order[0]).toMatch(/ORD-0038/)
    expect(order[1]).toMatch(/ORD-0039/)
  })

  it('the state filters sit behind one Filters button', async () => {
    installFakeDb(fake)
    const user = userEvent.setup()
    mount(<OrdersListPage />, 'admin')
    await waitFor(() => expect(screen.getAllByRole('row', { name: /ORD-0038/ }).length).toBeGreaterThan(0))
    expect(screen.queryByLabelText('Goods state')).toBeNull()
    // one toolbar row: Mine or All, the search, Filters. Who acts next is in Filters, with no "Any" segment (UX audit 2026-10-22, O2)
    expect(screen.queryByRole('radiogroup', { name: 'Who acts next' })).toBeNull()
    expect(screen.queryByRole('radio', { name: 'Any' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect(screen.getByLabelText('Goods state')).toBeInTheDocument()
    expect(screen.getByLabelText('Payment state')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Who acts next'), 'need')
    expect(screen.getByRole('button', { name: 'Filters · 1 on' })).toBeInTheDocument()
    expect(screen.getAllByRole('row', { name: /ORD-0039/ }).length).toBeGreaterThan(0)
  })
})

describe('the order page after the 2026-10-22 audit (P1 to P10)', () => {
  const delivered = legs.map(l => ({ ...l, placedOn: day(-10), deliveredOn: day(-2), receivedOn: day(-2) }))
  const invoicedOrder: OrderHeader = { ...order, needsCommissioning: false, state: { ...order.state!, lifecycle: 'done', goods: 'delivered', commissioning: 'n_a', invoicing: 'fully_invoiced', invoiced: 730420 } }

  it('sales, invoiced and unpaid: no "Done" chip, the payment word instead, and Copy reminder is the one green button', () => {
    installFakeDb(() => ({ data: [] }))
    const { container } = page('sales', invoicedOrder, delivered, { ...money, dueOn: day(12) })
    const header = container.querySelector('header') as HTMLElement
    expect(header).toHaveTextContent('Waiting for payment')
    expect(header).not.toHaveTextContent(/\bDone\b/)
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Customer owes PKR 730,420, due')
    expect(greens(container).map(b => b.textContent)).toEqual(['Copy reminder'])
  })

  it('admin: no Record payment once the balance is 0', () => {
    installFakeDb(() => ({ data: [] }))
    page('admin', invoicedOrder, delivered, { ...money, paymentState: 'settled', settled: 730420, balance: 0 })
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull()
  })

  it('a delivered supplier order with no PO has no Issue PO on its row; with two or more suppliers it folds to one line', async () => {
    installFakeDb(() => ({ data: [] }))
    const user = userEvent.setup()
    page('admin', invoicedOrder, delivered)
    const folded = screen.getByTestId('leg-A')
    expect(folded).toHaveTextContent('Alpenmark Controls')
    expect(folded).toHaveTextContent('Delivered')
    expect(within(folded).queryByRole('button', { name: /Issue PO/ })).toBeNull()
    await user.click(within(folded).getByRole('button', { name: /Alpenmark Controls/ }))
    const open = screen.getByTestId('leg-A')
    expect(within(open).queryByRole('button', { name: 'Issue PO, Alpenmark Controls' })).toBeNull()
    expect(within(open).queryByText('No PO yet')).toBeNull()
  })

  it('costs over the expected amount read "over by", in the warning colour', () => {
    installFakeDb(() => ({ data: [] }))
    page('admin', invoicedOrder, delivered, { ...money, actualCost: 1480000, expectedCost: 640000 })
    const line = screen.getByTestId('order-costs')
    expect(line).toHaveTextContent('Costs 1,480,000 (expected 640,000) · over by 840,000')
    expect(line).toHaveClass('text-tone-warning-fg')
  })

  it('the engineer gets the Next step band, and words their own placing as "I placed this order"', () => {
    installFakeDb(() => ({ data: [] }))
    page('engineer', { ...order, state: { ...order.state!, goods: 'to_place' } }, [legs[0]])
    expect(screen.getByRole('region', { name: 'Next step' })).toHaveTextContent('Waiting for admin to place the order with Alpenmark Controls')
    expect(screen.getByRole('button', { name: 'I placed this order, Alpenmark Controls' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark placed/ })).toBeNull()
  })

  it('goods words "not ordered yet", and "1 no" not "1 nos"', () => {
    installFakeDb(() => ({ data: [] }))
    mount(<OrderItemsPanel order={order} items={[{ ...items[0], qty: 1, unit: 'nos' }]} legs={legs} money canEdit={false} basisUnknown={false} />)
    const table = screen.getByRole('table', { name: 'Order items' })
    expect(table).toHaveTextContent('1 no')
    expect(table).not.toHaveTextContent('1 nos')
    expect(table).toHaveTextContent('not ordered yet')
  })
})
